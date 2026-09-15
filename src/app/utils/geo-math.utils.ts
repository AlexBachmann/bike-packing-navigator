/**
 * src/app/utils/geo-math.utils.ts
 *
 * Pure geographic calculation utilities for distance, bearing, deflection,
 * and coordinate transformations across spherical Mercator / WGS84 models.
 * Completely stateless with zero framework or UI dependencies.
 */

export const EARTH_RADIUS_METERS = 6371000;
export const EARTH_RADIUS_KM = 6371.0;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export interface RelativeWindComponents {
  headwindKmh: number;
  tailwindKmh: number;
  relativeAngleDeg: number;
}

/**
 * Calculates great-circle distance in meters between two coordinates using the Haversine formula.
 * Includes floating-point clamping to guard against NaN at antipodal boundaries.
 *
 * @param lat1 Latitude of point 1 in decimal degrees
 * @param lon1 Longitude of point 1 in decimal degrees
 * @param lat2 Latitude of point 2 in decimal degrees
 * @param lon2 Longitude of point 2 in decimal degrees
 * @returns Great-circle distance in meters (>= 0)
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;

  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLon2 = Math.sin(dLon / 2);

  const a =
    sinDLat2 * sinDLat2 +
    Math.cos(phi1) * Math.cos(phi2) *
    sinDLon2 * sinDLon2;

  // Clamp 'a' to [0, 1] to prevent Math.sqrt(1 - a) producing NaN on floating-point drift
  const clampedA = Math.max(0, Math.min(1, a));
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

/**
 * Calculates initial forward azimuth / bearing in degrees [0, 360) from point 1 to point 2.
 *
 * @param lat1 Latitude of start point
 * @param lon1 Longitude of start point
 * @param lat2 Latitude of destination point
 * @param lon2 Longitude of destination point
 * @returns Bearing in degrees [0, 360), where 0 = North, 90 = East, 180 = South, 270 = West
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const deltaLambda = (lon2 - lon1) * DEG_TO_RAD;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const bearingDeg = Math.atan2(y, x) * RAD_TO_DEG;
  return (bearingDeg % 360 + 360) % 360;
}

/**
 * Calculates signed deflection angle between two bearings in degrees [-180, +180].
 * Positive = clockwise / right turn
 * Negative = counter-clockwise / left turn
 *
 * @param incomingBearing Incoming travel bearing in degrees [0, 360)
 * @param outgoingBearing Outgoing travel bearing in degrees [0, 360)
 * @returns Signed deflection angle in degrees [-180, 180]
 */
export function calculateDeflectionAngle(incomingBearing: number, outgoingBearing: number): number {
  return ((outgoingBearing - incomingBearing + 540) % 360) - 180;
}

/**
 * Normalizes any angle in degrees to the range [0, 360).
 */
export function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

/**
 * Calculates effective headwind and tailwind components along the rider travel bearing.
 * Meteorological wind direction is the direction FROM which the wind blows.
 */
export function calculateRelativeWind(
  travelBearing: number,
  windDirectionDeg: number,
  windSpeedKmh: number
): RelativeWindComponents {
  const diffDeg = ((windDirectionDeg - travelBearing + 540) % 360) - 180;
  const diffRad = diffDeg * DEG_TO_RAD;

  const headwindKmh = Math.round(windSpeedKmh * Math.cos(diffRad) * 10) / 10;
  const tailwindKmh = Math.round(-headwindKmh * 10) / 10;

  return {
    headwindKmh,
    tailwindKmh,
    relativeAngleDeg: Math.abs(diffDeg)
  };
}

/**
 * Interpolates route track point coordinates at a specific distance along a route.
 * Track points are tuples of [lat, lon, ele, cum_km, cum_mi].
 * Performs binary search on cum_km and linearly interpolates.
 */
export function getCoordinateAtKm(
  km: number,
  trackPoints: [number, number, number, number, number][]
): { lat: number; lon: number; ele: number } {
  if (!trackPoints || trackPoints.length === 0) {
    return { lat: 0, lon: 0, ele: 0 };
  }
  if (km <= trackPoints[0][3]) {
    return { lat: trackPoints[0][0], lon: trackPoints[0][1], ele: trackPoints[0][2] };
  }
  const last = trackPoints[trackPoints.length - 1];
  if (km >= last[3]) {
    return { lat: last[0], lon: last[1], ele: last[2] };
  }

  // Binary search for track segment
  let low = 0;
  let high = trackPoints.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (trackPoints[mid][3] <= km && trackPoints[mid + 1] && trackPoints[mid + 1][3] >= km) {
      const p1 = trackPoints[mid];
      const p2 = trackPoints[mid + 1];
      const span = Math.max(0.0001, p2[3] - p1[3]);
      const t = (km - p1[3]) / span;
      return {
        lat: p1[0] + t * (p2[0] - p1[0]),
        lon: p1[1] + t * (p2[1] - p1[1]),
        ele: Math.round(p1[2] + t * (p2[2] - p1[2]))
      };
    } else if (trackPoints[mid][3] < km) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return { lat: last[0], lon: last[1], ele: last[2] };
}
