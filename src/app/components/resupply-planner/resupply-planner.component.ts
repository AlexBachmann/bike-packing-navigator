import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { ResupplyPhysicsService } from '../../services/resupply-physics.service';
import { ResupplyCatalogService } from '../../services/resupply-catalog.service';
import {
  DEPARTMENT_ICONS,
  DEPARTMENT_ORDER,
  ResupplyShoppingListService
} from '../../services/resupply-shopping-list.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { ToastService } from '../../services/toast.service';
import { EtaPhysicsService } from '../../services/eta-physics.service';
import {
  DayScheduleSummary,
  GroceryDepartment,
  Ingredient,
  NutrientFulfillment,
  NutrientTargets,
  Recipe,
  RecipeCategory
} from '../../models/resupply.model';
import { DEFAULT_RESUPPLY_RECIPES } from '../../data/resupply-recipes.data';
import { DistanceUnit } from '../../models/settings.model';
import { Place } from '../../models/waypoint.model';

import { ResupplyShoppingListComponent } from './resupply-shopping-list.component';
import { ResupplyDistanceSelectorComponent } from './resupply-distance-selector.component';
import { ResupplyNutrientDemandsComponent } from './resupply-nutrient-demands.component';
import { ResupplyFulfillmentGaugesComponent } from './resupply-fulfillment-gauges.component';
import { ResupplyRecipeCardComponent } from './resupply-recipe-card.component';
import {
  RecipeFormData,
  ResupplyRecipeFormModalComponent
} from './resupply-recipe-form-modal.component';

export const MIN_RESUPPLY_DISTANCE_KM = 10;

export interface ResupplyStopItem {
  id: string;
  name: string;
  town?: string;
  routeMile: number;
  distAhead: number;
  distAheadMiles: number;
  distAheadKm: number;
  estimatedHours: number;
  timeFormatted: string;
  badgeIcon: string;
  badgeLabel: string;
}

@Component({
  selector: 'app-resupply-planner',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ResupplyShoppingListComponent,
    ResupplyDistanceSelectorComponent,
    ResupplyNutrientDemandsComponent,
    ResupplyFulfillmentGaugesComponent,
    ResupplyRecipeCardComponent,
    ResupplyRecipeFormModalComponent
  ],
  templateUrl: './resupply-planner.component.html',
  styleUrl: './resupply-planner.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ResupplyPlannerComponent {
  readonly routeService = inject(RouteDataService);
  readonly settings = inject(SettingsService);
  readonly physicsService = inject(ResupplyPhysicsService);
  readonly catalogService = inject(ResupplyCatalogService);
  readonly shoppingListService = inject(ResupplyShoppingListService);
  readonly pwaInstall = inject(PwaInstallService);
  readonly toastService = inject(ToastService);
  readonly etaPhysics = inject(EtaPhysicsService);

  // Inputs & Outputs
  readonly currentMile = input.required<number>();
  readonly unit = input<DistanceUnit>('miles');
  readonly selectMile = output<number>();

  // Planner View Mode: Resupply Plan vs Shopping List
  readonly activeView = signal<'builder' | 'shopping-list'>('builder');

  // Target Distance Selection: Upcoming Stops vs Custom Distance
  readonly distanceSelectionMode = signal<'stops' | 'custom'>('stops');
  readonly targetDistance = signal<number>(50); // In active units (miles or km)
  readonly selectedStopId = signal<string | null>(null);

  // Day Schedule Controls
  readonly dailyRidingPercent = signal<number>(60); // Default 60%
  readonly targetSleepHours = signal<number>(6.0); // Default 6.0h

  // Recipe Catalog Filter & Search
  readonly recipeFilter = signal<'all' | RecipeCategory | 'custom' | 'favorite'>('all');
  readonly recipeSearch = signal<string>('');
  readonly favoriteCount = computed<number>(() => this.catalogService.favoriteRecipeIds().length);

  // Modals & UI Toggles
  readonly showEditModal = signal<boolean>(false);
  readonly showAddModal = signal<boolean>(false);
  readonly showResetConfirmModal = signal<boolean>(false);
  readonly showDeleteConfirmModal = signal<boolean>(false);
  readonly recipeToDelete = signal<Recipe | null>(null);
  readonly pwaBannerDismissed = signal<boolean>(false);

  // Form state for Editing / Adding recipes
  readonly editingRecipeId = signal<string | null>(null);
  readonly currentEditingRecipe = computed<Recipe | null>(() => {
    const id = this.editingRecipeId();
    if (!id) return null;
    return this.catalogService.recipes().find((r) => r.id === id) || null;
  });
  readonly formName = signal<string>('');
  readonly formDescription = signal<string>('');
  readonly formCategory = signal<RecipeCategory>('meal');
  readonly formServings = signal<number>(1);
  readonly formCalories = signal<number>(500);
  readonly formCarbs = signal<number>(60);
  readonly formProtein = signal<number>(20);
  readonly formFat = signal<number>(15);
  readonly formSodium = signal<number>(500);
  readonly formFluids = signal<number>(0);
  readonly formIngredients = signal<Ingredient[]>([]);

  // Shopping List Interactive Checklist
  readonly checkedItemIds = signal<Set<string>>(new Set());

  // Department metadata for UI
  readonly departments: GroceryDepartment[] = [...DEPARTMENT_ORDER];
  readonly departmentIcons = DEPARTMENT_ICONS;

  // Preset Distance Chips
  readonly distancePresets = computed<number[]>(() => {
    return this.unit() === 'miles'
      ? [25, 50, 75, 100, 150]
      : [40, 80, 120, 160, 240];
  });

  // PWA Standalone Detection Banner
  readonly showPwaBanner = computed<boolean>(() => {
    if (this.pwaBannerDismissed()) return false;
    return !this.pwaInstall.isStandalone();
  });

  /**
   * Dynamically filters route places ahead of currentMile for resupply POIs.
   */
  readonly upcomingStops = computed<ResupplyStopItem[]>(() => {
    const current = this.currentMile();
    const allPlaces = this.routeService.places();
    const isPower = this.settings.paceMode() === 'power';
    const speed = Math.max(1.0, this.settings.avgSpeedMph());
    const activeUnit = this.unit();

    const isResupply = (p: Place): boolean => {
      const cat = (p.category || '').toLowerCase();
      const type = (p.type || '').toLowerCase();
      return (
        cat === 'grocery' ||
        cat === 'gas_station' ||
        cat === 'town' ||
        cat === 'water' ||
        type === 'convenience_store' ||
        type === 'supermarket' ||
        type === 'grocery' ||
        type === 'gas_station' ||
        type === 'town' ||
        type === 'locality' ||
        type === 'water'
      );
    };

    const stopsAhead = allPlaces.filter((p) => {
      const distKm = (p.route_mile - current) * 1.60934;
      return distKm > MIN_RESUPPLY_DISTANCE_KM && isResupply(p);
    });
    const limited = stopsAhead.slice(0, 25);

    return limited.map((p) => {
      const distMiles = Math.max(0, p.route_mile - current);
      const distKm = distMiles * 1.60934;
      const distInUnit = activeUnit === 'miles' ? distMiles : distKm;

      let hours = 0;
      if (isPower) {
        hours = this.etaPhysics.calculateEtaSeconds(current, p.route_mile) / 3600;
      }
      if (hours <= 0) {
        hours = distMiles / speed;
      }

      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      const timeFormatted = h === 0 ? `${m}m` : `${h}h ${m.toString().padStart(2, '0')}m`;

      let badgeIcon = '🛒';
      let badgeLabel = 'Grocery';
      const cat = (p.category || '').toLowerCase();
      const type = (p.type || '').toLowerCase();
      if (cat === 'town' || type === 'town' || type === 'locality') {
        badgeIcon = '🏘️';
        badgeLabel = 'Town';
      } else if (cat === 'gas_station' || type === 'gas_station') {
        badgeIcon = '⛽';
        badgeLabel = 'Gas / Store';
      } else if (cat === 'water' || type === 'water') {
        badgeIcon = '💧';
        badgeLabel = 'Water';
      }

      return {
        id: p.id,
        name: p.name,
        town: p.town,
        routeMile: p.route_mile,
        distAhead: Math.round(distInUnit * 10) / 10,
        distAheadMiles: distMiles,
        distAheadKm: distKm,
        estimatedHours: hours,
        timeFormatted,
        badgeIcon,
        badgeLabel
      };
    });
  });

  /**
   * Computed target distance in miles regardless of display unit.
   */
  readonly targetDistanceMiles = computed<number>(() => {
    const dist = Math.max(0.1, this.targetDistance());
    return this.unit() === 'miles' ? dist : dist / 1.60934;
  });

  /**
   * Estimated riding time in hours for the target distance.
   */
  readonly estimatedRidingHours = computed<number>(() => {
    const distMiles = this.targetDistanceMiles();
    const current = this.currentMile();
    const isPower = this.settings.paceMode() === 'power';
    let hours = 0;
    if (isPower) {
      hours = this.etaPhysics.calculateEtaSeconds(current, current + distMiles) / 3600;
    }
    if (hours <= 0) {
      const speed = Math.max(1.0, this.settings.avgSpeedMph());
      hours = distMiles / speed;
    }
    return Math.max(0.01, hours);
  });

  /**
   * Forward day schedule timeline summary computed by isolated physics engine.
   */
  readonly dayScheduleSummary = computed<DayScheduleSummary>(() => {
    const ridingHours = this.estimatedRidingHours();
    const ridingPct = this.dailyRidingPercent() / 100.0;
    const sleepHours = this.targetSleepHours();

    return this.physicsService.simulateDaySchedule(ridingHours, {
      dailyRidingPercent: ridingPct,
      targetSleepHours: sleepHours,
      prepWakeHours: 1.0,
      departureHour: 8.0,
      nightfallHour: 21.0
    });
  });

  readonly safetyBufferPercent = computed(() => this.catalogService.safetyBufferPercent());

  /**
   * Multi-nutrient target calculation based on active power, inactive BMR, percentage safety buffer,
   * and user manual adjustments.
   */
  readonly nutrientTargets = computed<NutrientTargets>(() => {
    const distMiles = this.targetDistanceMiles();
    const ridingHours = this.estimatedRidingHours();
    const schedule = this.dayScheduleSummary();
    const weightKg = this.settings.totalSystemMassKg();
    const watts = this.settings.riderPowerWatts();
    const bufferPercent = this.catalogService.safetyBufferPercent();

    return this.physicsService.calculateNutrientTargets(
      distMiles,
      ridingHours,
      schedule,
      weightKg,
      watts,
      this.catalogService.userCalorieAdjustment(),
      bufferPercent
    );
  });

  /**
   * Real-time nutritional fulfillment metrics comparing accumulated planned nutrients to targets.
   */
  readonly fulfillment = computed<NutrientFulfillment>(() => {
    const current = this.catalogService.activeNutrients();
    const targets = this.nutrientTargets();
    return this.physicsService.calculateFulfillment(current, targets);
  });

  /**
   * Filtered list of recipes based on active category and search term.
   */
  readonly filteredRecipes = computed<Recipe[]>(() => {
    const all = this.catalogService.recipes();
    const filter = this.recipeFilter();
    const search = this.recipeSearch().toLowerCase().trim();

    const filtered = all.filter((r) => {
      if (filter === 'favorite' && !this.catalogService.isFavorite(r.id)) return false;
      if (filter === 'custom' && !r.isCustom) return false;
      if (filter === 'meal' && r.category !== 'meal' && r.category !== 'quick_bite') return false;
      if (filter === 'snack' && r.category !== 'snack') return false;
      if (filter === 'drink' && r.category !== 'drink') return false;

      if (search) {
        const matchName = r.name.toLowerCase().includes(search);
        const matchDesc = r.description.toLowerCase().includes(search);
        const matchIng = r.ingredients.some((i) => i.name.toLowerCase().includes(search));
        if (!matchName && !matchDesc && !matchIng) return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      const aFav = this.catalogService.isFavorite(a.id);
      const bFav = this.catalogService.isFavorite(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0;
    });
  });

  /**
   * Consolidated, checked grocery shopping list aggregated across all active plan recipes.
   */
  readonly aggregatedGroceryItems = computed(() => {
    const items = this.shoppingListService.aggregateIngredients(this.catalogService.selectedItems());
    const checked = this.checkedItemIds();
    return items.map((item) => ({
      ...item,
      checked: checked.has(item.id)
    }));
  });

  /**
   * Department groups for shopping list view.
   */
  readonly departmentGroups = computed(() => {
    return this.shoppingListService.groupByDepartment(this.aggregatedGroceryItems());
  });

  readonly totalGroceryItemsCount = computed(() => {
    return this.aggregatedGroceryItems().length;
  });

  // Target Distance Actions
  selectStop(stop: ResupplyStopItem): void {
    this.selectedStopId.set(stop.id);
    this.targetDistance.set(stop.distAhead);
  }

  setCustomDistance(dist: number): void {
    const clamped = Math.max(1, Math.min(2000, Math.round(dist * 10) / 10));
    this.targetDistance.set(clamped);
    this.selectedStopId.set(null);
  }

  adjustDistance(delta: number): void {
    this.setCustomDistance(this.targetDistance() + delta);
  }

  onCustomDistanceInputChange(value: number): void {
    if (!isNaN(value) && value > 0) {
      this.setCustomDistance(value);
    }
  }

  // Physiological / Schedule Actions
  onRidingPercentChange(val: number): void {
    this.dailyRidingPercent.set(Math.max(20, Math.min(85, Math.round(val))));
  }

  onSleepHoursChange(val: number): void {
    this.targetSleepHours.set(Math.max(2, Math.min(12, Math.round(val * 10) / 10)));
  }

  adjustBufferPercent(delta: number): void {
    this.catalogService.adjustSafetyBufferPercent(delta);
  }

  adjustCalories(delta: number): void {
    if (delta === 100) {
      this.adjustBufferPercent(5);
    } else if (delta === -100) {
      this.adjustBufferPercent(-5);
    } else {
      this.catalogService.adjustUserCalories(delta);
    }
  }

  // Recipe Item Actions
  isFavorite(recipeId: string): boolean {
    return this.catalogService.isFavorite(recipeId);
  }

  toggleFavorite(recipeId: string): void {
    this.catalogService.toggleFavorite(recipeId);
  }

  getRecipeQuantity(recipeId: string): number {
    const found = this.catalogService.selectedItems().find((i) => i.recipe.id === recipeId);
    return found ? found.quantity : 0;
  }

  isRecipeEnabled(recipeId: string): boolean {
    const found = this.catalogService.selectedItems().find((i) => i.recipe.id === recipeId);
    return found ? found.enabled : false;
  }

  toggleRecipe(recipeId: string): void {
    this.catalogService.toggleRecipe(recipeId);
  }

  adjustRecipeQuantity(recipeId: string, delta: number): void {
    this.catalogService.adjustQuantity(recipeId, delta);
  }

  isModifiedDefault(recipe: Recipe): boolean {
    if (recipe.isCustom) return false;
    const original = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === recipe.id);
    if (!original) return false;
    return (
      JSON.stringify(recipe.nutrients) !== JSON.stringify(original.nutrients) ||
      recipe.servings !== original.servings ||
      JSON.stringify(recipe.ingredients) !== JSON.stringify(original.ingredients) ||
      recipe.name !== original.name ||
      recipe.description !== original.description
    );
  }

  resetRecipeToDefault(recipeId: string): void {
    this.catalogService.resetRecipeToDefault(recipeId);
    this.toastService.showSuccess('Recipe reset to default');
  }

  formatCategory(category?: string): string {
    if (!category) return '';
    if (category === 'quick_bite') return 'Quick Bite';
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  promptDeleteRecipe(target: Recipe | string): void {
    if (typeof target === 'string') {
      const found = this.catalogService.recipes().find((r) => r.id === target);
      this.recipeToDelete.set(found || null);
    } else {
      this.recipeToDelete.set(target);
    }
    this.showDeleteConfirmModal.set(true);
  }

  cancelDeleteModal(): void {
    this.showDeleteConfirmModal.set(false);
    this.recipeToDelete.set(null);
  }

  confirmDeleteRecipe(): void {
    const recipe = this.recipeToDelete();
    if (recipe) {
      this.deleteRecipe(recipe.id);
    }
    this.showDeleteConfirmModal.set(false);
    this.recipeToDelete.set(null);
  }

  deleteRecipe(recipeId: string): void {
    const r = this.catalogService.recipes().find((x) => x.id === recipeId);
    const name = r?.name || 'Recipe';
    this.catalogService.deleteRecipe(recipeId);
    this.toastService.showSuccess(`"${name}" deleted from list`);
  }

  deleteCustomRecipe(recipeId: string): void {
    this.deleteRecipe(recipeId);
  }

  // Modals & Recipe Editing
  openEditModal(recipe: Recipe): void {
    this.editingRecipeId.set(recipe.id);
    this.formName.set(recipe.name);
    this.formDescription.set(recipe.description);
    this.formCategory.set(recipe.category || 'meal');
    this.formServings.set(recipe.servings || 1);
    this.formCalories.set(recipe.nutrients.calories || 0);
    this.formCarbs.set(recipe.nutrients.carbs || 0);
    this.formProtein.set(recipe.nutrients.protein || 0);
    this.formFat.set(recipe.nutrients.fat || 0);
    this.formSodium.set(recipe.nutrients.sodium || 0);
    this.formFluids.set(recipe.nutrients.fluids || 0);
    this.formIngredients.set((recipe.ingredients || []).map((ing) => ({ ...ing })));
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.editingRecipeId.set(null);
  }

  saveEditedRecipe(): void {
    const id = this.editingRecipeId();
    if (!id) return;

    this.catalogService.updateRecipe(id, {
      name: this.formName(),
      description: this.formDescription(),
      category: this.formCategory(),
      servings: Math.max(1, this.formServings()),
      nutrients: {
        calories: Math.max(0, this.formCalories()),
        carbs: Math.max(0, this.formCarbs()),
        protein: Math.max(0, this.formProtein()),
        fat: Math.max(0, this.formFat()),
        sodium: Math.max(0, this.formSodium()),
        fluids: Math.max(0, this.formFluids())
      },
      ingredients: this.formIngredients()
        .filter((i) => i.name && i.name.trim().length > 0)
        .map((i) => ({
          name: i.name.trim(),
          quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1,
          unit: i.unit ? i.unit.trim() : 'item',
          department: i.department
        }))
    });

    this.toastService.showSuccess('Recipe updated successfully');
    this.closeEditModal();
  }

  openAddModal(): void {
    this.formName.set('');
    this.formDescription.set('');
    this.formCategory.set('meal');
    this.formServings.set(1);
    this.formCalories.set(500);
    this.formCarbs.set(60);
    this.formProtein.set(20);
    this.formFat.set(15);
    this.formSodium.set(500);
    this.formFluids.set(0);
    this.formIngredients.set([
      { name: '', quantity: 1, unit: 'item', department: 'Snacks/Candy' }
    ]);
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.showAddModal.set(false);
  }

  addFormIngredient(): void {
    this.formIngredients.update((list) => [
      ...list,
      { name: '', quantity: 1, unit: 'item', department: 'Snacks/Candy' }
    ]);
  }

  removeFormIngredient(index: number): void {
    this.formIngredients.update((list) => list.filter((_, i) => i !== index));
  }

  saveNewCustomRecipe(): void {
    const name = this.formName().trim();
    if (!name) {
      this.toastService.showWarning('Please enter a recipe name');
      return;
    }

    const filteredIng = this.formIngredients().filter((i) => i.name.trim().length > 0);

    this.catalogService.saveCustomRecipe({
      name,
      description: this.formDescription().trim() || 'Custom ultra-bikepacking recipe',
      category: this.formCategory(),
      servings: Math.max(1, this.formServings()),
      nutrients: {
        calories: Math.max(0, this.formCalories()),
        carbs: Math.max(0, this.formCarbs()),
        protein: Math.max(0, this.formProtein()),
        fat: Math.max(0, this.formFat()),
        sodium: Math.max(0, this.formSodium()),
        fluids: Math.max(0, this.formFluids())
      },
      ingredients: filteredIng
    });

    this.toastService.showSuccess(`Added "${name}" to recipe catalog`);
    this.closeAddModal();
  }

  onSaveRecipeForm(data: RecipeFormData): void {
    this.formName.set(data.name);
    this.formDescription.set(data.description);
    this.formCategory.set(data.category);
    this.formServings.set(data.servings);
    this.formCalories.set(data.nutrients.calories);
    this.formCarbs.set(data.nutrients.carbs);
    this.formProtein.set(data.nutrients.protein);
    this.formFat.set(data.nutrients.fat);
    this.formSodium.set(data.nutrients.sodium);
    this.formFluids.set(data.nutrients.fluids);
    this.formIngredients.set(data.ingredients);

    if (this.showEditModal()) {
      this.saveEditedRecipe();
    } else if (this.showAddModal()) {
      this.saveNewCustomRecipe();
    }
  }

  // Reset Selections & Quantities
  openResetModal(): void {
    this.showResetConfirmModal.set(true);
  }

  cancelResetModal(): void {
    this.showResetConfirmModal.set(false);
  }

  confirmReset(): void {
    this.catalogService.resetQuantities(this.recipeFilter());
    this.checkedItemIds.set(new Set());
    this.showResetConfirmModal.set(false);
    const cat = this.recipeFilter();
    this.toastService.showSuccess(
      cat === 'all'
        ? 'All toggles and quantities reset to zero'
        : `${cat.charAt(0).toUpperCase() + cat.slice(1)} toggles and quantities reset to zero`
    );
  }

  // Aliases for backwards compatibility with tests
  openResetAllModal(): void {
    this.openResetModal();
  }

  cancelResetAll(): void {
    this.cancelResetModal();
  }

  confirmResetAll(): void {
    this.catalogService.resetAllToDefault();
    this.checkedItemIds.set(new Set());
    this.showResetConfirmModal.set(false);
    this.toastService.showSuccess('All recipes reset to default catalog');
  }

  // Shopping List Checklist
  toggleItemChecked(itemId: string): void {
    this.checkedItemIds.update((set) => {
      const next = new Set(set);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  uncheckAllItems(): void {
    this.checkedItemIds.set(new Set());
  }

  async copyShoppingList(): Promise<void> {
    const text = this.shoppingListService.formatPlainText(this.departmentGroups());
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        this.toastService.showSuccess('Shopping list copied to clipboard!');
      } else {
        this.toastService.show('Shopping list generated (clipboard unavailable)', 'info');
      }
    } catch {
      this.toastService.show('Could not copy to clipboard', 'warning');
    }
  }

  dismissPwaBanner(): void {
    this.pwaBannerDismissed.set(true);
  }

  triggerPwaInstall(): void {
    this.pwaInstall.promptInstall();
  }
}
