import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ride-simulator-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Simulator Floating Action Button -->
    <button
      type="button"
      data-testid="simulator-fab"
      (click)="onToggleOpenClick()"
      [ngClass]="isRunning() ? 'bg-emerald-500 text-slate-950' : 'bg-slate-900/90 text-slate-200 border-slate-700'"
      class="w-11 h-11 rounded-2xl border shadow-xl flex items-center justify-center text-lg backdrop-blur-md transition hover:scale-105 active:scale-95 cursor-pointer"
      aria-label="Toggle GPS Simulator"
      [title]="isRunning() ? 'Simulator Running' : 'Open GPS Simulator'"
    >
      @if (isRunning()) {
        <span class="animate-pulse">▶️</span>
      } @else {
        <span>🎮</span>
      }
    </button>

    <!-- Compact Simulator Modal Dropdown -->
    @if (isOpen()) {
      <div
        data-testid="simulator-modal"
        class="absolute bottom-14 left-0 w-64 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150 z-40"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
            <span>🎮</span> GPS Simulator
          </span>
          <button
            type="button"
            (click)="onToggleOpenClick()"
            class="text-slate-400 hover:text-slate-200 text-xs p-1 cursor-pointer"
            aria-label="Close GPS Simulator modal"
          >
            ✕
          </button>
        </div>

        <!-- Speed Input & Presets -->
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase font-mono text-slate-400">Speed (km/h)</label>
          <div class="flex items-center gap-2">
            <input
              type="number"
              data-testid="sim-speed-input"
              [value]="speed()"
              (input)="onSpeedInput($event)"
              min="0"
              max="120"
              step="1"
              class="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <div class="flex items-center gap-1">
              @for (preset of presets(); track preset) {
                <button
                  type="button"
                  (click)="onPresetClick(preset)"
                  [ngClass]="speed() === preset ? 'bg-slate-700 text-emerald-400 font-bold' : 'bg-slate-800 text-slate-300'"
                  class="px-1.5 py-1 rounded text-[10px] font-mono hover:bg-slate-700 transition cursor-pointer"
                >
                  {{ preset }}
                </button>
              }
            </div>
          </div>
        </div>

        <!-- Play / Stop & Reset Actions -->
        <div class="flex items-center gap-2 pt-1 border-t border-slate-800">
          <button
            type="button"
            data-testid="sim-play-stop-btn"
            (click)="onTogglePlayClick()"
            [ngClass]="isRunning() ? 'bg-rose-500 hover:bg-rose-400 text-slate-950' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'"
            class="flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg"
          >
            @if (isRunning()) {
              <span>⏹️</span> Stop
            } @else {
              <span>▶️</span> Play
            }
          </button>
          <button
            type="button"
            data-testid="sim-reset-btn"
            (click)="onResetClick()"
            class="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-mono transition cursor-pointer"
            title="Reset to route start"
          >
            ↺ Reset
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pointer-events-auto relative shrink-0'
  }
})
export class RideSimulatorModalComponent {
  // Inputs
  readonly isOpen = input<boolean>(false);
  readonly isRunning = input<boolean>(false);
  readonly speed = input<number>(15);
  readonly presets = input<number[]>([10, 15, 25, 45]);

  // Outputs
  readonly toggleOpen = output<void>();
  readonly speedChange = output<number>();
  readonly presetSelect = output<number>();
  readonly togglePlay = output<void>();
  readonly reset = output<void>();

  onSpeedInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const val = Number(target.value);
    if (!isNaN(val)) {
      const clamped = Math.max(0, Math.min(120, val));
      this.speedChange.emit(clamped);
    }
  }

  onPresetClick(speedPreset: number): void {
    this.presetSelect.emit(speedPreset);
  }

  onTogglePlayClick(): void {
    this.togglePlay.emit();
  }

  onResetClick(): void {
    this.reset.emit();
  }

  onToggleOpenClick(): void {
    this.toggleOpen.emit();
  }
}
