import { TestBed } from '@angular/core/testing';
import { TerrainProfileService, TrackPointTuple } from './terrain-profile.service';
import { SurfaceInterval } from './physics.model';

describe('TerrainProfileService', () => {
  let service: TerrainProfileService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TerrainProfileService]
    });
    service = TestBed.inject(TerrainProfileService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCrr', () => {
    it('should map asphalt/paved with grade1 correctly', () => {
      // 0.0055 * 1.0 = 0.0055
      expect(service.getCrr('asphalt', 'grade1', 'primary')).toBe(0.0055);
      expect(service.getCrr('paved', 'grade1', 'secondary')).toBe(0.0055);
      expect(service.getCrr('concrete', 'grade1', 'tertiary')).toBe(0.0055);
    });

    it('should apply tracktype multipliers and singletrack penalty', () => {
      // gravel (0.0160) * grade3 (1.40) = 0.0224
      expect(service.getCrr('gravel', 'grade3', 'track')).toBe(0.0224);

      // gravel (0.0160) * grade3 (1.40) + singletrack penalty (0.005) = 0.0274
      expect(service.getCrr('gravel', 'grade3', 'path')).toBe(0.0274);
      expect(service.getCrr('dirt', 'grade2', 'footway')).toBe(0.0303);
    });

    it('should fallback to defaults for unknown inputs', () => {
      // default baseCrr 0.016, default grade2 1.15 = 0.0184
      expect(service.getCrr('unknown_surface', 'unknown_grade', 'unknown_class')).toBe(0.0184);
    });
  });

  describe('calculateGrade', () => {
    it('should calculate positive, zero, and negative grades', () => {
      expect(service.calculateGrade(100, 150, 1000)).toBeCloseTo(0.05, 4); // 5%
      expect(service.calculateGrade(200, 150, 1000)).toBeCloseTo(-0.05, 4); // -5%
      expect(service.calculateGrade(100, 100, 1000)).toBe(0);
      expect(service.calculateGrade(100, 150, 0)).toBe(0);
    });
  });

  describe('getElevationAtKm & getElevationWithCursor', () => {
    const mockTrack: TrackPointTuple[] = [
      [37.77, -122.41, 100, 0.0, 0.0],
      [37.78, -122.42, 200, 10.0, 6.2],
      [37.79, -122.43, 400, 20.0, 12.4]
    ];

    it('should linearly interpolate elevation between points', () => {
      service.setTrackPoints(mockTrack);
      expect(service.getElevationAtKm(0.0)).toBe(100);
      expect(service.getElevationAtKm(5.0)).toBe(150); // midpoint
      expect(service.getElevationAtKm(10.0)).toBe(200);
      expect(service.getElevationAtKm(15.0)).toBe(300);
      expect(service.getElevationAtKm(20.0)).toBe(400);
    });

    it('should return default elevation when track is empty', () => {
      expect(service.getElevationAtKm(5.0)).toBe(1400);
    });

    it('should step elevation using cursor matching binary search', () => {
      let cursor = 0;
      const res1 = service.getElevationWithCursor(mockTrack, 5.0, cursor);
      expect(res1.ele).toBe(150);

      const res2 = service.getElevationWithCursor(mockTrack, 15.0, res1.nextIdx);
      expect(res2.ele).toBe(300);

      const resEnd = service.getElevationWithCursor(mockTrack, 25.0, res2.nextIdx);
      expect(resEnd.ele).toBe(400);
    });
  });

  describe('getSurfaceAtKm & getSurfaceWithCursor', () => {
    const mockIntervals: SurfaceInterval[] = [
      [0.0, 10.0, 'secondary', 'asphalt', 'grade1'],
      [10.0, 25.0, 'track', 'gravel', 'grade2'],
      [25.0, 50.0, 'path', 'dirt', 'grade3']
    ];

    it('should locate correct surface interval by kilometer', () => {
      service.setSurfaceIntervals(mockIntervals);

      expect(service.getSurfaceAtKm(5.0)).toEqual({
        roadClass: 'secondary',
        surface: 'asphalt',
        tracktype: 'grade1'
      });

      expect(service.getSurfaceAtKm(15.0)).toEqual({
        roadClass: 'track',
        surface: 'gravel',
        tracktype: 'grade2'
      });

      expect(service.getSurfaceAtKm(30.0)).toEqual({
        roadClass: 'path',
        surface: 'dirt',
        tracktype: 'grade3'
      });
    });

    it('should locate surface using cursor step', () => {
      let cursor = 0;
      const res1 = service.getSurfaceWithCursor(mockIntervals, 5.0, cursor);
      expect(res1.surface).toBe('asphalt');

      const res2 = service.getSurfaceWithCursor(mockIntervals, 15.0, res1.nextIdx);
      expect(res2.surface).toBe('gravel');
    });

    it('should return defaults when surface intervals empty', () => {
      expect(service.getSurfaceAtKm(10.0)).toEqual({
        roadClass: 'unclassified',
        surface: 'gravel',
        tracktype: 'grade2'
      });
    });
  });

  describe('totalDistanceKm', () => {
    it('should compute ceiling of total distance from trackPoints', () => {
      expect(service.totalDistanceKm()).toBe(0);
      service.setTrackPoints([
        [0, 0, 0, 0, 0],
        [1, 1, 10, 42.3, 26.2]
      ]);
      expect(service.totalDistanceKm()).toBe(43);
    });
  });
});
