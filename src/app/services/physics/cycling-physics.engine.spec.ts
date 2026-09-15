import { CyclingPhysicsEngine, G, ETA, RHO, CDA, STEP_METERS } from './cycling-physics.engine';

describe('CyclingPhysicsEngine', () => {
  let engine: CyclingPhysicsEngine;

  beforeEach(() => {
    engine = new CyclingPhysicsEngine();
  });

  it('should be created and export constants', () => {
    expect(engine).toBeTruthy();
    expect(G).toBeCloseTo(9.80665, 4);
    expect(ETA).toBe(0.96);
    expect(RHO).toBe(1.08);
    expect(CDA).toBe(0.48);
    expect(STEP_METERS).toBe(50);
  });

  it('should solve flat terrain riding speed with 150W power to ~19-22 km/h', () => {
    const speed = engine.solveRidingSpeed(150, 0, 0.0184, 93);
    expect(speed).toBeGreaterThan(19.0);
    expect(speed).toBeLessThan(22.0);
  });

  it('should solve moderate 5% climb speed to ~7.5-9.0 km/h', () => {
    const speed = engine.solveRidingSpeed(150, 0.05, 0.0184, 93);
    expect(speed).toBeGreaterThan(7.5);
    expect(speed).toBeLessThan(9.0);
  });

  it('should solve steep 10% climb speed to ~4.0-5.5 km/h', () => {
    const speed = engine.solveRidingSpeed(150, 0.10, 0.0184, 93);
    expect(speed).toBeGreaterThan(4.0);
    expect(speed).toBeLessThan(5.5);
  });

  it('should cap descent speed on -6% descent according to Crr limits', () => {
    // Crr = 0.012 -> smooth gravel cap is 42 km/h
    const speed = engine.solveRidingSpeed(200, -0.06, 0.012, 93);
    expect(speed).toBeLessThanOrEqual(42.0);
    expect(speed).toBeGreaterThan(30.0);
  });

  it('should handle downhill coasting with zero pedaling power', () => {
    const coastingSpeed = engine.solveRidingSpeed(0, -0.05, 0.016, 93);
    expect(coastingSpeed).toBeGreaterThan(20.0);
    expect(coastingSpeed).toBeLessThanOrEqual(32.0); // mixed gravel cap
  });

  it('should compute closed-form power needed for target speed invertibly', () => {
    const targetKmh = 15;
    const power = engine.powerNeededForSpeed(targetKmh, 0.04, 0.0184, 93);
    expect(power).toBeGreaterThan(100);

    const speed = engine.solveRidingSpeed(power, 0.04, 0.0184, 93);
    expect(speed).toBeCloseTo(targetKmh, 0);
  });

  it('should calculate hike-a-bike speed with exact 50% damping at 20% grade', () => {
    const baseHikeKmh = 4.0;
    const flatHike = engine.calculateHikeSpeed(0, 'grade1', 85, baseHikeKmh);
    const steepHike = engine.calculateHikeSpeed(0.20, 'grade1', 85, baseHikeKmh);

    expect(flatHike).toBe(4.0);
    expect(steepHike).toBeCloseTo(2.0, 2); // exactly 50%
  });

  it('should apply roughness damping across OSM tracktypes for hike-a-bike', () => {
    const g1 = engine.calculateHikeSpeed(0.05, 'grade1', 85, 4.0);
    const g3 = engine.calculateHikeSpeed(0.05, 'grade3', 85, 4.0);
    const g5 = engine.calculateHikeSpeed(0.05, 'grade5', 85, 4.0);

    expect(g1).toBeGreaterThan(g3);
    expect(g3).toBeGreaterThan(g5);
    expect(g5).toBeGreaterThanOrEqual(0.8);
  });

  it('should maintain numerical stability across extreme parameter matrices with zero NaN', () => {
    const testPowers = [0, 50, 150, 400, 800];
    const testGrades = [-0.20, -0.10, 0, 0.08, 0.25];
    const testCrrs = [0.0055, 0.02, 0.06];
    const testMasses = [40, 85, 130];

    for (const p of testPowers) {
      for (const g of testGrades) {
        for (const crr of testCrrs) {
          for (const m of testMasses) {
            const speed = engine.solveRidingSpeed(p, g, crr, m);
            expect(Number.isNaN(speed)).toBe(false);
            expect(Number.isFinite(speed)).toBe(true);
            expect(speed).toBeGreaterThanOrEqual(0.1);

            const hike = engine.calculateHikeSpeed(g, 'grade3', m, 3.5);
            expect(Number.isNaN(hike)).toBe(false);
            expect(hike).toBeGreaterThanOrEqual(0.8);
          }
        }
      }
    }
  });
});
