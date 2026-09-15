import { TestBed } from '@angular/core/testing';
import { PacingSimulationService } from './pacing-simulation.service';
import { CyclingPhysicsEngine } from './cycling-physics.engine';
import { TerrainProfileService, TrackPointTuple } from './terrain-profile.service';
import { SettingsService } from '../settings.service';
import { SurfaceInterval } from './physics.model';
import { signal } from '@angular/core';

describe('PacingSimulationService', () => {
  let service: PacingSimulationService;
  let terrain: TerrainProfileService;
  let settingsMock: any;

  beforeEach(() => {
    settingsMock = {
      riderPowerWatts: signal(180),
      paceMode: signal<'speed' | 'power'>('power'),
      climbSurgePercent: signal(20),
      climbSurgeDurationMinutes: signal(5),
      hikeBikeThresholdKmh: signal(6.0),
      hikeBikeBaseSpeedKmh: signal(3.5),
      totalSystemMassKg: signal(85),
      avgSpeedMph: signal(12)
    };

    TestBed.configureTestingModule({
      providers: [
        PacingSimulationService,
        CyclingPhysicsEngine,
        TerrainProfileService,
        { provide: SettingsService, useValue: settingsMock }
      ]
    });

    service = TestBed.inject(PacingSimulationService);
    terrain = TestBed.inject(TerrainProfileService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('simulateSegments in Speed Mode', () => {
    it('should generate constant speed segments matching avgSpeedMph', () => {
      settingsMock.paceMode.set('speed');
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 1.0, 0.62]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 1.0, 'secondary', 'asphalt', 'grade1']]);

      const segments = service.simulateSegments(0, 1.0);
      expect(segments.length).toBe(20); // 1.0 km / 0.05 km = 20
      expect(segments[0].mode).toBe('riding');
      expect(segments[0].speedKmh).toBeCloseTo(12 * 1.609344, 1);
    });
  });

  describe('simulateSegments in Power Mode', () => {
    it('should simulate riding on flat paved road', () => {
      settingsMock.paceMode.set('power');
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 1.0, 0.62]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 1.0, 'secondary', 'asphalt', 'grade1']]);

      const segments = service.simulateSegments(0, 1.0);
      expect(segments.length).toBe(20);
      expect(segments[0].mode).toBe('riding');
      expect(segments[0].speedKmh).toBeGreaterThan(20);
    });

    it('should enter climb_surge or hike_a_bike on steep grades', () => {
      settingsMock.paceMode.set('power');
      settingsMock.riderPowerWatts.set(120); // low power
      // 20% steep climb: 0m to 200m elevation gain in 1000m
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 0, 0.0, 0.0],
        [0, 0, 200, 1.0, 0.62]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 1.0, 'track', 'rock', 'grade5']]);

      const segments = service.simulateSegments(0, 1.0);
      expect(segments.length).toBe(20);
      const modes = segments.map((s) => s.mode);
      expect(modes.includes('climb_surge') || modes.includes('hike_a_bike')).toBe(true);
    });
  });

  describe('runSimulationAsync', () => {
    it('should calculate segments asynchronously and yield chunks', async () => {
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 2.0, 1.24]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 2.0, 'secondary', 'asphalt', 'grade1']]);

      const cancelToken = { cancelled: false };
      const segments = await service.runSimulationAsync(0, 2.0, cancelToken, 10);
      expect(segments.length).toBe(40);
    });

    it('should abort cleanly if cancelToken is marked cancelled', async () => {
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 2.0, 1.24]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 2.0, 'secondary', 'asphalt', 'grade1']]);

      const cancelToken = { cancelled: true };
      const segments = await service.runSimulationAsync(0, 2.0, cancelToken, 10);
      expect(segments.length).toBe(0);
    });
  });

  describe('queryCumulativeSeconds & calculateEtaSeconds', () => {
    it('should query cumulative seconds with segment interpolation', () => {
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 1.0, 0.62]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 1.0, 'secondary', 'asphalt', 'grade1']]);

      const segments = service.simulateSegments(0, 1.0);
      const totalSec = service.queryCumulativeSeconds(segments, 1.0);
      expect(totalSec).toBeGreaterThan(0);
      expect(service.queryCumulativeSeconds(segments, 0.5)).toBeCloseTo(totalSec / 2, 0);
    });

    it('should calculate eta seconds between miles', () => {
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 10.0, 6.2]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 10.0, 'secondary', 'asphalt', 'grade1']]);

      const segments = service.simulateSegments(0, 10.0);
      const etaSec = service.calculateEtaSeconds(0, 3.0, segments);
      expect(etaSec).toBeGreaterThan(0);
    });
  });

  describe('getClimbPhysicsStats', () => {
    it('should report zero hike distance for flat paved segment', () => {
      const mockTrack: TrackPointTuple[] = [
        [0, 0, 100, 0.0, 0.0],
        [0, 0, 100, 5.0, 3.1]
      ];
      terrain.setTrackPoints(mockTrack);
      terrain.setSurfaceIntervals([[0, 5.0, 'secondary', 'asphalt', 'grade1']]);

      const segments = service.simulateSegments(0, 5.0);
      const stats = service.getClimbPhysicsStats(0, 2.0, segments);
      expect(stats.estimatedSeconds).toBeGreaterThan(0);
      expect(stats.hikeBikeDistanceKm).toBe(0);
      expect(stats.hikeBikeSeconds).toBe(0);
    });
  });
});
