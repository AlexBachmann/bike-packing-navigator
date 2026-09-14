import { TestBed } from '@angular/core/testing';
import { TurnGuidanceService } from './turn-guidance.service';

describe('TurnGuidanceService', () => {
  let service: TurnGuidanceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TurnGuidanceService);
  });

  describe('Mathematical Bearing & Deflection Utilities', () => {
    it('calculates cardinal bearings accurately', () => {
      expect(service.calculateBearing(0, 0, 1, 0)).toBeCloseTo(0, 1);     // North
      expect(service.calculateBearing(0, 0, 0, 1)).toBeCloseTo(90, 1);    // East
      expect(service.calculateBearing(0, 0, -1, 0)).toBeCloseTo(180, 1);  // South
      expect(service.calculateBearing(0, 0, 0, -1)).toBeCloseTo(270, 1);  // West
    });

    it('calculates deflection angle across 360 wrap-around', () => {
      expect(service.calculateDeflectionAngle(0, 90)).toBe(90);      // 90° right
      expect(service.calculateDeflectionAngle(0, 270)).toBe(-90);    // 90° left
      expect(service.calculateDeflectionAngle(350, 10)).toBe(20);    // 20° right across 0°
      expect(service.calculateDeflectionAngle(10, 350)).toBe(-20);   // 20° left across 0°
      expect(service.calculateDeflectionAngle(10, 180)).toBe(170);   // 170° right
    });

    it('classifies turn directions matching specification thresholds', () => {
      expect(service.classifyDirection(15)).toBeNull();               // Straight (< 20°)
      expect(service.classifyDirection(35)).toBe('slight-right');     // 20° <= a < 60°
      expect(service.classifyDirection(-45)).toBe('slight-left');     // 20° <= a < 60°
      expect(service.classifyDirection(90)).toBe('right');            // 60° <= a < 120°
      expect(service.classifyDirection(-90)).toBe('left');            // 60° <= a < 120°
      expect(service.classifyDirection(140)).toBe('sharp-right');     // >= 120°
      expect(service.classifyDirection(-150)).toBe('sharp-left');     // >= 120°
    });
  });

  describe('computeTurnAhead', () => {
    // Helper to generate tracks: points spaced every 25m
    function createTrack(segments: { lengthMeters: number; bearingDeg: number }[]): [number, number, number, number, number][] {
      let lat = 40.0;
      let lon = -105.0;
      let cumKm = 0;
      const pts: [number, number, number, number, number][] = [[lat, lon, 1000, 0, 0]];

      for (const seg of segments) {
        const rad = seg.bearingDeg * (Math.PI / 180);
        const steps = Math.max(1, Math.round(seg.lengthMeters / 25));
        const stepDistMeters = seg.lengthMeters / steps;

        for (let s = 0; s < steps; s++) {
          const dLat = (stepDistMeters * Math.cos(rad)) / 110540.0;
          const dLon = (stepDistMeters * Math.sin(rad)) / (111320.0 * Math.cos(lat * (Math.PI / 180)));
          lat += dLat;
          lon += dLon;
          cumKm += stepDistMeters / 1000;
          pts.push([lat, lon, 1000, cumKm, cumKm * 0.621371]);
        }
      }
      return pts;
    }

    it('returns null on a straight path without significant deflection', () => {
      const straightTrack = createTrack([{ lengthMeters: 1000, bearingDeg: 0 }]);
      const cue = service.computeTurnAhead(0, straightTrack, 'km');
      expect(cue).toBeNull();
    });

    it('detects a slight-right turn ahead', () => {
      // 200m straight North, then 200m at 35° bearing
      const track = createTrack([
        { lengthMeters: 200, bearingDeg: 0 },
        { lengthMeters: 200, bearingDeg: 35 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('slight-right');
      expect(cue!.distanceMeters).toBeGreaterThanOrEqual(180);
      expect(cue!.distanceMeters).toBeLessThanOrEqual(220);
      expect(cue!.displayText).toContain('slight right');
      expect(cue!.displayText).toContain('meters');
    });

    it('detects a 90° right turn ahead', () => {
      // 300m North, then 300m East (90°)
      const track = createTrack([
        { lengthMeters: 300, bearingDeg: 0 },
        { lengthMeters: 300, bearingDeg: 90 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('right');
      expect(cue!.distanceMeters).toBeGreaterThanOrEqual(280);
      expect(cue!.distanceMeters).toBeLessThanOrEqual(320);
      expect(cue!.displayText).toContain('Turn right in');
    });

    it('detects a sharp hairpin left turn (>= 120°)', () => {
      // 250m North (0°), then 200m at 210° (-150° deflection)
      const track = createTrack([
        { lengthMeters: 250, bearingDeg: 0 },
        { lengthMeters: 200, bearingDeg: 210 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('sharp-left');
      expect(cue!.displayText).toContain('sharp left');
    });

    it('formats countdown in yards when unit is miles', () => {
      const track = createTrack([
        { lengthMeters: 200, bearingDeg: 0 },
        { lengthMeters: 200, bearingDeg: 90 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'miles');
      expect(cue).not.toBeNull();
      expect(cue!.displayText).toContain('yards');
      // 200m ~ 218 yards
      expect(cue!.displayText).toMatch(/\b\d+\s+yards\b/);
    });

    it('decreases countdown distance as rider progresses toward the turn', () => {
      const track = createTrack([
        { lengthMeters: 400, bearingDeg: 0 },
        { lengthMeters: 200, bearingDeg: 90 }
      ]);

      const cueAtStart = service.computeTurnAhead(0, track, 'km');
      // Rider moves 200m forward (~0.124 miles)
      const cueMidway = service.computeTurnAhead(0.124, track, 'km');

      expect(cueAtStart).not.toBeNull();
      expect(cueMidway).not.toBeNull();
      expect(cueMidway!.distanceMeters).toBeLessThan(cueAtStart!.distanceMeters);
      expect(cueMidway!.distanceMeters).toBeCloseTo(200, -1);
    });

    it('ignores turns beyond the 1 km lookahead window', () => {
      // 1500m straight North, then 90° turn
      const track = createTrack([
        { lengthMeters: 1500, bearingDeg: 0 },
        { lengthMeters: 200, bearingDeg: 90 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).toBeNull();
    });

    it('safely handles empty track or end of route', () => {
      expect(service.computeTurnAhead(0, [], 'km')).toBeNull();
      const shortTrack = createTrack([{ lengthMeters: 50, bearingDeg: 0 }]);
      expect(service.computeTurnAhead(1.0, shortTrack, 'km')).toBeNull();
    });
  });

  describe('snapToTrail & Road Snapping', () => {
    const mockTrailFeature = {
      type: 'Feature',
      layer: { id: 'roads', 'source-layer': 'transportation' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-105.00000, 40.00000],
          [-105.00000, 40.01000] // Runs North-South along lon -105.0
        ]
      },
      properties: { class: 'track' }
    };

    it('snaps rider position to trail centerline when within 20m and heading aligned', () => {
      // Trail runs North (lon -105.0). Rider is ~7m East at lon -105.00008, lat 40.005, heading 5° North
      const rawCoords: [number, number] = [40.00500, -105.00008];
      const snapped = service.snapToTrail(rawCoords, 5, [mockTrailFeature]);

      expect(snapped[0]).toBeCloseTo(40.00500, 5);
      expect(snapped[1]).toBeCloseTo(-105.00000, 5); // Snapped onto centerline
    });

    it('provides detailed RoadSnapResult metadata', () => {
      const rawCoords: [number, number] = [40.00500, -105.00008];
      const result = service.snapToTrailDetailed(rawCoords, 5, [mockTrailFeature]);

      expect(result.snapped).toBe(true);
      expect(result.distanceMeters).toBeGreaterThan(0);
      expect(result.distanceMeters).toBeLessThan(10);
      expect(result.headingDifferenceDeg).toBeCloseTo(5, 1);
      expect(result.featureProperties?.['class']).toBe('track');
    });

    it('rejects snapping when heading is not aligned within 45°', () => {
      // Rider is heading East (90°) crossing the North-South trail (heading diff ~90°)
      const rawCoords: [number, number] = [40.00500, -105.00008];
      const snapped = service.snapToTrail(rawCoords, 90, [mockTrailFeature]);

      // Returns raw coordinates unmodified
      expect(snapped).toEqual(rawCoords);
      const detailed = service.snapToTrailDetailed(rawCoords, 90, [mockTrailFeature]);
      expect(detailed.snapped).toBe(false);
    });

    it('rejects snapping when distance exceeds 20m threshold (off-trail)', () => {
      // Rider is ~35m East of trail at lon -105.00040, heading North
      const rawCoords: [number, number] = [40.00500, -105.00040];
      const snapped = service.snapToTrail(rawCoords, 0, [mockTrailFeature]);

      // Off-trail fallback to raw coordinates
      expect(snapped).toEqual(rawCoords);
      const detailed = service.snapToTrailDetailed(rawCoords, 0, [mockTrailFeature]);
      expect(detailed.snapped).toBe(false);
    });

    it('falls back to raw coordinates when features array is empty', () => {
      const rawCoords: [number, number] = [40.00500, -105.00008];
      const snapped = service.snapToTrail(rawCoords, 0, []);
      expect(snapped).toEqual(rawCoords);
    });

    it('supports MultiLineString features', () => {
      const multiFeature = {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[-105.01, 40.00], [-105.01, 40.01]],
            [[-105.00, 40.00], [-105.00, 40.01]]
          ]
        }
      };

      const rawCoords: [number, number] = [40.00500, -105.00008];
      const snapped = service.snapToTrail(rawCoords, 0, [multiFeature]);
      expect(snapped[1]).toBeCloseTo(-105.00, 5);
    });

    it('correctly matches reverse travel along bidirectional trail', () => {
      // Trail runs North, but rider travels South (heading 180°)
      const rawCoords: [number, number] = [40.00500, -105.00008];
      const snapped = service.snapToTrail(rawCoords, 180, [mockTrailFeature]);

      expect(snapped[1]).toBeCloseTo(-105.00000, 5);
    });
  });
});
