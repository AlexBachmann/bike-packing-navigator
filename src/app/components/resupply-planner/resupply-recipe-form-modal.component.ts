import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  model,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GroceryDepartment, Ingredient, Recipe, RecipeCategory } from '../../models/resupply.model';
import { DEPARTMENT_ORDER } from '../../services/resupply-shopping-list.service';

export interface RecipeFormData {
  name: string;
  description: string;
  category: RecipeCategory;
  servings: number;
  nutrients: {
    calories: number;
    carbs: number;
    protein: number;
    fat: number;
    sodium: number;
    fluids: number;
  };
  ingredients: Ingredient[];
}

@Component({
  selector: 'app-resupply-recipe-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="mode() === 'edit' ? 'Edit Recipe' : 'Add Recipe'"
      >
        <div class="max-w-lg w-full max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-4 sm:p-6 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 class="font-black text-sm uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <span>{{ mode() === 'edit' ? '✏️' : '➕' }}</span>
              <span>{{ mode() === 'edit' ? 'Edit Recipe' : 'Add Recipe' }}</span>
            </h3>
            <button
              type="button"
              (click)="cancel.emit()"
              class="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              title="Close modal"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          <div class="space-y-3 text-xs">
            <div>
              <label class="block font-bold text-slate-400 mb-1">Recipe Name *</label>
              <input
                type="text"
                placeholder="e.g. Trail Mix Power Bomb"
                [value]="formName()"
                (input)="formName.set($any($event.target).value)"
                class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                aria-label="Recipe Name"
              />
            </div>

            <div>
              <label class="block font-bold text-slate-400 mb-1">Description</label>
              <input
                type="text"
                placeholder="Short description of recipe"
                [value]="formDescription()"
                (input)="formDescription.set($any($event.target).value)"
                class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                aria-label="Description"
              />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block font-bold text-slate-400 mb-1">Category</label>
                <select
                  [value]="formCategory()"
                  (change)="formCategory.set($any($event.target).value)"
                  class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  aria-label="Category"
                >
                  <option value="meal">Meal</option>
                  <option value="snack">Snack</option>
                  <option value="drink">Drink</option>
                  <option value="quick_bite">Quick Bite</option>
                </select>
              </div>
              <div>
                <label class="block font-bold text-slate-400 mb-1">Servings</label>
                <input
                  type="number"
                  min="1"
                  [value]="formServings()"
                  (input)="formServings.set(+$any($event.target).value)"
                  class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                  aria-label="Servings"
                />
              </div>
            </div>

            <div class="border-t border-slate-800 pt-3">
              <span class="block font-bold text-slate-300 uppercase tracking-wider text-[11px] mb-2">Nutritional Profile (per serving)</span>
              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="text-[10px] text-slate-400">Calories (kcal)</label>
                  <input
                    type="number"
                    [value]="formCalories()"
                    (input)="formCalories.set(+$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 font-mono"
                    aria-label="Calories"
                  />
                </div>
                <div>
                  <label class="text-[10px] text-slate-400">Carbs (g)</label>
                  <input
                    type="number"
                    [value]="formCarbs()"
                    (input)="formCarbs.set(+$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 font-mono"
                    aria-label="Carbs"
                  />
                </div>
                <div>
                  <label class="text-[10px] text-slate-400">Protein (g)</label>
                  <input
                    type="number"
                    [value]="formProtein()"
                    (input)="formProtein.set(+$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 font-mono"
                    aria-label="Protein"
                  />
                </div>
                <div>
                  <label class="text-[10px] text-slate-400">Fat (g)</label>
                  <input
                    type="number"
                    [value]="formFat()"
                    (input)="formFat.set(+$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 font-mono"
                    aria-label="Fat"
                  />
                </div>
                <div>
                  <label class="text-[10px] text-slate-400">Sodium (mg)</label>
                  <input
                    type="number"
                    [value]="formSodium()"
                    (input)="formSodium.set(+$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 font-mono"
                    aria-label="Sodium"
                  />
                </div>
                <div>
                  <label class="text-[10px] text-slate-400">Fluids (ml)</label>
                  <input
                    type="number"
                    [value]="formFluids()"
                    (input)="formFluids.set(+$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 font-mono"
                    aria-label="Fluids"
                  />
                </div>
              </div>
            </div>

            <div class="border-t border-slate-800 pt-3">
              <div class="flex items-center justify-between mb-2">
                <span class="block font-bold text-slate-300 uppercase tracking-wider text-[11px]">Ingredients</span>
                <button
                  type="button"
                  (click)="onAddIngredient()"
                  class="text-[10px] font-bold px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition cursor-pointer flex items-center gap-1"
                  data-testid="edit-add-ingredient-btn"
                >
                  <span>+</span>
                  <span>Add Item</span>
                </button>
              </div>

              <div class="space-y-2 max-h-48 overflow-y-auto pr-1" data-testid="edit-ingredients-list">
                @for (ing of formIngredients(); track $index) {
                  <div class="grid grid-cols-12 gap-1.5 items-center bg-slate-950/60 p-2 rounded-lg border border-slate-800" data-testid="edit-ingredient-row">
                    <div class="col-span-4">
                      <input
                        type="text"
                        placeholder="Item name"
                        [value]="ing.name"
                        (input)="ing.name = $any($event.target).value"
                        class="w-full bg-slate-900 border border-slate-700 rounded p-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                        aria-label="Ingredient name"
                      />
                    </div>
                    <div class="col-span-2">
                      <input
                        type="number"
                        placeholder="Qty"
                        min="0.1"
                        step="any"
                        [value]="ing.quantity"
                        (input)="ing.quantity = +$any($event.target).value"
                        class="w-full bg-slate-900 border border-slate-700 rounded p-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
                        aria-label="Ingredient quantity"
                      />
                    </div>
                    <div class="col-span-2">
                      <input
                        type="text"
                        placeholder="Unit"
                        [value]="ing.unit"
                        (input)="ing.unit = $any($event.target).value"
                        class="w-full bg-slate-900 border border-slate-700 rounded p-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                        aria-label="Ingredient unit"
                      />
                    </div>
                    <div class="col-span-3">
                      <select
                        [value]="ing.department"
                        (change)="ing.department = $any($event.target).value"
                        class="w-full bg-slate-900 border border-slate-700 rounded p-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                        aria-label="Ingredient department"
                      >
                        @for (dept of departments(); track dept) {
                          <option [value]="dept">{{ dept }}</option>
                        }
                      </select>
                    </div>
                    <div class="col-span-1 text-center">
                      <button
                        type="button"
                        (click)="onRemoveIngredient($index)"
                        class="text-rose-400 hover:text-rose-300 font-bold p-1 rounded transition cursor-pointer"
                        title="Remove ingredient"
                        aria-label="Remove ingredient"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                }
                @if (formIngredients().length === 0) {
                  <div class="text-center py-3 text-slate-500 italic text-xs">
                    No ingredients added yet. Click "+ Add Item" to add one.
                  </div>
                }
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
            <button
              type="button"
              (click)="cancel.emit()"
              class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="submit()"
              class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition active:scale-95 cursor-pointer"
            >
              {{ mode() === 'edit' ? 'Save Changes' : 'Add Recipe' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class ResupplyRecipeFormModalComponent {
  readonly isOpen = input.required<boolean>();
  readonly mode = input<'add' | 'edit'>('add');
  readonly recipe = input<Recipe | null>(null);
  readonly departments = input<GroceryDepartment[]>([...DEPARTMENT_ORDER]);

  readonly formName = model<string>('');
  readonly formDescription = model<string>('');
  readonly formCategory = model<RecipeCategory>('meal');
  readonly formServings = model<number>(1);
  readonly formCalories = model<number>(500);
  readonly formCarbs = model<number>(60);
  readonly formProtein = model<number>(20);
  readonly formFat = model<number>(15);
  readonly formSodium = model<number>(500);
  readonly formFluids = model<number>(0);
  readonly formIngredients = model<Ingredient[]>([
    { name: '', quantity: 1, unit: 'item', department: 'Snacks/Candy' }
  ]);

  constructor() {
    effect(() => {
      const r = this.recipe();
      const m = this.mode();
      if (m === 'edit' && r) {
        this.formName.set(r.name);
        this.formDescription.set(r.description);
        this.formCategory.set(r.category || 'meal');
        this.formServings.set(r.servings || 1);
        this.formCalories.set(r.nutrients.calories || 0);
        this.formCarbs.set(r.nutrients.carbs || 0);
        this.formProtein.set(r.nutrients.protein || 0);
        this.formFat.set(r.nutrients.fat || 0);
        this.formSodium.set(r.nutrients.sodium || 0);
        this.formFluids.set(r.nutrients.fluids || 0);
        this.formIngredients.set((r.ingredients || []).map((i) => ({ ...i })));
      }
    });
  }

  readonly save = output<RecipeFormData>();
  readonly cancel = output<void>();
  readonly addIngredient = output<void>();
  readonly removeIngredient = output<number>();

  onAddIngredient(): void {
    this.formIngredients.update((items) => [
      ...items,
      { name: '', quantity: 1, unit: 'item', department: 'Snacks/Candy' }
    ]);
    this.addIngredient.emit();
  }

  onRemoveIngredient(index: number): void {
    this.formIngredients.update((items) => items.filter((_, i) => i !== index));
    this.removeIngredient.emit(index);
  }

  submit(): void {
    const name = this.formName().trim();
    if (!name) return;

    this.save.emit({
      name,
      description: this.formDescription().trim(),
      category: this.formCategory(),
      servings: Number(this.formServings()) || 1,
      nutrients: {
        calories: Number(this.formCalories()) || 0,
        carbs: Number(this.formCarbs()) || 0,
        protein: Number(this.formProtein()) || 0,
        fat: Number(this.formFat()) || 0,
        sodium: Number(this.formSodium()) || 0,
        fluids: Number(this.formFluids()) || 0
      },
      ingredients: this.formIngredients().map((ing) => ({
        ...ing,
        name: ing.name.trim(),
        quantity: Number(ing.quantity) || 1,
        unit: (ing.unit || 'item').trim()
      }))
    });
  }
}
