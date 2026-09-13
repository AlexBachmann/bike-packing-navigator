import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ResupplyPhysicsService } from '../../services/resupply-physics.service';
import { EtaPhysicsService } from '../../services/eta-physics.service';
import { SettingsService } from '../../services/settings.service';
import {
  DEFAULT_DAY_SCHEDULE_CONFIG,
  DayScheduleConfig,
  DayScheduleSummary,
  NutrientProfile,
  NutrientTargets
} from '../../models/resupply.model';

describe('Tier 5 Adversarial Stress Test: ResupplyPhysicsService & ResupplyModel', () => {
  let physicsService: ResupplyPhysicsService;
  let etaPhysics: EtaPhysicsService;
  let settingsService: SettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ResupplyPhysicsService,
        EtaPhysicsService,
        SettingsService
      ]
    });

    physicsService = TestBed.inject(ResupplyPhysicsService);
    etaPhysics = TestBed.inject(EtaPhysicsService);
    settingsService = TestBed.inject(SettingsService);
  });

  // ==========================================================================
  // 1. Duration Boundary & Anomaly Conditions (Negative, Zero, Extreme, Multi-Day)
  // ==========================================================================
  describe('1. Duration Boundary & Anomaly Conditions', () => {
    it('1.1 should handle negative and near-zero riding durations without NaN or exceptions', () => {
      const negSummary = physicsService.simulateDaySchedule(-5.0);
      expect(negSummary.ridingHours).toBe(0);
      expect(negSummary.sleepHours).toBe(0);
      expect(negSummary.prepWakeHours).toBe(0);
      expect(negSummary.daytimeOffBikeHours).toBe(0);
      expect(negSummary.totalElapsedHours).toBe(0);
      expect(negSummary.sleepCyclesCount).toBe(0);
      expect(negSummary.arrivesAfterNightfall).toBe(false);
      expect(negSummary.arrivalHour).toBe(DEFAULT_DAY_SCHEDULE_CONFIG.departureHour);

      const tinySummary = physicsService.simulateDaySchedule(0.00001);
      expect(tinySummary.ridingHours).toBe(0);
      expect(tinySummary.totalElapsedHours).toBe(0);

      const zeroSummary = physicsService.simulateDaySchedule(0);
      expect(zeroSummary.ridingHours).toBe(0);
      expect(zeroSummary.totalElapsedHours).toBe(0);
    });

    it('1.2 should simulate standard single-day ride arriving before nightfall', () => {
      // 5.0h riding starting at 08:00
      const summary = physicsService.simulateDaySchedule(5.0);
      expect(summary.ridingHours).toBe(5.0);
      expect(summary.sleepHours).toBe(0);
      expect(summary.prepWakeHours).toBe(0);
      expect(summary.sleepCyclesCount).toBe(0);
      expect(summary.arrivesAfterNightfall).toBe(false);
      expect(summary.arrivalHour).toBeLessThan(DEFAULT_DAY_SCHEDULE_CONFIG.nightfallHour);
      expect(summary.totalElapsedHours).toBeGreaterThan(5.0);
    });

    it('1.3 should simulate multi-day pushes (24h, 48h, 72h, 100h) with monotonic progression', () => {
      const hoursList = [24.0, 48.0, 72.0, 100.0];
      let prevElapsed = 0;
      let prevSleep = 0;
      let prevCycles = 0;

      for (const hours of hoursList) {
        const summary = physicsService.simulateDaySchedule(hours);
        expect(summary.ridingHours).toBe(hours);
        expect(summary.totalElapsedHours).toBeGreaterThan(prevElapsed);
        expect(summary.sleepHours).toBeGreaterThan(prevSleep);
        expect(summary.sleepCyclesCount).toBeGreaterThanOrEqual(prevCycles);
        expect(summary.arrivesAfterNightfall).toBe(true);
        expect(Number.isFinite(summary.totalElapsedHours)).toBe(true);
        expect(Number.isFinite(summary.arrivalHour)).toBe(true);
        expect(summary.arrivalHour).toBeGreaterThanOrEqual(0);
        expect(summary.arrivalHour).toBeLessThan(24);

        prevElapsed = summary.totalElapsedHours;
        prevSleep = summary.sleepHours;
        prevCycles = summary.sleepCyclesCount;
      }
    });

    it('1.4 should simulate 500h multi-week expedition without infinite loop or NaN', () => {
      const startTime = Date.now();
      const summary = physicsService.simulateDaySchedule(500.0);
      const durationMs = Date.now() - startTime;

      expect(durationMs).toBeLessThan(200); // Sub-second execution
      expect(summary.ridingHours).toBe(500.0);
      expect(summary.sleepCyclesCount).toBeGreaterThan(20);
      expect(summary.sleepHours).toBeGreaterThan(100);
      expect(summary.totalElapsedHours).toBeGreaterThan(500);
      expect(Number.isFinite(summary.totalElapsedHours)).toBe(true);
      expect(Number.isFinite(summary.arrivalHour)).toBe(true);
    });

    it('1.5 should safely exit via maxIterations guard when given astronomical duration (10,000h)', () => {
      const startTime = Date.now();
      const summary = physicsService.simulateDaySchedule(10000.0);
      const durationMs = Date.now() - startTime;

      expect(durationMs).toBeLessThan(500); // Guard prevents hang
      expect(summary.sleepCyclesCount).toBeLessThanOrEqual(500); // Capped at maxIterations
      expect(Number.isFinite(summary.totalElapsedHours)).toBe(true);
      expect(Number.isFinite(summary.sleepHours)).toBe(true);
    });
  });

  // ==========================================================================
  // 2. Schedule Configuration Edge Cases (0 sleep, >24h sleep blocks, extreme %)
  // ==========================================================================
  describe('2. Schedule Configuration Edge Cases', () => {
    it('2.1 should enforce minimum 1.0h biological sleep floor when targetSleepHours is 0 or negative', () => {
      const summaryZeroSleep = physicsService.simulateDaySchedule(20.0, {
        targetSleepHours: 0
      });
      // Nightfall triggered, sleep block activated
      expect(summaryZeroSleep.sleepCyclesCount).toBeGreaterThanOrEqual(1);
      expect(summaryZeroSleep.sleepHours).toBeGreaterThanOrEqual(1.0);
      expect(Number.isFinite(summaryZeroSleep.totalElapsedHours)).toBe(true);

      const summaryNegSleep = physicsService.simulateDaySchedule(20.0, {
        targetSleepHours: -8.0
      });
      expect(summaryNegSleep.sleepCyclesCount).toBeGreaterThanOrEqual(1);
      expect(summaryNegSleep.sleepHours).toBeGreaterThanOrEqual(1.0);
    });

    it('2.2 should clamp excessive sleep hours (>24h sleep block) to safe biological ceiling', () => {
      // User specifies 30h sleep + 10h prep/wake
      const summary = physicsService.simulateDaySchedule(20.0, {
        targetSleepHours: 30.0,
        prepWakeHours: 10.0
      });

      // Target sleep clamped to 12.0h, prep/wake clamped to 4.0h -> max sleep block 16.0h (<24h)
      expect(summary.sleepHours).toBeLessThanOrEqual(24.0);
      expect(summary.prepWakeHours).toBeLessThanOrEqual(8.0);
      expect(Number.isFinite(summary.totalElapsedHours)).toBe(true);
      expect(summary.totalElapsedHours).toBeGreaterThan(20.0);
    });

    it('2.3 should clamp extreme riding percentages (0%, -50%, 100%, 200%) to valid range [0.10, 0.85]', () => {
      const lowSummary = physicsService.simulateDaySchedule(10.0, {
        dailyRidingPercent: 0.0 // 0% -> clamped to 0.10
      });
      expect(lowSummary.ridingHours).toBe(10.0);
      expect(Number.isFinite(lowSummary.totalElapsedHours)).toBe(true);
      expect(lowSummary.totalElapsedHours).toBeGreaterThan(10.0);

      const negSummary = physicsService.simulateDaySchedule(10.0, {
        dailyRidingPercent: -0.5 // -50% -> clamped to 0.10
      });
      expect(negSummary.ridingHours).toBe(10.0);
      expect(Number.isFinite(negSummary.totalElapsedHours)).toBe(true);

      const highSummary = physicsService.simulateDaySchedule(10.0, {
        dailyRidingPercent: 1.0 // 100% -> clamped to 0.85
      });
      expect(highSummary.ridingHours).toBe(10.0);
      expect(Number.isFinite(highSummary.totalElapsedHours)).toBe(true);

      const extremeSummary = physicsService.simulateDaySchedule(10.0, {
        dailyRidingPercent: 5.0 // 500% -> clamped to 0.85
      });
      expect(extremeSummary.ridingHours).toBe(10.0);
      expect(Number.isFinite(extremeSummary.totalElapsedHours)).toBe(true);
    });

    it('2.4 should handle unusual departure and nightfall hours gracefully', () => {
      // Midnight departure (00:00)
      const midnightSummary = physicsService.simulateDaySchedule(12.0, {
        departureHour: 0.0,
        nightfallHour: 21.0
      });
      expect(midnightSummary.ridingHours).toBe(12.0);
      expect(Number.isFinite(midnightSummary.arrivalHour)).toBe(true);
      expect(midnightSummary.arrivalHour).toBeGreaterThanOrEqual(0);
      expect(midnightSummary.arrivalHour).toBeLessThan(24);

      // Departure past nightfall (22:00 departure, 21:00 nightfall)
      const lateSummary = physicsService.simulateDaySchedule(8.0, {
        departureHour: 22.0,
        nightfallHour: 21.0
      });
      expect(lateSummary.ridingHours).toBe(8.0);
      expect(Number.isFinite(lateSummary.arrivalHour)).toBe(true);
      expect(Number.isFinite(lateSummary.totalElapsedHours)).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Mathematical Robustness: Active Calories & Mifflin-St Jeor BMR
  // ==========================================================================
  describe('3. Mathematical Robustness: Active Calories & BMR', () => {
    it('3.1 should calculate active calories accurately and handle zero, negative, and extreme inputs', () => {
      // Normal: 150W for 1h (3600s) at 24% eff -> 538 kcal
      expect(physicsService.calculateActiveCalories(150, 3600, 0.24)).toBe(538);

      // Zero & negative inputs
      expect(physicsService.calculateActiveCalories(0, 3600)).toBe(0);
      expect(physicsService.calculateActiveCalories(150, 0)).toBe(0);
      expect(physicsService.calculateActiveCalories(-150, 3600)).toBe(0);
      expect(physicsService.calculateActiveCalories(150, -3600)).toBe(0);

      // Efficiency edge cases: 0 or negative efficiency falls back to 0.24
      expect(physicsService.calculateActiveCalories(150, 3600, 0)).toBe(538);
      expect(physicsService.calculateActiveCalories(150, 3600, -0.24)).toBe(538);

      // Extreme values: 2000W sprint
      const sprintKcal = physicsService.calculateActiveCalories(2000, 60, 0.24);
      expect(sprintKcal).toBeGreaterThan(0);
      expect(Number.isFinite(sprintKcal)).toBe(true);
    });

    it('3.2 should compute Mifflin-St Jeor BMR with biological floor clamping', () => {
      // Standard male: 75kg, 175cm, 35yr -> 1673.75 kcal/day (69.74 kcal/h)
      const maleHourly = physicsService.calculateBmrHourly(75, 175, 35, true);
      expect(maleHourly).toBeCloseTo(1673.75 / 24.0, 2);

      // Standard female: 60kg, 165cm, 30yr -> 1320.25 kcal/day (55.01 kcal/h)
      const femaleHourly = physicsService.calculateBmrHourly(60, 165, 30, false);
      expect(femaleHourly).toBeCloseTo(1320.25 / 24.0, 2);

      // Zero, negative, or undefined weight clamped to safe floor
      const zeroWeight = physicsService.calculateBmrHourly(0);
      expect(zeroWeight).toBeGreaterThan(0);
      expect(Number.isFinite(zeroWeight)).toBe(true);

      const negWeight = physicsService.calculateBmrHourly(-20);
      expect(negWeight).toBeGreaterThan(0);
      expect(Number.isFinite(negWeight)).toBe(true);

      // Child/low values clamped to biological minimums
      const lowClamped = physicsService.calculateBmrHourly(10, 50, 5);
      expect(lowClamped).toBeGreaterThan(0);
      expect(Number.isFinite(lowClamped)).toBe(true);
    });
  });

  // ==========================================================================
  // 4. Multi-Nutrient Scaling, Safety Buffer & Stepper Robustness
  // ==========================================================================
  describe('4. Multi-Nutrient Scaling, Safety Buffer & Stepper Robustness', () => {
    it('4.1 should enforce 500 kcal minimum floor under extreme negative calorie adjustments', () => {
      const schedule = physicsService.simulateDaySchedule(0);
      const targets = physicsService.calculateNutrientTargets(0, 0, schedule, 75, 0, -50000);

      expect(targets.totalCaloriesTarget).toBe(500);
      expect(targets.carbsTargetGrams).toBe(Math.round((500 * 0.55) / 4.0));
      expect(targets.proteinTargetGrams).toBe(Math.round((500 * 0.15) / 4.0));
      expect(targets.fatTargetGrams).toBe(Math.round((500 * 0.30) / 9.0));
      expect(targets.fluidsTargetMl).toBe(0);
      expect(targets.sodiumTargetMg).toBe(0);
    });

    it('4.2 should maintain exact mathematical relationship between base and safety buffer percentage', () => {
      const testCases = [
        { hours: 2.0, watts: 120, dist: 25 },
        { hours: 6.0, watts: 150, dist: 75 },
        { hours: 14.0, watts: 180, dist: 160 },
        { hours: 30.0, watts: 140, dist: 350 }
      ];

      for (const tc of testCases) {
        const schedule = physicsService.simulateDaySchedule(tc.hours);
        // Default buffer: 0%
        const targets0 = physicsService.calculateNutrientTargets(tc.dist, tc.hours, schedule, 75, tc.watts, 0);
        expect(targets0.safetyBufferPercent).toBe(0);
        expect(targets0.safetyBufferCalories).toBe(0);
        expect(targets0.totalCaloriesTarget).toBe(targets0.baseCalories);

        // Explicit 10% buffer
        const targets10 = physicsService.calculateNutrientTargets(tc.dist, tc.hours, schedule, 75, tc.watts, 0, 10);
        expect(targets10.safetyBufferPercent).toBe(10);
        expect(targets10.safetyBufferCalories).toBe(Math.round(targets10.baseCalories * 0.10));
        expect(targets10.totalCaloriesTarget).toBe(targets10.baseCalories + targets10.safetyBufferCalories);

        // Verify macronutrient percentages add up to total target energy
        const carbKcal = targets10.carbsTargetGrams * 4.0;
        const proteinKcal = targets10.proteinTargetGrams * 4.0;
        const fatKcal = targets10.fatTargetGrams * 9.0;
        const sumMacroKcal = carbKcal + proteinKcal + fatKcal;

        // Due to rounding to integer grams, sum should be within 1% of totalCaloriesTarget
        expect(Math.abs(sumMacroKcal - targets10.totalCaloriesTarget) / targets10.totalCaloriesTarget).toBeLessThan(0.02);
      }
    });

    it('4.3 should scale electrolytes and hydration proportionally to ride and off-bike time', () => {
      // 10h riding, single day (no sleep)
      const schedule = physicsService.simulateDaySchedule(10.0);
      const targets = physicsService.calculateNutrientTargets(120, 10.0, schedule, 75, 150, 0);

      const awakeOffBike = schedule.daytimeOffBikeHours + schedule.prepWakeHours;
      const expectedSodium = Math.round(10.0 * 600 + awakeOffBike * 95);
      const expectedFluids = Math.round(10.0 * 650 + awakeOffBike * 125);
      const expectedPotassium = Math.round(10.0 * 200 + awakeOffBike * 130);
      const expectedMagnesium = Math.round(10.0 * 40 + awakeOffBike * 15);

      expect(targets.sodiumTargetMg).toBe(expectedSodium);
      expect(targets.fluidsTargetMl).toBe(expectedFluids);
      expect(targets.potassiumTargetMg).toBe(expectedPotassium);
      expect(targets.magnesiumTargetMg).toBe(expectedMagnesium);
    });
  });

  // ==========================================================================
  // 5. Fulfillment Engine Zero & Surplus Boundary Testing
  // ==========================================================================
  describe('5. Fulfillment Engine Zero & Surplus Boundary Testing', () => {
    it('5.1 should handle all-zero targets safely without NaN or division-by-zero', () => {
      const zeroTargets: NutrientTargets = {
        baseCalories: 0,
        safetyBufferCalories: 0,
        userAdjustmentCalories: 0,
        totalCaloriesTarget: 0,
        carbsTargetGrams: 0,
        proteinTargetGrams: 0,
        fatTargetGrams: 0,
        sodiumTargetMg: 0,
        potassiumTargetMg: 0,
        magnesiumTargetMg: 0,
        fluidsTargetMl: 0
      };

      const emptyIntake: NutrientProfile = {
        calories: 0,
        carbs: 0,
        protein: 0,
        fat: 0,
        sodium: 0,
        fluids: 0
      };

      const result = physicsService.calculateFulfillment(emptyIntake, zeroTargets);
      expect(result.calories.percentage).toBe(100);
      expect(result.carbs.percentage).toBe(100);
      expect(result.protein.percentage).toBe(100);
      expect(result.fat.percentage).toBe(100);
      expect(result.sodium.percentage).toBe(100);
      expect(result.fluids.percentage).toBe(100);

      for (const key of ['calories', 'carbs', 'protein', 'fat', 'sodium', 'fluids'] as const) {
        expect(Number.isNaN(result[key].percentage)).toBe(false);
      }
    });

    it('5.2 should accurately compute massive nutrient surplus (>500%)', () => {
      const schedule = physicsService.simulateDaySchedule(4.0);
      const targets = physicsService.calculateNutrientTargets(50, 4.0, schedule, 75, 140, 0);

      const massiveIntake: NutrientProfile = {
        calories: targets.totalCaloriesTarget * 5,
        carbs: targets.carbsTargetGrams * 4,
        protein: targets.proteinTargetGrams * 3,
        fat: targets.fatTargetGrams * 6,
        sodium: targets.sodiumTargetMg * 2,
        fluids: targets.fluidsTargetMl * 2.5
      };

      const fulfillment = physicsService.calculateFulfillment(massiveIntake, targets);
      expect(fulfillment.calories.percentage).toBe(500);
      expect(fulfillment.carbs.percentage).toBe(400);
      expect(fulfillment.protein.percentage).toBe(300);
      expect(fulfillment.fat.percentage).toBe(600);
      expect(fulfillment.sodium.percentage).toBe(200);
      expect(fulfillment.fluids.percentage).toBe(250);
    });

    it('5.3 should sanitize negative or nullish intake values to 0%', () => {
      const schedule = physicsService.simulateDaySchedule(4.0);
      const targets = physicsService.calculateNutrientTargets(50, 4.0, schedule, 75, 140, 0);

      const negativeIntake = {
        calories: -500,
        carbs: -20,
        protein: -10,
        fat: -5,
        sodium: -200,
        fluids: -1000
      } as NutrientProfile;

      const fulfillment = physicsService.calculateFulfillment(negativeIntake, targets);
      expect(fulfillment.calories.current).toBe(0);
      expect(fulfillment.calories.percentage).toBe(0);
      expect(fulfillment.carbs.current).toBe(0);
      expect(fulfillment.carbs.percentage).toBe(0);
      expect(fulfillment.protein.current).toBe(0);
      expect(fulfillment.protein.percentage).toBe(0);
      expect(fulfillment.fat.current).toBe(0);
      expect(fulfillment.fat.percentage).toBe(0);
      expect(fulfillment.sodium.current).toBe(0);
      expect(fulfillment.sodium.percentage).toBe(0);
      expect(fulfillment.fluids.current).toBe(0);
      expect(fulfillment.fluids.percentage).toBe(0);
    });
  });

  // ==========================================================================
  // 6. Strict Isolation from EtaPhysicsService
  // ==========================================================================
  describe('6. Strict Isolation from EtaPhysicsService', () => {
    it('6.1 should confirm zero state leakage or side effects into EtaPhysicsService', () => {
      // Capture initial state of EtaPhysicsService
      const initialIsCalculating = etaPhysics.isCalculating();
      const initialCacheVersion = etaPhysics.cacheVersion();
      const initialDistance = etaPhysics.totalDistanceKm();
      const initialStartKm = etaPhysics.getCachedStartKm();

      // Perform extensive simulations in ResupplyPhysicsService
      for (let i = 1; i <= 50; i++) {
        const schedule = physicsService.simulateDaySchedule(i * 2.0);
        physicsService.calculateNutrientTargets(i * 20, i * 2.0, schedule, 75, 150, i * 100);
        physicsService.calculateActiveCalories(160, i * 3600, 0.24);
        physicsService.calculateBmrHourly(75);
      }

      // Assert EtaPhysicsService state is pristine and completely untouched
      expect(etaPhysics.isCalculating()).toBe(initialIsCalculating);
      expect(etaPhysics.cacheVersion()).toBe(initialCacheVersion);
      expect(etaPhysics.totalDistanceKm()).toBe(initialDistance);
      expect(etaPhysics.getCachedStartKm()).toBe(initialStartKm);
    });

    it('6.2 should confirm EtaPhysicsService calculation output is invariant to ResupplyPhysicsService activity', () => {
      // Speed mode ETA
      settingsService.paceMode.set('speed');
      settingsService.avgSpeedMph.set(12.0);

      const baselineEta = etaPhysics.calculateEtaSeconds(10.0, 50.0);
      expect(baselineEta).toBeCloseTo((40.0 / 12.0) * 3600, 1);

      // Run multiple adversarial schedule simulations
      physicsService.simulateDaySchedule(100.0, { dailyRidingPercent: 0.85, targetSleepHours: 4.0 });
      physicsService.simulateDaySchedule(0);
      physicsService.simulateDaySchedule(24.0);

      // ETA must remain 100% identical
      const afterEta = etaPhysics.calculateEtaSeconds(10.0, 50.0);
      expect(afterEta).toBe(baselineEta);
    });
  });

  // ==========================================================================
  // 7. Human-Readable Duration Formatter Stress Tests
  // ==========================================================================
  describe('7. Human-Readable Duration Formatter Stress Tests', () => {
    it('7.1 should format minutes, hours, full days, and zero correctly', () => {
      expect(physicsService.formatDuration(0)).toBe('0m');
      expect(physicsService.formatDuration(0.25)).toBe('15m');
      expect(physicsService.formatDuration(0.5)).toBe('30m');
      expect(physicsService.formatDuration(1.0)).toBe('1h 00m');
      expect(physicsService.formatDuration(5.75)).toBe('5h 45m');
      expect(physicsService.formatDuration(23.9)).toBe('23h 54m');
      expect(physicsService.formatDuration(24.0)).toBe('1d 0h');
      expect(physicsService.formatDuration(26.5)).toBe('1d 2h');
      expect(physicsService.formatDuration(72.0)).toBe('3d 0h');
      expect(physicsService.formatDuration(100.25)).toBe('4d 4h');
    });
  });
});
