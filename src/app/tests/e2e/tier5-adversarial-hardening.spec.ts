import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteManifestService, syncRouteKeyToUrl } from '../../services/route-manifest.service';
import { RouteDataService } from '../../services/route-data.service';
import { OfflineStorageService } from '../../services/offline-storage.service';
import {
  TileCacheService,
  lat2tile,
  lon2tile,
  tile2lat,
  tile2lon,
  getTileUrlsForCoordinate
} from '../../services/tile-cache.service';
import { NetworkStatusService } from '../../services/network-status.service';
import { ToastService } from '../../services/toast.service';
import { EtaPhysicsService } from '../../services/eta-physics.service';
import { SettingsService } from '../../services/settings.service';
import { RouteSummary, RouteDataPackage } from '../../models/route.model';

describe('Tier 5: Adversarial Coverage Hardening (White-Box Failure Modes & Stress Verification)', () => {
  let manifestService: RouteManifestService;
  let routeDataService: RouteDataService;
  let offlineStorage: OfflineStorageService;
  let tileCache: TileCacheService;
  let networkStatus: NetworkStatusService;
  let toastService: ToastService;
  let etaPhysics: EtaPhysicsService;
  let settingsService: SettingsService;
  let httpMock: HttpTestingController;

  const mockRouteSummary: RouteSummary = {
    id: 'tour-divide-2025',
    name: 'Tour Divide 2025',
    shortName: 'TD',
    badge: 'TD',
    totalDistanceMiles: 2679.2,
    totalDistanceKm: 4311.8,
    elevationGainFt: 149600,
    elevationGainM: 45600,
    startLocation: 'Banff, AB',
    endLocation: 'Antelope Wells, NM',
    iconicCheckpoints: ['Banff', 'Antelope Wells'],
    description: 'Tour Divide route',
    startCoordinates: [51.16, -115.56],
    bounds: [
      [31.33, -115.56],
      [51.16, -108.53]
    ]
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RouteManifestService,
        RouteDataService,
        OfflineStorageService,
        TileCacheService,
        NetworkStatusService,
        ToastService,
        EtaPhysicsService,
        SettingsService
      ]
    });

    manifestService = TestBed.inject(RouteManifestService);
    routeDataService = TestBed.inject(RouteDataService);
    offlineStorage = TestBed.inject(OfflineStorageService);
    tileCache = TestBed.inject(TileCacheService);
    networkStatus = TestBed.inject(NetworkStatusService);
    toastService = TestBed.inject(ToastService);
    etaPhysics = TestBed.inject(EtaPhysicsService);
    settingsService = TestBed.inject(SettingsService);
    httpMock = TestBed.inject(HttpTestingController);

    networkStatus.setOnline(true);
    toastService.clear();
  });

  afterEach(async () => {
    httpMock.verify();
    TestBed.resetTestingModule();
    localStorage.clear();
    await offlineStorage.clearAll();
    await tileCache.clearTileCache();
  });

  // ==========================================================================
  // 1. URL Query Parameter Tampering & Path Manipulation
  // ==========================================================================
  describe('1. URL Query Parameter Tampering & Path Manipulation', () => {
    it('1.1 should safely handle malicious script tags in route selection without XSS or crashing', async () => {
      manifestService.availableRoutes.set([mockRouteSummary]);
      const maliciousPayload = '<script>alert("xss")</script>';

      const success = await manifestService.selectRoute(maliciousPayload, false);
      expect(success).toBe(false);
      expect(manifestService.activeRouteId()).toBeNull();

      const toasts = toastService.activeToasts();
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe('warning');
      expect(toasts[0].message).toContain('not recognized');
    });

    it('1.2 should treat empty string route key as null (navigating to welcome screen)', async () => {
      manifestService.availableRoutes.set([mockRouteSummary]);
      await manifestService.selectRoute('tour-divide-2025', false);
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');

      // Empty string should unload route
      const success = await manifestService.selectRoute('', false);
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBeNull();
      expect(settingsService.selectedRouteKey()).toBeNull();
    });

    it('1.3 should reject directory traversal attempts in route key', async () => {
      manifestService.availableRoutes.set([mockRouteSummary]);
      const traversalKeys = [
        '../../etc/passwd',
        '..%2F..%2Fdata',
        '../../../secret.json',
        '/data/routes/tour-divide-2025'
      ];

      for (const key of traversalKeys) {
        const success = await manifestService.selectRoute(key, false);
        expect(success).toBe(false);
        expect(manifestService.activeRouteId()).toBeNull();
      }
    });

    it('1.4 should handle URL null byte and control character injections safely', async () => {
      manifestService.availableRoutes.set([mockRouteSummary]);
      const nullByteKeys = ['tour-divide-2025\0.json', 'colorado-trail%00', '\n\r'];

      for (const key of nullByteKeys) {
        const success = await manifestService.selectRoute(key, false);
        expect(success).toBe(false);
        expect(manifestService.activeRouteId()).toBeNull();
      }
    });

    it('1.5 should handle syncRouteKeyToUrl with null, empty, or special characters without throwing', () => {
      expect(() => {
        syncRouteKeyToUrl(null);
        syncRouteKeyToUrl('');
        syncRouteKeyToUrl('valid-route');
        syncRouteKeyToUrl('<script>alert(1)</script>');
        syncRouteKeyToUrl('route with spaces');
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // 2. Route Manifest Corruption & Missing Fields
  // ==========================================================================
  describe('2. Route Manifest Corruption & Missing Fields', () => {
    it('2.1 should handle 404 Not Found response when loading manifest', () => {
      let emitted: RouteSummary[] | undefined;
      manifestService.loadManifest().subscribe((routes) => {
        emitted = routes;
      });

      const req = httpMock.expectOne('/data/routes.json');
      req.flush('File not found', { status: 404, statusText: 'Not Found' });

      expect(emitted).toEqual([]);
      expect(manifestService.availableRoutes().length).toBe(0);
      expect(manifestService.manifestError()).toBe('Failed to load available routes manifest.');
      expect(manifestService.isManifestLoading()).toBe(false);
    });

    it('2.2 should handle 500 Server Error when loading manifest', () => {
      let emitted: RouteSummary[] | undefined;
      manifestService.loadManifest().subscribe((routes) => {
        emitted = routes;
      });

      const req = httpMock.expectOne('/data/routes.json');
      req.flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

      expect(emitted).toEqual([]);
      expect(manifestService.manifestError()).toBeTruthy();
      expect(manifestService.isManifestLoading()).toBe(false);
    });

    it('2.3 should parse manifest formatted directly as array or as { routes: [...] }', () => {
      // Format A: Direct array
      manifestService.loadManifest().subscribe((routes) => {
        expect(routes.length).toBe(1);
      });
      httpMock.expectOne('/data/routes.json').flush([mockRouteSummary]);
      expect(manifestService.availableRoutes().length).toBe(1);

      // Format B: Wrapped object { routes: [...] }
      manifestService.loadManifest().subscribe((routes) => {
        expect(routes.length).toBe(1);
      });
      httpMock.expectOne('/data/routes.json').flush({ routes: [mockRouteSummary] });
      expect(manifestService.availableRoutes().length).toBe(1);
    });

    it('2.4 should handle corrupted manifest payload (empty object or null routes) gracefully', () => {
      manifestService.loadManifest().subscribe((routes) => {
        expect(routes.length).toBe(0);
      });
      httpMock.expectOne('/data/routes.json').flush({});
      expect(manifestService.availableRoutes().length).toBe(0);
      expect(manifestService.manifestError()).toBeNull();
      expect(manifestService.isManifestLoading()).toBe(false);
    });

    it('2.5 should handle route summary with missing optional fields without throwing in activeRouteSummary', () => {
      const minimalRoute: any = {
        id: 'minimal-trail',
        name: 'Minimal Trail'
      };
      manifestService.availableRoutes.set([minimalRoute]);
      manifestService.selectRoute('minimal-trail', false);

      expect(manifestService.activeRouteId()).toBe('minimal-trail');
      const summary = manifestService.activeRouteSummary();
      expect(summary).toBeTruthy();
      expect(summary?.name).toBe('Minimal Trail');
      expect(summary?.totalDistanceMiles).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. Offline Storage Failures & Corrupted Cached Packages
  // ==========================================================================
  describe('3. Offline Storage Failures & Corrupted Cached Packages', () => {
    it('3.1 should isolate in-memory copy so retrieved package mutations do not mutate cache', async () => {
      const pkg: RouteDataPackage = {
        routeId: 'tour-divide-2025',
        track: { total_km: 100, total_miles: 62.1, points: [[51, -115, 1400, 0, 0]] },
        places: [{ id: 'p1', name: 'Original Name', route_mile: 0, category: 'town', type: 'town', location: { lat: 51, lon: -115 }, distance_to_trail_km: 0, route_km: 0, is_in_town: true }],
        surfaces: [],
        climbs: [],
        passes: [],
        milestones: [],
        cachedAt: Date.now()
      };

      await offlineStorage.saveRoutePackage(pkg);
      const retrieved = await offlineStorage.getRoutePackage('tour-divide-2025');
      expect(retrieved).not.toBeNull();

      // Mutate retrieved copy
      retrieved!.places[0].name = 'Mutated Name';
      retrieved!.track.total_miles = 9999;

      // Re-fetch from storage
      const secondFetch = await offlineStorage.getRoutePackage('tour-divide-2025');
      expect(secondFetch?.places[0].name).toBe('Original Name');
      expect(secondFetch?.track.total_miles).toBe(62.1);
    });

    it('3.2 should return null when querying un-cached or non-existent routeId in storage', async () => {
      expect(await offlineStorage.getRoutePackage('non-existent')).toBeNull();
      expect(await offlineStorage.isRouteCached('non-existent')).toBe(false);
      expect(offlineStorage.isRouteCachedSync('non-existent')).toBe(false);
    });

    it('3.3 should handle removing non-existent route package gracefully without error', async () => {
      await expect(offlineStorage.removeRoutePackage('ghost-route')).resolves.not.toThrow();
    });

    it('3.4 should support saving and querying multiple distinct route packages concurrently', async () => {
      const pkg1: RouteDataPackage = {
        routeId: 'route-1',
        track: { total_km: 100, total_miles: 60, points: [] },
        places: [],
        surfaces: [],
        climbs: [],
        passes: [],
        milestones: [],
        cachedAt: Date.now()
      };
      const pkg2: RouteDataPackage = {
        routeId: 'route-2',
        track: { total_km: 200, total_miles: 120, points: [] },
        places: [],
        surfaces: [],
        climbs: [],
        passes: [],
        milestones: [],
        cachedAt: Date.now()
      };

      await Promise.all([
        offlineStorage.saveRoutePackage(pkg1),
        offlineStorage.saveRoutePackage(pkg2)
      ]);

      const ids = await offlineStorage.getCachedRouteIds();
      expect(ids).toContain('route-1');
      expect(ids).toContain('route-2');
      expect(await offlineStorage.isRouteCached('route-1')).toBe(true);
      expect(await offlineStorage.isRouteCached('route-2')).toBe(true);
    });

    it('3.5 should safely apply corrupted cached package with null track points in RouteDataService', async () => {
      const corruptPkg: RouteDataPackage = {
        routeId: 'corrupt-route',
        track: null as any,
        places: null as any,
        surfaces: null as any,
        climbs: null as any,
        passes: null as any,
        milestones: null as any,
        cachedAt: Date.now()
      };

      await offlineStorage.saveRoutePackage(corruptPkg);
      networkStatus.setOnline(false);

      expect(() => {
        routeDataService.loadRoute('corrupt-route');
      }).not.toThrow();

      await new Promise((r) => setTimeout(r, 20));

      expect(routeDataService.places()).toEqual([]);
      expect(routeDataService.trackPoints()).toEqual([]);
      expect(routeDataService.isLoading()).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Network Status Flapping & Active Download Interruption
  // ==========================================================================
  describe('4. Network Status Flapping & Active Download Interruption', () => {
    it('4.1 should fallback to offline storage when online HTTP fetch encounters 500 error', async () => {
      // Pre-cache package in offline storage
      await offlineStorage.saveRoutePackage({
        routeId: 'tour-divide-2025',
        track: { total_km: 4311.8, total_miles: 2679.2, points: [[51, -115, 1400, 0, 0]] },
        places: [{ id: 'p1', name: 'Banff', route_mile: 0, category: 'town', type: 'town', location: { lat: 51, lon: -115 }, distance_to_trail_km: 0, route_km: 0, is_in_town: true }],
        surfaces: [],
        climbs: [],
        passes: [],
        milestones: [],
        cachedAt: Date.now()
      });

      networkStatus.setOnline(true);
      routeDataService.loadRoute('tour-divide-2025');

      const reqs = httpMock.match((r) => r.url.startsWith('/data/routes/tour-divide-2025/'));
      for (const req of reqs) {
        if (!req.cancelled) {
          req.flush('Server error', { status: 500, statusText: 'Error' });
        }
      }

      await new Promise((r) => setTimeout(r, 20));

      // Successfully fell back to offline storage!
      expect(routeDataService.places().length).toBe(1);
      expect(routeDataService.places()[0].name).toBe('Banff');
      expect(routeDataService.isLoading()).toBe(false);
      expect(routeDataService.error()).toBeNull();
    });

    it('4.2 should report error when online fetch fails and route is not cached offline', async () => {
      networkStatus.setOnline(true);
      routeDataService.loadRoute('uncached-route');

      const reqs = httpMock.match((r) => r.url.startsWith('/data/routes/uncached-route/'));
      for (const req of reqs) {
        if (!req.cancelled) {
          req.flush('Not found', { status: 404, statusText: 'Not Found' });
        }
      }

      await new Promise((r) => setTimeout(r, 20));

      expect(routeDataService.error()).toContain('Failed to load route data for uncached-route');
      expect(routeDataService.isLoading()).toBe(false);
      expect(routeDataService.isTrackLoading()).toBe(false);
    });

    it('4.3 should cancel in-flight HTTP requests when network drops or route is unloaded', () => {
      routeDataService.loadRoute('tour-divide-2025');

      const reqs = httpMock.match((r) => r.url.startsWith('/data/routes/tour-divide-2025/'));
      expect(reqs.length).toBe(6);
      expect(reqs[0].cancelled).toBe(false);

      // Trigger unload
      routeDataService.unloadRoute();

      expect(reqs[0].cancelled).toBe(true);
      expect(routeDataService.activeRouteId()).toBeNull();
      expect(routeDataService.isLoading()).toBe(false);
    });

    it('4.4 should toggle network online/offline state reactively without leaking listeners', () => {
      expect(networkStatus.isOnline()).toBe(true);
      expect(networkStatus.isOffline()).toBe(false);

      networkStatus.setOnline(false);
      expect(networkStatus.isOnline()).toBe(false);
      expect(networkStatus.isOffline()).toBe(true);

      networkStatus.setOnline(true);
      expect(networkStatus.isOnline()).toBe(true);
      expect(networkStatus.isOffline()).toBe(false);
    });
  });

  // ==========================================================================
  // 5. Map Tile Coordinate Extremes & Slippy Bounds
  // ==========================================================================
  describe('5. Map Tile Coordinate Extremes & Slippy Bounds', () => {
    it('5.1 should compute valid tile coordinates at extreme latitudes without crashing', () => {
      // 0 latitude (equator)
      const yEquator = lat2tile(0, 5);
      expect(yEquator).toBe(16);

      // Near Web Mercator limit (~85.05 degrees)
      const yNorth = lat2tile(85.0, 5);
      expect(yNorth).toBe(0);

      const ySouth = lat2tile(-85.0, 5);
      expect(ySouth).toBe(31);

      // Polar extremes (clamped safely between 0 and 2^z - 1)
      const y89 = lat2tile(89.0, 5);
      expect(y89).toBeGreaterThanOrEqual(0);
      expect(y89).toBeLessThanOrEqual(31);

      const yMinus89 = lat2tile(-89.0, 5);
      expect(yMinus89).toBeGreaterThanOrEqual(0);
      expect(yMinus89).toBeLessThanOrEqual(31);
    });

    it('5.2 should compute valid longitude tiles at international date line / anti-meridian', () => {
      const xWest = lon2tile(-180, 5);
      expect(xWest).toBe(0);

      const xEast = lon2tile(179.9999, 5);
      expect(xEast).toBe(31);

      const xZero = lon2tile(0, 5);
      expect(xZero).toBe(16);
    });

    it('5.3 should enforce LRU eviction bound in TileCacheService memory map (max 1000 tiles)', () => {
      const mockResp = new Response(new Uint8Array([1, 2, 3]), { status: 200 });

      // Insert 1050 unique tiles into in-memory store
      for (let i = 0; i < 1050; i++) {
        (tileCache as any).setInMemoryTile(`https://tile.test/${i}`, mockResp.clone());
      }

      // In-memory store must be bounded at 1000
      expect((tileCache as any).inMemoryTileMap.size).toBe(1000);

      // Oldest tiles (0 to 49) must have been evicted
      expect((tileCache as any).inMemoryTileMap.has('https://tile.test/0')).toBe(false);
      expect((tileCache as any).inMemoryTileMap.has('https://tile.test/49')).toBe(false);

      // Newer tiles must be retained
      expect((tileCache as any).inMemoryTileMap.has('https://tile.test/1049')).toBe(true);
    });

    it('5.4 should handle empty point list in cacheCorridorTiles without error', async () => {
      const count = await tileCache.cacheCorridorTiles([], 5, 10);
      expect(count).toBe(0);
    });

    it('5.5 should handle inverted route summary bounds without infinite loops', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

      // Inverted bounds where south > north, east < west
      const invertedSummary: RouteSummary = {
        ...mockRouteSummary,
        bounds: [
          [51.16, -108.53], // inverted
          [31.33, -115.56]
        ]
      };

      const count = await tileCache.cacheTilesForRoute(invertedSummary, 5, 5);
      expect(count).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 6. ETA Physics Edge Cases & Missing Datasets
  // ==========================================================================
  describe('6. ETA Physics Edge Cases & Missing Datasets', () => {
    it('6.1 should return 0 ETA seconds when startMile equals targetMile', () => {
      expect(etaPhysics.calculateEtaSeconds(50.0, 50.0)).toBe(0);
      expect(etaPhysics.calculateEtaSeconds(0.0, 0.0)).toBe(0);
    });

    it('6.2 should return 0 ETA seconds when targetMile is behind startMile (backtracking)', () => {
      expect(etaPhysics.calculateEtaSeconds(100.0, 50.0)).toBe(0);
    });

    it('6.3 should compute valid ETA in power mode even when surface intervals are completely missing', () => {
      settingsService.paceMode.set('power');
      settingsService.riderPowerWatts.set(150);

      etaPhysics.setTrackPoints([
        [51.0, -115.0, 1000.0, 0.0, 0.0],
        [50.9, -115.0, 1100.0, 10.0, 6.214],
        [50.8, -115.0, 1200.0, 20.0, 12.428]
      ]);
      // Surface intervals intentionally empty
      etaPhysics.setSurfaceIntervals([]);

      const etaSeconds = etaPhysics.calculateEtaSeconds(0.0, 10.0);
      expect(etaSeconds).toBeGreaterThan(0);
      expect(Number.isFinite(etaSeconds)).toBe(true);
      expect(Number.isNaN(etaSeconds)).toBe(false);
    });

    it('6.4 should compute valid ETA in power mode even when track points are completely missing (fallback)', () => {
      settingsService.paceMode.set('power');
      settingsService.riderPowerWatts.set(150);

      etaPhysics.setTrackPoints([]);
      etaPhysics.setSurfaceIntervals([]);

      // Should fall back to speed-based calculation without crashing or NaN
      const etaSeconds = etaPhysics.calculateEtaSeconds(0.0, 10.0);
      expect(etaSeconds).toBeGreaterThan(0);
      expect(Number.isFinite(etaSeconds)).toBe(true);
      expect(Number.isNaN(etaSeconds)).toBe(false);
    });

    it('6.5 should compute getClimbPhysicsStats correctly for zero or negative climb lengths', () => {
      const zeroStats = etaPhysics.getClimbPhysicsStats(10.0, 10.0);
      expect(zeroStats.estimatedSeconds).toBe(0);
      expect(zeroStats.hikeBikeDistanceKm).toBe(0);

      const negStats = etaPhysics.getClimbPhysicsStats(20.0, 10.0);
      expect(negStats.estimatedSeconds).toBe(0);
      expect(negStats.hikeBikeDistanceKm).toBe(0);
    });

    it('6.6 should handle 0W rider power without division by zero or infinite loop', () => {
      // 0W power on flat ground: should return minimal riding speed (0.1 km/h)
      const speedFlat = etaPhysics.solveRidingSpeed(0, 0.0, 0.016, 85.0);
      expect(speedFlat).toBeGreaterThanOrEqual(0.1);
      expect(Number.isFinite(speedFlat)).toBe(true);

      // 0W power on steep descent (-8%): coasting at terminal speed capped safely
      const speedDescent = etaPhysics.solveRidingSpeed(0, -0.08, 0.016, 85.0);
      expect(speedDescent).toBeGreaterThan(20.0);
      expect(speedDescent).toBeLessThanOrEqual(42.0);
      expect(Number.isFinite(speedDescent)).toBe(true);
    });

    it('6.7 should handle extreme system weights (40 kg to 250 kg) without NaN', () => {
      const speeds = [40, 75, 120, 200, 250].map((mass) =>
        etaPhysics.solveRidingSpeed(150, 0.05, 0.016, mass)
      );

      for (const spd of speeds) {
        expect(spd).toBeGreaterThan(0.5);
        expect(Number.isFinite(spd)).toBe(true);
      }

      // Heavier rider goes slower on climb
      expect(speeds[0]).toBeGreaterThan(speeds[speeds.length - 1]);
    });
  });
});
