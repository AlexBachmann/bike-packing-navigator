import { TestBed } from '@angular/core/testing';
import { DEFAULT_RESUPPLY_RECIPES } from '../data/resupply-recipes.data';
import { AggregatedGroceryItem, SelectedRecipeItem } from '../models/resupply.model';
import {
  DEPARTMENT_ORDER,
  ResupplyShoppingListService
} from './resupply-shopping-list.service';

describe('ResupplyShoppingListService', () => {
  let service: ResupplyShoppingListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ResupplyShoppingListService);
  });

  describe('Ingredient Aggregation', () => {
    it('should return empty list when no recipes are selected or enabled', () => {
      expect(service.aggregateIngredients([])).toEqual([]);

      const inactiveItems: SelectedRecipeItem[] = [
        { recipe: DEFAULT_RESUPPLY_RECIPES[0], quantity: 0, enabled: false },
        { recipe: DEFAULT_RESUPPLY_RECIPES[1], quantity: 2, enabled: false },
        { recipe: DEFAULT_RESUPPLY_RECIPES[2], quantity: 0, enabled: true }
      ];
      expect(service.aggregateIngredients(inactiveItems)).toEqual([]);
    });

    it('should scale ingredient quantities according to recipe quantity', () => {
      // Tuna sandwich: 2 slices Bread, 1 pouch Tuna, 1 mayo packet
      const tunaRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')!;
      const selected: SelectedRecipeItem[] = [
        { recipe: tunaRecipe, quantity: 3, enabled: true }
      ];

      const aggregated = service.aggregateIngredients(selected);
      expect(aggregated.length).toBe(3);

      const bread = aggregated.find((i) => i.name.toLowerCase().includes('bread'));
      expect(bread?.totalQuantity).toBe(6); // 3 * 2
      expect(bread?.unit).toBe('slices');
      expect(bread?.department).toBe('Bakery');

      const tuna = aggregated.find((i) => i.name.toLowerCase().includes('tuna'));
      expect(tuna?.totalQuantity).toBe(3); // 3 * 1
      expect(tuna?.department).toBe('Canned/Protein');
    });

    it('should aggregate duplicate ingredients across different recipes', () => {
      // Tuna Sandwich (2 slices Bread, 1 pouch Tuna)
      const tunaRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'tuna-sandwich')!;
      // Avocado Sandwich (2 slices Bread, 1 avocado)
      const avocadoRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'avocado-sandwich')!;
      // Trail Pad Thai (1 pouch Tuna, 1 instant ramen, 2 tbsp peanut butter)
      const ramenRecipe = DEFAULT_RESUPPLY_RECIPES.find((r) => r.id === 'trail-pad-thai')!;

      const selected: SelectedRecipeItem[] = [
        { recipe: tunaRecipe, quantity: 2, enabled: true },
        { recipe: avocadoRecipe, quantity: 1, enabled: true },
        { recipe: ramenRecipe, quantity: 2, enabled: true }
      ];

      const aggregated = service.aggregateIngredients(selected);

      // Bread: 2*2 (tuna) + 1*2 (avocado) = 6 slices
      const bread = aggregated.find((i) => i.name === 'Bread');
      expect(bread?.totalQuantity).toBe(6);

      // Tuna pouch: 2*1 (tuna) + 2*1 (ramen) = 4 pouches
      const tuna = aggregated.find((i) => i.name === 'Tuna pouch (85g)');
      expect(tuna?.totalQuantity).toBe(4);

      // Avocado: 1 whole
      const avocado = aggregated.find((i) => i.name === 'Avocado');
      expect(avocado?.totalQuantity).toBe(1);

      // Instant ramen: 2 packs
      const ramen = aggregated.find((i) => i.name === 'Instant ramen (85g)');
      expect(ramen?.totalQuantity).toBe(2);

      // Peanut butter: 2*2 = 4 tbsp
      const pb = aggregated.find((i) => i.name === 'Peanut butter (32g)');
      expect(pb?.totalQuantity).toBe(4);
    });
  });

  describe('Department Grouping', () => {
    it('should return empty list when given no aggregated items', () => {
      expect(service.groupByDepartment([])).toEqual([]);
    });

    it('should group items by 7 grocery departments in retail aisle order', () => {
      const sampleItems: AggregatedGroceryItem[] = [
        { id: '1', name: 'Whole Avocado', totalQuantity: 2, unit: 'whole', department: 'Produce' },
        { id: '2', name: 'Bread', totalQuantity: 4, unit: 'slices', department: 'Bakery' },
        { id: '3', name: 'Tuna Pouch', totalQuantity: 3, unit: 'pouch', department: 'Canned/Protein' },
        { id: '4', name: 'Snickers Bar', totalQuantity: 2, unit: 'bar', department: 'Snacks/Candy' },
        { id: '5', name: 'Water Bottle', totalQuantity: 2, unit: 'bottle', department: 'Beverages' },
        { id: '6', name: 'Cheddar Cheese', totalQuantity: 2, unit: 'slice', department: 'Dairy' },
        { id: '7', name: 'Pizza Slice', totalQuantity: 1, unit: 'slice', department: 'Prepared/Deli' }
      ];

      const groups = service.groupByDepartment(sampleItems);
      expect(groups.length).toBe(7);

      const deptNames = groups.map((g) => g.department);
      expect(deptNames).toEqual([...DEPARTMENT_ORDER]);
    });

    it('should omit empty departments and sort items alphabetically within each department', () => {
      const sampleItems: AggregatedGroceryItem[] = [
        { id: '1', name: 'Tortilla', totalQuantity: 2, unit: 'pieces', department: 'Bakery' },
        { id: '2', name: 'Bread', totalQuantity: 4, unit: 'slices', department: 'Bakery' },
        { id: '3', name: 'Gatorade', totalQuantity: 1, unit: 'bottle', department: 'Beverages' }
      ];

      const groups = service.groupByDepartment(sampleItems);
      expect(groups.length).toBe(2); // Only Bakery and Beverages
      expect(groups[0].department).toBe('Bakery');
      expect(groups[1].department).toBe('Beverages');

      // Bakery items sorted alphabetically: Bread before Tortilla
      expect(groups[0].items[0].name).toBe('Bread');
      expect(groups[0].items[1].name).toBe('Tortilla');
    });
  });

  describe('Plain Text Clipboard Formatting', () => {
    it('should format empty shopping list gracefully', () => {
      const text = service.formatPlainText([]);
      expect(text).toContain('TOUR DIVIDE RESUPPLY SHOPPING LIST');
      expect(text).toContain('(No items selected)');
    });

    it('should format multi-department list with icons and checkbox markers', () => {
      const sampleItems: AggregatedGroceryItem[] = [
        { id: '1', name: 'Avocado', totalQuantity: 1, unit: 'whole', department: 'Produce', checked: true },
        { id: '2', name: 'Bread', totalQuantity: 4, unit: 'slices', department: 'Bakery', checked: false }
      ];

      const groups = service.groupByDepartment(sampleItems);
      const formatted = service.formatPlainText(groups);

      expect(formatted).toContain('🛒 TOUR DIVIDE RESUPPLY SHOPPING LIST');
      expect(formatted).toContain('[🥬 PRODUCE]');
      expect(formatted).toContain('[x] 1 whole Avocado');
      expect(formatted).toContain('[🍞 BAKERY]');
      expect(formatted).toContain('[ ] 4 slices Bread');
    });
  });
});
