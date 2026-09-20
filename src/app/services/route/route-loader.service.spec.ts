import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteLoaderService, mergeWaterPlaces } from './route-loader.service';
import { Place } from '../../models/waypoint.model';
import { OfflineStorageService } from '../offline-storage.service';
import { NetworkStatusService } from '../network-status.service';
import { signal } from '@angular/core';

describe('RouteLoaderService', () => {
  let service: RouteLoaderService;
  let httpMock: HttpTestingController;
  let offlineStorageMock: any;
  let networkStatusMock: any;

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
        { provide: OfflineStorageService, useValue: offlineStorageMock },
        { provide: NetworkStatusService, useValue: networkStatusMock }
      ]
    });

    service = TestBed.inject(RouteLoaderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created in uninitialized state', () => {
    expect(service).toBeTruthy();
    expect(service.places().length).toBe(0);
    expect(service.trackPoints().length).toBe(0);
    expect(service.activeRouteId()).toBeNull();
  });

  it('should load route assets and normalize recreation sites', () => {
    service.loadRoute('test-route');

    const reqPlaces = httpMock.expectOne('/data/routes/test-route/places.json');
    reqPlaces.flush([
      { id: 'p1', name: 'Blue Ridge Rec Site', route_mile: 5, category: 'lodging', type: 'lodging' }
    ]);
    httpMock.expectOne('/data/routes/test-route/route-track.json').flush({
      total_km: 100,
      total_miles: 62.1,
      points: [[35.0, -111.0, 2000, 0, 0]]
    });
    httpMock.expectOne('/data/routes/test-route/surfaces.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/climbs.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/passes.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/milestones.json').flush([]);

    expect(service.activeRouteId()).toBe('test-route');
    expect(service.places().length).toBe(1);
    expect(service.places()[0].category).toBe('campground');
    expect(service.totalDistanceMiles).toBe(62.1);
    expect(service.totalDistanceKm).toBe(100);
  });

  it('should fallback to offline storage when offline', async () => {
    networkStatusMock.isOnline.set(false);
    offlineStorageMock.getRoutePackage.mockResolvedValue({
      routeId: 'cached-route',
      track: { total_km: 50, total_miles: 31, points: [] },
      places: [],
      surfaces: [],
      climbs: [],
      passes: [],
      milestones: [],
      turns: []
    });

    service.loadRoute('cached-route');

    // Wait for microtask resolution
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.activeRouteId()).toBe('cached-route');
    expect(service.totalDistanceKm).toBe(50);
  });

  it('should reset state on unloadRoute()', () => {
    service.loadRoute('test-route');
    httpMock.expectOne('/data/routes/test-route/places.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/route-track.json').flush({ points: [] });
    httpMock.expectOne('/data/routes/test-route/surfaces.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/climbs.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/passes.json').flush([]);
    httpMock.expectOne('/data/routes/test-route/milestones.json').flush([]);

    service.unloadRoute();
    expect(service.activeRouteId()).toBeNull();
    expect(service.places().length).toBe(0);
    expect(service.trackPoints().length).toBe(0);
  });

  describe('mergeWaterPlaces', () => {
    it('should merge, normalize, deduplicate, and sort water waypoints', () => {
      const existing: Place[] = [
        {
          id: 'town-1',
          name: 'Banff',
          category: 'town',
          type: 'locality',
          is_in_town: true,
          location: { lat: 51.1784, lon: -115.5708 },
          distance_to_trail_km: 0,
          route_km: 0,
          route_mile: 0
        },
        {
          id: 'water-existing',
          name: 'Existing Creek',
          category: 'water',
          type: 'water',
          is_in_town: false,
          location: { lat: 50.5, lon: -115.0 },
          distance_to_trail_km: 0.1,
          route_km: 100,
          route_mile: 62.1
        },
        {
          id: 'camp-1',
          name: 'Campground 2',
          category: 'campground',
          type: 'campground',
          is_in_town: false,
          location: { lat: 49.0, lon: -114.5 },
          distance_to_trail_km: 0,
          route_km: 300,
          route_mile: 186.4
        }
      ];

      const waterWaypoints = [
        {
          id: 'water-existing',
          name: 'Existing Creek Updated',
          reliability: 'reliable',
          treatment_required: false,
          tier: 2,
          route_mile: 62.1
        },
        {
          id: 'water-new-1',
          name: 'Dianthus Well',
          coordinates: [42.2722, -108.1017],
          dist_off_route_m: 7,
          mile: 1343.4,
          km: 2162,
          category: 'cache',
          type: 'cache'
        },
        {
          id: 'water-new-2',
          name: 'Battle Spring',
          location: { lat: 41.5, lon: -107.5 },
          distance_to_trail_km: 0.05,
          route_mile: 50.0,
          route_km: 80.5
        }
      ];

      const result = mergeWaterPlaces(existing, waterWaypoints);

      expect(result.length).toBe(5);
      expect(result.map((p) => p.id)).toEqual(['town-1', 'water-new-2', 'water-existing', 'camp-1', 'water-new-1']);

      const dWell = result.find((p) => p.id === 'water-new-1')!;
      expect(dWell.category).toBe('water');
      expect(dWell.location).toEqual({ lat: 42.2722, lon: -108.1017 });
      expect(dWell.distance_to_trail_km).toBe(0.007);
      expect(dWell.route_mile).toBe(1343.4);
      expect(dWell.google_maps_url).toContain('42.2722,-108.1017');

      const existMerged = result.find((p) => p.id === 'water-existing')!;
      expect(existMerged.category).toBe('water');
      expect(existMerged.name).toBe('Existing Creek Updated');
      expect(existMerged.tier).toBe(2);

      expect(result.find((p) => p.id === 'town-1')!.category).toBe('town');
      expect(result.find((p) => p.id === 'camp-1')!.category).toBe('campground');
    });

    it('should return existing places if water data is empty or invalid', () => {
      const existing: Place[] = [
        {
          id: 'town-1',
          name: 'Banff',
          category: 'town',
          type: 'locality',
          is_in_town: true,
          location: { lat: 51.1784, lon: -115.5708 },
          distance_to_trail_km: 0,
          route_km: 0,
          route_mile: 0
        }
      ];

      expect(mergeWaterPlaces(existing, [])).toEqual(existing);
      expect(mergeWaterPlaces(existing, null as any)).toEqual(existing);
    });
  });

  describe('loadWaterAccess', () => {
    it('should progressively load water_access.json, merge into places, and update offline storage', async () => {
      service.activeRouteId.set('tour-divide-2025');
      service.places.set([
        {
          id: 'town-1',
          name: 'Banff',
          category: 'town',
          type: 'locality',
          is_in_town: true,
          location: { lat: 51.1784, lon: -115.5708 },
          distance_to_trail_km: 0,
          route_km: 0,
          route_mile: 0
        }
      ]);

      const mockWater = [
        {
          id: 'water-1',
          name: 'Dianthus Well',
          coordinates: [42.2722, -108.1017],
          dist_off_route_m: 7,
          mile: 1343.4,
          km: 2162
        }
      ];

      const mockPkg = {
        routeId: 'tour-divide-2025',
        places: service.places()
      };
      offlineStorageMock.getRoutePackage.mockResolvedValue(mockPkg);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockWater), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      await service.loadWaterAccess('tour-divide-2025');

      expect(service.places().length).toBe(2);
      expect(service.places()[1].id).toBe('water-1');
      expect(service.places()[1].category).toBe('water');
      expect(offlineStorageMock.saveRoutePackage).toHaveBeenCalled();
    });

    it('should fallback to water_bothies.json when water_access.json returns 404', async () => {
      service.activeRouteId.set('highland-trail-550');
      service.places.set([]);

      const mockBothies = [
        {
          id: 'bothy-1',
          name: 'Ben Alder',
          category: 'campground',
          coordinates: [56.78, -4.47],
          mile: 50.0
        }
      ];

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockBothies), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        );

      await service.loadWaterAccess('highland-trail-550');

      expect(service.places().length).toBe(1);
      expect(service.places()[0].id).toBe('bothy-1');
      expect(service.places()[0].category).toBe('water');
    });

    it('should handle fetch errors gracefully without throwing or mutating error signal', async () => {
      service.activeRouteId.set('colorado-trail');
      service.error.set(null);

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await expect(service.loadWaterAccess('colorado-trail')).resolves.not.toThrow();
      expect(service.error()).toBeNull();
    });
  });
});
