import { computed, Injectable, Optional, signal, Signal, WritableSignal } from '@angular/core';
import {
  DayScheduleConfig,
  NutrientProfile,
  Recipe,
  RecipeCategory,
  SelectedRecipeItem
} from '../../models/resupply.model';
import { ResupplyLoadedSelectionState, ResupplyStorageService } from './resupply-storage.service';

@Injectable({
  providedIn: 'root'
})
export class ResupplySelectionService {
  readonly selectedItems: WritableSignal<SelectedRecipeItem[]>;
  readonly favoriteRecipeIds: WritableSignal<string[]>;
  readonly safetyBufferPercent: WritableSignal<number>;
  readonly userCalorieAdjustment: WritableSignal<number>;
  readonly scheduleConfig: WritableSignal<Partial<DayScheduleConfig>>;

  // Reactive Selection Signals (Feature 21)
  readonly selectedRecipes: Signal<Recipe[]>;
  readonly recipeQuantities: Signal<Record<string, number>>;
  readonly favoriteRecipes: Signal<string[]>;

  // Nutrient Accumulation Signal
  readonly activeNutrients: Signal<NutrientProfile>;

  constructor(@Optional() private storage?: ResupplyStorageService) {
    const initial = this.storage ? this.storage.getInitialState() : null;
    const initialRecipes = this.storage ? this.storage.recipes() : [];

    const savedQuantities = initial?.selectedQuantities || {};
    const savedEnabled = initial?.enabledStates || {};

    const items: SelectedRecipeItem[] = initialRecipes.map((recipe) => {
      const qty = savedQuantities[recipe.id];
      const en = savedEnabled[recipe.id];
      return {
        recipe,
        quantity: typeof qty === 'number' && !isNaN(qty) ? Math.max(0, qty) : 0,
        enabled: typeof en === 'boolean' ? en : false
      };
    });

    this.selectedItems = signal<SelectedRecipeItem[]>(items);
    this.favoriteRecipeIds = signal<string[]>(initial?.favoriteRecipeIds || []);
    this.safetyBufferPercent = signal<number>(initial?.safetyBufferPercent || 0);
    this.userCalorieAdjustment = signal<number>(initial?.userCalorieAdjustment || 0);
    this.scheduleConfig = signal<Partial<DayScheduleConfig>>(initial?.scheduleConfig || {});

    this.selectedRecipes = computed<Recipe[]>(() =>
      this.selectedItems()
        .filter((item) => item.enabled && item.quantity > 0)
        .map((item) => item.recipe)
    );

    this.recipeQuantities = computed<Record<string, number>>(() => {
      const map: Record<string, number> = {};
      for (const item of this.selectedItems()) {
        map[item.recipe.id] = item.quantity;
      }
      return map;
    });

    this.favoriteRecipes = computed<string[]>(() => this.favoriteRecipeIds());

    this.activeNutrients = computed<NutrientProfile>(() => {
      const currentItems = this.selectedItems();
      let calories = 0;
      let carbs = 0;
      let protein = 0;
      let fat = 0;
      let sodium = 0;
      let fluids = 0;

      for (const item of currentItems) {
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
  }

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
    this.persist();
  }

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
    this.persist();
  }

  adjustQuantity(id: string, delta: number): void {
    const current = this.selectedItems().find((i) => i.recipe.id === id);
    const currentQty = current ? current.quantity : 0;
    this.setQuantity(id, currentQty + delta);
  }

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
    this.persist();
  }

  isFavorite(id: string): boolean {
    return this.favoriteRecipeIds().includes(id);
  }

  toggleFavorite(id: string): void {
    const current = this.favoriteRecipeIds();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.favoriteRecipeIds.set(next);
    this.persist();
  }

  adjustSafetyBufferPercent(delta: number): void {
    this.safetyBufferPercent.update((v) => {
      const next = v + delta;
      return Math.max(-50, Math.min(100, Math.round(next / 5) * 5));
    });
    this.persist();
  }

  setSafetyBufferPercent(percent: number): void {
    const safe = isNaN(percent) ? 0 : Math.max(-50, Math.min(100, Math.round(percent / 5) * 5));
    this.safetyBufferPercent.set(safe);
    this.persist();
  }

  adjustUserCalories(delta: number): void {
    this.userCalorieAdjustment.update((v) => v + delta);
    this.persist();
  }

  setUserCalorieAdjustment(calories: number): void {
    this.userCalorieAdjustment.set(calories);
    this.persist();
  }

  updateScheduleConfig(config: Partial<DayScheduleConfig>): void {
    this.scheduleConfig.update((c) => ({ ...c, ...config }));
    this.persist();
  }

  syncSelectedItems(recipes: Recipe[], autoSelectId?: string, removeId?: string): void {
    const current = this.selectedItems();
    const updated: SelectedRecipeItem[] = recipes.map((recipe) => {
      if (autoSelectId && recipe.id === autoSelectId) {
        return { recipe, quantity: 1, enabled: true };
      }
      const match = current.find((i) => i.recipe.id === recipe.id);
      if (removeId && recipe.id === removeId) {
        return { recipe, quantity: 0, enabled: false };
      }
      return {
        recipe,
        quantity: match ? match.quantity : 0,
        enabled: match ? match.enabled : false
      };
    });
    this.selectedItems.set(updated);
  }

  clearRecipeSelection(id: string): void {
    this.selectedItems.update((items) =>
      items.map((i) => (i.recipe.id === id ? { ...i, quantity: 0, enabled: false } : i))
    );
  }

  resetAll(recipes: Recipe[]): void {
    this.favoriteRecipeIds.set([]);
    this.safetyBufferPercent.set(0);
    this.userCalorieAdjustment.set(0);
    this.scheduleConfig.set({});
    this.selectedItems.set(
      recipes.map((recipe) => ({
        recipe,
        quantity: 0,
        enabled: false
      }))
    );
  }

  getSnapshot(): ResupplyLoadedSelectionState {
    const items = this.selectedItems();
    const selectedQuantities: Record<string, number> = {};
    const enabledStates: Record<string, boolean> = {};

    for (const item of items) {
      if (item.quantity > 0 || item.enabled) {
        selectedQuantities[item.recipe.id] = item.quantity;
        enabledStates[item.recipe.id] = item.enabled;
      }
    }

    return {
      selectedQuantities,
      enabledStates,
      favoriteRecipeIds: this.favoriteRecipeIds(),
      safetyBufferPercent: this.safetyBufferPercent(),
      userCalorieAdjustment: this.userCalorieAdjustment(),
      scheduleConfig: this.scheduleConfig()
    };
  }

  private persist(): void {
    if (this.storage) {
      this.storage.saveState(this.getSnapshot());
    }
  }
}
