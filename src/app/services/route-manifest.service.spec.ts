import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteManifestService } from './route-manifest.service';
import { NetworkStatusService } from './network-status.service';
import { OfflineStorageService } from './offline-storage.service';
import { ToastService } from './toast.service';
import { RouteSummary } from '../models/route.model';

describe('RouteManifestService', () => {
  let service: RouteManifestService;
  let httpMock: HttpTestingController;
  let networkStatus: NetworkStatusService;
  let offlineStorage: OfflineStorageService;
  let toastService: ToastService;

  const mockRoutes: RouteSummary[] = [
    {
      id: 'tour-divide-2025',
      name: 'Tour Divide 2025',
      shortName: 'TD',
      startLocation: 'Banff, AB',
      endLocation: 'Antelope Wells, NM',
      totalDistanceMiles: 2679.2,
      totalDistanceKm: 4311.8,
      elevationGainFt: 149600,
      elevationGainM: 45600,
      iconicCheckpoints: ['Banff', 'Antelope Wells'],
      description: 'Tour Divide route',
      startCoordinates: [51.16, -115.56],
      bounds: [[31.33, -115.56], [51.16, -108.53]]
    },
    {
      id: 'colorado-trail',
      name: 'Colorado Trail',
      shortName: 'CT',
      startLocation: 'Denver, CO',
      endLocation: 'Durango, CO',
      totalDistanceMiles: 535.0,
      totalDistanceKm: 861.0,
      elevationGainFt: 89000,
      elevationGainM: 27127,
      iconicCheckpoints: ['Denver', 'Durango'],
      description: 'Colorado Trail route',
      startCoordinates: [39.49, -105.09],
      bounds: [[37.27, -107.88], [39.49, -105.09]]
    }
  ];

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RouteManifestService,
        NetworkStatusService,
        OfflineStorageService,
        ToastService
      ]
    });
    service = TestBed.inject(RouteManifestService);
    httpMock = TestBed.inject(HttpTestingController);
    networkStatus = TestBed.inject(NetworkStatusService);
    offlineStorage = TestBed.inject(OfflineStorageService);
    toastService = TestBed.inject(ToastService);

    networkStatus.setOnline(true);
    toastService.clear();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should load route manifest from /data/routes.json', () => {
    service.loadManifest().subscribe((routes) => {
      expect(routes.length).toBe(2);
      expect(service.availableRoutes().length).toBe(2);
    });

    const req = httpMock.expectOne('/data/routes.json');
    expect(req.request.method).toBe('GET');
    req.flush({ routes: mockRoutes });
  });

  it('should validate route existence with validateRouteId', () => {
    service.availableRoutes.set(mockRoutes);
    expect(service.validateRouteId('tour-divide-2025')).toBe(true);
    expect(service.validateRouteId('colorado-trail')).toBe(true);
    expect(service.validateRouteId('unknown-route')).toBe(false);
  });

  it('should switch routes when online', async () => {
    service.availableRoutes.set(mockRoutes);
    const success = await service.selectRoute('colorado-trail');

    expect(success).toBe(true);
    expect(service.activeRouteId()).toBe('colorado-trail');
    expect(service.activeRouteSummary()?.name).toBe('Colorado Trail');
  });

  it('should block switching to uncached route when offline and show warning toast', async () => {
    service.availableRoutes.set(mockRoutes);
    networkStatus.setOnline(false);

    const success = await service.selectRoute('colorado-trail');
    expect(success).toBe(false);
    expect(service.activeRouteId()).toBeNull();

    const toasts = toastService.activeToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('warning');
    expect(toasts[0].message).toContain('Internet connection required');
    expect(toasts[0].message).toContain('Colorado Trail');
  });

  it('should allow switching to cached route when offline without error', async () => {
    service.availableRoutes.set(mockRoutes);
    await offlineStorage.saveRoutePackage({
      routeId: 'colorado-trail',
      track: { total_km: 861, total_miles: 535, points: [] },
      places: [],
      surfaces: [],
      climbs: [],
      passes: [],
      milestones: [],
      cachedAt: Date.now()
    });

    networkStatus.setOnline(false);

    const success = await service.selectRoute('colorado-trail');
    expect(success).toBe(true);
    expect(service.activeRouteId()).toBe('colorado-trail');
    expect(toastService.activeToasts().length).toBe(0);
  });
});
