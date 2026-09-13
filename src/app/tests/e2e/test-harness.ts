/**
 * Test Harness & Contract Definitions for Route-Agnostic Bikepacking Platform (Tiers 1-4)
 * Conforms to PROJECT.md § Interface Contracts & ORIGINAL_REQUEST.md § 2026-09-12T17:03:10Z.
 */

import { Signal, signal, WritableSignal } from '@angular/core';
import { Place, WaypointViewModel } from '../../models/waypoint.model';

// ============================================================================
// 1. Route Manifest Contracts
// ============================================================================

export interface RouteSummary {
  id: string; // e.g. 'tour-divide-2025', 'colorado-trail'
  name: string; // 'Tour Divide 2025', 'Colorado Trail'
  shortName: string; // 'TD', 'CT'
  startLocation: string; // 'Banff, AB', 'Denver (Waterton Canyon), CO'
  endLocation: string; // 'Antelope Wells, NM', 'Durango, CO'
  totalDistanceMiles: number;
  totalDistanceKm: number;
  elevationGainFt: number;
  elevationGainM: number;
  iconicCheckpoints: string[];
  description: string;
  startCoordinates: [number, number]; // [lat, lng]
  bounds: [[number, number], [number, number]]; // [[south, west], [north, east]]
}

export interface RouteManifest {
  version: string;
  defaultRouteId: string | null;
  routes: RouteSummary[];
}

export interface RouteTrack {
  total_km: number;
  total_miles: number;
  points: [number, number, number, number, number][]; // [lat, lon, ele, km, mi]
}

export interface SurfaceInterval {
  startKm: number;
  endKm: number;
  surface: string;
  color: string;
}

export interface Climb {
  id: string;
  name: string;
  startKm: number;
  endKm: number;
  lengthKm: number;
  gainM: number;
  avgGrade: number;
  category: number;
}

export interface MountainPass {
  id: string;
  name: string;
  km: number;
  elevationM: number;
}

export interface Milestone {
  id: string;
  name: string;
  mile: number;
  km: number;
}

export interface RouteDataPackage {
  routeId: string;
  track: RouteTrack;
  places: Place[];
  surfaces: SurfaceInterval[];
  climbs: Climb[];
  passes: MountainPass[];
  milestones: Milestone[];
  cachedAt: number;
}

// ============================================================================
// 2. Service Interfaces
// ============================================================================

export interface IRouteManifestService {
  readonly availableRoutes: Signal<RouteSummary[]>;
  readonly activeRouteId: Signal<string | null>;
  readonly activeRouteSummary: Signal<RouteSummary | null>;
  readonly isManifestLoading: Signal<boolean>;
  readonly manifestError: Signal<string | null>;

  loadManifest(): Promise<void>;
  selectRoute(routeId: string | null): Promise<boolean>;
  validateRouteId(routeId: string): boolean;
}

export interface IOfflineStorageService {
  isRouteCached(routeId: string): Promise<boolean>;
  getRoutePackage(routeId: string): Promise<RouteDataPackage | null>;
  saveRoutePackage(pkg: RouteDataPackage): Promise<void>;
  getCachedRouteIds(): Promise<string[]>;
  removeRoutePackage(routeId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface INetworkStatusService {
  readonly isOnline: Signal<boolean>;
  setOnline(online: boolean): void;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  durationMs: number;
  timestamp: number;
}

export interface IToastService {
  readonly activeToasts: Signal<ToastMessage[]>;
  show(message: string, type?: 'info' | 'warning' | 'error' | 'success', durationMs?: number): string;
  dismiss(id: string): void;
  clear(): void;
}

export interface ITileCacheService {
  readonly cacheName: string;
  cacheTilesForRoute(routeSummary: RouteSummary, minZoom?: number, maxZoom?: number): Promise<number>;
  hasTile(url: string): Promise<boolean>;
  getTile(url: string): Promise<Response | null>;
  putTile(url: string, response: Response): Promise<void>;
  getCachedTileCount(): Promise<number>;
  clearTileCache(): Promise<void>;
}

// ============================================================================
// 3. Authoritative Reference Datasets
// ============================================================================

export const TOUR_DIVIDE_SUMMARY: RouteSummary = {
  id: 'tour-divide-2025',
  name: 'Tour Divide 2025',
  shortName: 'TD',
  startLocation: 'Banff, AB',
  endLocation: 'Antelope Wells, NM',
  totalDistanceMiles: 2679.2,
  totalDistanceKm: 4311.8,
  elevationGainFt: 149600,
  elevationGainM: 45600,
  iconicCheckpoints: ['Banff', 'Sparwood', 'Roosville Border', 'Helena', 'Pinedale', 'Rawlins', 'Salida', 'Abiquiu', 'Antelope Wells'],
  description: 'The premier off-pavement bikepacking route following the Continental Divide from the Canadian Rockies to the Chihuahuan Desert on the US-Mexico border.',
  startCoordinates: [51.1784, -115.5708],
  bounds: [
    [31.3322, -115.5708],
    [51.1784, -106.925]
  ]
};

export const COLORADO_TRAIL_SUMMARY: RouteSummary = {
  id: 'colorado-trail',
  name: 'Colorado Trail',
  shortName: 'CT',
  startLocation: 'Denver (Waterton Canyon), CO',
  endLocation: 'Durango, CO',
  totalDistanceMiles: 535.0,
  totalDistanceKm: 861.0,
  elevationGainFt: 89000,
  elevationGainM: 27127,
  iconicCheckpoints: ['Waterton Canyon', 'Kenosha Pass', 'Breckenridge', 'Leadville', 'Buena Vista', 'Monarch Pass', 'Silverton', 'Durango'],
  description: 'A rugged high-altitude singletrack across the Colorado Rocky Mountains traversing multiple 12,000+ ft passes between Denver and Durango.',
  startCoordinates: [39.4912, -105.0945],
  bounds: [
    [37.2753, -107.8801],
    [39.4912, -105.0945]
  ]
};

export const SAMPLE_MANIFEST: RouteManifest = {
  version: '1.0.0',
  defaultRouteId: 'tour-divide-2025',
  routes: [TOUR_DIVIDE_SUMMARY, COLORADO_TRAIL_SUMMARY]
};

export function createSamplePackage(routeId: string): RouteDataPackage {
  const isTD = routeId === 'tour-divide-2025';
  const distanceKm = isTD ? 4311.8 : 861.0;
  const distanceMi = isTD ? 2679.2 : 535.0;

  return {
    routeId,
    track: {
      total_km: distanceKm,
      total_miles: distanceMi,
      points: [
        [isTD ? 51.1784 : 39.4912, isTD ? -115.5708 : -105.0945, 1400.0, 0.0, 0.0],
        [isTD ? 49.7333 : 38.5, isTD ? -114.88 : -106.0, 2100.0, distanceKm * 0.25, distanceMi * 0.25],
        [isTD ? 41.79 : 37.8, isTD ? -107.24 : -107.2, 2800.0, distanceKm * 0.6, distanceMi * 0.6],
        [isTD ? 31.3322 : 37.2753, isTD ? -108.21 : -107.8801, 1500.0, distanceKm, distanceMi]
      ]
    },
    places: [
      {
        id: `${routeId}-start-poi`,
        name: isTD ? 'Banff Springs' : 'Waterton Trailhead',
        category: 'town',
        type: 'town',
        is_in_town: true,
        location: {
          lat: isTD ? 51.1784 : 39.4912,
          lon: isTD ? -115.5708 : -105.0945
        },
        distance_to_trail_km: 0,
        route_mile: 0.0,
        route_km: 0.0
      },
      {
        id: `${routeId}-mid-poi`,
        name: isTD ? 'Rawlins Supply' : 'Leadville General',
        category: 'grocery',
        type: 'grocery',
        is_in_town: true,
        location: {
          lat: isTD ? 41.79 : 39.25,
          lon: isTD ? -107.24 : -106.29
        },
        distance_to_trail_km: 0,
        route_mile: distanceMi * 0.5,
        route_km: distanceKm * 0.5
      },
      {
        id: `${routeId}-end-poi`,
        name: isTD ? 'Antelope Wells Border' : 'Durango Junction',
        category: 'town',
        type: 'town',
        is_in_town: true,
        location: {
          lat: isTD ? 31.3322 : 37.2753,
          lon: isTD ? -108.21 : -107.8801
        },
        distance_to_trail_km: 0,
        route_mile: distanceMi,
        route_km: distanceKm
      }
    ],
    surfaces: [
      { startKm: 0, endKm: distanceKm * 0.4, surface: 'gravel', color: '#10b981' },
      { startKm: distanceKm * 0.4, endKm: distanceKm * 0.8, surface: 'paved', color: '#6b7280' },
      { startKm: distanceKm * 0.8, endKm: distanceKm, surface: 'singletrack', color: '#f59e0b' }
    ],
    climbs: [
      {
        id: `${routeId}-c1`,
        name: isTD ? 'Koko Claims' : 'Monarch Pass Ascent',
        startKm: 50,
        endKm: 65,
        lengthKm: 15,
        gainM: 650,
        avgGrade: 4.3,
        category: 2
      }
    ],
    passes: [
      {
        id: `${routeId}-p1`,
        name: isTD ? 'Red Meadow Pass' : 'Kenosha Pass',
        km: 120,
        elevationM: 3000
      }
    ],
    milestones: [
      { id: `${routeId}-m1`, name: isTD ? 'Banff' : 'Denver', mile: 0, km: 0 },
      { id: `${routeId}-m2`, name: isTD ? 'Antelope Wells' : 'Durango', mile: distanceMi, km: distanceKm }
    ],
    cachedAt: Date.now()
  };
}

// ============================================================================
// 4. Contract Implementations for Testing & Simulation
// ============================================================================

export class ContractNetworkStatusService implements INetworkStatusService {
  private readonly _isOnline = signal<boolean>(true);
  readonly isOnline = this._isOnline.asReadonly();

  setOnline(online: boolean): void {
    this._isOnline.set(online);
  }
}

export class ContractToastService implements IToastService {
  private readonly _toasts = signal<ToastMessage[]>([]);
  readonly activeToasts = this._toasts.asReadonly();
  private nextId = 1;

  show(message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info', durationMs: number = 4000): string {
    const id = `toast-${this.nextId++}`;
    const toast: ToastMessage = {
      id,
      message,
      type,
      durationMs,
      timestamp: Date.now()
    };
    this._toasts.update((current) => [...current, toast]);
    return id;
  }

  dismiss(id: string): void {
    this._toasts.update((current) => current.filter((t) => t.id !== id));
  }

  clear(): void {
    this._toasts.set([]);
  }
}

export class ContractOfflineStorageService implements IOfflineStorageService {
  private inMemoryStore = new Map<string, RouteDataPackage>();
  readonly DB_NAME = 'bikepack-offline-v1';
  readonly STORE_NAME = 'route-packages';

  async isRouteCached(routeId: string): Promise<boolean> {
    return this.inMemoryStore.has(routeId);
  }

  async getRoutePackage(routeId: string): Promise<RouteDataPackage | null> {
    const pkg = this.inMemoryStore.get(routeId);
    return pkg ? JSON.parse(JSON.stringify(pkg)) : null;
  }

  async saveRoutePackage(pkg: RouteDataPackage): Promise<void> {
    this.inMemoryStore.set(pkg.routeId, JSON.parse(JSON.stringify(pkg)));
  }

  async getCachedRouteIds(): Promise<string[]> {
    return Array.from(this.inMemoryStore.keys());
  }

  async removeRoutePackage(routeId: string): Promise<void> {
    this.inMemoryStore.delete(routeId);
  }

  async clearAll(): Promise<void> {
    this.inMemoryStore.clear();
  }
}

export class ContractTileCacheService implements ITileCacheService {
  readonly cacheName = 'bikepack-map-tiles-v1';
  private inMemoryTileMap = new Map<string, string>(); // url -> dummy tile data

  async cacheTilesForRoute(routeSummary: RouteSummary, minZoom: number = 5, maxZoom: number = 10): Promise<number> {
    let count = 0;
    // Calculate bounding box tiles
    const [south, west] = routeSummary.bounds[0];
    const [north, east] = routeSummary.bounds[1];

    for (let z = minZoom; z <= maxZoom; z++) {
      // Simulate bounding box tile coordinates
      const xStart = Math.floor(((west + 180) / 360) * Math.pow(2, z));
      const xEnd = Math.floor(((east + 180) / 360) * Math.pow(2, z));
      const yStart = Math.floor(((1 - Math.log(Math.tan((north * Math.PI) / 180) + 1 / Math.cos((north * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, z));
      const yEnd = Math.floor(((1 - Math.log(Math.tan((south * Math.PI) / 180) + 1 / Math.cos((south * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, z));

      const minX = Math.min(xStart, xEnd);
      const maxX = Math.max(xStart, xEnd);
      const minY = Math.min(yStart, yEnd);
      const maxY = Math.max(yStart, yEnd);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
          this.inMemoryTileMap.set(tileUrl, 'PNG_TILE_BINARY_STREAM');
          count++;
        }
      }
    }
    return count;
  }

  async hasTile(url: string): Promise<boolean> {
    return this.inMemoryTileMap.has(url);
  }

  async getTile(url: string): Promise<Response | null> {
    if (this.inMemoryTileMap.has(url)) {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      });
    }
    return null;
  }

  async putTile(url: string, response: Response): Promise<void> {
    this.inMemoryTileMap.set(url, 'PNG_DATA');
  }

  async getCachedTileCount(): Promise<number> {
    return this.inMemoryTileMap.size;
  }

  async clearTileCache(): Promise<void> {
    this.inMemoryTileMap.clear();
  }
}

export class ContractRouteManifestService implements IRouteManifestService {
  private readonly _availableRoutes = signal<RouteSummary[]>(SAMPLE_MANIFEST.routes);
  readonly availableRoutes = this._availableRoutes.asReadonly();

  private readonly _activeRouteId = signal<string | null>(null);
  readonly activeRouteId = this._activeRouteId.asReadonly();

  private readonly _activeRouteSummary = signal<RouteSummary | null>(null);
  readonly activeRouteSummary = this._activeRouteSummary.asReadonly();

  private readonly _isManifestLoading = signal<boolean>(false);
  readonly isManifestLoading = this._isManifestLoading.asReadonly();

  private readonly _manifestError = signal<string | null>(null);
  readonly manifestError = this._manifestError.asReadonly();

  constructor(
    private networkStatus: INetworkStatusService,
    private offlineStorage: IOfflineStorageService,
    private toastService: IToastService
  ) {}

  async loadManifest(): Promise<void> {
    this._isManifestLoading.set(true);
    try {
      this._availableRoutes.set(SAMPLE_MANIFEST.routes);
      this._manifestError.set(null);
    } catch (err: any) {
      this._manifestError.set('Failed to load route manifest');
    } finally {
      this._isManifestLoading.set(false);
    }
  }

  validateRouteId(routeId: string): boolean {
    return this.availableRoutes().some((r) => r.id === routeId);
  }

  async selectRoute(routeId: string | null): Promise<boolean> {
    if (!routeId) {
      this._activeRouteId.set(null);
      this._activeRouteSummary.set(null);
      return true;
    }

    const summary = this.availableRoutes().find((r) => r.id === routeId);
    if (!summary) {
      this.toastService.show(`Route '${routeId}' not recognized in manifest.`, 'warning');
      return false;
    }

    // Offline check
    if (!this.networkStatus.isOnline()) {
      const isCached = await this.offlineStorage.isRouteCached(routeId);
      if (!isCached) {
        this.toastService.show(
          `Internet connection required to download '${summary.name}' for the first time.`,
          'warning'
        );
        return false;
      }
    }

    this._activeRouteId.set(routeId);
    this._activeRouteSummary.set(summary);
    return true;
  }
}
