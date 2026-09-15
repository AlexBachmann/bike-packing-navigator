import { TestBed } from '@angular/core/testing';
import { RouteProjectionService } from './route-projection.service';
import { RouteLoaderService } from './route-loader.service';

describe('RouteProjectionService', () => {
  let service: RouteProjectionService;
  let loaderMock: any;

  beforeEach(() => {
    loaderMock = {
      trackPoints: vi.fn().mockReturnValue([])
    };

    TestBed.configureTestingModule({
      providers: [
        RouteProjectionService,
        { provide: RouteLoaderService, useValue: loaderMock }
      ]
    });

    service = TestBed.inject(RouteProjectionService);
  });

  it('should return null when track points are empty or fewer than 2', () => {
    expect(service.projectOntoPoints(35.0, -111.0, [])).toBeNull();
    expect(service.projectOntoPoints(35.0, -111.0, [[35.0, -111.0, 100, 0, 0]])).toBeNull();
  });

  it('should project a point exactly on segment', () => {
    const points: [number, number, number, number, number][] = [
      [35.0, -111.0, 1000, 0.0, 0.0],
      [35.0, -110.0, 1000, 100.0, 62.1]
    ];

    const res = service.projectOntoPoints(35.0, -110.5, points);
    expect(res).toBeTruthy();
    expect(res!.distanceKm).toBeCloseTo(0, 1);
    expect(res!.isOffRoute).toBe(false);
    expect(res!.projectedRouteKm).toBeCloseTo(50, 0);
  });

  it('should detect off-route when distance > 10 km', () => {
    const points: [number, number, number, number, number][] = [
      [35.0, -111.0, 1000, 0.0, 0.0],
      [35.0, -110.0, 1000, 100.0, 62.1]
    ];

    // ~1 degree latitude is ~111 km away
    const res = service.projectOntoPoints(36.0, -110.5, points);
    expect(res).toBeTruthy();
    expect(res!.isOffRoute).toBe(true);
    expect(res!.distanceKm).toBeGreaterThan(10);
  });

  it('should delegate projectOntoRoute to loader.trackPoints()', () => {
    loaderMock.trackPoints.mockReturnValue([
      [35.0, -111.0, 1000, 0.0, 0.0],
      [35.0, -110.0, 1000, 100.0, 62.1]
    ]);

    const res = service.projectOntoRoute(35.0, -110.5);
    expect(res).toBeTruthy();
    expect(res!.projectedRouteKm).toBeCloseTo(50, 0);
  });
});
