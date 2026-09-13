import { TestBed } from '@angular/core/testing';
import { DEFAULT_DAY_SCHEDULE_CONFIG } from '../models/resupply.model';
import { ResupplyPhysicsService } from './resupply-physics.service';

describe('ResupplyPhysicsService', () => {
  let service: ResupplyPhysicsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ResupplyPhysicsService);
  });

  describe('Active Energy Expenditure', () => {
    it('should compute active calories correctly for standard power and duration', () => {
      // 150 W for 1 hour (3600s) with 24% gross mechanical efficiency
      // (150 * 3600) / (0.24 * 4184) = 540000 / 1004.16 = 537.76 -> 538 kcal
      const kcal = service.calculateActiveCalories(150, 3600, 0.24);
      expect(kcal).toBe(538);
    });

    it('should compute active calories for 180 W for 2 hours', () => {
      // (180 * 7200) / (0.24 * 4184) = 1296000 / 1004.16 = 1290.63 -> 1291 kcal
      const kcal = service.calculateActiveCalories(180, 7200, 0.24);
      expect(kcal).toBe(1291);
    });

    it('should handle zero or negative power and duration gracefully', () => {
      expect(service.calculateActiveCalories(0, 3600)).toBe(0);
      expect(service.calculateActiveCalories(150, 0)).toBe(0);
      expect(service.calculateActiveCalories(-50, 3600)).toBe(0);
      expect(service.calculateActiveCalories(150, -100)).toBe(0);
    });

    it('should support custom rider efficiency values', () => {
      const kcal22 = service.calculateActiveCalories(150, 3600, 0.22);
      const kcal25 = service.calculateActiveCalories(150, 3600, 0.25);
      expect(kcal22).toBeGreaterThan(538);
      expect(kcal25).toBeLessThan(538);
    });
  });

  describe('Mifflin-St Jeor BMR Calculations', () => {
    it('should compute hourly and daily BMR accurately for standard male profile', () => {
      // 75 kg, 175 cm, 35 yr, male
      // BMR = 10(75) + 6.25(175) - 5(35) + 5 = 750 + 1093.75 - 175 + 5 = 1673.75 kcal/day
      const hourly = service.calculateBmrHourly(75, 175, 35, true);
      const daily = service.calculateBmrDaily(75, 175, 35, true);

      expect(daily).toBeCloseTo(1673.75, 1);
      expect(hourly).toBeCloseTo(1673.75 / 24.0, 2);
    });

    it('should compute BMR accurately for female athlete', () => {
      // 60 kg, 165 cm, 30 yr, female
      // BMR = 10(60) + 6.25(165) - 5(30) - 161 = 600 + 1031.25 - 150 - 161 = 1320.25 kcal/day
      const daily = service.calculateBmrDaily(60, 165, 30, false);
      expect(daily).toBeCloseTo(1320.25, 1);
    });

    it('should clamp low weight and dimensions to safe biological limits', () => {
      const bmrLow = service.calculateBmrHourly(10, 50, 5, true);
      expect(bmrLow).toBeGreaterThan(0);
      expect(Number.isFinite(bmrLow)).toBe(true);
    });
  });

  describe('Day Schedule Simulation', () => {
    it('should return zero elapsed metrics when riding duration is zero', () => {
      const summary = service.simulateDaySchedule(0);
      expect(summary.ridingHours).toBe(0);
      expect(summary.sleepHours).toBe(0);
      expect(summary.prepWakeHours).toBe(0);
      expect(summary.daytimeOffBikeHours).toBe(0);
      expect(summary.totalElapsedHours).toBe(0);
      expect(summary.sleepCyclesCount).toBe(0);
      expect(summary.arrivesAfterNightfall).toBe(false);
      expect(summary.arrivalHour).toBe(DEFAULT_DAY_SCHEDULE_CONFIG.departureHour);
    });

    it('should simulate a single-day push that arrives before nightfall', () => {
      // 6 hours riding starting at 08:00.
      // Default: 60% riding (14.4h), 7h sleep block (17h waking day).
      // Off-bike ratio = 2.6 / 14.4 = ~0.18055 off-bike hr / riding hr.
      // Off-bike = 6.0 * 0.18055 = 1.08h. Total elapsed = ~7.1h.
      // Arrival = 08:00 + 7.1h = ~15.1h (approx 15:05 PM, well before 21:00 nightfall).
      const summary = service.simulateDaySchedule(6.0);

      expect(summary.ridingHours).toBe(6.0);
      expect(summary.sleepHours).toBe(0);
      expect(summary.prepWakeHours).toBe(0);
      expect(summary.daytimeOffBikeHours).toBeCloseTo(1.1, 1);
      expect(summary.totalElapsedHours).toBeCloseTo(7.1, 1);
      expect(summary.sleepCyclesCount).toBe(0);
      expect(summary.arrivesAfterNightfall).toBe(false);
      expect(summary.arrivalHour).toBeCloseTo(15.1, 1);
    });

    it('should simulate a multi-day push that triggers nightfall and sleep blocks', () => {
      // 20 hours riding starting at 08:00.
      // Day 1: 13h from 08:00 to 21:00.
      // Day 1 riding = 13.0 * (14.4 / 17.0) = ~11.01h.
      // Day 1 off-bike = ~1.99h.
      // Reaches nightfall at 21:00 -> sleep block triggered (6h sleep + 1h prep/wake = 7h).
      // Clock advances to 04:00 AM next day.
      // Day 2 remaining riding = 20 - 11.01 = 8.99h.
      // Total sleep cycles = 1, sleep hours = 6.0, prepWakeHours = 1.0.
      const summary = service.simulateDaySchedule(20.0);

      expect(summary.ridingHours).toBe(20.0);
      expect(summary.sleepCyclesCount).toBe(1);
      expect(summary.sleepHours).toBe(6.0);
      expect(summary.prepWakeHours).toBe(1.0);
      expect(summary.arrivesAfterNightfall).toBe(true);
      expect(summary.totalElapsedHours).toBeGreaterThan(28.0);
    });

    it('should respect custom schedule configurations', () => {
      const summary = service.simulateDaySchedule(10.0, {
        dailyRidingPercent: 0.50, // 12h riding per 24h
        targetSleepHours: 8.0,    // 8h sleep
        prepWakeHours: 2.0,       // 2h prep/wake -> 10h sleep block
        departureHour: 6.0,       // departure 06:00 AM
        nightfallHour: 20.0       // nightfall 20:00 (8:00 PM)
      });

      expect(summary.ridingHours).toBe(10.0);
      expect(summary.totalElapsedHours).toBeGreaterThan(10.0);
    });
  });

  describe('Multi-Nutrient Target Calculations', () => {
    it('should calculate base calories, default 0% safety buffer, and total target', () => {
      const schedule = service.simulateDaySchedule(6.0);
      const targets = service.calculateNutrientTargets(80, 6.0, schedule, 75, 150, 0);

      // Active: ~3227 kcal (6h at 150W)
      // Inactive: off-bike (~1.1h) * 69.74 * 1.25 = ~96 kcal
      // Base: ~3323 kcal
      // Safety buffer: 0 kcal (default 0%)
      // Total: ~3323 kcal
      expect(targets.baseCalories).toBeGreaterThan(3200);
      expect(targets.safetyBufferPercent).toBe(0);
      expect(targets.safetyBufferCalories).toBe(0);
      expect(targets.totalCaloriesTarget).toBe(targets.baseCalories);

      // Macronutrients
      // Carbs: 55% / 4 kcal/g
      // Protein: 15% / 4 kcal/g
      // Fat: 30% / 9 kcal/g
      const expectedCarbs = Math.round((targets.totalCaloriesTarget * 0.55) / 4.0);
      const expectedProtein = Math.round((targets.totalCaloriesTarget * 0.15) / 4.0);
      const expectedFat = Math.round((targets.totalCaloriesTarget * 0.30) / 9.0);

      expect(targets.carbsTargetGrams).toBe(expectedCarbs);
      expect(targets.proteinTargetGrams).toBe(expectedProtein);
      expect(targets.fatTargetGrams).toBe(expectedFat);

      // Hydration: 6h * 650 + 1.1h * 125 = ~4038 ml
      expect(targets.fluidsTargetMl).toBeGreaterThan(3900);

      // Sodium: 6h * 600 + 1.1h * 95 = ~3705 mg
      expect(targets.sodiumTargetMg).toBeGreaterThan(3600);

      // Potassium & Magnesium
      expect(targets.potassiumTargetMg).toBeGreaterThan(1200);
      expect(targets.magnesiumTargetMg).toBeGreaterThan(240);
    });

    it('should incorporate user safety buffer percent increments (+5%, +10%, -10%)', () => {
      const schedule = service.simulateDaySchedule(6.0);
      const baseTargets = service.calculateNutrientTargets(80, 6.0, schedule, 75, 150, 0, 0);
      const plus10Targets = service.calculateNutrientTargets(80, 6.0, schedule, 75, 150, 0, 10);
      const minus10Targets = service.calculateNutrientTargets(80, 6.0, schedule, 75, 150, 0, -10);

      expect(plus10Targets.safetyBufferPercent).toBe(10);
      expect(plus10Targets.safetyBufferCalories).toBe(Math.round(baseTargets.baseCalories * 0.10));
      expect(plus10Targets.totalCaloriesTarget).toBe(baseTargets.baseCalories + plus10Targets.safetyBufferCalories);

      expect(minus10Targets.safetyBufferPercent).toBe(-10);
      expect(minus10Targets.safetyBufferCalories).toBe(Math.round(baseTargets.baseCalories * -0.10));
      expect(minus10Targets.totalCaloriesTarget).toBe(baseTargets.baseCalories + minus10Targets.safetyBufferCalories);
    });

    it('should clamp total target calories to minimum floor of 500 kcal', () => {
      const schedule = service.simulateDaySchedule(0);
      const clampedTargets = service.calculateNutrientTargets(0, 0, schedule, 75, 0, -200);
      expect(clampedTargets.totalCaloriesTarget).toBe(500);
    });
  });

  describe('Fulfillment Calculation', () => {
    it('should compute exact fulfillment percentages across all nutrients', () => {
      const schedule = service.simulateDaySchedule(6.0);
      const targets = service.calculateNutrientTargets(80, 6.0, schedule, 75, 150, 0);

      const current = {
        calories: Math.round(targets.totalCaloriesTarget * 0.8), // 80%
        carbs: Math.round(targets.carbsTargetGrams * 1.2),       // 120% (surplus)
        protein: Math.round(targets.proteinTargetGrams * 0.5),   // 50%
        fat: targets.fatTargetGrams,                             // 100%
        sodium: Math.round(targets.sodiumTargetMg * 0.75),       // 75%
        fluids: targets.fluidsTargetMl                           // 100%
      };

      const fulfillment = service.calculateFulfillment(current, targets);

      expect(fulfillment.calories.percentage).toBe(80);
      expect(fulfillment.carbs.percentage).toBe(120);
      expect(fulfillment.protein.percentage).toBe(50);
      expect(fulfillment.fat.percentage).toBe(100);
      expect(fulfillment.sodium.percentage).toBe(75);
      expect(fulfillment.fluids.percentage).toBe(100);
    });

    it('should handle zero target safely without NaN', () => {
      const dummyTargets = {
        baseCalories: 0,
        safetyBufferCalories: 0,
        safetyBufferPercent: 0,
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

      const fulfillment = service.calculateFulfillment(
        { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
        dummyTargets
      );

      expect(fulfillment.calories.percentage).toBe(100);
      expect(fulfillment.fluids.percentage).toBe(100);
    });
  });

  describe('Duration Formatter', () => {
    it('should format minutes, hours, and multi-day spans', () => {
      expect(service.formatDuration(0.5)).toBe('30m');
      expect(service.formatDuration(4.25)).toBe('4h 15m');
      expect(service.formatDuration(26.0)).toBe('1d 2h');
      expect(service.formatDuration(50.5)).toBe('2d 2h');
    });
  });
});
