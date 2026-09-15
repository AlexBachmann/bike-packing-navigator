import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { RouteLoaderService } from './route-loader.service';
import { RouteProjectionService } from './route-projection.service';
import { RouteDataService } from '../route-data.service';
import { DeadReckoningService } from '../dead-reckoning.service';
import { TurnGuidanceService } from '../turn-guidance.service';
import { OfflineStorageService } from '../offline-storage.service';
import { NetworkStatusService } from '../network-status.service';
import { RouteDataPackage } from '../../models/route.model';

describe('Guidance Track Pipeline & Dual-Polyline System', () => {
  let loaderService: RouteLoaderService;
  let projectionService: RouteProjectionService;
  let deadReckoningService: DeadReckoningService;
  let httpMock: HttpTestingController;
  let offlineStorageMock: any;
  let networkStatusMock: any;

  const mockRawPoints: [number, number, number, number, number][] = [
    [42.00000, 72.00000, 1000, 0.0, 0.0],
    [42.01000, 72.01000, 1020, 1.5, 0.93]
  ];

  const mockGuidancePoints: [number, number, number, number, number][] = [
    [42.00005, 72.00002, 1000, 0.0, 0.0],
    [42.00500, 72.00498, 1010, 0.8, 0.50],
    [42.01002, 72.00998, 1020, 1.52, 0.94]
  ];

  beforeEach(() => {
    offlineStorageMock = {
      getRoutePackage: vi.fn().mockResolvedValue(null),
      saveRoutePackage: vi.fn().mockResolvedValue(undefined)
    };
    networkStatusMock = {
      isOnline: signal(true)
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RouteLoaderService,
        RouteDataService,
        RouteProjectionService,
        DeadReckoningService,
        TurnGuidanceService,
        { provide: OfflineStorageService, useValue: offlineStorageMock },
        { provide: NetworkStatusService, useValue: networkStatusMock }
      ]
    });

    loaderService = TestBed.inject(RouteLoaderService);
    projectionService = TestBed.inject(RouteProjectionService);
    deadReckoningService = TestBed.inject(DeadReckoningService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    deadReckoningService.stop();
    httpMock.verify();
    vi.restoreAllMocks();
  });

  describe('RouteLoaderService Guidance Track Integration', () => {
    it('should initialize with hasGuidanceTrack = false and empty guidanceTrackPoints', () => {
      expect(loaderService.hasGuidanceTrack()).toBe(false);
      expect(loaderService.guidanceTrackPoints().length).toBe(0);
    });

    it('should initially fall back to raw GPX track points when loading a route', () => {
      loaderService.loadRoute('test-route');

      httpMock.expectOne('/data/routes/test-route/places.json').flush([]);
      httpMock.expectOne('/data/routes/test-route/route-track.json').flush({
        total_km: 1.5,
        total_miles: 0.93,
        points: mockRawPoints
      });
      httpMock.expectOne('/data/routes/test-route/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/test-route/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/test-route/passes.json').flush([]);
      httpMock.expectOne('/data/routes/test-route/milestones.json').flush([]);

      // Initially, guidanceTrackPoints equals raw track points
      expect(loaderService.trackPoints()).toEqual(mockRawPoints);
      expect(loaderService.guidanceTrackPoints()).toEqual(mockRawPoints);
      expect(loaderService.hasGuidanceTrack()).toBe(false);
    });

    it('should load guidance-track.json when present and activate hasGuidanceTrack', async () => {
      loaderService.loadRoute('silk-road');

      httpMock.expectOne('/data/routes/silk-road/places.json').flush([]);
      httpMock.expectOne('/data/routes/silk-road/route-track.json').flush({
        total_km: 1.5,
        total_miles: 0.93,
        points: mockRawPoints
      });
      httpMock.expectOne('/data/routes/silk-road/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/silk-road/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/silk-road/passes.json').flush([]);
      httpMock.expectOne('/data/routes/silk-road/milestones.json').flush([]);

      // Mock fetch resolving guidance-track.json
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_km: 1.52,
            total_miles: 0.94,
            points: mockGuidancePoints
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await loaderService.loadGuidanceTrack('silk-road');

      expect(loaderService.hasGuidanceTrack()).toBe(true);
      expect(loaderService.guidanceTrackPoints()).toEqual(mockGuidancePoints);
      expect(loaderService.trackPoints()).toEqual(mockRawPoints);
    });

    it('should gracefully retain raw track points if guidance-track.json returns 404', async () => {
      loaderService.loadRoute('unknown-route');

      httpMock.expectOne('/data/routes/unknown-route/places.json').flush([]);
      httpMock.expectOne('/data/routes/unknown-route/route-track.json').flush({
        total_km: 1.5,
        total_miles: 0.93,
        points: mockRawPoints
      });
      httpMock.expectOne('/data/routes/unknown-route/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/unknown-route/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/unknown-route/passes.json').flush([]);
      httpMock.expectOne('/data/routes/unknown-route/milestones.json').flush([]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      await loaderService.loadGuidanceTrack('unknown-route');

      expect(loaderService.hasGuidanceTrack()).toBe(false);
      expect(loaderService.guidanceTrackPoints()).toEqual(mockRawPoints);
    });

    it('should restore guidance track from cached RouteDataPackage in applyRoutePackage', () => {
      const pkg: RouteDataPackage = {
        routeId: 'cached-route',
        track: { total_km: 1.5, total_miles: 0.93, points: mockRawPoints },
        guidanceTrack: { total_km: 1.52, total_miles: 0.94, points: mockGuidancePoints },
        places: [],
        surfaces: [],
        climbs: [],
        passes: [],
        milestones: [],
        cachedAt: Date.now()
      };

      loaderService.applyRoutePackage(pkg);

      expect(loaderService.hasGuidanceTrack()).toBe(true);
      expect(loaderService.guidanceTrackPoints()).toEqual(mockGuidancePoints);
      expect(loaderService.trackPoints()).toEqual(mockRawPoints);
    });

    it('should reset guidanceTrackPoints and hasGuidanceTrack on unloadRoute()', () => {
      loaderService.guidanceTrackPoints.set(mockGuidancePoints);
      loaderService.hasGuidanceTrack.set(true);

      loaderService.unloadRoute();

      expect(loaderService.hasGuidanceTrack()).toBe(false);
      expect(loaderService.guidanceTrackPoints().length).toBe(0);
    });
  });

  describe('RouteProjectionService Guidance Integration', () => {
    it('should project onto guidance track points when available', () => {
      loaderService.trackPoints.set(mockRawPoints);
      loaderService.guidanceTrackPoints.set(mockGuidancePoints);

      // Coordinate matching intermediate guidance vertex
      const result = projectionService.projectOntoRoute(42.00500, 72.00498);
      expect(result).toBeTruthy();
      expect(result!.distanceKm).toBeCloseTo(0.0, 2);
      expect(result!.projectedRouteKm).toBeCloseTo(0.8, 1);
    });

    it('should fall back to raw GPX track points when guidance track is not available', () => {
      loaderService.trackPoints.set(mockRawPoints);
      loaderService.guidanceTrackPoints.set([]);

      const result = projectionService.projectOntoRoute(42.00500, 72.00500);
      expect(result).toBeTruthy();
      expect(result!.distanceKm).toBeCloseTo(0.0, 2);
    });
  });

  describe('Route Switching Lifecycle', () => {
    it('should switch from a route with guidance to a route without guidance without state leakage', async () => {
      // 1. Load Route A (with guidance)
      loaderService.loadRoute('route-a');
      httpMock.expectOne('/data/routes/route-a/places.json').flush([]);
      httpMock.expectOne('/data/routes/route-a/route-track.json').flush({
        total_km: 1.5,
        total_miles: 0.93,
        points: mockRawPoints
      });
      httpMock.expectOne('/data/routes/route-a/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/route-a/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/route-a/passes.json').flush([]);
      httpMock.expectOne('/data/routes/route-a/milestones.json').flush([]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ total_km: 1.52, total_miles: 0.94, points: mockGuidancePoints }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      await loaderService.loadGuidanceTrack('route-a');

      expect(loaderService.hasGuidanceTrack()).toBe(true);
      expect(loaderService.guidanceTrackPoints()).toEqual(mockGuidancePoints);

      // 2. Switch to Route B (without guidance track -> 404)
      const mockRouteBPoints: [number, number, number, number, number][] = [
        [43.0, 73.0, 500, 0.0, 0.0],
        [43.1, 73.1, 550, 2.0, 1.24]
      ];

      loaderService.loadRoute('route-b');
      expect(loaderService.hasGuidanceTrack()).toBe(false);
      expect(loaderService.guidanceTrackPoints().length).toBe(0);

      httpMock.expectOne('/data/routes/route-b/places.json').flush([]);
      httpMock.expectOne('/data/routes/route-b/route-track.json').flush({
        total_km: 2.0,
        total_miles: 1.24,
        points: mockRouteBPoints
      });
      httpMock.expectOne('/data/routes/route-b/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/route-b/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/route-b/passes.json').flush([]);
      httpMock.expectOne('/data/routes/route-b/milestones.json').flush([]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );
      await loaderService.loadGuidanceTrack('route-b');

      // Must fall back to Route B raw points and NOT retain Route A guidance
      expect(loaderService.hasGuidanceTrack()).toBe(false);
      expect(loaderService.trackPoints()).toEqual(mockRouteBPoints);
      expect(loaderService.guidanceTrackPoints()).toEqual(mockRouteBPoints);
    });
  });

  describe('DeadReckoningService Guidance Track Integration', () => {
    it('should project and interpolate along guidance track coordinates when available', () => {
      loaderService.trackPoints.set(mockRawPoints);
      loaderService.guidanceTrackPoints.set(mockGuidancePoints);
      loaderService.hasGuidanceTrack.set(true);

      // Initialize fix at mile 0.5 (which corresponds to mockGuidancePoints[1])
      deadReckoningService.updateGpsFix({
        latitude: 42.000,
        longitude: 72.000,
        timestamp: 10000,
        projectedMile: 0.50,
        heading: 45
      }, 0);

      const coords = deadReckoningService.interpolatedCoords();
      expect(coords).toBeTruthy();
      // Should match mockGuidancePoints[1] ([42.00500, 72.00498]), not raw track
      expect(coords![0]).toBeCloseTo(42.00500, 4);
      expect(coords![1]).toBeCloseTo(72.00498, 4);
    });
  });
});
