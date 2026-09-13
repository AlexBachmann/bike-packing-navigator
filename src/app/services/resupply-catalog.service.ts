import { computed, Injectable, signal } from '@angular/core';
import { DEFAULT_RESUPPLY_RECIPES } from '../data/resupply-recipes.data';
import {
  DayScheduleConfig,
  NutrientProfile,
  Recipe,
  RecipeCategory,
  RESUPPLY_STORAGE_KEY,
  ResupplyStorageState,
  SelectedRecipeItem
} from '../models/resupply.model';

@Injectable({
  providedIn: 'root'
})
export class ResupplyCatalogService {
  readonly recipes = signal<Recipe[]>([]);
  readonly selectedItems = signal<SelectedRecipeItem[]>([]);
  readonly safetyBufferPercent = signal<number>(0);
  readonly userCalorieAdjustment = signal<number>(0);
  readonly favoriteRecipeIds = signal<string[]>([]);
  readonly scheduleConfig = signal<Partial<DayScheduleConfig>>({});

  /**
   * Computed signal summing active accumulated nutrients across all enabled recipes with quantity > 0.
   */
  readonly activeNutrients = computed<NutrientProfile>(() => {
    const items = this.selectedItems();
    let calories = 0;
    let carbs = 0;
    let protein = 0;
    let fat = 0;
    let sodium = 0;
    let fluids = 0;

    for (const item of items) {
      if (item.enabled && item.quantity > 0) {
        const q = item.quantity;
        calories += q * (item.recipe.nutrients.calories || 0);
        carbs += q * (item.recipe.nutrients.carbs || 0);
        protein += q * (item.recipe.nutrients.protein || 0);
        fat += q * (item.recipe.nutrients.fat || 0);
        sodium += q * (item.recipe.nutrients.sodium || 0);
        fluids += q * (item.recipe.nutrients.fluids || 0);
      }
    }

    return {
      calories: Math.round(calories),
      carbs: Math.round(carbs),
      protein: Math.round(protein),
      fat: Math.round(fat),
      sodium: Math.round(sodium),
      fluids: Math.round(fluids)
    };
  });

  private modifiedDefaults: Record<string, Partial<Recipe>> = {};
  private customRecipesList: Recipe[] = [];
  private deletedRecipeIds = new Set<string>();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Toggles recipe enabled state. If enabling an item with quantity 0, sets quantity to 1.
   */
  toggleRecipe(id: string, enabled?: boolean): void {
    this.selectedItems.update((items) =>
      items.map((item) => {
        if (item.recipe.id !== id) return item;
        const newEnabled = enabled !== undefined ? enabled : !item.enabled;
        const newQty = newEnabled && item.quantity === 0 ? 1 : item.quantity;
        return {
          ...item,
          enabled: newEnabled,
          quantity: newQty
        };
      })
    );
    this.saveToStorage();
  }

  /**
   * Sets item quantity. If quantity > 0, ensures item is enabled; if 0, disables it.
   */
  setQuantity(id: string, quantity: number): void {
    const safeQty = Math.max(0, Math.round(quantity));
    this.selectedItems.update((items) =>
      items.map((item) => {
        if (item.recipe.id !== id) return item;
        return {
          ...item,
          quantity: safeQty,
          enabled: safeQty > 0
        };
      })
    );
    this.saveToStorage();
  }

  /**
   * Adjusts quantity by delta (+1 or -1).
   */
  adjustQuantity(id: string, delta: number): void {
    const current = this.selectedItems().find((i) => i.recipe.id === id);
    const currentQty = current ? current.quantity : 0;
    this.setQuantity(id, currentQty + delta);
  }

  /**
   * Saves or updates a custom recipe.
   */
  saveCustomRecipe(recipeData: Omit<Recipe, 'id'> & { id?: string }): Recipe {
    const isDefaultCollision =
      !!recipeData.id && DEFAULT_RESUPPLY_RECIPES.some((d) => d.id === recipeData.id);
    let id = recipeData.id;
    if (!id || isDefaultCollision) {
      if (isDefaultCollision) {
        const baseId = `custom-${recipeData.id}`;
        id = this.customRecipesList.some((r) => r.id === baseId)
          ? `custom-${Date.now()}-${recipeData.id}`
          : baseId;
      } else {
        id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
    }

    const isNew = !this.customRecipesList.some((r) => r.id === id);
    const fullRecipe: Recipe = {
      ...recipeData,
      id,
      isCustom: true,
      servings: recipeData.servings || 1,
      nutrients: { ...(recipeData.nutrients || {}) },
      ingredients: Array.isArray(recipeData.ingredients)
        ? recipeData.ingredients.map((ing) => ({ ...ing }))
        : []
    };

    const existingIndex = this.customRecipesList.findIndex((r) => r.id === id);
    if (existingIndex >= 0) {
      this.customRecipesList[existingIndex] = fullRecipe;
    } else {
      this.customRecipesList.push(fullRecipe);
    }

    this.rebuildCatalog();

    if (isNew) {
      this.selectedItems.update((items) =>
        items.map((item) =>
          item.recipe.id === id ? { ...item, quantity: 1, enabled: true } : item
        )
      );
    }

    this.saveToStorage();
    return fullRecipe;
  }

  /**
   * Updates an existing recipe (custom or default). Default recipe modifications are stored non-destructively.
   */
  updateRecipe(id: string, updates: Partial<Recipe>): void {
    const isCustom = this.customRecipesList.some((r) => r.id === id);

    if (isCustom) {
      this.customRecipesList = this.customRecipesList.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          ...updates,
          id: r.id,
          isCustom: true,
          nutrients: updates.nutrients ? { ...r.nutrients, ...updates.nutrients } : r.nutrients,
          ingredients: updates.ingredients ? [...updates.ingredients] : r.ingredients
        };
      });
    } else {
      // Default recipe modification
      const currentMod = this.modifiedDefaults[id] || {};
      this.modifiedDefaults[id] = {
        ...currentMod,
        ...updates,
        nutrients: updates.nutrients
          ? { ...(currentMod.nutrients || {}), ...updates.nutrients }
          : currentMod.nutrients,
        ingredients: updates.ingredients ? [...updates.ingredients] : currentMod.ingredients
      };
    }

    this.rebuildCatalog();
    this.saveToStorage();
  }

  /**
   * Marks a recipe as deleted so it does not show up in the list anymore.
   * Clears any active quantity or selection for this recipe.
   */
  deleteRecipe(id: string): void {
    this.deletedRecipeIds.add(id);

    // If custom recipe, mark as deleted
    const custom = this.customRecipesList.find((r) => r.id === id);
    if (custom) {
      custom.isDeleted = true;
    }

    // Reset quantity and enabled state for this recipe
    this.selectedItems.update((items) =>
      items.map((i) => (i.recipe.id === id ? { ...i, quantity: 0, enabled: false } : i))
    );

    this.rebuildCatalog();
    this.saveToStorage();
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
    return this.deletedRecipeIds.has(id);
  }

  /**
   * Checks if a recipe is marked as a user favorite.
   */
  isFavorite(id: string): boolean {
    return this.favoriteRecipeIds().includes(id);
  }

  /**
   * Toggles the favorite status of a recipe and persists to storage.
   */
  toggleFavorite(id: string): void {
    const current = this.favoriteRecipeIds();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.favoriteRecipeIds.set(next);
    this.saveToStorage();
  }

  /**
   * Resets all toggles and quantities back to zero.
   * If a category filter is provided (and not 'all'), only recipes matching that category are reset.
   */
  resetQuantities(category?: 'all' | RecipeCategory | 'custom' | string): void {
    this.selectedItems.update((items) =>
      items.map((item) => {
        let shouldReset = false;
        if (!category || category === 'all') {
          shouldReset = true;
        } else if (category === 'custom') {
          shouldReset = !!item.recipe.isCustom;
        } else {
          shouldReset = item.recipe.category === category;
        }

        if (shouldReset) {
          return {
            ...item,
            quantity: 0,
            enabled: false
          };
        }
        return item;
      })
    );
    this.saveToStorage();
  }

  /**
   * Resets a modified default recipe back to its pristine definition (and restores if deleted).
   */
  resetRecipeToDefault(id: string): void {
    this.deletedRecipeIds.delete(id);
    if (this.modifiedDefaults[id]) {
      delete this.modifiedDefaults[id];
    }
    this.rebuildCatalog();
    this.saveToStorage();
  }

  /**
   * Resets all recipes, modifications, custom items, and selections back to pristine state.
   */
  resetAllToDefault(): void {
    this.modifiedDefaults = {};
    this.customRecipesList = [];
    this.deletedRecipeIds.clear();
    this.favoriteRecipeIds.set([]);
    this.safetyBufferPercent.set(0);
    this.userCalorieAdjustment.set(0);
    this.scheduleConfig.set({});

    this.rebuildCatalog();

    // Reset selected items to all disabled with quantity 0
    this.selectedItems.set(
      this.recipes().map((recipe) => ({
        recipe,
        quantity: 0,
        enabled: false
      }))
    );

    this.clearStorage();
  }

  /**
   * Adjusts the safety buffer percentage (+/- 5% steps). Negative percentages denote caloric deficits.
   * Clamped between -50% (deficit) and +100% (surplus buffer).
   */
  adjustSafetyBufferPercent(delta: number): void {
    this.safetyBufferPercent.update((v) => {
      const next = v + delta;
      return Math.max(-50, Math.min(100, Math.round(next / 5) * 5));
    });
    this.saveToStorage();
  }

  /**
   * Sets safety buffer percentage directly (clamped between -50% and +100%).
   */
  setSafetyBufferPercent(percent: number): void {
    const safe = isNaN(percent) ? 0 : Math.max(-50, Math.min(100, Math.round(percent / 5) * 5));
    this.safetyBufferPercent.set(safe);
    this.saveToStorage();
  }

  /**
   * Backward-compatibility method for user calorie adjustment.
   */
  adjustUserCalories(delta: number): void {
    this.userCalorieAdjustment.update((v) => v + delta);
    this.saveToStorage();
  }

  /**
   * Backward-compatibility setter for user calorie adjustment.
   */
  setUserCalorieAdjustment(calories: number): void {
    this.userCalorieAdjustment.set(calories);
    this.saveToStorage();
  }

  /**
   * Updates day schedule config overrides.
   */
  updateScheduleConfig(config: Partial<DayScheduleConfig>): void {
    this.scheduleConfig.update((c) => ({ ...c, ...config }));
    this.saveToStorage();
  }

  private rebuildCatalog(): void {
    const mergedList: Recipe[] = [];

    // 1. Process default recipes with non-destructive override merging
    for (const def of DEFAULT_RESUPPLY_RECIPES) {
      if (this.deletedRecipeIds.has(def.id)) {
        continue;
      }
      const mod = this.modifiedDefaults[def.id];
      if (!mod) {
        mergedList.push({
          ...def,
          nutrients: { ...def.nutrients },
          ingredients: def.ingredients.map((ing) => ({ ...ing }))
        });
      } else {
        if (mod.isDeleted) {
          continue;
        }
        mergedList.push({
          ...def,
          ...mod,
          id: def.id,
          isCustom: false,
          nutrients: { ...def.nutrients, ...(mod.nutrients || {}) },
          ingredients: mod.ingredients
            ? mod.ingredients.map((ing) => ({ ...ing }))
            : def.ingredients.map((ing) => ({ ...ing }))
        });
      }
    }

    // 2. Append custom recipes (strictly validating array and ingredients)
    if (!Array.isArray(this.customRecipesList)) {
      this.customRecipesList = [];
    }

    for (const custom of this.customRecipesList) {
      if (!custom || typeof custom !== 'object' || custom.isDeleted || this.deletedRecipeIds.has(custom.id)) {
        continue;
      }
      mergedList.push({
        ...custom,
        isCustom: true,
        nutrients: { ...(custom.nutrients || {}) },
        ingredients: Array.isArray(custom.ingredients)
          ? custom.ingredients.map((ing) => ({ ...ing }))
          : []
      });
    }

    this.recipes.set(mergedList);

    // Synchronize selectedItems with updated recipes
    const currentSelected = this.selectedItems();
    const updatedSelected: SelectedRecipeItem[] = mergedList.map((recipe) => {
      const match = currentSelected.find((i) => i.recipe.id === recipe.id);
      return {
        recipe,
        quantity: match ? match.quantity : 0,
        enabled: match ? match.enabled : false
      };
    });

    this.selectedItems.set(updatedSelected);
  }

  private loadFromStorage(): void {
    let storageState: ResupplyStorageState | null = null;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(RESUPPLY_STORAGE_KEY);
        if (raw) {
          storageState = JSON.parse(raw);
        }
      } catch (err) {
        console.warn('Failed to parse resupply storage, using defaults:', err);
      }
    }

    try {
      if (storageState && typeof storageState === 'object' && storageState.version === 1) {
        this.modifiedDefaults =
          storageState.modifiedDefaults && typeof storageState.modifiedDefaults === 'object'
            ? storageState.modifiedDefaults
            : {};

        if (Array.isArray(storageState.customRecipes)) {
          this.customRecipesList = storageState.customRecipes
            .filter((r): r is Recipe => !!r && typeof r === 'object')
            .map((r) => ({
              ...r,
              nutrients: { ...(r.nutrients || {}) },
              ingredients: Array.isArray(r.ingredients)
                ? r.ingredients.map((ing) => ({ ...ing }))
                : []
            }));
        } else {
          this.customRecipesList = [];
        }

        this.deletedRecipeIds = new Set(
          Array.isArray(storageState.deletedRecipeIds)
            ? storageState.deletedRecipeIds.filter((id): id is string => typeof id === 'string')
            : []
        );

        this.favoriteRecipeIds.set(
          Array.isArray(storageState.favoriteRecipeIds)
            ? storageState.favoriteRecipeIds.filter((id): id is string => typeof id === 'string')
            : []
        );

        let bufferPct = 0;
        if (typeof storageState.safetyBufferPercent === 'number' && !isNaN(storageState.safetyBufferPercent)) {
          if (storageState.safetyBufferPercent >= -50 && storageState.safetyBufferPercent <= 100) {
            bufferPct = Math.round(storageState.safetyBufferPercent / 5) * 5;
          }
        }
        this.safetyBufferPercent.set(bufferPct);
        this.userCalorieAdjustment.set(
          typeof storageState.userCalorieAdjustment === 'number' && !isNaN(storageState.userCalorieAdjustment)
            ? storageState.userCalorieAdjustment
            : 0
        );
        this.scheduleConfig.set(
          storageState.scheduleConfig && typeof storageState.scheduleConfig === 'object'
            ? storageState.scheduleConfig
            : {}
        );

        this.rebuildCatalog();

        // Apply saved quantities and enabled states
        const savedQuantities =
          storageState.selectedQuantities && typeof storageState.selectedQuantities === 'object'
            ? storageState.selectedQuantities
            : {};
        const savedEnabled =
          storageState.enabledStates && typeof storageState.enabledStates === 'object'
            ? storageState.enabledStates
            : {};

        this.selectedItems.update((items) =>
          items.map((item) => {
            const id = item.recipe.id;
            const qty = savedQuantities[id] !== undefined ? savedQuantities[id] : item.quantity;
            const en = savedEnabled[id] !== undefined ? savedEnabled[id] : item.enabled;
            return {
              ...item,
              quantity: typeof qty === 'number' && !isNaN(qty) ? Math.max(0, qty) : item.quantity,
              enabled: typeof en === 'boolean' ? en : item.enabled
            };
          })
        );
      } else {
        this.customRecipesList = [];
        this.rebuildCatalog();
      }
    } catch (err) {
      console.warn('Failed to load from storage, recovering with defaults:', err);
      this.modifiedDefaults = {};
      this.customRecipesList = [];
      this.deletedRecipeIds = new Set();
      this.favoriteRecipeIds.set([]);
      this.safetyBufferPercent.set(0);
      this.userCalorieAdjustment.set(0);
      this.scheduleConfig.set({});
      this.rebuildCatalog();
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const items = this.selectedItems();
      const selectedQuantities: Record<string, number> = {};
      const enabledStates: Record<string, boolean> = {};

      for (const item of items) {
        if (item.quantity > 0 || item.enabled) {
          selectedQuantities[item.recipe.id] = item.quantity;
          enabledStates[item.recipe.id] = item.enabled;
        }
      }

      const state: ResupplyStorageState = {
        version: 1,
        selectedQuantities,
        enabledStates,
        modifiedDefaults: this.modifiedDefaults,
        customRecipes: this.customRecipesList,
        deletedRecipeIds: Array.from(this.deletedRecipeIds),
        favoriteRecipeIds: this.favoriteRecipeIds(),
        safetyBufferPercent: this.safetyBufferPercent(),
        userCalorieAdjustment: this.safetyBufferPercent(),
        scheduleConfig: this.scheduleConfig()
      };

      window.localStorage.setItem(RESUPPLY_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Failed to persist resupply planner state to localStorage:', err);
    }
  }

  private clearStorage(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(RESUPPLY_STORAGE_KEY);
      } catch (err) {
        console.warn('Failed to clear resupply storage:', err);
      }
    }
  }
}
