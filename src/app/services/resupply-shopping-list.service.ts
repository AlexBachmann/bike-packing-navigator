import { Injectable } from '@angular/core';
import {
  AggregatedGroceryItem,
  DepartmentGroup,
  GroceryDepartment,
  SelectedRecipeItem
} from '../models/resupply.model';

export const DEPARTMENT_ORDER: readonly GroceryDepartment[] = [
  'Produce',
  'Bakery',
  'Canned/Protein',
  'Snacks/Candy',
  'Beverages',
  'Dairy',
  'Prepared/Deli'
];

export const DEPARTMENT_ICONS: Record<GroceryDepartment, string> = {
  Produce: '🥬',
  Bakery: '🍞',
  'Canned/Protein': '🥫',
  'Snacks/Candy': '🍫',
  Beverages: '🥤',
  Dairy: '🧀',
  'Prepared/Deli': '🥪'
};

@Injectable({
  providedIn: 'root'
})
export class ResupplyShoppingListService {
  /**
   * Aggregates required ingredients across all enabled recipe selections,
   * combining quantities for duplicate items with matching names and units.
   */
  aggregateIngredients(selectedItems: SelectedRecipeItem[]): AggregatedGroceryItem[] {
    const map = new Map<string, AggregatedGroceryItem>();
    if (!Array.isArray(selectedItems)) return [];

    for (const item of selectedItems) {
      if (!item || !item.enabled || item.quantity <= 0) continue;
      if (!item.recipe || !Array.isArray(item.recipe.ingredients)) continue;

      for (const ing of item.recipe.ingredients) {
        if (!ing) continue;
        const safeName = (ing.name || '').trim();
        const safeUnit = (ing.unit || '').trim();
        const key = `${safeName.toLowerCase()}__${safeUnit.toLowerCase()}`;
        const addedQty =
          item.quantity * (typeof ing.quantity === 'number' && !isNaN(ing.quantity) ? ing.quantity : 0);

        const existing = map.get(key);
        if (existing) {
          existing.totalQuantity = Math.round((existing.totalQuantity + addedQty) * 100) / 100;
        } else {
          map.set(key, {
            id: key,
            name: safeName,
            totalQuantity: Math.round(addedQty * 100) / 100,
            unit: safeUnit,
            department: ing.department || 'Produce',
            checked: false
          });
        }
      }
    }

    return Array.from(map.values());
  }

  /**
   * Groups aggregated grocery items by the 7 standard supermarket departments,
   * ordered in retail aisle progression with items sorted alphabetically.
   */
  groupByDepartment(items: AggregatedGroceryItem[]): DepartmentGroup[] {
    const groups: DepartmentGroup[] = [];

    for (const dept of DEPARTMENT_ORDER) {
      const deptItems = items.filter((i) => i.department === dept);
      if (deptItems.length > 0) {
        deptItems.sort((a, b) => a.name.localeCompare(b.name));
        groups.push({
          department: dept,
          items: deptItems
        });
      }
    }

    return groups;
  }

  /**
   * Formats aggregated department groups into clean plain text for clipboard export and notes apps.
   */
  formatPlainText(groups: DepartmentGroup[]): string {
    if (!groups || groups.length === 0) {
      return '🛒 TOUR DIVIDE RESUPPLY SHOPPING LIST\n(No items selected)';
    }

    const lines: string[] = ['🛒 TOUR DIVIDE RESUPPLY SHOPPING LIST', ''];

    for (const group of groups) {
      const icon = DEPARTMENT_ICONS[group.department] || '📦';
      lines.push(`[${icon} ${group.department.toUpperCase()}]`);

      for (const item of group.items) {
        const checkMark = item.checked ? '[x]' : '[ ]';
        lines.push(`${checkMark} ${item.totalQuantity} ${item.unit} ${item.name}`);
      }

      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
