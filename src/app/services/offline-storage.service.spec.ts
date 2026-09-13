import { TestBed } from '@angular/core/testing';
import { OfflineStorageService } from './offline-storage.service';
import { RouteDataPackage } from '../models/route.model';

describe('OfflineStorageService', () => {
  let service: OfflineStorageService;

  const mockPackage: RouteDataPackage = {
    routeId: 'tour-divide-2025',
    track: {
      total_km: 4311.8,
      total_miles: 2679.2,
      points: [[51.16, -115.56, 1408, 0, 0]]
    },
    places: [
      {
        id: 'p1',
        name: 'Banff Springs',
        category: 'town',
        type: 'town',
        is_in_town: true,
        location: { lat: 51.16, lon: -115.56 },
        distance_to_trail_km: 0,
        route_mile: 0,
        route_km: 0
      }
    ],
    surfaces: [
      [0, 10, 'track', 'gravel', 'grade2']
    ],
    climbs: [],
    passes: [],
    milestones: [{ name: 'Banff', mile: 0 }],
    cachedAt: 1700000000000
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OfflineStorageService]
    });
    service = TestBed.inject(OfflineStorageService);
    await service.clearAll();
  });

  it('should be created with DB name bikepack-offline-v1 and store route-packages', () => {
    expect(service).toBeTruthy();
    expect(service.DB_NAME).toBe('bikepack-offline-v1');
    expect(service.STORE_NAME).toBe('route-packages');
  });

  it('should report false for uncached route', async () => {
    const cached = await service.isRouteCached('colorado-trail');
    expect(cached).toBe(false);
    expect(service.isRouteCachedSync('colorado-trail')).toBe(false);
  });

  it('should save route package and retrieve it', async () => {
    await service.saveRoutePackage(mockPackage);

    const isCached = await service.isRouteCached('tour-divide-2025');
    expect(isCached).toBe(true);
    expect(service.isRouteCachedSync('tour-divide-2025')).toBe(true);

    const retrieved = await service.getRoutePackage('tour-divide-2025');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.routeId).toBe('tour-divide-2025');
    expect(retrieved?.track.total_miles).toBe(2679.2);
    expect(retrieved?.places.length).toBe(1);
    expect(retrieved?.places[0].name).toBe('Banff Springs');
  });

  it('should list cached route IDs', async () => {
    await service.saveRoutePackage(mockPackage);
    const ctPkg: RouteDataPackage = {
      ...mockPackage,
      routeId: 'colorado-trail',
      track: { total_km: 861, total_miles: 535, points: [] }
    };
    await service.saveRoutePackage(ctPkg);

    const ids = await service.getCachedRouteIds();
    expect(ids.length).toBe(2);
    expect(ids).toContain('tour-divide-2025');
    expect(ids).toContain('colorado-trail');
  });

  it('should remove a single route package', async () => {
    await service.saveRoutePackage(mockPackage);
    expect(await service.isRouteCached('tour-divide-2025')).toBe(true);

    await service.removeRoutePackage('tour-divide-2025');
    expect(await service.isRouteCached('tour-divide-2025')).toBe(false);
    expect(await service.getRoutePackage('tour-divide-2025')).toBeNull();
  });

  it('should clear all route packages', async () => {
    await service.saveRoutePackage(mockPackage);
    await service.clearAll();

    expect(await service.isRouteCached('tour-divide-2025')).toBe(false);
    const ids = await service.getCachedRouteIds();
    expect(ids.length).toBe(0);
  });
});
