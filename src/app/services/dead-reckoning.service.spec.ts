import { TestBed } from '@angular/core/testing';
import { DeadReckoningService } from './dead-reckoning.service';
import { RouteDataService } from './route-data.service';
import { TurnGuidanceService } from './turn-guidance.service';

describe('DeadReckoningService', () => {
  let service: DeadReckoningService;

  const mockTrackPoints: [number, number, number, number, number][] = [
    [40.000, -105.000, 1000, 0.0, 0.0],
    [40.010, -105.000, 1000, 1.11, 0.69],
    [40.020, -105.000, 1000, 2.22, 1.38],
    [40.030, -105.000, 1000, 3.33, 2.07]
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DeadReckoningService,
        {
          provide: RouteDataService,
          useValue: {
            trackPoints: () => mockTrackPoints
          }
        },
        TurnGuidanceService
      ]
    });
    service = TestBed.inject(DeadReckoningService);
  });

  afterEach(() => {
    service.stop();
  });

  it('initializes with idle tracking state', () => {
    expect(service.isTracking()).toBe(false);
    expect(service.isMoving()).toBe(false);
    expect(service.speedKph()).toBe(0);
    expect(service.interpolatedMile()).toBe(0);
    expect(service.interpolatedCoords()).toBeNull();
  });

  it('calculates speed between two GPS fixes based on distance and elapsed time', () => {
    const t0 = 10000;
    // Fix 1: At mile 0.0
    service.updateGpsFix({
      latitude: 40.000,
      longitude: -105.000,
      timestamp: t0,
      projectedMile: 0.0,
      heading: 0
    });

    expect(service.speedKph()).toBe(0);

    // Fix 2: 1 second later, moved ~11.1 meters North (approx 40 km/h)
    // 0.0001 deg lat approx 11.11 meters
    const t1 = t0 + 1000;
    service.updateGpsFix({
      latitude: 40.0001,
      longitude: -105.000,
      timestamp: t1,
      projectedMile: 0.007,
      heading: 0
    });

    expect(service.speedKph()).toBeGreaterThanOrEqual(35);
    expect(service.speedKph()).toBeLessThanOrEqual(45);
    expect(service.isMoving()).toBe(true);
    expect(service.isTracking()).toBe(true);
  });

  it('suppresses stationary GPS jitter below 1.0 m displacement', () => {
    const t0 = 10000;
    service.updateGpsFix({
      latitude: 40.000000,
      longitude: -105.000000,
      timestamp: t0,
      projectedMile: 0.0
    });

    // Sub-meter jitter (0.3m)
    service.updateGpsFix({
      latitude: 40.000003,
      longitude: -105.000000,
      timestamp: t0 + 1000,
      projectedMile: 0.0
    });

    expect(service.speedKph()).toBe(0);
    expect(service.isMoving()).toBe(false);
  });

  it('stops and resets state when stop() is called', () => {
    service.updateGpsFix({
      latitude: 40.000,
      longitude: -105.000,
      timestamp: 1000,
      projectedMile: 0.5
    }, 20);

    expect(service.isTracking()).toBe(true);

    service.stop();

    expect(service.isTracking()).toBe(false);
    expect(service.speedKph()).toBe(0);
  });

  it('guarantees monotonic forward progress across incoming GPS fixes without snapping backward', () => {
    service.updateGpsFix({
      latitude: 40.000,
      longitude: -105.000,
      timestamp: 1000,
      projectedMile: 0.1
    }, 20);

    // Simulate that the interpolation loop advanced interpolatedMile to 0.125
    service.interpolatedMile.set(0.125);

    // Next fix arrives with projectedMile of 0.120 (slightly behind due to timer jitter)
    service.updateGpsFix({
      latitude: 40.001,
      longitude: -105.000,
      timestamp: 2000,
      projectedMile: 0.120
    });

    // Must NOT snap backward to 0.120; must hold or advance monotonically
    expect(service.interpolatedMile()).toBeGreaterThanOrEqual(0.125);
  });

  it('uses route tangent bearing on incoming GPS fix instead of raw jittery fix heading when on route', () => {
    // Route goes directly North (heading 0)
    service.updateGpsFix({
      latitude: 40.005,
      longitude: -105.000,
      timestamp: 1000,
      projectedMile: 0.35,
      heading: 45 // Raw fix has 45 deg jitter
    }, 25);

    // Tangent bearing along North route is 0, should ignore the 45 deg raw jitter
    expect(service.interpolatedHeading()).toBeCloseTo(0, 1);
  });

  it('resets position when a new tracking session starts with a projectedMile behind the previous session', () => {
    // Session 1: Tracking at mile 20.0
    service.updateGpsFix({
      latitude: 40.030,
      longitude: -105.000,
      timestamp: 1000,
      projectedMile: 20.0
    }, 25);
    expect(service.interpolatedMile()).toBe(20.0);

    // Stop session 1
    service.stop();

    // Session 2: Start tracking at mile 5.0 (e.g. user moved slider / seeked)
    service.updateGpsFix({
      latitude: 40.010,
      longitude: -105.000,
      timestamp: 5000,
      projectedMile: 5.0
    }, 25);

    // Must adopt 5.0, NOT clamp to 20.0!
    expect(service.interpolatedMile()).toBe(5.0);
  });

  it('adopts new projectedMile when user seeks or teleports to an earlier mile during active tracking', () => {
    service.updateGpsFix({
      latitude: 40.030,
      longitude: -105.000,
      timestamp: 1000,
      projectedMile: 20.0
    }, 25);
    expect(service.interpolatedMile()).toBe(20.0);

    // Teleport/seek backward to mile 5.0 (delta > 0.05 miles)
    service.updateGpsFix({
      latitude: 40.010,
      longitude: -105.000,
      timestamp: 2000,
      projectedMile: 5.0
    }, 25);

    expect(service.interpolatedMile()).toBe(5.0);
  });

  it('resets interpolatedMile, coords, and heading when reset() is called', () => {
    service.updateGpsFix({
      latitude: 40.030,
      longitude: -105.000,
      timestamp: 1000,
      projectedMile: 20.0
    }, 25);

    service.reset(5.0, [40.010, -105.000], 90);

    expect(service.interpolatedMile()).toBe(5.0);
    expect(service.interpolatedCoords()).toEqual([40.010, -105.000]);
    expect(service.interpolatedHeading()).toBe(90);
    expect(service.isTracking()).toBe(false);
    expect(service.isMoving()).toBe(false);
  });
});
