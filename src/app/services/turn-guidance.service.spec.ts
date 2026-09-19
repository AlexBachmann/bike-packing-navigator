import { TestBed } from '@angular/core/testing';
import { TurnGuidanceService, chunkTurnDistance } from './turn-guidance.service';

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

    it('detects a slight-right turn ahead when within 75 meters', () => {
      // 50m straight North, then 50m at 35° bearing
      const track = createTrack([
        { lengthMeters: 50, bearingDeg: 0 },
        { lengthMeters: 50, bearingDeg: 35 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('slight-right');
      expect(cue!.distanceMeters).toBeGreaterThanOrEqual(40);
      expect(cue!.distanceMeters).toBeLessThanOrEqual(60);
      expect(cue!.displayText).toContain('slight right');
      expect(cue!.displayText).toContain('meters');
    });

    it('detects a 90° right turn ahead when within 75 meters', () => {
      // 60m North, then 60m East (90°)
      const track = createTrack([
        { lengthMeters: 60, bearingDeg: 0 },
        { lengthMeters: 60, bearingDeg: 90 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('right');
      expect(cue!.distanceMeters).toBeGreaterThanOrEqual(50);
      expect(cue!.distanceMeters).toBeLessThanOrEqual(70);
      expect(cue!.displayText).toContain('Turn right in');
    });

    it('detects a sharp hairpin left turn (>= 120°) when within 75 meters', () => {
      // 50m North (0°), then 50m at 210° (-150° deflection)
      const track = createTrack([
        { lengthMeters: 50, bearingDeg: 0 },
        { lengthMeters: 50, bearingDeg: 210 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('sharp-left');
      expect(cue!.displayText).toContain('sharp left');
    });

    it('formats countdown in yards when unit is miles', () => {
      const track = createTrack([
        { lengthMeters: 50, bearingDeg: 0 },
        { lengthMeters: 50, bearingDeg: 90 }
      ]);

      const cue = service.computeTurnAhead(0, track, 'miles');
      expect(cue).not.toBeNull();
      expect(cue!.displayText).toContain('yards');
      // 50m ~ 55 yards
      expect(cue!.displayText).toMatch(/\b\d+\s+yards\b/);
    });

    it('decreases countdown distance as rider progresses toward the turn', () => {
      const track = createTrack([
        { lengthMeters: 70, bearingDeg: 0 },
        { lengthMeters: 50, bearingDeg: 90 }
      ]);

      const cueAtStart = service.computeTurnAhead(0, track, 'km');
      // Rider moves 35m forward (~0.0217 miles)
      const cueMidway = service.computeTurnAhead(0.0217, track, 'km');

      expect(cueAtStart).not.toBeNull();
      expect(cueMidway).not.toBeNull();
      expect(cueMidway!.distanceMeters).toBeLessThan(cueAtStart!.distanceMeters);
      expect(cueMidway!.distanceMeters).toBe(25);
    });

    it('ignores turns beyond the 75m lookahead window', () => {
      // 150m straight North, then 90° turn
      const track = createTrack([
        { lengthMeters: 150, bearingDeg: 0 },
        { lengthMeters: 50, bearingDeg: 90 }
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

    it('suppresses turn cues when the next junction is more than 75 meters away', () => {
      // Rider at mile 0.9 (approx 161 meters before mile 1.0 junction)
      const cue = service.computeTurnAheadFromJunctions(0.9, mockOsmTurns, 'km');
      expect(cue).toBeNull();
    });

    it('detects upcoming intersection with authentic road name when within 75 meters', () => {
      // Rider at mile 0.97 (approx 48 meters before mile 1.0 junction)
      const cue = service.computeTurnAheadFromJunctions(0.97, mockOsmTurns, 'km');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('left');
      expect(cue!.roadName).toBe('Buffalo St');
      expect(cue!.displayText).toContain('Turn left onto Buffalo St in 50 meters');
      expect(cue!.junctionType).toBe('intersection');
    });

    it('formats fork cues with Fork prefix and imperial yards when within 75 meters', () => {
      // Rider at mile 3.47 (approx 48m = 53 yards before fork)
      const cue = service.computeTurnAheadFromJunctions(3.47, mockOsmTurns, 'miles');
      expect(cue).not.toBeNull();
      expect(cue!.direction).toBe('slight-right');
      expect(cue!.displayText).toContain('Fork slight right onto Goat Creek Trail in 50 yards');
      expect(cue!.junctionType).toBe('fork');
    });

    it('ignores junctions passed behind the rider', () => {
      // Rider at mile 1.5, past mile 1.0 junction but far before mile 3.5 (> 1km away)
      const cue = service.computeTurnAheadFromJunctions(1.5, mockOsmTurns, 'km');
      expect(cue).toBeNull();
    });

    it('prioritizes OSM turns in computeTurnAhead when provided and within 75 meters', () => {
      const dummyTrack: [number, number, number, number, number][] = [
        [51.17, -115.57, 1000, 0, 0],
        [51.18, -115.57, 1000, 1.6, 1.0],
        [51.19, -115.57, 1000, 3.2, 2.0]
      ];
      const cue = service.computeTurnAhead(0.97, dummyTrack, 'km', mockOsmTurns);
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

  describe('chunkTurnDistance [100, 75, 50, 25, 10, 5]', () => {
    it('quantizes distances accurately to defined countdown chunks', () => {
      expect(chunkTurnDistance(120)).toBe(100);
      expect(chunkTurnDistance(100)).toBe(100);
      expect(chunkTurnDistance(88)).toBe(100);
      expect(chunkTurnDistance(87)).toBe(75);
      expect(chunkTurnDistance(75)).toBe(75);
      expect(chunkTurnDistance(63)).toBe(75);
      expect(chunkTurnDistance(62)).toBe(50);
      expect(chunkTurnDistance(50)).toBe(50);
      expect(chunkTurnDistance(38)).toBe(50);
      expect(chunkTurnDistance(37)).toBe(25);
      expect(chunkTurnDistance(25)).toBe(25);
      expect(chunkTurnDistance(18)).toBe(25);
      expect(chunkTurnDistance(17)).toBe(10);
      expect(chunkTurnDistance(10)).toBe(10);
      expect(chunkTurnDistance(8)).toBe(10);
      expect(chunkTurnDistance(7)).toBe(5);
      expect(chunkTurnDistance(5)).toBe(5);
      expect(chunkTurnDistance(2)).toBe(5);
      expect(chunkTurnDistance(0)).toBe(5);
    });
  });

  describe('7D Dual-Track Canonical Mapping', () => {
    // 7D points: [lat, lon, ele, guidance_km, guidance_mi, canonical_km, canonical_mi]
    // Notice non-linear stretch between guidance and canonical miles:
    // Pt 0: canonical = 0.0 mi, guidance = 0.0 mi
    // Pt 1: canonical = 5.0 mi, guidance = 6.0 mi (guidance has switchbacks)
    // Pt 2: canonical = 10.0 mi, guidance = 11.0 mi
    const track7D: [number, number, number, number, number, number, number][] = [
      [34.0, -108.0, 2000, 0.0, 0.0, 0.0, 0.0],
      [34.1, -108.1, 2100, 9.656, 6.0, 8.046, 5.0],
      [34.2, -108.2, 2200, 17.702, 11.0, 16.093, 10.0]
    ];

    it('interpolates coordinates directly using canonical miles (index 6) without linear ratio drift', () => {
      // If linear ratio were used: targetMile 5.0 / 10.0 * 11.0 = guidance 5.5 mi (which would interpolate at 5.5/6.0 = 91.6% towards Pt 1)
      // With 7D canonical mapping, targetMile 5.0 matches Pt 1 exactly!
      const coordsAt5 = service.interpolatePointAtMile(track7D, 5.0);
      expect(coordsAt5[0]).toBeCloseTo(34.1, 5);
      expect(coordsAt5[1]).toBeCloseTo(-108.1, 5);

      // Midpoint between canonical 0.0 and 5.0 is canonical 2.5
      const coordsAt2_5 = service.interpolatePointAtMile(track7D, 2.5);
      expect(coordsAt2_5[0]).toBeCloseTo(34.05, 5);
      expect(coordsAt2_5[1]).toBeCloseTo(-108.05, 5);
    });

    it('clamps to endpoints when targetMile is outside bounds in 7D track', () => {
      const startCoords = service.interpolatePointAtMile(track7D, -1.0);
      expect(startCoords[0]).toBeCloseTo(34.0, 5);
      expect(startCoords[1]).toBeCloseTo(-108.0, 5);

      const endCoords = service.interpolatePointAtMile(track7D, 12.0);
      expect(endCoords[0]).toBeCloseTo(34.2, 5);
      expect(endCoords[1]).toBeCloseTo(-108.2, 5);
    });

    it('computes route tangent bearing accurately using 7D canonical miles', () => {
      const bearing = service.getRouteTangentBearing(track7D, 2.5, 25.0);
      // Bearing from (34.0, -108.0) to (34.1, -108.1) is northwest (~315°)
      expect(bearing).toBeGreaterThan(300);
      expect(bearing).toBeLessThan(330);
    });
  });
});
