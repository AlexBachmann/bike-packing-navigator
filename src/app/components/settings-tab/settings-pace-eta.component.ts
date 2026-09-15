import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaceMode, DistanceUnit } from '../../models/settings.model';

@Component({
  selector: 'app-settings-pace-eta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="font-bold text-white text-sm flex items-center gap-1.5">
            <span>⏱️</span>
            <span>Pace & ETA Calculation</span>
          </h2>
          <p class="text-[11px] text-slate-400 mt-0.5">Switch between rider power or average speed estimation.</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 mb-2">
        <button
          type="button"
          (click)="onSetPaceMode('power')"
          class="p-2.5 rounded-lg border text-left cursor-pointer transition"
          [ngClass]="paceMode() === 'power'
            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-300 shadow-sm'
            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold text-xs flex items-center gap-1.5">⚡ Power Model</span>
            @if (paceMode() === 'power') {
              <span class="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-500/20 px-1.5 py-0.5 rounded">ACTIVE</span>
            }
          </div>
          <p class="text-[10px] text-slate-400 mt-1">Estimates climbing speed based on rider power ({{ riderPowerWatts() }}W) and total rig weight.</p>
        </button>

        <button
          type="button"
          (click)="onSetPaceMode('speed')"
          class="p-2.5 rounded-lg border text-left cursor-pointer transition"
          [ngClass]="paceMode() === 'speed'
            ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-300 shadow-sm'
            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold text-xs flex items-center gap-1.5">🚴 Speed Model</span>
            @if (paceMode() === 'speed') {
              <span class="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-500/20 px-1.5 py-0.5 rounded">ACTIVE</span>
            }
          </div>
          <p class="text-[10px] text-slate-400 mt-1">Estimates travel time using continuous flat average speed ({{ displaySpeed().toFixed(1) }} {{ speedUnit() }}).</p>
        </button>
      </div>

      <!-- Power Model Advanced Parameters (Climb Surge & Hike-a-Bike) -->
      @if (paceMode() === 'power') {
        <div class="mt-4 pt-3 border-t border-slate-800 space-y-3.5">
          <div>
            <div class="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <span>⚡</span>
              <span>Climb Surge & Hike-a-Bike Parameters</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-relaxed mt-1">
              We use the following parameters in the Power Model (only) to estimate your speed in different segments depending on various variables. It's completely okay to give rough estimates based on your fitness level.
            </p>
          </div>

          <!-- 1. Climb Surge (%) -->
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <label class="text-slate-300 font-medium">Climb Surge</label>
              <span class="text-[10px] text-emerald-400 font-mono">max +{{ climbSurgeWattsDelta() }}W</span>
            </div>
            <div class="relative">
              <input
                type="number"
                [min]="0"
                [max]="100"
                step="5"
                [ngModel]="climbSurgePercent()"
                (ngModelChange)="onClimbSurgePercentChange($event)"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
              />
              <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">% extra power</span>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">
              Extra power you can output on steep climbs to stay on the bike. At {{ riderPowerWatts() }}W baseline: max {{ maxClimbSurgePowerWatts() }}W.
            </p>
          </div>

          <!-- 2. Climb Surge Duration (min) -->
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <label class="text-slate-300 font-medium">Climb Surge Duration</label>
              <span class="text-[10px] text-emerald-400 font-mono">in minutes</span>
            </div>
            <div class="relative">
              <input
                type="number"
                [min]="1"
                [max]="60"
                step="1"
                [ngModel]="climbSurgeDurationMinutes()"
                (ngModelChange)="onClimbSurgeDurationMinutesChange($event)"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
              />
              <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">Minutes</span>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">
              Maximum time holding excessive power. Reaching this limit triggers a 15-min hike-a-bike cool-off (cancelled early if summit is reached).
            </p>
          </div>

          <!-- 3. Hike-a-Bike Speed Threshold -->
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <label class="text-slate-300 font-medium">Hike-a-Bike Speed Threshold</label>
              <span class="text-[10px] text-amber-400 font-mono">switch to push</span>
            </div>
            <div class="relative">
              <input
                type="number"
                [min]="distanceUnit() === 'miles' ? 1 : 2"
                [max]="distanceUnit() === 'miles' ? 10 : 15"
                [step]="distanceUnit() === 'miles' ? 0.1 : 0.5"
                [ngModel]="displayHikeBikeThreshold()"
                (ngModelChange)="onHikeBikeThresholdChange($event)"
                placeholder="e.g. {{ distanceUnit() === 'miles' ? '3.7' : '6.0' }}"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
              />
              <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">
                @if (distanceUnit() === 'miles') {
                  mph ({{ hikeBikeThresholdKmh().toFixed(1) }} km/h)
                } @else {
                  km/h ({{ (hikeBikeThresholdKmh() * 0.621371).toFixed(1) }} mph)
                }
              </span>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">
              If riding speed drops below this threshold even with Climb Surge, you jump off and push the bike.
            </p>
          </div>

          <!-- 4. Average Hike-a-Bike Speed -->
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <label class="text-slate-300 font-medium">Average Hike-a-Bike Speed (Flat)</label>
              <span class="text-[10px] text-teal-400 font-mono">base walking</span>
            </div>
            <div class="relative">
              <input
                type="number"
                [min]="distanceUnit() === 'miles' ? 0.5 : 1"
                [max]="distanceUnit() === 'miles' ? 5 : 8"
                [step]="distanceUnit() === 'miles' ? 0.1 : 0.5"
                [ngModel]="displayHikeBikeBaseSpeed()"
                (ngModelChange)="onHikeBikeBaseSpeedChange($event)"
                placeholder="e.g. {{ distanceUnit() === 'miles' ? '2.5' : '4.0' }}"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
              />
              <span class="absolute right-3 top-2.5 text-xs font-mono text-slate-500">
                @if (distanceUnit() === 'miles') {
                  mph ({{ hikeBikeBaseSpeedKmh().toFixed(1) }} km/h)
                } @else {
                  km/h ({{ (hikeBikeBaseSpeedKmh() * 0.621371).toFixed(1) }} mph)
                }
              </span>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">
              Enter your base walking speed while pushing your loaded bike on flat ground. The app automatically scales this down for you based on climb gradient (e.g. half speed at 20% grade), trail surface, and rig weight.
            </p>
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
export class SettingsPaceEtaComponent {
  readonly paceMode = input<PaceMode>('power');
  readonly riderPowerWatts = input<number>(150);
  readonly displaySpeed = input<number>(10.5);
  readonly speedUnit = input<string>('mph');
  readonly distanceUnit = input<DistanceUnit>('miles');

  readonly climbSurgePercent = input<number>(10);
  readonly climbSurgeWattsDelta = input<number>(15);
  readonly maxClimbSurgePowerWatts = input<number>(165);
  readonly climbSurgeDurationMinutes = input<number>(10);

  readonly displayHikeBikeThreshold = input<number>(3.7);
  readonly hikeBikeThresholdKmh = input<number>(6.0);
  readonly displayHikeBikeBaseSpeed = input<number>(2.5);
  readonly hikeBikeBaseSpeedKmh = input<number>(4.0);

  readonly paceModeChange = output<PaceMode>();
  readonly climbSurgePercentChange = output<number>();
  readonly climbSurgeDurationMinutesChange = output<number>();
  readonly hikeBikeThresholdChange = output<number>();
  readonly hikeBikeBaseSpeedChange = output<number>();

  onSetPaceMode(mode: PaceMode): void {
    this.paceModeChange.emit(mode);
  }

  onClimbSurgePercentChange(value: number): void {
    if (value !== null && value !== undefined && !isNaN(value)) {
      this.climbSurgePercentChange.emit(value);
    }
  }

  onClimbSurgeDurationMinutesChange(value: number): void {
    if (value !== null && value !== undefined && !isNaN(value)) {
      this.climbSurgeDurationMinutesChange.emit(value);
    }
  }

  onHikeBikeThresholdChange(value: number): void {
    if (value !== null && value !== undefined && !isNaN(value)) {
      this.hikeBikeThresholdChange.emit(value);
    }
  }

  onHikeBikeBaseSpeedChange(value: number): void {
    if (value !== null && value !== undefined && !isNaN(value)) {
      this.hikeBikeBaseSpeedChange.emit(value);
    }
  }
}
