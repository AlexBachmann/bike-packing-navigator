import { Injectable, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, Subscription } from 'rxjs';
import { Place, WaypointViewModel, ProjectionResult, isSelfServiceWaschsalon, Milestone } from '../models/waypoint.model';
import { Climb, MountainPass } from '../models/elevation.model';
import { EtaPhysicsService, SurfaceInterval } from './eta-physics.service';
import { SettingsService } from './settings.service';
import { RouteManifestService } from './route-manifest.service';
import { RouteTrack, RouteDataPackage } from '../models/route.model';
import { OfflineStorageService } from './offline-storage.service';
import { NetworkStatusService } from './network-status.service';

export type RouteTrackData = RouteTrack;

@Injectable({
  providedIn: 'root'
})
export class RouteDataService implements OnDestroy {
  private readonly http = inject(HttpClient);
  readonly etaPhysics = inject(EtaPhysicsService);
  readonly settings = inject(SettingsService);
  readonly manifestService = inject(RouteManifestService);
  readonly offlineStorage = inject(OfflineStorageService);
  readonly networkStatus = inject(NetworkStatusService);

  private activeSub?: Subscription;

  ngOnDestroy(): void {
    this.unloadRoute();
  }

  readonly places = signal<Place[]>([]);
  readonly trackPoints = signal<[number, number, number, number, number][]>([]);
  readonly climbs = signal<Climb[]>([]);
  readonly passes = signal<MountainPass[]>([]);
  readonly milestones = signal<Milestone[]>([]);

  readonly activeRouteId = signal<string | null>(null);
  readonly totalMilesSignal = signal<number>(0);
  readonly totalKmSignal = signal<number>(0);
  readonly isLoading = signal<boolean>(false);
  readonly isTrackLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Dynamic total route statistics
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

  constructor() {}

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
    this.climbs.set([]);
    this.passes.set([]);
    this.milestones.set([]);
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
          cachedAt: Date.now()
        };
        this.offlineStorage.saveRoutePackage(pkg).catch((err) => {
          console.warn(`Could not save route package for ${routeId} to offline storage:`, err);
        });
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

  private applyRoutePackage(pkg: RouteDataPackage): void {
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

    this.isLoading.set(false);
    this.isTrackLoading.set(false);
  }

  unloadRoute(): void {
    if (this.activeSub) {
      this.activeSub.unsubscribe();
      this.activeSub = undefined;
    }
    this.activeRouteId.set(null);
    this.places.set([]);
    this.trackPoints.set([]);
    this.climbs.set([]);
    this.passes.set([]);
    this.milestones.set([]);
    this.totalMilesSignal.set(0);
    this.totalKmSignal.set(0);
    this.etaPhysics.setTrackPoints([]);
    this.etaPhysics.setSurfaceIntervals([]);
    this.etaPhysics.invalidateCache();
    this.isLoading.set(false);
    this.isTrackLoading.set(false);
    this.error.set(null);
  }

  /**
   * Orthogonally projects a coordinate (lat, lon) onto the closest segment of the active route.
   * Calculates perpendicular distance and estimated return mile.
   * Marks isOffRoute = true if perpendicular distance exceeds 10 km.
   */
  projectOntoRoute(lat: number, lon: number): ProjectionResult | null {
    const points = this.trackPoints();
    if (!points || points.length < 2) return null;

    const R = 6371.0; // Mean Earth radius in km
    const rad = Math.PI / 180;
    const cosLat = Math.cos(lat * rad);

    let bestDist = Infinity;
    let bestKm = 0;
    let bestMile = 0;
    let bestPoint = { lat: points[0][0], lon: points[0][1], ele: points[0][2] };

    // Pass 1: Quick bounding box search within +-0.25 deg lat (~28 km)
    let candidateChecked = false;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      if (Math.abs(p1[0] - lat) > 0.25 && Math.abs(p2[0] - lat) > 0.25) {
        continue;
      }
      candidateChecked = true;

      const x1 = (p1[1] - lon) * rad * R * cosLat;
      const y1 = (p1[0] - lat) * rad * R;
      const x2 = (p2[1] - lon) * rad * R * cosLat;
      const y2 = (p2[0] - lat) * rad * R;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq > 0.000000001) {
        t = Math.max(0, Math.min(1, (-x1 * dx - y1 * dy) / lenSq));
      }

      const qx = x1 + t * dx;
      const qy = y1 + t * dy;
      const d = Math.sqrt(qx * qx + qy * qy);

      if (d < bestDist) {
        bestDist = d;
        bestKm = p1[3] + t * (p2[3] - p1[3]);
        bestMile = p1[4] + t * (p2[4] - p1[4]);
        bestPoint = {
          lat: p1[0] + t * (p2[0] - p1[0]),
          lon: p1[1] + t * (p2[1] - p1[1]),
          ele: p1[2] + t * (p2[2] - p1[2])
        };
      }
    }

    // Pass 2: If no segment was in +-0.25 deg box or bestDist > 25km, search all segments
    if (!candidateChecked || bestDist > 25) {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const x1 = (p1[1] - lon) * rad * R * cosLat;
        const y1 = (p1[0] - lat) * rad * R;
        const x2 = (p2[1] - lon) * rad * R * cosLat;
        const y2 = (p2[0] - lat) * rad * R;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;

        let t = 0;
        if (lenSq > 0.000000001) {
          t = Math.max(0, Math.min(1, (-x1 * dx - y1 * dy) / lenSq));
        }

        const qx = x1 + t * dx;
        const qy = y1 + t * dy;
        const d = Math.sqrt(qx * qx + qy * qy);

        if (d < bestDist) {
          bestDist = d;
          bestKm = p1[3] + t * (p2[3] - p1[3]);
          bestMile = p1[4] + t * (p2[4] - p1[4]);
          bestPoint = {
            lat: p1[0] + t * (p2[0] - p1[0]),
            lon: p1[1] + t * (p2[1] - p1[1]),
            ele: p1[2] + t * (p2[2] - p1[2])
          };
        }
      }
    }

    const isOffRoute = bestDist > 10.0;

    return {
      distanceKm: Math.round(bestDist * 100) / 100,
      distanceMiles: Math.round(bestDist * 0.621371 * 100) / 100,
      projectedRouteKm: Math.round(bestKm * 10) / 10,
      projectedRouteMile: Math.round(bestMile * 10) / 10,
      isOffRoute,
      nearestPointOnTrail: bestPoint,
      nearestMile: Math.round(bestMile * 10) / 10
    };
  }

  calculateWaypointsAhead(
    currentMile: number,
    avgSpeedMph: number,
    filterCategories: Set<string> | null = null,
    limit: number = 50
  ): WaypointViewModel[] {
    const all = this.places();
    if (!all.length) return [];

    const isPowerMode = this.settings.paceMode() === 'power';
    const effectiveSpeed = Math.max(1.0, avgSpeedMph);

    // Register reactive dependency on async background calculation completion
    if (isPowerMode) {
      this.etaPhysics.cacheVersion();
    }

    const waypoints = all
      .filter((p) => {
        // Only waypoints at or ahead of current mile
        if (p.route_mile < currentMile - 0.2) return false;
        // Category filter if applied
        if (filterCategories && filterCategories.size > 0) {
          const isLaundry = p.category === 'laundromat' || p.category === 'laundry';
          if (isLaundry && !isSelfServiceWaschsalon(p.name)) {
            return false;
          }
          const hasDirectMatch = filterCategories.has(p.category);
          const isLaundryMatch =
            (filterCategories.has('laundromat') || filterCategories.has('laundry')) && isLaundry;
          if (!hasDirectMatch && !isLaundryMatch) {
            return false;
          }
        }
        return true;
      })
      .slice(0, limit);

    return waypoints
      .map((p) => {
        const distanceAheadMiles = Math.max(0, p.route_mile - currentMile);
        const distanceAheadKm = distanceAheadMiles * 1.60934;

        let estimatedHours = 0;
        if (isPowerMode) {
          const estimatedSeconds = this.etaPhysics.calculateEtaSeconds(currentMile, p.route_mile);
          estimatedHours = estimatedSeconds / 3600;
        } else {
          estimatedHours = distanceAheadMiles / effectiveSpeed;
        }

        const hours = Math.floor(estimatedHours);
        const minutes = Math.round((estimatedHours - hours) * 60);

        let timeFormatted = '';
        if (hours === 0) {
          timeFormatted = `${minutes}m`;
        } else if (hours < 24) {
          timeFormatted = `${hours}h ${minutes.toString().padStart(2, '0')}m`;
        } else {
          const days = Math.floor(hours / 24);
          const remHours = hours % 24;
          timeFormatted = `${days}d ${remHours}h`;
        }

        return {
          ...p,
          distanceAheadMiles,
          distanceAheadKm,
          estimatedHours,
          estimatedTimeFormatted: timeFormatted
        };
      });
  }
}
