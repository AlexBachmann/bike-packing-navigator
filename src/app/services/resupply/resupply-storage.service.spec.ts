import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResupplyStorageService } from './resupply-storage.service';
import { DEFAULT_RESUPPLY_RECIPES } from '../../data/resupply-recipes.data';
import { RESUPPLY_STORAGE_KEY } from '../../models/resupply.model';

describe('ResupplyStorageService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should initialize with 18 default recipes from DEFAULT_RESUPPLY_RECIPES', () => {
    const service = new ResupplyStorageService();
    expect(service.recipes().length).toBe(DEFAULT_RESUPPLY_RECIPES.length);
    expect(service.recipes().length).toBe(18);
    expect(service.recipes()[0].name).toBe(DEFAULT_RESUPPLY_RECIPES[0].name);
  });

  it('should assemble valid nutritional profiles and ingredients for all recipes', () => {
    const service = new ResupplyStorageService();
    for (const recipe of service.recipes()) {
      expect(recipe.id).toBeDefined();
      expect(recipe.nutrients).toBeDefined();
      expect(recipe.nutrients.calories).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(recipe.ingredients)).toBe(true);
      expect(recipe.ingredients.length).toBeGreaterThan(0);
    }
  });

  it('should generate unique IDs and append custom recipes', () => {
    const service = new ResupplyStorageService();
    const { recipe, isNew } = service.saveCustomRecipe({
      name: 'Trail Trail Mix',
      description: 'Custom blend',
      category: 'snack',
      servings: 1,
      nutrients: { calories: 350, carbs: 40, protein: 10, fat: 15, sodium: 120, fluids: 0 },
      ingredients: [{ name: 'Almonds', quantity: 50, unit: 'g', department: 'Snacks/Candy' }]
    });

    expect(isNew).toBe(true);
    expect(recipe.id).toMatch(/^custom_/);
    expect(recipe.isCustom).toBe(true);
    expect(service.recipes().some((r) => r.id === recipe.id)).toBe(true);
  });

  it('should handle ID collisions with default recipe IDs by prefixing custom-', () => {
    const service = new ResupplyStorageService();
    const defaultId = DEFAULT_RESUPPLY_RECIPES[0].id;
    const { recipe } = service.saveCustomRecipe({
      id: defaultId,
      name: 'Custom Duplicate',
      description: 'Collision test',
      category: 'meal',
      servings: 1,
      nutrients: { calories: 200, carbs: 20, protein: 5, fat: 5, sodium: 50, fluids: 0 },
      ingredients: []
    });

    expect(recipe.id).toBe(`custom-${defaultId}`);
    expect(service.recipes().some((r) => r.id === defaultId)).toBe(true);
    expect(service.recipes().some((r) => r.id === `custom-${defaultId}`)).toBe(true);
  });

  it('should update existing custom recipes', () => {
    const service = new ResupplyStorageService();
    const { recipe } = service.saveCustomRecipe({
      name: 'Energy Bar',
      description: 'Initial',
      category: 'snack',
      servings: 1,
      nutrients: { calories: 200, carbs: 30, protein: 5, fat: 5, sodium: 100, fluids: 0 },
      ingredients: []
    });

    service.updateRecipe(recipe.id, {
      name: 'Super Energy Bar',
      nutrients: { calories: 250, carbs: 35, protein: 8, fat: 6, sodium: 120, fluids: 0 }
    });

    const updated = service.recipes().find((r) => r.id === recipe.id);
    expect(updated?.name).toBe('Super Energy Bar');
    expect(updated?.nutrients.calories).toBe(250);
  });

  it('should mark custom recipes as deleted and exclude them from recipes()', () => {
    const service = new ResupplyStorageService();
    const { recipe } = service.saveCustomRecipe({
      name: 'Temporary Snack',
      description: '',
      category: 'snack',
      servings: 1,
      nutrients: { calories: 100, carbs: 10, protein: 2, fat: 2, sodium: 20, fluids: 0 },
      ingredients: []
    });

    expect(service.recipes().some((r) => r.id === recipe.id)).toBe(true);
    service.deleteRecipe(recipe.id);

    expect(service.isRecipeDeleted(recipe.id)).toBe(true);
    expect(service.recipes().some((r) => r.id === recipe.id)).toBe(false);
  });

  it('should store default recipe modifications non-destructively without mutating constant', () => {
    const service = new ResupplyStorageService();
    const defaultId = DEFAULT_RESUPPLY_RECIPES[0].id;
    const originalCalories = DEFAULT_RESUPPLY_RECIPES[0].nutrients.calories;

    service.updateRecipe(defaultId, {
      nutrients: { ...DEFAULT_RESUPPLY_RECIPES[0].nutrients, calories: 999 }
    });

    const inCatalog = service.recipes().find((r) => r.id === defaultId);
    expect(inCatalog?.nutrients.calories).toBe(999);
    expect(DEFAULT_RESUPPLY_RECIPES[0].nutrients.calories).toBe(originalCalories);
  });

  it('should reset modified default recipe back to pristine state', () => {
    const service = new ResupplyStorageService();
    const defaultId = DEFAULT_RESUPPLY_RECIPES[0].id;
    const originalCalories = DEFAULT_RESUPPLY_RECIPES[0].nutrients.calories;

    service.updateRecipe(defaultId, {
      nutrients: { ...DEFAULT_RESUPPLY_RECIPES[0].nutrients, calories: 999 }
    });
    service.resetRecipeToDefault(defaultId);

    const inCatalog = service.recipes().find((r) => r.id === defaultId);
    expect(inCatalog?.nutrients.calories).toBe(originalCalories);
  });

  it('should reset all recipes, modifications, and deletions via resetAllToDefault', () => {
    const service = new ResupplyStorageService();
    service.saveCustomRecipe({
      name: 'Custom 1',
      description: '',
      category: 'snack',
      servings: 1,
      nutrients: { calories: 100, carbs: 10, protein: 2, fat: 2, sodium: 20, fluids: 0 },
      ingredients: []
    });
    service.deleteRecipe(DEFAULT_RESUPPLY_RECIPES[0].id);

    service.resetAllToDefault();
    expect(service.recipes().length).toBe(DEFAULT_RESUPPLY_RECIPES.length);
    expect(service.isRecipeDeleted(DEFAULT_RESUPPLY_RECIPES[0].id)).toBe(false);
  });

  it('should serialize state to localStorage under tour_divide_resupply_planner_v1', () => {
    const service = new ResupplyStorageService();
    service.saveState({
      selectedQuantities: { 'tuna-packet': 2 },
      enabledStates: { 'tuna-packet': true },
      favoriteRecipeIds: ['tuna-packet'],
      safetyBufferPercent: 15,
      userCalorieAdjustment: 100,
      scheduleConfig: { targetSleepHours: 8 }
    });

    const stored = JSON.parse(localStorage.getItem(RESUPPLY_STORAGE_KEY) || '{}');
    expect(stored.version).toBe(1);
    expect(stored.selectedQuantities['tuna-packet']).toBe(2);
    expect(stored.favoriteRecipeIds).toContain('tuna-packet');
    expect(stored.safetyBufferPercent).toBe(15);
  });

  it('should recover gracefully from malformed JSON in localStorage', () => {
    localStorage.setItem(RESUPPLY_STORAGE_KEY, 'INVALID_JSON_CORRUPT{');
    const service = new ResupplyStorageService();
    expect(service.recipes().length).toBe(18);
  });

  it('should ignore unhandled schema versions (e.g. version 999)', () => {
    localStorage.setItem(
      RESUPPLY_STORAGE_KEY,
      JSON.stringify({ version: 999, customRecipes: [{ id: 'corrupt', name: 'Corrupt' }] })
    );
    const service = new ResupplyStorageService();
    expect(service.recipes().length).toBe(18);
  });

  it('should handle QuotaExceededError DOMException on localStorage.setItem without throwing', () => {
    const service = new ResupplyStorageService();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
      throw err;
    });

    expect(() => {
      service.saveState({
        selectedQuantities: {},
        enabledStates: {},
        favoriteRecipeIds: [],
        safetyBufferPercent: 0,
        userCalorieAdjustment: 0,
        scheduleConfig: {}
      });
    }).not.toThrow();
  });

  it('should repair custom recipes with missing ingredients arrays', () => {
    localStorage.setItem(
      RESUPPLY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        customRecipes: [
          {
            id: 'custom_no_ing',
            name: 'No Ingredients',
            category: 'snack',
            servings: 1,
            nutrients: { calories: 200 },
            ingredients: null
          }
        ]
      })
    );

    const service = new ResupplyStorageService();
    const recipe = service.recipes().find((r) => r.id === 'custom_no_ing');
    expect(recipe).toBeDefined();
    expect(Array.isArray(recipe?.ingredients)).toBe(true);
  });
});
