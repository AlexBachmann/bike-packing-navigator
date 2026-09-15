import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface ResupplyStopItem {
  id: string;
  name: string;
  town?: string;
  routeMile: number;
  distAhead: number;
  distAheadMiles: number;
  distAheadKm: number;
  estimatedHours: number;
  timeFormatted: string;
  badgeIcon: string;
  badgeLabel: string;
}

export type DistanceUnit = 'miles' | 'km';

@Component({
  selector: 'app-resupply-distance-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 shadow-xl backdrop-blur-sm space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>🎯</span>
            <span>Target Distance Selection</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Pick an upcoming resupply waypoint (> 10 km ahead) or define a custom push distance</p>
        </div>
        <div class="text-right">
          <span class="text-lg font-black font-mono text-emerald-400">{{ targetDistance() }}</span>
          <span class="text-xs font-mono text-slate-400 ml-1">{{ unit() === 'miles' ? 'mi' : 'km' }}</span>
        </div>
      </div>

      <!-- Segmented Toggle: Upcoming Stops vs Custom Distance -->
      <div class="flex rounded-xl bg-slate-950/80 p-1 border border-slate-800 text-xs font-semibold">
        <button
          type="button"
          (click)="modeChange.emit('stops')"
          class="flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer"
          [ngClass]="distanceSelectionMode() === 'stops' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
        >
          <span>🏪</span>
          <span>Upcoming Stops ({{ upcomingStops().length }})</span>
        </button>
        <button
          type="button"
          (click)="modeChange.emit('custom')"
          class="flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer"
          [ngClass]="distanceSelectionMode() === 'custom' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
        >
          <span>📏</span>
          <span>Custom Distance</span>
        </button>
      </div>

      <!-- Mode A: Upcoming Stops Carousel/List -->
      @if (distanceSelectionMode() === 'stops') {
        @if (upcomingStops().length === 0) {
          <div class="py-6 text-center text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800/80">
            <span class="text-2xl block mb-1">🏁</span>
            <span class="text-xs font-semibold">No upcoming resupply POIs found ahead (> 10 km from current location).</span>
            <div class="mt-2">
              <button
                type="button"
                (click)="modeChange.emit('custom')"
                class="px-3 py-1 rounded-lg bg-slate-800 text-xs text-emerald-400 font-bold border border-emerald-500/30 hover:bg-slate-700 transition cursor-pointer"
              >
                Use Custom Distance
              </button>
            </div>
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
            @for (stop of upcomingStops(); track stop.id) {
              <button
                type="button"
                (click)="selectStop.emit(stop)"
                class="p-2.5 rounded-xl border text-left transition flex items-center justify-between gap-2 cursor-pointer active:scale-[0.98]"
                [ngClass]="selectedStopId() === stop.id
                  ? 'bg-emerald-950/60 border-emerald-500 text-emerald-100 shadow-md shadow-emerald-950/30 ring-1 ring-emerald-500'
                  : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800/50'"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="text-sm leading-none">{{ stop.badgeIcon }}</span>
                    <span class="font-bold text-xs truncate">{{ stop.name }}</span>
                  </div>
                  <div class="text-[11px] text-slate-400 flex items-center gap-2">
                    @if (stop.town) {
                      <span class="truncate">{{ stop.town }}</span>
                      <span>•</span>
                    }
                    <span>Mile {{ stop.routeMile.toFixed(1) }}</span>
                  </div>
                </div>

                <div class="text-right shrink-0">
                  <div class="font-black font-mono text-xs" [ngClass]="selectedStopId() === stop.id ? 'text-emerald-300' : 'text-slate-200'">
                    +{{ stop.distAhead }} {{ unit() === 'miles' ? 'mi' : 'km' }}
                  </div>
                  <div class="text-[10px] text-slate-400 font-mono">
                    ~{{ stop.timeFormatted }}
                  </div>
                </div>
              </button>
            }
          </div>
        }
      }

      <!-- Mode B: Custom Distance Controls & Presets -->
      @if (distanceSelectionMode() === 'custom') {
        <div class="space-y-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="adjustDistance.emit(-10)"
              class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-xs active:scale-95 transition cursor-pointer"
              [title]="'-10 ' + (unit() === 'miles' ? 'mi' : 'km')"
            >
              -10
            </button>
            <button
              type="button"
              (click)="adjustDistance.emit(-5)"
              class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-xs active:scale-95 transition cursor-pointer"
              [title]="'-5 ' + (unit() === 'miles' ? 'mi' : 'km')"
            >
              -5
            </button>

            <div class="flex-1 relative">
              <input
                type="number"
                min="1"
                max="2000"
                step="1"
                [ngModel]="targetDistance()"
                (ngModelChange)="onCustomDistanceInputChange($event)"
                class="w-full h-10 bg-slate-900 border border-slate-700 rounded-xl text-center font-mono font-black text-emerald-400 text-base focus:outline-none focus:border-emerald-500 transition px-2"
                aria-label="Custom target distance"
              />
              <span class="absolute right-3 top-2.5 text-xs text-slate-400 font-mono pointer-events-none">
                {{ unit() === 'miles' ? 'mi' : 'km' }}
              </span>
            </div>

            <button
              type="button"
              (click)="adjustDistance.emit(5)"
              class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-xs active:scale-95 transition cursor-pointer"
              [title]="'+5 ' + (unit() === 'miles' ? 'mi' : 'km')"
            >
              +5
            </button>
            <button
              type="button"
              (click)="adjustDistance.emit(10)"
              class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 flex items-center justify-center text-xs active:scale-95 transition cursor-pointer"
              [title]="'+10 ' + (unit() === 'miles' ? 'mi' : 'km')"
            >
              +10
            </button>
          </div>

          <!-- Quick Preset Chips -->
          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Presets:</span>
            @for (preset of distancePresets(); track preset) {
              <button
                type="button"
                (click)="distanceChange.emit(preset)"
                class="px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition border active:scale-95 cursor-pointer"
                [ngClass]="targetDistance() === preset
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700 hover:bg-slate-850'"
              >
                {{ preset }} {{ unit() === 'miles' ? 'mi' : 'km' }}
              </button>
            }
          </div>
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ResupplyDistanceSelectorComponent {
  readonly upcomingStops = input.required<ResupplyStopItem[]>();
  readonly selectedStopId = input<string | null>(null);
  readonly distanceSelectionMode = input<'stops' | 'custom'>('stops');
  readonly targetDistance = input.required<number>();
  readonly unit = input<DistanceUnit>('miles');
  readonly distancePresets = input<number[]>([25, 50, 75, 100, 150]);

  readonly selectStop = output<ResupplyStopItem>();
  readonly modeChange = output<'stops' | 'custom'>();
  readonly distanceChange = output<number>();
  readonly adjustDistance = output<number>();

  onCustomDistanceInputChange(value: number): void {
    if (!isNaN(value) && value > 0) {
      const clamped = Math.max(1, Math.min(2000, Math.round(value * 10) / 10));
      this.distanceChange.emit(clamped);
    }
  }
}
