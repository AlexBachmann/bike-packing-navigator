import { TestBed } from '@angular/core/testing';
import { PmtilesDbService } from './pmtiles-db.service';

describe('PmtilesDbService', () => {
  let service: PmtilesDbService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PmtilesDbService]
    });
    service = TestBed.inject(PmtilesDbService);
  });

  afterEach(async () => {
    await service.clearAllArchives();
  });

  it('should construct composite keys properly', () => {
    expect(service.buildKey('tour-divide-2025')).toBe('tour-divide-2025');
    expect(service.buildKey('tour-divide-2025', '1')).toBe('tour-divide-2025/1');
  });

  it('should save, query, and retrieve archives in memory/IndexedDB', async () => {
    const blob = new Blob(['sample-pmtiles-bytes'], { type: 'application/octet-stream' });
    await service.saveArchive('test-route', blob);

    expect(service.isRouteCachedSync('test-route')).toBe(true);
    const cachedAsync = await service.isRouteCached('test-route');
    expect(cachedAsync).toBe(true);

    const retrieved = await service.getArchive('test-route');
    expect(retrieved).toBeTruthy();
    expect(retrieved!.size).toBe(blob.size);
  });

  it('should handle section-level archives and calculations', async () => {
    const blob1 = new Blob(['12345'], { type: 'application/octet-stream' });
    const blob2 = new Blob(['6789012'], { type: 'application/octet-stream' });

    await service.saveArchive('multi-route', blob1, '1');
    await service.saveArchive('multi-route', blob2, '2');

    expect(service.isSectionCached('multi-route', '1')).toBe(true);
    expect(service.isRouteCachedSync('multi-route')).toBe(true);

    const routeBytes = await service.getRouteStorageBytes('multi-route');
    expect(routeBytes).toBe(blob1.size + blob2.size);

    const cachedIds = await service.getCachedRouteIds();
    expect(cachedIds).toContain('multi-route');
  });

  it('should delete section and entire route archives', async () => {
    const blob = new Blob(['data'], { type: 'application/octet-stream' });
    await service.saveArchive('del-route', blob, 'sec1');
    await service.saveArchive('del-route', blob, 'sec2');

    await service.deleteArchive('del-route', 'sec1');
    expect(service.isSectionCached('del-route', 'sec1')).toBe(false);
    expect(service.isSectionCached('del-route', 'sec2')).toBe(true);

    await service.deleteRouteArchives('del-route');
    expect(service.isRouteCachedSync('del-route')).toBe(false);
  });
});
