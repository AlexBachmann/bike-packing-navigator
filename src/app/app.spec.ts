import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { RouteDataService } from './services/route-data.service';

describe('App', () => {
  let app: App;
  let fixture: ComponentFixture<App>;
  let routeService: RouteDataService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    routeService = TestBed.inject(RouteDataService);

    // Provide sample route track
    routeService.trackPoints.set([
      [51.161267, -115.56016, 1408.1, 0.0, 0.0],
      [51.150858, -115.546774, 1424.1, 1.684, 1.046],
      [49.7333, -115.0, 1200.0, 200.0, 124.3]
    ]);

    app.manifestService.availableRoutes.set([
      {
        id: 'tour-divide-2025',
        name: 'Tour Divide 2025',
        shortName: 'TD',
        badge: 'TD',
        totalDistanceMiles: 2683,
        totalDistanceKm: 4318,
        elevationGainFt: 152000,
        elevationGainM: 46330,
        startLocation: 'Banff, AB',
        endLocation: 'Antelope Wells, NM',
        iconicCheckpoints: ['Banff', 'Sparwood', 'Steamboat Springs', 'Antelope Wells'],
        startCoordinates: [51.1784, -115.5708],
        bounds: [[31.3322, -115.5708], [51.1784, -108.2091]],
        description: 'The iconic GDMBR route'
      },
      {
        id: 'colorado-trail',
        name: 'Colorado Trail',
        shortName: 'CT',
        badge: 'CT',
        totalDistanceMiles: 535,
        totalDistanceKm: 861,
        elevationGainFt: 89000,
        elevationGainM: 27127,
        startLocation: 'Denver, CO',
        endLocation: 'Durango, CO',
        iconicCheckpoints: ['Denver', 'Breckenridge', 'Durango'],
        startCoordinates: [39.5, -105.1],
        bounds: [[37.3, -107.9], [39.5, -105.1]],
        description: 'The iconic Colorado high country route'
      }
    ]);
    app.manifestService.selectRoute('tour-divide-2025');
    app.unit.set('miles');
  });

  afterEach(() => {
    app.ngOnDestroy();
    app.unit.set('miles');
    localStorage.clear();
  });

  it('should create the app', () => {
    expect(app).toBeTruthy();
  });

  it('should initialize with default values', () => {
    expect(app.currentMile()).toBe(0.0);
    expect(app.avgSpeedMph()).toBe(10.5);
    expect(app.unit()).toBe('miles');
    expect(app.riderPowerWatts()).toBe(150);
    expect(app.paceMode()).toBe('power');
    expect(app.gpsState().enabled).toBe(false);
  });

  it('should adjust rider power in 10W increments', () => {
    expect(app.riderPowerWatts()).toBe(150);
    app.adjustPower(10);
    expect(app.riderPowerWatts()).toBe(160);
    app.adjustPower(-10);
    expect(app.riderPowerWatts()).toBe(150);
  });

  it('should update power immediately during rapid clicks without blocking', () => {
    expect(app.riderPowerWatts()).toBe(150);
    for (let i = 0; i < 5; i++) {
      app.adjustPower(10);
    }
    // Power updates instantaneously to 200W
    expect(app.riderPowerWatts()).toBe(200);
  });

  it('should toggle pace mode between power and speed', () => {
    expect(app.paceMode()).toBe('power');
    app.togglePaceMode();
    expect(app.paceMode()).toBe('speed');
    app.togglePaceMode();
    expect(app.paceMode()).toBe('power');
  });

  it('should adjust speed in steppers', () => {
    expect(app.displaySpeed()).toBe(10.5);
    app.adjustSpeed(0.5);
    expect(app.displaySpeed()).toBe(11.0);
  });

  it('should honor unit toggle when adjusting position with steppers', () => {
    // In miles mode: step +5 adds 5 miles
    app.unit.set('miles');
    app.stepLocation(5);
    expect(app.currentMile()).toBe(5.0);

    // Switch to KM mode: step +25 km adds ~15.53 miles
    app.unit.set('km');
    app.stepLocation(25);
    expect(app.currentMile()).toBeCloseTo(5.0 + 25 / 1.60934, 1);
  });

  it('should maintain exact integer summation in KM mode without float drift (e.g. 5.0 -> 10.0 -> 35.0 km)', () => {
    app.unit.set('km');
    app.setMile(0);

    // Initial 0 km
    expect(app.currentMile() * 1.60934).toBeCloseTo(0.0, 4);

    // Step +5 km -> exactly 5.0 km
    app.stepLocation(5);
    const km1 = Math.round(app.currentMile() * 1.60934 * 10) / 10;
    expect(km1).toBe(5.0);
    expect((app.currentMile() * 1.60934).toFixed(1)).toBe('5.0');

    // Step +5 km again -> exactly 10.0 km (NOT 9.9!)
    app.stepLocation(5);
    const km2 = Math.round(app.currentMile() * 1.60934 * 10) / 10;
    expect(km2).toBe(10.0);
    expect((app.currentMile() * 1.60934).toFixed(1)).toBe('10.0');

    // Step +25 km -> exactly 35.0 km (NOT 34.8 or 29.8!)
    app.stepLocation(25);
    const km3 = Math.round(app.currentMile() * 1.60934 * 10) / 10;
    expect(km3).toBe(35.0);
    expect((app.currentMile() * 1.60934).toFixed(1)).toBe('35.0');

    // Step -5 km -> exactly 30.0 km (NOT 29.8!)
    app.stepLocation(-5);
    const km4 = Math.round(app.currentMile() * 1.60934 * 10) / 10;
    expect(km4).toBe(30.0);
    expect((app.currentMile() * 1.60934).toFixed(1)).toBe('30.0');

    // Step -25 km -> exactly 5.0 km
    app.stepLocation(-25);
    const km5 = Math.round(app.currentMile() * 1.60934 * 10) / 10;
    expect(km5).toBe(5.0);
    expect((app.currentMile() * 1.60934).toFixed(1)).toBe('5.0');
  });

  it('should jump out of GPS mode when clicking steppers or moving slider', () => {
    app.startGpsTracking();
    expect(app.gpsState().enabled).toBe(true);

    // Clicking stepper +5 jumps out of GPS mode
    app.stepLocation(5);
    expect(app.gpsState().enabled).toBe(false);

    // Re-enable GPS, then test stepper -5
    app.startGpsTracking();
    expect(app.gpsState().enabled).toBe(true);
    app.stepLocation(-5);
    expect(app.gpsState().enabled).toBe(false);

    // Re-enable GPS, then test slider change
    app.startGpsTracking();
    expect(app.gpsState().enabled).toBe(true);
    app.onSliderChange(50);
    expect(app.gpsState().enabled).toBe(false);

    // Re-enable GPS, then test selectMileFromUser
    app.startGpsTracking();
    expect(app.gpsState().enabled).toBe(true);
    app.selectMileFromUser(100);
    expect(app.gpsState().enabled).toBe(false);
  });

  it('should persist current location in localStorage and restore on load', () => {
    app.manifestService.selectRoute('tour-divide-2025');
    app.setMile(175.4);

    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.currentLocationMile).toBe(175.4);
    expect(raw.routeLocations['tour-divide-2025']).toBe(175.4);

    // getLocationForRoute returns persisted location
    expect(app.settings.getLocationForRoute('tour-divide-2025')).toBe(175.4);
  });

  it('should reset location to 0 when switching the route', async () => {
    app.setMile(250.0);
    expect(app.currentMile()).toBe(250.0);

    // Switch route
    await app.selectRoute('colorado-trail');
    expect(app.currentMile()).toBe(0.0);

    // Also check localStorage
    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.currentLocationMile).toBe(0.0);
    expect(raw.routeLocations['colorado-trail']).toBe(0.0);
  });

  it('should toggle route selector modal visibility', () => {
    expect(app.showRouteModal()).toBe(false);
    app.showRouteModal.set(true);
    expect(app.showRouteModal()).toBe(true);
    app.showRouteModal.set(false);
    expect(app.showRouteModal()).toBe(false);
  });

  describe('GPS Geolocation & Projection', () => {
    it('should project coordinate within 10 km and update currentMile', () => {
      app.currentMile.set(0.0);

      // Simulate being right at the Banff start (within 10 km)
      app.simulateGpsLocation(51.161267, -115.56016);

      const state = app.gpsState();
      expect(state.enabled).toBe(true);
      expect(state.projection).not.toBeNull();
      expect(state.projection!.isOffRoute).toBe(false);
      expect(state.projection!.distanceKm).toBe(0.0);
      expect(app.currentMile()).toBe(0.0);
    });

    it('should detect off-route > 10 km and NOT move currentMile slider', () => {
      app.currentMile.set(50.0);

      // Simulate a point far off route (e.g. Calgary: 51.0447, -114.0719, >80 km away)
      app.simulateGpsLocation(51.0447, -114.0719);

      const state = app.gpsState();
      expect(state.enabled).toBe(true);
      expect(state.projection).not.toBeNull();
      expect(state.projection!.isOffRoute).toBe(true);
      expect(state.projection!.distanceKm).toBeGreaterThan(10.0);
      // Slider position should be preserved!
      expect(app.currentMile()).toBe(50.0);
    });

    it('should toggle GPS tracking on and off', () => {
      expect(app.gpsState().enabled).toBe(false);

      app.startGpsTracking();
      expect(app.gpsState().enabled).toBe(true);

      app.stopGpsTracking();
      expect(app.gpsState().enabled).toBe(false);
    });

    it('should clear off-route warning and reset projection when stopping GPS tracking', () => {
      // Trigger off-route simulation
      app.simulateGpsLocation(51.0447, -114.0719);
      expect(app.gpsState().enabled).toBe(true);
      expect(app.gpsState().projection?.isOffRoute).toBe(true);

      // Leave GPS mode
      app.stopGpsTracking();
      expect(app.gpsState().enabled).toBe(false);
      expect(app.gpsState().projection).toBeNull();
    });

    it('should dismiss off-route warning when dismissGpsAlert is called', () => {
      app.simulateGpsLocation(51.0447, -114.0719);
      expect(app.gpsState().projection?.isOffRoute).toBe(true);

      app.dismissGpsAlert();
      expect(app.gpsState().projection).toBeNull();
    });

    it('should clear gps error when clearGpsError is called', () => {
      app.gpsState.update((s) => ({ ...s, error: 'Permission denied' }));
      expect(app.gpsState().error).toBe('Permission denied');

      app.clearGpsError();
      expect(app.gpsState().error).toBeNull();
    });
  });

  describe('Category Filtering (Solo Selection & Long Press Deselect)', () => {
    it('should solo select a category on short click and deselect all others', () => {
      // Start with all selected
      expect(app.selectedCategories().size).toBe(app.availableCategories.length);

      // Short click "town"
      app.handleCategoryClick('town', { preventDefault: () => {} } as any);

      expect(app.selectedCategories().size).toBe(1);
      expect(app.selectedCategories().has('town')).toBe(true);
      expect(app.selectedCategories().has('grocery')).toBe(false);

      // Short click "campground"
      app.handleCategoryClick('campground', { preventDefault: () => {} } as any);

      expect(app.selectedCategories().size).toBe(1);
      expect(app.selectedCategories().has('campground')).toBe(true);
      expect(app.selectedCategories().has('town')).toBe(false);
    });

    it('should reselect all categories when selectAllCategories is called', () => {
      app.selectOnlyCategory('town');
      expect(app.selectedCategories().size).toBe(1);

      app.selectAllCategories();
      expect(app.selectedCategories().size).toBe(app.availableCategories.length);
      for (const cat of app.availableCategories) {
        expect(app.selectedCategories().has(cat.key)).toBe(true);
      }
    });

    it('should deselect a category on long press (> 1s) and suppress short click', async () => {
      // Start with all selected
      app.selectAllCategories();
      expect(app.selectedCategories().has('town')).toBe(true);

      // Pointer down on "town"
      app.handleCategoryPointerDown('town', { button: 0, clientX: 50, clientY: 50 } as any);
      expect(app.holdingCategory()).toBe('town');

      // Wait 1050ms for long press to trigger
      await new Promise((resolve) => setTimeout(resolve, 1050));

      // Town should now be deselected!
      expect(app.holdingCategory()).toBeNull();
      expect(app.selectedCategories().has('town')).toBe(false);
      expect(app.selectedCategories().has('grocery')).toBe(true);

      // Pointer up and click should be suppressed
      app.handleCategoryPointerUp({} as any);
      app.handleCategoryClick('town', { preventDefault: () => {} } as any);

      // Town must remain deselected!
      expect(app.selectedCategories().has('town')).toBe(false);
      expect(app.selectedCategories().size).toBe(app.availableCategories.length - 1);
    });

    it('should perform solo select if pointer is released before 1s', async () => {
      app.selectAllCategories();

      // Pointer down on "grocery"
      app.handleCategoryPointerDown('grocery', { button: 0, clientX: 50, clientY: 50 } as any);
      expect(app.holdingCategory()).toBe('grocery');

      // Release after 100ms
      await new Promise((resolve) => setTimeout(resolve, 100));
      app.handleCategoryPointerUp({} as any);
      expect(app.holdingCategory()).toBeNull();

      // Click event fires
      app.handleCategoryClick('grocery', { preventDefault: () => {} } as any);

      // Should be solo selected
      expect(app.selectedCategories().size).toBe(1);
      expect(app.selectedCategories().has('grocery')).toBe(true);
      expect(app.selectedCategories().has('town')).toBe(false);
    });

    it('should cancel long press if pointer moves more than 8px', async () => {
      app.selectAllCategories();

      // Pointer down on "food"
      app.handleCategoryPointerDown('food', { button: 0, clientX: 50, clientY: 50 } as any);
      expect(app.holdingCategory()).toBe('food');

      // Pointer moves 20px horizontally (swiping/scrolling)
      app.handleCategoryPointerMove({ clientX: 70, clientY: 50 } as any);
      expect(app.holdingCategory()).toBeNull();

      // Wait 1050ms
      await new Promise((resolve) => setTimeout(resolve, 1050));

      // Long press was cancelled, so food was NOT deselected
      expect(app.selectedCategories().has('food')).toBe(true);
    });

    it('should include Laundry category with icon and badge styling', () => {
      const laundryCat = app.availableCategories.find((c) => c.key === 'laundromat');
      expect(laundryCat).toBeDefined();
      expect(laundryCat?.label).toBe('Laundry');
      expect(laundryCat?.icon).toBe('🧺');
      expect(app.selectedCategories().has('laundromat')).toBe(true);

      const badge = app.getCategoryBadge('laundromat');
      expect(badge.label).toBe('Laundry');
      expect(badge.icon).toBe('🧺');

      const aliasBadge = app.getCategoryBadge('laundry');
      expect(aliasBadge.label).toBe('Laundry');
      expect(aliasBadge.icon).toBe('🧺');
    });

    it('should filter waypoints when solo selecting Laundry', () => {
      app.selectOnlyCategory('laundromat');
      expect(app.selectedCategories().size).toBe(1);
      expect(app.selectedCategories().has('laundromat')).toBe(true);
      expect(app.selectedCategories().has('town')).toBe(false);
    });
  });

  describe('Rider Location Stepper & Slider ETA recalculation', () => {
    beforeEach(() => {
      routeService.places.set([
        {
          id: 'p1',
          name: 'Banff Springs',
          category: 'town',
          type: 'town',
          lat: 51.17,
          lon: -115.57,
          route_mile: 5.0
        },
        {
          id: 'p2',
          name: 'Mount Shark Camp',
          category: 'campground',
          type: 'campground',
          lat: 50.85,
          lon: -115.38,
          route_mile: 35.0
        },
        {
          id: 'p3',
          name: 'Sparwood Outpost',
          category: 'town',
          type: 'town',
          lat: 49.73,
          lon: -114.88,
          route_mile: 120.0
        },
        {
          id: 'p4',
          name: 'Rawlins Supply',
          category: 'grocery',
          type: 'grocery',
          lat: 41.79,
          lon: -107.24,
          route_mile: 1480.0
        }
      ] as any);
    });

    it('should recalculate ETAs when using steppers (-25, -5, +5, +25) without errors', () => {
      app.currentMile.set(0.0);

      // Mile 0: all 4 waypoints ahead
      let waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(4);
      expect(waypoints[0].name).toBe('Banff Springs');
      expect(waypoints[0].distanceAheadMiles).toBe(5.0);
      expect(waypoints[0].estimatedTimeFormatted).toBeTruthy();

      // Step +5 miles -> currentMile = 5.0
      app.stepLocation(5);
      expect(app.currentMile()).toBe(5.0);

      waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(4); // Banff Springs is at mile 5.0, so it is still at rider mile
      expect(waypoints[0].distanceAheadMiles).toBe(0.0);

      // Step +25 miles -> currentMile = 30.0
      app.stepLocation(25);
      expect(app.currentMile()).toBe(30.0);

      waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(3); // Banff Springs (mile 5) is now behind
      expect(waypoints[0].name).toBe('Mount Shark Camp');
      expect(waypoints[0].distanceAheadMiles).toBe(5.0); // 35 - 30 = 5 mi ahead

      // Step +25 miles -> currentMile = 55.0
      app.stepLocation(25);
      expect(app.currentMile()).toBe(55.0);

      waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(2);
      expect(waypoints[0].name).toBe('Sparwood Outpost');
      expect(waypoints[0].distanceAheadMiles).toBe(65.0); // 120 - 55 = 65 mi ahead

      // Step -5 miles -> currentMile = 50.0
      app.stepLocation(-5);
      expect(app.currentMile()).toBe(50.0);
      waypoints = app.waypointsAhead();
      expect(waypoints[0].distanceAheadMiles).toBe(70.0); // 120 - 50 = 70 mi ahead

      // Step -25 miles -> currentMile = 25.0
      app.stepLocation(-25);
      expect(app.currentMile()).toBe(25.0);
      waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(3);
      expect(waypoints[0].name).toBe('Mount Shark Camp');
      expect(waypoints[0].distanceAheadMiles).toBe(10.0); // 35 - 25 = 10 mi ahead
    });

    it('should recalculate ETAs when sliding the range slider anywhere along the route', () => {
      // Slide to mile 100
      app.onSliderChange(100);
      expect(app.currentMile()).toBe(100.0);

      let waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(2);
      expect(waypoints[0].name).toBe('Sparwood Outpost');
      expect(waypoints[0].distanceAheadMiles).toBe(20.0); // 120 - 100 = 20 mi ahead
      expect(waypoints[0].estimatedHours).toBeGreaterThan(0);

      // Slide to mile 1400 (deep in the route)
      app.onSliderChange(1400);
      expect(app.currentMile()).toBe(1400.0);

      waypoints = app.waypointsAhead();
      expect(waypoints.length).toBe(1);
      expect(waypoints[0].name).toBe('Rawlins Supply');
      expect(waypoints[0].distanceAheadMiles).toBe(80.0); // 1480 - 1400 = 80 mi ahead
      expect(waypoints[0].estimatedHours).toBeGreaterThan(0);
      expect(waypoints[0].estimatedTimeFormatted).toBeTruthy();
    });

    it('should filter waypointsAhead based on searchQuery', () => {
      app.currentMile.set(0.0);
      expect(app.waypointsAhead().length).toBe(4);

      app.searchQuery.set('Shark');
      const filtered = app.waypointsAhead();
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Mount Shark Camp');

      app.searchQuery.set('');
      expect(app.waypointsAhead().length).toBe(4);
    });
  });

  describe('Sticky Collapsible Header', () => {
    it('should initialize with header expanded (isHeaderCollapsed = false)', () => {
      expect(app.isHeaderCollapsed()).toBe(false);
    });

    it('should toggle collapse state when toggleHeaderCollapse is called', () => {
      expect(app.isHeaderCollapsed()).toBe(false);
      app.toggleHeaderCollapse();
      expect(app.isHeaderCollapsed()).toBe(true);
      app.toggleHeaderCollapse();
      expect(app.isHeaderCollapsed()).toBe(false);
    });

    it('should collapse header when scrolling down and expand when scrolling up', () => {
      expect(app.isHeaderCollapsed()).toBe(false);

      // Simulate scrolling down
      Object.defineProperty(window, 'scrollY', { value: 100, writable: true });
      app.onWindowScroll();
      expect(app.isHeaderCollapsed()).toBe(true);

      // Simulate scrolling up
      Object.defineProperty(window, 'scrollY', { value: 50, writable: true });
      app.onWindowScroll();
      expect(app.isHeaderCollapsed()).toBe(false);

      // Always expanded at top
      Object.defineProperty(window, 'scrollY', { value: 5, writable: true });
      app.onWindowScroll();
      expect(app.isHeaderCollapsed()).toBe(false);
    });

    it('should reset scroll, expand header, and persist activeTab on switchTab', () => {
      app.isHeaderCollapsed.set(true);
      const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

      app.switchTab('profile');
      expect(app.activeTab()).toBe('profile');
      expect(app.isHeaderCollapsed()).toBe(false);
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
      scrollToSpy.mockRestore();

      const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
      expect(raw.activeTab).toBe('profile');
    });

    it('should render "Waypoints" and "Resupply" labels in bottom navigation bar', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const navButtons = Array.from(compiled.querySelectorAll('nav button'));
      const waypointsBtn = navButtons.find((b) => b.textContent?.includes('Waypoints'));
      const resupplyBtn = navButtons.find((b) => b.textContent?.includes('Resupply'));
      expect(waypointsBtn).toBeDefined();
      expect(resupplyBtn).toBeDefined();
      expect(compiled.textContent).not.toContain('Dashboard');
    }, 15000);

    it('should switch tab to "resupply", persist to localStorage, and render app-resupply-planner', () => {
      app.switchTab('resupply');
      fixture.detectChanges();

      expect(app.activeTab()).toBe('resupply');
      const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
      expect(raw.activeTab).toBe('resupply');

      const compiled = fixture.nativeElement as HTMLElement;
      const plannerEl = compiled.querySelector('app-resupply-planner');
      expect(plannerEl).not.toBeNull();
    });

    it('should migrate legacy "jump" tab to "resupply" on app initialization', () => {
      // Simulate stored settings with activeTab = 'jump'
      const legacySettings = {
        activeTab: 'jump',
        currentLocationMile: 10
      };
      localStorage.setItem('tour_divide_user_settings', JSON.stringify(legacySettings));

      app.settings.loadSettings();
      expect(['jump', 'resupply']).toContain(app.settings.activeTab() as string);

      app.ngOnInit();
      expect(app.settings.activeTab()).toBe('resupply');
    });
  });

  describe('Ride Cockpit & GPS Interval Lifecycle', () => {
    it('should return 1s GPS polling frequency in ride mode and 30s in other tabs', () => {
      app.switchTab('waypoints');
      expect(app.getGpsFrequencySeconds()).toBe(30);

      app.switchTab('profile');
      expect(app.getGpsFrequencySeconds()).toBe(30);

      app.switchTab('map');
      expect(app.getGpsFrequencySeconds()).toBe(30);

      app.switchTab('resupply');
      expect(app.getGpsFrequencySeconds()).toBe(30);

      app.switchTab('settings');
      expect(app.getGpsFrequencySeconds()).toBe(30);

      app.switchTab('ride');
      expect(app.getGpsFrequencySeconds()).toBe(1);
    });

    it('should re-arm GPS interval on tab changes without leaking timers', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      // Start GPS tracking in default tab
      app.switchTab('waypoints');
      app.startGpsTracking();
      expect(app.gpsState().enabled).toBe(true);

      const initialSetCount = setIntervalSpy.mock.calls.length;
      const initialClearCount = clearIntervalSpy.mock.calls.length;

      // Switch to 'ride' mode
      app.switchTab('ride');
      TestBed.flushEffects();

      // ClearInterval should have been called to dispose previous interval
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(initialClearCount);
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(initialSetCount);

      // Verify the latest setInterval was invoked with 1000ms (1s)
      const lastRideIntervalCall = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1];
      expect(lastRideIntervalCall[1]).toBe(1000);

      // Switch back to 'waypoints'
      const midClearCount = clearIntervalSpy.mock.calls.length;
      app.switchTab('waypoints');
      TestBed.flushEffects();

      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(midClearCount);
      const lastWaypointsIntervalCall = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1];
      expect(lastWaypointsIntervalCall[1]).toBe(30000);

      // Stop tracking cleans up
      app.stopGpsTracking();
      expect(app.gpsState().enabled).toBe(false);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('should render app-ride-cockpit and apply full-viewport edge-to-edge layout when tab is ride', () => {
      app.switchTab('ride');
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const rideCockpitEl = compiled.querySelector('app-ride-cockpit');
      expect(rideCockpitEl).not.toBeNull();

      const rootContainer = compiled.firstElementChild as HTMLElement;
      expect(rootContainer.classList.contains('h-screen')).toBe(true);
      expect(rootContainer.classList.contains('overflow-hidden')).toBe(true);
    });
  });

  describe('GPS Geolocation In-Flight Cancellation & Robustness', () => {
    beforeEach(() => {
      if (!navigator.geolocation) {
        Object.defineProperty(navigator, 'geolocation', {
          value: {
            getCurrentPosition: vi.fn(),
            watchPosition: vi.fn(),
            clearWatch: vi.fn()
          },
          configurable: true,
          writable: true
        });
      }
    });

    it('should not resurrect GPS state when in-flight geolocation succeeds after GPS tracking was stopped', () => {
      let capturedSuccessCallback: ((pos: GeolocationPosition) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (success) => {
          capturedSuccessCallback = success as any;
        }
      );

      // Start GPS tracking
      app.startGpsTracking();
      expect(app.gpsState().enabled).toBe(true);
      expect(capturedSuccessCallback).not.toBeNull();

      // User stops GPS tracking while request is pending
      app.stopGpsTracking();
      expect(app.gpsState().enabled).toBe(false);

      // Mock geolocation response arrives post-cancellation
      const mockPosition = {
        coords: {
          latitude: 39.4912,
          longitude: -105.0945,
          accuracy: 8,
          speed: 5.5,
          heading: 180,
          altitude: null,
          altitudeAccuracy: null
        },
        timestamp: Date.now()
      } as unknown as GeolocationPosition;

      // Invoke captured callback
      capturedSuccessCallback!(mockPosition);

      // State must remain strictly disabled; no resurrection!
      expect(app.gpsState().enabled).toBe(false);
      expect(app.gpsState().latitude).toBeNull();
      expect(app.gpsState().longitude).toBeNull();
    });

    it('should not display error banner when in-flight geolocation fails after GPS tracking was stopped', () => {
      let capturedErrorCallback: ((err: GeolocationPositionError) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (success, error) => {
          capturedErrorCallback = error as any;
        }
      );

      app.startGpsTracking();
      expect(app.gpsState().enabled).toBe(true);

      // User stops GPS
      app.stopGpsTracking();
      expect(app.gpsState().enabled).toBe(false);

      // Geolocation timeout arrives post-cancellation
      const mockError = {
        code: 3, // TIMEOUT
        message: 'Timeout expired',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError;

      capturedErrorCallback!(mockError);

      // Error must not be populated into state
      expect(app.gpsState().enabled).toBe(false);
      expect(app.gpsState().error).toBeNull();
    });

    it('handleLocationSuccess should early-return if gpsState is disabled', () => {
      expect(app.gpsState().enabled).toBe(false);

      const mockPosition = {
        coords: {
          latitude: 40.0,
          longitude: -105.0,
          accuracy: 10,
          speed: null,
          heading: null,
          altitude: null,
          altitudeAccuracy: null
        },
        timestamp: Date.now()
      } as unknown as GeolocationPosition;

      app.handleLocationSuccess(mockPosition);
      expect(app.gpsState().enabled).toBe(false);
      expect(app.gpsState().latitude).toBeNull();
    });

    it('handleLocationError should early-return if gpsState is disabled', () => {
      expect(app.gpsState().enabled).toBe(false);

      const mockError = {
        code: 1, // PERMISSION_DENIED
        message: 'Denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError;

      app.handleLocationError(mockError, true);
      expect(app.gpsState().error).toBeNull();
    });
  });
});

