import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WeightUnit } from '../../models/settings.model';

@Component({
  selector: 'app-settings-rider-rig',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="font-bold text-white text-sm flex items-center gap-1.5">
            <span>🚴</span>
            <span>Rider & Rig Setup</span>
          </h2>
          <p class="text-[11px] text-slate-400 mt-0.5">Stored in local storage for climb power & water planning.</p>
        </div>

        <!-- Weight Unit Toggle Button -->
        <button
          type="button"
          (click)="toggleWeightUnit.emit()"
          class="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 hover:border-slate-600 text-xs font-mono font-semibold text-emerald-400 flex items-center gap-1 cursor-pointer transition"
        >
          <span>Unit:</span>
          <span class="text-white">{{ weightUnit() === 'kg' ? 'KG' : 'LBS' }}</span>
        </button>
      </div>

      <div class="space-y-3.5">
        <!-- 1. Rider Weight -->
        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <label class="text-slate-300 font-medium">Rider Weight</label>
            <span class="text-[10px] text-slate-500 font-mono">in {{ weightUnit() }}</span>
          </div>
          <div class="relative">
            <input
              type="number"
              [min]="30"
              [max]="250"
              step="0.5"
              [ngModel]="riderWeight()"
              (ngModelChange)="onRiderWeightChange($event)"
              placeholder="e.g. {{ weightUnit() === 'kg' ? '75.0' : '165.0' }}"
              class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
            />
            <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">{{ weightUnit() }}</span>
          </div>
        </div>

        <!-- 2. Bike Weight (dry, without water/food) -->
        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <label class="text-slate-300 font-medium">Bike Weight (Dry)</label>
            <span class="text-[10px] text-slate-500 font-mono">without water & food</span>
          </div>
          <div class="relative">
            <input
              type="number"
              [min]="4"
              [max]="50"
              step="0.1"
              [ngModel]="bikeWeight()"
              (ngModelChange)="onBikeWeightChange($event)"
              placeholder="e.g. {{ weightUnit() === 'kg' ? '12.5' : '27.5' }}"
              class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
            />
            <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">{{ weightUnit() }}</span>
          </div>
          <p class="text-[10px] text-slate-500 mt-1">Weight of bike + bags + gear (excluding consumable water and food).</p>
        </div>

        <!-- Optional Gear Weight Breakdown (when gearWeight is supplied) -->
        @if (gearWeight() !== null) {
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <label class="text-slate-300 font-medium">Gear & Bags Weight</label>
              <span class="text-[10px] text-slate-500 font-mono">in {{ weightUnit() }}</span>
            </div>
            <div class="relative">
              <input
                type="number"
                [min]="0"
                [max]="30"
                step="0.1"
                [ngModel]="gearWeight()"
                (ngModelChange)="onGearWeightChange($event)"
                placeholder="e.g. {{ weightUnit() === 'kg' ? '5.0' : '11.0' }}"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
              />
              <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">{{ weightUnit() }}</span>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">Dedicated bags, sleep kit, cook kit, and equipment.</p>
          </div>
        }

        <!-- 3. Water Capacity (in Liters) -->
        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <label class="text-slate-300 font-medium">Water Carrying Capacity</label>
            <span class="text-[10px] text-emerald-400 font-mono">in Liters</span>
          </div>
          <div class="relative">
            <input
              type="number"
              [min]="0"
              [max]="15"
              step="0.25"
              [ngModel]="waterCapacityLiters()"
              (ngModelChange)="onWaterCapacityChange($event)"
              placeholder="e.g. 4.0"
              class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
            />
            <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">Liters (L)</span>
          </div>
          <p class="text-[10px] text-slate-500 mt-1">Total volume of bottles + bladder / hydration packs (1 L = 1 kg / 2.2 lbs).</p>
        </div>
      </div>

      <!-- Total Rig Weight Summary Bar -->
      @if (totalLoadedWeight() !== null) {
        <div class="mt-4 pt-3 border-t border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
          <div class="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
            <div class="text-[9px] uppercase font-mono text-slate-500">Water Wt</div>
            <div class="font-mono font-bold text-cyan-400 mt-0.5">{{ waterWeightInUnit() }} {{ weightUnit() }}</div>
          </div>
          <div class="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
            <div class="text-[9px] uppercase font-mono text-slate-500">Base Rig</div>
            <div class="font-mono font-bold text-slate-300 mt-0.5">{{ totalBaseWeight() }} {{ weightUnit() }}</div>
          </div>
          <div class="bg-slate-950/60 p-2 rounded-lg border border-emerald-900/50">
            <div class="text-[9px] uppercase font-mono text-emerald-400">Total Loaded</div>
            <div class="font-mono font-bold text-emerald-300 mt-0.5">{{ totalLoadedWeight() }} {{ weightUnit() }}</div>
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class SettingsRiderRigComponent {
  readonly riderWeight = input<number | null>(null);
  readonly bikeWeight = input<number | null>(null);
  readonly gearWeight = input<number | null>(null);
  readonly waterCapacityLiters = input<number | null>(null);
  readonly weightUnit = input<WeightUnit>('kg');
  readonly waterWeightInUnit = input<number>(0);
  readonly totalBaseWeight = input<number | null>(null);
  readonly totalLoadedWeight = input<number | null>(null);

  readonly toggleWeightUnit = output<void>();
  readonly riderWeightChange = output<number | null>();
  readonly bikeWeightChange = output<number | null>();
  readonly gearWeightChange = output<number | null>();
  readonly waterCapacityChange = output<number | null>();

  onRiderWeightChange(value: number | null | undefined): void {
    if (value === null || value === undefined || isNaN(value) || value <= 0) {
      this.riderWeightChange.emit(null);
    } else {
      this.riderWeightChange.emit(value);
    }
  }

  onBikeWeightChange(value: number | null | undefined): void {
    if (value === null || value === undefined || isNaN(value) || value <= 0) {
      this.bikeWeightChange.emit(null);
    } else {
      this.bikeWeightChange.emit(value);
    }
  }

  onGearWeightChange(value: number | null | undefined): void {
    if (value === null || value === undefined || isNaN(value) || value < 0) {
      this.gearWeightChange.emit(null);
    } else {
      this.gearWeightChange.emit(value);
    }
  }

  onWaterCapacityChange(value: number | null | undefined): void {
    if (value === null || value === undefined || isNaN(value) || value < 0) {
      this.waterCapacityChange.emit(null);
    } else {
      this.waterCapacityChange.emit(value);
    }
  }
}
