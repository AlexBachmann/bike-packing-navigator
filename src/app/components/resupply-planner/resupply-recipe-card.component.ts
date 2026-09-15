import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Recipe } from '../../models/resupply.model';

@Component({
  selector: 'app-resupply-recipe-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="bg-slate-950/70 rounded-xl border p-3 transition space-y-2.5"
      [ngClass]="quantity() > 0
        ? 'border-emerald-500/70 bg-emerald-950/15 shadow-md shadow-emerald-950/20'
        : 'border-slate-800/90 hover:border-slate-700'"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              (click)="toggleFavorite.emit(recipe().id)"
              class="text-base transition hover:scale-110 active:scale-95 cursor-pointer leading-none p-0.5"
              [title]="isFavorite() ? 'Remove from favorites' : 'Mark as favorite'"
              [attr.data-testid]="'favorite-btn-' + recipe().id"
            >
              @if (isFavorite()) {
                <span class="text-amber-400">★</span>
              } @else {
                <span class="text-slate-600 hover:text-amber-400">☆</span>
              }
            </button>
            <span class="font-bold text-sm text-slate-100">{{ recipe().name }}</span>
            @if (recipe().isCustom) {
              <span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 uppercase">
                Custom
              </span>
            }
            @if (isModified()) {
              <span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                Modified
              </span>
            }
            @if (recipe().category) {
              <span class="text-[10px] text-slate-500">({{ formatCategory(recipe().category) }})</span>
            }
          </div>
          <p class="text-xs text-slate-400 mt-0.5 leading-snug">{{ recipe().description }}</p>
        </div>

        <!-- Quantity Controls -->
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            (click)="adjustQuantity.emit(-1)"
            class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-xs active:scale-95 transition cursor-pointer"
            title="Decrease quantity"
          >
            -
          </button>
          <span class="w-6 text-center font-mono font-bold text-xs" [ngClass]="quantity() > 0 ? 'text-emerald-400' : 'text-slate-500'">
            {{ quantity() }}
          </span>
          <button
            type="button"
            (click)="adjustQuantity.emit(1)"
            class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-xs active:scale-95 transition cursor-pointer"
            title="Increase quantity"
          >
            +
          </button>
        </div>
      </div>

      <!-- Macros Chips -->
      <div class="flex flex-wrap items-center gap-1 text-[11px] font-mono">
        <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-300">
          {{ recipe().nutrients.calories }} kcal
        </span>
        <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300">
          {{ recipe().nutrients.carbs }}g C
        </span>
        <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-rose-300">
          {{ recipe().nutrients.protein }}g P
        </span>
        <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-yellow-300">
          {{ recipe().nutrients.fat }}g F
        </span>
        <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300">
          {{ recipe().nutrients.sodium }}mg Na
        </span>
        @if (recipe().nutrients.fluids > 0) {
          <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-blue-300">
            {{ recipe().nutrients.fluids }}ml H₂O
          </span>
        }
      </div>

      <!-- Ingredients & Actions Footer -->
      <div class="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-900 pt-2">
        <div class="truncate max-w-[65%]">
          <span class="text-slate-500">Includes:</span>
          <span class="ml-1 text-slate-300">
            @for (ing of recipe().ingredients; track ing.name; let last = $last) {
              {{ ing.quantity }} {{ ing.unit }} {{ ing.name }}{{ !last ? ', ' : '' }}
            }
          </span>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            (click)="editRecipe.emit(recipe())"
            class="text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
          >
            Edit
          </button>

          <button
            type="button"
            (click)="deleteRecipe.emit(recipe())"
            class="text-xs font-semibold text-rose-400 hover:text-rose-300 transition cursor-pointer"
            title="Delete recipe from list"
          >
            Delete
          </button>

          @if (isModified()) {
            <button
              type="button"
              (click)="resetRecipe.emit(recipe().id)"
              class="text-xs font-semibold text-amber-400 hover:text-amber-300 transition cursor-pointer"
              title="Reset to default definition"
            >
              Reset
            </button>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ResupplyRecipeCardComponent {
  readonly recipe = input.required<Recipe>();
  readonly quantity = input<number>(0);
  readonly isFavorite = input<boolean>(false);
  readonly isModified = input<boolean>(false);

  readonly toggleFavorite = output<string>();
  readonly adjustQuantity = output<number>();
  readonly editRecipe = output<Recipe>();
  readonly deleteRecipe = output<Recipe>();
  readonly resetRecipe = output<string>();

  formatCategory(category?: string): string {
    if (!category) return '';
    if (category === 'quick_bite') return 'Quick Bite';
    return category.charAt(0).toUpperCase() + category.slice(1);
  }
}
