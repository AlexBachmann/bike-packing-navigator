import { TestBed } from '@angular/core/testing';
import { GeolocationService } from './geolocation.service';
import { RouteDataService } from './route-data.service';
import { DeadReckoningService } from './dead-reckoning.service';
import { SettingsService } from './settings.service';
import { signal } from '@angular/core';
import { NavigationTab } from '../models/settings.model';

describe('GeolocationService', () => {
  let service: GeolocationService;
  let mockRouteService: any;
  let mockDeadReckoning: any;
  let mockSettings: any;

  function ensureGeolocation() {
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

  beforeEach(() => {
    ensureGeolocation();

    mockRouteService = {
      projectOntoRoute: vi.fn().mockImplementation((lat: number, lon: number) => {
        // Simple mock: if lat > 45, consider off-route
        const isOff = lat > 45;
        return {
          distanceKm: isOff ? 25.0 : 0.1,
          distanceMiles: isOff ? 15.5 : 0.06,
          projectedRouteKm: 16.0,
          projectedRouteMile: 10.0,
          isOffRoute: isOff,
          nearestPointOnTrail: { lat: 40.0, lon: -105.0, ele: 1600 },
          nearestMile: 10.0
        };
      })
    };

    mockDeadReckoning = {
      updateGpsFix: vi.fn(),
      stop: vi.fn()
    };

    mockSettings = {
      activeTab: signal<NavigationTab>('waypoints')
    };

    TestBed.configureTestingModule({
      providers: [
        GeolocationService,
        { provide: RouteDataService, useValue: mockRouteService },
        { provide: DeadReckoningService, useValue: mockDeadReckoning },
        { provide: SettingsService, useValue: mockSettings }
      ]
    });

    service = TestBed.inject(GeolocationService);
  });

  afterEach(() => {
    service.stopTracking();
    ensureGeolocation();
    vi.restoreAllMocks();
  });

  describe('1. Lifecycle & Init', () => {
    it('should initialize with tracking disabled and null telemetry', () => {
      expect(service.isTracking()).toBe(false);
      expect(service.isLoading()).toBe(false);
      expect(service.currentError()).toBeNull();
      expect(service.currentProjection()).toBeNull();
      expect(service.gpsState().enabled).toBe(false);
      expect(service.gpsState().latitude).toBeNull();
      expect(service.gpsState().longitude).toBeNull();
      expect(service.gpsState().speedKph).toBeNull();
      expect(service.gpsState().heading).toBeNull();
    });
  });

  describe('2. Browser Capabilities', () => {
    it('handles missing navigator.geolocation gracefully', () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: undefined,
        configurable: true,
        writable: true
      });

      service.requestLocation();
      expect(service.gpsState().error).toBe('Geolocation is not supported by your browser.');
      expect(service.gpsState().loading).toBe(false);

      ensureGeolocation();
    });

    it('rejects requestCurrentPosition when geolocation is not supported', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: undefined,
        configurable: true,
        writable: true
      });

      await expect(service.requestCurrentPosition()).rejects.toThrow('Geolocation is not supported by your browser.');

      ensureGeolocation();
    });
  });


  describe('3 & 4. Start, Stop & Toggle Tracking', () => {
    it('starts tracking and updates state', () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(() => {});
      service.startTracking();

      expect(service.isTracking()).toBe(true);
      expect(service.gpsState().enabled).toBe(true);
      expect(service.gpsState().error).toBeNull();
    });

    it('stops tracking, clears timers, resets state, and stops dead reckoning', () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(() => {});
      service.startTracking();
      expect(service.isTracking()).toBe(true);

      service.stopTracking();
      expect(service.isTracking()).toBe(false);
      expect(service.gpsState().enabled).toBe(false);
      expect(service.gpsState().latitude).toBeNull();
      expect(mockDeadReckoning.stop).toHaveBeenCalled();
    });

    it('toggles tracking on and off', () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(() => {});

      expect(service.isTracking()).toBe(false);
      service.toggleTracking();
      expect(service.isTracking()).toBe(true);
      service.toggleTracking();
      expect(service.isTracking()).toBe(false);
    });
  });

  describe('5 & 6. Polling Cadence & Dynamic Frequency', () => {
    it('uses 30s frequency on standard tabs and 1s on ride tab', () => {
      mockSettings.activeTab.set('waypoints');
      expect(service.getFrequencySeconds()).toBe(30);

      mockSettings.activeTab.set('ride');
      expect(service.getFrequencySeconds()).toBe(1);

      mockSettings.activeTab.set('elevation');
      expect(service.getFrequencySeconds()).toBe(30);
    });

    it('supports custom frequency override', () => {
      service.setFrequency(5);
      expect(service.getFrequencySeconds()).toBe(5);

      service.stopTracking();
      // Custom frequency resets on stop
      expect(service.getFrequencySeconds()).toBe(30);
    });

    it('re-arms interval timer when active tab changes', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(() => {});

      mockSettings.activeTab.set('waypoints');
      service.startTracking();

      const initialClearCount = clearIntervalSpy.mock.calls.length;
      const initialSetCount = setIntervalSpy.mock.calls.length;

      // Switch to 'ride' mode
      mockSettings.activeTab.set('ride');
      TestBed.flushEffects();

      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(initialClearCount);
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(initialSetCount);
      const lastRideInterval = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1];
      expect(lastRideInterval[1]).toBe(1000);

      // Switch back to 'waypoints'
      mockSettings.activeTab.set('waypoints');
      TestBed.flushEffects();

      const lastWaypointsInterval = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1];
      expect(lastWaypointsInterval[1]).toBe(30000);
    });

    it('should not re-arm interval timer on continuous GPS location fixes (no effect churn)', () => {
      const startIntervalSpy = vi.spyOn(service, 'startGpsInterval');
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(() => {});

      service.startTracking();
      TestBed.flushEffects();

      const callCountAfterStart = startIntervalSpy.mock.calls.length;

      // Simulate 10 successive GPS fixes while tracking is active
      for (let i = 0; i < 10; i++) {
        service.handleLocationSuccess({
          coords: {
            latitude: 40.0 + i * 0.001,
            longitude: -105.0,
            accuracy: 5,
            speed: 15,
            heading: 0
          },
          timestamp: Date.now() + i * 1000
        } as unknown as GeolocationPosition);

        TestBed.flushEffects();
      }

      // startGpsInterval must NOT have been called again by the effect
      expect(startIntervalSpy.mock.calls.length).toBe(callCountAfterStart);
    });
  });

  describe('7 & 8. In-Flight Callback Cancellation Guards', () => {
    it('does not resurrect GPS state when success callback resolves after stopTracking', () => {
      let capturedSuccess: ((pos: GeolocationPosition) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((success) => {
        capturedSuccess = success as any;
      });

      service.startTracking();
      expect(service.isTracking()).toBe(true);

      // User stops GPS tracking while async request is pending
      service.stopTracking();
      expect(service.isTracking()).toBe(false);

      // Async response resolves
      capturedSuccess!({
        coords: {
          latitude: 40.0,
          longitude: -105.0,
          accuracy: 5,
          speed: 10,
          heading: 90
        },
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      // Must remain disabled and null
      expect(service.isTracking()).toBe(false);
      expect(service.gpsState().latitude).toBeNull();
      expect(service.gpsState().longitude).toBeNull();
    });

    it('does not set error when error callback resolves after stopTracking', () => {
      let capturedError: ((err: GeolocationPositionError) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((_, err) => {
        capturedError = err as any;
      });

      service.startTracking();
      service.stopTracking();

      capturedError!({
        code: 3,
        message: 'Timeout',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError);

      expect(service.gpsState().error).toBeNull();
    });
  });

  describe('9, 10, 11. Speed Calculation Engine', () => {
    it('calculates speed between successive GPS fixes', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true }));
      const t0 = 1000000;

      // First fix: (40.0, -105.0)
      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: t0
      } as unknown as GeolocationPosition);

      expect(service.gpsState().speedKph).toBeNull();

      // Second fix: move North ~100m over 10 seconds -> ~36 km/h
      // 0.0009 deg lat ~ 100m
      const t1 = t0 + 10000;
      service.handleLocationSuccess({
        coords: { latitude: 40.0009, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: t1
      } as unknown as GeolocationPosition);

      expect(service.gpsState().speedKph).toBeCloseTo(36.0, 0);
    });

    it('clamps speed < 1.0 km/h to 0 (jitter deadband)', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true }));
      const t0 = 1000000;

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: t0
      } as unknown as GeolocationPosition);

      // Micro movement of 0.000001 deg over 10s (~0.1m, < 1 km/h)
      service.handleLocationSuccess({
        coords: { latitude: 40.000001, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: t0 + 10000
      } as unknown as GeolocationPosition);

      expect(service.gpsState().speedKph).toBe(0);
    });

    it('falls back to hardware coords.speed on first fix', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true }));

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: 5.0, heading: null }, // 5 m/s = 18 km/h
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      expect(service.gpsState().speedKph).toBeCloseTo(18.0, 1);
    });
  });

  describe('12, 13, 14. Dual-Regime Heading Engine', () => {
    it('uses hardware compass heading when standing (< 1 km/h)', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true }));

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: 0.1, heading: 245 },
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      expect(service.gpsState().heading).toBe(245);
    });

    it('calculates 2-point course-over-ground heading when moving (>= 1 km/h) with >= 2m displacement', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true }));
      const t0 = Date.now();

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: 4.0, heading: null },
        timestamp: t0
      } as unknown as GeolocationPosition);

      // Move North by ~110m
      service.handleLocationSuccess({
        coords: { latitude: 40.001, longitude: -105.0, accuracy: 5, speed: 4.0, heading: null },
        timestamp: t0 + 2000
      } as unknown as GeolocationPosition);

      expect(service.gpsState().heading).toBeCloseTo(0, 1); // 0° North
    });

    it('preserves previous heading when moving displacement is < 2m (jitter filter)', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true, heading: 90 }));
      const t0 = Date.now();

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: 3.0, heading: null },
        timestamp: t0
      } as unknown as GeolocationPosition);

      // Micro displacement < 2m
      service.handleLocationSuccess({
        coords: { latitude: 40.000001, longitude: -105.0, accuracy: 5, speed: 3.0, heading: null },
        timestamp: t0 + 1000
      } as unknown as GeolocationPosition);

      expect(service.gpsState().heading).toBe(90);
    });
  });

  describe('15, 16, 17. Route Snapping & Dead Reckoning', () => {
    it('notifies onMileUpdate callback when GPS fix is on-route', () => {
      const mileSpy = vi.fn();
      const unsubscribe = service.onLocationUpdate(mileSpy);

      service.gpsState.update((s) => ({ ...s, enabled: true }));

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: 3.0, heading: 0 },
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      expect(mileSpy).toHaveBeenCalledWith(10.0);
      expect(mockDeadReckoning.updateGpsFix).toHaveBeenCalled();

      unsubscribe();
    });

    it('does NOT notify onMileUpdate callback when GPS fix is off-route (> 10km)', () => {
      const mileSpy = vi.fn();
      service.onLocationUpdate(mileSpy);

      service.gpsState.update((s) => ({ ...s, enabled: true }));

      // lat = 50 triggers mock offRoute = true
      service.handleLocationSuccess({
        coords: { latitude: 50.0, longitude: -105.0, accuracy: 5, speed: 3.0, heading: 0 },
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      expect(service.gpsState().projection?.isOffRoute).toBe(true);
      expect(mileSpy).not.toHaveBeenCalled();
    });
  });

  describe('18 & 19. Error Handling & Alert Dismissal', () => {
    it('maps error codes correctly for ride and standard tabs', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true }));

      // Permission denied
      service.handleLocationError({
        code: 1,
        message: 'Denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError, false);
      expect(service.gpsState().error).toContain('Location permission denied');

      // Position unavailable
      service.handleLocationError({
        code: 2,
        message: 'Unavailable',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError, false);
      expect(service.gpsState().error).toContain('GPS signal unavailable');

      // Timeout standard
      service.handleLocationError({
        code: 3,
        message: 'Timeout',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError, false);
      expect(service.gpsState().error).toContain('Retrying in 30 seconds');

      // Timeout ride
      service.handleLocationError({
        code: 3,
        message: 'Timeout',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError, true);
      expect(service.gpsState().error).toBe('GPS signal weak...');
    });

    it('dismisses off-route alert without disabling GPS', () => {
      service.simulateGpsLocation(50.0, -105.0); // off-route
      expect(service.gpsState().projection?.isOffRoute).toBe(true);

      service.dismissAlert();
      expect(service.gpsState().projection).toBeNull();
      expect(service.gpsState().enabled).toBe(true);
    });

    it('clears error without modifying projection or enabled state', () => {
      service.gpsState.update((s) => ({ ...s, enabled: true, error: 'Test error' }));
      expect(service.gpsState().error).toBe('Test error');

      service.clearError();
      expect(service.gpsState().error).toBeNull();
      expect(service.gpsState().enabled).toBe(true);
    });
  });

  describe('20. GPS Simulation', () => {
    it('sets coordinates and updates route projection via simulateGpsLocation', () => {
      const mileSpy = vi.fn();
      service.onLocationUpdate(mileSpy);

      service.simulateGpsLocation(40.0, -105.0);

      expect(service.gpsState().enabled).toBe(true);
      expect(service.gpsState().latitude).toBe(40.0);
      expect(service.gpsState().longitude).toBe(-105.0);
      expect(service.gpsState().accuracyMeters).toBe(5);
      expect(mileSpy).toHaveBeenCalledWith(10.0);
    });
  });

  describe('21. One-Shot Position & Loading State Integrity', () => {
    it('resets loading to false when requestCurrentPosition succeeds while tracking is disabled', async () => {
      let capturedSuccess: ((pos: GeolocationPosition) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((success) => {
        capturedSuccess = success as any;
      });

      expect(service.isTracking()).toBe(false);
      expect(service.isLoading()).toBe(false);

      const promise = service.requestCurrentPosition();

      // Loading must be active while hardware request is in flight
      expect(service.isLoading()).toBe(true);
      expect(service.gpsState().loading).toBe(true);
      expect(capturedSuccess).not.toBeNull();

      // Hardware fix resolves
      capturedSuccess!({
        coords: { latitude: 40.05, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      const resolvedPos = await promise;

      // Promise resolves with coords
      expect(resolvedPos.coords.latitude).toBe(40.05);
      // Loading flag MUST be reset to false to avoid UI lockout
      expect(service.isLoading()).toBe(false);
      expect(service.gpsState().loading).toBe(false);
      expect(service.isTracking()).toBe(false);
    });

    it('resets loading to false and rejects promise when requestCurrentPosition fails while tracking is disabled', async () => {
      let capturedError: ((err: GeolocationPositionError) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((_, error) => {
        capturedError = error as any;
      });

      expect(service.isTracking()).toBe(false);
      expect(service.isLoading()).toBe(false);

      const promise = service.requestCurrentPosition();

      expect(service.isLoading()).toBe(true);
      expect(service.gpsState().loading).toBe(true);
      expect(capturedError).not.toBeNull();

      const mockError = {
        code: 1,
        message: 'User denied Geolocation',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError;

      capturedError!(mockError);

      await expect(promise).rejects.toEqual(mockError);

      // Loading flag MUST be reset to false to avoid UI lockout
      expect(service.isLoading()).toBe(false);
      expect(service.gpsState().loading).toBe(false);
      expect(service.isTracking()).toBe(false);
    });

    it('ensures loading is false when success arrives after stopTracking cancellation', () => {
      let capturedSuccess: ((pos: GeolocationPosition) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((success) => {
        capturedSuccess = success as any;
      });

      service.startTracking();
      expect(service.isLoading()).toBe(true);

      // Cancel tracking before callback
      service.stopTracking();
      expect(service.isTracking()).toBe(false);

      capturedSuccess!({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: Date.now()
      } as unknown as GeolocationPosition);

      expect(service.isLoading()).toBe(false);
      expect(service.gpsState().loading).toBe(false);
      expect(service.gpsState().latitude).toBeNull();
    });

    it('ensures loading is false when error arrives after stopTracking cancellation', () => {
      let capturedError: ((err: GeolocationPositionError) => void) | null = null;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation((_, err) => {
        capturedError = err as any;
      });

      service.startTracking();
      expect(service.isLoading()).toBe(true);

      // Cancel tracking before callback
      service.stopTracking();
      expect(service.isTracking()).toBe(false);

      capturedError!({
        code: 3,
        message: 'Timeout',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      } as unknown as GeolocationPositionError);

      expect(service.isLoading()).toBe(false);
      expect(service.gpsState().loading).toBe(false);
      expect(service.gpsState().error).toBeNull();
    });
  });

  describe('22. Timestamp Monotonicity & Out-of-Order Fix Guards', () => {
    it('discards stale out-of-order GPS fix arriving late with older timestamp', () => {
      const mileSpy = vi.fn();
      const unsubscribe = service.onLocationUpdate(mileSpy);
      service.startTracking();

      const tNewer = 2000000;
      const tOlder = 1990000; // 10s older

      // Fix 1 (newer fix arrives first at t = 2,000,000)
      service.handleLocationSuccess({
        coords: { latitude: 40.1, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tNewer
      } as unknown as GeolocationPosition);

      expect(service.gpsState().latitude).toBe(40.1);
      expect(service.gpsState().lastUpdated?.getTime()).toBe(tNewer);
      expect(mileSpy).toHaveBeenCalledWith(10.0);
      expect(mockDeadReckoning.updateGpsFix).toHaveBeenCalledTimes(1);

      // Fix 2 (older out-of-order fix arrives late at t = 1,990,000)
      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tOlder
      } as unknown as GeolocationPosition);

      // Verify that stale fix was discarded: state retained newer coordinates & timestamp
      expect(service.gpsState().latitude).toBe(40.1);
      expect(service.gpsState().longitude).toBe(-105.0);
      expect(service.gpsState().lastUpdated?.getTime()).toBe(tNewer);
      // Callback was NOT triggered with stale location
      expect(mileSpy).toHaveBeenCalledTimes(1);
      // Dead reckoning was NOT updated with stale fix
      expect(mockDeadReckoning.updateGpsFix).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('accepts consecutive fixes with equal timestamps without regressing or throwing', () => {
      service.startTracking();
      const tSame = 2000000;

      // Fix 1
      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tSame
      } as unknown as GeolocationPosition);

      expect(service.gpsState().latitude).toBe(40.0);
      expect(service.gpsState().lastUpdated?.getTime()).toBe(tSame);

      // Fix 2 arrives with identical timestamp
      service.handleLocationSuccess({
        coords: { latitude: 40.001, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tSame
      } as unknown as GeolocationPosition);

      // Not discarded by strict inequality, coordinates updated safely
      expect(service.gpsState().latitude).toBe(40.001);
      expect(service.gpsState().lastUpdated?.getTime()).toBe(tSame);
      expect(service.gpsState().speedKph).toBe(0);
    });

    it('accepts initial fix when lastUpdated is null', () => {
      service.startTracking();
      expect(service.gpsState().lastUpdated).toBeNull();

      const tInitial = 1500000;
      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tInitial
      } as unknown as GeolocationPosition);

      expect(service.gpsState().latitude).toBe(40.0);
      expect(service.gpsState().lastUpdated?.getTime()).toBe(tInitial);
    });

    it('falls back to Date.now() when pos.timestamp is missing or 0', () => {
      service.startTracking();
      const before = Date.now();

      service.handleLocationSuccess({
        coords: { latitude: 40.0, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: 0
      } as unknown as GeolocationPosition);

      const after = Date.now();
      expect(service.gpsState().latitude).toBe(40.0);
      const fixTime = service.gpsState().lastUpdated?.getTime() ?? 0;
      expect(fixTime).toBeGreaterThanOrEqual(before);
      expect(fixTime).toBeLessThanOrEqual(after);
    });

    it('allows earlier timestamps in a new tracking session after stopTracking reset', () => {
      service.startTracking();
      const tSession1 = 5000000;

      service.handleLocationSuccess({
        coords: { latitude: 40.1, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tSession1
      } as unknown as GeolocationPosition);

      expect(service.gpsState().lastUpdated?.getTime()).toBe(tSession1);

      // Stop tracking (clears lastUpdated to null)
      service.stopTracking();
      expect(service.gpsState().lastUpdated).toBeNull();

      // Start new session
      service.startTracking();
      const tSession2 = 1000000; // earlier timestamp than Session 1

      service.handleLocationSuccess({
        coords: { latitude: 40.2, longitude: -105.0, accuracy: 5, speed: null, heading: null },
        timestamp: tSession2
      } as unknown as GeolocationPosition);

      // Accepted because session was reset
      expect(service.gpsState().latitude).toBe(40.2);
      expect(service.gpsState().lastUpdated?.getTime()).toBe(tSession2);
    });
  });
});
