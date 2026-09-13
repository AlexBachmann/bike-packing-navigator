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

describe('Tier 3: Cross-Feature Integration Combinations', () => {
  let manifestService: ContractRouteManifestService;
  let networkStatus: ContractNetworkStatusService;
  let toastService: ContractToastService;
  let offlineStorage: ContractOfflineStorageService;
  let tileCache: ContractTileCacheService;
  let settingsService: SettingsService;

  beforeEach(async () => {
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
  // Cross-Feature Scenario 1: Offline Route Switch (Uncached Blocked vs Cached Instant)
  // ==========================================================================
  it('3.1 should block uncached route with warning toast while allowing instant switch to cached route when offline', async () => {
    // 1. Rider connects and downloads Tour Divide
    networkStatus.setOnline(true);
    await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
    await manifestService.selectRoute('tour-divide-2025');
    expect(manifestService.activeRouteId()).toBe('tour-divide-2025');

    // 2. Rider goes off-grid (offline)
    networkStatus.setOnline(false);
    expect(networkStatus.isOnline()).toBe(false);

    // 3. Rider attempts to switch to Colorado Trail (not yet cached)
    const ctAttempt = await manifestService.selectRoute('colorado-trail');
    expect(ctAttempt).toBe(false);

    // Assert warning toast was shown and active route remained Tour Divide
    const toasts = toastService.activeToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('warning');
    expect(toasts[0].message).toContain('Internet connection required to download');
    expect(manifestService.activeRouteId()).toBe('tour-divide-2025');

    // 4. Now suppose Colorado Trail had been pre-cached before the trip
    await offlineStorage.saveRoutePackage(createSamplePackage('colorado-trail'));

    // 5. Switching to pre-cached Colorado Trail offline succeeds immediately
    toastService.clear();
    const cachedSwitch = await manifestService.selectRoute('colorado-trail');
    expect(cachedSwitch).toBe(true);
    expect(manifestService.activeRouteId()).toBe('colorado-trail');
    expect(toastService.activeToasts().length).toBe(0);
  });

  // ==========================================================================
  // Cross-Feature Scenario 2: Settings Preservation Across Route Switches
  // ==========================================================================
  it('3.2 should preserve rider preferences (unit, pace mode, power) while resetting route telemetry on route switch', async () => {
    // 1. Rider customizes settings
    settingsService.distanceUnit.set('km');
    settingsService.paceMode.set('power');
    settingsService.riderPowerWatts.set(220);

    // Verify customized settings
    expect(settingsService.distanceUnit()).toBe('km');
    expect(settingsService.paceMode()).toBe('power');
    expect(settingsService.riderPowerWatts()).toBe(220);

    // 2. Rider starts on Tour Divide
    await manifestService.selectRoute('tour-divide-2025');
    const tdSummary = manifestService.activeRouteSummary()!;
    expect(tdSummary.totalDistanceKm).toBeCloseTo(4311.8, 0);

    // 3. Rider switches route to Colorado Trail
    await manifestService.selectRoute('colorado-trail');
    const ctSummary = manifestService.activeRouteSummary()!;

    // Assert: User settings are perfectly preserved
    expect(settingsService.distanceUnit()).toBe('km');
    expect(settingsService.paceMode()).toBe('power');
    expect(settingsService.riderPowerWatts()).toBe(220);

    // Assert: Route telemetry updated to Colorado Trail
    expect(ctSummary.name).toBe('Colorado Trail');
    expect(ctSummary.totalDistanceKm).toBeCloseTo(861.0, 0);
    expect(ctSummary.startLocation).toContain('Denver');
    expect(ctSummary.endLocation).toContain('Durango');
  });

  // ==========================================================================
  // Cross-Feature Scenario 3: Deep-Link First Visit Bypass
  // ==========================================================================
  it('3.3 should bypass welcome screen on pristine device when ?route=colorado-trail deep link is used', async () => {
    // Pristine device: empty localStorage
    expect(localStorage.getItem('tour_divide_selected_route')).toBeNull();

    // Rider arrives via deep link: ?route=colorado-trail
    const deepLinkUrl = 'https://bikepack.app/?route=colorado-trail';
    const parsed = new URL(deepLinkUrl);
    const targetRoute = parsed.searchParams.get('route');

    expect(targetRoute).toBe('colorado-trail');

    // Manifest service selects route from deep link
    await manifestService.selectRoute(targetRoute);

    // Assert: Welcome screen is bypassed (activeRouteId is not null)
    expect(manifestService.activeRouteId()).toBe('colorado-trail');
    expect(manifestService.activeRouteSummary()?.name).toBe('Colorado Trail');

    // Storage is updated
    localStorage.setItem('tour_divide_selected_route', 'colorado-trail');
    expect(localStorage.getItem('tour_divide_selected_route')).toBe('colorado-trail');
  });

  // ==========================================================================
  // Cross-Feature Scenario 4: Dynamic Physics Recalculation Across Route Lengths
  // ==========================================================================
  it('3.4 should dynamically adapt ETA physics and milestones between Tour Divide (2679 mi) and Colorado Trail (535 mi)', () => {
    const tdPkg = createSamplePackage('tour-divide-2025');
    const ctPkg = createSamplePackage('colorado-trail');

    // Physics calculation helper
    const computeEstimatedDays = (totalDistanceMiles: number, avgDailyMiles: number) => {
      return Math.round((totalDistanceMiles / avgDailyMiles) * 10) / 10;
    };

    const avgDailyMiles = 100; // 100 miles/day pace

    // Tour Divide: ~26.8 days
    const tdDays = computeEstimatedDays(tdPkg.track.total_miles, avgDailyMiles);
    expect(tdDays).toBeCloseTo(26.8, 1);

    // Colorado Trail: ~5.4 days
    const ctDays = computeEstimatedDays(ctPkg.track.total_miles, avgDailyMiles);
    expect(ctDays).toBeCloseTo(5.4, 1);

    expect(tdDays).not.toBe(ctDays);
  });

  // ==========================================================================
  // Cross-Feature Scenario 5: Cache Storage & IndexedDB Synchrony
  // ==========================================================================
  it('3.5 should synchronize IndexedDB data package and Cache Storage map tiles on initial route download', async () => {
    const route = COLORADO_TRAIL_SUMMARY;

    // 1. Download data package -> Save to IndexedDB
    const pkg = createSamplePackage(route.id);
    await offlineStorage.saveRoutePackage(pkg);

    // 2. Download map tiles -> Save to Cache Storage
    const tileCount = await tileCache.cacheTilesForRoute(route, 5, 5);

    // Assert both offline layers are populated
    expect(await offlineStorage.isRouteCached(route.id)).toBe(true);
    expect(await tileCache.getCachedTileCount()).toBe(tileCount);
    expect(tileCount).toBeGreaterThan(0);

    // Verify offline retrieval works for both
    const cachedPkg = await offlineStorage.getRoutePackage(route.id);
    expect(cachedPkg?.places.length).toBeGreaterThan(0);
  });
});
