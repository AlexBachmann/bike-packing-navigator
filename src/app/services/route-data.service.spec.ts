import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteDataService } from './route-data.service';
import { isSelfServiceWaschsalon } from '../models/waypoint.model';
import { OfflineStorageService } from './offline-storage.service';
import { NetworkStatusService } from './network-status.service';

describe('RouteDataService', () => {
  let service: RouteDataService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(RouteDataService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created without making any initial HTTP requests (on-demand loading)', () => {
    expect(service).toBeTruthy();
    expect(service.places().length).toBe(0);
    expect(service.trackPoints().length).toBe(0);
    expect(service.activeRouteId()).toBeNull();
  });

  it('should fetch per-route static files on loadRoute()', () => {
    service.loadRoute('tour-divide-2025');

    const reqPlaces = httpMock.expectOne('/data/routes/tour-divide-2025/places.json');
    expect(reqPlaces.request.method).toBe('GET');
    reqPlaces.flush([
      { id: 'p1', name: 'Banff', route_mile: 0, category: 'town', type: 'town', location: { lat: 51, lon: -115 } }
    ]);

    const reqTrack = httpMock.expectOne('/data/routes/tour-divide-2025/route-track.json');
    expect(reqTrack.request.method).toBe('GET');
    reqTrack.flush({ total_km: 4311.8, total_miles: 2679.2, points: [[51, -115, 1400, 0, 0]] });

    const reqSurfaces = httpMock.expectOne('/data/routes/tour-divide-2025/surfaces.json');
    expect(reqSurfaces.request.method).toBe('GET');
    reqSurfaces.flush([]);

    const reqClimbs = httpMock.expectOne('/data/routes/tour-divide-2025/climbs.json');
    expect(reqClimbs.request.method).toBe('GET');
    reqClimbs.flush([]);

    const reqPasses = httpMock.expectOne('/data/routes/tour-divide-2025/passes.json');
    expect(reqPasses.request.method).toBe('GET');
    reqPasses.flush([]);

    const reqMilestones = httpMock.expectOne('/data/routes/tour-divide-2025/milestones.json');
    expect(reqMilestones.request.method).toBe('GET');
    reqMilestones.flush([]);

    expect(service.places().length).toBe(1);
    expect(service.trackPoints().length).toBe(1);
    expect(service.activeRouteId()).toBe('tour-divide-2025');
  });

  it('should flush previous data and load new files when switching to colorado-trail', () => {
    service.loadRoute('colorado-trail');

    httpMock.expectOne('/data/routes/colorado-trail/places.json').flush([]);
    httpMock.expectOne('/data/routes/colorado-trail/route-track.json').flush({
      total_km: 861,
      total_miles: 535,
      points: [[39, -105, 1670, 0, 0]]
    });
    httpMock.expectOne('/data/routes/colorado-trail/surfaces.json').flush([]);
    httpMock.expectOne('/data/routes/colorado-trail/climbs.json').flush([]);
    httpMock.expectOne('/data/routes/colorado-trail/passes.json').flush([]);
    httpMock.expectOne('/data/routes/colorado-trail/milestones.json').flush([]);

    expect(service.activeRouteId()).toBe('colorado-trail');
    expect(service.totalDistanceMiles).toBe(535);
  });

  it('should load route from IndexedDB without network requests when offline', async () => {
    const offlineStorage = TestBed.inject(OfflineStorageService);
    const networkStatus = TestBed.inject(NetworkStatusService);

    await offlineStorage.saveRoutePackage({
      routeId: 'colorado-trail',
      track: { total_km: 861, total_miles: 535, points: [[39, -105, 1670, 0, 0]] },
      places: [
        {
          id: 'p1',
          name: 'Waterton',
          route_mile: 0,
          route_km: 0,
          category: 'town',
          type: 'town',
          is_in_town: true,
          location: { lat: 39, lon: -105 },
          distance_to_trail_km: 0
        }
      ],
      surfaces: [],
      climbs: [],
      passes: [],
      milestones: [],
      cachedAt: Date.now()
    });

    networkStatus.setOnline(false);
    service.loadRoute('colorado-trail');

    // Wait for promise resolution
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.activeRouteId()).toBe('colorado-trail');
    expect(service.places().length).toBe(1);
    expect(service.trackPoints().length).toBe(1);
    expect(service.totalDistanceMiles).toBe(535);
    httpMock.expectNone('/data/routes/colorado-trail/places.json');

    networkStatus.setOnline(true);
  });

  describe('projectOntoRoute', () => {
    beforeEach(() => {
      service.trackPoints.set([
        [51.0, -115.0, 1400, 0.0, 0.0],
        [51.0, -114.0, 1400, 70.0, 43.5],
        [50.0, -114.0, 1400, 180.0, 111.8]
      ]);
    });

    it('should return null if no track points are loaded', () => {
      service.trackPoints.set([]);
      expect(service.projectOntoRoute(51.0, -115.0)).toBeNull();
    });

    it('should accurately project point on the route (Banff Mile 0.0)', () => {
      const proj = service.projectOntoRoute(51.0, -115.0);
      expect(proj).not.toBeNull();
      expect(proj!.distanceKm).toBe(0);
      expect(proj!.projectedRouteMile).toBe(0);
      expect(proj!.isOffRoute).toBe(false);
    });

    it('should perform orthogonal projection for point within 10 km', () => {
      // 51.05, -114.5 is about 5.5 km north of segment [51.0, -115.0] -> [51.0, -114.0]
      const proj = service.projectOntoRoute(51.05, -114.5);
      expect(proj).not.toBeNull();
      expect(proj!.distanceKm).toBeLessThan(10.0);
      expect(proj!.isOffRoute).toBe(false);
      expect(proj!.projectedRouteMile).toBeCloseTo(21.8, 0);
    });

    it('should flag rider as off route when distance exceeds 10 km', () => {
      // 51.5, -114.5 is ~55 km north of route
      const proj = service.projectOntoRoute(51.5, -114.5);
      expect(proj).not.toBeNull();
      expect(proj!.distanceKm).toBeGreaterThan(10.0);
      expect(proj!.isOffRoute).toBe(true);
    });
  });

  describe('isSelfServiceWaschsalon & Laundry filtering', () => {
    it('should distinguish genuine self-service Waschsalons from commercial/carpet cleaners', () => {
      // Genuine Waschsalons (coin/card self-service laundromats)
      expect(isSelfServiceWaschsalon('Cascade Coin Laundry')).toBe(true);
      expect(isSelfServiceWaschsalon('Eureka Laundromat')).toBe(true);
      expect(isSelfServiceWaschsalon('Launderette and Showers')).toBe(true);
      expect(isSelfServiceWaschsalon('Oak Creek Wash House')).toBe(true);
      expect(isSelfServiceWaschsalon('12th St Laundryland')).toBe(true);
      expect(isSelfServiceWaschsalon('Aquamarine Coin & Commercial Laundry')).toBe(true);

      // Excluded: commercial cleaning, carpet cleaners, janitorial, maid services, dry cleaners
      expect(isSelfServiceWaschsalon('Goldstar Cleaning Services')).toBe(false);
      expect(isSelfServiceWaschsalon('Busy Bee Janitorial')).toBe(false);
      expect(isSelfServiceWaschsalon('Maid In Montana LLC')).toBe(false);
      expect(isSelfServiceWaschsalon('SERVPRO of Chaffee, Fremont, Teller Counties')).toBe(false);
      expect(isSelfServiceWaschsalon('Flathead Valley Restoration, LLC')).toBe(false);
      expect(isSelfServiceWaschsalon('Armstrong Floor & Wall')).toBe(false);
      expect(isSelfServiceWaschsalon('City Cleaners')).toBe(false);
      expect(isSelfServiceWaschsalon('Commercial Laundry')).toBe(false);
    });

    it('should filter out non-Waschsalons in calculateWaypointsAhead', () => {
      service.places.set([
        {
          id: 'l1',
          name: 'Cascade Coin Laundry',
          category: 'laundromat',
          type: 'coin_laundry',
          route_mile: 10.0,
          route_km: 16.1,
          is_in_town: true,
          location: { lat: 51.17, lon: -115.57 },
          distance_to_trail_km: 1.0
        },
        {
          id: 'l2',
          name: 'SERVPRO Carpet Cleaning',
          category: 'laundromat',
          type: 'laundromat',
          route_mile: 12.0,
          route_km: 19.3,
          is_in_town: true,
          location: { lat: 51.18, lon: -115.58 },
          distance_to_trail_km: 1.0
        }
      ]);

      const waypoints = service.calculateWaypointsAhead(0, 10, new Set(['laundromat']));
      expect(waypoints.length).toBe(1);
      expect(waypoints[0].name).toBe('Cascade Coin Laundry');
    });
  });

  describe('in-flight subscription cancellation', () => {
    it('should cancel in-flight HTTP requests when switching routes rapidly', () => {
      // 1. Request initial route
      service.loadRoute('tour-divide-2025');

      const tdPlaces = httpMock.expectOne('/data/routes/tour-divide-2025/places.json');
      const tdTrack = httpMock.expectOne('/data/routes/tour-divide-2025/route-track.json');
      const tdSurfaces = httpMock.expectOne('/data/routes/tour-divide-2025/surfaces.json');
      const tdClimbs = httpMock.expectOne('/data/routes/tour-divide-2025/climbs.json');
      const tdPasses = httpMock.expectOne('/data/routes/tour-divide-2025/passes.json');
      const tdMilestones = httpMock.expectOne('/data/routes/tour-divide-2025/milestones.json');

      expect(tdPlaces.cancelled).toBe(false);

      // 2. Rapidly switch to colorado-trail while tour-divide-2025 is in flight
      service.loadRoute('colorado-trail');

      // In-flight TD requests must be cancelled immediately
      expect(tdPlaces.cancelled).toBe(true);
      expect(tdTrack.cancelled).toBe(true);
      expect(tdSurfaces.cancelled).toBe(true);
      expect(tdClimbs.cancelled).toBe(true);
      expect(tdPasses.cancelled).toBe(true);
      expect(tdMilestones.cancelled).toBe(true);

      // 3. Flush responses for the active route (colorado-trail)
      httpMock.expectOne('/data/routes/colorado-trail/places.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/route-track.json').flush({
        total_km: 861,
        total_miles: 535,
        points: [[39, -105, 1670, 0, 0]]
      });
      httpMock.expectOne('/data/routes/colorado-trail/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/passes.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/milestones.json').flush([]);

      expect(service.activeRouteId()).toBe('colorado-trail');
      expect(service.totalDistanceMiles).toBe(535);
    });

    it('should cancel in-flight HTTP requests when unloadRoute() is called', () => {
      service.loadRoute('tour-divide-2025');

      const tdPlaces = httpMock.expectOne('/data/routes/tour-divide-2025/places.json');
      const tdTrack = httpMock.expectOne('/data/routes/tour-divide-2025/route-track.json');
      const tdSurfaces = httpMock.expectOne('/data/routes/tour-divide-2025/surfaces.json');
      const tdClimbs = httpMock.expectOne('/data/routes/tour-divide-2025/climbs.json');
      const tdPasses = httpMock.expectOne('/data/routes/tour-divide-2025/passes.json');
      const tdMilestones = httpMock.expectOne('/data/routes/tour-divide-2025/milestones.json');

      expect(tdPlaces.cancelled).toBe(false);

      // Unload route
      service.unloadRoute();

      expect(tdPlaces.cancelled).toBe(true);
      expect(tdTrack.cancelled).toBe(true);
      expect(tdSurfaces.cancelled).toBe(true);
      expect(tdClimbs.cancelled).toBe(true);
      expect(tdPasses.cancelled).toBe(true);
      expect(tdMilestones.cancelled).toBe(true);
      expect(service.activeRouteId()).toBeNull();
      expect(service.places().length).toBe(0);
      expect(service.isLoading()).toBe(false);
    });
  });
});
