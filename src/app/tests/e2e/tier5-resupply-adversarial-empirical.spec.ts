import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ResupplyCatalogService } from '../../services/resupply-catalog.service';
import { ResupplyShoppingListService } from '../../services/resupply-shopping-list.service';
import { ResupplyPhysicsService } from '../../services/resupply-physics.service';
import { ResupplyPlannerComponent } from '../../components/resupply-planner/resupply-planner.component';
import { PwaInstallService } from '../../services/pwa-install.service';
import { SettingsService } from '../../services/settings.service';
import { RouteDataService } from '../../services/route-data.service';
import { ToastService } from '../../services/toast.service';
import { DEFAULT_RESUPPLY_RECIPES } from '../../data/resupply-recipes.data';
import {
  RESUPPLY_STORAGE_KEY,
  Recipe,
  SelectedRecipeItem
} from '../../models/resupply.model';

describe('Tier 5 Adversarial Empirical Verification: Resupply Catalog, Shopping List & Planner', () => {
  let catalogService: ResupplyCatalogService;
  let shoppingListService: ResupplyShoppingListService;
  let physicsService: ResupplyPhysicsService;
  let pwaInstall: PwaInstallService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ResupplyCatalogService,
        ResupplyShoppingListService,
        ResupplyPhysicsService,
        PwaInstallService,
        SettingsService,
        RouteDataService,
        ToastService
      ]
    });

    catalogService = TestBed.inject(ResupplyCatalogService);
    shoppingListService = TestBed.inject(ResupplyShoppingListService);
    physicsService = TestBed.inject(ResupplyPhysicsService);
    pwaInstall = TestBed.inject(PwaInstallService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // =========================================================================
  // 1. LOCALSTORAGE CORRUPTION & EDGE CASES
  // =========================================================================
  describe('1. LocalStorage Corruption, Quota, Invalid JSON & Missing Keys', () => {
    it('1.1 should handle completely invalid JSON without crashing or corrupting state', () => {
      localStorage.setItem(RESUPPLY_STORAGE_KEY, '{"version": 1, "corrupted: true');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ResupplyCatalogService);

      expect(service.recipes().length).toBe(18);
      expect(service.selectedItems().length).toBe(18);
    });

    it('1.2 should handle non-object JSON values (string, number, boolean, null)', () => {
      const corruptPayloads = ['"string"', '12345', 'true', 'null', '[]'];

      for (const payload of corruptPayloads) {
        localStorage.setItem(RESUPPLY_STORAGE_KEY, payload);

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({});
        const service = TestBed.inject(ResupplyCatalogService);

        expect(service.recipes().length).toBe(18);
        expect(service.selectedItems().length).toBe(18);
      }
    });

    it('1.3 should handle unknown storage schema version gracefully', () => {
      localStorage.setItem(
        RESUPPLY_STORAGE_KEY,
        JSON.stringify({
          version: 999,
          customRecipes: [{ id: 'future_recipe', name: 'Future Food' }]
        })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ResupplyCatalogService);

      expect(service.recipes().length).toBe(18);
      expect(service.recipes().some((r) => r.id === 'future_recipe')).toBe(false);
    });

    it('1.4 should handle missing keys in storage state with version 1', () => {
      // Missing all optional keys
      localStorage.setItem(
        RESUPPLY_STORAGE_KEY,
        JSON.stringify({
          version: 1
        })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ResupplyCatalogService);

      expect(service.recipes().length).toBe(18);
      expect(service.userCalorieAdjustment()).toBe(0);
      expect(service.selectedItems().length).toBe(18);
    });

    it('1.5 should handle quota exceeded errors during saveToStorage without throwing', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        const err = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        throw err;
      });

      expect(() => {
        catalogService.setQuantity('tuna-sandwich', 5);
        catalogService.adjustUserCalories(200);
      }).not.toThrow();

      setItemSpy.mockRestore();
    });

    it('1.6 should test behavior when customRecipes in localStorage is corrupted or non-array', () => {
      // Corrupted customRecipes: non-array string
      localStorage.setItem(
        RESUPPLY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          customRecipes: 'not an array'
        })
      );

      // What happens when instantiating service?
      let crashed = false;
      try {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({});
        const service = TestBed.inject(ResupplyCatalogService);
        service.recipes();
      } catch (e) {
        crashed = true;
      }

      expect(crashed).toBe(false);
      const service = TestBed.inject(ResupplyCatalogService);
      expect(service.recipes().length).toBe(18);
    });

    it('1.7 should test behavior when a custom recipe in localStorage has missing ingredients array', () => {
      localStorage.setItem(
        RESUPPLY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          customRecipes: [
            {
              id: 'broken_recipe',
              name: 'Broken Recipe',
              servings: 1,
              nutrients: { calories: 100, carbs: 10, protein: 5, fat: 2, sodium: 50, fluids: 0 }
              // ingredients is undefined!
            }
          ]
        })
      );

      let crashed = false;
      let errorMsg = '';
      try {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({});
        const service = TestBed.inject(ResupplyCatalogService);
        service.recipes();
      } catch (e: any) {
        crashed = true;
        errorMsg = e?.message || String(e);
      }

      expect(crashed).toBe(false);
      const service = TestBed.inject(ResupplyCatalogService);
      const broken = service.recipes().find((r) => r.id === 'broken_recipe');
      expect(broken).toBeDefined();
      expect(broken?.ingredients).toEqual([]);
    });
  });

  // =========================================================================
  // 2. NON-DESTRUCTIVE OVERRIDE MERGING & IMMUTABILITY
  // =========================================================================
  describe('2. Non-Destructive Override Merging & DEFAULT_RESUPPLY_RECIPES Immutability', () => {
    it('2.1 should confirm DEFAULT_RESUPPLY_RECIPES cannot be mutated via updateRecipe', () => {
      const originalTuna = JSON.parse(JSON.stringify(DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')));

      catalogService.updateRecipe('tuna-sandwich', {
        name: 'Mega Tuna Overdrive',
        servings: 4,
        nutrients: { calories: 999, carbs: 99, protein: 99, fat: 99, sodium: 999, fluids: 999 },
        ingredients: [{ name: 'Gold Leaf Tuna', quantity: 10, unit: 'can', department: 'Canned/Protein' }]
      });

      const modifiedInService = catalogService.recipes().find((r) => r.id === 'tuna-sandwich')!;
      expect(modifiedInService.name).toBe('Mega Tuna Overdrive');
      expect(modifiedInService.nutrients.calories).toBe(999);

      // Verify pristine constant is unchanged
      const pristineTuna = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')!;
      expect(pristineTuna.name).toBe(originalTuna.name);
      expect(pristineTuna.servings).toBe(originalTuna.servings);
      expect(pristineTuna.nutrients).toEqual(originalTuna.nutrients);
      expect(pristineTuna.ingredients).toEqual(originalTuna.ingredients);
    });

    it('2.2 should restore exact pristine definition on resetRecipeToDefault', () => {
      const originalAvocado = JSON.parse(JSON.stringify(DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'avocado-sandwich')));

      catalogService.updateRecipe('avocado-sandwich', {
        name: 'Mutated Avocado Melt',
        nutrients: { calories: 1200, carbs: 100, protein: 30, fat: 70, sodium: 800, fluids: 50 }
      });

      catalogService.resetRecipeToDefault('avocado-sandwich');

      const resetRecipe = catalogService.recipes().find((r) => r.id === 'avocado-sandwich')!;
      expect(resetRecipe.name).toBe(originalAvocado.name);
      expect(resetRecipe.nutrients).toEqual(originalAvocado.nutrients);
    });

    it('2.3 should ensure direct in-memory mutation of recipe objects from recipes() does not mutate defaults', () => {
      const recipes = catalogService.recipes();
      const first = recipes[0];

      // Direct in-memory mutation attempt on the object returned from recipes()
      const originalName = first.name;
      (first as any).name = 'Direct In-Memory Mutation';
      (first.nutrients as any).calories = 9999;

      // Verify pristine DEFAULT_RESUPPLY_RECIPES was NOT mutated
      const pristine = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === first.id)!;
      expect(pristine.name).toBe(originalName);
      expect(pristine.nutrients.calories).not.toBe(9999);

      // Rebuilding catalog restores clean state
      catalogService.resetAllToDefault();
      const fresh = catalogService.recipes().find((r) => r.id === first.id)!;
      expect(fresh.name).toBe(originalName);
    });
  });

  // =========================================================================
  // 3. CUSTOM RECIPE CREATION & EDGE CASES
  // =========================================================================
  describe('3. Custom Recipe Creation Edge Cases (Missing Fields, Duplicate IDs, Whitespace)', () => {
    it('3.1 should auto-generate unique ID when ID is omitted', () => {
      const r1 = catalogService.saveCustomRecipe({
        name: 'Custom 1',
        description: 'Desc 1',
        servings: 1,
        nutrients: { calories: 100, carbs: 10, protein: 2, fat: 1, sodium: 10, fluids: 0 },
        ingredients: [{ name: 'Item 1', quantity: 1, unit: 'ea', department: 'Snacks/Candy' }]
      });

      const r2 = catalogService.saveCustomRecipe({
        name: 'Custom 2',
        description: 'Desc 2',
        servings: 1,
        nutrients: { calories: 100, carbs: 10, protein: 2, fat: 1, sodium: 10, fluids: 0 },
        ingredients: [{ name: 'Item 2', quantity: 1, unit: 'ea', department: 'Snacks/Candy' }]
      });

      expect(r1.id).toBeTruthy();
      expect(r2.id).toBeTruthy();
      expect(r1.id).not.toBe(r2.id);
    });

    it('3.2 should check what happens when a custom recipe is created with an ID matching a default recipe ID', () => {
      // Attempting to save custom recipe with id matching default 'tuna-sandwich'
      const colliding = catalogService.saveCustomRecipe({
        id: 'tuna-sandwich',
        name: 'Colliding Tuna Custom',
        description: 'Collides with default ID',
        servings: 1,
        nutrients: { calories: 500, carbs: 50, protein: 20, fat: 10, sodium: 200, fluids: 0 },
        ingredients: [{ name: 'Colliding Item', quantity: 1, unit: 'can', department: 'Canned/Protein' }]
      });

      const allTunas = catalogService.recipes().filter((r) => r.id === 'tuna-sandwich');
      // Must not create duplicate track keys or overwrite default recipe ID
      expect(allTunas.length).toBe(1);
      expect(colliding.id).not.toBe('tuna-sandwich');
      expect(colliding.id).toContain('tuna-sandwich');
    });

    it('3.3 should handle custom recipes with special characters, emojis, and HTML entities', () => {
      const specialRecipe = catalogService.saveCustomRecipe({
        name: '🔥 <script>alert("XSS")</script> & "Quotes" \'Ticks\'',
        description: 'Description with <img src=x onerror=alert(1)> and unicode 🚴‍♂️',
        servings: 1,
        nutrients: { calories: 250, carbs: 30, protein: 5, fat: 10, sodium: 100, fluids: 0 },
        ingredients: [
          { name: 'Special Item & <tag>', quantity: 1, unit: 'pouch', department: 'Snacks/Candy' }
        ]
      });

      expect(specialRecipe.name).toContain('<script>');
      const found = catalogService.recipes().find((r) => r.id === specialRecipe.id);
      expect(found).toBeDefined();
    });

    it('3.4 should handle missing ingredients array in saveCustomRecipe gracefully or throw', () => {
      let threw = false;
      let created: any = null;
      try {
        created = catalogService.saveCustomRecipe({
          name: 'Missing Ingredients Recipe',
          description: 'No ingredients provided',
          servings: 1,
          nutrients: { calories: 100, carbs: 10, protein: 2, fat: 1, sodium: 10, fluids: 0 }
        } as any);
      } catch (err) {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(created).toBeDefined();
      expect(created.ingredients).toEqual([]);
    });
  });

  // =========================================================================
  // 4. GROCERY LIST AGGREGATION EDGE CASES
  // =========================================================================
  describe('4. Grocery List Aggregation Edge Cases', () => {
    it('4.1 should NOT combine ingredients with identical names but different units', () => {
      const items: SelectedRecipeItem[] = [
        {
          recipe: {
            id: 'r1',
            name: 'R1',
            description: '',
            servings: 1,
            nutrients: { calories: 100, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [{ name: 'Peanut Butter', quantity: 2, unit: 'tbsp', department: 'Snacks/Candy' }]
          },
          quantity: 1,
          enabled: true
        },
        {
          recipe: {
            id: 'r2',
            name: 'R2',
            description: '',
            servings: 1,
            nutrients: { calories: 100, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [{ name: 'Peanut Butter', quantity: 1, unit: 'jar', department: 'Snacks/Candy' }]
          },
          quantity: 1,
          enabled: true
        },
        {
          recipe: {
            id: 'r3',
            name: 'R3',
            description: '',
            servings: 1,
            nutrients: { calories: 100, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [{ name: 'Peanut Butter', quantity: 100, unit: 'g', department: 'Snacks/Candy' }]
          },
          quantity: 1,
          enabled: true
        }
      ];

      const aggregated = shoppingListService.aggregateIngredients(items);
      // Must produce 3 distinct items, not combine them into 103 something
      expect(aggregated.length).toBe(3);

      const tbspItem = aggregated.find((i) => i.unit.toLowerCase() === 'tbsp');
      const jarItem = aggregated.find((i) => i.unit.toLowerCase() === 'jar');
      const gItem = aggregated.find((i) => i.unit.toLowerCase() === 'g');

      expect(tbspItem?.totalQuantity).toBe(2);
      expect(jarItem?.totalQuantity).toBe(1);
      expect(gItem?.totalQuantity).toBe(100);
    });

    it('4.2 should normalize casing variations and whitespace in ingredient names and units', () => {
      const items: SelectedRecipeItem[] = [
        {
          recipe: {
            id: 'r1',
            name: 'R1',
            description: '',
            servings: 1,
            nutrients: { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [{ name: '  Cheddar Cheese  ', quantity: 2, unit: ' SLICE ', department: 'Dairy' }]
          },
          quantity: 1,
          enabled: true
        },
        {
          recipe: {
            id: 'r2',
            name: 'R2',
            description: '',
            servings: 1,
            nutrients: { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [{ name: 'cheddar cheese', quantity: 3, unit: 'slice', department: 'Dairy' }]
          },
          quantity: 1,
          enabled: true
        }
      ];

      const aggregated = shoppingListService.aggregateIngredients(items);
      expect(aggregated.length).toBe(1);
      expect(aggregated[0].totalQuantity).toBe(5);
    });

    it('4.3 should handle empty selections and 0 quantities properly', () => {
      expect(shoppingListService.aggregateIngredients([])).toEqual([]);

      const zeroItems: SelectedRecipeItem[] = [
        {
          recipe: DEFAULT_RESUPPLY_RECIPES[0],
          quantity: 0,
          enabled: true
        },
        {
          recipe: DEFAULT_RESUPPLY_RECIPES[1],
          quantity: 5,
          enabled: false // disabled
        }
      ];

      expect(shoppingListService.aggregateIngredients(zeroItems)).toEqual([]);
    });

    it('4.4 should check what happens when ingredient has null or undefined unit', () => {
      const items: SelectedRecipeItem[] = [
        {
          recipe: {
            id: 'r1',
            name: 'R1',
            description: '',
            servings: 1,
            nutrients: { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [{ name: 'Salt', quantity: 1, unit: null as any, department: 'Snacks/Candy' }]
          },
          quantity: 1,
          enabled: true
        }
      ];

      let threw = false;
      let aggregated: any[] = [];
      try {
        aggregated = shoppingListService.aggregateIngredients(items);
      } catch (e) {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(aggregated.length).toBe(1);
      expect(aggregated[0].name).toBe('Salt');
      expect(aggregated[0].unit).toBe('');
    });
  });

  // =========================================================================
  // 5. FULFILLMENT PERCENTAGE EDGE CASES
  // =========================================================================
  describe('5. Fulfillment Percentage Edge Cases (target = 0, current = 0, extreme surplus)', () => {
    it('5.1 should handle current = 0 and target = 1000 cleanly', () => {
      const current = { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 };
      const targets = {
        baseCalories: 1000,
        safetyBufferCalories: 100,
        userAdjustmentCalories: 0,
        totalCaloriesTarget: 1100,
        carbsTargetGrams: 150,
        proteinTargetGrams: 40,
        fatTargetGrams: 35,
        sodiumTargetMg: 1000,
        potassiumTargetMg: 400,
        magnesiumTargetMg: 80,
        fluidsTargetMl: 1500
      };

      const fulfillment = physicsService.calculateFulfillment(current, targets);
      expect(fulfillment.calories.percentage).toBe(0);
      expect(fulfillment.protein.percentage).toBe(0);
      expect(fulfillment.fluids.percentage).toBe(0);
    });

    it('5.2 should test behavior when target = 0 and current = 0', () => {
      const current = { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 };
      const targets = {
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

      const fulfillment = physicsService.calculateFulfillment(current, targets);
      // When target is 0 and current is 0, percentage is 100%
      expect(fulfillment.calories.percentage).toBe(100);
      expect(fulfillment.fluids.percentage).toBe(100);
    });

    it('5.3 should test behavior when target = 0 and current > 0', () => {
      const current = { calories: 500, carbs: 50, protein: 20, fat: 10, sodium: 300, fluids: 500 };
      const targets = {
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

      const fulfillment = physicsService.calculateFulfillment(current, targets);
      // When target is 0, having packed food satisfies 100% of requirement (does not drop to 0%)
      expect(fulfillment.calories.percentage).toBe(100);
      expect(fulfillment.fluids.percentage).toBe(100);
    });

    it('5.4 should handle extreme surplus (> 1000%) without overflow or NaN', () => {
      const current = { calories: 50000, carbs: 6000, protein: 2000, fat: 1500, sodium: 50000, fluids: 30000 };
      const targets = {
        baseCalories: 500,
        safetyBufferCalories: 50,
        userAdjustmentCalories: 0,
        totalCaloriesTarget: 550,
        carbsTargetGrams: 75,
        proteinTargetGrams: 20,
        fatTargetGrams: 18,
        sodiumTargetMg: 500,
        potassiumTargetMg: 200,
        magnesiumTargetMg: 40,
        fluidsTargetMl: 500
      };

      const fulfillment = physicsService.calculateFulfillment(current, targets);
      expect(fulfillment.calories.percentage).toBeGreaterThan(1000);
      expect(Number.isFinite(fulfillment.calories.percentage)).toBe(true);
      expect(Number.isNaN(fulfillment.calories.percentage)).toBe(false);
    });
  });

  // =========================================================================
  // 6. PWA STANDALONE WARNING LOGIC
  // =========================================================================
  describe('6. PWA Standalone Warning Logic', () => {
    it('6.1 should toggle showPwaBanner based on isStandalone signal', () => {
      const fixture = TestBed.createComponent(ResupplyPlannerComponent);
      const component = fixture.componentInstance;
      fixture.componentRef.setInput('currentMile', 0);
      fixture.componentRef.setInput('unit', 'miles');
      fixture.detectChanges();

      // Browser mode: isStandalone = false -> showPwaBanner = true
      pwaInstall.setStandaloneForTesting(false);
      component.pwaBannerDismissed.set(false);
      expect(component.showPwaBanner()).toBe(true);

      // Standalone mode: isStandalone = true -> showPwaBanner = false
      pwaInstall.setStandaloneForTesting(true);
      expect(component.showPwaBanner()).toBe(false);

      // Return to browser mode but dismiss banner
      pwaInstall.setStandaloneForTesting(false);
      expect(component.showPwaBanner()).toBe(true);
      component.dismissPwaBanner();
      expect(component.showPwaBanner()).toBe(false);
    });
  });

  // =========================================================================
  // 7. HARDENED RESUPPLY ROBUSTNESS INVARIANTS (CHALLENGER 2 REMEDIATION)
  // =========================================================================
  describe('7. Hardened Resupply Robustness Invariants (Challenger 2 Remediation)', () => {
    it('7.1 should safely recover when customRecipes in storage is malformed or invalid array', () => {
      localStorage.setItem(
        RESUPPLY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          customRecipes: 'invalid-non-array-string'
        })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ResupplyCatalogService);

      expect(service.recipes().length).toBe(18);
      expect(service.recipes().every((r) => !r.isCustom)).toBe(true);
    });

    it('7.2 should safely sanitize custom recipes with missing ingredients array in storage', () => {
      localStorage.setItem(
        RESUPPLY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          customRecipes: [
            {
              id: 'custom-no-ingredients',
              name: 'No Ingredients Recipe',
              servings: 1,
              nutrients: { calories: 300, carbs: 40, protein: 10, fat: 5, sodium: 100, fluids: 0 }
            }
          ]
        })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const service = TestBed.inject(ResupplyCatalogService);

      const item = service.recipes().find((r) => r.id === 'custom-no-ingredients');
      expect(item).toBeDefined();
      expect(item?.ingredients).toEqual([]);
      expect(item?.nutrients.calories).toBe(300);
    });

    it('7.3 should generate unique ID on ID collision with default recipe and prevent duplicate keys', () => {
      const saved = catalogService.saveCustomRecipe({
        id: 'cheeseburger',
        name: 'My Custom Burger',
        description: 'Colliding ID attempt',
        servings: 1,
        nutrients: { calories: 600, carbs: 40, protein: 30, fat: 30, sodium: 800, fluids: 0 },
        ingredients: [{ name: 'Bun', quantity: 1, unit: 'whole', department: 'Bakery' }]
      });

      expect(saved.id).not.toBe('cheeseburger');
      expect(saved.id).toContain('cheeseburger');
      expect(saved.isCustom).toBe(true);

      const allBurgers = catalogService.recipes().filter((r) => r.id === 'cheeseburger');
      expect(allBurgers.length).toBe(1);
      expect(allBurgers[0].isCustom).toBe(false);

      const customInCatalog = catalogService.recipes().find((r) => r.id === saved.id);
      expect(customInCatalog).toBeDefined();
      expect(customInCatalog?.name).toBe('My Custom Burger');
    });

    it('7.4 should aggregate ingredients safely when unit, name, or department is null or undefined', () => {
      const items: SelectedRecipeItem[] = [
        {
          recipe: {
            id: 'r_null_props',
            name: 'Null Props Recipe',
            description: '',
            servings: 1,
            nutrients: { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 },
            ingredients: [
              { name: undefined as any, quantity: 2, unit: null as any, department: null as any },
              { name: '  Electrolyte Powder  ', quantity: 3, unit: undefined as any, department: 'Beverages' }
            ]
          },
          quantity: 2,
          enabled: true
        }
      ];

      const aggregated = shoppingListService.aggregateIngredients(items);
      expect(aggregated.length).toBe(2);

      const unnamed = aggregated.find((i) => i.id === '__');
      expect(unnamed).toBeDefined();
      expect(unnamed?.totalQuantity).toBe(4);
      expect(unnamed?.unit).toBe('');
      expect(unnamed?.department).toBe('Produce');

      const powder = aggregated.find((i) => i.name === 'Electrolyte Powder');
      expect(powder).toBeDefined();
      expect(powder?.totalQuantity).toBe(6);
      expect(powder?.unit).toBe('');
      expect(powder?.department).toBe('Beverages');
    });

    it('7.5 should return 100% fulfillment when target is 0 across zero and non-zero food intake', () => {
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

      const emptyIntake = { calories: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, fluids: 0 };
      const packedIntake = { calories: 1200, carbs: 150, protein: 45, fat: 30, sodium: 900, fluids: 1000 };

      const fZero = physicsService.calculateFulfillment(emptyIntake, zeroTargets);
      expect(fZero.calories.percentage).toBe(100);
      expect(fZero.fluids.percentage).toBe(100);

      const fPacked = physicsService.calculateFulfillment(packedIntake, zeroTargets);
      expect(fPacked.calories.percentage).toBe(100);
      expect(fPacked.carbs.percentage).toBe(100);
      expect(fPacked.protein.percentage).toBe(100);
      expect(fPacked.fat.percentage).toBe(100);
      expect(fPacked.sodium.percentage).toBe(100);
      expect(fPacked.fluids.percentage).toBe(100);
    });
  });
});
