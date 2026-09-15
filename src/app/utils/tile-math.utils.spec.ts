import {
  lat2tile,
  lon2tile,
  tile2lon,
  tile2lat,
  getTileUrlsForCoordinate,
  getTileBoundsForBoundingBox,
  MAX_MERCATOR_LAT,
  MIN_MERCATOR_LAT
} from './tile-math.utils';

describe('tile-math.utils', () => {
  describe('lat2tile and lon2tile', () => {
    it('calculates correct Denver slippy tile coordinates at zoom 5', () => {
      const x = lon2tile(-104.9903, 5);
      const y = lat2tile(39.7392, 5);
      expect(x).toBe(6);
      expect(y).toBe(12);
    });

    it('calculates equator and prime meridian at zoom 5', () => {
      expect(lat2tile(0, 5)).toBe(16);
      expect(lon2tile(0, 5)).toBe(16);
    });

    it('calculates zoom 0 origin', () => {
      expect(lat2tile(0, 0)).toBe(0);
      expect(lon2tile(0, 0)).toBe(0);
    });
  });

  describe('tile2lat and tile2lon inverse projections', () => {
    it('inverts Denver tile to approximate geographic coordinates', () => {
      expect(tile2lon(6, 5)).toBeCloseTo(-112.5, 0);
      expect(tile2lat(12, 5)).toBeCloseTo(40.9, 0);
    });

    it('inverts zoom 0 origin to (-180, ~85.05)', () => {
      expect(tile2lon(0, 0)).toBe(-180);
      expect(tile2lat(0, 0)).toBeCloseTo(MAX_MERCATOR_LAT, 1);
    });
  });

  describe('Mercator boundary and adversarial robustness', () => {
    it('clamps extreme latitudes without crashing', () => {
      expect(lat2tile(85.0, 5)).toBe(0);
      expect(lat2tile(-85.0, 5)).toBe(31);

      // Polar extremes beyond Web Mercator
      const y89 = lat2tile(89.0, 5);
      expect(y89).toBeGreaterThanOrEqual(0);
      expect(y89).toBeLessThanOrEqual(31);

      const yMinus89 = lat2tile(-89.0, 5);
      expect(yMinus89).toBeGreaterThanOrEqual(0);
      expect(yMinus89).toBeLessThanOrEqual(31);
    });

    it('handles antimeridian longitude extremes', () => {
      expect(lon2tile(-180, 5)).toBe(0);
      expect(lon2tile(179.9999, 5)).toBe(31);
      expect(lon2tile(0, 5)).toBe(16);
    });
  });

  describe('getTileUrlsForCoordinate', () => {
    it('generates 4 candidate URLs with correct path ordering', () => {
      const urls = getTileUrlsForCoordinate(5, 6, 12);
      expect(urls.length).toBe(4);

      // ArcGIS: .../tile/z/y/x
      expect(urls[0]).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/5/12/6');
      expect(urls[1]).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/5/12/6');
      expect(urls[2]).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/5/12/6');

      // OSM: .../z/x/y.png
      expect(urls[3]).toBe('https://tile.openstreetmap.org/5/6/12.png');
    });
  });

  describe('getTileBoundsForBoundingBox', () => {
    it('computes bounded tile envelope with buffer', () => {
      // Colorado bounding box
      const bounds: [[number, number], [number, number]] = [
        [37.0, -109.05], // SW
        [41.0, -102.05]  // NE
      ];
      const tileBounds = getTileBoundsForBoundingBox(bounds, 5, 1);

      expect(tileBounds.z).toBe(5);
      expect(tileBounds.minX).toBeLessThanOrEqual(tileBounds.maxX);
      expect(tileBounds.minY).toBeLessThanOrEqual(tileBounds.maxY);
      expect(tileBounds.minX).toBeGreaterThanOrEqual(0);
      expect(tileBounds.maxX).toBeLessThanOrEqual(31);
      expect(tileBounds.minY).toBeGreaterThanOrEqual(0);
      expect(tileBounds.maxY).toBeLessThanOrEqual(31);
    });
  });
});
