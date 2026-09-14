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

  describe('getRouteTangentBearing', () => {
    it('returns 0 for empty or single-point tracks', () => {
      expect(service.getRouteTangentBearing([], 0)).toBe(0);
      expect(service.getRouteTangentBearing([[40, -105, 1000, 0, 0]], 0)).toBe(0);
    });

    it('calculates forward route tangent bearing accurately using lookahead', () => {
      // Points going directly North: lat increases, lon constant
      const northTrack: [number, number, number, number, number][] = [
        [40.0, -105.0, 1000, 0.0, 0.0],
        [40.001, -105.0, 1000, 0.11, 0.068],
        [40.002, -105.0, 1000, 0.22, 0.136]
      ];
      const bearing = service.getRouteTangentBearing(northTrack, 0.0, 25.0);
      expect(bearing).toBeCloseTo(0, 1); // 0° North
    });

    it('calculates eastward route tangent bearing', () => {
      // Points going directly East: lat constant, lon increases
      const eastTrack: [number, number, number, number, number][] = [
        [40.0, -105.0, 1000, 0.0, 0.0],
        [40.0, -104.999, 1000, 0.085, 0.053],
        [40.0, -104.998, 1000, 0.17, 0.106]
      ];
      const bearing = service.getRouteTangentBearing(eastTrack, 0.0, 25.0);
      expect(bearing).toBeCloseTo(90, 1); // 90° East
    });

    it('looks backward when at or near the end of the route', () => {
      const eastTrack: [number, number, number, number, number][] = [
        [40.0, -105.0, 1000, 0.0, 0.0],
        [40.0, -104.999, 1000, 0.085, 0.053],
        [40.0, -104.998, 1000, 0.17, 0.106]
      ];
      const bearing = service.getRouteTangentBearing(eastTrack, 0.106, 25.0);
      expect(bearing).toBeCloseTo(90, 1); // Still 90° East
    });
  });

  describe('OSM Decision-Point Turn Guidance', () => {
    const mockOsmTurns = [
      {
        mile: 1.0,
        km: 1.609,
        coordinates: [51.176, -115.570] as [number, number],
        direction: 'left' as const,
        deflectionDeg: -85.0,
        roadName: 'Buffalo St',
        junctionType: 'intersection',
        branchCount: 4
      },
      {
        mile: 3.5,
        km: 5.632,
        coordinates: [51.150, -115.540] as [number, number],
        direction: 'slight-right' as const,
        deflectionDeg: 35.0,
        roadName: 'Goat Creek Trail',
        junctionType: 'fork',
        branchCount: 3
      }
    ];

    it('returns null if no OSM turns exist', () => {
      expect(service.computeTurnAheadFromJunctions(0.5, [], 'km')).toBeNull();
    });

    it('detects upcoming intersection with authentic road name', () => {
      // Rider at mile 0.9 (approx 160 meters before mile 1.0 junction)
      const cue = service.computeTurnAheadFromJunctions(0.9, mockOsmTurns, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('left');
      expect(cue!.roadName).toBe('Buffalo St');
      expect(cue!.displayText).toContain('Turn left onto Buffalo St in 161 meters');
      expect(cue!.junctionType).toBe('intersection');
    });

    it('formats fork cues with Fork prefix and imperial yards', () => {
      // Rider at mile 3.4 (approx 161m = 176 yards before fork)
      const cue = service.computeTurnAheadFromJunctions(3.4, mockOsmTurns, 'miles');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('slight-right');
      expect(cue!.displayText).toContain('Fork slight right onto Goat Creek Trail in 176 yards');
      expect(cue!.junctionType).toBe('fork');
    });

    it('ignores junctions passed behind the rider', () => {
      // Rider at mile 1.5, past mile 1.0 junction but far before mile 3.5 (> 1km away)
      const cue = service.computeTurnAheadFromJunctions(1.5, mockOsmTurns, 'km');
      expect(cue).toBeNull();
    });

    it('prioritizes OSM turns in computeTurnAhead when provided', () => {
      const dummyTrack: [number, number, number, number, number][] = [
        [51.17, -115.57, 1000, 0, 0],
        [51.18, -115.57, 1000, 1.6, 1.0],
        [51.19, -115.57, 1000, 3.2, 2.0]
      ];
      const cue = service.computeTurnAhead(0.9, dummyTrack, 'km', mockOsmTurns);
      expect(cue).not.toBeNull();
      expect(cue!.roadName).toBe('Buffalo St');
    });
  });

  describe('hasMultipleWayOptions', () => {
    it('returns false when no features are present', () => {
      expect(service.hasMultipleWayOptions([40.0, -105.0], [])).toBe(false);
    });

    it('returns false for a solitary continuous road (degree 2)', () => {
      // Single continuous road passing through [40.0, -105.0] from South to North
      const singleRoadFeature = {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-105.0, 39.999],
            [-105.0, 40.001]
          ]
        }
      };
      expect(service.hasMultipleWayOptions([40.0, -105.0], [singleRoadFeature])).toBe(false);
    });

    it('returns true when a fork or intersection meets at the junction (degree >= 3)', () => {
      // Road 1: South to North
      // Road 2: East branch branching off at [40.0, -105.0]
      const intersectionFeatures = [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [-105.0, 39.999],
              [-105.0, 40.001]
            ]
          }
        },
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [-105.0, 40.0],
              [-104.998, 40.0]
            ]
          }
        }
      ];
      expect(service.hasMultipleWayOptions([40.0, -105.0], intersectionFeatures)).toBe(true);
    });
  });
});
