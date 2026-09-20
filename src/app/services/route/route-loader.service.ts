import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, Subscription, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Place, Milestone } from '../../models/waypoint.model';
import { Climb, MountainPass } from '../../models/elevation.model';
import { RouteTrack, RouteDataPackage } from '../../models/route.model';
import { OsmTurnDefinition } from '../../models/ride-cockpit.model';
import { EtaPhysicsService, SurfaceInterval } from '../eta-physics.service';
import { RouteManifestService } from '../route-manifest.service';
import { OfflineStorageService } from '../offline-storage.service';
import { NetworkStatusService } from '../network-status.service';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';

export type RouteTrackData = RouteTrack;

/**
 * Deduplicates and merges water waypoints into existing places array.
 * Normalizes coordinates, distance, ensures category is 'water', and sorts by route_mile ascending.
 */
export function mergeWaterPlaces(existingPlaces: Place[], waterWaypoints: any[]): Place[] {
  if (!Array.isArray(waterWaypoints) || waterWaypoints.length === 0) {
    return existingPlaces || [];
  }

  const placeMap = new Map<string, Place>();
  for (const p of existingPlaces || []) {
    if (p && p.id) {
      placeMap.set(p.id, { ...p });
    }
  }

  for (const w of waterWaypoints) {
    if (!w || !w.id) continue;

    let lat = 0;
    let lon = 0;
    if (w.location && typeof w.location.lat === 'number' && typeof w.location.lon === 'number') {
      lat = w.location.lat;
      lon = w.location.lon;
    } else if (Array.isArray(w.coordinates) && w.coordinates.length >= 2) {
      lat = Number(w.coordinates[0]) || 0;
      lon = Number(w.coordinates[1]) || 0;
    }

    const distance_to_trail_km =
      typeof w.distance_to_trail_km === 'number'
        ? w.distance_to_trail_km
        : typeof w.dist_off_route_m === 'number'
          ? w.dist_off_route_m / 1000
          : 0;

    const route_km =
      typeof w.route_km === 'number'
        ? w.route_km
        : typeof w.km === 'number'
          ? w.km
          : typeof w.route_mile === 'number'
            ? w.route_mile / 0.621371
            : typeof w.mile === 'number'
              ? w.mile / 0.621371
              : 0;

    const route_mile =
      typeof w.route_mile === 'number'
        ? w.route_mile
        : typeof w.mile === 'number'
          ? w.mile
          : route_km * 0.621371;

    const google_maps_url =
      w.google_maps_url || (lat !== 0 || lon !== 0 ? `https://maps.google.com/?q=${lat},${lon}` : undefined);

    if (placeMap.has(w.id)) {
      const existing = placeMap.get(w.id)!;
      placeMap.set(w.id, {
        ...existing,
        ...w,
        category: 'water',
        location: existing.location && existing.location.lat != null ? existing.location : { lat, lon },
        distance_to_trail_km: existing.distance_to_trail_km ?? distance_to_trail_km,
        route_km: existing.route_km ?? route_km,
        route_mile: existing.route_mile ?? route_mile,
        google_maps_url: existing.google_maps_url || google_maps_url
      });
    } else {
      const newPlace: Place = {
        ...w,
        id: w.id,
        name: w.name || 'Water Access Point',
        category: 'water',
        type: w.type || 'water',
        town: w.town || '',
        is_in_town: w.is_in_town ?? false,
        location: { lat, lon },
        distance_to_trail_km,
        route_km,
        route_mile,
        google_maps_url
      };
      placeMap.set(w.id, newPlace);
    }
  }

  return Array.from(placeMap.values()).sort((a, b) => (a.route_mile || 0) - (b.route_mile || 0));
}

@Injectable({
  providedIn: 'root'
})
export class RouteLoaderService implements OnDestroy {
  private readonly http = inject(HttpClient);
  readonly etaPhysics = inject(EtaPhysicsService);
  readonly manifestService = inject(RouteManifestService);
  readonly offlineStorage = inject(OfflineStorageService);
  readonly networkStatus = inject(NetworkStatusService);

  private activeSub?: Subscription;

  readonly places = signal<Place[]>([]);
  readonly trackPoints = signal<[number, number, number, number, number][]>([]);
  readonly guidanceTrackPoints = signal<[number, number, number, number, number][]>([]);
  readonly hasGuidanceTrack = signal<boolean>(false);
  readonly climbs = signal<Climb[]>([]);
  readonly passes = signal<MountainPass[]>([]);
  readonly milestones = signal<Milestone[]>([]);
  readonly turns = signal<OsmTurnDefinition[]>([]);

  readonly activeRouteId = signal<string | null>(null);
  readonly totalMilesSignal = signal<number>(0);
  readonly totalKmSignal = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly isTrackLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  get totalDistanceMiles(): number {
    const summary = this.manifestService.activeRouteSummary();
    if (summary && summary.totalDistanceMiles) {
      return summary.totalDistanceMiles;
    }
    if (this.totalMilesSignal() > 0) {
      return this.totalMilesSignal();
    }
    const pts = this.trackPoints();
    if (pts.length > 0) {
      return pts[pts.length - 1][4];
    }
    return 0;
  }

  get totalDistanceKm(): number {
    const summary = this.manifestService.activeRouteSummary();
    if (summary && summary.totalDistanceKm) {
      return summary.totalDistanceKm;
    }
    if (this.totalKmSignal() > 0) {
      return this.totalKmSignal();
    }
    const pts = this.trackPoints();
    if (pts.length > 0) {
      return pts[pts.length - 1][3];
    }
    return 0;
  }

  ngOnDestroy(): void {
    this.unloadRoute();
  }

  loadRoute(routeId: string): void {
    if (this.activeSub) {
      this.activeSub.unsubscribe();
      this.activeSub = undefined;
    }

    if (!routeId) {
      this.unloadRoute();
      return;
    }

    this.activeRouteId.set(routeId);
    this.places.set([]);
    this.trackPoints.set([]);
    this.guidanceTrackPoints.set([]);
    this.hasGuidanceTrack.set(false);
    this.climbs.set([]);
    this.passes.set([]);
    this.milestones.set([]);
    this.turns.set([]);
    this.totalMilesSignal.set(0);
    this.totalKmSignal.set(0);
    this.etaPhysics.setTrackPoints([]);
    this.etaPhysics.setSurfaceIntervals([]);
    this.etaPhysics.invalidateCache();

    this.isLoading.set(true);
    this.isTrackLoading.set(true);
    this.error.set(null);

    // If offline, load immediately from IndexedDB device storage
    if (!this.networkStatus.isOnline()) {
      this.offlineStorage
        .getRoutePackage(routeId)
        .then((pkg) => {
          if (this.activeRouteId() !== routeId) return;
          if (pkg) {
            this.applyRoutePackage(pkg);
          } else {
            this.error.set(`Route ${routeId} is not cached for offline use.`);
            this.isLoading.set(false);
            this.isTrackLoading.set(false);
          }
        })
        .catch((err) => {
          if (this.activeRouteId() !== routeId) return;
          console.error(`Failed to load cached route data for ${routeId}:`, err);
          this.error.set(`Failed to load cached route data for ${routeId}`);
          this.isLoading.set(false);
          this.isTrackLoading.set(false);
        });
      return;
    }

    // When online, download per-route static assets and cache atomically in IndexedDB
    this.activeSub = forkJoin({
      places: this.http.get<Place[]>(`/data/routes/${routeId}/places.json`),
      track: this.http.get<RouteTrackData>(`/data/routes/${routeId}/route-track.json`),
      surfaces: this.http.get<SurfaceInterval[]>(`/data/routes/${routeId}/surfaces.json`),
      climbs: this.http.get<Climb[]>(`/data/routes/${routeId}/climbs.json`),
      passes: this.http.get<MountainPass[]>(`/data/routes/${routeId}/passes.json`),
      milestones: this.http.get<Milestone[]>(`/data/routes/${routeId}/milestones.json`)
    }).subscribe({
      next: ({ places, track, surfaces, climbs, passes, milestones }) => {
        this.activeSub = undefined;
        if (this.activeRouteId() !== routeId) return;

        const normalized = (places || []).map((p) => {
          if (/recreation site|rec site/i.test(p.name) && p.category !== 'campground') {
            return { ...p, category: 'campground' as const, type: 'campground' };
          }
          return p;
        });
        const sorted = [...normalized].sort((a, b) => (a.route_mile || 0) - (b.route_mile || 0));
        this.places.set(sorted);

        const pts = track?.points || [];
        this.trackPoints.set(pts);
        this.guidanceTrackPoints.set(pts);
        this.hasGuidanceTrack.set(false);

        if (track?.total_miles) {
          this.totalMilesSignal.set(track.total_miles);
        }
        if (track?.total_km) {
          this.totalKmSignal.set(track.total_km);
        }
        this.etaPhysics.setTrackPoints(pts);
        this.etaPhysics.setSurfaceIntervals(surfaces || []);
        this.climbs.set(climbs || []);
        this.passes.set(passes || []);
        this.milestones.set(milestones || []);

        this.isLoading.set(false);
        this.isTrackLoading.set(false);

        // Atomically cache downloaded package to IndexedDB
        const pkg: RouteDataPackage = {
          routeId,
          track: track || { total_km: 0, total_miles: 0, points: [] },
          places: sorted,
          surfaces: surfaces || [],
          climbs: climbs || [],
          passes: passes || [],
          milestones: milestones || [],
          turns: this.turns() || [],
          cachedAt: Date.now()
        };
        this.offlineStorage.saveRoutePackage(pkg).catch((err) => {
          console.warn(`Could not save route package for ${routeId} to offline storage:`, err);
        });

        // Load road-snapped guidance track alongside raw track (progressive enhancement)
        this.loadGuidanceTrack(routeId);
        this.loadWaterAccess(routeId);
      },
      error: (err) => {
        this.activeSub = undefined;
        if (this.activeRouteId() !== routeId) return;

        // Fallback to offline storage if online fetch fails
        this.offlineStorage
          .getRoutePackage(routeId)
          .then((pkg) => {
            if (this.activeRouteId() !== routeId) return;
            if (pkg) {
              this.applyRoutePackage(pkg);
            } else {
              console.error(`Failed to load route data for ${routeId}:`, err);
              this.error.set(`Failed to load route data for ${routeId}`);
              this.isLoading.set(false);
              this.isTrackLoading.set(false);
            }
          })
          .catch(() => {
            if (this.activeRouteId() !== routeId) return;
            this.error.set(`Failed to load route data for ${routeId}`);
            this.isLoading.set(false);
            this.isTrackLoading.set(false);
          });
      }
    });
  }

  applyRoutePackage(pkg: RouteDataPackage): void {
    const normalized = (pkg.places || []).map((p) => {
      if (/recreation site|rec site/i.test(p.name) && p.category !== 'campground') {
        return { ...p, category: 'campground' as const, type: 'campground' };
      }
      return p;
    });
    const sorted = [...normalized].sort((a, b) => (a.route_mile || 0) - (b.route_mile || 0));
    this.places.set(sorted);

    const pts = pkg.track?.points || [];
    this.trackPoints.set(pts);
    const gPts = pkg.guidanceTrack?.points && pkg.guidanceTrack.points.length > 0 ? pkg.guidanceTrack.points : pts;
    this.guidanceTrackPoints.set(gPts);
    this.hasGuidanceTrack.set(!!(pkg.guidanceTrack && pkg.guidanceTrack.points && pkg.guidanceTrack.points.length > 0));

    if (pkg.track?.total_miles) {
      this.totalMilesSignal.set(pkg.track.total_miles);
    }
    if (pkg.track?.total_km) {
      this.totalKmSignal.set(pkg.track.total_km);
    }
    this.etaPhysics.setTrackPoints(pts);
    this.etaPhysics.setSurfaceIntervals(pkg.surfaces || []);
    this.climbs.set(pkg.climbs || []);
    this.passes.set(pkg.passes || []);
    this.milestones.set(pkg.milestones || []);
    this.turns.set(pkg.turns || []);

    this.isLoading.set(false);
    this.isTrackLoading.set(false);

    if ((!pkg.guidanceTrack || !pkg.guidanceTrack.points || pkg.guidanceTrack.points.length === 0) && pkg.routeId) {
      this.loadGuidanceTrack(pkg.routeId);
    }
    if (pkg.routeId) {
      this.loadWaterAccess(pkg.routeId);
    }
  }

  async loadGuidanceTrack(routeId: string): Promise<void> {
    if (!routeId) return;
    try {
      const url = resolveBaseHref(`/data/routes/${routeId}/guidance-track.json`);
      const res = await fetch(url);
      if (res.ok) {
        const data: RouteTrackData = await res.json();
        if (this.activeRouteId() === routeId && data && Array.isArray(data.points) && data.points.length > 0) {
          this.guidanceTrackPoints.set(data.points);
          this.hasGuidanceTrack.set(true);
          // Update cached offline package with guidance track if stored
          this.offlineStorage
            .getRoutePackage(routeId)
            .then(async (pkg) => {
              if (!pkg) {
                await new Promise((r) => setTimeout(r, 100));
                pkg = await this.offlineStorage.getRoutePackage(routeId);
              }
              if (pkg) {
                pkg.guidanceTrack = data;
                this.offlineStorage.saveRoutePackage(pkg).catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      // Graceful fallback to route-track.json already in place
    }
  }

  async loadWaterAccess(routeId: string): Promise<void> {
    if (!routeId) return;
    try {
      let url = resolveBaseHref(`/data/routes/${routeId}/water_access.json`);
      let res = await fetch(url);
      if (!res.ok && res.status === 404) {
        url = resolveBaseHref(`/data/routes/${routeId}/water_bothies.json`);
        res = await fetch(url);
      }
      if (res && res.ok) {
        const waterData = await res.json();
        if (this.activeRouteId() === routeId && Array.isArray(waterData) && waterData.length > 0) {
          const merged = mergeWaterPlaces(this.places(), waterData);
          this.places.set(merged);

          // Update cached offline package with merged places
          this.offlineStorage
            .getRoutePackage(routeId)
            .then(async (pkg) => {
              if (!pkg) {
                await new Promise((r) => setTimeout(r, 100));
                pkg = await this.offlineStorage.getRoutePackage(routeId);
              }
              if (pkg) {
                pkg.places = merged;
                this.offlineStorage.saveRoutePackage(pkg).catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      // Gracefully handle missing water files, network errors, or unmocked fetch in tests
    }
  }

  mergeWaterPlaces(existingPlaces: Place[], waterWaypoints: any[]): Place[] {
    return mergeWaterPlaces(existingPlaces, waterWaypoints);
  }

  loadTurns(routeId: string): void {
    if (!routeId) {
      this.turns.set([]);
      return;
    }
    this.http.get<OsmTurnDefinition[]>(`/data/routes/${routeId}/turns.json`)
      .pipe(catchError(() => of([])))
      .subscribe((turns) => {
        if (this.activeRouteId() === routeId) {
          this.turns.set(turns || []);
        }
      });
  }

  unloadRoute(): void {
    if (this.activeSub) {
      this.activeSub.unsubscribe();
      this.activeSub = undefined;
    }
    this.activeRouteId.set(null);
    this.places.set([]);
    this.trackPoints.set([]);
    this.guidanceTrackPoints.set([]);
    this.hasGuidanceTrack.set(false);
    this.climbs.set([]);
    this.passes.set([]);
    this.milestones.set([]);
    this.turns.set([]);
    this.totalMilesSignal.set(0);
    this.totalKmSignal.set(0);
    this.etaPhysics.setTrackPoints([]);
    this.etaPhysics.setSurfaceIntervals([]);
    this.etaPhysics.invalidateCache();
    this.isLoading.set(false);
    this.isTrackLoading.set(false);
    this.error.set(null);
  }
}
