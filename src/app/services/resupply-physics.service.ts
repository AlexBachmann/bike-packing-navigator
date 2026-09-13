import { Injectable } from '@angular/core';
import {
  DayScheduleConfig,
  DayScheduleSummary,
  DEFAULT_DAY_SCHEDULE_CONFIG,
  NutrientFulfillment,
  NutrientMetricFulfillment,
  NutrientProfile,
  NutrientTargets
} from '../models/resupply.model';

@Injectable({
  providedIn: 'root'
})
export class ResupplyPhysicsService {
  /**
   * Active on-bike energy expenditure in kilocalories.
   * Formula: (watts * seconds) / (grossMechanicalEfficiency * 4184)
   * where standard gross mechanical efficiency is 0.24 (24%).
   */
  calculateActiveCalories(watts: number, ridingSeconds: number, efficiency = 0.24): number {
    const safeWatts = Math.max(0, watts);
    const safeSeconds = Math.max(0, ridingSeconds);
    const safeEff = efficiency > 0 ? efficiency : 0.24;
    const calories = (safeWatts * safeSeconds) / (safeEff * 4184);
    return Math.round(calories);
  }

  /**
   * Hourly Basal Metabolic Rate (BMR) via clinical Mifflin-St Jeor Equation:
   * BMR_day = 10 * weight_kg + 6.25 * height_cm - 5 * age_years + (isMale ? 5 : -161)
   * For standard ultra-bikepacker (height 175cm, age 35, male):
   * BMR_day = 10 * weight_kg + 923.75 kcal/day.
   */
  calculateBmrHourly(weightKg: number, heightCm = 175, ageYears = 35, isMale = true): number {
    const safeKg = Math.max(30, weightKg || 75);
    const safeCm = Math.max(100, heightCm);
    const safeAge = Math.max(16, ageYears);
    const sexOffset = isMale ? 5 : -161;
    const dailyBmr = 10 * safeKg + 6.25 * safeCm - 5 * safeAge + sexOffset;
    return dailyBmr / 24.0;
  }

  /**
   * Daily Basal Metabolic Rate in kcal/day.
   */
  calculateBmrDaily(weightKg: number, heightCm = 175, ageYears = 35, isMale = true): number {
    return this.calculateBmrHourly(weightKg, heightCm, ageYears, isMale) * 24.0;
  }

  /**
   * Forward day schedule simulation modeling riding %, target sleep, prep/wake routine,
   * nightfall sleep triggers (~21:00), and proportionate daytime rest/resupply stops.
   */
  simulateDaySchedule(ridingHours: number, userConfig?: Partial<DayScheduleConfig>): DayScheduleSummary {
    const totalRidingHours = Math.max(0, ridingHours);
    const config: DayScheduleConfig = {
      ...DEFAULT_DAY_SCHEDULE_CONFIG,
      ...userConfig
    };

    if (totalRidingHours <= 0.0001) {
      return {
        ridingHours: 0,
        sleepHours: 0,
        prepWakeHours: 0,
        daytimeOffBikeHours: 0,
        totalElapsedHours: 0,
        sleepCyclesCount: 0,
        arrivalHour: config.departureHour,
        arrivesAfterNightfall: false
      };
    }

    const sleepHoursTarget = Math.max(1.0, Math.min(12.0, config.targetSleepHours));
    const prepWakeHours = Math.max(0.0, Math.min(4.0, config.prepWakeHours));
    const sleepBlockDuration = sleepHoursTarget + prepWakeHours;
    const wakingHoursPerDay = Math.max(1.0, 24.0 - sleepBlockDuration);

    // Limit daily riding to at most 95% of available waking hours
    const clampedRidingPct = Math.max(0.10, Math.min(0.85, config.dailyRidingPercent));
    const dailyRidingHours = Math.min(wakingHoursPerDay * 0.95, 24.0 * clampedRidingPct);
    const ridingRatio = dailyRidingHours / wakingHoursPerDay;

    let remainingRiding = totalRidingHours;
    let clockHour = config.departureHour % 24;
    let totalDaytimeOffBike = 0;
    let totalElapsed = 0;
    let totalSleep = 0;
    let totalPrepWake = 0;
    let sleepCyclesCount = 0;

    // Safety counter to prevent infinite loop
    let iterations = 0;
    const maxIterations = 500;

    while (remainingRiding > 0.0001 && iterations < maxIterations) {
      iterations++;

      // Hours available until nightfall in current day
      let hoursUntilNightfall = config.nightfallHour - clockHour;
      if (hoursUntilNightfall <= 0) {
        hoursUntilNightfall += 24;
      }

      const availableWakingBeforeNightfall = Math.min(hoursUntilNightfall, wakingHoursPerDay);
      const maxRidingBeforeNightfall = availableWakingBeforeNightfall * ridingRatio;

      if (remainingRiding <= maxRidingBeforeNightfall) {
        // Finishes before nightfall
        const dayFractionNeeded = remainingRiding / ridingRatio;
        const daytimeOffBike = dayFractionNeeded - remainingRiding;

        totalDaytimeOffBike += daytimeOffBike;
        totalElapsed += dayFractionNeeded;
        clockHour = (clockHour + dayFractionNeeded) % 24;
        remainingRiding = 0;
      } else {
        // Extends past nightfall -> trigger sleep block
        remainingRiding -= maxRidingBeforeNightfall;
        const daytimeOffBike = availableWakingBeforeNightfall - maxRidingBeforeNightfall;

        totalDaytimeOffBike += daytimeOffBike;
        totalElapsed += availableWakingBeforeNightfall;

        // Trigger Sleep Block (sleep + prep/wake)
        totalSleep += sleepHoursTarget;
        totalPrepWake += prepWakeHours;
        totalElapsed += sleepBlockDuration;
        sleepCyclesCount += 1;

        // Clock advances to post-sleep morning wake time
        clockHour = (config.nightfallHour + sleepBlockDuration) % 24;
      }
    }

    const roundedRiding = Math.round(totalRidingHours * 10) / 10;
    const roundedSleep = Math.round(totalSleep * 10) / 10;
    const roundedPrepWake = Math.round(totalPrepWake * 10) / 10;
    const roundedDaytimeOffBike = Math.round(totalDaytimeOffBike * 10) / 10;
    const roundedTotalElapsed = Math.round(totalElapsed * 10) / 10;
    const arrivalHour = Math.round(clockHour * 10) / 10;
    const arrivesAfterNightfall = sleepCyclesCount > 0 || arrivalHour >= config.nightfallHour || clockHour < config.departureHour;

    return {
      ridingHours: roundedRiding,
      sleepHours: roundedSleep,
      prepWakeHours: roundedPrepWake,
      daytimeOffBikeHours: roundedDaytimeOffBike,
      totalElapsedHours: roundedTotalElapsed,
      sleepCyclesCount,
      arrivalHour,
      arrivesAfterNightfall
    };
  }

  /**
   * Multi-nutrient target calculation based on active work, inactive BMR,
   * percentage-based safety buffer (defaults to 0%, ±5% increments), and sports physiology macronutrient/electrolyte ratios.
   */
  calculateNutrientTargets(
    distanceMiles: number,
    ridingHours: number,
    schedule: DayScheduleSummary,
    riderWeightKg: number = 75,
    watts: number = 150,
    userAdjustmentCalories: number = 0,
    safetyBufferPercent: number = 0
  ): NutrientTargets {
    const safeRidingHours = Math.max(0, ridingHours);
    const ridingSeconds = safeRidingHours * 3600;

    // 1. Active energy expenditure
    const activeCalories = this.calculateActiveCalories(watts, ridingSeconds, 0.24);

    // 2. Inactive energy expenditure
    const bmrHourly = this.calculateBmrHourly(riderWeightKg, 175, 35, true);
    const sleepCalories = schedule.sleepHours * bmrHourly * 1.0;
    const awakeOffBikeHours = schedule.daytimeOffBikeHours + schedule.prepWakeHours;
    const awakeOffBikeCalories = awakeOffBikeHours * bmrHourly * 1.25;
    const inactiveCalories = Math.round(sleepCalories + awakeOffBikeCalories);

    // 3. Base calories & percentage-based safety buffer (default 0%, supports negative deficit)
    const baseCalories = activeCalories + inactiveCalories;
    const safeBufferPct = typeof safetyBufferPercent === 'number' && !isNaN(safetyBufferPercent) ? safetyBufferPercent : 0;
    const safetyBufferCalories = Math.round(baseCalories * (safeBufferPct / 100));
    const safeAdjustment = typeof userAdjustmentCalories === 'number' && !isNaN(userAdjustmentCalories) ? userAdjustmentCalories : 0;
    const totalCaloriesTarget = Math.max(500, baseCalories + safetyBufferCalories + safeAdjustment);

    // 4. Macronutrients (Carbs: 55%, Protein: 15%, Fat: 30%)
    const carbsTargetGrams = Math.round((totalCaloriesTarget * 0.55) / 4.0);
    const proteinTargetGrams = Math.round((totalCaloriesTarget * 0.15) / 4.0);
    const fatTargetGrams = Math.round((totalCaloriesTarget * 0.30) / 9.0);

    // 5. Hydration (650 ml/h ride + 125 ml/h awake off-bike)
    const fluidsTargetMl = Math.round(
      safeRidingHours * 650 + awakeOffBikeHours * 125
    );

    // 6. Electrolytes (Sodium: 600 mg/h ride + 95 mg/h off-bike)
    const sodiumTargetMg = Math.round(
      safeRidingHours * 600 + awakeOffBikeHours * 95
    );

    // Potassium: 200 mg/h ride + 130 mg/h off-bike
    const potassiumTargetMg = Math.round(
      safeRidingHours * 200 + awakeOffBikeHours * 130
    );

    // Magnesium: 40 mg/h ride + 15 mg/h off-bike
    const magnesiumTargetMg = Math.round(
      safeRidingHours * 40 + awakeOffBikeHours * 15
    );

    return {
      baseCalories,
      safetyBufferCalories,
      safetyBufferPercent: safeBufferPct,
      userAdjustmentCalories: safeAdjustment,
      totalCaloriesTarget,
      carbsTargetGrams,
      proteinTargetGrams,
      fatTargetGrams,
      sodiumTargetMg,
      potassiumTargetMg,
      magnesiumTargetMg,
      fluidsTargetMl
    };
  }

  /**
   * Computes nutritional fulfillment percentages across all core dimensions.
   */
  calculateFulfillment(current: NutrientProfile, targets: NutrientTargets): NutrientFulfillment {
    const calcMetric = (val: number, tgt: number): NutrientMetricFulfillment => {
      const safeVal = Math.max(0, val || 0);
      const safeTgt = Math.max(0, tgt || 0);
      let percentage = 0;
      if (safeTgt > 0) {
        percentage = Math.round((safeVal / safeTgt) * 100);
      } else {
        percentage = 100;
      }
      return {
        current: Math.round(safeVal),
        target: Math.round(safeTgt),
        percentage
      };
    };

    return {
      calories: calcMetric(current.calories, targets.totalCaloriesTarget),
      carbs: calcMetric(current.carbs, targets.carbsTargetGrams),
      protein: calcMetric(current.protein, targets.proteinTargetGrams),
      fat: calcMetric(current.fat, targets.fatTargetGrams),
      sodium: calcMetric(current.sodium, targets.sodiumTargetMg),
      fluids: calcMetric(current.fluids, targets.fluidsTargetMl)
    };
  }

  /**
   * Formats elapsed hours into human-readable duration (e.g. "4h 30m", "1d 6h").
   */
  formatDuration(hours: number): string {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m}m`;
    if (h < 24) return `${h}h ${m.toString().padStart(2, '0')}m`;
    const days = Math.floor(h / 24);
    const remHours = h % 24;
    return `${days}d ${remHours}h`;
  }
}
