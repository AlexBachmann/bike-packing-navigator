import { beforeEach, describe, expect, it } from 'vitest';
import { ResupplySelectionService } from './resupply-selection.service';
import { ResupplyStorageService } from './resupply-storage.service';

describe('ResupplySelectionService', () => {
  let storage: ResupplyStorageService;
  let service: ResupplySelectionService;

  beforeEach(() => {
    localStorage.clear();
    storage = new ResupplyStorageService();
    service = new ResupplySelectionService(storage);
  });

  it('should initialize selectedItems with all catalog recipes at quantity 0, enabled false', () => {
    expect(service.selectedItems().length).toBe(18);
    for (const item of service.selectedItems()) {
      expect(item.quantity).toBe(0);
      expect(item.enabled).toBe(false);
    }
  });

  it('should initialize favoriteRecipeIds as empty and safetyBufferPercent as 0', () => {
    expect(service.favoriteRecipeIds()).toEqual([]);
    expect(service.safetyBufferPercent()).toBe(0);
    expect(service.userCalorieAdjustment()).toBe(0);
  });

  it('should toggle recipe enabled and auto-set quantity to 1 if previously 0', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    service.toggleRecipe(firstId, true);

    const item = service.selectedItems().find((i) => i.recipe.id === firstId);
    expect(item?.enabled).toBe(true);
    expect(item?.quantity).toBe(1);
  });

  it('should preserve quantity when toggled off', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    service.setQuantity(firstId, 3);
    service.toggleRecipe(firstId, false);

    const item = service.selectedItems().find((i) => i.recipe.id === firstId);
    expect(item?.enabled).toBe(false);
    expect(item?.quantity).toBe(3);
  });

  it('should set quantity and auto-enable item when quantity > 0', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    service.setQuantity(firstId, 2);

    const item = service.selectedItems().find((i) => i.recipe.id === firstId);
    expect(item?.quantity).toBe(2);
    expect(item?.enabled).toBe(true);
  });

  it('should auto-disable item when quantity is set to 0', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    service.setQuantity(firstId, 2);
    service.setQuantity(firstId, 0);

    const item = service.selectedItems().find((i) => i.recipe.id === firstId);
    expect(item?.quantity).toBe(0);
    expect(item?.enabled).toBe(false);
  });

  it('should adjust quantity using adjustQuantity delta stepper', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    service.adjustQuantity(firstId, 1);
    expect(service.recipeQuantities()[firstId]).toBe(1);

    service.adjustQuantity(firstId, 2);
    expect(service.recipeQuantities()[firstId]).toBe(3);

    service.adjustQuantity(firstId, -1);
    expect(service.recipeQuantities()[firstId]).toBe(2);
  });

  it('should compute selectedRecipes containing only enabled recipes with quantity > 0', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    const secondId = service.selectedItems()[1].recipe.id;

    service.setQuantity(firstId, 2);
    service.setQuantity(secondId, 1);
    expect(service.selectedRecipes().length).toBe(2);

    service.toggleRecipe(firstId, false);
    expect(service.selectedRecipes().length).toBe(1);
    expect(service.selectedRecipes()[0].id).toBe(secondId);
  });

  it('should compute recipeQuantities dictionary for fast quantity lookup', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    service.setQuantity(firstId, 5);

    const map = service.recipeQuantities();
    expect(map[firstId]).toBe(5);
  });

  it('should reflect favorite recipes in favoriteRecipes computed signal', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    expect(service.isFavorite(firstId)).toBe(false);
    expect(service.favoriteRecipes()).toEqual([]);

    service.toggleFavorite(firstId);
    expect(service.isFavorite(firstId)).toBe(true);
    expect(service.favoriteRecipes()).toContain(firstId);

    service.toggleFavorite(firstId);
    expect(service.isFavorite(firstId)).toBe(false);
    expect(service.favoriteRecipes()).not.toContain(firstId);
  });

  it('should return 0 for all nutrients when nothing is selected', () => {
    const nutrients = service.activeNutrients();
    expect(nutrients.calories).toBe(0);
    expect(nutrients.carbs).toBe(0);
    expect(nutrients.protein).toBe(0);
    expect(nutrients.fat).toBe(0);
    expect(nutrients.sodium).toBe(0);
    expect(nutrients.fluids).toBe(0);
  });

  it('should accurately accumulate calories, carbs, protein, fat, sodium, fluids for enabled items', () => {
    const first = service.selectedItems()[0].recipe;
    service.setQuantity(first.id, 2);

    const nutrients = service.activeNutrients();
    expect(nutrients.calories).toBe(first.nutrients.calories * 2);
    expect(nutrients.protein).toBe(first.nutrients.protein * 2);
  });

  it('should ignore disabled items even if quantity > 0', () => {
    const first = service.selectedItems()[0].recipe;
    service.setQuantity(first.id, 2);
    service.toggleRecipe(first.id, false);

    const nutrients = service.activeNutrients();
    expect(nutrients.calories).toBe(0);
  });

  it('should reset quantities only for specific category (e.g. meal)', () => {
    const meal = service.selectedItems().find((i) => i.recipe.category === 'meal')!;
    const snack = service.selectedItems().find((i) => i.recipe.category === 'snack')!;

    service.setQuantity(meal.recipe.id, 2);
    service.setQuantity(snack.recipe.id, 3);

    service.resetQuantities('meal');
    expect(service.recipeQuantities()[meal.recipe.id]).toBe(0);
    expect(service.recipeQuantities()[snack.recipe.id]).toBe(3);
  });

  it('should reset quantities for custom recipes when category is custom', () => {
    const { recipe: custom } = storage.saveCustomRecipe({
      name: 'Custom Mix',
      description: '',
      category: 'snack',
      servings: 1,
      nutrients: { calories: 150, carbs: 20, protein: 5, fat: 5, sodium: 30, fluids: 0 },
      ingredients: []
    });
    service.syncSelectedItems(storage.recipes());

    const defaultSnack = service.selectedItems().find((i) => i.recipe.category === 'snack' && !i.recipe.isCustom)!;
    service.setQuantity(custom.id, 2);
    service.setQuantity(defaultSnack.recipe.id, 2);

    service.resetQuantities('custom');
    expect(service.recipeQuantities()[custom.id]).toBe(0);
    expect(service.recipeQuantities()[defaultSnack.recipe.id]).toBe(2);
  });

  it('should reset all quantities when category is all or omitted', () => {
    const firstId = service.selectedItems()[0].recipe.id;
    const secondId = service.selectedItems()[1].recipe.id;
    service.setQuantity(firstId, 2);
    service.setQuantity(secondId, 3);

    service.resetQuantities();
    expect(service.recipeQuantities()[firstId]).toBe(0);
    expect(service.recipeQuantities()[secondId]).toBe(0);
  });

  it('should step safety buffer percent in 5% increments (-50 to +100)', () => {
    service.adjustSafetyBufferPercent(5);
    expect(service.safetyBufferPercent()).toBe(5);

    service.adjustSafetyBufferPercent(10);
    expect(service.safetyBufferPercent()).toBe(15);

    service.adjustSafetyBufferPercent(-70);
    expect(service.safetyBufferPercent()).toBe(-50); // clamped min

    service.adjustSafetyBufferPercent(200);
    expect(service.safetyBufferPercent()).toBe(100); // clamped max
  });

  it('should clamp safety buffer percent when set directly', () => {
    service.setSafetyBufferPercent(150);
    expect(service.safetyBufferPercent()).toBe(100);

    service.setSafetyBufferPercent(-99);
    expect(service.safetyBufferPercent()).toBe(-50);
  });

  it('should update user calorie adjustments', () => {
    service.adjustUserCalories(250);
    expect(service.userCalorieAdjustment()).toBe(250);

    service.setUserCalorieAdjustment(500);
    expect(service.userCalorieAdjustment()).toBe(500);
  });

  it('should update schedule configuration overrides', () => {
    service.updateScheduleConfig({ targetSleepHours: 8 });
    expect(service.scheduleConfig().targetSleepHours).toBe(8);
  });
});
