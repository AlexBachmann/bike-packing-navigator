/**
 * src/app/utils/tile-math.utils.ts
 *
 * Pure Web Mercator (EPSG:3857) slippy map tile calculation utilities.
 * Handles coordinate to tile indices, tile to coordinate conversions,
 * bounding box expansions, and candidate tile URL generation.
 */

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface TileBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  z: number;
}

/** Web Mercator latitude limit: ~85.0511287798 degrees */
export const MAX_MERCATOR_LAT = 85.0511287798;
export const MIN_MERCATOR_LAT = -85.0511287798;

/**
 * Converts decimal latitude to slippy map tile Y coordinate at a specific zoom level.
 * Safely clamps extreme polar latitudes to prevent infinite / NaN logarithmic projections.
 *
 * @param lat Latitude in decimal degrees [-90, +90]
 * @param zoom Integer zoom level (e.g. 0 to 22)
 * @returns Tile Y index clamped to [0, 2^zoom - 1]
 */
export function lat2tile(lat: number, zoom: number): number {
  const safeLat = Math.max(MIN_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const rad = (safeLat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const raw = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return Math.max(0, Math.min(n - 1, raw));
}

/**
 * Converts decimal longitude to slippy map tile X coordinate at a specific zoom level.
 *
 * @param lon Longitude in decimal degrees [-180, +180]
 * @param zoom Integer zoom level (e.g. 0 to 22)
 * @returns Tile X index clamped to [0, 2^zoom - 1]
 */
export function lon2tile(lon: number, zoom: number): number {
  const n = Math.pow(2, zoom);
  const raw = Math.floor(((lon + 180) / 360) * n);
  return Math.max(0, Math.min(n - 1, raw));
}

/**
 * Converts slippy tile X coordinate at a given zoom level to longitude of the western edge.
 */
export function tile2lon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

/**
 * Converts slippy tile Y coordinate at a given zoom level to latitude of the northern edge.
 */
export function tile2lat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Computes bounding tile range for a geographical bounding box [[south, west], [north, east]]
 * with an optional buffer in tiles.
 */
export function getTileBoundsForBoundingBox(
  bounds: [[number, number], [number, number]],
  zoom: number,
  bufferTiles: number = 1
): TileBounds {
  const [south, west] = bounds[0];
  const [north, east] = bounds[1];

  const n = Math.pow(2, zoom);
  const x1 = lon2tile(west, zoom);
  const x2 = lon2tile(east, zoom);
  const y1 = lat2tile(north, zoom);
  const y2 = lat2tile(south, zoom);

  const minX = Math.max(0, Math.min(x1, x2) - bufferTiles);
  const maxX = Math.min(n - 1, Math.max(x1, x2) + bufferTiles);
  const minY = Math.max(0, Math.min(y1, y2) - bufferTiles);
  const maxY = Math.min(n - 1, Math.max(y1, y2) + bufferTiles);

  return { minX, maxX, minY, maxY, z: zoom };
}

/**
 * Returns all candidate slippy map tile URLs for a given coordinate across supported map styles:
 * - ArcGIS World Dark Gray Base (dark mode base)
 * - ArcGIS World Dark Gray Reference (dark mode labels)
 * - ArcGIS World Topographic Map (topo mode)
 * - OpenStreetMap Standard (osm fallback)
 */
export function getTileUrlsForCoordinate(z: number, x: number, y: number): string[] {
  return [
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  ];
}
