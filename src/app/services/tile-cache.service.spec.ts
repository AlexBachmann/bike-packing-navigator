import { TestBed } from '@angular/core/testing';
import {
  TileCacheService,
  lat2tile,
  lon2tile,
  tile2lat,
  tile2lon,
  getTileUrlsForCoordinate
} from './tile-cache.service';
import { RouteSummary } from '../models/route.model';

describe('TileCacheService', () => {
  let service: TileCacheService;

  const mockRouteSummary: RouteSummary = {
    id: 'colorado-trail',
    name: 'Colorado Trail',
    shortName: 'CT',
    startLocation: 'Denver, CO',
    endLocation: 'Durango, CO',
    totalDistanceMiles: 535.0,
    totalDistanceKm: 861.0,
    elevationGainFt: 89000,
    elevationGainM: 27127,
    iconicCheckpoints: ['Waterton Canyon', 'Durango'],
    description: 'A rugged high-altitude singletrack across the Colorado Rocky Mountains',
    startCoordinates: [39.4912, -105.0945],
    bounds: [
      [37.2753, -107.8801],
      [39.4912, -105.0945]
    ]
  };

  // Valid 1x1 transparent PNG binary bytes for realistic responses
  const MOCK_PNG_DATA = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, // PNG magic bytes
    0, 0, 0, 13, 73, 72, 68, 82,     // IHDR chunk
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137
  ]);

  function createMockImageResponse(): Response {
    return new Response(MOCK_PNG_DATA, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    });
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [TileCacheService]
    });
    service = TestBed.inject(TileCacheService);
    await service.clearTileCache();

    // Default mock: genuine binary image fetch response
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      return createMockImageResponse();
    });
  });

  afterEach(async () => {
    await service.clearTileCache();
    vi.restoreAllMocks();
  });

  it('should calculate correct slippy map tile coordinates', () => {
    // Denver approx 39.7392 N, 104.9903 W at zoom 5
    const x = lon2tile(-104.9903, 5);
    const y = lat2tile(39.7392, 5);
    expect(x).toBe(6);
    expect(y).toBe(12);

    // Invert should be close
    expect(tile2lon(x, 5)).toBeCloseTo(-112.5, 0);
    expect(tile2lat(y, 5)).toBeCloseTo(40.9, 0);
  });

  it('should generate tile URLs for coordinates across styles', () => {
    const urls = getTileUrlsForCoordinate(5, 6, 12);
    expect(urls.length).toBe(4);
    expect(urls[0]).toContain('Canvas/World_Dark_Gray_Base/MapServer/tile/5/12/6');
    expect(urls[1]).toContain('Canvas/World_Dark_Gray_Reference/MapServer/tile/5/12/6');
    expect(urls[2]).toContain('World_Topo_Map/MapServer/tile/5/12/6');
    expect(urls[3]).toContain('tile.openstreetmap.org/5/6/12.png');
  });

  it('should use cache name bikepack-map-tiles-v1', () => {
    expect(service.cacheName).toBe('bikepack-map-tiles-v1');
  });

  it('should cache tiles for route within zoom bounds via genuine fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createMockImageResponse());
    const count = await service.cacheTilesForRoute(mockRouteSummary, 5, 5);

    expect(count).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalled();
    const firstCallArgs = fetchSpy.mock.calls[0];
    expect(firstCallArgs[1]).toEqual(expect.objectContaining({ mode: 'cors' }));
    expect(await service.getCachedTileCount()).toBeGreaterThan(0);
  });

  it('should store and retrieve tiles via putTile and getTile', async () => {
    const testUrl = 'https://tile.openstreetmap.org/5/6/12.png';
    const resp = createMockImageResponse();
    await service.putTile(testUrl, resp);

    expect(await service.hasTile(testUrl)).toBe(true);
    const retrieved = await service.getTile(testUrl);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe(200);

    // Verify response body can be read
    const blob = await retrieved!.blob();
    expect(blob.size).toBe(MOCK_PNG_DATA.length);

    // Verify subsequent getTile returns an unconsumed clone
    const retrievedSecond = await service.getTile(testUrl);
    expect(retrievedSecond).not.toBeNull();
    const blob2 = await retrievedSecond!.blob();
    expect(blob2.size).toBe(MOCK_PNG_DATA.length);
  });

  it('should cache corridor tiles from coordinate array', async () => {
    const points: [number, number, number, number, number][] = [
      [39.4912, -105.0945, 1670, 0, 0],
      [37.2753, -107.8801, 1995, 861, 535]
    ];
    const count = await service.cacheCorridorTiles(points, 5, 5);
    expect(count).toBeGreaterThan(0);
    expect(await service.getCachedTileCount()).toBeGreaterThan(0);
  });

  it('should clear tile cache', async () => {
    await service.cacheTilesForRoute(mockRouteSummary, 5, 5);
    expect(await service.getCachedTileCount()).toBeGreaterThan(0);

    await service.clearTileCache();
    expect(await service.getCachedTileCount()).toBe(0);
  });

  it('should handle network errors gracefully during tile caching (offline resilience)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const count = await service.cacheTilesForRoute(mockRouteSummary, 5, 5);
    expect(count).toBeGreaterThan(0);
    expect(await service.getCachedTileCount()).toBe(0);
  });

  it('should not cache non-ok HTTP responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const count = await service.cacheTilesForRoute(mockRouteSummary, 5, 5);
    expect(count).toBeGreaterThan(0);
    expect(await service.getCachedTileCount()).toBe(0);
  });

  it('should avoid duplicate network requests for already cached tiles', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createMockImageResponse());

    await service.cacheTilesForRoute(mockRouteSummary, 5, 5);
    const firstCount = fetchSpy.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    fetchSpy.mockClear();
    await service.cacheTilesForRoute(mockRouteSummary, 5, 5);
    expect(fetchSpy.mock.calls.length).toBe(0);
  });
});
