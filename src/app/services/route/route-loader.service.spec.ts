import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteLoaderService } from './route-loader.service';
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
});
