import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DayScheduleSummary, NutrientTargets } from '../../models/resupply.model';

@Component({
  selector: 'app-resupply-nutrient-demands',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>⚙️</span>
            <span>Nutritional Demand Settings</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Rider physiology, power physics, and sleep schedule for computing demand</p>
        </div>
      </div>

      <!-- Current Rider Physics Context -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-center">
        <div>
          <div class="text-[10px] font-bold text-slate-400 uppercase">⚡ Rider Power</div>
          <div class="text-xs font-black font-mono text-emerald-400 mt-0.5">{{ riderPowerWatts() }} W</div>
        </div>
        <div>
          <div class="text-[10px] font-bold text-slate-400 uppercase">⚖️ Rig Weight</div>
          <div class="text-xs font-black font-mono text-emerald-400 mt-0.5">{{ totalSystemMassKg() }} kg</div>
        </div>
        <div>
          <div class="text-[10px] font-bold text-slate-400 uppercase">🚴 Riding Speed</div>
          <div class="text-xs font-black font-mono text-emerald-400 mt-0.5">{{ displaySpeed() }} {{ speedUnit() }}</div>
        </div>
        <div>
          <div class="text-[10px] font-bold text-slate-400 uppercase">⏱️ Riding Time</div>
          <div class="text-xs font-black font-mono text-emerald-400 mt-0.5">{{ dayScheduleSummary().ridingHours }}h</div>
        </div>
      </div>

      <!-- Schedule Sliders -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Slider 1: Daily Riding % -->
        <div class="space-y-1.5">
          <div class="flex justify-between items-center text-xs">
            <span class="text-slate-300 font-bold flex items-center gap-1.5">
              <span>🚴</span>
              <span>Daily Riding %</span>
            </span>
            <span class="font-mono font-bold text-emerald-400">{{ dailyRidingPercent() }}% ({{ ((24 * dailyRidingPercent()) / 100).toFixed(1) }}h/day)</span>
          </div>
          <input
            type="range"
            min="30"
            max="85"
            step="5"
            [ngModel]="dailyRidingPercent()"
            (ngModelChange)="ridingPercentChange.emit($event)"
            class="w-full h-2 bg-slate-950 rounded-lg cursor-pointer"
            aria-label="Daily Riding Percentage"
          />
        </div>

        <!-- Slider 2: Target Sleep Hours -->
        <div class="space-y-1.5">
          <div class="flex justify-between items-center text-xs">
            <span class="text-slate-300 font-bold flex items-center gap-1.5">
              <span>⛺</span>
              <span>Target Sleep</span>
            </span>
            <span class="font-mono font-bold text-emerald-400">{{ targetSleepHours() }}h (+1.0h prep/wake)</span>
          </div>
          <input
            type="range"
            min="4.0"
            max="10.0"
            step="0.5"
            [ngModel]="targetSleepHours()"
            (ngModelChange)="sleepHoursChange.emit($event)"
            class="w-full h-2 bg-slate-950 rounded-lg cursor-pointer"
            aria-label="Target Sleep Hours"
          />
        </div>
      </div>

      <!-- Forward Day Schedule Timeline Summary -->
      <div class="bg-slate-950/80 p-3 rounded-xl border border-slate-800/90 space-y-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>📅 Forward Day Schedule Timeline</span>
          @if (dayScheduleSummary().arrivesAfterNightfall) {
            <span class="text-amber-400 text-[10px] font-bold">🌙 Nightfall Trigger Active (~21:00)</span>
          }
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
            <div class="text-slate-400 text-[10px]">Riding</div>
            <div class="font-black font-mono text-emerald-400 mt-0.5">{{ dayScheduleSummary().ridingHours }}h</div>
          </div>
          <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
            <div class="text-slate-400 text-[10px]">Day Rest Stops</div>
            <div class="font-black font-mono text-slate-200 mt-0.5">{{ dayScheduleSummary().daytimeOffBikeHours }}h</div>
          </div>
          <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
            <div class="text-slate-400 text-[10px]">Sleep Block</div>
            <div class="font-black font-mono text-indigo-300 mt-0.5">{{ dayScheduleSummary().sleepHours + dayScheduleSummary().prepWakeHours }}h</div>
          </div>
          <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
            <div class="text-slate-400 text-[10px]">Total Push</div>
            <div class="font-black font-mono text-cyan-300 mt-0.5">{{ dayScheduleSummary().totalElapsedHours }}h</div>
          </div>
        </div>

        <div class="text-[11px] text-slate-400 leading-relaxed pt-1">
          Estimated total time: <span class="text-white font-bold">{{ formatDuration(dayScheduleSummary().totalElapsedHours) }}</span>
          across <span class="text-emerald-400 font-bold">{{ dayScheduleSummary().sleepCyclesCount }}</span> sleep cycle(s).
          Sleep blocks trigger at nightfall (~21:00 dusk) with 30m camp setup and 30m morning wake routine.
        </div>
      </div>

      <!-- Prominent Needed Caloric Expenditure & Percentage Safety Buffer Stepper -->
      <div class="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <!-- Prominent Needed Calories Display -->
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl shrink-0">
            🔥
          </div>
          <div>
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Needed Caloric Expenditure</div>
            <div class="flex items-baseline gap-2 mt-0.5">
              <span class="text-3xl font-black font-mono text-emerald-400" data-testid="needed-calories-display">
                {{ nutrientTargets().totalCaloriesTarget.toLocaleString() }}
              </span>
              <span class="text-xs font-black text-slate-400 uppercase font-mono">kcal</span>
              @if (safetyBufferPercent() !== 0) {
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-black border font-mono"
                  [ngClass]="safetyBufferPercent() > 0 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'"
                >
                  {{ safetyBufferPercent() > 0 ? '+' : '' }}{{ safetyBufferPercent() }}%
                </span>
              }
            </div>
            <div class="text-[11px] text-slate-400 mt-1">
              Base: <span class="font-mono text-slate-300">{{ nutrientTargets().baseCalories.toLocaleString() }}</span> kcal (on-bike + BMR)
              @if (nutrientTargets().safetyBufferCalories !== 0) {
                <span class="mx-1 text-slate-600">•</span>
                <span>Buffer: </span>
                <span class="font-mono font-bold" [ngClass]="nutrientTargets().safetyBufferCalories > 0 ? 'text-emerald-400' : 'text-amber-400'">
                  {{ nutrientTargets().safetyBufferCalories > 0 ? '+' : '' }}{{ nutrientTargets().safetyBufferCalories.toLocaleString() }} kcal
                </span>
              }
            </div>
          </div>
        </div>

        <!-- Buffer Stepper Toggle: [-] [ Current Buffer Setting ] [+] -->
        <div class="flex items-center gap-2 bg-slate-900/90 p-2 rounded-xl border border-slate-800 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            (click)="adjustBufferPercent.emit(-5)"
            class="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-sm active:scale-95 transition cursor-pointer"
            title="Decrease safety buffer by 5%"
            aria-label="Decrease safety buffer by 5%"
            data-testid="buffer-decrement-btn"
          >
            −
          </button>
          <div class="text-center min-w-[76px] px-2 py-0.5" data-testid="buffer-setting-display">
            <div
              class="text-sm font-black font-mono"
              [ngClass]="safetyBufferPercent() > 0 ? 'text-emerald-400' : safetyBufferPercent() < 0 ? 'text-amber-400' : 'text-slate-200'"
            >
              {{ safetyBufferPercent() > 0 ? '+' : '' }}{{ safetyBufferPercent() }}%
            </div>
            <div class="text-[9px] font-bold text-slate-400 uppercase tracking-tight">
              {{ safetyBufferPercent() > 0 ? 'Safety Buffer' : safetyBufferPercent() < 0 ? 'Deficit Buffer' : 'Buffer' }}
            </div>
          </div>
          <button
            type="button"
            (click)="adjustBufferPercent.emit(5)"
            class="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-sm active:scale-95 transition cursor-pointer"
            title="Increase safety buffer by 5%"
            aria-label="Increase safety buffer by 5%"
            data-testid="buffer-increment-btn"
          >
            +
          </button>
        </div>
      </div>

      <!-- Multi-Nutrient Targets Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <div class="text-slate-400 text-[10px] font-bold">🍞 Carbs (55%)</div>
          <div class="font-black font-mono text-amber-300 mt-0.5">{{ nutrientTargets().carbsTargetGrams }} g</div>
        </div>
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <div class="text-slate-400 text-[10px] font-bold">🥩 Protein (15%)</div>
          <div class="font-black font-mono text-rose-300 mt-0.5">{{ nutrientTargets().proteinTargetGrams }} g</div>
        </div>
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <div class="text-slate-400 text-[10px] font-bold">🥑 Fats (30%)</div>
          <div class="font-black font-mono text-yellow-300 mt-0.5">{{ nutrientTargets().fatTargetGrams }} g</div>
        </div>
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <div class="text-slate-400 text-[10px] font-bold">🧂 Sodium/Salts</div>
          <div class="font-black font-mono text-cyan-300 mt-0.5">{{ nutrientTargets().sodiumTargetMg }} mg</div>
        </div>
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <div class="text-slate-400 text-[10px] font-bold">🍌 Potassium</div>
          <div class="font-black font-mono text-emerald-300 mt-0.5">{{ nutrientTargets().potassiumTargetMg }} mg</div>
        </div>
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <div class="text-slate-400 text-[10px] font-bold">🥜 Magnesium</div>
          <div class="font-black font-mono text-purple-300 mt-0.5">{{ nutrientTargets().magnesiumTargetMg }} mg</div>
        </div>
        <div class="bg-slate-950/60 p-2 rounded-xl border border-slate-800 col-span-2">
          <div class="text-slate-400 text-[10px] font-bold">💧 Hydration</div>
          <div class="font-black font-mono text-blue-300 mt-0.5">
            {{ (nutrientTargets().fluidsTargetMl / 1000).toFixed(1) }} L ({{ nutrientTargets().fluidsTargetMl }} ml)
          </div>
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ResupplyNutrientDemandsComponent {
  readonly dailyRidingPercent = input.required<number>();
  readonly targetSleepHours = input.required<number>();
  readonly dayScheduleSummary = input.required<DayScheduleSummary>();
  readonly nutrientTargets = input.required<NutrientTargets>();
  readonly safetyBufferPercent = input.required<number>();
  readonly riderPowerWatts = input<number>(0);
  readonly totalSystemMassKg = input<number>(0);
  readonly displaySpeed = input<number | string>(0);
  readonly speedUnit = input<string>('');

  readonly ridingPercentChange = output<number>();
  readonly sleepHoursChange = output<number>();
  readonly adjustBufferPercent = output<number>();
  readonly adjustCalories = output<number>();

  formatDuration(hours: number): string {
    const totalMinutes = Math.round(hours * 60);
    const d = Math.floor(totalMinutes / (24 * 60));
    const remM = totalMinutes % (24 * 60);
    const h = Math.floor(remM / 60);
    const m = remM % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}
