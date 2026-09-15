import { Injectable, signal, Signal } from '@angular/core';
import { DEFAULT_RESUPPLY_RECIPES } from '../../data/resupply-recipes.data';
import {
  DayScheduleConfig,
  Recipe,
  RESUPPLY_STORAGE_KEY,
  ResupplyStorageState
} from '../../models/resupply.model';

export interface ResupplyLoadedSelectionState {
  selectedQuantities: Record<string, number>;
  enabledStates: Record<string, boolean>;
  favoriteRecipeIds: string[];
  safetyBufferPercent: number;
  userCalorieAdjustment: number;
  scheduleConfig: Partial<DayScheduleConfig>;
}

@Injectable({
  providedIn: 'root'
})
export class ResupplyStorageService {
  private readonly _recipes = signal<Recipe[]>([]);
  readonly recipes: Signal<Recipe[]> = this._recipes.asReadonly();

  private modifiedDefaults: Record<string, Partial<Recipe>> = {};
  private customRecipesList: Recipe[] = [];
  private deletedRecipeIds = new Set<string>();
  private initialSelectionState: ResupplyLoadedSelectionState = {
    selectedQuantities: {},
    enabledStates: {},
    favoriteRecipeIds: [],
    safetyBufferPercent: 0,
    userCalorieAdjustment: 0,
    scheduleConfig: {}
  };

  constructor() {
    this.loadFromStorage();
  }

  getInitialState(): ResupplyLoadedSelectionState {
    return this.initialSelectionState;
  }

  saveCustomRecipe(recipeData: Omit<Recipe, 'id'> & { id?: string }): { recipe: Recipe; isNew: boolean } {
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
    return { recipe: fullRecipe, isNew };
  }

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
  }

  deleteRecipe(id: string): void {
    this.deletedRecipeIds.add(id);
    const custom = this.customRecipesList.find((r) => r.id === id);
    if (custom) {
      custom.isDeleted = true;
    }
    this.rebuildCatalog();
  }

  deleteCustomRecipe(id: string): void {
    this.deleteRecipe(id);
  }

  isRecipeDeleted(id: string): boolean {
    return this.deletedRecipeIds.has(id);
  }

  resetRecipeToDefault(id: string): void {
    this.deletedRecipeIds.delete(id);
    if (this.modifiedDefaults[id]) {
      delete this.modifiedDefaults[id];
    }
    this.rebuildCatalog();
  }

  resetAllToDefault(): void {
    this.modifiedDefaults = {};
    this.customRecipesList = [];
    this.deletedRecipeIds.clear();
    this.initialSelectionState = {
      selectedQuantities: {},
      enabledStates: {},
      favoriteRecipeIds: [],
      safetyBufferPercent: 0,
      userCalorieAdjustment: 0,
      scheduleConfig: {}
    };
    this.rebuildCatalog();
    this.clearStorage();
  }

  rebuildCatalog(): void {
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
      if (
        !custom ||
        typeof custom !== 'object' ||
        custom.isDeleted ||
        this.deletedRecipeIds.has(custom.id)
      ) {
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

    this._recipes.set(mergedList);
  }

  saveState(selectionSnapshot: ResupplyLoadedSelectionState): void {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const state: ResupplyStorageState = {
        version: 1,
        selectedQuantities: selectionSnapshot.selectedQuantities,
        enabledStates: selectionSnapshot.enabledStates,
        modifiedDefaults: this.modifiedDefaults,
        customRecipes: this.customRecipesList,
        deletedRecipeIds: Array.from(this.deletedRecipeIds),
        favoriteRecipeIds: selectionSnapshot.favoriteRecipeIds,
        safetyBufferPercent: selectionSnapshot.safetyBufferPercent,
        userCalorieAdjustment: selectionSnapshot.userCalorieAdjustment,
        scheduleConfig: selectionSnapshot.scheduleConfig
      };

      window.localStorage.setItem(RESUPPLY_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Failed to persist resupply planner state to localStorage:', err);
    }
  }

  clearStorage(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(RESUPPLY_STORAGE_KEY);
      } catch (err) {
        console.warn('Failed to clear resupply storage:', err);
      }
    }
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

        let bufferPct = 0;
        if (
          typeof storageState.safetyBufferPercent === 'number' &&
          !isNaN(storageState.safetyBufferPercent)
        ) {
          if (storageState.safetyBufferPercent >= -50 && storageState.safetyBufferPercent <= 100) {
            bufferPct = Math.round(storageState.safetyBufferPercent / 5) * 5;
          }
        }

        this.initialSelectionState = {
          selectedQuantities:
            storageState.selectedQuantities && typeof storageState.selectedQuantities === 'object'
              ? storageState.selectedQuantities
              : {},
          enabledStates:
            storageState.enabledStates && typeof storageState.enabledStates === 'object'
              ? storageState.enabledStates
              : {},
          favoriteRecipeIds: Array.isArray(storageState.favoriteRecipeIds)
            ? storageState.favoriteRecipeIds.filter((id): id is string => typeof id === 'string')
            : [],
          safetyBufferPercent: bufferPct,
          userCalorieAdjustment:
            typeof storageState.userCalorieAdjustment === 'number' &&
            !isNaN(storageState.userCalorieAdjustment)
              ? storageState.userCalorieAdjustment
              : 0,
          scheduleConfig:
            storageState.scheduleConfig && typeof storageState.scheduleConfig === 'object'
              ? storageState.scheduleConfig
              : {}
        };

        this.rebuildCatalog();
      } else {
        this.customRecipesList = [];
        this.rebuildCatalog();
      }
    } catch (err) {
      console.warn('Failed to load from storage, recovering with defaults:', err);
      this.modifiedDefaults = {};
      this.customRecipesList = [];
      this.deletedRecipeIds = new Set();
      this.initialSelectionState = {
        selectedQuantities: {},
        enabledStates: {},
        favoriteRecipeIds: [],
        safetyBufferPercent: 0,
        userCalorieAdjustment: 0,
        scheduleConfig: {}
      };
      this.rebuildCatalog();
    }
  }
}
