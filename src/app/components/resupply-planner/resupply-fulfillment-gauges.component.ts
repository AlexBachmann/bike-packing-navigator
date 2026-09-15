import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NutrientFulfillment } from '../../models/resupply.model';

@Component({
  selector: 'app-resupply-fulfillment-gauges',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (!compact()) {
      <!-- SECTION 3: REAL-TIME NUTRITIONAL FULFILLMENT GAUGES (Detailed) -->
      <section class="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>📊</span>
              <span>Nutritional Fulfillment Gauges</span>
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">Live tracking comparing packed food to push targets</p>
          </div>
        </div>

        <!-- Gauges List -->
        <div class="space-y-2.5">
          <!-- 1. Calories -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-300">🔥 Calories</span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-slate-400 text-[11px]">
                  {{ fulfillment().calories.current }} / {{ fulfillment().calories.target }} kcal
                </span>
                <span class="font-mono font-black text-xs" [ngClass]="fulfillment().calories.percentage >= 100 ? 'text-emerald-400' : 'text-slate-200'">
                  {{ fulfillment().calories.percentage }}%
                </span>
                @if (fulfillment().calories.percentage > 100) {
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
                    +{{ fulfillment().calories.percentage - 100 }}% surplus
                  </span>
                }
              </div>
            </div>
            <div class="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().calories.percentage >= 100 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'bg-emerald-500'"
                [style.width.%]="fulfillment().calories.percentage > 100 ? 100 : fulfillment().calories.percentage"
              ></div>
            </div>
          </div>

          <!-- 2. Protein -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-300">🥩 Protein</span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-slate-400 text-[11px]">
                  {{ fulfillment().protein.current }} / {{ fulfillment().protein.target }} g
                </span>
                <span class="font-mono font-black text-xs" [ngClass]="fulfillment().protein.percentage >= 100 ? 'text-rose-400' : 'text-slate-200'">
                  {{ fulfillment().protein.percentage }}%
                </span>
                @if (fulfillment().protein.percentage > 100) {
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/50">
                    +{{ fulfillment().protein.percentage - 100 }}% surplus
                  </span>
                }
              </div>
            </div>
            <div class="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().protein.percentage >= 100 ? 'bg-gradient-to-r from-rose-500 to-pink-400' : 'bg-rose-500'"
                [style.width.%]="fulfillment().protein.percentage > 100 ? 100 : fulfillment().protein.percentage"
              ></div>
            </div>
          </div>

          <!-- 3. Fats -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-300">🥑 Fats</span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-slate-400 text-[11px]">
                  {{ fulfillment().fat.current }} / {{ fulfillment().fat.target }} g
                </span>
                <span class="font-mono font-black text-xs" [ngClass]="fulfillment().fat.percentage >= 100 ? 'text-yellow-400' : 'text-slate-200'">
                  {{ fulfillment().fat.percentage }}%
                </span>
                @if (fulfillment().fat.percentage > 100) {
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-yellow-500/20 text-yellow-300 border border-yellow-500/50">
                    +{{ fulfillment().fat.percentage - 100 }}% surplus
                  </span>
                }
              </div>
            </div>
            <div class="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().fat.percentage >= 100 ? 'bg-gradient-to-r from-yellow-500 to-amber-400' : 'bg-yellow-500'"
                [style.width.%]="fulfillment().fat.percentage > 100 ? 100 : fulfillment().fat.percentage"
              ></div>
            </div>
          </div>

          <!-- 4. Sodium / Salts -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-300">🧂 Sodium / Salts</span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-slate-400 text-[11px]">
                  {{ fulfillment().sodium.current }} / {{ fulfillment().sodium.target }} mg
                </span>
                <span class="font-mono font-black text-xs" [ngClass]="fulfillment().sodium.percentage >= 100 ? 'text-cyan-400' : 'text-slate-200'">
                  {{ fulfillment().sodium.percentage }}%
                </span>
                @if (fulfillment().sodium.percentage > 100) {
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/50">
                    +{{ fulfillment().sodium.percentage - 100 }}% surplus
                  </span>
                }
              </div>
            </div>
            <div class="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().sodium.percentage >= 100 ? 'bg-gradient-to-r from-cyan-500 to-blue-400' : 'bg-cyan-500'"
                [style.width.%]="fulfillment().sodium.percentage > 100 ? 100 : fulfillment().sodium.percentage"
              ></div>
            </div>
          </div>

          <!-- 5. Hydration -->
          <div class="space-y-1">
            <div class="flex justify-between items-center text-xs">
              <span class="font-bold text-slate-300">💧 Hydration</span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-slate-400 text-[11px]">
                  {{ (fulfillment().fluids.current / 1000).toFixed(1) }} / {{ (fulfillment().fluids.target / 1000).toFixed(1) }} L
                </span>
                <span class="font-mono font-black text-xs" [ngClass]="fulfillment().fluids.percentage >= 100 ? 'text-blue-400' : 'text-slate-200'">
                  {{ fulfillment().fluids.percentage }}%
                </span>
                @if (fulfillment().fluids.percentage > 100) {
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-blue-500/20 text-blue-300 border border-blue-500/50">
                    +{{ fulfillment().fluids.percentage - 100 }}% surplus
                  </span>
                }
              </div>
            </div>
            <div class="h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().fluids.percentage >= 100 ? 'bg-gradient-to-r from-blue-500 to-indigo-400' : 'bg-blue-500'"
                [style.width.%]="fulfillment().fluids.percentage > 100 ? 100 : fulfillment().fluids.percentage"
              ></div>
            </div>
          </div>
        </div>
      </section>
    } @else {
      <!-- Sticky Miniature Nutritional Fulfillment Bar -->
      <div
        class="sticky z-20 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl p-2 shadow-lg"
        [style.top]="'var(--telemetry-header-height, 156px)'"
        data-testid="sticky-mini-fulfillment"
      >
        <div class="flex items-stretch gap-1 sm:gap-2">
          <!-- 1. Calories -->
          <div
            class="flex-1 min-w-0 bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-1.5 flex flex-col justify-between"
            [title]="'Calories: ' + fulfillment().calories.current + ' / ' + fulfillment().calories.target + ' kcal (' + fulfillment().calories.percentage + '%)'"
            data-testid="mini-gauge-calories"
          >
            <div class="flex items-center justify-between text-[10px] sm:text-[11px] font-bold">
              <span class="text-slate-300 truncate">🔥 Cal</span>
              <span
                class="font-mono text-[10px] sm:text-[11px] font-black"
                [ngClass]="fulfillment().calories.percentage >= 100 ? 'text-emerald-400' : 'text-slate-200'"
              >
                {{ fulfillment().calories.percentage }}%@if (fulfillment().calories.percentage >= 100) {<span class="text-emerald-400 ml-0.5 font-bold">✓</span>}
              </span>
            </div>
            <div class="h-1 bg-slate-900 rounded-full overflow-hidden mt-1">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().calories.percentage >= 100 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-emerald-500'"
                [style.width.%]="fulfillment().calories.percentage > 100 ? 100 : fulfillment().calories.percentage"
              ></div>
            </div>
          </div>

          <!-- 2. Protein -->
          <div
            class="flex-1 min-w-0 bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-1.5 flex flex-col justify-between"
            [title]="'Protein: ' + fulfillment().protein.current + ' / ' + fulfillment().protein.target + ' g (' + fulfillment().protein.percentage + '%)'"
            data-testid="mini-gauge-protein"
          >
            <div class="flex items-center justify-between text-[10px] sm:text-[11px] font-bold">
              <span class="text-slate-300 truncate">🥩 Prot</span>
              <span
                class="font-mono text-[10px] sm:text-[11px] font-black"
                [ngClass]="fulfillment().protein.percentage >= 100 ? 'text-rose-400' : 'text-slate-200'"
              >
                {{ fulfillment().protein.percentage }}%@if (fulfillment().protein.percentage >= 100) {<span class="text-rose-400 ml-0.5 font-bold">✓</span>}
              </span>
            </div>
            <div class="h-1 bg-slate-900 rounded-full overflow-hidden mt-1">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().protein.percentage >= 100 ? 'bg-gradient-to-r from-rose-500 to-pink-400' : 'bg-rose-500'"
                [style.width.%]="fulfillment().protein.percentage > 100 ? 100 : fulfillment().protein.percentage"
              ></div>
            </div>
          </div>

          <!-- 3. Fat -->
          <div
            class="flex-1 min-w-0 bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-1.5 flex flex-col justify-between"
            [title]="'Fat: ' + fulfillment().fat.current + ' / ' + fulfillment().fat.target + ' g (' + fulfillment().fat.percentage + '%)'"
            data-testid="mini-gauge-fat"
          >
            <div class="flex items-center justify-between text-[10px] sm:text-[11px] font-bold">
              <span class="text-slate-300 truncate">🥑 Fat</span>
              <span
                class="font-mono text-[10px] sm:text-[11px] font-black"
                [ngClass]="fulfillment().fat.percentage >= 100 ? 'text-yellow-400' : 'text-slate-200'"
              >
                {{ fulfillment().fat.percentage }}%@if (fulfillment().fat.percentage >= 100) {<span class="text-yellow-400 ml-0.5 font-bold">✓</span>}
              </span>
            </div>
            <div class="h-1 bg-slate-900 rounded-full overflow-hidden mt-1">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().fat.percentage >= 100 ? 'bg-gradient-to-r from-yellow-500 to-amber-400' : 'bg-yellow-500'"
                [style.width.%]="fulfillment().fat.percentage > 100 ? 100 : fulfillment().fat.percentage"
              ></div>
            </div>
          </div>

          <!-- 4. Sodium / Salts -->
          <div
            class="flex-1 min-w-0 bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-1.5 flex flex-col justify-between"
            [title]="'Sodium: ' + fulfillment().sodium.current + ' / ' + fulfillment().sodium.target + ' mg (' + fulfillment().sodium.percentage + '%)'"
            data-testid="mini-gauge-sodium"
          >
            <div class="flex items-center justify-between text-[10px] sm:text-[11px] font-bold">
              <span class="text-slate-300 truncate">🧂 Salt</span>
              <span
                class="font-mono text-[10px] sm:text-[11px] font-black"
                [ngClass]="fulfillment().sodium.percentage >= 100 ? 'text-cyan-400' : 'text-slate-200'"
              >
                {{ fulfillment().sodium.percentage }}%@if (fulfillment().sodium.percentage >= 100) {<span class="text-cyan-400 ml-0.5 font-bold">✓</span>}
              </span>
            </div>
            <div class="h-1 bg-slate-900 rounded-full overflow-hidden mt-1">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().sodium.percentage >= 100 ? 'bg-gradient-to-r from-cyan-500 to-blue-400' : 'bg-cyan-500'"
                [style.width.%]="fulfillment().sodium.percentage > 100 ? 100 : fulfillment().sodium.percentage"
              ></div>
            </div>
          </div>

          <!-- 5. Hydration -->
          <div
            class="flex-1 min-w-0 bg-slate-950/80 border border-slate-800/80 rounded-lg py-1 px-1.5 flex flex-col justify-between"
            [title]="'Hydration: ' + (fulfillment().fluids.current / 1000).toFixed(1) + ' / ' + (fulfillment().fluids.target / 1000).toFixed(1) + ' L (' + fulfillment().fluids.percentage + '%)'"
            data-testid="mini-gauge-fluids"
          >
            <div class="flex items-center justify-between text-[10px] sm:text-[11px] font-bold">
              <span class="text-slate-300 truncate">💧 H₂O</span>
              <span
                class="font-mono text-[10px] sm:text-[11px] font-black"
                [ngClass]="fulfillment().fluids.percentage >= 100 ? 'text-blue-400' : 'text-slate-200'"
              >
                {{ fulfillment().fluids.percentage }}%@if (fulfillment().fluids.percentage >= 100) {<span class="text-blue-400 ml-0.5 font-bold">✓</span>}
              </span>
            </div>
            <div class="h-1 bg-slate-900 rounded-full overflow-hidden mt-1">
              <div
                class="h-full rounded-full transition-all duration-300"
                [ngClass]="fulfillment().fluids.percentage >= 100 ? 'bg-gradient-to-r from-blue-500 to-indigo-400' : 'bg-blue-500'"
                [style.width.%]="fulfillment().fluids.percentage > 100 ? 100 : fulfillment().fluids.percentage"
              ></div>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ResupplyFulfillmentGaugesComponent {
  readonly fulfillment = input.required<NutrientFulfillment>();
  readonly compact = input<boolean>(false);
}
