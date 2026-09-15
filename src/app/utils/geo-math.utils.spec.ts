import {
  haversineMeters,
  calculateBearing,
  calculateDeflectionAngle,
  normalizeBearing,
  calculateRelativeWind,
  getCoordinateAtKm,
  EARTH_RADIUS_METERS
} from './geo-math.utils';

describe('geo-math.utils', () => {
  describe('haversineMeters', () => {
    it('returns 0 for identical points', () => {
      expect(haversineMeters(40.0, -105.0, 40.0, -105.0)).toBe(0);
      expect(haversineMeters(0, 0, 0, 0)).toBe(0);
    });

    it('calculates accurate short distance (~11.1m for 0.0001 deg lat)', () => {
      const dist = haversineMeters(40.0, -105.0, 40.0001, -105.0);
      expect(dist).toBeCloseTo(11.12, 1);
    });

    it('is symmetric regardless of point order', () => {
      const d1 = haversineMeters(39.7392, -104.9903, 40.0150, -105.2705);
      const d2 = haversineMeters(40.0150, -105.2705, 39.7392, -104.9903);
      expect(d1).toBeCloseTo(d2, 6);
    });

    it('calculates 1 degree along equator (~111.195 km)', () => {
      const dist = haversineMeters(0, 0, 0, 1);
      expect(dist).toBeCloseTo(111195, -2);
    });

    it('handles polar points without producing NaN', () => {
      expect(haversineMeters(90, 0, 90, 100)).toBeCloseTo(0, 5);
      expect(haversineMeters(-90, 0, -90, 100)).toBeCloseTo(0, 5);
      expect(Number.isNaN(haversineMeters(90, 0, 90, 100))).toBe(false);
    });


    it('handles antipodal points safely without NaN', () => {
      const dist = haversineMeters(0, 0, 0, 180);
      expect(dist).toBeCloseTo(Math.PI * EARTH_RADIUS_METERS, -2);
      expect(Number.isNaN(dist)).toBe(false);
    });

    it('handles crossing the antimeridian correctly', () => {
      const dist = haversineMeters(0, 179.9, 0, -179.9);
      expect(dist).toBeCloseTo(22239, -1);
    });
  });

  describe('calculateBearing', () => {
    it('returns 0 for identical points', () => {
      expect(calculateBearing(40.0, -105.0, 40.0, -105.0)).toBe(0);
    });

    it('returns exact cardinal directions from equator', () => {
      expect(calculateBearing(0, 0, 1, 0)).toBeCloseTo(0, 1);     // North
      expect(calculateBearing(0, 0, 0, 1)).toBeCloseTo(90, 1);    // East
      expect(calculateBearing(0, 0, -1, 0)).toBeCloseTo(180, 1);  // South
      expect(calculateBearing(0, 0, 0, -1)).toBeCloseTo(270, 1);  // West
    });

    it('calculates intercardinal bearings correctly', () => {
      expect(calculateBearing(0, 0, 1, 1)).toBeCloseTo(45, 0);     // NE
      expect(calculateBearing(0, 0, -1, 1)).toBeCloseTo(135, 0);   // SE
      expect(calculateBearing(0, 0, -1, -1)).toBeCloseTo(225, 0);  // SW
      expect(calculateBearing(0, 0, 1, -1)).toBeCloseTo(315, 0);   // NW
    });

    it('matches weather service test bearings', () => {
      expect(calculateBearing(50.0, -115.0, 51.0, -115.0)).toBeCloseTo(0, 1);
      expect(calculateBearing(50.0, -115.0, 50.0, -114.0)).toBeCloseTo(90, 0);
      expect(calculateBearing(50.0, -115.0, 49.0, -115.0)).toBeCloseTo(180, 1);
      expect(calculateBearing(50.0, -115.0, 50.0, -116.0)).toBeCloseTo(270, 0);
    });


    it('strictly bounds output in [0, 360)', () => {
      const b = calculateBearing(40.0, -105.0, 40.0, -105.0001);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    });
  });

  describe('calculateDeflectionAngle', () => {
    it('returns 0 for straight ahead', () => {
      expect(calculateDeflectionAngle(45, 45)).toBe(0);
      expect(calculateDeflectionAngle(0, 0)).toBe(0);
    });

    it('calculates right turns (positive deflection)', () => {
      expect(calculateDeflectionAngle(0, 90)).toBe(90);
      expect(calculateDeflectionAngle(45, 135)).toBe(90);
      expect(calculateDeflectionAngle(350, 10)).toBe(20); // crossing 0°/360°
    });

    it('calculates left turns (negative deflection)', () => {
      expect(calculateDeflectionAngle(90, 0)).toBe(-90);
      expect(calculateDeflectionAngle(135, 45)).toBe(-90);
      expect(calculateDeflectionAngle(10, 350)).toBe(-20); // crossing 0°/360°
    });

    it('handles 180 turnaround', () => {
      expect(Math.abs(calculateDeflectionAngle(0, 180))).toBe(180);
    });
  });

  describe('normalizeBearing', () => {
    it('keeps values in [0, 360) unchanged', () => {
      expect(normalizeBearing(0)).toBe(0);
      expect(normalizeBearing(180)).toBe(180);
      expect(normalizeBearing(359.9)).toBeCloseTo(359.9, 1);
    });

    it('wraps 360 to 0', () => {
      expect(normalizeBearing(360)).toBe(0);
    });

    it('wraps negative angles to positive', () => {
      expect(normalizeBearing(-90)).toBe(270);
      expect(normalizeBearing(-450)).toBe(270);
    });

    it('wraps angles > 360', () => {
      expect(normalizeBearing(370)).toBe(10);
      expect(normalizeBearing(720)).toBe(0);
    });
  });

  describe('calculateRelativeWind', () => {
    it('identifies pure headwind when traveling directly into wind', () => {
      const result = calculateRelativeWind(180, 180, 25);
      expect(result.headwindKmh).toBe(25);
      expect(result.tailwindKmh).toBe(-25);
      expect(result.relativeAngleDeg).toBe(0);
    });

    it('identifies pure tailwind when traveling directly with wind', () => {
      const result = calculateRelativeWind(180, 0, 30);
      expect(result.headwindKmh).toBe(-30);
      expect(result.tailwindKmh).toBe(30);
      expect(result.relativeAngleDeg).toBe(180);
    });

    it('identifies crosswind with 0 headwind and 0 tailwind', () => {
      const result = calculateRelativeWind(180, 90, 20);
      expect(result.headwindKmh).toBeCloseTo(0, 0);
      expect(result.tailwindKmh).toBeCloseTo(0, 0);
      expect(result.relativeAngleDeg).toBe(90);
    });
  });

  describe('getCoordinateAtKm', () => {
    const mockTrack: [number, number, number, number, number][] = [
      [40.0, -105.0, 1500, 0, 0],
      [40.1, -105.1, 1600, 10, 6.2],
      [40.2, -105.2, 1700, 20, 12.4]
    ];

    it('returns default coordinate when track points is empty', () => {
      expect(getCoordinateAtKm(5, [])).toEqual({ lat: 0, lon: 0, ele: 0 });
    });

    it('clamps to first point when km is before or at start', () => {
      expect(getCoordinateAtKm(-5, mockTrack)).toEqual({ lat: 40.0, lon: -105.0, ele: 1500 });
      expect(getCoordinateAtKm(0, mockTrack)).toEqual({ lat: 40.0, lon: -105.0, ele: 1500 });
    });

    it('clamps to last point when km is after or at end', () => {
      expect(getCoordinateAtKm(25, mockTrack)).toEqual({ lat: 40.2, lon: -105.2, ele: 1700 });
      expect(getCoordinateAtKm(20, mockTrack)).toEqual({ lat: 40.2, lon: -105.2, ele: 1700 });
    });

    it('linearly interpolates coordinate and elevation at midpoint', () => {
      const mid = getCoordinateAtKm(5, mockTrack);
      expect(mid.lat).toBeCloseTo(40.05, 4);
      expect(mid.lon).toBeCloseTo(-105.05, 4);
      expect(mid.ele).toBe(1550);
    });
  });
});

