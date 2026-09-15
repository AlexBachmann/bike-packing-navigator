import { Injectable, Optional, Signal, WritableSignal } from '@angular/core';
import {
  DayScheduleConfig,
  NutrientProfile,
  Recipe,
  RecipeCategory,
  SelectedRecipeItem
} from '../models/resupply.model';
import { ResupplyStorageService } from './resupply/resupply-storage.service';
import { ResupplySelectionService } from './resupply/resupply-selection.service';

@Injectable({
  providedIn: 'root'
})
export class ResupplyCatalogService {
  private readonly storage: ResupplyStorageService;
  private readonly selection: ResupplySelectionService;

  readonly recipes: Signal<Recipe[]>;
  readonly selectedItems: WritableSignal<SelectedRecipeItem[]>;
  readonly safetyBufferPercent: WritableSignal<number>;
  readonly userCalorieAdjustment: WritableSignal<number>;
  readonly favoriteRecipeIds: WritableSignal<string[]>;
  readonly scheduleConfig: WritableSignal<Partial<DayScheduleConfig>>;
  readonly activeNutrients: Signal<NutrientProfile>;

  // Feature 21 additional reactive signals
  readonly selectedRecipes: Signal<Recipe[]>;
  readonly recipeQuantities: Signal<Record<string, number>>;
  readonly favoriteRecipes: Signal<string[]>;

  constructor(
    @Optional() storage?: ResupplyStorageService,
    @Optional() selection?: ResupplySelectionService
  ) {
    this.storage = storage ?? new ResupplyStorageService();
    this.selection = selection ?? new ResupplySelectionService(this.storage);

    this.recipes = this.storage.recipes;
    this.selectedItems = this.selection.selectedItems;
    this.safetyBufferPercent = this.selection.safetyBufferPercent;
    this.userCalorieAdjustment = this.selection.userCalorieAdjustment;
    this.favoriteRecipeIds = this.selection.favoriteRecipeIds;
    this.scheduleConfig = this.selection.scheduleConfig;
    this.activeNutrients = this.selection.activeNutrients;
    this.selectedRecipes = this.selection.selectedRecipes;
    this.recipeQuantities = this.selection.recipeQuantities;
    this.favoriteRecipes = this.selection.favoriteRecipes;
  }

  /**
   * Toggles recipe enabled state. If enabling an item with quantity 0, sets quantity to 1.
   */
  toggleRecipe(id: string, enabled?: boolean): void {
    this.selection.toggleRecipe(id, enabled);
  }

  /**
   * Sets item quantity. If quantity > 0, ensures item is enabled; if 0, disables it.
   */
  setQuantity(id: string, quantity: number): void {
    this.selection.setQuantity(id, quantity);
  }

  /**
   * Adjusts quantity by delta (+1 or -1).
   */
  adjustQuantity(id: string, delta: number): void {
    this.selection.adjustQuantity(id, delta);
  }

  /**
   * Saves or updates a custom recipe.
   */
  saveCustomRecipe(recipeData: Omit<Recipe, 'id'> & { id?: string }): Recipe {
    const { recipe, isNew } = this.storage.saveCustomRecipe(recipeData);
    this.selection.syncSelectedItems(this.storage.recipes(), isNew ? recipe.id : undefined);
    this.storage.saveState(this.selection.getSnapshot());
    return recipe;
  }

  /**
   * Updates an existing recipe (custom or default). Default recipe modifications are stored non-destructively.
   */
  updateRecipe(id: string, updates: Partial<Recipe>): void {
    this.storage.updateRecipe(id, updates);
    this.selection.syncSelectedItems(this.storage.recipes());
    this.storage.saveState(this.selection.getSnapshot());
  }

  /**
   * Marks a recipe as deleted so it does not show up in the list anymore.
   * Clears any active quantity or selection for this recipe.
   */
  deleteRecipe(id: string): void {
    this.selection.clearRecipeSelection(id);
    this.storage.deleteRecipe(id);
    this.selection.syncSelectedItems(this.storage.recipes());
    this.storage.saveState(this.selection.getSnapshot());
  }

  /**
   * Deletes a custom recipe from the catalog (alias for deleteRecipe).
   */
  deleteCustomRecipe(id: string): void {
    this.deleteRecipe(id);
  }

  /**
   * Checks if a recipe is currently marked as deleted.
   */
  isRecipeDeleted(id: string): boolean {
    return this.storage.isRecipeDeleted(id);
  }

  /**
   * Checks if a recipe is marked as a user favorite.
   */
  isFavorite(id: string): boolean {
    return this.selection.isFavorite(id);
  }

  /**
   * Toggles the favorite status of a recipe and persists to storage.
   */
  toggleFavorite(id: string): void {
    this.selection.toggleFavorite(id);
  }

  /**
   * Resets all toggles and quantities back to zero.
   * If a category filter is provided (and not 'all'), only recipes matching that category are reset.
   */
  resetQuantities(category?: 'all' | RecipeCategory | 'custom' | string): void {
    this.selection.resetQuantities(category);
  }

  /**
   * Resets a modified default recipe back to its pristine definition (and restores if deleted).
   */
  resetRecipeToDefault(id: string): void {
    this.storage.resetRecipeToDefault(id);
    this.selection.syncSelectedItems(this.storage.recipes());
    this.storage.saveState(this.selection.getSnapshot());
  }

  /**
   * Resets all recipes, modifications, custom items, and selections back to pristine state.
   */
  resetAllToDefault(): void {
    this.storage.resetAllToDefault();
    this.selection.resetAll(this.storage.recipes());
  }

  /**
   * Adjusts the safety buffer percentage (+/- 5% steps). Negative percentages denote caloric deficits.
   * Clamped between -50% (deficit) and +100% (surplus buffer).
   */
  adjustSafetyBufferPercent(delta: number): void {
    this.selection.adjustSafetyBufferPercent(delta);
  }

  /**
   * Sets safety buffer percentage directly (clamped between -50% and +100%).
   */
  setSafetyBufferPercent(percent: number): void {
    this.selection.setSafetyBufferPercent(percent);
  }

  /**
   * Backward-compatibility method for user calorie adjustment.
   */
  adjustUserCalories(delta: number): void {
    this.selection.adjustUserCalories(delta);
  }

  /**
   * Backward-compatibility setter for user calorie adjustment.
   */
  setUserCalorieAdjustment(calories: number): void {
    this.selection.setUserCalorieAdjustment(calories);
  }

  /**
   * Updates day schedule config overrides.
   */
  updateScheduleConfig(config: Partial<DayScheduleConfig>): void {
    this.selection.updateScheduleConfig(config);
  }
}
