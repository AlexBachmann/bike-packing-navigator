import { TestBed } from '@angular/core/testing';
import {
  RouteSummary,
  SAMPLE_MANIFEST,
  TOUR_DIVIDE_SUMMARY,
  COLORADO_TRAIL_SUMMARY,
  createSamplePackage,
  ContractNetworkStatusService,
  ContractToastService,
  ContractOfflineStorageService,
  ContractTileCacheService,
  ContractRouteManifestService
} from './test-harness';
import { SettingsService } from '../../services/settings.service';

describe('Tier 4: Real-World Application Scenarios (End-to-End User Journeys)', () => {
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
  // Scenario 1: Tour Divide Rider Losing Cell Service in Montana Wilderness
  // ==========================================================================
  it('4.1 Scenario 1: Tour Divide rider loses cell reception in Montana, navigates waypoints, profile, and map completely offline', async () => {
    // Phase 1: Pre-trip preparation in Banff with high-speed Wi-Fi
    networkStatus.setOnline(true);
    const tdPkg = createSamplePackage('tour-divide-2025');
    await offlineStorage.saveRoutePackage(tdPkg);
    await tileCache.cacheTilesForRoute(TOUR_DIVIDE_SUMMARY, 5, 6);
    await manifestService.selectRoute('tour-divide-2025');
    localStorage.setItem('tour_divide_selected_route', 'tour-divide-2025');

    // Phase 2: Rider pedals into remote Flathead National Forest, Montana.
    // Cell coverage drops completely (simulating offline event).
    networkStatus.setOnline(false);
    expect(networkStatus.isOnline()).toBe(false);

    // Phase 3: Rider reloads browser / re-opens app on device
    const activeRouteKey = localStorage.getItem('tour_divide_selected_route');
    expect(activeRouteKey).toBe('tour-divide-2025');

    // Verify route data loads instantly from IndexedDB offline
    const loadedPackage = await offlineStorage.getRoutePackage(activeRouteKey!);
    expect(loadedPackage).not.toBeNull();
    expect(loadedPackage?.routeId).toBe('tour-divide-2025');
    expect(loadedPackage?.places.length).toBeGreaterThanOrEqual(3);

    // Verify waypoints feed is accessible
    const townWaypoints = loadedPackage!.places.filter((p) => p.category === 'town');
    expect(townWaypoints.length).toBeGreaterThan(0);
    expect(townWaypoints[0].name).toBe('Banff Springs');

    // Verify climbs & elevation profile data are accessible
    expect(loadedPackage!.climbs.length).toBeGreaterThan(0);
    expect(loadedPackage!.climbs[0].name).toBe('Koko Claims');

    // Verify map tiles are available from Cache Storage without network
    const mapTileCount = await tileCache.getCachedTileCount();
    expect(mapTileCount).toBeGreaterThan(0);

    // Verify zero network errors or toasts were fired
    expect(toastService.activeToasts().length).toBe(0);
  });

  // ==========================================================================
  // Scenario 2: Colorado Trail Rider Pre-Trip Download & Off-Grid Navigation
  // ==========================================================================
  it('4.2 Scenario 2: Colorado Trail rider downloads CT route in Denver, goes off-grid, and navigates CT offline', async () => {
    // Phase 1: Rider at hostel in Denver with hotel Wi-Fi
    networkStatus.setOnline(true);
    await manifestService.selectRoute('colorado-trail');

    // Downloads Colorado Trail data package and map tiles
    const ctPkg = createSamplePackage('colorado-trail');
    await offlineStorage.saveRoutePackage(ctPkg);
    await tileCache.cacheTilesForRoute(COLORADO_TRAIL_SUMMARY, 5, 6);
    localStorage.setItem('tour_divide_selected_route', 'colorado-trail');

    // Phase 2: Rider reaches Segment 24 in San Juan Mountains (12,500 ft elevation)
    // No cellular signal (offline)
    networkStatus.setOnline(false);

    // Rider inspects current route telemetry
    const offlineRouteKey = localStorage.getItem('tour_divide_selected_route');
    const routePkg = await offlineStorage.getRoutePackage(offlineRouteKey!);

    expect(routePkg).not.toBeNull();
    expect(routePkg?.routeId).toBe('colorado-trail');
    expect(routePkg?.track.total_miles).toBeCloseTo(535.0, 0);

    // Rider verifies upcoming pass (e.g. Kenosha Pass)
    const pass = routePkg!.passes.find((p) => p.name.includes('Kenosha Pass'));
    expect(pass).toBeDefined();
    expect(pass?.elevationM).toBe(3000);

    // Rider checks resupply grocery stops
    const grocery = routePkg!.places.find((p) => p.category === 'grocery');
    expect(grocery).toBeDefined();
    expect(grocery?.name).toBe('Leadville General');
  });

  // ==========================================================================
  // Scenario 3: High-Altitude Wilderness Resupply & Pass Tracking Off-Grid
  // ==========================================================================
  it('4.3 Scenario 3: High-altitude wilderness resupply navigation: rider off-grid filters waypoints and tracks passes', async () => {
    const pkg = createSamplePackage('colorado-trail');
    await offlineStorage.saveRoutePackage(pkg);
    networkStatus.setOnline(false);

    const offlinePkg = (await offlineStorage.getRoutePackage('colorado-trail'))!;

    // Rider is at mile 150, looking for resupply waypoints ahead
    const currentMile = 150;
    const waypointsAhead = offlinePkg.places.filter((p) => p.route_mile >= currentMile);

    expect(waypointsAhead.length).toBeGreaterThanOrEqual(2);
    // Closest resupply ahead is Leadville General
    expect(waypointsAhead[0].name).toBe('Leadville General');
    expect(waypointsAhead[0].route_mile).toBeGreaterThanOrEqual(currentMile);

    // Rider checks upcoming mountain climbs
    const upcomingClimbs = offlinePkg.climbs.filter((c) => c.startKm >= currentMile * 1.60934);
    expect(upcomingClimbs).toBeDefined();
  });

  // ==========================================================================
  // Scenario 4: Dual-Route Multi-Expedition Athlete Offline Switching
  // ==========================================================================
  it('4.4 Scenario 4: Dual-route expedition athlete toggles between Tour Divide and Colorado Trail offline using on-device cache', async () => {
    // Both routes downloaded and cached during preparation phase
    await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
    await offlineStorage.saveRoutePackage(createSamplePackage('colorado-trail'));

    // Athlete is in the backcountry with zero cell connection
    networkStatus.setOnline(false);

    // 1. Athlete loads Tour Divide
    const tdSwitch = await manifestService.selectRoute('tour-divide-2025');
    expect(tdSwitch).toBe(true);
    expect(manifestService.activeRouteId()).toBe('tour-divide-2025');
    const tdData = await offlineStorage.getRoutePackage('tour-divide-2025');
    expect(tdData?.track.total_miles).toBeCloseTo(2679.2, 0);

    // 2. Athlete toggles to Colorado Trail to compare profile
    const ctSwitch = await manifestService.selectRoute('colorado-trail');
    expect(ctSwitch).toBe(true);
    expect(manifestService.activeRouteId()).toBe('colorado-trail');
    const ctData = await offlineStorage.getRoutePackage('colorado-trail');
    expect(ctData?.track.total_miles).toBeCloseTo(535.0, 0);

    // 3. Athlete toggles back to Tour Divide
    const returnSwitch = await manifestService.selectRoute('tour-divide-2025');
    expect(returnSwitch).toBe(true);
    expect(manifestService.activeRouteId()).toBe('tour-divide-2025');

    // Zero toasts, zero errors, instant switching completely offline
    expect(toastService.activeToasts().length).toBe(0);
  });
});
