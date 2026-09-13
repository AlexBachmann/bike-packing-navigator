export type GroceryDepartment =
  | 'Produce'
  | 'Bakery'
  | 'Canned/Protein'
  | 'Snacks/Candy'
  | 'Beverages'
  | 'Dairy'
  | 'Prepared/Deli';

export type RecipeCategory = 'meal' | 'snack' | 'drink' | 'quick_bite';

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  department: GroceryDepartment;
}

export interface NutrientProfile {
  calories: number; // kcal
  carbs: number;    // g
  protein: number;  // g
  fat: number;      // g
  sodium: number;   // mg
  fluids: number;   // ml
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  servings: number;
  nutrients: NutrientProfile;
  ingredients: Ingredient[];
  isCustom?: boolean;
  category?: RecipeCategory;
  isDeleted?: boolean;
}

export interface SelectedRecipeItem {
  recipe: Recipe;
  quantity: number;
  enabled: boolean;
}

export interface DayScheduleConfig {
  dailyRidingPercent: number; // e.g. 0.60 (60%)
  targetSleepHours: number;   // e.g. 6.0
  prepWakeHours: number;      // default 1.0 (30m prep + 30m wake)
  departureHour: number;      // default 8.0 (08:00 AM)
  nightfallHour: number;      // default 21.0 (09:00 PM)
}

export interface DayScheduleSummary {
  ridingHours: number;
  sleepHours: number;
  prepWakeHours: number;
  daytimeOffBikeHours: number;
  totalElapsedHours: number;
  sleepCyclesCount: number;
  arrivalHour: number;
  arrivesAfterNightfall: boolean;
}

export interface NutrientTargets {
  baseCalories: number;
  safetyBufferCalories: number;
  safetyBufferPercent?: number;
  userAdjustmentCalories: number;
  totalCaloriesTarget: number;
  carbsTargetGrams: number;
  proteinTargetGrams: number;
  fatTargetGrams: number;
  sodiumTargetMg: number;
  potassiumTargetMg: number;
  magnesiumTargetMg: number;
  fluidsTargetMl: number;
}

export interface NutrientMetricFulfillment {
  current: number;
  target: number;
  percentage: number;
}

export interface NutrientFulfillment {
  calories: NutrientMetricFulfillment;
  carbs: NutrientMetricFulfillment;
  protein: NutrientMetricFulfillment;
  fat: NutrientMetricFulfillment;
  sodium: NutrientMetricFulfillment;
  fluids: NutrientMetricFulfillment;
}

export interface AggregatedGroceryItem {
  id: string;
  name: string;
  totalQuantity: number;
  unit: string;
  department: GroceryDepartment;
  checked?: boolean;
}

export interface DepartmentGroup {
  department: GroceryDepartment;
  items: AggregatedGroceryItem[];
}

export interface ResupplyStorageState {
  version: 1;
  selectedQuantities: Record<string, number>;
  enabledStates: Record<string, boolean>;
  modifiedDefaults: Record<string, Partial<Recipe>>;
  customRecipes: Recipe[];
  deletedRecipeIds?: string[];
  favoriteRecipeIds?: string[];
  safetyBufferPercent?: number;
  userCalorieAdjustment?: number;
  scheduleConfig: Partial<DayScheduleConfig>;
}

export const RESUPPLY_STORAGE_KEY = 'tour_divide_resupply_planner_v1';

export const DEFAULT_DAY_SCHEDULE_CONFIG: DayScheduleConfig = {
  dailyRidingPercent: 0.60,
  targetSleepHours: 6.0,
  prepWakeHours: 1.0,
  departureHour: 8.0,
  nightfallHour: 21.0
};
