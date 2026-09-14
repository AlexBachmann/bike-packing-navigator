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
});
