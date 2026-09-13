import { TestBed } from '@angular/core/testing';
import { DEFAULT_RESUPPLY_RECIPES } from '../data/resupply-recipes.data';
import { RESUPPLY_STORAGE_KEY, ResupplyStorageState } from '../models/resupply.model';
import { ResupplyCatalogService } from './resupply-catalog.service';

describe('ResupplyCatalogService', () => {
  let service: ResupplyCatalogService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ResupplyCatalogService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initialization and Default Recipes', () => {
    it('should initialize with all 18 default ultra-bikepacking recipes', () => {
      expect(service).toBeTruthy();
      const recipes = service.recipes();
      expect(recipes.length).toBe(18);

      // Verify all default recipe IDs match
      const ids = recipes.map((r) => r.id);
      expect(ids).toContain('tuna-sandwich');
      expect(ids).toContain('avocado-sandwich');
      expect(ids).toContain('bag-of-chips');
      expect(ids).toContain('pizza-quarter-slice');
      expect(ids).toContain('half-subway-sub');
      expect(ids).toContain('cheeseburger');
      expect(ids).toContain('double-burger');
      expect(ids).toContain('large-fries');
      expect(ids).toContain('salted-nuts');
      expect(ids).toContain('gummy-bears');
      expect(ids).toContain('snickers-bar');
      expect(ids).toContain('gatorade');
      expect(ids).toContain('water-bottle');
      expect(ids).toContain('pb-honey-tortilla');
      expect(ids).toContain('trail-pad-thai');
      expect(ids).toContain('breakfast-burrito');
      expect(ids).toContain('pringles');
      expect(ids).toContain('chocolate-milk');
    });

    it('should have authentic nutritional profiles and discrete ingredients for every recipe', () => {
      for (const recipe of service.recipes()) {
        expect(recipe.name).toBeTruthy();
        expect(recipe.nutrients).toBeDefined();
        expect(recipe.ingredients.length).toBeGreaterThan(0);

        for (const ing of recipe.ingredients) {
          expect(ing.name).toBeTruthy();
          expect(ing.quantity).toBeGreaterThan(0);
          expect(ing.unit).toBeTruthy();
          expect(ing.department).toBeTruthy();
        }
      }
    });

    it('should initialize selectedItems with all 18 recipes at quantity 0', () => {
      const items = service.selectedItems();
      expect(items.length).toBe(18);
      expect(items.every((i) => i.quantity === 0 && !i.enabled)).toBe(true);
    });
  });

  describe('Recipe Selection, Toggling, and Quantities', () => {
    it('should toggle recipe enabled state and auto-set quantity to 1 if previously 0', () => {
      service.toggleRecipe('tuna-sandwich');
      let item = service.selectedItems().find((i) => i.recipe.id === 'tuna-sandwich');
      expect(item?.enabled).toBe(true);
      expect(item?.quantity).toBe(1);

      // Toggle off
      service.toggleRecipe('tuna-sandwich');
      item = service.selectedItems().find((i) => i.recipe.id === 'tuna-sandwich');
      expect(item?.enabled).toBe(false);
      expect(item?.quantity).toBe(1); // preserves quantity
    });

    it('should update quantity and auto-enable item when quantity > 0', () => {
      service.setQuantity('avocado-sandwich', 3);
      const item = service.selectedItems().find((i) => i.recipe.id === 'avocado-sandwich');
      expect(item?.quantity).toBe(3);
      expect(item?.enabled).toBe(true);
    });

    it('should disable item when quantity is set to 0', () => {
      service.setQuantity('avocado-sandwich', 2);
      service.setQuantity('avocado-sandwich', 0);
      const item = service.selectedItems().find((i) => i.recipe.id === 'avocado-sandwich');
      expect(item?.quantity).toBe(0);
      expect(item?.enabled).toBe(false);
    });

    it('should adjust quantity using adjustQuantity helper', () => {
      service.setQuantity('salted-nuts', 1);
      service.adjustQuantity('salted-nuts', 2);
      let item = service.selectedItems().find((i) => i.recipe.id === 'salted-nuts');
      expect(item?.quantity).toBe(3);

      service.adjustQuantity('salted-nuts', -1);
      item = service.selectedItems().find((i) => i.recipe.id === 'salted-nuts');
      expect(item?.quantity).toBe(2);
    });
  });

  describe('Active Nutrients Accumulation (Computed Signal)', () => {
    it('should return 0 for all nutrients when nothing is selected', () => {
      const active = service.activeNutrients();
      expect(active.calories).toBe(0);
      expect(active.carbs).toBe(0);
      expect(active.protein).toBe(0);
      expect(active.fat).toBe(0);
      expect(active.sodium).toBe(0);
      expect(active.fluids).toBe(0);
    });

    it('should accurately accumulate nutrients when recipes are enabled', () => {
      // Tuna sandwich: 350 kcal, 28 carbs, 26 protein, 14 fat, 600 sodium, 40 fluids
      // 2x Gatorade: 2 * (140 kcal, 36 carbs, 0 prot, 0 fat, 270 sodium, 591 fluids)
      service.setQuantity('tuna-sandwich', 1);
      service.setQuantity('gatorade', 2);

      const active = service.activeNutrients();
      expect(active.calories).toBe(350 + 2 * 140);   // 630
      expect(active.carbs).toBe(28 + 2 * 36);         // 100
      expect(active.protein).toBe(26 + 2 * 0);        // 26
      expect(active.fat).toBe(14 + 2 * 0);            // 14
      expect(active.sodium).toBe(600 + 2 * 270);      // 1140
      expect(active.fluids).toBe(40 + 2 * 591);       // 1222
    });

    it('should ignore disabled items even if quantity > 0', () => {
      service.setQuantity('tuna-sandwich', 2);
      service.toggleRecipe('tuna-sandwich', false); // disabled

      const active = service.activeNutrients();
      expect(active.calories).toBe(0);
    });
  });

  describe('Custom Recipe Management', () => {
    it('should create and append a new custom recipe', () => {
      const custom = service.saveCustomRecipe({
        name: 'Campfire Oatmeal Deluxe',
        description: 'Instant oats with chia, walnuts, and maple syrup.',
        servings: 1,
        category: 'meal',
        nutrients: {
          calories: 480,
          carbs: 65,
          protein: 14,
          fat: 18,
          sodium: 220,
          fluids: 200
        },
        ingredients: [
          { name: 'Rolled Oats (80g)', quantity: 1, unit: 'pack', department: 'Bakery' },
          { name: 'Walnuts (30g)', quantity: 1, unit: 'pouch', department: 'Snacks/Candy' }
        ]
      });

      expect(custom.id).toBeTruthy();
      expect(custom.isCustom).toBe(true);

      const catalog = service.recipes();
      expect(catalog.length).toBe(19);
      expect(catalog.some((r) => r.id === custom.id)).toBe(true);

      const selected = service.selectedItems();
      expect(selected.some((i) => i.recipe.id === custom.id && i.enabled)).toBe(true);
    });

    it('should update an existing custom recipe', () => {
      const created = service.saveCustomRecipe({
        name: 'Trail Mix Energy Ball',
        description: 'Dates, cacao, and almond butter.',
        servings: 1,
        category: 'snack',
        nutrients: { calories: 200, carbs: 25, protein: 5, fat: 10, sodium: 50, fluids: 0 },
        ingredients: [{ name: 'Dates', quantity: 3, unit: 'whole', department: 'Produce' }]
      });

      service.updateRecipe(created.id, {
        name: 'Super Trail Mix Ball',
        nutrients: { calories: 250, carbs: 30, protein: 7, fat: 12, sodium: 60, fluids: 0 }
      });

      const updated = service.recipes().find((r) => r.id === created.id);
      expect(updated?.name).toBe('Super Trail Mix Ball');
      expect(updated?.nutrients.calories).toBe(250);
    });

    it('should delete a custom recipe from catalog and selectedItems', () => {
      const created = service.saveCustomRecipe({
        name: 'Temporary Snack',
        description: 'To be removed.',
        servings: 1,
        nutrients: { calories: 100, carbs: 10, protein: 2, fat: 5, sodium: 10, fluids: 0 },
        ingredients: [{ name: 'Snack', quantity: 1, unit: 'pack', department: 'Snacks/Candy' }]
      });

      expect(service.recipes().length).toBe(19);
      service.deleteCustomRecipe(created.id);
      expect(service.recipes().length).toBe(18);
      expect(service.selectedItems().some((i) => i.recipe.id === created.id)).toBe(false);
    });
  });

  describe('Default Recipe Modifications & Override Merging', () => {
    it('should non-destructively modify a default recipe', () => {
      service.updateRecipe('tuna-sandwich', {
        name: 'Double Tuna Sandwich',
        nutrients: { calories: 500, carbs: 28, protein: 52, fat: 18, sodium: 900, fluids: 50 }
      });

      const modified = service.recipes().find((r) => r.id === 'tuna-sandwich');
      expect(modified?.name).toBe('Double Tuna Sandwich');
      expect(modified?.nutrients.calories).toBe(500);

      // Pristine default should remain untouched in data constant
      const pristine = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich');
      expect(pristine?.name).toBe('Tuna Sandwich');
      expect(pristine?.nutrients.calories).toBe(350);
    });

    it('should reset a modified default recipe back to pristine state', () => {
      service.updateRecipe('avocado-sandwich', {
        name: 'Custom Guac Melt',
        nutrients: { calories: 600, carbs: 50, protein: 20, fat: 40, sodium: 500, fluids: 100 }
      });

      service.resetRecipeToDefault('avocado-sandwich');
      const reset = service.recipes().find((r) => r.id === 'avocado-sandwich');
      expect(reset?.name).toBe('Avocado Sandwich');
      expect(reset?.nutrients.calories).toBe(490);
    });

    it('should reset all recipes and selections to pristine defaults', () => {
      service.setQuantity('tuna-sandwich', 2);
      service.updateRecipe('bag-of-chips', { name: 'Big Chips' });
      service.saveCustomRecipe({
        name: 'Extra Bar',
        description: 'Test',
        servings: 1,
        nutrients: { calories: 150, carbs: 20, protein: 2, fat: 5, sodium: 50, fluids: 0 },
        ingredients: [{ name: 'Bar', quantity: 1, unit: 'bar', department: 'Snacks/Candy' }]
      });

      service.resetAllToDefault();

      expect(service.recipes().length).toBe(18);
      expect(service.recipes().find((r) => r.id === 'bag-of-chips')?.name).toBe('Bag of Chips (50g / 1.75 oz)');
      expect(service.selectedItems().every((i) => i.quantity === 0 && !i.enabled)).toBe(true);
    });
  });

  describe('LocalStorage Persistence and Hydration', () => {
    it('should persist modified quantities and user adjustments to localStorage', () => {
      service.setQuantity('cheeseburger', 2);
      service.adjustSafetyBufferPercent(10);

      const raw = localStorage.getItem(RESUPPLY_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const parsed: ResupplyStorageState = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(parsed.selectedQuantities['cheeseburger']).toBe(2);
      expect(parsed.enabledStates['cheeseburger']).toBe(true);
      expect(parsed.safetyBufferPercent).toBe(10);
    });

    it('should adjust safetyBufferPercent in 5% increments and support negative deficits', () => {
      expect(service.safetyBufferPercent()).toBe(0);
      service.adjustSafetyBufferPercent(5);
      expect(service.safetyBufferPercent()).toBe(5);
      service.adjustSafetyBufferPercent(-15);
      expect(service.safetyBufferPercent()).toBe(-10);
      service.setSafetyBufferPercent(15);
      expect(service.safetyBufferPercent()).toBe(15);
    });

    it('should restore state from localStorage on service instantiation', () => {
      const savedState: ResupplyStorageState = {
        version: 1,
        selectedQuantities: { 'half-subway-sub': 2 },
        enabledStates: { 'half-subway-sub': true },
        modifiedDefaults: {
          'snickers-bar': {
            name: 'King Size Snickers',
            nutrients: { calories: 440, carbs: 60, protein: 8, fat: 22, sodium: 220, fluids: 0 }
          }
        },
        customRecipes: [
          {
            id: 'custom_trail_jerky',
            name: 'Smoked Beef Jerky',
            description: 'Lean high-protein snack',
            servings: 1,
            isCustom: true,
            nutrients: { calories: 280, carbs: 6, protein: 32, fat: 4, sodium: 1400, fluids: 0 },
            ingredients: [{ name: 'Beef Jerky (100g)', quantity: 1, unit: 'bag', department: 'Canned/Protein' }]
          }
        ],
        safetyBufferPercent: 15,
        userCalorieAdjustment: 15,
        scheduleConfig: { dailyRidingPercent: 0.65 }
      };

      localStorage.setItem(RESUPPLY_STORAGE_KEY, JSON.stringify(savedState));

      // Create new service instance
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const newService = TestBed.inject(ResupplyCatalogService);

      expect(newService.recipes().length).toBe(19);
      expect(newService.safetyBufferPercent()).toBe(15);

      const modifiedDefault = newService.recipes().find((r) => r.id === 'snickers-bar');
      expect(modifiedDefault?.name).toBe('King Size Snickers');

      const custom = newService.recipes().find((r) => r.id === 'custom_trail_jerky');
      expect(custom?.name).toBe('Smoked Beef Jerky');

      const subwayItem = newService.selectedItems().find((i) => i.recipe.id === 'half-subway-sub');
      expect(subwayItem?.quantity).toBe(2);
      expect(subwayItem?.enabled).toBe(true);
    });

    it('should recover gracefully if localStorage contains invalid JSON', () => {
      localStorage.setItem(RESUPPLY_STORAGE_KEY, '{"invalid_json: true');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const recoveryService = TestBed.inject(ResupplyCatalogService);

      expect(recoveryService.recipes().length).toBe(18);
    });

    it('should persist deleted recipe state to localStorage and exclude it from catalog upon hydration', () => {
      service.deleteRecipe('tuna-sandwich');
      expect(service.recipes().some((r) => r.id === 'tuna-sandwich')).toBe(false);
      expect(service.isRecipeDeleted('tuna-sandwich')).toBe(true);
      expect(service.selectedItems().some((i) => i.recipe.id === 'tuna-sandwich')).toBe(false);

      // Rehydrate in new service instance
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const rehydrated = TestBed.inject(ResupplyCatalogService);

      expect(rehydrated.recipes().some((r) => r.id === 'tuna-sandwich')).toBe(false);
      expect(rehydrated.isRecipeDeleted('tuna-sandwich')).toBe(true);

      // Reset to default restores it
      rehydrated.resetRecipeToDefault('tuna-sandwich');
      expect(rehydrated.recipes().some((r) => r.id === 'tuna-sandwich')).toBe(true);
      expect(rehydrated.isRecipeDeleted('tuna-sandwich')).toBe(false);
    });
  });

  describe('Reset Selections & Quantities (resetQuantities)', () => {
    it('should reset quantities and toggles to zero for a specific category', () => {
      service.setQuantity('tuna-sandwich', 3); // meal
      service.setQuantity('snickers-bar', 2);  // snack

      expect(service.selectedItems().find((i) => i.recipe.id === 'tuna-sandwich')?.quantity).toBe(3);
      expect(service.selectedItems().find((i) => i.recipe.id === 'snickers-bar')?.quantity).toBe(2);

      service.resetQuantities('meal');

      expect(service.selectedItems().find((i) => i.recipe.id === 'tuna-sandwich')?.quantity).toBe(0);
      expect(service.selectedItems().find((i) => i.recipe.id === 'tuna-sandwich')?.enabled).toBe(false);
      expect(service.selectedItems().find((i) => i.recipe.id === 'snickers-bar')?.quantity).toBe(2);
      expect(service.selectedItems().find((i) => i.recipe.id === 'snickers-bar')?.enabled).toBe(true);
    });

    it('should reset all quantities and toggles across all categories when category is all or omitted', () => {
      service.setQuantity('tuna-sandwich', 3);
      service.setQuantity('snickers-bar', 2);
      service.setQuantity('bottle-water', 4);

      service.resetQuantities('all');

      for (const item of service.selectedItems()) {
        expect(item.quantity).toBe(0);
        expect(item.enabled).toBe(false);
      }
    });
  });
});
