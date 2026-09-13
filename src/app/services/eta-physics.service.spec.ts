import { TestBed } from '@angular/core/testing';
import { EtaPhysicsService } from './eta-physics.service';
import { SettingsService } from './settings.service';

describe('EtaPhysicsService', () => {
  let service: EtaPhysicsService;
  let settings: SettingsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(EtaPhysicsService);
    settings = TestBed.inject(SettingsService);

    // Provide sample track points (elevations climbing from 1000m to 1500m over 10 km)
    const samplePts: [number, number, number, number, number][] = [
      [51.0, -115.0, 1000.0, 0.0, 0.0],
      [50.9, -115.0, 1250.0, 5.0, 3.107],
      [50.8, -115.0, 1500.0, 10.0, 6.214],
      [50.7, -115.0, 1300.0, 15.0, 9.321]
    ];
    service.setTrackPoints(samplePts);

    // Provide sample surface intervals
    service.setSurfaceIntervals([
      [0.0, 5.0, 'unclassified', 'gravel', 'grade2'],
      [5.0, 10.0, 'track', 'dirt', 'grade4'],
      [10.0, 15.0, 'tertiary', 'asphalt', 'grade1']
    ]);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should calculate rolling resistance (Crr) correctly by surface and tracktype', () => {
    // Asphalt Grade 1
    const crrAsphalt = service.getCrr('asphalt', 'grade1', 'secondary');
    expect(crrAsphalt).toBeCloseTo(0.0055, 4);

    // Gravel Grade 2
    const crrGravel = service.getCrr('gravel', 'grade2', 'track');
    expect(crrGravel).toBeCloseTo(0.0184, 4); // 0.016 * 1.15

    // Dirt Grade 4
    const crrDirt = service.getCrr('dirt', 'grade4', 'track');
    expect(crrDirt).toBeCloseTo(0.0396, 4); // 0.022 * 1.80

    // Singletrack Path with Dirt Grade 4 (+0.005 penalty)
    const crrPath = service.getCrr('dirt', 'grade4', 'path');
    expect(crrPath).toBeCloseTo(0.0446, 4);
  });

  it('should solve riding speed realistically using Newton-Raphson', () => {
    // Flat gravel (Crr=0.0184), 150W, 93kg
    const flatSpeed = service.solveRidingSpeed(150, 0.0, 0.0184, 93.0);
    expect(flatSpeed).toBeGreaterThan(19.0);
    expect(flatSpeed).toBeLessThan(22.0);

    // 5% climb, 150W
    const climbSpeed5 = service.solveRidingSpeed(150, 0.05, 0.0184, 93.0);
    expect(climbSpeed5).toBeGreaterThan(7.5);
    expect(climbSpeed5).toBeLessThan(9.0);

    // 10% steep climb, 150W
    const climbSpeed10 = service.solveRidingSpeed(150, 0.10, 0.0184, 93.0);
    expect(climbSpeed10).toBeGreaterThan(4.0);
    expect(climbSpeed10).toBeLessThan(5.5);

    // Descent (-6%) with coasting/light pedaling: capped safely
    const descentSpeed = service.solveRidingSpeed(50, -0.06, 0.0184, 93.0);
    expect(descentSpeed).toBeGreaterThan(25.0);
    expect(descentSpeed).toBeLessThanOrEqual(42.0);
  });

  it('should calculate power needed for a target speed in closed form', () => {
    // Power needed for 6 km/h on flat gravel: ~30W
    const pFlat = service.powerNeededForSpeed(6.0, 0.0, 0.0184, 93.0);
    expect(pFlat).toBeGreaterThan(25.0);
    expect(pFlat).toBeLessThan(35.0);

    // Power needed for 6 km/h on 5% grade: ~109W
    const p5 = service.powerNeededForSpeed(6.0, 0.05, 0.0184, 93.0);
    expect(p5).toBeGreaterThan(100.0);
    expect(p5).toBeLessThan(120.0);

    // Power needed for 6 km/h on 8% grade: ~156W
    const p8 = service.powerNeededForSpeed(6.0, 0.08, 0.0184, 93.0);
    expect(p8).toBeGreaterThan(148.0);
    expect(p8).toBeLessThan(165.0);
  });

  it('should calculate hike-a-bike speed with exact 50% damping at 20% grade', () => {
    const baseHikeKmh = 4.0;

    // Flat ground grade 1 (paved)
    const flatHike = service.calculateHikeSpeed(0.0, 'grade1', 85.0, baseHikeKmh);
    expect(flatHike).toBeCloseTo(4.0, 1);

    // 20% gradient: damping factor = 1 / (1 + 5 * 0.2) = 1 / 2 = 0.5 (exactly half speed)
    const steepHike20 = service.calculateHikeSpeed(0.20, 'grade1', 85.0, baseHikeKmh);
    expect(steepHike20).toBeCloseTo(2.0, 1);

    // Rough tracktype grade 5 drops speed further
    const roughHike = service.calculateHikeSpeed(0.20, 'grade5', 85.0, baseHikeKmh);
    expect(roughHike).toBeLessThan(steepHike20);
    expect(roughHike).toBeGreaterThan(1.0);
  });

  it('should simulate Climb Surge and transition to hike-a-bike when capacity or duration is exceeded', () => {
    settings.riderPowerWatts.set(150);
    settings.climbSurgePercent.set(10); // max surge = 165W
    settings.climbSurgeDurationMinutes.set(5); // 5 min max surge
    settings.hikeBikeThresholdKmh.set(6.0);
    settings.paceMode.set('power');

    // Simulate 2 km climbing stretch
    const segments = service.simulateSegments(0.0, 2.0);
    expect(segments.length).toBe(40); // 2000m / 50m = 40 segments

    // All segments should have valid calculated speeds
    for (const seg of segments) {
      expect(seg.speedKmh).toBeGreaterThan(0.5);
      expect(seg.durationSeconds).toBeGreaterThan(0);
      expect(seg.mode).toBeDefined();
    }
  });

  it('should reset cooloff and remount bike when summit is reached', () => {
    settings.paceMode.set('power');

    // Km 9.5 to 11.5 crosses the summit at Km 10.0 (where elevation crests and descends from 1500m to 1300m)
    const segments = service.simulateSegments(9.5, 2.0);
    const postSummitSegs = segments.filter(s => s.startKm >= 10.0);

    // Past the summit (downhill grade < 0), rider must be riding, not in cooloff hike
    for (const s of postSummitSegs) {
      expect(s.inCooloff).toBe(false);
      expect(s.mode).toBe('riding');
    }
  });

  it('should handle wide permutations of input data without failure or NaN', () => {
    const weights = [50, 75, 95, 130];
    const powers = [80, 150, 250, 400];
    const grades = [-0.15, -0.05, 0.0, 0.05, 0.12, 0.22];
    const surfaces = ['asphalt', 'gravel', 'dirt', 'rock', 'sand'];

    for (const w of weights) {
      for (const p of powers) {
        for (const g of grades) {
          for (const s of surfaces) {
            const crr = service.getCrr(s, 'grade3', 'track');
            const speed = service.solveRidingSpeed(p, g, crr, w);
            expect(isNaN(speed)).toBe(false);
            expect(speed).toBeGreaterThan(0);

            const hikeSpd = service.calculateHikeSpeed(g, 'grade3', w, 4.0);
            expect(isNaN(hikeSpd)).toBe(false);
            expect(hikeSpd).toBeGreaterThanOrEqual(0.8);
          }
        }
      }
    }
  });

  it('should return accurate ETA seconds in both Speed and Power modes', () => {
    // 10 miles at 10 mph in speed mode = 3600 seconds (1 hour)
    settings.paceMode.set('speed');
    settings.avgSpeedMph.set(10.0);
    const etaSpeed = service.calculateEtaSeconds(0.0, 10.0);
    expect(etaSpeed).toBeCloseTo(3600, 0);

    // Power mode with 150W
    settings.paceMode.set('power');
    settings.riderPowerWatts.set(150);
    const etaPower = service.calculateEtaSeconds(0.0, 3.0);
    expect(etaPower).toBeGreaterThan(0);
    expect(isNaN(etaPower)).toBe(false);
  });

  it('should recalculate cache asynchronously and update cacheVersion', async () => {
    settings.paceMode.set('power');
    settings.riderPowerWatts.set(160);

    const initialVersion = service.cacheVersion();
    service.scheduleRecalculation(0, 5, 10);
    expect(service.isCalculating()).toBe(true);

    // Wait for async recalculation to finish
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(service.isCalculating()).toBe(false);
    expect(service.cacheVersion()).toBeGreaterThan(initialVersion);
  });

  it('should debounce rapid recalculation calls and only complete the last run', async () => {
    settings.paceMode.set('power');
    const initialVersion = service.cacheVersion();

    // Simulate 3 rapid clicks on + button
    settings.riderPowerWatts.set(170);
    service.scheduleRecalculation(0, 5, 20);

    settings.riderPowerWatts.set(180);
    service.scheduleRecalculation(0, 5, 20);

    settings.riderPowerWatts.set(190);
    service.scheduleRecalculation(0, 5, 20);

    // Before debounce fires, isCalculating is true
    expect(service.isCalculating()).toBe(true);

    // Wait for the final debounced calculation to complete
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(service.isCalculating()).toBe(false);
    // Should increment exactly once for the batch
    expect(service.cacheVersion()).toBe(initialVersion + 1);
  });
});

