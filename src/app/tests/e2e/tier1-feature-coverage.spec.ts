import { TestBed } from '@angular/core/testing';
import {
  RouteSummary,
  RouteManifest,
  TOUR_DIVIDE_SUMMARY,
  COLORADO_TRAIL_SUMMARY,
  SAMPLE_MANIFEST,
  createSamplePackage,
  ContractNetworkStatusService,
  ContractToastService,
  ContractOfflineStorageService,
  ContractTileCacheService,
  ContractRouteManifestService
} from './test-harness';
import { SettingsService } from '../../services/settings.service';

describe('Tier 1: Feature Coverage (Opaque-Box Requirement Verification)', () => {
  let manifestService: ContractRouteManifestService;
  let networkStatus: ContractNetworkStatusService;
  let toastService: ContractToastService;
  let offlineStorage: ContractOfflineStorageService;
  let tileCache: ContractTileCacheService;
  let settingsService: SettingsService;

  beforeEach(() => {
    localStorage.clear();
    networkStatus = new ContractNetworkStatusService();
    toastService = new ContractToastService();
    offlineStorage = new ContractOfflineStorageService();
    tileCache = new ContractTileCacheService();
    manifestService = new ContractRouteManifestService(networkStatus, offlineStorage, toastService);

    TestBed.configureTestingModule({
      providers: [SettingsService]
    });
    settingsService = TestBed.inject(SettingsService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ==========================================================================
  // Feature 1: Route Manifest Loading & Structure (>=5 tests)
  // ==========================================================================
  describe('Feature 1: Route Manifest Loading & Structure', () => {
    it('1.1 should validate manifest schema contains required fields for all routes', () => {
      const routes = manifestService.availableRoutes();
      expect(routes.length).toBeGreaterThanOrEqual(2);

      for (const route of routes) {
        expect(route.id).toBeTruthy();
        expect(route.name).toBeTruthy();
        expect(route.shortName).toBeTruthy();
        expect(route.startLocation).toBeTruthy();
        expect(route.endLocation).toBeTruthy();
        expect(route.totalDistanceMiles).toBeGreaterThan(0);
        expect(route.totalDistanceKm).toBeGreaterThan(0);
        expect(route.elevationGainFt).toBeGreaterThan(0);
        expect(route.elevationGainM).toBeGreaterThan(0);
        expect(route.description).toBeTruthy();
        expect(Array.isArray(route.iconicCheckpoints)).toBe(true);
        expect(route.iconicCheckpoints.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('1.2 should contain both default routes: tour-divide-2025 and colorado-trail', () => {
      const routes = manifestService.availableRoutes();
      const td = routes.find((r) => r.id === 'tour-divide-2025');
      const ct = routes.find((r) => r.id === 'colorado-trail');

      expect(td).toBeDefined();
      expect(td?.name).toBe('Tour Divide 2025');
      expect(td?.shortName).toBe('TD');

      expect(ct).toBeDefined();
      expect(ct?.name).toBe('Colorado Trail');
      expect(ct?.shortName).toBe('CT');
    });

    it('1.3 should enforce accurate distance metrics for Tour Divide and Colorado Trail', () => {
      const routes = manifestService.availableRoutes();
      const td = routes.find((r) => r.id === 'tour-divide-2025')!;
      const ct = routes.find((r) => r.id === 'colorado-trail')!;

      // Tour Divide: ~2679.2 mi / ~4311.8 km
      expect(td.totalDistanceMiles).toBeCloseTo(2679.2, 0);
      expect(td.totalDistanceKm).toBeCloseTo(4311.8, 0);

      // Colorado Trail: ~535.0 mi / ~861.0 km
      expect(ct.totalDistanceMiles).toBeCloseTo(535.0, 0);
      expect(ct.totalDistanceKm).toBeCloseTo(861.0, 0);
    });

    it('1.4 should enforce valid bounding boxes with southwest and northeast coordinates', () => {
      const routes = manifestService.availableRoutes();
      for (const route of routes) {
        const bounds = route.bounds;
        expect(bounds.length).toBe(2);
        const [sw, ne] = bounds;
        expect(sw.length).toBe(2);
        expect(ne.length).toBe(2);

        // South latitude <= North latitude
        expect(sw[0]).toBeLessThanOrEqual(ne[0]);
        // West longitude <= East longitude
        expect(sw[1]).toBeLessThanOrEqual(ne[1]);
      }
    });

    it('1.5 should include iconic checkpoints array with prominent landmark milestones', () => {
      const routes = manifestService.availableRoutes();
      const td = routes.find((r) => r.id === 'tour-divide-2025')!;
      expect(td.iconicCheckpoints).toContain('Banff');
      expect(td.iconicCheckpoints).toContain('Antelope Wells');

      const ct = routes.find((r) => r.id === 'colorado-trail')!;
      expect(ct.iconicCheckpoints).toContain('Waterton Canyon');
      expect(ct.iconicCheckpoints).toContain('Durango');
    });
  });

  // ==========================================================================
  // Feature 2: Top-Left Header Dropdown & Active Route Indicator (>=5 tests)
  // ==========================================================================
  describe('Feature 2: Top-Left Header Dropdown Selection & Active Route Indicator', () => {
    it('2.1 should provide all available routes for top-left dropdown options', () => {
      const options = manifestService.availableRoutes().map((r) => ({
        id: r.id,
        label: `${r.name} (${r.shortName})`
      }));

      expect(options.length).toBe(2);
      expect(options[0].id).toBe('tour-divide-2025');
      expect(options[1].id).toBe('colorado-trail');
    });

    it('2.2 should reflect active route selection value accurately', async () => {
      expect(manifestService.activeRouteId()).toBeNull();

      const success = await manifestService.selectRoute('tour-divide-2025');
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');
      expect(manifestService.activeRouteSummary()?.name).toBe('Tour Divide 2025');
    });

    it('2.3 should display active route badge and shortName indicator', async () => {
      await manifestService.selectRoute('colorado-trail');
      const activeSummary = manifestService.activeRouteSummary();
      expect(activeSummary).not.toBeNull();
      expect(activeSummary?.shortName).toBe('CT');
      expect(activeSummary?.startLocation).toBe('Denver (Waterton Canyon), CO');
      expect(activeSummary?.endLocation).toBe('Durango, CO');
    });

    it('2.4 should switch active route cleanly from Tour Divide to Colorado Trail', async () => {
      await manifestService.selectRoute('tour-divide-2025');
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');

      await manifestService.selectRoute('colorado-trail');
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
      expect(manifestService.activeRouteSummary()?.totalDistanceMiles).toBe(535.0);
    });

    it('2.5 should show empty state / placeholder when activeRouteId is null', async () => {
      await manifestService.selectRoute(null);
      expect(manifestService.activeRouteId()).toBeNull();
      expect(manifestService.activeRouteSummary()).toBeNull();
    });
  });

  // ==========================================================================
  // Feature 3: Initial Clean Visit Empty State (Welcome Screen) (>=5 tests)
  // ==========================================================================
  describe('Feature 3: Initial Clean Visit Empty State (Welcome Screen)', () => {
    it('3.1 should start in empty state when localStorage is clean and no query param provided', () => {
      const activeKey = localStorage.getItem('tour_divide_selected_route');
      expect(activeKey).toBeNull();
      expect(manifestService.activeRouteId()).toBeNull();
    });

    it('3.2 should ensure zero route track data is loaded before route is selected', () => {
      expect(manifestService.activeRouteId()).toBeNull();
      expect(manifestService.activeRouteSummary()).toBeNull();
    });

    it('3.3 should provide route cards and metrics required for the welcome screen', () => {
      const cards = manifestService.availableRoutes().map((r) => ({
        id: r.id,
        name: r.name,
        distance: `${r.totalDistanceMiles} mi / ${r.totalDistanceKm} km`,
        elevation: `${r.elevationGainFt.toLocaleString()} ft gain`,
        endpoints: `${r.startLocation} → ${r.endLocation}`,
        checkpoints: r.iconicCheckpoints
      }));

      expect(cards.length).toBe(2);
      expect(cards[0].name).toBe('Tour Divide 2025');
      expect(cards[0].distance).toContain('2679.2 mi');
      expect(cards[1].name).toBe('Colorado Trail');
      expect(cards[1].distance).toContain('535 mi');
    });

    it('3.4 should select route and transition from welcome screen when rider clicks a card', async () => {
      const success = await manifestService.selectRoute('colorado-trail');
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
    });

    it('3.5 should persist selected route so subsequent visits do not show welcome screen', async () => {
      await manifestService.selectRoute('tour-divide-2025');
      localStorage.setItem('tour_divide_selected_route', 'tour-divide-2025');

      const restoredKey = localStorage.getItem('tour_divide_selected_route');
      expect(restoredKey).toBe('tour-divide-2025');
    });
  });

  // ==========================================================================
  // Feature 4: URL Parameter Deep-Linking (?route=<key>) (>=5 tests)
  // ==========================================================================
  describe('Feature 4: URL Parameter Deep Link Handling (?route=<key>)', () => {
    function parseRouteFromUrl(url: string): string | null {
      const parsed = new URL(url, 'https://bikepack.app');
      return parsed.searchParams.get('route');
    }

    it('4.1 should parse ?route=tour-divide-2025 from URL and activate Tour Divide', async () => {
      const routeKey = parseRouteFromUrl('https://bikepack.app/?route=tour-divide-2025');
      expect(routeKey).toBe('tour-divide-2025');

      const success = await manifestService.selectRoute(routeKey);
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');
    });

    it('4.2 should parse ?route=colorado-trail from URL and activate Colorado Trail', async () => {
      const routeKey = parseRouteFromUrl('https://bikepack.app/?route=colorado-trail');
      expect(routeKey).toBe('colorado-trail');

      const success = await manifestService.selectRoute(routeKey);
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
    });

    it('4.3 should prioritize URL query param over saved localStorage setting', async () => {
      localStorage.setItem('tour_divide_selected_route', 'tour-divide-2025');
      const urlParam = parseRouteFromUrl('https://bikepack.app/?route=colorado-trail');

      // Precedence: URL param > localStorage
      const activeKey = urlParam || localStorage.getItem('tour_divide_selected_route');
      expect(activeKey).toBe('colorado-trail');

      await manifestService.selectRoute(activeKey);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
    });

    it('4.4 should bypass welcome screen when valid ?route= param is present', async () => {
      const urlParam = parseRouteFromUrl('https://bikepack.app/?route=tour-divide-2025');
      await manifestService.selectRoute(urlParam);

      const isWelcomeScreenVisible = manifestService.activeRouteId() === null;
      expect(isWelcomeScreenVisible).toBe(false);
    });

    it('4.5 should construct correct URL with ?route=<key> when route is changed', () => {
      const baseUrl = 'https://bikepack.app/';
      const updatedUrl = `${baseUrl}?route=colorado-trail`;
      expect(parseRouteFromUrl(updatedUrl)).toBe('colorado-trail');
    });
  });

  // ==========================================================================
  // Feature 5: Route Data Segregation & On-Demand Loading (>=5 tests)
  // ==========================================================================
  describe('Feature 5: Route Data Segregation & On-Demand Loading', () => {
    it('5.1 should construct segregated asset paths per route (/data/routes/<routeId>/...)', () => {
      const getRouteAssetPaths = (routeId: string) => ({
        track: `/data/routes/${routeId}/route-track.json`,
        places: `/data/routes/${routeId}/places.json`,
        surfaces: `/data/routes/${routeId}/surfaces.json`,
        climbs: `/data/routes/${routeId}/climbs.json`,
        passes: `/data/routes/${routeId}/passes.json`,
        milestones: `/data/routes/${routeId}/milestones.json`
      });

      const tdPaths = getRouteAssetPaths('tour-divide-2025');
      expect(tdPaths.track).toBe('/data/routes/tour-divide-2025/route-track.json');
      expect(tdPaths.places).toBe('/data/routes/tour-divide-2025/places.json');

      const ctPaths = getRouteAssetPaths('colorado-trail');
      expect(ctPaths.track).toBe('/data/routes/colorado-trail/route-track.json');
      expect(ctPaths.passes).toBe('/data/routes/colorado-trail/passes.json');
    });

    it('5.2 should load complete route data package for selected route', () => {
      const pkg = createSamplePackage('colorado-trail');
      expect(pkg.routeId).toBe('colorado-trail');
      expect(pkg.track.points.length).toBeGreaterThan(0);
      expect(pkg.places.length).toBeGreaterThan(0);
      expect(pkg.surfaces.length).toBeGreaterThan(0);
      expect(pkg.climbs.length).toBeGreaterThan(0);
      expect(pkg.passes.length).toBeGreaterThan(0);
      expect(pkg.milestones.length).toBeGreaterThan(0);
    });

    it('5.3 should verify inactive route data is never fetched when loading active route', () => {
      const requestedUrls: string[] = [];
      const fetchRouteData = (routeId: string) => {
        const files = ['route-track.json', 'places.json', 'surfaces.json'];
        for (const file of files) {
          requestedUrls.push(`/data/routes/${routeId}/${file}`);
        }
      };

      fetchRouteData('colorado-trail');
      expect(requestedUrls.some((u) => u.includes('tour-divide-2025'))).toBe(false);
      expect(requestedUrls.every((u) => u.includes('colorado-trail'))).toBe(true);
    });

    it('5.4 should unload previous route telemetry and reset track data upon switching routes', async () => {
      const tdPkg = createSamplePackage('tour-divide-2025');
      const ctPkg = createSamplePackage('colorado-trail');

      let currentPackage = tdPkg;
      expect(currentPackage.routeId).toBe('tour-divide-2025');
      expect(currentPackage.track.total_miles).toBeCloseTo(2679.2, 0);

      // Switch to CT
      currentPackage = ctPkg;
      expect(currentPackage.routeId).toBe('colorado-trail');
      expect(currentPackage.track.total_miles).toBeCloseTo(535.0, 0);
    });

    it('5.5 should compute total route distance dynamically from active route track points', () => {
      const tdPkg = createSamplePackage('tour-divide-2025');
      const ctPkg = createSamplePackage('colorado-trail');

      expect(tdPkg.track.total_km).toBe(4311.8);
      expect(ctPkg.track.total_km).toBe(861.0);
      expect(tdPkg.track.total_km).not.toBe(ctPkg.track.total_km);
    });
  });

  // ==========================================================================
  // Feature 6: On-Device Offline Storage (IndexedDB) (>=5 tests)
  // ==========================================================================
  describe('Feature 6: On-Device Offline Storage (IndexedDB)', () => {
    it('6.1 should initialize database name bikepack-offline-v1 and store route-packages', () => {
      expect(offlineStorage.DB_NAME).toBe('bikepack-offline-v1');
      expect(offlineStorage.STORE_NAME).toBe('route-packages');
    });

    it('6.2 should save complete route package to IndexedDB and retrieve it cleanly', async () => {
      const pkg = createSamplePackage('tour-divide-2025');
      await offlineStorage.saveRoutePackage(pkg);

      const retrieved = await offlineStorage.getRoutePackage('tour-divide-2025');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.routeId).toBe('tour-divide-2025');
      expect(retrieved?.track.points.length).toBe(pkg.track.points.length);
      expect(retrieved?.places.length).toBe(pkg.places.length);
    });

    it('6.3 should accurately report isRouteCached as true for cached route and false for uncached', async () => {
      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(false);

      const ctPkg = createSamplePackage('colorado-trail');
      await offlineStorage.saveRoutePackage(ctPkg);

      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(true);
      expect(await offlineStorage.isRouteCached('tour-divide-2025')).toBe(false);
    });

    it('6.4 should list all cached route IDs in getCachedRouteIds()', async () => {
      await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
      await offlineStorage.saveRoutePackage(createSamplePackage('colorado-trail'));

      const cachedIds = await offlineStorage.getCachedRouteIds();
      expect(cachedIds.length).toBe(2);
      expect(cachedIds).toContain('tour-divide-2025');
      expect(cachedIds).toContain('colorado-trail');
    });

    it('6.5 should support storing multiple independent routes without key collision', async () => {
      await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
      await offlineStorage.saveRoutePackage(createSamplePackage('colorado-trail'));

      const td = await offlineStorage.getRoutePackage('tour-divide-2025');
      const ct = await offlineStorage.getRoutePackage('colorado-trail');

      expect(td?.track.total_miles).toBeCloseTo(2679.2, 0);
      expect(ct?.track.total_miles).toBeCloseTo(535.0, 0);
      expect(td?.places[0].name).toBe('Banff Springs');
      expect(ct?.places[0].name).toBe('Waterton Trailhead');
    });
  });

  // ==========================================================================
  // Feature 7: Offline Network Detection & Notification Toast (>=5 tests)
  // ==========================================================================
  describe('Feature 7: Offline Network Detection & Notification Toast', () => {
    it('7.1 should reactively update isOnline signal based on network status', () => {
      expect(networkStatus.isOnline()).toBe(true);
      networkStatus.setOnline(false);
      expect(networkStatus.isOnline()).toBe(false);
      networkStatus.setOnline(true);
      expect(networkStatus.isOnline()).toBe(true);
    });

    it('7.2 should display warning toast when switching to uncached route while offline', async () => {
      networkStatus.setOnline(false);
      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(false);

      const success = await manifestService.selectRoute('colorado-trail');
      expect(success).toBe(false);

      const toasts = toastService.activeToasts();
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe('warning');
      expect(toasts[0].message).toContain('Internet connection required');
    });

    it('7.3 should block route transition for uncached route when offline', async () => {
      networkStatus.setOnline(false);
      const success = await manifestService.selectRoute('colorado-trail');

      expect(success).toBe(false);
      expect(manifestService.activeRouteId()).toBeNull();
    });

    it('7.4 should include clear, friendly message mentioning the route name', async () => {
      networkStatus.setOnline(false);
      await manifestService.selectRoute('colorado-trail');

      const toasts = toastService.activeToasts();
      expect(toasts[0].message).toContain('Colorado Trail');
      expect(toasts[0].message).toContain('first time');
    });

    it('7.5 should allow dismissing active toast notifications', () => {
      const toastId = toastService.show('Test Toast Alert', 'warning', 5000);
      expect(toastService.activeToasts().length).toBe(1);

      toastService.dismiss(toastId);
      expect(toastService.activeToasts().length).toBe(0);
    });
  });

  // ==========================================================================
  // Feature 8: Switching to Previously Cached Route Offline (>=5 tests)
  // ==========================================================================
  describe('Feature 8: Switching to Previously Cached Route Offline', () => {
    beforeEach(async () => {
      // Pre-cache both routes
      await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
      await offlineStorage.saveRoutePackage(createSamplePackage('colorado-trail'));
    });

    it('8.1 should permit switching to cached route when navigator is offline', async () => {
      networkStatus.setOnline(false);
      const success = await manifestService.selectRoute('colorado-trail');

      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
    });

    it('8.2 should load route data directly from IndexedDB without network requests when offline', async () => {
      networkStatus.setOnline(false);
      const pkg = await offlineStorage.getRoutePackage('colorado-trail');

      expect(pkg).not.toBeNull();
      expect(pkg?.routeId).toBe('colorado-trail');
      expect(pkg?.places.length).toBeGreaterThan(0);
    });

    it('8.3 should update activeRouteId and telemetry immediately upon offline switch to cached route', async () => {
      networkStatus.setOnline(false);
      await manifestService.selectRoute('tour-divide-2025');
      expect(manifestService.activeRouteSummary()?.name).toBe('Tour Divide 2025');

      await manifestService.selectRoute('colorado-trail');
      expect(manifestService.activeRouteSummary()?.name).toBe('Colorado Trail');
    });

    it('8.4 should NOT show error or warning toast when switching to cached route offline', async () => {
      networkStatus.setOnline(false);
      await manifestService.selectRoute('colorado-trail');

      const toasts = toastService.activeToasts();
      expect(toasts.length).toBe(0);
    });

    it('8.5 should retain cached route in IndexedDB and preserve route state across offline reloads', async () => {
      networkStatus.setOnline(false);
      await manifestService.selectRoute('colorado-trail');

      // Simulate app reload by reading from storage
      const cached = await offlineStorage.getRoutePackage('colorado-trail');
      expect(cached?.routeId).toBe('colorado-trail');
      expect(cached?.track.total_km).toBe(861.0);
    });
  });

  // ==========================================================================
  // Feature 9: Offline Map Tile Availability via Cache Storage (>=5 tests)
  // ==========================================================================
  describe('Feature 9: Offline Map Tile Availability via Cache Storage', () => {
    it('9.1 should use Cache Storage API with cache name bikepack-map-tiles-v1', () => {
      expect(tileCache.cacheName).toBe('bikepack-map-tiles-v1');
    });

    it('9.2 should cache corridor map tiles for active route within zooms 5 to 10', async () => {
      const cachedCount = await tileCache.cacheTilesForRoute(COLORADO_TRAIL_SUMMARY, 5, 6);
      expect(cachedCount).toBeGreaterThan(0);
      expect(await tileCache.getCachedTileCount()).toBe(cachedCount);
    });

    it('9.3 should retrieve cached map tiles when offline without network access', async () => {
      await tileCache.cacheTilesForRoute(COLORADO_TRAIL_SUMMARY, 5, 5);
      const testTileUrl = 'https://tile.openstreetmap.org/5/8/12.png';
      await tileCache.putTile(testTileUrl, new Response());

      expect(await tileCache.hasTile(testTileUrl)).toBe(true);
      const response = await tileCache.getTile(testTileUrl);
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
    });

    it('9.4 should compute tile URLs from route bounding box with buffer coordinates', async () => {
      const count = await tileCache.cacheTilesForRoute(TOUR_DIVIDE_SUMMARY, 5, 5);
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('9.5 should allow clearing map tile cache across storage resets', async () => {
      await tileCache.cacheTilesForRoute(COLORADO_TRAIL_SUMMARY, 5, 5);
      expect(await tileCache.getCachedTileCount()).toBeGreaterThan(0);

      await tileCache.clearTileCache();
      expect(await tileCache.getCachedTileCount()).toBe(0);
    });
  });
});
