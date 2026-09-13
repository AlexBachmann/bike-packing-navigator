import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ResupplyPlannerComponent } from './resupply-planner.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { ResupplyCatalogService } from '../../services/resupply-catalog.service';
import { ResupplyPhysicsService } from '../../services/resupply-physics.service';
import { ResupplyShoppingListService } from '../../services/resupply-shopping-list.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { ToastService } from '../../services/toast.service';
import { Place } from '../../models/waypoint.model';

describe('ResupplyPlannerComponent', () => {
  let component: ResupplyPlannerComponent;
  let fixture: ComponentFixture<ResupplyPlannerComponent>;
  let routeService: RouteDataService;
  let settingsService: SettingsService;
  let catalogService: ResupplyCatalogService;
  let physicsService: ResupplyPhysicsService;
  let shoppingListService: ResupplyShoppingListService;
  let pwaInstall: PwaInstallService;
  let toastService: ToastService;

  const mockPlaces: Place[] = [
    {
      id: 'p0-close',
      name: 'Banff Corner Store (Too Close)',
      category: 'grocery',
      type: 'convenience_store',
      town: 'Banff',
      is_in_town: true,
      location: { lat: 51.178, lon: -115.57 },
      distance_to_trail_km: 0.1,
      route_km: 4.0,
      route_mile: 2.5
    },
    {
      id: 'p1',
      name: 'Canmore IGA Supermarket',
      category: 'grocery',
      type: 'supermarket',
      town: 'Canmore',
      is_in_town: true,
      location: { lat: 51.09, lon: -115.35 },
      distance_to_trail_km: 0.2,
      route_km: 25.0,
      route_mile: 15.5
    },
    {
      id: 'p2',
      name: 'Mount Shark Trailhead Campground',
      category: 'campground',
      type: 'campground',
      is_in_town: false,
      location: { lat: 50.85, lon: -115.38 },
      distance_to_trail_km: 0.0,
      route_km: 56.3,
      route_mile: 35.0
    },
    {
      id: 'p3',
      name: 'Sparwood Esso & Convenience',
      category: 'gas_station',
      type: 'gas_station',
      town: 'Sparwood',
      is_in_town: true,
      location: { lat: 49.73, lon: -114.88 },
      distance_to_trail_km: 0.5,
      route_km: 193.1,
      route_mile: 120.0
    },
    {
      id: 'p4',
      name: 'Eureka Resupply Hub',
      category: 'town',
      type: 'town',
      town: 'Eureka',
      is_in_town: true,
      location: { lat: 48.88, lon: -115.05 },
      distance_to_trail_km: 0.1,
      route_km: 370.1,
      route_mile: 230.0
    }
  ];

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

    routeService = TestBed.inject(RouteDataService);
    settingsService = TestBed.inject(SettingsService);
    catalogService = TestBed.inject(ResupplyCatalogService);
    physicsService = TestBed.inject(ResupplyPhysicsService);
    shoppingListService = TestBed.inject(ResupplyShoppingListService);
    pwaInstall = TestBed.inject(PwaInstallService);
    toastService = TestBed.inject(ToastService);

    routeService.places.set(mockPlaces);
    settingsService.setPower(160);
    settingsService.distanceUnit.set('miles');

    fixture = TestBed.createComponent(ResupplyPlannerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentMile', 0);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initialization & View Modes', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize with default states and views', () => {
      expect(component.activeView()).toBe('builder');
      expect(component.distanceSelectionMode()).toBe('stops');
      expect(component.targetDistance()).toBe(50);
      expect(component.dailyRidingPercent()).toBe(60);
      expect(component.targetSleepHours()).toBe(6.0);
    });

    it('should switch between Resupply Plan and Shopping List views', () => {
      expect(component.activeView()).toBe('builder');
      component.activeView.set('shopping-list');
      expect(component.activeView()).toBe('shopping-list');
      component.activeView.set('builder');
      expect(component.activeView()).toBe('builder');
    });
  });

  describe('Target Distance Selection (R1)', () => {
    it('should filter upcoming stops further away than 10 km and match resupply categories', () => {
      // At mile 0: should exclude p0-close (2.5 mi = 4 km <= 10 km), exclude p2 (campground)
      // and include p1 (grocery, mi 15.5 = 24.9 km > 10 km), p3 (gas_station, mi 120), p4 (town, mi 230)
      const stops = component.upcomingStops();
      expect(stops.length).toBe(3);
      expect(stops.find((s) => s.id === 'p0-close')).toBeUndefined();
      expect(stops[0].name).toBe('Canmore IGA Supermarket');
      expect(stops[0].badgeIcon).toBe('🛒');
      expect(stops[1].name).toBe('Sparwood Esso & Convenience');
      expect(stops[1].badgeIcon).toBe('⛽');
      expect(stops[2].name).toBe('Eureka Resupply Hub');
      expect(stops[2].badgeIcon).toBe('🏘️');
    });

    it('should exclude stops behind currentMile or within 10 km of current location', () => {
      fixture.componentRef.setInput('currentMile', 10.0);
      fixture.detectChanges();

      const stops = component.upcomingStops();
      // Canmore IGA (mi 15.5) is now (15.5 - 10.0) * 1.60934 = 8.85 km <= 10 km away, so excluded
      expect(stops.length).toBe(2);
      expect(stops.find((s) => s.id === 'p1')).toBeUndefined();
      expect(stops[0].name).toBe('Sparwood Esso & Convenience');
      expect(stops[1].name).toBe('Eureka Resupply Hub');
    });

    it('should compute distance ahead in active units (miles vs km)', () => {
      fixture.componentRef.setInput('currentMile', 0);
      fixture.componentRef.setInput('unit', 'miles');
      fixture.detectChanges();

      let stops = component.upcomingStops();
      expect(stops[0].distAhead).toBe(15.5);

      // Switch to km
      fixture.componentRef.setInput('unit', 'km');
      fixture.detectChanges();

      stops = component.upcomingStops();
      expect(stops[0].distAhead).toBeCloseTo(24.9, 0);
    });

    it('should populate target distance when selecting an upcoming stop', () => {
      const stops = component.upcomingStops();
      component.selectStop(stops[0]);

      expect(component.selectedStopId()).toBe(stops[0].id);
      expect(component.targetDistance()).toBe(stops[0].distAhead);
    });

    it('should handle custom distance input, presets, and steppers', () => {
      component.distanceSelectionMode.set('custom');

      // Test preset chips
      const presets = component.distancePresets();
      expect(presets).toEqual([25, 50, 75, 100, 150]);

      component.setCustomDistance(75);
      expect(component.targetDistance()).toBe(75);
      expect(component.selectedStopId()).toBeNull();

      // Test steppers
      component.adjustDistance(5);
      expect(component.targetDistance()).toBe(80);
      component.adjustDistance(-10);
      expect(component.targetDistance()).toBe(70);

      // Test manual input change
      component.onCustomDistanceInputChange(115);
      expect(component.targetDistance()).toBe(115);
    });

    it('should provide metric preset chips when unit is km', () => {
      fixture.componentRef.setInput('unit', 'km');
      fixture.detectChanges();

      expect(component.distancePresets()).toEqual([40, 80, 120, 160, 240]);
    });
  });

  describe('Physiological & Day Schedule Controls (R2)', () => {
    it('should display rider power and loaded rig mass', () => {
      expect(component.settings.riderPowerWatts()).toBe(160);
      expect(component.settings.totalSystemMassKg()).toBeGreaterThan(50);
    });

    it('should update daily riding percent and target sleep hours', () => {
      component.onRidingPercentChange(70);
      expect(component.dailyRidingPercent()).toBe(70);

      component.onSleepHoursChange(7.5);
      expect(component.targetSleepHours()).toBe(7.5);
    });

    it('should simulate forward day schedule timeline and sleep triggers', () => {
      component.setCustomDistance(150); // 150 miles push
      const summary = component.dayScheduleSummary();

      expect(summary.ridingHours).toBeGreaterThan(5);
      expect(summary.daytimeOffBikeHours).toBeGreaterThanOrEqual(0);
      expect(summary.totalElapsedHours).toBeGreaterThan(summary.ridingHours);
    });

    it('should compute caloric targets with default 0% safety buffer and +/- 5% stepping', () => {
      component.setCustomDistance(60);
      const targets = component.nutrientTargets();

      expect(targets.baseCalories).toBeGreaterThan(500);
      expect(targets.safetyBufferPercent).toBe(0);
      expect(targets.safetyBufferCalories).toBe(0);
      expect(targets.totalCaloriesTarget).toBe(targets.baseCalories);

      // Interactive safety buffer percent adjustment (+5%)
      component.adjustBufferPercent(5);
      const adjustedTargets = component.nutrientTargets();
      expect(adjustedTargets.safetyBufferPercent).toBe(5);
      expect(adjustedTargets.safetyBufferCalories).toBe(Math.round(targets.baseCalories * 0.05));
      expect(adjustedTargets.totalCaloriesTarget).toBe(targets.baseCalories + Math.round(targets.baseCalories * 0.05));

      // Step -10% (resulting in -5% deficit buffer)
      component.adjustBufferPercent(-10);
      const decTargets = component.nutrientTargets();
      expect(decTargets.safetyBufferPercent).toBe(-5);
      expect(decTargets.safetyBufferCalories).toBe(Math.round(targets.baseCalories * -0.05));
      expect(decTargets.totalCaloriesTarget).toBe(targets.baseCalories + Math.round(targets.baseCalories * -0.05));
    });

    it('should calculate multi-nutrient target breakdown', () => {
      component.setCustomDistance(50);
      const targets = component.nutrientTargets();

      expect(targets.carbsTargetGrams).toBeGreaterThan(50);
      expect(targets.proteinTargetGrams).toBeGreaterThan(15);
      expect(targets.fatTargetGrams).toBeGreaterThan(15);
      expect(targets.sodiumTargetMg).toBeGreaterThan(500);
      expect(targets.potassiumTargetMg).toBeGreaterThan(200);
      expect(targets.magnesiumTargetMg).toBeGreaterThan(40);
      expect(targets.fluidsTargetMl).toBeGreaterThan(500);
    });
  });

  describe('Real-Time Nutritional Fulfillment Gauges (R4)', () => {
    it('should calculate real-time fulfillment percentages against targets', () => {
      component.setCustomDistance(50);
      const initialFulfillment = component.fulfillment();
      expect(initialFulfillment.calories.current).toBe(0);
      expect(initialFulfillment.calories.percentage).toBe(0);

      // Enable a recipe: Tuna Sandwich (420 kcal)
      const tuna = catalogService.recipes().find((r) => r.name.includes('Tuna Sandwich'));
      expect(tuna).toBeDefined();

      catalogService.setQuantity(tuna!.id, 2); // 2 x 350 = 700 kcal
      fixture.detectChanges();

      const updatedFulfillment = component.fulfillment();
      expect(updatedFulfillment.calories.current).toBe(700);
      expect(updatedFulfillment.calories.percentage).toBeGreaterThan(0);
      expect(updatedFulfillment.protein.current).toBeGreaterThan(0);
    });

    it('should support surplus fulfillment beyond 100%', () => {
      component.setCustomDistance(10); // Very short 10 mile push
      const pringles = catalogService.recipes().find((r) => r.name.includes('Pringles'));
      expect(pringles).toBeDefined();

      // Set extreme quantity to guarantee > 100%
      catalogService.setQuantity(pringles!.id, 10);
      fixture.detectChanges();

      const fulfillment = component.fulfillment();
      expect(fulfillment.calories.percentage).toBeGreaterThan(100);
    });
  });

  describe('Recipe Selection & Custom Editing (R3)', () => {
    it('should load all 16 default recipes in the catalog', () => {
      const recipes = catalogService.recipes();
      expect(recipes.length).toBeGreaterThanOrEqual(16);
      expect(recipes.some((r) => r.name === 'Tuna Sandwich')).toBe(true);
      expect(recipes.some((r) => r.name.includes('Pringles'))).toBe(true);
      expect(recipes.some((r) => r.name.includes('Gatorade'))).toBe(true);
    });

    it('should model fast-food items (Cheeseburger, Subway Sub) as single ready-to-eat Prepared/Deli items', () => {
      const burger = catalogService.recipes().find((r) => r.id === 'cheeseburger')!;
      expect(burger.ingredients.length).toBe(1);
      expect(burger.ingredients[0].department).toBe('Prepared/Deli');
      expect(burger.ingredients[0].name).toContain('Cheeseburger');

      const sub = catalogService.recipes().find((r) => r.id === 'half-subway-sub')!;
      expect(sub.ingredients.length).toBe(1);
      expect(sub.ingredients[0].department).toBe('Prepared/Deli');
      expect(sub.ingredients[0].name).toContain('Subway');

      const fries = catalogService.recipes().find((r) => r.id === 'large-fries')!;
      expect(fries).toBeDefined();
      expect(fries.ingredients.length).toBe(1);
      expect(fries.ingredients[0].department).toBe('Prepared/Deli');
      expect(fries.nutrients.calories).toBe(490);
    });

    it('should toggle favorite recipes and prioritize favorites at the top of the list', () => {
      expect(component.isFavorite('cheeseburger')).toBe(false);
      expect(component.favoriteCount()).toBe(0);

      // Mark cheeseburger as favorite
      component.toggleFavorite('cheeseburger');
      expect(component.isFavorite('cheeseburger')).toBe(true);
      expect(component.favoriteCount()).toBe(1);

      // Verify favorites are sorted to the top
      const allFiltered = component.filteredRecipes();
      expect(allFiltered[0].id).toBe('cheeseburger');

      // Test favorite filter
      component.recipeFilter.set('favorite');
      const favoritesOnly = component.filteredRecipes();
      expect(favoritesOnly.length).toBe(1);
      expect(favoritesOnly[0].id).toBe('cheeseburger');

      // Toggle off
      component.toggleFavorite('cheeseburger');
      expect(component.isFavorite('cheeseburger')).toBe(false);
      expect(component.favoriteCount()).toBe(0);
    });

    it('should toggle recipe selection and adjust quantities', () => {
      const pizza = catalogService.recipes().find((r) => r.name.includes('Pizza'))!;
      expect(component.getRecipeQuantity(pizza.id)).toBe(0);
      expect(component.isRecipeEnabled(pizza.id)).toBe(false);

      // Toggle ON
      component.toggleRecipe(pizza.id);
      expect(component.getRecipeQuantity(pizza.id)).toBe(1);
      expect(component.isRecipeEnabled(pizza.id)).toBe(true);

      // Increase quantity
      component.adjustRecipeQuantity(pizza.id, 1);
      expect(component.getRecipeQuantity(pizza.id)).toBe(2);

      // Decrease quantity
      component.adjustRecipeQuantity(pizza.id, -1);
      expect(component.getRecipeQuantity(pizza.id)).toBe(1);

      // Toggle OFF
      component.toggleRecipe(pizza.id);
      expect(component.isRecipeEnabled(pizza.id)).toBe(false);
    });

    it('should filter recipes by category and search query', () => {
      component.recipeFilter.set('snack');
      const snacks = component.filteredRecipes();
      expect(snacks.length).toBeGreaterThan(0);
      expect(snacks.every((r) => r.category === 'snack')).toBe(true);

      component.recipeFilter.set('all');
      component.recipeSearch.set('Subway');
      const filtered = component.filteredRecipes();
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toContain('Subway');
    });

    it('should allow editing a recipe and detect modified default', () => {
      const sub = catalogService.recipes().find((r) => r.name.includes('Subway'))!;
      expect(component.isModifiedDefault(sub)).toBe(false);

      component.openEditModal(sub);
      expect(component.showEditModal()).toBe(true);
      expect(component.formName()).toBe(sub.name);

      // Modify calories and save
      component.formCalories.set(800);
      component.saveEditedRecipe();
      expect(component.showEditModal()).toBe(false);

      const updatedSub = catalogService.recipes().find((r) => r.id === sub.id)!;
      expect(updatedSub.nutrients.calories).toBe(800);
      expect(component.isModifiedDefault(updatedSub)).toBe(true);

      // Reset to default
      component.resetRecipeToDefault(sub.id);
      const resetSub = catalogService.recipes().find((r) => r.id === sub.id)!;
      expect(resetSub.nutrients.calories).toBe(sub.nutrients.calories);
      expect(component.isModifiedDefault(resetSub)).toBe(false);
    });

    it('should allow editing recipe ingredients, adding items, removing items, and reflect in shopping list', () => {
      const tuna = catalogService.recipes().find((r) => r.id === 'tuna-sandwich')!;
      catalogService.setQuantity(tuna.id, 1);
      component.openEditModal(tuna);
      fixture.detectChanges();

      expect(component.showEditModal()).toBe(true);
      const compiled = fixture.nativeElement as HTMLElement;
      const ingRows = compiled.querySelectorAll('[data-testid="edit-ingredient-row"]');
      expect(ingRows.length).toBe(tuna.ingredients.length);

      // Add a new ingredient via addFormIngredient
      component.addFormIngredient();
      fixture.detectChanges();
      expect(component.formIngredients().length).toBe(tuna.ingredients.length + 1);

      // Edit the newly added ingredient
      const lastIndex = component.formIngredients().length - 1;
      component.formIngredients.update((list) => {
        const copy = [...list];
        copy[lastIndex] = {
          name: 'Extra Mustard Packet',
          quantity: 2,
          unit: 'packet',
          department: 'Prepared/Deli'
        };
        return copy;
      });

      // Modify the first ingredient
      component.formIngredients.update((list) => {
        const copy = [...list];
        copy[0] = { ...copy[0], name: 'Artisan Sourdough Roll', quantity: 2 };
        return copy;
      });

      // Remove the second ingredient (tuna pouch)
      component.removeFormIngredient(1);
      fixture.detectChanges();

      // Save edited recipe
      component.saveEditedRecipe();
      fixture.detectChanges();
      expect(component.showEditModal()).toBe(false);

      // Verify the updated recipe in catalog
      const updatedTuna = catalogService.recipes().find((r) => r.id === tuna.id)!;
      expect(updatedTuna.ingredients.some((i) => i.name === 'Artisan Sourdough Roll' && i.quantity === 2)).toBe(true);
      expect(updatedTuna.ingredients.some((i) => i.name === 'Extra Mustard Packet' && i.quantity === 2)).toBe(true);

      // Verify shopping list reflects the edited ingredients
      component.activeView.set('shopping-list');
      fixture.detectChanges();
      const shoppingItems = component.aggregatedGroceryItems();
      expect(shoppingItems.some((i) => i.name.includes('Artisan Sourdough Roll'))).toBe(true);
      expect(shoppingItems.some((i) => i.name.includes('Extra Mustard Packet'))).toBe(true);
    });

    it('should allow adding a custom recipe across 7 departments and deleting it', () => {
      component.openAddModal();
      expect(component.showAddModal()).toBe(true);

      component.formName.set('High-Country Pemmican');
      component.formDescription.set('Dried bison, tallow, berries');
      component.formCategory.set('snack');
      component.formCalories.set(650);
      component.formIngredients.set([
        { name: 'Beef Jerky', quantity: 100, unit: 'g', department: 'Canned/Protein' },
        { name: 'Dried Cranberries', quantity: 50, unit: 'g', department: 'Produce' }
      ]);

      component.saveNewCustomRecipe();
      expect(component.showAddModal()).toBe(false);

      const custom = catalogService.recipes().find((r) => r.name === 'High-Country Pemmican');
      expect(custom).toBeDefined();
      expect(custom!.isCustom).toBe(true);
      expect(custom!.nutrients.calories).toBe(650);

      // Delete custom recipe
      component.deleteCustomRecipe(custom!.id);
      expect(catalogService.recipes().some((r) => r.name === 'High-Country Pemmican')).toBe(false);
    });

    it('should handle catalog Reset All confirmation', () => {
      component.openResetAllModal();
      expect(component.showResetConfirmModal()).toBe(true);

      component.cancelResetAll();
      expect(component.showResetConfirmModal()).toBe(false);

      component.openResetAllModal();
      component.confirmResetAll();
      expect(component.showResetConfirmModal()).toBe(false);
      expect(catalogService.userCalorieAdjustment()).toBe(0);
    });

    it('should mark recipe as deleted so it does not show up in the list anymore', () => {
      const initialCount = component.filteredRecipes().length;
      const tuna = catalogService.recipes().find((r) => r.name === 'Tuna Sandwich')!;
      expect(tuna).toBeDefined();

      const toastSpy = vi.spyOn(toastService, 'showSuccess');
      component.deleteRecipe(tuna.id);

      expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('deleted from list'));
      expect(catalogService.recipes().some((r) => r.id === tuna.id)).toBe(false);
      expect(component.filteredRecipes().some((r) => r.id === tuna.id)).toBe(false);
      expect(component.filteredRecipes().length).toBe(initialCount - 1);
    });

    it('should reset toggles and quantities to zero for selected category filter', () => {
      // Set quantities for meal and snack
      const meal = catalogService.recipes().find((r) => r.category === 'meal')!;
      const snack = catalogService.recipes().find((r) => r.category === 'snack')!;

      component.adjustRecipeQuantity(meal.id, 2);
      component.adjustRecipeQuantity(snack.id, 3);

      expect(component.getRecipeQuantity(meal.id)).toBe(2);
      expect(component.getRecipeQuantity(snack.id)).toBe(3);

      // Filter to meals and reset
      component.recipeFilter.set('meal');
      component.openResetModal();
      expect(component.showResetConfirmModal()).toBe(true);

      component.confirmReset();
      expect(component.showResetConfirmModal()).toBe(false);

      // Meal should be 0, snack should remain 3
      expect(component.getRecipeQuantity(meal.id)).toBe(0);
      expect(component.isRecipeEnabled(meal.id)).toBe(false);
      expect(component.getRecipeQuantity(snack.id)).toBe(3);
      expect(component.isRecipeEnabled(snack.id)).toBe(true);

      // Filter all and reset
      component.recipeFilter.set('all');
      component.confirmReset();
      expect(component.getRecipeQuantity(snack.id)).toBe(0);
      expect(component.isRecipeEnabled(snack.id)).toBe(false);
    });

    it('should prompt for confirmation before deleting a recipe and handle cancel/confirm', () => {
      const tuna = catalogService.recipes().find((r) => r.name === 'Tuna Sandwich')!;
      expect(tuna).toBeDefined();

      // Trigger delete prompt
      component.promptDeleteRecipe(tuna);
      expect(component.showDeleteConfirmModal()).toBe(true);
      expect(component.recipeToDelete()?.id).toBe(tuna.id);

      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Delete Recipe?');
      expect(compiled.textContent).toContain('Tuna Sandwich');

      // Cancel deletion
      component.cancelDeleteModal();
      expect(component.showDeleteConfirmModal()).toBe(false);
      expect(component.recipeToDelete()).toBeNull();
      expect(catalogService.recipes().some((r) => r.id === tuna.id)).toBe(true);

      // Re-prompt and confirm deletion
      component.promptDeleteRecipe(tuna);
      const toastSpy = vi.spyOn(toastService, 'showSuccess');
      component.confirmDeleteRecipe();

      expect(component.showDeleteConfirmModal()).toBe(false);
      expect(component.recipeToDelete()).toBeNull();
      expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('deleted from list'));
      expect(catalogService.recipes().some((r) => r.id === tuna.id)).toBe(false);
      expect(component.filteredRecipes().some((r) => r.id === tuna.id)).toBe(false);
    });

    it('should not render switch toggle buttons next to recipes (quantity is the sole toggle)', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      // No role="switch" buttons should exist in the recipe list
      const switches = compiled.querySelectorAll('[role="switch"]');
      expect(switches.length).toBe(0);

      // Quantity stepper alone drives active state:
      const pizza = catalogService.recipes().find((r) => r.name.includes('Pizza'))!;
      expect(component.getRecipeQuantity(pizza.id)).toBe(0);

      // Stepping up to 1 activates the recipe
      component.adjustRecipeQuantity(pizza.id, 1);
      expect(component.getRecipeQuantity(pizza.id)).toBe(1);
      expect(component.isRecipeEnabled(pizza.id)).toBe(true);

      // Stepping down to 0 deactivates the recipe
      component.adjustRecipeQuantity(pizza.id, -1);
      expect(component.getRecipeQuantity(pizza.id)).toBe(0);
      expect(component.isRecipeEnabled(pizza.id)).toBe(false);
    });

    it('should render "+ Add Recipe", "Reset", and "Delete" buttons in the DOM', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(compiled.querySelectorAll('button'));

      // Header buttons
      const addRecipeBtn = buttons.find((b) => b.textContent?.includes('Add Recipe'));
      expect(addRecipeBtn).toBeDefined();
      expect(addRecipeBtn?.textContent).toContain('+');
      expect(addRecipeBtn?.textContent).toContain('Add Recipe');

      const resetBtn = buttons.find((b) => b.textContent?.trim() === 'Reset');
      expect(resetBtn).toBeDefined();

      // Recipe card actions: Edit and Delete
      const deleteButtons = buttons.filter((b) => b.textContent?.trim() === 'Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);

      const editButtons = buttons.filter((b) => b.textContent?.trim() === 'Edit');
      expect(editButtons.length).toBeGreaterThan(0);
    });
  });

  describe('PWA Standalone Warning Banner (R3)', () => {
    it('should show PWA warning banner if running in browser mode', () => {
      pwaInstall.setStandaloneForTesting(false);
      component.pwaBannerDismissed.set(false);
      fixture.detectChanges();

      expect(component.showPwaBanner()).toBe(true);
    });

    it('should hide banner when dismissed', () => {
      pwaInstall.setStandaloneForTesting(false);
      component.dismissPwaBanner();
      expect(component.showPwaBanner()).toBe(false);
    });

    it('should trigger install prompt when clicking install', () => {
      const promptSpy = vi.spyOn(pwaInstall, 'promptInstall').mockResolvedValue('accepted');
      component.triggerPwaInstall();
      expect(promptSpy).toHaveBeenCalled();
      promptSpy.mockRestore();
    });

    it('should not show banner if running in standalone PWA mode', () => {
      pwaInstall.setStandaloneForTesting(true);
      expect(component.showPwaBanner()).toBe(false);
    });
  });

  describe('Actionable Grocery Shopping List View (R4)', () => {
    beforeEach(() => {
      catalogService.resetAllToDefault();

      // Enable Tuna Sandwich and Pringles
      const tuna = catalogService.recipes().find((r) => r.name === 'Tuna Sandwich')!;
      const pringles = catalogService.recipes().find((r) => r.name.includes('Pringles'))!;

      catalogService.setQuantity(tuna.id, 2);
      catalogService.setQuantity(pringles.id, 1);
      fixture.detectChanges();
    });

    it('should aggregate ingredients across selected recipes and organize by department', () => {
      component.activeView.set('shopping-list');
      const groups = component.departmentGroups();

      expect(groups.length).toBeGreaterThan(0);
      expect(component.totalGroceryItemsCount()).toBeGreaterThan(0);

      // Canned/Protein department should include Tuna
      const cannedGroup = groups.find((g) => g.department === 'Canned/Protein');
      expect(cannedGroup).toBeDefined();
      expect(cannedGroup!.items.some((i) => i.name.includes('Tuna'))).toBe(true);

      // Bakery department should include Bread
      const bakeryGroup = groups.find((g) => g.department === 'Bakery');
      expect(bakeryGroup).toBeDefined();
      expect(bakeryGroup!.items.some((i) => i.name.includes('Bread'))).toBe(true);
    });

    it('should support interactive item check-off in store aisles', () => {
      const items = component.aggregatedGroceryItems();
      const firstId = items[0].id;

      expect(component.checkedItemIds().has(firstId)).toBe(false);
      component.toggleItemChecked(firstId);
      expect(component.checkedItemIds().has(firstId)).toBe(true);

      component.uncheckAllItems();
      expect(component.checkedItemIds().size).toBe(0);
    });

    it('should format and copy plain text shopping list to clipboard', async () => {
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextSpy
        }
      });
      const toastSpy = vi.spyOn(toastService, 'showSuccess');

      await component.copyShoppingList();
      expect(writeTextSpy).toHaveBeenCalled();
      expect(toastSpy).toHaveBeenCalledWith('Shopping list copied to clipboard!');
    });

    it('should display friendly empty state when no items are selected in shopping list', () => {
      catalogService.resetAllToDefault();
      component.activeView.set('shopping-list');
      fixture.detectChanges();

      expect(component.departmentGroups().length).toBe(0);
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('No items in your shopping list yet');
    });
  });

  describe('Sticky Miniature Nutritional Fulfillment Bar', () => {
    it('should render the sticky miniature fulfillment bar on top of the recipe catalog', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const miniBar = compiled.querySelector('[data-testid="sticky-mini-fulfillment"]');
      expect(miniBar).toBeTruthy();
      expect(miniBar?.classList.contains('sticky')).toBe(true);

      const caloriesGauge = compiled.querySelector('[data-testid="mini-gauge-calories"]');
      const proteinGauge = compiled.querySelector('[data-testid="mini-gauge-protein"]');
      const fatGauge = compiled.querySelector('[data-testid="mini-gauge-fat"]');
      const sodiumGauge = compiled.querySelector('[data-testid="mini-gauge-sodium"]');
      const fluidsGauge = compiled.querySelector('[data-testid="mini-gauge-fluids"]');

      expect(caloriesGauge).toBeTruthy();
      expect(proteinGauge).toBeTruthy();
      expect(fatGauge).toBeTruthy();
      expect(sodiumGauge).toBeTruthy();
      expect(fluidsGauge).toBeTruthy();
    });

    it('should dynamically update miniature fulfillment percentages and checkmarks as recipes change', () => {
      catalogService.resetAllToDefault();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const caloriesGauge = compiled.querySelector('[data-testid="mini-gauge-calories"]') as HTMLElement;
      expect(caloriesGauge.textContent).toContain('0%');

      // Add 20 burritos (each 380 kcal, 14g fat, 16g prot, 780mg Na)
      catalogService.setQuantity('breakfast-burrito', 20);
      fixture.detectChanges();

      expect(component.fulfillment().sodium.percentage).toBeGreaterThanOrEqual(100);
      const sodiumGauge = compiled.querySelector('[data-testid="mini-gauge-sodium"]') as HTMLElement;
      expect(sodiumGauge.textContent).toContain('✓');
    });
  });
});
