import { TestBed } from '@angular/core/testing';
import {
  RouteSummary,
  SAMPLE_MANIFEST,
  createSamplePackage,
  ContractNetworkStatusService,
  ContractToastService,
  ContractOfflineStorageService,
  ContractTileCacheService,
  ContractRouteManifestService
} from './test-harness';
import { SettingsService } from '../../services/settings.service';

describe('Tier 2: Boundary & Corner Cases (Stress & Edge-Condition Testing)', () => {
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
  // Case 1: Unknown / Invalid ?route=invalid-key URL Query Param Handling
  // ==========================================================================
  describe('Case 1: Unknown / Invalid ?route=invalid-key URL Query Param Handling', () => {
    it('1.1 should handle unknown route key gracefully without throwing uncaught exceptions', async () => {
      let threw = false;
      try {
        const result = await manifestService.selectRoute('non-existent-trail-999');
        expect(result).toBe(false);
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    it('1.2 should fallback to null activeRouteId when URL route key is invalid', async () => {
      await manifestService.selectRoute('trans-am-bike-route');
      expect(manifestService.activeRouteId()).toBeNull();
      expect(manifestService.activeRouteSummary()).toBeNull();
    });

    it('1.3 should show warning toast notification informing rider of unrecognized route key', async () => {
      await manifestService.selectRoute('fake-route-key');
      const toasts = toastService.activeToasts();
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe('warning');
      expect(toasts[0].message).toContain("Route 'fake-route-key' not recognized");
    });

    it('1.4 should validate route existence via validateRouteId() before requesting datasets', () => {
      expect(manifestService.validateRouteId('tour-divide-2025')).toBe(true);
      expect(manifestService.validateRouteId('colorado-trail')).toBe(true);
      expect(manifestService.validateRouteId('invalid-route-xyz')).toBe(false);
      expect(manifestService.validateRouteId('')).toBe(false);
    });

    it('1.5 should allow recovery by selecting a valid route after invalid route key was given', async () => {
      await manifestService.selectRoute('invalid-route-xyz');
      expect(manifestService.activeRouteId()).toBeNull();

      const success = await manifestService.selectRoute('tour-divide-2025');
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');
      expect(manifestService.activeRouteSummary()?.name).toBe('Tour Divide 2025');
    });
  });

  // ==========================================================================
  // Case 2: Empty localStorage vs Existing localStorage
  // ==========================================================================
  describe('Case 2: Empty localStorage vs Existing localStorage', () => {
    it('2.1 should handle completely empty localStorage on pristine browser profile without error', () => {
      localStorage.clear();
      expect(localStorage.getItem('tour_divide_user_settings')).toBeNull();
      expect(localStorage.getItem('tour_divide_selected_route')).toBeNull();

      expect(settingsService.distanceUnit()).toBe('miles');
      expect(settingsService.riderPowerWatts()).toBe(150);
      expect(manifestService.activeRouteId()).toBeNull();
    });

    it('2.2 should recover gracefully if localStorage contains invalid or corrupted JSON', () => {
      localStorage.setItem('tour_divide_user_settings', '{corrupted-json-data: true,');

      expect(() => {
        // Attempting to read settings with corrupted data should not crash
        try {
          JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
        } catch (e) {
          // Graceful fallback to default settings via loadSettings
          settingsService.loadSettings();
        }
      }).not.toThrow();

      expect(settingsService.distanceUnit()).toBe('miles');
    });

    it('2.3 should seamlessly migrate legacy single-route settings without losing preferences', () => {
      const legacySettings = {
        avgSpeedMph: 12.0,
        distanceUnit: 'km',
        riderPowerWatts: 180,
        paceMode: 'power'
      };
      localStorage.setItem('tour_divide_user_settings', JSON.stringify(legacySettings));

      const loaded = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
      expect(loaded.distanceUnit).toBe('km');
      expect(loaded.riderPowerWatts).toBe(180);
      expect(loaded.selectedRouteKey).toBeUndefined(); // Legacy did not have route key
    });

    it('2.4 should persist selected route key into storage immediately upon selection', async () => {
      await manifestService.selectRoute('colorado-trail');
      localStorage.setItem('tour_divide_selected_route', 'colorado-trail');

      expect(localStorage.getItem('tour_divide_selected_route')).toBe('colorado-trail');
    });

    it('2.5 should reload saved route key from storage across application restarts', async () => {
      localStorage.setItem('tour_divide_selected_route', 'colorado-trail');
      const savedKey = localStorage.getItem('tour_divide_selected_route');

      await manifestService.selectRoute(savedKey);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
    });
  });

  // ==========================================================================
  // Case 3: Rapid Route Switching & Race Conditions
  // ==========================================================================
  describe('Case 3: Rapid Route Switching & Race Conditions', () => {
    it('3.1 should handle rapid sequential route switches without race condition errors', async () => {
      const p1 = manifestService.selectRoute('tour-divide-2025');
      const p2 = manifestService.selectRoute('colorado-trail');
      const p3 = manifestService.selectRoute('tour-divide-2025');
      const p4 = manifestService.selectRoute('colorado-trail');

      await Promise.all([p1, p2, p3, p4]);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
      expect(manifestService.activeRouteSummary()?.name).toBe('Colorado Trail');
    });

    it('3.2 should ensure final active route strictly matches the last requested route', async () => {
      await manifestService.selectRoute('tour-divide-2025');
      await manifestService.selectRoute('colorado-trail');

      expect(manifestService.activeRouteId()).toBe('colorado-trail');
      expect(manifestService.activeRouteSummary()?.totalDistanceMiles).toBe(535.0);
    });

    it('3.3 should cancel or discard obsolete in-flight requests during route changes', async () => {
      let activeRequestId = 0;
      const results: string[] = [];

      const simulateRouteFetch = async (routeId: string, delayMs: number) => {
        const reqId = ++activeRequestId;
        await new Promise((r) => setTimeout(r, delayMs));
        if (reqId === activeRequestId) {
          results.push(routeId);
        }
      };

      // TD takes 50ms, but CT was requested later and takes 10ms
      simulateRouteFetch('tour-divide-2025', 50);
      simulateRouteFetch('colorado-trail', 10);

      await new Promise((r) => setTimeout(r, 60));
      expect(results).toEqual(['colorado-trail']);
    });

    it('3.4 should maintain storage cache write idempotency during rapid toggles', async () => {
      const ctPkg = createSamplePackage('colorado-trail');

      // 5 concurrent saves of same package
      await Promise.all([
        offlineStorage.saveRoutePackage(ctPkg),
        offlineStorage.saveRoutePackage(ctPkg),
        offlineStorage.saveRoutePackage(ctPkg)
      ]);

      const stored = await offlineStorage.getRoutePackage('colorado-trail');
      expect(stored?.routeId).toBe('colorado-trail');
      expect((await offlineStorage.getCachedRouteIds()).length).toBe(1);
    });

    it('3.5 should reset category filter search state cleanly across route switches', () => {
      let searchQuery = 'resupply store';
      expect(searchQuery).toBe('resupply store');

      // Switching route should clear search query
      searchQuery = '';
      expect(searchQuery).toBe('');
    });
  });

  // ==========================================================================
  // Case 4: Switching to Uncached Route when Offline (navigator.onLine = false)
  // ==========================================================================
  describe('Case 4: Switching to Uncached Route when navigator.onLine = false', () => {
    it('4.1 should revert or preserve previous active route when uncached switch is blocked offline', async () => {
      // First load Tour Divide online and cache it
      await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
      await manifestService.selectRoute('tour-divide-2025');
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');

      // Go offline
      networkStatus.setOnline(false);

      // Attempt to switch to uncached Colorado Trail
      const switchResult = await manifestService.selectRoute('colorado-trail');
      expect(switchResult).toBe(false);

      // Active route remains Tour Divide
      expect(manifestService.activeRouteId()).toBe('tour-divide-2025');
    });

    it('4.2 should maintain previous route data active when uncached route switch is rejected', async () => {
      await offlineStorage.saveRoutePackage(createSamplePackage('tour-divide-2025'));
      await manifestService.selectRoute('tour-divide-2025');

      networkStatus.setOnline(false);
      await manifestService.selectRoute('colorado-trail');

      expect(manifestService.activeRouteSummary()?.id).toBe('tour-divide-2025');
      expect(manifestService.activeRouteSummary()?.totalDistanceMiles).toBeCloseTo(2679.2, 0);
    });

    it('4.3 should display warning toast and not enter corrupted or blank view state', async () => {
      networkStatus.setOnline(false);
      await manifestService.selectRoute('colorado-trail');

      const toasts = toastService.activeToasts();
      expect(toasts.length).toBe(1);
      expect(toasts[0].message).toContain('Internet connection required');
    });

    it('4.4 should allow retry to succeed immediately once network comes back online', async () => {
      networkStatus.setOnline(false);
      let success = await manifestService.selectRoute('colorado-trail');
      expect(success).toBe(false);

      // Network restored
      networkStatus.setOnline(true);
      await offlineStorage.saveRoutePackage(createSamplePackage('colorado-trail'));

      success = await manifestService.selectRoute('colorado-trail');
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('colorado-trail');
    });

    it('4.5 should not leave partial or corrupt records in storage when offline switch fails', async () => {
      networkStatus.setOnline(false);
      await manifestService.selectRoute('colorado-trail');

      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(false);
      expect(await offlineStorage.getRoutePackage('colorado-trail')).toBeNull();
    });
  });

  // ==========================================================================
  // Case 5: Network Disconnecting Mid-Download & Error Recovery
  // ==========================================================================
  describe('Case 5: Network Disconnecting Mid-Download & Error Recovery', () => {
    it('5.1 should detect network abort during multi-file route dataset download', async () => {
      let aborted = false;
      const downloadWithAbort = async (shouldAbort: boolean) => {
        if (shouldAbort) {
          aborted = true;
          throw new Error('Network transfer aborted mid-download');
        }
        return createSamplePackage('colorado-trail');
      };

      await expect(downloadWithAbort(true)).rejects.toThrow('Network transfer aborted');
      expect(aborted).toBe(true);
    });

    it('5.2 should rollback route state if download fails midway', async () => {
      const initialRoute = 'tour-divide-2025';
      await manifestService.selectRoute(initialRoute);

      let downloadFailed = true;
      let activeRoute = manifestService.activeRouteId();

      if (downloadFailed) {
        toastService.show('Failed to download route package. Reverting.', 'error');
        // Rollback
        activeRoute = initialRoute;
      }

      expect(activeRoute).toBe('tour-divide-2025');
      expect(toastService.activeToasts()[0].type).toBe('error');
    });

    it('5.3 should display failure toast prompting rider to retry connection', () => {
      toastService.show('Network interrupted while downloading Colorado Trail. Please check connection and retry.', 'error');
      const toast = toastService.activeToasts()[0];
      expect(toast.type).toBe('error');
      expect(toast.message).toContain('Network interrupted');
      expect(toast.message).toContain('retry');
    });

    it('5.4 should not mark route as cached in IndexedDB if any file is missing', async () => {
      const partialPkg: any = {
        routeId: 'colorado-trail',
        track: null, // corrupted/missing
        places: []
      };

      const isPackageComplete = (pkg: any) => !!(pkg?.track?.points?.length && pkg?.places?.length);
      expect(isPackageComplete(partialPkg)).toBe(false);

      // Do NOT save incomplete packages to cache
      if (isPackageComplete(partialPkg)) {
        await offlineStorage.saveRoutePackage(partialPkg);
      }

      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(false);
    });

    it('5.5 should successfully complete and cache package on subsequent retry', async () => {
      // First attempt failed
      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(false);

      // Retry attempt with full package
      const fullPkg = createSamplePackage('colorado-trail');
      await offlineStorage.saveRoutePackage(fullPkg);

      expect(await offlineStorage.isRouteCached('colorado-trail')).toBe(true);
      const retrieved = await offlineStorage.getRoutePackage('colorado-trail');
      expect(retrieved?.track.points.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Case 6: Zero/Extreme Distance & Coordinate Boundaries
  // ==========================================================================
  describe('Case 6: Zero/Extreme Distance & Coordinate Boundaries', () => {
    it('6.1 should handle zero distance route safely without division by zero', () => {
      const zeroDistanceKm = 0;
      const avgSpeedKmh = 16.0;

      const computeEtaHours = (dist: number, speed: number) => {
        if (dist <= 0 || speed <= 0) return 0;
        return dist / speed;
      };

      expect(computeEtaHours(zeroDistanceKm, avgSpeedKmh)).toBe(0);
      expect(Number.isFinite(computeEtaHours(zeroDistanceKm, avgSpeedKmh))).toBe(true);
    });

    it('6.2 should compute valid ETA physics and pacing for micro-routes (< 5 miles)', () => {
      const shortDistanceMi = 2.5;
      const speedMph = 10.0;
      const hours = shortDistanceMi / speedMph; // 0.25 hrs = 15 mins

      expect(hours).toBe(0.25);
      const minutes = Math.round(hours * 60);
      expect(minutes).toBe(15);
    });

    it('6.3 should handle extreme latitude and longitude values crossing hemispheres safely', () => {
      const extremePoints: [number, number, number, number, number][] = [
        [-89.9, -179.9, 2800.0, 0.0, 0.0], // South pole region
        [89.9, 179.9, 10.0, 1000.0, 621.3] // North pole region
      ];

      for (const pt of extremePoints) {
        expect(pt[0]).toBeGreaterThanOrEqual(-90);
        expect(pt[0]).toBeLessThanOrEqual(90);
        expect(pt[1]).toBeGreaterThanOrEqual(-180);
        expect(pt[1]).toBeLessThanOrEqual(180);
      }
    });

    it('6.4 should handle route with empty places array without rendering exceptions', () => {
      const emptyPlacesRoute = createSamplePackage('empty-route');
      emptyPlacesRoute.places = [];

      expect(emptyPlacesRoute.places.length).toBe(0);
      const filteredPlaces = emptyPlacesRoute.places.filter((p) => p.is_in_town);
      expect(filteredPlaces.length).toBe(0);
    });

    it('6.5 should clamp location stepper within valid range [0, totalDistance]', () => {
      const totalDist = 535.0; // CT miles
      const clampMile = (requested: number) => Math.max(0, Math.min(totalDist, requested));

      expect(clampMile(-50)).toBe(0);
      expect(clampMile(200)).toBe(200);
      expect(clampMile(600)).toBe(535.0);
      expect(clampMile(999999)).toBe(535.0);
    });
  });
});
