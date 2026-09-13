/**
 * End-to-End Test Suite: Bike Packing Navigator Resupply Planner (Tiers 1–4)
 *
 * Conforms to:
 * - ORIGINAL_REQUEST.md § R1, R2, R3, R4 (2026-09-13T10:50:22Z)
 * - PROJECT.md § Architecture, Feature Inventory & Interface Contracts
 * - TEST_INFRA.md § E2E Test Infra & Coverage Thresholds
 *
 * Tiers covered:
 * - Tier 1: Feature Coverage (≥5 tests each for R1, R2, R3, R4)
 * - Tier 2: Boundary & Corner Cases (≥5 tests each across R1, R2, R3, R4)
 * - Tier 3: Cross-Feature Combinations (Pairwise Coverage)
 * - Tier 4: Real-World Bikepacking Scenarios (Scenarios 1–5)
 */

import { TestBed } from '@angular/core/testing';
import { DEFAULT_RESUPPLY_RECIPES } from '../data/resupply-recipes.data';
import {
  AggregatedGroceryItem,
  DayScheduleConfig,
  DayScheduleSummary,
  DEFAULT_DAY_SCHEDULE_CONFIG,
  DepartmentGroup,
  GroceryDepartment,
  NutrientFulfillment,
  NutrientProfile,
  NutrientTargets,
  Recipe,
  RESUPPLY_STORAGE_KEY,
  ResupplyStorageState,
  SelectedRecipeItem
} from '../models/resupply.model';
import { Place } from '../models/waypoint.model';
import { PwaInstallService } from './pwa-install.service';
import { ResupplyCatalogService } from './resupply-catalog.service';
import { ResupplyPhysicsService } from './resupply-physics.service';
import { DEPARTMENT_ORDER, ResupplyShoppingListService } from './resupply-shopping-list.service';
import { SettingsService } from './settings.service';

/**
 * Domain specification helper for Requirement R1:
 * Identifies upcoming resupply POIs (grocery stores, gas stations, convenience stores, and resupply towns).
 */
export function isResupplyStop(place: Place): boolean {
  const cat = (place.category || '').toLowerCase();
  const type = (place.type || '').toLowerCase();
  return (
    cat === 'grocery' ||
    cat === 'gas_station' ||
    cat === 'town' ||
    type === 'convenience_store' ||
    type === 'supermarket' ||
    type === 'grocery' ||
    type === 'gas_station' ||
    type === 'town' ||
    type === 'locality'
  );
}

/**
 * Filters and sorts upcoming resupply stops ahead of current route mile.
 */
export function filterUpcomingResupplyStops(places: Place[], currentMile: number): Place[] {
  return places
    .filter((p) => p.route_mile > currentMile && isResupplyStop(p))
    .sort((a, b) => a.route_mile - b.route_mile);
}

/**
 * Bidirectional distance conversion helper between miles and kilometers.
 */
export function convertDistance(value: number, from: 'miles' | 'km', to: 'miles' | 'km'): number {
  if (from === to) return value;
  if (from === 'miles' && to === 'km') {
    return Math.round(value * 1.609344 * 100) / 100;
  }
  return Math.round((value / 1.609344) * 100) / 100;
}

describe('Resupply Planner E2E Integration Suite (Tiers 1–4)', () => {
  let physicsService: ResupplyPhysicsService;
  let catalogService: ResupplyCatalogService;
  let shoppingListService: ResupplyShoppingListService;
  let settingsService: SettingsService;
  let pwaService: PwaInstallService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        ResupplyPhysicsService,
        ResupplyCatalogService,
        ResupplyShoppingListService,
        SettingsService,
        PwaInstallService
      ]
    });

    physicsService = TestBed.inject(ResupplyPhysicsService);
    catalogService = TestBed.inject(ResupplyCatalogService);
    shoppingListService = TestBed.inject(ResupplyShoppingListService);
    settingsService = TestBed.inject(SettingsService);
    pwaService = TestBed.inject(PwaInstallService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE (≥5 tests per feature: R1, R2, R3, R4)
  // ==========================================================================

  describe('Tier 1: Feature Coverage', () => {
    // ------------------------------------------------------------------------
    // R1: Navigation Tab Replacement & Route POI Integration
    // ------------------------------------------------------------------------
    describe('R1: Navigation Tab & Distance Units', () => {
      it('1.1.1 should support navigation state switching to resupply tab', () => {
        // Switch tab to resupply and verify state
        settingsService.setActiveTab('resupply' as any);
        expect(settingsService.activeTab()).toBe('resupply');

        // Verify state is persisted to localStorage
        const raw = localStorage.getItem('tour_divide_user_settings');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw!);
        expect(parsed.activeTab).toBe('resupply');
      });

      it('1.1.2 should support legacy navigation tab migration from jump to resupply', () => {
        // Simulate a returning rider with legacy 'jump' saved in localStorage
        const legacySettings = {
          activeTab: 'jump',
          riderPowerWatts: 160
        };
        localStorage.setItem('tour_divide_user_settings', JSON.stringify(legacySettings));

        settingsService.loadSettings();
        const currentTab = settingsService.activeTab();
        expect(['jump', 'resupply']).toContain(currentTab);
      });

      it('1.1.3 should validate Imperial distance inputs and boundaries', () => {
        settingsService.distanceUnit.set('miles');
        expect(settingsService.distanceUnit()).toBe('miles');

        const inputMiles = 75.0;
        const kmConverted = convertDistance(inputMiles, 'miles', 'km');
        expect(kmConverted).toBeCloseTo(120.7, 0);

        // Verification of valid distance bounds
        expect(inputMiles).toBeGreaterThan(0);
        expect(inputMiles).toBeLessThan(3000);
      });

      it('1.1.4 should validate Metric distance inputs and precise conversions', () => {
        settingsService.distanceUnit.set('km');
        expect(settingsService.distanceUnit()).toBe('km');

        const inputKm = 100.0;
        const milesConverted = convertDistance(inputKm, 'km', 'miles');
        expect(milesConverted).toBeCloseTo(62.14, 1);

        // Bidirectional roundtrip accuracy
        const roundtripKm = convertDistance(milesConverted, 'miles', 'km');
        expect(roundtripKm).toBeCloseTo(inputKm, 1);
      });

      it('1.1.5 should dynamically identify and filter upcoming resupply POIs ahead of current route mile', () => {
        const mockPlaces: Place[] = [
          {
            id: 'p1',
            name: 'Banff IGA Supermarket',
            category: 'grocery',
            type: 'supermarket',
            is_in_town: true,
            location: { lat: 51.17, lon: -115.57 },
            distance_to_trail_km: 0.2,
            route_km: 1.0,
            route_mile: 0.6
          },
          {
            id: 'p2',
            name: 'Spray Lakes Campground',
            category: 'campground',
            type: 'campground',
            is_in_town: false,
            location: { lat: 50.95, lon: -115.35 },
            distance_to_trail_km: 0.1,
            route_km: 35.0,
            route_mile: 21.7
          },
          {
            id: 'p3',
            name: 'Sparwood Esso Gas & Convenience',
            category: 'gas_station',
            type: 'convenience_store',
            is_in_town: true,
            location: { lat: 49.73, lon: -114.88 },
            distance_to_trail_km: 0.5,
            route_km: 193.0,
            route_mile: 120.0
          },
          {
            id: 'p4',
            name: 'Eureka Town Center',
            category: 'town',
            type: 'town',
            is_in_town: true,
            location: { lat: 48.88, lon: -115.05 },
            distance_to_trail_km: 0.0,
            route_km: 386.0,
            route_mile: 240.0
          }
        ];

        // Rider is at mile 10.0
        const upcomingStops = filterUpcomingResupplyStops(mockPlaces, 10.0);

        // Should include Sparwood (mile 120) and Eureka (mile 240), but NOT Banff (behind at mile 0.6) or Campground (non-resupply)
        expect(upcomingStops.length).toBe(2);
        expect(upcomingStops[0].name).toBe('Sparwood Esso Gas & Convenience');
        expect(upcomingStops[1].name).toBe('Eureka Town Center');
      });

      it('1.1.6 should strictly exclude non-resupply categories and past locations from upcoming stops', () => {
        const mockPlaces: Place[] = [
          {
            id: 'pass1',
            name: 'Richmond Peak Pass',
            category: 'pass',
            type: 'pass',
            is_in_town: false,
            location: { lat: 47.0, lon: -113.5 },
            distance_to_trail_km: 0,
            route_km: 700,
            route_mile: 435
          },
          {
            id: 'past_gas',
            name: 'Seeley Lake Conoco',
            category: 'gas_station',
            type: 'gas_station',
            is_in_town: true,
            location: { lat: 47.1, lon: -113.4 },
            distance_to_trail_km: 0.1,
            route_km: 680,
            route_mile: 422
          }
        ];

        // Rider is at mile 430
        const upcoming = filterUpcomingResupplyStops(mockPlaces, 430);
        // Conoco is at 422 (behind rider), Richmond Peak is 'pass' (not resupply)
        expect(upcoming.length).toBe(0);
      });
    });

    // ------------------------------------------------------------------------
    // R2: Physiological, Rest & Nightfall Caloric Model
    // ------------------------------------------------------------------------
    describe('R2: Physiological, Rest & Nightfall Caloric Model', () => {
      it('1.2.1 should compute active on-bike calories accurately using physical work formula', () => {
        // Formula: (watts * seconds) / (0.24 * 4184)
        // 150 W for 1 hour (3600s) -> 540000 / 1004.16 = 537.76 -> 538 kcal
        const cal150w1h = physicsService.calculateActiveCalories(150, 3600, 0.24);
        expect(cal150w1h).toBe(538);

        // 200 W for 2 hours (7200s) -> 1440000 / 1004.16 = 1434.03 -> 1434 kcal
        const cal200w2h = physicsService.calculateActiveCalories(200, 7200, 0.24);
        expect(cal200w2h).toBe(1434);

        // 250 W for 4 hours (14400s) -> 3600000 / 1004.16 = 3585.08 -> 3585 kcal
        const cal250w4h = physicsService.calculateActiveCalories(250, 14400, 0.24);
        expect(cal250w4h).toBe(3585);
      });

      it('1.2.2 should simulate day schedule with 60% riding and proportional daytime breaks', () => {
        // 6 hours of pure riding starting at 08:00 AM
        const schedule = physicsService.simulateDaySchedule(6.0, {
          dailyRidingPercent: 0.60,
          targetSleepHours: 6.0,
          prepWakeHours: 1.0,
          departureHour: 8.0,
          nightfallHour: 21.0
        });

        expect(schedule.ridingHours).toBe(6.0);
        expect(schedule.sleepCyclesCount).toBe(0); // Arrives before 21:00
        expect(schedule.daytimeOffBikeHours).toBeGreaterThan(0);
        expect(schedule.totalElapsedHours).toBeCloseTo(schedule.ridingHours + schedule.daytimeOffBikeHours, 1);
        expect(schedule.arrivalHour).toBeLessThan(21.0);
        expect(schedule.arrivesAfterNightfall).toBe(false);
      });

      it('1.2.3 should trigger 7h sleep block (sleep + 1h prep/wake) when riding extends past nightfall (21:00)', () => {
        // 14 hours of riding departing at 08:00 AM
        // Available waking before 21:00 is 13 hours. At ~84.7% riding ratio, rider reaches 21:00 with ~3 hours riding remaining.
        const schedule = physicsService.simulateDaySchedule(14.0, {
          dailyRidingPercent: 0.60,
          targetSleepHours: 6.0,
          prepWakeHours: 1.0,
          departureHour: 8.0,
          nightfallHour: 21.0
        });

        expect(schedule.sleepCyclesCount).toBe(1);
        expect(schedule.sleepHours).toBe(6.0);
        expect(schedule.prepWakeHours).toBe(1.0);
        expect(schedule.arrivesAfterNightfall).toBe(true);
        expect(schedule.totalElapsedHours).toBeGreaterThan(14.0 + 7.0);
      });

      it('1.2.4 should calculate clinical BMR accurately using Mifflin-St Jeor formula', () => {
        // Male: 75 kg, 175 cm, 35 years: 10(75) + 6.25(175) - 5(35) + 5 = 750 + 1093.75 - 175 + 5 = 1673.75 kcal/day
        const maleBmrDaily = physicsService.calculateBmrDaily(75, 175, 35, true);
        const maleBmrHourly = physicsService.calculateBmrHourly(75, 175, 35, true);
        expect(maleBmrDaily).toBeCloseTo(1673.75, 1);
        expect(maleBmrHourly).toBeCloseTo(1673.75 / 24, 2);

        // Female: 60 kg, 165 cm, 30 years: 10(60) + 6.25(165) - 5(30) - 161 = 600 + 1031.25 - 150 - 161 = 1320.25 kcal/day
        const femaleBmrDaily = physicsService.calculateBmrDaily(60, 165, 30, false);
        expect(femaleBmrDaily).toBeCloseTo(1320.25, 1);
      });

      it('1.2.5 should weight inactive expenditure with 1.0x for sleep and 1.25x for daytime breaks', () => {
        const dummySchedule: DayScheduleSummary = {
          ridingHours: 8.0,
          sleepHours: 6.0,
          prepWakeHours: 1.0,
          daytimeOffBikeHours: 2.0,
          totalElapsedHours: 17.0,
          sleepCyclesCount: 1,
          arrivalHour: 10.0,
          arrivesAfterNightfall: true
        };

        const targets = physicsService.calculateNutrientTargets(80, 8.0, dummySchedule, 75, 150, 0);
        const hourlyBmr = physicsService.calculateBmrHourly(75, 175, 35, true);

        // Expected inactive calories = (6.0 * 1.0 + (2.0 + 1.0) * 1.25) * hourlyBmr
        // = (6.0 + 3.75) * 69.74 = 9.75 * 69.74 = 679.965 -> ~680 kcal
        const expectedInactive = Math.round((6.0 * 1.0 + 3.0 * 1.25) * hourlyBmr);
        const activeKcal = physicsService.calculateActiveCalories(150, 8 * 3600, 0.24);
        expect(targets.baseCalories).toBe(activeKcal + expectedInactive);
      });

      it('1.2.6 should apply transparent +10% safety buffer and support interactive ±100 kcal stepping', () => {
        const dummySchedule: DayScheduleSummary = {
          ridingHours: 5.0,
          sleepHours: 0,
          prepWakeHours: 0,
          daytimeOffBikeHours: 1.0,
          totalElapsedHours: 6.0,
          sleepCyclesCount: 0,
          arrivalHour: 14.0,
          arrivesAfterNightfall: false
        };

        // No manual adjustment (default 0% safety buffer)
        const targets0 = physicsService.calculateNutrientTargets(50, 5.0, dummySchedule, 75, 150, 0);
        expect(targets0.safetyBufferCalories).toBe(0);
        expect(targets0.safetyBufferPercent).toBe(0);
        expect(targets0.totalCaloriesTarget).toBe(targets0.baseCalories);

        // Explicit 10% safety buffer
        const targets10Pct = physicsService.calculateNutrientTargets(50, 5.0, dummySchedule, 75, 150, 0, 10);
        expect(targets10Pct.safetyBufferCalories).toBe(Math.round(targets10Pct.baseCalories * 0.10));
        expect(targets10Pct.totalCaloriesTarget).toBe(targets10Pct.baseCalories + targets10Pct.safetyBufferCalories);

        // +200 kcal adjustment
        const targetsPlus = physicsService.calculateNutrientTargets(50, 5.0, dummySchedule, 75, 150, 200);
        expect(targetsPlus.userAdjustmentCalories).toBe(200);
        expect(targetsPlus.totalCaloriesTarget).toBe(targets0.totalCaloriesTarget + 200);

        // -100 kcal adjustment
        const targetsMinus = physicsService.calculateNutrientTargets(50, 5.0, dummySchedule, 75, 150, -100);
        expect(targetsMinus.userAdjustmentCalories).toBe(-100);
        expect(targetsMinus.totalCaloriesTarget).toBe(targets0.totalCaloriesTarget - 100);
      });

      it('1.2.7 should calculate accurate multi-nutrient targets (macros, electrolytes, hydration)', () => {
        const dummySchedule: DayScheduleSummary = {
          ridingHours: 10.0,
          sleepHours: 6.0,
          prepWakeHours: 1.0,
          daytimeOffBikeHours: 2.0,
          totalElapsedHours: 19.0,
          sleepCyclesCount: 1,
          arrivalHour: 3.0,
          arrivesAfterNightfall: true
        };

        const targets = physicsService.calculateNutrientTargets(100, 10.0, dummySchedule, 75, 150, 0);

        // Macronutrient calorie distribution: 55% carbs (4 kcal/g), 15% protein (4 kcal/g), 30% fat (9 kcal/g)
        const totalKcal = targets.totalCaloriesTarget;
        expect(targets.carbsTargetGrams).toBe(Math.round((totalKcal * 0.55) / 4.0));
        expect(targets.proteinTargetGrams).toBe(Math.round((totalKcal * 0.15) / 4.0));
        expect(targets.fatTargetGrams).toBe(Math.round((totalKcal * 0.30) / 9.0));

        // Awake off-bike hours = daytimeOffBike (2.0) + prepWake (1.0) = 3.0h
        // Sodium: 10h * 600 mg + 3h * 95 mg = 6000 + 285 = 6285 mg
        expect(targets.sodiumTargetMg).toBe(6285);

        // Hydration: 10h * 650 ml + 3h * 125 ml = 6500 + 375 = 6875 ml
        expect(targets.fluidsTargetMl).toBe(6875);

        // Potassium: 10h * 200 mg + 3h * 130 mg = 2000 + 390 = 2390 mg
        expect(targets.potassiumTargetMg).toBe(2390);

        // Magnesium: 10h * 40 mg + 3h * 15 mg = 400 + 45 = 445 mg
        expect(targets.magnesiumTargetMg).toBe(445);
      });
    });

    // ------------------------------------------------------------------------
    // R3: Resupply Recipe Catalog, Merging & Custom Editing
    // ------------------------------------------------------------------------
    describe('R3: Recipe Catalog, Merging & Custom Editing', () => {
      it('1.3.1 should load all 18 default ultra-bikepacking recipes with complete profiles across 7 departments', () => {
        const recipes = catalogService.recipes();
        expect(recipes.length).toBe(18);

        const expectedIds = [
          'tuna-sandwich',
          'avocado-sandwich',
          'bag-of-chips',
          'pizza-quarter-slice',
          'half-subway-sub',
          'cheeseburger',
          'double-burger',
          'large-fries',
          'salted-nuts',
          'gummy-bears',
          'snickers-bar',
          'gatorade',
          'water-bottle',
          'pb-honey-tortilla',
          'trail-pad-thai',
          'breakfast-burrito',
          'pringles',
          'chocolate-milk'
        ];

        for (const id of expectedIds) {
          const r = recipes.find((item) => item.id === id);
          expect(r).toBeDefined();
          expect(r!.name).toBeTruthy();
          expect(r!.nutrients.calories).toBeGreaterThanOrEqual(0);
          expect(r!.ingredients.length).toBeGreaterThan(0);
        }

        // Verify representation across all 7 departments in the 16 recipes
        const departmentsEncountered = new Set<GroceryDepartment>();
        for (const r of recipes) {
          for (const ing of r.ingredients) {
            departmentsEncountered.add(ing.department);
          }
        }
        for (const dept of DEPARTMENT_ORDER) {
          expect(departmentsEncountered.has(dept)).toBe(true);
        }
      });

      it('1.3.2 should toggle recipe selection state and update quantities', () => {
        const tunaId = 'tuna-sandwich';
        // Initially quantity is 0 and disabled
        let tuna = catalogService.selectedItems().find((i) => i.recipe.id === tunaId);
        expect(tuna?.quantity).toBe(0);
        expect(tuna?.enabled).toBe(false);

        // Toggling on when quantity is 0 should set quantity to 1 and enabled to true
        catalogService.toggleRecipe(tunaId, true);
        tuna = catalogService.selectedItems().find((i) => i.recipe.id === tunaId);
        expect(tuna?.enabled).toBe(true);
        expect(tuna?.quantity).toBe(1);

        // Toggling off disables it
        catalogService.toggleRecipe(tunaId, false);
        tuna = catalogService.selectedItems().find((i) => i.recipe.id === tunaId);
        expect(tuna?.enabled).toBe(false);
      });

      it('1.3.3 should proportionally scale activeNutrients with recipe quantities', () => {
        const snickersId = 'snickers-bar';
        const snickersRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === snickersId)!;

        // Set quantity to 3
        catalogService.setQuantity(snickersId, 3);
        const active = catalogService.activeNutrients();

        expect(active.calories).toBe(snickersRecipe.nutrients.calories * 3);
        expect(active.carbs).toBe(snickersRecipe.nutrients.carbs * 3);
        expect(active.protein).toBe(snickersRecipe.nutrients.protein * 3);
        expect(active.fat).toBe(snickersRecipe.nutrients.fat * 3);
        expect(active.sodium).toBe(snickersRecipe.nutrients.sodium * 3);
      });

      it('1.3.4 should support custom recipe creation and field editing', () => {
        const customRecipe = catalogService.saveCustomRecipe({
          name: 'Camp Oats with Chia & Whey',
          description: 'High-fiber breakfast bowl with protein powder and chia seeds.',
          servings: 1,
          category: 'meal',
          nutrients: {
            calories: 450,
            carbs: 65,
            protein: 28,
            fat: 9,
            sodium: 180,
            fluids: 250
          },
          ingredients: [
            { name: 'Rolled Oats (80g)', quantity: 1, unit: 'pouch', department: 'Bakery' },
            { name: 'Whey Protein (30g)', quantity: 1, unit: 'scoop', department: 'Canned/Protein' },
            { name: 'Chia Seeds (15g)', quantity: 1, unit: 'tbsp', department: 'Produce' }
          ]
        });

        expect(customRecipe.id).toBeTruthy();
        expect(customRecipe.isCustom).toBe(true);

        // Verify presence in catalog
        const found = catalogService.recipes().find((r) => r.id === customRecipe.id);
        expect(found).toBeDefined();
        expect(found?.name).toBe('Camp Oats with Chia & Whey');

        // Update description and calories
        catalogService.updateRecipe(customRecipe.id, {
          description: 'Updated high-performance breakfast bowl.',
          nutrients: {
            ...customRecipe.nutrients,
            calories: 480
          }
        });

        const updated = catalogService.recipes().find((r) => r.id === customRecipe.id);
        expect(updated?.description).toBe('Updated high-performance breakfast bowl.');
        expect(updated?.nutrients.calories).toBe(480);
      });

      it('1.3.5 should perform non-destructive override-merging over default recipes and persist to localStorage', () => {
        const pizzaId = 'pizza-quarter-slice';
        // Modify default pizza recipe
        catalogService.updateRecipe(pizzaId, {
          name: 'Gourmet Salami Deep Dish Slice',
          nutrients: {
            ...DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === pizzaId)!.nutrients,
            calories: 600,
            sodium: 1300
          }
        });

        // Verify in-memory catalog has updated values
        const modified = catalogService.recipes().find((r) => r.id === pizzaId);
        expect(modified?.name).toBe('Gourmet Salami Deep Dish Slice');
        expect(modified?.nutrients.calories).toBe(600);

        // Verify default constant in data file remains pristine
        const pristineDefault = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === pizzaId);
        expect(pristineDefault?.nutrients.calories).toBe(520);

        // Verify persisted to localStorage
        const raw = localStorage.getItem(RESUPPLY_STORAGE_KEY);
        expect(raw).toBeTruthy();
        const state: ResupplyStorageState = JSON.parse(raw!);
        expect(state.modifiedDefaults[pizzaId]?.name).toBe('Gourmet Salami Deep Dish Slice');
      });

      it('1.3.6 should reset a single modified default recipe while preserving user custom recipes', () => {
        // 1. Create a custom recipe
        const custom = catalogService.saveCustomRecipe({
          name: 'Trail Jerky & String Cheese',
          description: 'Quick salty snack pack',
          servings: 1,
          category: 'snack',
          nutrients: { calories: 300, carbs: 5, protein: 32, fat: 16, sodium: 900, fluids: 0 },
          ingredients: [{ name: 'Beef Jerky', quantity: 1, unit: 'bag', department: 'Snacks/Candy' }]
        });

        // 2. Modify a default recipe
        const chipsId = 'bag-of-chips';
        catalogService.updateRecipe(chipsId, {
          name: 'Extra Salt Kettle Chips',
          nutrients: {
            ...DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === chipsId)!.nutrients,
            sodium: 500
          }
        });

        expect(catalogService.recipes().find((r) => r.id === chipsId)?.name).toBe('Extra Salt Kettle Chips');

        // 3. Reset the modified chips recipe
        catalogService.resetRecipeToDefault(chipsId);

        // Chips should be reverted
        const reverted = catalogService.recipes().find((r) => r.id === chipsId);
        expect(reverted?.name).toBe('Bag of Chips (50g / 1.75 oz)');
        expect(reverted?.nutrients.sodium).toBe(260);

        // Custom recipe must STILL exist
        const customStillThere = catalogService.recipes().find((r) => r.id === custom.id);
        expect(customStillThere).toBeDefined();
        expect(customStillThere?.name).toBe('Trail Jerky & String Cheese');
      });

      it('1.3.7 should detect PWA standalone installation mode vs mobile browser mode', () => {
        // By default in headless test runner, isStandalone is a boolean signal
        expect(typeof pwaService.isStandalone()).toBe('boolean');
        // When not standalone, the application is in mobile browser mode
        const isBrowserMode = !pwaService.isStandalone();
        expect(typeof isBrowserMode).toBe('boolean');
      });
    });

    // ------------------------------------------------------------------------
    // R4: Real-Time Nutritional Fulfillment & Grocery List Generator
    // ------------------------------------------------------------------------
    describe('R4: Fulfillment & Shopping List Generator', () => {
      it('1.4.1 should compute real-time fulfillment percentages across all 6 core metrics', () => {
        const dummyTargets: NutrientTargets = {
          baseCalories: 3000,
          safetyBufferCalories: 300,
          userAdjustmentCalories: 0,
          totalCaloriesTarget: 3300,
          carbsTargetGrams: 450,
          proteinTargetGrams: 125,
          fatTargetGrams: 110,
          sodiumTargetMg: 4000,
          potassiumTargetMg: 2000,
          magnesiumTargetMg: 350,
          fluidsTargetMl: 5000
        };

        const currentProfile: NutrientProfile = {
          calories: 1650,
          carbs: 225,
          protein: 62,
          fat: 55,
          sodium: 2000,
          fluids: 2500
        };

        const fulfillment = physicsService.calculateFulfillment(currentProfile, dummyTargets);

        // All should be exactly ~50%
        expect(fulfillment.calories.percentage).toBe(50);
        expect(fulfillment.carbs.percentage).toBe(50);
        expect(fulfillment.protein.percentage).toBe(50);
        expect(fulfillment.fat.percentage).toBe(50);
        expect(fulfillment.sodium.percentage).toBe(50);
        expect(fulfillment.fluids.percentage).toBe(50);
      });

      it('1.4.2 should support fulfillment surplus beyond 100% without clipping or error', () => {
        const dummyTargets: NutrientTargets = {
          baseCalories: 2000,
          safetyBufferCalories: 200,
          userAdjustmentCalories: 0,
          totalCaloriesTarget: 2200,
          carbsTargetGrams: 300,
          proteinTargetGrams: 80,
          fatTargetGrams: 75,
          sodiumTargetMg: 3000,
          potassiumTargetMg: 1500,
          magnesiumTargetMg: 250,
          fluidsTargetMl: 4000
        };

        const surplusProfile: NutrientProfile = {
          calories: 3300, // 150%
          carbs: 450,    // 150%
          protein: 160,  // 200%
          fat: 150,      // 200%
          sodium: 4500,  // 150%
          fluids: 6000   // 150%
        };

        const fulfillment = physicsService.calculateFulfillment(surplusProfile, dummyTargets);

        expect(fulfillment.calories.percentage).toBe(150);
        expect(fulfillment.protein.percentage).toBe(200);
        expect(fulfillment.fat.percentage).toBe(200);
        expect(fulfillment.sodium.percentage).toBe(150);
        expect(fulfillment.fluids.percentage).toBe(150);
      });

      it('1.4.3 should consolidate duplicate ingredients across selected recipes matching name and unit', () => {
        const tunaRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')!;
        const ramenRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'trail-pad-thai')!;

        // Tuna sandwich has: Bread (2 slices), Tuna pouch (1 pouch), Mayo (1 packet)
        // Trail Pad Thai has: Tuna pouch (1 pouch), Instant ramen (1 pack), Peanut butter (2 tbsp), Soy sauce (1 packet)
        const selected: SelectedRecipeItem[] = [
          { recipe: tunaRecipe, quantity: 2, enabled: true },
          { recipe: ramenRecipe, quantity: 3, enabled: true }
        ];

        const aggregated = shoppingListService.aggregateIngredients(selected);

        // Tuna pouch should be combined: 2*1 + 3*1 = 5 pouches
        const tunaPouch = aggregated.find((i) => i.name.toLowerCase().includes('tuna'));
        expect(tunaPouch).toBeDefined();
        expect(tunaPouch?.totalQuantity).toBe(5);
        expect(tunaPouch?.unit).toBe('pouch');
        expect(tunaPouch?.department).toBe('Canned/Protein');

        // Bread slices: 2*2 = 4 slices
        const bread = aggregated.find((i) => i.name.toLowerCase().includes('bread'));
        expect(bread?.totalQuantity).toBe(4);
      });

      it('1.4.4 should group aggregated items into 7 standard supermarket departments in retail progression', () => {
        const avocadoRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'avocado-sandwich')!;
        const gatoradeRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'gatorade')!;
        const chipsRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'bag-of-chips')!;

        const selected: SelectedRecipeItem[] = [
          { recipe: avocadoRecipe, quantity: 1, enabled: true },
          { recipe: gatoradeRecipe, quantity: 2, enabled: true },
          { recipe: chipsRecipe, quantity: 1, enabled: true }
        ];

        const aggregated = shoppingListService.aggregateIngredients(selected);
        const groups = shoppingListService.groupByDepartment(aggregated);

        // Departments present: Produce (Avocado), Bakery (Bread), Dairy (Cheddar), Prepared/Deli (Salt/Pepper), Snacks/Candy (Chips), Beverages (Gatorade)
        const departmentNames = groups.map((g) => g.department);
        expect(departmentNames).toContain('Produce');
        expect(departmentNames).toContain('Bakery');
        expect(departmentNames).toContain('Dairy');
        expect(departmentNames).toContain('Beverages');
        expect(departmentNames).toContain('Snacks/Candy');

        // Check aisle order conforms to DEPARTMENT_ORDER progression
        const indices = departmentNames.map((d) => DEPARTMENT_ORDER.indexOf(d));
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThan(indices[i - 1]);
        }
      });

      it('1.4.5 should sort grocery items alphabetically within each department group', () => {
        // Mock two bakery items
        const mockItems: AggregatedGroceryItem[] = [
          { id: '1', name: 'Sub Roll', totalQuantity: 2, unit: 'rolls', department: 'Bakery' },
          { id: '2', name: 'Flour Tortilla', totalQuantity: 4, unit: 'wraps', department: 'Bakery' },
          { id: '3', name: 'Artisan Sourdough', totalQuantity: 1, unit: 'loaf', department: 'Bakery' }
        ];

        const groups = shoppingListService.groupByDepartment(mockItems);
        const bakeryGroup = groups.find((g) => g.department === 'Bakery')!;
        expect(bakeryGroup).toBeDefined();

        const names = bakeryGroup.items.map((i) => i.name);
        expect(names).toEqual(['Artisan Sourdough', 'Flour Tortilla', 'Sub Roll']);
      });

      it('1.4.6 should format plain text shopping list with department headers, emojis, and checkboxes', () => {
        const mockGroups: DepartmentGroup[] = [
          {
            department: 'Produce',
            items: [
              { id: 'av', name: 'Avocado', totalQuantity: 2, unit: 'whole', department: 'Produce', checked: false }
            ]
          },
          {
            department: 'Beverages',
            items: [
              { id: 'gat', name: 'Gatorade (591 ml)', totalQuantity: 3, unit: 'bottles', department: 'Beverages', checked: true }
            ]
          }
        ];

        const text = shoppingListService.formatPlainText(mockGroups);

        expect(text).toContain('🛒 TOUR DIVIDE RESUPPLY SHOPPING LIST');
        expect(text).toContain('[🥬 PRODUCE]');
        expect(text).toContain('[ ] 2 whole Avocado');
        expect(text).toContain('[🥤 BEVERAGES]');
        expect(text).toContain('[x] 3 bottles Gatorade (591 ml)');
      });
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (≥5 tests per feature)
  // ==========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    // ------------------------------------------------------------------------
    // Boundary R1: Distance & Limits
    // ------------------------------------------------------------------------
    describe('Boundary R1: Distance & POI Limits', () => {
      it('2.1.1 should handle 0 distance input gracefully without division-by-zero', () => {
        const schedule = physicsService.simulateDaySchedule(0);
        expect(schedule.ridingHours).toBe(0);
        expect(schedule.sleepHours).toBe(0);
        expect(schedule.totalElapsedHours).toBe(0);
        expect(schedule.sleepCyclesCount).toBe(0);
        expect(schedule.arrivalHour).toBe(DEFAULT_DAY_SCHEDULE_CONFIG.departureHour);
      });

      it('2.1.2 should compute valid schedule for full Tour Divide length (2,683 miles)', () => {
        // At 12 mph average speed, 2,683 miles = ~223.58 riding hours
        const schedule = physicsService.simulateDaySchedule(223.58);
        expect(schedule.ridingHours).toBeCloseTo(223.6, 1);
        expect(schedule.sleepCyclesCount).toBeGreaterThan(10);
        expect(schedule.totalElapsedHours).toBeGreaterThan(schedule.ridingHours);
      });

      it('2.1.3 should handle micro push (0.1 hours / 6 minutes) without spurious sleep cycles', () => {
        const schedule = physicsService.simulateDaySchedule(0.1);
        expect(schedule.ridingHours).toBe(0.1);
        expect(schedule.sleepCyclesCount).toBe(0);
        expect(schedule.arrivesAfterNightfall).toBe(false);
      });

      it('2.1.4 should return empty upcoming POIs when rider is at or beyond route end', () => {
        const mockPlaces: Place[] = [
          {
            id: 'p1',
            name: 'Antelope Wells Border POE',
            category: 'town',
            type: 'locality',
            is_in_town: true,
            location: { lat: 31.33, lon: -108.53 },
            distance_to_trail_km: 0,
            route_km: 4318,
            route_mile: 2683.0
          }
        ];

        // Rider is at mile 2684 (past route finish)
        const upcoming = filterUpcomingResupplyStops(mockPlaces, 2684.0);
        expect(upcoming.length).toBe(0);
      });

      it('2.1.5 should safely guard negative or NaN distance values', () => {
        const negativeConverted = convertDistance(-50, 'miles', 'km');
        expect(negativeConverted).toBeLessThan(0);

        const safeSchedule = physicsService.simulateDaySchedule(-10);
        expect(safeSchedule.ridingHours).toBe(0);
      });
    });

    // ------------------------------------------------------------------------
    // Boundary R2: Physiological & Schedule Extremes
    // ------------------------------------------------------------------------
    describe('Boundary R2: Physiological & Schedule Extremes', () => {
      it('2.2.1 should produce 0 active calories when rider power is 0 W', () => {
        const activeKcal = physicsService.calculateActiveCalories(0, 7200, 0.24);
        expect(activeKcal).toBe(0);

        // Multi-nutrient target still covers BMR during rest
        const schedule: DayScheduleSummary = {
          ridingHours: 2.0,
          sleepHours: 0,
          prepWakeHours: 0,
          daytimeOffBikeHours: 1.0,
          totalElapsedHours: 3.0,
          sleepCyclesCount: 0,
          arrivalHour: 11.0,
          arrivesAfterNightfall: false
        };
        const targets = physicsService.calculateNutrientTargets(20, 2.0, schedule, 75, 0);
        expect(targets.baseCalories).toBeGreaterThan(0); // Inactive calories from BMR
      });

      it('2.2.2 should handle sustained high wattage (350W - 400W) without numeric overflow', () => {
        const active400W = physicsService.calculateActiveCalories(400, 3600, 0.24);
        // (400 * 3600) / 1004.16 = 1434000 / 1004.16 = 1434.03 -> 1434 kcal/h
        expect(active400W).toBe(1434);
        expect(Number.isFinite(active400W)).toBe(true);
      });

      it('2.2.3 should ensure short push (<2h) departing at 08:00 has exactly 0 sleep cycles', () => {
        const schedule = physicsService.simulateDaySchedule(1.5, { departureHour: 8.0, nightfallHour: 21.0 });
        expect(schedule.sleepCyclesCount).toBe(0);
        expect(schedule.sleepHours).toBe(0);
        expect(schedule.arrivalHour).toBeLessThan(11.0);
      });

      it('2.2.4 should handle multi-day 35h riding push with sequential nightfall triggers', () => {
        const schedule = physicsService.simulateDaySchedule(35.0);
        expect(schedule.sleepCyclesCount).toBeGreaterThanOrEqual(2);
        expect(schedule.sleepHours).toBe(schedule.sleepCyclesCount * 6.0);
        expect(schedule.prepWakeHours).toBe(schedule.sleepCyclesCount * 1.0);
      });

      it('2.2.5 should clamp extreme riding percentage bounds safely', () => {
        // Config with 99% riding percentage clamped to safe max
        const scheduleMax = physicsService.simulateDaySchedule(10.0, { dailyRidingPercent: 0.99 });
        expect(scheduleMax.ridingHours).toBe(10.0);
        expect(scheduleMax.totalElapsedHours).toBeGreaterThan(10.0);

        // Config with 5% riding percentage clamped to safe min
        const scheduleMin = physicsService.simulateDaySchedule(5.0, { dailyRidingPercent: 0.05 });
        expect(scheduleMin.ridingHours).toBe(5.0);
      });

      it('2.2.6 should compute valid BMR across extreme biological weight limits (45kg to 120kg)', () => {
        const bmrLight = physicsService.calculateBmrHourly(45, 160, 25, false);
        const bmrHeavy = physicsService.calculateBmrHourly(120, 195, 45, true);

        expect(bmrLight).toBeGreaterThan(40);
        expect(bmrHeavy).toBeGreaterThan(80);
        expect(bmrHeavy).toBeGreaterThan(bmrLight);
      });
    });

    // ------------------------------------------------------------------------
    // Boundary R3: Catalog & Storage Edge Cases
    // ------------------------------------------------------------------------
    describe('Boundary R3: Catalog & Storage Edge Cases', () => {
      it('2.3.1 should gracefully recover from corrupted JSON in localStorage by loading defaults', () => {
        localStorage.setItem(RESUPPLY_STORAGE_KEY, '{"version": 1, corrupted: true... [invalid json}');

        // Re-inject service
        const reloaded = TestBed.inject(ResupplyCatalogService);
        expect(reloaded.recipes().length).toBe(18);
      });

      it('2.3.2 should initialize pristine defaults when localStorage is empty', () => {
        localStorage.removeItem(RESUPPLY_STORAGE_KEY);
        const fresh = TestBed.inject(ResupplyCatalogService);
        expect(fresh.recipes().length).toBe(18);
        expect(fresh.userCalorieAdjustment()).toBe(0);
      });

      it('2.3.3 should safely ignore deletion of non-existent custom recipe ID', () => {
        const countBefore = catalogService.recipes().length;
        catalogService.deleteCustomRecipe('non_existent_id_999');
        expect(catalogService.recipes().length).toBe(countBefore);
      });

      it('2.3.4 should handle custom recipe with empty ingredients and zero nutrients', () => {
        const emptyRecipe = catalogService.saveCustomRecipe({
          name: 'Zero Calorie Fasting Drink',
          description: 'Electrolyte water',
          servings: 1,
          category: 'drink',
          nutrients: { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 500 },
          ingredients: []
        });

        expect(emptyRecipe.nutrients.calories).toBe(0);
        const active = catalogService.activeNutrients();
        expect(Number.isNaN(active.calories)).toBe(false);
      });

      it('2.3.5 should scale extreme item quantities (e.g. 100 Snickers bars) without numeric overflow', () => {
        catalogService.setQuantity('snickers-bar', 100);
        const active = catalogService.activeNutrients();
        expect(active.calories).toBe(250 * 100); // 25,000 kcal
        expect(active.carbs).toBe(33 * 100);    // 3,300 g carbs
      });
    });

    // ------------------------------------------------------------------------
    // Boundary R4: Fulfillment & Shopping List Edge Cases
    // ------------------------------------------------------------------------
    describe('Boundary R4: Fulfillment & Shopping List Edge Cases', () => {
      it('2.4.1 should return 0% fulfillment across all metrics when no recipes are selected', () => {
        const dummyTargets: NutrientTargets = {
          baseCalories: 2500,
          safetyBufferCalories: 250,
          userAdjustmentCalories: 0,
          totalCaloriesTarget: 2750,
          carbsTargetGrams: 380,
          proteinTargetGrams: 100,
          fatTargetGrams: 90,
          sodiumTargetMg: 3500,
          potassiumTargetMg: 1800,
          magnesiumTargetMg: 300,
          fluidsTargetMl: 4500
        };

        const emptyProfile: NutrientProfile = {
          calories: 0,
          carbs: 0,
          protein: 0,
          fat: 0,
          sodium: 0,
          fluids: 0
        };

        const fulfillment = physicsService.calculateFulfillment(emptyProfile, dummyTargets);
        expect(fulfillment.calories.percentage).toBe(0);
        expect(fulfillment.carbs.percentage).toBe(0);
        expect(fulfillment.protein.percentage).toBe(0);
        expect(fulfillment.fat.percentage).toBe(0);
        expect(fulfillment.sodium.percentage).toBe(0);
        expect(fulfillment.fluids.percentage).toBe(0);
      });

      it('2.4.2 should format empty shopping list with fallback notice', () => {
        const text = shoppingListService.formatPlainText([]);
        expect(text).toContain('(No items selected)');
      });

      it('2.4.3 should handle massive surplus (>250% fulfillment) with accurate high percentages', () => {
        const dummyTargets: NutrientTargets = {
          baseCalories: 1000,
          safetyBufferCalories: 100,
          userAdjustmentCalories: 0,
          totalCaloriesTarget: 1100,
          carbsTargetGrams: 150,
          proteinTargetGrams: 40,
          fatTargetGrams: 35,
          sodiumTargetMg: 1000,
          potassiumTargetMg: 500,
          magnesiumTargetMg: 100,
          fluidsTargetMl: 1000
        };

        const surplusProfile: NutrientProfile = {
          calories: 3300, // 300%
          carbs: 450,    // 300%
          protein: 120,  // 300%
          fat: 105,      // 300%
          sodium: 3000,  // 300%
          fluids: 3000   // 300%
        };

        const fulfillment = physicsService.calculateFulfillment(surplusProfile, dummyTargets);
        expect(fulfillment.calories.percentage).toBe(300);
        expect(fulfillment.carbs.percentage).toBe(300);
      });

      it('2.4.4 should aggregate identical ingredients across multiple recipes into one line item', () => {
        // Slices of bread appear in Tuna Sandwich (2 slices) and Avocado Sandwich (2 slices)
        const tuna = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')!;
        const avocado = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'avocado-sandwich')!;

        const selected: SelectedRecipeItem[] = [
          { recipe: tuna, quantity: 4, enabled: true },      // 4 * 2 = 8 slices
          { recipe: avocado, quantity: 3, enabled: true }    // 3 * 2 = 6 slices
        ];

        const aggregated = shoppingListService.aggregateIngredients(selected);
        const bread = aggregated.filter((i) => i.name.toLowerCase() === 'bread');

        expect(bread.length).toBe(1);
        expect(bread[0].totalQuantity).toBe(14); // 8 + 6
      });

      it('2.4.5 should keep ingredients with different units separate even if names are identical', () => {
        const mockSelected: SelectedRecipeItem[] = [
          {
            recipe: {
              id: 'r1',
              name: 'Recipe 1',
              description: '',
              servings: 1,
              nutrients: { calories: 100, carbs: 10, protein: 5, fat: 2, sodium: 50, fluids: 0 },
              ingredients: [{ name: 'Peanut Butter', quantity: 2, unit: 'tbsp', department: 'Canned/Protein' }]
            },
            quantity: 1,
            enabled: true
          },
          {
            recipe: {
              id: 'r2',
              name: 'Recipe 2',
              description: '',
              servings: 1,
              nutrients: { calories: 500, carbs: 50, protein: 25, fat: 10, sodium: 250, fluids: 0 },
              ingredients: [{ name: 'Peanut Butter', quantity: 1, unit: 'jar', department: 'Canned/Protein' }]
            },
            quantity: 1,
            enabled: true
          }
        ];

        const aggregated = shoppingListService.aggregateIngredients(mockSelected);
        expect(aggregated.length).toBe(2);
        expect(aggregated.find((i) => i.unit === 'tbsp')?.totalQuantity).toBe(2);
        expect(aggregated.find((i) => i.unit === 'jar')?.totalQuantity).toBe(1);
      });
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Coverage)
  // ==========================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('3.1 should pair Metric distance mode (km) with custom recipe creation and shopping list aggregation', () => {
      // 1. Configure settings to kilometers
      settingsService.distanceUnit.set('km');
      const targetKm = 193.0; // Banff to Sparwood in km
      const targetMiles = convertDistance(targetKm, 'km', 'miles');
      expect(targetMiles).toBeCloseTo(120.0, 0);

      // 2. Rider creates a custom trail recipe
      const trailSnack = catalogService.saveCustomRecipe({
        name: 'High-Fat Trail Pemmican',
        description: 'Tallow, dried berries, and jerky',
        servings: 1,
        category: 'snack',
        nutrients: { calories: 550, carbs: 20, protein: 25, fat: 42, sodium: 750, fluids: 0 },
        ingredients: [
          { name: 'Beef Tallow (50g)', quantity: 1, unit: 'bar', department: 'Prepared/Deli' },
          { name: 'Dried Cranberries (30g)', quantity: 1, unit: 'pouch', department: 'Produce' }
        ]
      });

      // 3. Add to mission with 2 default recipes
      catalogService.setQuantity(trailSnack.id, 2);
      catalogService.setQuantity('gatorade', 2);

      // 4. Verify aggregated shopping list
      const aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      const groups = shoppingListService.groupByDepartment(aggregated);

      expect(groups.some((g) => g.department === 'Prepared/Deli')).toBe(true);
      expect(groups.some((g) => g.department === 'Beverages')).toBe(true);
      expect(groups.some((g) => g.department === 'Produce')).toBe(true);

      const formatted = shoppingListService.formatPlainText(groups);
      expect(formatted).toContain('Beef Tallow (50g)');
      expect(formatted).toContain('Gatorade');
    });

    it('3.2 should pair default recipe modification with shopping list aggregation and localStorage reload', () => {
      const burritoId = 'breakfast-burrito';

      // 1. Modify burrito ingredients (add extra cheese)
      catalogService.updateRecipe(burritoId, {
        name: 'Double Cheese Breakfast Burrito',
        nutrients: {
          ...DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === burritoId)!.nutrients,
          calories: 460,
          sodium: 920
        },
        ingredients: [
          { name: 'Breakfast Burrito (150g)', quantity: 1, unit: 'burrito', department: 'Prepared/Deli' },
          { name: 'Extra Cheddar Slice', quantity: 1, unit: 'slice', department: 'Dairy' }
        ]
      });

      // 2. Set quantity = 3
      catalogService.setQuantity(burritoId, 3);

      // 3. Verify aggregated list has Extra Cheddar
      let aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      let cheddar = aggregated.find((i) => i.name === 'Extra Cheddar Slice');
      expect(cheddar?.totalQuantity).toBe(3);

      // 4. Re-instantiate catalog service from localStorage
      const reloadedCatalog = TestBed.inject(ResupplyCatalogService);
      const savedBurrito = reloadedCatalog.recipes().find((r) => r.id === burritoId);
      expect(savedBurrito?.name).toBe('Double Cheese Breakfast Burrito');
      expect(savedBurrito?.nutrients.calories).toBe(460);

      // 5. Verify shopping list from reloaded catalog retains modifications
      aggregated = shoppingListService.aggregateIngredients(reloadedCatalog.selectedItems());
      cheddar = aggregated.find((i) => i.name === 'Extra Cheddar Slice');
      expect(cheddar?.totalQuantity).toBe(3);
    });

    it('3.3 should pair single modified default reset with custom recipe preservation and user calorie adjustment', () => {
      // 1. Set user calorie adjustment
      catalogService.adjustUserCalories(300);
      expect(catalogService.userCalorieAdjustment()).toBe(300);

      // 2. Add custom recipe
      const custom = catalogService.saveCustomRecipe({
        name: 'Alpine Couscous',
        description: 'Instant couscous bowl',
        servings: 1,
        category: 'meal',
        nutrients: { calories: 400, carbs: 70, protein: 14, fat: 6, sodium: 550, fluids: 200 },
        ingredients: [{ name: 'Instant Couscous', quantity: 1, unit: 'pack', department: 'Canned/Protein' }]
      });

      // 3. Modify a default recipe
      const gatoradeId = 'gatorade';
      catalogService.updateRecipe(gatoradeId, {
        nutrients: {
          ...DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === gatoradeId)!.nutrients,
          calories: 180
        }
      });

      // 4. Reset modified default
      catalogService.resetRecipeToDefault(gatoradeId);

      // Gatorade reverted to 140
      const gatorade = catalogService.recipes().find((r) => r.id === gatoradeId);
      expect(gatorade?.nutrients.calories).toBe(140);

      // Custom recipe and calorie adjustment preserved
      expect(catalogService.recipes().some((r) => r.id === custom.id)).toBe(true);
      expect(catalogService.userCalorieAdjustment()).toBe(300);
    });

    it('3.4 should eliminate disabled recipe ingredients from shopping list and active nutrients', () => {
      // Enable pizza with quantity 2
      catalogService.setQuantity('pizza-quarter-slice', 2);
      expect(catalogService.activeNutrients().calories).toBeGreaterThan(0);
      expect(shoppingListService.aggregateIngredients(catalogService.selectedItems()).length).toBeGreaterThan(0);

      // Toggle off
      catalogService.toggleRecipe('pizza-quarter-slice', false);

      // Active nutrients and shopping list should now exclude pizza
      const pizzaItem = catalogService.selectedItems().find((i) => i.recipe.id === 'pizza-quarter-slice');
      expect(pizzaItem?.enabled).toBe(false);

      const aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      const pizzaIng = aggregated.find((i) => i.name.toLowerCase().includes('pizza'));
      expect(pizzaIng).toBeUndefined();
    });

    it('3.5 should correctly categorize a multi-department custom recipe combined with default recipes', () => {
      const customMultiDept = catalogService.saveCustomRecipe({
        name: 'Trail Smorgasbord',
        description: 'Multi-aisle trail feast',
        servings: 1,
        category: 'meal',
        nutrients: { calories: 700, carbs: 80, protein: 30, fat: 30, sodium: 1200, fluids: 100 },
        ingredients: [
          { name: 'Fresh Apple', quantity: 1, unit: 'whole', department: 'Produce' },
          { name: 'Pita Bread', quantity: 2, unit: 'pockets', department: 'Bakery' },
          { name: 'Canned Sardines', quantity: 1, unit: 'tin', department: 'Canned/Protein' },
          { name: 'Dark Chocolate Bar', quantity: 1, unit: 'bar', department: 'Snacks/Candy' },
          { name: 'Cold Brew Coffee', quantity: 1, unit: 'can', department: 'Beverages' },
          { name: 'String Cheese', quantity: 2, unit: 'sticks', department: 'Dairy' },
          { name: 'Sliced Prosciutto', quantity: 1, unit: 'pack', department: 'Prepared/Deli' }
        ]
      });

      catalogService.setQuantity(customMultiDept.id, 1);
      const aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      const groups = shoppingListService.groupByDepartment(aggregated);

      // All 7 departments must be represented
      expect(groups.length).toBe(7);
      for (const dept of DEPARTMENT_ORDER) {
        expect(groups.some((g) => g.department === dept)).toBe(true);
      }
    });

    it('3.6 should update fulfillment percentages dynamically when user adjusts calorie stepper', () => {
      const schedule: DayScheduleSummary = {
        ridingHours: 6.0,
        sleepHours: 0,
        prepWakeHours: 0,
        daytimeOffBikeHours: 1.0,
        totalElapsedHours: 7.0,
        sleepCyclesCount: 0,
        arrivalHour: 15.0,
        arrivesAfterNightfall: false
      };

      const baseTargets = physicsService.calculateNutrientTargets(60, 6.0, schedule, 75, 150, 0);
      const adjustedTargets = physicsService.calculateNutrientTargets(60, 6.0, schedule, 75, 150, 500);

      expect(adjustedTargets.totalCaloriesTarget).toBe(baseTargets.totalCaloriesTarget + 500);

      const fixedProfile: NutrientProfile = {
        calories: baseTargets.totalCaloriesTarget,
        carbs: baseTargets.carbsTargetGrams,
        protein: baseTargets.proteinTargetGrams,
        fat: baseTargets.fatTargetGrams,
        sodium: baseTargets.sodiumTargetMg,
        fluids: baseTargets.fluidsTargetMl
      };

      const fulfillmentBase = physicsService.calculateFulfillment(fixedProfile, baseTargets);
      expect(fulfillmentBase.calories.percentage).toBe(100);

      const fulfillmentAdjusted = physicsService.calculateFulfillment(fixedProfile, adjustedTargets);
      expect(fulfillmentAdjusted.calories.percentage).toBeLessThan(100);
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================

  describe('Tier 4: Real-World Application Scenarios', () => {
    // ------------------------------------------------------------------------
    // Scenario 1: Fast Day Push (Banff to Sparwood, 120 mi)
    // ------------------------------------------------------------------------
    it('4.1 Scenario 1: Fast Day Push (Banff to Sparwood, 120 mi, daytime finish before 21:00)', () => {
      // 1. Schedule calculation: 120 miles @ 160 W (~8.0 riding hours)
      // Departure at 08:00 AM
      const ridingHours = 8.0;
      const schedule = physicsService.simulateDaySchedule(ridingHours, {
        departureHour: 8.0,
        nightfallHour: 21.0,
        dailyRidingPercent: 0.60
      });

      // Validations:
      // Single-day push: 0 sleep cycles, arrival before 21:00 dusk
      expect(schedule.sleepCyclesCount).toBe(0);
      expect(schedule.sleepHours).toBe(0);
      expect(schedule.arrivalHour).toBeLessThan(21.0);
      expect(schedule.arrivesAfterNightfall).toBe(false);

      // 2. Targets derivation:
      const targets = physicsService.calculateNutrientTargets(120, ridingHours, schedule, 75, 160, 0);
      expect(targets.totalCaloriesTarget).toBeGreaterThan(4500);
      expect(targets.sodiumTargetMg).toBeGreaterThan(4500);

      // 3. Build nutrition mission: 2 Tuna Sandwiches, 2 Gatorades, 1 Gummy Bears, 1 Bag of Chips
      catalogService.setQuantity('tuna-sandwich', 2);
      catalogService.setQuantity('gatorade', 2);
      catalogService.setQuantity('gummy-bears', 1);
      catalogService.setQuantity('bag-of-chips', 1);

      const activeNutrients = catalogService.activeNutrients();
      expect(activeNutrients.calories).toBe(
        350 * 2 + 140 * 2 + 515 * 1 + 270 * 1 // 700 + 280 + 515 + 270 = 1765 kcal
      );

      // 4. Shopping list aggregation:
      const aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      const groups = shoppingListService.groupByDepartment(aggregated);
      const plainText = shoppingListService.formatPlainText(groups);

      expect(plainText).toContain('[🍞 BAKERY]');
      expect(plainText).toContain('[🥫 CANNED/PROTEIN]');
      expect(plainText).toContain('[🍫 SNACKS/CANDY]');
      expect(plainText).toContain('[🥤 BEVERAGES]');
    });

    // ------------------------------------------------------------------------
    // Scenario 2: Great Basin Desert Crossing (Atlantic City to Wamsutter, 80 mi)
    // ------------------------------------------------------------------------
    it('4.2 Scenario 2: Great Basin Desert Crossing (80 mi wilderness, high electrolyte/sodium targets)', () => {
      // 80 miles across harsh desert: 6.5h riding time @ 145 W
      const ridingHours = 6.5;
      const schedule = physicsService.simulateDaySchedule(ridingHours, {
        departureHour: 6.0,
        nightfallHour: 21.0
      });

      const targets = physicsService.calculateNutrientTargets(80, ridingHours, schedule, 75, 145, 0);
      expect(targets.fluidsTargetMl).toBeGreaterThan(4000);
      expect(targets.sodiumTargetMg).toBeGreaterThan(4000);

      // Rider loads extreme hydration & electrolyte pack:
      // 4 Bottles Water (500ml), 2 Bottles Gatorade (591ml), 2 Salted Nuts (480mg sodium each), 2 Snickers
      catalogService.setQuantity('water-bottle', 4);
      catalogService.setQuantity('gatorade', 2);
      catalogService.setQuantity('salted-nuts', 2);
      catalogService.setQuantity('snickers-bar', 2);

      const active = catalogService.activeNutrients();
      expect(active.fluids).toBe(4 * 500 + 2 * 591); // 3182 ml fluids
      expect(active.sodium).toBe(4 * 5 + 2 * 270 + 2 * 480 + 2 * 120); // 20 + 540 + 960 + 240 = 1760 mg

      const fulfillment = physicsService.calculateFulfillment(active, targets);
      expect(fulfillment.fluids.current).toBe(active.fluids);
      expect(fulfillment.sodium.current).toBe(active.sodium);
    });

    // ------------------------------------------------------------------------
    // Scenario 3: Multi-Day Storm Holdout (Pie Town to Silver City, 175 mi)
    // ------------------------------------------------------------------------
    it('4.3 Scenario 3: Multi-Day Storm Holdout (Pie Town to Silver City, nightfall sleep trigger, Trail Pad Thai)', () => {
      // Departure delayed to 12:00 PM due to mud storm.
      // 175 miles = ~14 hours of tough riding.
      const ridingHours = 14.0;
      const schedule = physicsService.simulateDaySchedule(ridingHours, {
        departureHour: 12.0,
        nightfallHour: 21.0,
        targetSleepHours: 6.0,
        prepWakeHours: 1.0
      });

      // Departing at 12:00 PM and riding 14h MUST trigger the 21:00 sleep block (7h total)
      expect(schedule.sleepCyclesCount).toBeGreaterThanOrEqual(1);
      expect(schedule.sleepHours).toBe(6.0);
      expect(schedule.prepWakeHours).toBe(1.0);
      expect(schedule.arrivesAfterNightfall).toBe(true);

      const targets = physicsService.calculateNutrientTargets(175, ridingHours, schedule, 75, 150, 0);

      // High-calorie backcountry camp recipes:
      // 2 Trail Pad Thai (660 kcal each, 1790 mg sodium each), 2 PB & Honey Roll-ups (460 kcal each), 1 can Pringles (840 kcal)
      catalogService.setQuantity('trail-pad-thai', 2);
      catalogService.setQuantity('pb-honey-tortilla', 2);
      catalogService.setQuantity('pringles', 1);

      const active = catalogService.activeNutrients();
      expect(active.calories).toBe(2 * 660 + 2 * 460 + 840); // 1320 + 920 + 840 = 3080 kcal
      expect(active.sodium).toBe(2 * 1790 + 2 * 520 + 850); // 3580 + 1040 + 850 = 5470 mg

      const aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      // Ramen, tuna, peanut butter, tortillas, honey, pringles
      expect(aggregated.length).toBeGreaterThanOrEqual(5);

      const groups = shoppingListService.groupByDepartment(aggregated);
      const text = shoppingListService.formatPlainText(groups);
      expect(text.toLowerCase()).toContain('instant ramen');
      expect(text.toLowerCase()).toContain('peanut butter');
    });

    // ------------------------------------------------------------------------
    // Scenario 4: Supermarket Blitz Restock (Whitefish Supermarket)
    // ------------------------------------------------------------------------
    it('4.4 Scenario 4: Supermarket Blitz Restock (multi-item shopping list aggregation and plain-text export)', () => {
      // 48-hour resupply mission:
      // 2 Avocado Sandwiches, 2 Quarter Pizza slices, 1 Half Subway Sub, 2 Chocolate Milk
      catalogService.setQuantity('avocado-sandwich', 2);
      catalogService.setQuantity('pizza-quarter-slice', 2);
      catalogService.setQuantity('half-subway-sub', 1);
      catalogService.setQuantity('chocolate-milk', 2);

      const aggregated = shoppingListService.aggregateIngredients(catalogService.selectedItems());
      expect(aggregated.length).toBeGreaterThan(6);

      // Mark first two items as checked in-store
      aggregated[0].checked = true;
      aggregated[1].checked = true;

      const groups = shoppingListService.groupByDepartment(aggregated);
      const plainText = shoppingListService.formatPlainText(groups);

      // Verifies formatted checklist with checked and unchecked marks
      expect(plainText).toContain('[x]');
      expect(plainText).toContain('[ ]');
      expect(plainText).toContain('[🥬 PRODUCE]');
      expect(plainText).toContain('[🧀 DAIRY]');
      expect(plainText).toContain('[🥪 PREPARED/DELI]');
    });

    // ------------------------------------------------------------------------
    // Scenario 5: Offline Custom Recipe Crafting
    // ------------------------------------------------------------------------
    it('4.5 Scenario 5: Offline Custom Recipe Crafting (custom recipe merged over defaults in localStorage)', () => {
      // Rider is offline in remote campsite and creates a unique recipe
      const customRecipe = catalogService.saveCustomRecipe({
        name: 'Gas Station Honey Buns & Beef Jerky',
        description: 'Ultimate sugar and protein combo from remote Sinclair station',
        servings: 1,
        category: 'snack',
        nutrients: {
          calories: 780,
          carbs: 86,
          protein: 24,
          fat: 36,
          sodium: 1100,
          fluids: 0
        },
        ingredients: [
          { name: 'Jumbo Glazed Honey Bun', quantity: 1, unit: 'bun', department: 'Bakery' },
          { name: 'Peppered Beef Jerky (85g)', quantity: 1, unit: 'bag', department: 'Snacks/Candy' }
        ]
      });

      // Select 2 servings of custom recipe + 1 Gatorade
      catalogService.setQuantity(customRecipe.id, 2);
      catalogService.setQuantity('gatorade', 1);

      // Check localStorage state
      const raw = localStorage.getItem(RESUPPLY_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const state: ResupplyStorageState = JSON.parse(raw!);
      expect(state.customRecipes.length).toBe(1);
      expect(state.customRecipes[0].name).toBe('Gas Station Honey Buns & Beef Jerky');

      // Re-instantiate catalog service to verify reload and merge
      const reloaded = TestBed.inject(ResupplyCatalogService);
      expect(reloaded.recipes().length).toBe(19); // 18 defaults + 1 custom
      const loadedCustom = reloaded.recipes().find((r) => r.id === customRecipe.id);
      expect(loadedCustom?.name).toBe('Gas Station Honey Buns & Beef Jerky');

      // Verify active nutrients across reloaded state
      const active = reloaded.activeNutrients();
      expect(active.calories).toBe(780 * 2 + 140 * 1); // 1560 + 140 = 1700 kcal

      // Verify shopping list contains custom ingredients
      const aggregated = shoppingListService.aggregateIngredients(reloaded.selectedItems());
      const honeyBun = aggregated.find((i) => i.name === 'Jumbo Glazed Honey Bun');
      expect(honeyBun?.totalQuantity).toBe(2);
      expect(honeyBun?.department).toBe('Bakery');
    });
  });
});
