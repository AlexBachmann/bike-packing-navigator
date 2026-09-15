import { BlobSource, CompositePMTiles } from './pmtiles-composite.model';
import { PMTiles } from 'pmtiles';

describe('pmtiles-composite.model', () => {
  describe('BlobSource', () => {
    it('should return key and slice bytes accurately', async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const blob = new Blob([data]);
      const source = new BlobSource('test-key', blob);

      expect(source.getKey()).toBe('test-key');

      const res = await source.getBytes(1, 3);
      const read = new Uint8Array(res.data);
      expect(read).toEqual(new Uint8Array([20, 30, 40]));
    });

    it('should throw AbortError if signal is already aborted', async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      const source = new BlobSource('key', blob);
      const controller = new AbortController();
      controller.abort();

      await expect(source.getBytes(0, 2, controller.signal)).rejects.toThrow();
    });
  });

  describe('CompositePMTiles', () => {
    it('should add, remove, and return sections', () => {
      const composite = new CompositePMTiles('comp-route');
      const mockPmtiles = { getHeader: vi.fn() } as unknown as PMTiles;

      composite.addSection('1', mockPmtiles);
      expect(composite.getSections().length).toBe(1);
      expect(composite.getSections()[0].id).toBe('1');

      composite.removeSection('1');
      expect(composite.getSections().length).toBe(0);
    });

    it('should merge headers across sections in getHeader()', async () => {
      const composite = new CompositePMTiles('comp-route');
      const mock1 = {
        getHeader: vi.fn().mockResolvedValue({
          minLon: -115,
          minLat: 45,
          maxLon: -110,
          maxLat: 50,
          minZoom: 0,
          maxZoom: 10
        })
      } as unknown as PMTiles;

      const mock2 = {
        getHeader: vi.fn().mockResolvedValue({
          minLon: -118,
          minLat: 40,
          maxLon: -108,
          maxLat: 48,
          minZoom: 2,
          maxZoom: 12
        })
      } as unknown as PMTiles;

      composite.addSection('1', mock1);
      composite.addSection('2', mock2);

      const header = await composite.getHeader();
      expect(header.minLon).toBe(-118);
      expect(header.minLat).toBe(40);
      expect(header.maxLon).toBe(-108);
      expect(header.maxLat).toBe(50);
      expect(header.minZoom).toBe(0);
      expect(header.maxZoom).toBe(12);
    });

    it('should throw if getHeader called with no sections', async () => {
      const composite = new CompositePMTiles('empty-route');
      await expect(composite.getHeader()).rejects.toThrow();
    });

    it('should route getZxy to section that has tile data', async () => {
      const composite = new CompositePMTiles('comp-route');
      const mock1 = {
        getZxy: vi.fn().mockRejectedValue(new Error('Tile not found'))
      } as unknown as PMTiles;

      const mock2 = {
        getZxy: vi.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer })
      } as unknown as PMTiles;

      composite.addSection('1', mock1);
      composite.addSection('2', mock2);

      const tile = await composite.getZxy(5, 10, 10);
      expect(tile).toBeTruthy();
      expect(new Uint8Array(tile!.data)).toEqual(new Uint8Array([1, 2, 3]));
    });
  });
});
