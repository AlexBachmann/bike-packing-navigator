import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DepartmentGroup, GroceryDepartment } from '../../models/resupply.model';
import { DEPARTMENT_ICONS } from '../../services/resupply-shopping-list.service';

export type GroceryDepartmentGroup = DepartmentGroup;

@Component({
  selector: 'app-resupply-shopping-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>🛒</span>
            <span>Grocery Shopping List</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Aggregated ingredients organized by supermarket department</p>
        </div>

        <div class="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            (click)="copyShoppingList.emit()"
            class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
          >
            <span>📋</span>
            <span>Copy Shopping List</span>
          </button>
          @if (hasCheckedItems()) {
            <button
              type="button"
              (click)="uncheckAllItems.emit()"
              class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 transition active:scale-95 cursor-pointer"
            >
              Uncheck All
            </button>
          }
        </div>
      </div>

      <!-- Empty State -->
      @if (departmentGroups().length === 0) {
        <div class="py-12 text-center text-slate-400 bg-slate-950/40 rounded-2xl border border-slate-800/80 space-y-2">
          <span class="text-3xl block">🛒</span>
          <div class="font-bold text-sm text-slate-200">No items in your shopping list yet</div>
          <p class="text-xs text-slate-400 max-w-sm mx-auto">
            Switch back to the Resupply Plan to select recipes and adjust quantities. Your consolidated supermarket checklist will appear here automatically.
          </p>
          <div class="pt-2">
            <button
              type="button"
              (click)="openBuilder.emit()"
              class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition active:scale-95 cursor-pointer"
            >
              Open Resupply Plan
            </button>
          </div>
        </div>
      } @else {
        <!-- Department Cards -->
        <div class="space-y-3">
          @for (group of departmentGroups(); track group.department) {
            <div class="bg-slate-950/70 rounded-xl border border-slate-800/80 p-3.5 space-y-2">
              <div class="flex items-center justify-between text-xs font-bold text-slate-300 pb-1 border-b border-slate-800/60">
                <span class="flex items-center gap-1.5 uppercase tracking-wider">
                  <span>{{ departmentIcons[group.department] || '📦' }}</span>
                  <span>{{ group.department }}</span>
                </span>
                <span class="text-slate-500 font-mono text-[11px]">{{ group.items.length }} items</span>
              </div>

              <!-- Department Items Checklist -->
              <div class="space-y-1.5 pt-1">
                @for (item of group.items; track item.id) {
                  <label
                    class="flex items-center gap-2.5 p-2 rounded-lg transition cursor-pointer hover:bg-slate-900/80"
                    [ngClass]="item.checked ? 'bg-slate-900/30 text-slate-500 line-through' : 'text-slate-200'"
                  >
                    <input
                      type="checkbox"
                      [checked]="item.checked"
                      (change)="toggleItemChecked.emit(item.id)"
                      class="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-950 cursor-pointer"
                    />
                    <div class="flex-1 text-xs flex items-center justify-between">
                      <span class="font-medium">{{ item.name }}</span>
                      <span class="font-mono font-bold text-slate-400 ml-2">
                        {{ item.totalQuantity }} {{ item.unit }}
                      </span>
                    </div>
                  </label>
                }
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ResupplyShoppingListComponent {
  readonly departmentGroups = input.required<DepartmentGroup[]>();
  readonly totalItemsCount = input<number>(0);
  readonly hasCheckedItems = input<boolean>(false);

  readonly toggleItemChecked = output<string>();
  readonly uncheckAllItems = output<void>();
  readonly copyShoppingList = output<void>();
  readonly openBuilder = output<void>();

  readonly departmentIcons: Record<GroceryDepartment, string> = DEPARTMENT_ICONS;
}
