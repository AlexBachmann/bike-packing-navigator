/**
 * Empirical Challenger Test Suite for Milestone M2 (challenger_m2_2)
 *
 * Stresstesting:
 * 1. Recipe customization (add custom across 7 departments, localStorage persistence, override merging, single reset, reset all)
 * 2. Fulfillment gauges (zero selection safety, zero division safety, extreme surplus >200% track clamping and +X% surplus badge)
 * 3. Grocery shopping list (duplicate ingredient consolidation, 7-department retail progression, interactive checkboxes, plain text clipboard export)
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ResupplyPlannerComponent } from '../components/resupply-planner/resupply-planner.component';
import { RouteDataService } from '../services/route-data.service';
import { SettingsService } from '../services/settings.service';
import { ResupplyCatalogService } from '../services/resupply-catalog.service';
import { ResupplyPhysicsService } from '../services/resupply-physics.service';
import {
  DEPARTMENT_ORDER,
  DEPARTMENT_ICONS,
  ResupplyShoppingListService
} from '../services/resupply-shopping-list.service';
import { PwaInstallService } from '../services/pwa-install.service';
import { ToastService } from '../services/toast.service';
import { DEFAULT_RESUPPLY_RECIPES } from '../data/resupply-recipes.data';
import {
  GroceryDepartment,
  Recipe,
  RESUPPLY_STORAGE_KEY,
  ResupplyStorageState,
  SelectedRecipeItem
} from '../models/resupply.model';
import { By } from '@angular/platform-browser';

describe('Empirical Challenger M2: Resupply Missions, Custom Recipes, Fulfillment Gauges & Grocery List', () => {
  let fixture: ComponentFixture<ResupplyPlannerComponent>;
  let component: ResupplyPlannerComponent;
  let catalogService: ResupplyCatalogService;
  let physicsService: ResupplyPhysicsService;
  let shoppingListService: ResupplyShoppingListService;
  let settingsService: SettingsService;
  let toastService: ToastService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ResupplyPlannerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RouteDataService,
        SettingsService,
        ResupplyCatalogService,
        ResupplyPhysicsService,
        ResupplyShoppingListService,
        PwaInstallService,
        ToastService
      ]
    }).compileComponents();

    catalogService = TestBed.inject(ResupplyCatalogService);
    physicsService = TestBed.inject(ResupplyPhysicsService);
    shoppingListService = TestBed.inject(ResupplyShoppingListService);
    settingsService = TestBed.inject(SettingsService);
    toastService = TestBed.inject(ToastService);

    fixture = TestBed.createComponent(ResupplyPlannerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentMile', 0);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ==========================================================================
  // MISSION 1: RECIPE CUSTOMIZATION LIFECYCLE & PERSISTENCE
  // ==========================================================================
  describe('Mission 1: Recipe Customization Lifecycle & Storage Persistence', () => {
    it('1.1 should add a custom recipe spanning multiple ingredients across 7 departments and persist in localStorage', () => {
      // Setup custom recipe with ingredients in all 7 retail departments
      const customRecipeData: Omit<Recipe, 'id'> = {
        name: 'Great Divide Super Pemmican Pack',
        description: 'Dense ultra-endurance fuel block',
        category: 'snack',
        servings: 2,
        nutrients: {
          calories: 1200,
          carbs: 110,
          protein: 48,
          fat: 65,
          sodium: 1400,
          fluids: 250
        },
        ingredients: [
          { name: 'Dried Apples', quantity: 50, unit: 'g', department: 'Produce' },
          { name: 'Flour Tortillas', quantity: 4, unit: 'count', department: 'Bakery' },
          { name: 'Smoked Salmon Pack', quantity: 150, unit: 'g', department: 'Canned/Protein' },
          { name: 'Dark Chocolate Almonds', quantity: 100, unit: 'g', department: 'Snacks/Candy' },
          { name: 'Electrolyte Powder', quantity: 2, unit: 'stick', department: 'Beverages' },
          { name: 'Sharp Cheddar Chunk', quantity: 120, unit: 'g', department: 'Dairy' },
          { name: 'Hard Boiled Egg', quantity: 2, unit: 'count', department: 'Prepared/Deli' }
        ]
      };

      const saved = catalogService.saveCustomRecipe(customRecipeData);

      // Verify custom recipe properties
      expect(saved.id).toBeDefined();
      expect(saved.isCustom).toBe(true);
      expect(saved.ingredients.length).toBe(7);

      // Verify it appears in catalog signal
      const inCatalog = catalogService.recipes().find((r) => r.id === saved.id);
      expect(inCatalog).toBeDefined();
      expect(inCatalog!.name).toBe('Great Divide Super Pemmican Pack');
      expect(inCatalog!.ingredients.map((i) => i.department)).toEqual([
        'Produce',
        'Bakery',
        'Canned/Protein',
        'Snacks/Candy',
        'Beverages',
        'Dairy',
        'Prepared/Deli'
      ]);

      // Verify auto-selected and enabled with quantity = 1
      const selected = catalogService.selectedItems().find((i) => i.recipe.id === saved.id);
      expect(selected).toBeDefined();
      expect(selected!.enabled).toBe(true);
      expect(selected!.quantity).toBe(1);

      // Verify persistence in localStorage
      const rawStorage = localStorage.getItem(RESUPPLY_STORAGE_KEY);
      expect(rawStorage).toBeTruthy();
      const parsed: ResupplyStorageState = JSON.parse(rawStorage!);
      expect(parsed.customRecipes.length).toBe(1);
      expect(parsed.customRecipes[0].name).toBe('Great Divide Super Pemmican Pack');
      expect(parsed.customRecipes[0].ingredients.length).toBe(7);

      // Verify hydration in a fresh instance of ResupplyCatalogService
      const freshService = new ResupplyCatalogService();
      const hydratedCustom = freshService.recipes().find((r) => r.id === saved.id);
      expect(hydratedCustom).toBeDefined();
      expect(hydratedCustom!.isCustom).toBe(true);
      expect(hydratedCustom!.nutrients.calories).toBe(1200);
      expect(hydratedCustom!.ingredients.length).toBe(7);
      expect(hydratedCustom!.ingredients[0].department).toBe('Produce');
      expect(hydratedCustom!.ingredients[6].department).toBe('Prepared/Deli');
    });

    it('1.2 should edit a default recipe and verify non-destructive override merges cleanly over default', () => {
      const defaultTuna = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')!;
      expect(defaultTuna.nutrients.calories).toBe(350);
      expect(defaultTuna.nutrients.protein).toBe(26);

      // Edit default recipe via updateRecipe
      catalogService.updateRecipe('tuna-sandwich', {
        nutrients: {
          calories: 650,
          protein: 45
        }
      } as any);

      const modifiedTuna = catalogService.recipes().find((r) => r.id === 'tuna-sandwich')!;
      // Overridden fields
      expect(modifiedTuna.nutrients.calories).toBe(650);
      expect(modifiedTuna.nutrients.protein).toBe(45);
      // Preserved default fields from original definition
      expect(modifiedTuna.nutrients.carbs).toBe(defaultTuna.nutrients.carbs);
      expect(modifiedTuna.nutrients.fat).toBe(defaultTuna.nutrients.fat);
      expect(modifiedTuna.nutrients.sodium).toBe(defaultTuna.nutrients.sodium);
      expect(modifiedTuna.nutrients.fluids).toBe(defaultTuna.nutrients.fluids);
      expect(modifiedTuna.ingredients.length).toBe(defaultTuna.ingredients.length);
      expect(modifiedTuna.isCustom).toBe(false);

      // Verify detection in component
      expect(component.isModifiedDefault(modifiedTuna)).toBe(true);

      // Verify saved in localStorage
      const rawStorage = localStorage.getItem(RESUPPLY_STORAGE_KEY);
      const parsed: ResupplyStorageState = JSON.parse(rawStorage!);
      expect(parsed.modifiedDefaults['tuna-sandwich']).toBeDefined();
      expect(parsed.modifiedDefaults['tuna-sandwich'].nutrients?.calories).toBe(650);

      // Verify hydration in fresh service instance retains override
      const freshService = new ResupplyCatalogService();
      const freshTuna = freshService.recipes().find((r) => r.id === 'tuna-sandwich')!;
      expect(freshTuna.nutrients.calories).toBe(650);
      expect(freshTuna.nutrients.protein).toBe(45);
      expect(freshTuna.nutrients.fat).toBe(defaultTuna.nutrients.fat);
    });

    it('1.3 should reset the edited recipe to default and restore pristine recipe values', () => {
      const defaultPizza = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'pizza-quarter-slice')!;

      // Apply modification
      catalogService.updateRecipe('pizza-quarter-slice', {
        name: 'Super Double-Salami Pizza Slice',
        nutrients: {
          calories: 990,
          fat: 60
        }
      } as any);

      let currentPizza = catalogService.recipes().find((r) => r.id === 'pizza-quarter-slice')!;
      expect(currentPizza.name).toBe('Super Double-Salami Pizza Slice');
      expect(currentPizza.nutrients.calories).toBe(990);

      // Reset single recipe
      catalogService.resetRecipeToDefault('pizza-quarter-slice');

      currentPizza = catalogService.recipes().find((r) => r.id === 'pizza-quarter-slice')!;
      expect(currentPizza.name).toBe(defaultPizza.name);
      expect(currentPizza.nutrients.calories).toBe(defaultPizza.nutrients.calories);
      expect(currentPizza.nutrients.fat).toBe(defaultPizza.nutrients.fat);
      expect(component.isModifiedDefault(currentPizza)).toBe(false);

      // Storage should have cleared the override
      const rawStorage = localStorage.getItem(RESUPPLY_STORAGE_KEY);
      const parsed: ResupplyStorageState = JSON.parse(rawStorage!);
      expect(parsed.modifiedDefaults['pizza-quarter-slice']).toBeUndefined();
    });

    it('1.4 should reset all recipes to default, clearing custom items and resetting selections', () => {
      // Add custom recipe
      catalogService.saveCustomRecipe({
        name: 'Ephemeral Energy Bites',
        description: 'Quick bites',
        servings: 1,
        nutrients: { calories: 300, carbs: 40, protein: 10, fat: 10, sodium: 100, fluids: 0 },
        ingredients: [{ name: 'Dates', quantity: 4, unit: 'count', department: 'Produce' }]
      });

      // Modify a default recipe
      catalogService.updateRecipe('breakfast-burrito', {
        nutrients: { calories: 850 }
      } as any);

      // Enable multiple recipes with quantities
      catalogService.setQuantity('tuna-sandwich', 3);
      catalogService.setQuantity('pringles', 2);
      catalogService.setUserCalorieAdjustment(400);

      expect(catalogService.recipes().length).toBe(19);
      expect(catalogService.activeNutrients().calories).toBeGreaterThan(0);
      expect(catalogService.userCalorieAdjustment()).toBe(400);

      // Call resetAllToDefault
      catalogService.resetAllToDefault();

      // Verify catalog is back to exact 18 default recipes
      expect(catalogService.recipes().length).toBe(18);
      expect(catalogService.recipes().some((r) => r.isCustom)).toBe(false);

      // Verify modified defaults are wiped
      const burrito = catalogService.recipes().find((r) => r.id === 'breakfast-burrito')!;
      const originalBurrito = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'breakfast-burrito')!;
      expect(burrito.nutrients.calories).toBe(originalBurrito.nutrients.calories);

      // Verify all selections reset to 0 and disabled
      const selected = catalogService.selectedItems();
      expect(selected.every((item) => item.quantity === 0 && !item.enabled)).toBe(true);
      expect(catalogService.activeNutrients().calories).toBe(0);
      expect(catalogService.userCalorieAdjustment()).toBe(0);

      // Verify storage is completely cleared
      expect(localStorage.getItem(RESUPPLY_STORAGE_KEY)).toBeNull();
    });
  });

  // ==========================================================================
  // MISSION 2: FULFILLMENT GAUGES & SURPLUS CLAMPING
  // ==========================================================================
  describe('Mission 2: Fulfillment Gauges, Zero Division Safety & >200% Surplus Clamping', () => {
    it('2.1 should handle zero selection with 0% fulfillment and zero division errors', () => {
      catalogService.resetAllToDefault();
      component.setCustomDistance(50);
      fixture.detectChanges();

      const fulfillment = component.fulfillment();

      // All dimensions must report 0 current and 0% fulfillment
      expect(fulfillment.calories.current).toBe(0);
      expect(fulfillment.calories.percentage).toBe(0);
      expect(Number.isFinite(fulfillment.calories.percentage)).toBe(true);
      expect(Number.isNaN(fulfillment.calories.percentage)).toBe(false);

      expect(fulfillment.protein.current).toBe(0);
      expect(fulfillment.protein.percentage).toBe(0);

      expect(fulfillment.fat.current).toBe(0);
      expect(fulfillment.fat.percentage).toBe(0);

      expect(fulfillment.sodium.current).toBe(0);
      expect(fulfillment.sodium.percentage).toBe(0);

      expect(fulfillment.fluids.current).toBe(0);
      expect(fulfillment.fluids.percentage).toBe(0);

      // Verify DOM render for 0%
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('0%');
      expect(compiled.textContent).not.toContain('NaN');
      expect(compiled.textContent).not.toContain('Infinity');
    });

    it('2.2 should safely handle target = 0 in calculateFulfillment without division by zero', () => {
      const zeroTargets = {
        baseCalories: 0,
        safetyBufferCalories: 0,
        userAdjustmentCalories: 0,
        totalCaloriesTarget: 0,
        carbsTargetGrams: 0,
        proteinTargetGrams: 0,
        fatTargetGrams: 0,
        sodiumTargetMg: 0,
        potassiumTargetMg: 0,
        magnesiumTargetMg: 0,
        fluidsTargetMl: 0
      };

      const profileZero = { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 };
      const fZero = physicsService.calculateFulfillment(profileZero, zeroTargets);
      expect(fZero.calories.percentage).toBe(100);
      expect(Number.isFinite(fZero.calories.percentage)).toBe(true);

      const profileNonZero = { calories: 500, carbs: 50, protein: 20, fat: 15, sodium: 400, fluids: 500 };
      const fNonZero = physicsService.calculateFulfillment(profileNonZero, zeroTargets);
      expect(fNonZero.calories.percentage).toBe(100);
      expect(Number.isFinite(fNonZero.calories.percentage)).toBe(true);
    });

    it('2.3 should clamp visual track fill to 100% and render +X% surplus badge under extreme surplus (>200%)', () => {
      // Set very small distance (10 miles) to produce low targets (~600-800 kcal)
      component.setCustomDistance(10);
      fixture.detectChanges();

      const targets = component.nutrientTargets();
      expect(targets.totalCaloriesTarget).toBeLessThanOrEqual(1000);

      // Pack extreme quantities across all nutrient dimensions (> 200% surplus)
      const pringles = catalogService.recipes().find((r) => r.id === 'pringles')!;
      const tuna = catalogService.recipes().find((r) => r.id === 'tuna-sandwich')!;
      const gatorade = catalogService.recipes().find((r) => r.id === 'gatorade')!;
      const nuts = catalogService.recipes().find((r) => r.id === 'salted-nuts')!;

      catalogService.setQuantity(pringles.id, 5); // 5 x 840 = 4200 kcal, fat: 255g
      catalogService.setQuantity(tuna.id, 6);     // 6 x 350 = 2100 kcal, protein: 156g
      catalogService.setQuantity(gatorade.id, 10);// 10 x 591 = 5910 ml fluids, 2700mg sodium
      catalogService.setQuantity(nuts.id, 5);     // 5 x 610 = 3050 kcal, sodium & fats

      fixture.detectChanges();

      const f = component.fulfillment();

      // Verify extreme surplus percentages > 200%
      expect(f.calories.percentage).toBeGreaterThan(200);
      expect(f.protein.percentage).toBeGreaterThan(200);
      expect(f.fat.percentage).toBeGreaterThan(200);
      expect(f.sodium.percentage).toBeGreaterThan(200);
      expect(f.fluids.percentage).toBeGreaterThan(200);

      // Verify DOM: Surplus badges and clamped visual tracks
      const compiled = fixture.nativeElement as HTMLElement;

      // Calories surplus badge: +{percentage - 100}% surplus
      const calSurplus = f.calories.percentage - 100;
      expect(compiled.textContent).toContain(`+${calSurplus}% surplus`);

      // Protein surplus badge
      const proteinSurplus = f.protein.percentage - 100;
      expect(compiled.textContent).toContain(`+${proteinSurplus}% surplus`);

      // Fat surplus badge
      const fatSurplus = f.fat.percentage - 100;
      expect(compiled.textContent).toContain(`+${fatSurplus}% surplus`);

      // Sodium surplus badge
      const sodiumSurplus = f.sodium.percentage - 100;
      expect(compiled.textContent).toContain(`+${sodiumSurplus}% surplus`);

      // Hydration surplus badge
      const fluidsSurplus = f.fluids.percentage - 100;
      expect(compiled.textContent).toContain(`+${fluidsSurplus}% surplus`);

      // Check DOM gauge track elements for clamped width (style="width: 100%;")
      const fillBars = fixture.debugElement.queryAll(By.css('.h-2\\.5 > div'));
      expect(fillBars.length).toBe(5);

      for (const bar of fillBars) {
        const styleWidth = bar.nativeElement.style.width;
        expect(styleWidth).toBe('100%');
      }
    });
  });

  // ==========================================================================
  // MISSION 3: GROCERY SHOPPING LIST AGGREGATION & RETAIL PROGRESSION
  // ==========================================================================
  describe('Mission 3: Grocery Shopping List Consolidation, 7 Departments & Checklist State', () => {
    beforeEach(() => {
      catalogService.resetAllToDefault();
    });

    it('3.1 should aggregate duplicate ingredients across multiple recipes into consolidated single items', () => {
      // Tuna Sandwich contains:
      // - Bread (2 slices, Bakery)
      // - Tuna pouch (85g) (1 pouch, Canned/Protein)
      // - Mayonnaise packet (15g) (1 packet, Prepared/Deli)
      //
      // Add a custom recipe that shares Tuna pouch (85g) and Bread:
      catalogService.saveCustomRecipe({
        name: 'Tuna Melt Wrap',
        description: 'Tuna with cheddar in bread',
        servings: 1,
        nutrients: { calories: 400, carbs: 30, protein: 30, fat: 15, sodium: 500, fluids: 0 },
        ingredients: [
          { name: 'Tuna pouch (85g)', quantity: 2, unit: 'pouch', department: 'Canned/Protein' },
          { name: 'Bread', quantity: 1, unit: 'slices', department: 'Bakery' },
          { name: 'Cheddar Cheese Slices', quantity: 2, unit: 'slices', department: 'Dairy' }
        ]
      });

      const custom = catalogService.recipes().find((r) => r.name === 'Tuna Melt Wrap')!;

      // Set quantities: 3 x Tuna Sandwich + 2 x Tuna Melt Wrap
      catalogService.setQuantity('tuna-sandwich', 3);
      catalogService.setQuantity(custom.id, 2);

      const items = shoppingListService.aggregateIngredients(catalogService.selectedItems());

      // Tuna pouch (85g) should be consolidated: 3 * 1 + 2 * 2 = 7 pouches
      const tunaItem = items.find((i) => i.name === 'Tuna pouch (85g)');
      expect(tunaItem).toBeDefined();
      expect(tunaItem!.totalQuantity).toBe(7);
      expect(tunaItem!.unit).toBe('pouch');
      expect(tunaItem!.department).toBe('Canned/Protein');

      // Bread should be consolidated: 3 * 2 + 2 * 1 = 8 slices
      const breadItem = items.find((i) => i.name === 'Bread');
      expect(breadItem).toBeDefined();
      expect(breadItem!.totalQuantity).toBe(8);
      expect(breadItem!.unit).toBe('slices');
      expect(breadItem!.department).toBe('Bakery');

      // Cheddar cheese: 2 * 2 = 4 slices
      const cheeseItem = items.find((i) => i.name === 'Cheddar Cheese Slices');
      expect(cheeseItem).toBeDefined();
      expect(cheeseItem!.totalQuantity).toBe(4);

      // Verify no duplicate keys for Tuna pouch (85g) or Bread
      const tunaCount = items.filter((i) => i.name === 'Tuna pouch (85g)').length;
      expect(tunaCount).toBe(1);
      const breadCount = items.filter((i) => i.name === 'Bread').length;
      expect(breadCount).toBe(1);
    });

    it('3.2 should organize aggregated items into 7 departments matching retail supermarket progression', () => {
      // Create selections spanning all 7 departments
      const customAllDepts: Recipe = {
        id: 'full_dept_recipe',
        name: 'Full Department Feast',
        description: 'Touches all 7 aisles',
        servings: 1,
        nutrients: { calories: 1000, carbs: 100, protein: 40, fat: 40, sodium: 1000, fluids: 500 },
        ingredients: [
          { name: 'Gala Apples', quantity: 2, unit: 'items', department: 'Produce' },
          { name: 'Bagels', quantity: 4, unit: 'count', department: 'Bakery' },
          { name: 'Canned Sardines', quantity: 2, unit: 'can', department: 'Canned/Protein' },
          { name: 'Trail Mix', quantity: 200, unit: 'g', department: 'Snacks/Candy' },
          { name: 'Sparkling Water', quantity: 1, unit: 'bottle', department: 'Beverages' },
          { name: 'Greek Yogurt', quantity: 2, unit: 'cups', department: 'Dairy' },
          { name: 'Turkey Sub Roll', quantity: 1, unit: 'roll', department: 'Prepared/Deli' }
        ]
      };

      const selectedItem: SelectedRecipeItem = {
        recipe: customAllDepts,
        quantity: 1,
        enabled: true
      };

      const items = shoppingListService.aggregateIngredients([selectedItem]);
      const groups = shoppingListService.groupByDepartment(items);

      // Verify all 7 departments are present
      expect(groups.length).toBe(7);

      // Verify strict retail progression order
      const actualDepartments = groups.map((g) => g.department);
      expect(actualDepartments).toEqual([
        'Produce',
        'Bakery',
        'Canned/Protein',
        'Snacks/Candy',
        'Beverages',
        'Dairy',
        'Prepared/Deli'
      ]);

      // Verify items within each department are sorted alphabetically
      for (const group of groups) {
        const itemNames = group.items.map((i) => i.name);
        const sortedNames = [...itemNames].sort((a, b) => a.localeCompare(b));
        expect(itemNames).toEqual(sortedNames);
      }
    });

    it('3.3 should interactively update item checked state via checkboxes and toggle actions', () => {
      catalogService.setQuantity('tuna-sandwich', 2);
      component.activeView.set('shopping-list');
      fixture.detectChanges();

      const items = component.aggregatedGroceryItems();
      expect(items.length).toBeGreaterThan(0);
      const targetItem = items[0];

      // Initial state: unchecked
      expect(targetItem.checked).toBe(false);
      expect(component.checkedItemIds().has(targetItem.id)).toBe(false);

      // Toggle checked
      component.toggleItemChecked(targetItem.id);
      fixture.detectChanges();

      expect(component.checkedItemIds().has(targetItem.id)).toBe(true);
      const updatedItems = component.aggregatedGroceryItems();
      const updatedTarget = updatedItems.find((i) => i.id === targetItem.id)!;
      expect(updatedTarget.checked).toBe(true);

      // Invert toggle back to unchecked
      component.toggleItemChecked(targetItem.id);
      fixture.detectChanges();

      expect(component.checkedItemIds().has(targetItem.id)).toBe(false);

      // Check multiple and then uncheckAllItems
      component.toggleItemChecked(items[0].id);
      if (items.length > 1) {
        component.toggleItemChecked(items[1].id);
      }
      expect(component.checkedItemIds().size).toBeGreaterThanOrEqual(1);

      component.uncheckAllItems();
      fixture.detectChanges();
      expect(component.checkedItemIds().size).toBe(0);
    });

    it('3.4 should format plain text shopping list output correctly with icons, checked marks, and empty states', () => {
      // Test Empty State
      const emptyText = shoppingListService.formatPlainText([]);
      expect(emptyText).toBe('🛒 TOUR DIVIDE RESUPPLY SHOPPING LIST\n(No items selected)');

      // Test Populated List with Checked & Unchecked Items
      const groups = [
        {
          department: 'Bakery' as GroceryDepartment,
          items: [
            { id: 'bread', name: 'White/Wheat Bread', totalQuantity: 4, unit: 'slices', department: 'Bakery' as GroceryDepartment, checked: false },
            { id: 'tortilla', name: 'Flour Tortillas', totalQuantity: 2, unit: 'count', department: 'Bakery' as GroceryDepartment, checked: true }
          ]
        },
        {
          department: 'Beverages' as GroceryDepartment,
          items: [
            { id: 'water', name: 'Bottled Water', totalQuantity: 2, unit: 'bottle', department: 'Beverages' as GroceryDepartment, checked: false }
          ]
        }
      ];

      const formatted = shoppingListService.formatPlainText(groups);

      expect(formatted).toContain('🛒 TOUR DIVIDE RESUPPLY SHOPPING LIST');
      expect(formatted).toContain('[🍞 BAKERY]');
      expect(formatted).toContain('[ ] 4 slices White/Wheat Bread');
      expect(formatted).toContain('[x] 2 count Flour Tortillas');
      expect(formatted).toContain('[🥤 BEVERAGES]');
      expect(formatted).toContain('[ ] 2 bottle Bottled Water');
    });
  });
});
