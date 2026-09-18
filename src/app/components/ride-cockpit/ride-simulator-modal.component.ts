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
    <!-- Compact Simulator Modal Dropdown (Opened by tapping header button or speedometer) -->
    @if (isOpen()) {
      <!-- Click-outside backdrop -->
      <div
        class="fixed inset-0 z-40"
        (click)="onToggleOpenClick()"
      ></div>
      <div
        data-testid="simulator-modal"
        [ngClass]="position() === 'top'
          ? 'top-full mt-2 inset-x-0 mx-auto sm:inset-x-auto sm:mx-0 sm:right-0'
          : 'bottom-20 sm:bottom-16 inset-x-0 mx-auto sm:inset-x-auto sm:mx-0 sm:right-0'"
        class="absolute w-72 max-w-[calc(100vw-2rem)] bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 animate-in fade-in duration-150 z-50 pointer-events-auto"
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

        <!-- Speed Control: -25 button - 5 button | speed value | +5 button +25 button -->
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase font-mono text-slate-400">Speed (km/h)</label>
          <div class="flex items-center gap-1">
            <!-- -25 Button -->
            <button
              type="button"
              data-testid="sim-speed-minus-25"
              (click)="onAdjustSpeed(-25)"
              class="flex-1 py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 active:scale-95 rounded text-[11px] font-mono font-semibold transition cursor-pointer text-center"
              title="Decrease speed by 25 km/h"
            >
              -25
            </button>

            <!-- -5 Button -->
            <button
              type="button"
              data-testid="sim-speed-minus-5"
              (click)="onAdjustSpeed(-5)"
              class="flex-1 py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 active:scale-95 rounded text-[11px] font-mono font-semibold transition cursor-pointer text-center"
              title="Decrease speed by 5 km/h"
            >
              -5
            </button>

            <!-- Speed Value Input -->
            <input
              type="number"
              data-testid="sim-speed-input"
              [value]="speed()"
              (input)="onSpeedInput($event)"
              step="1"
              class="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500 text-center shrink-0"
              title="Current speed (km/h)"
            />

            <!-- +5 Button -->
            <button
              type="button"
              data-testid="sim-speed-plus-5"
              (click)="onAdjustSpeed(5)"
              class="flex-1 py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 active:scale-95 rounded text-[11px] font-mono font-semibold transition cursor-pointer text-center"
              title="Increase speed by 5 km/h"
            >
              +5
            </button>

            <!-- +25 Button -->
            <button
              type="button"
              data-testid="sim-speed-plus-25"
              (click)="onAdjustSpeed(25)"
              class="flex-1 py-1.5 px-1 bg-slate-800 hover:bg-slate-700 text-slate-200 active:scale-95 rounded text-[11px] font-mono font-semibold transition cursor-pointer text-center"
              title="Increase speed by 25 km/h"
            >
              +25
            </button>
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
    class: 'contents'
  }
})
export class RideSimulatorModalComponent {
  // Inputs
  readonly isOpen = input<boolean>(false);
  readonly isRunning = input<boolean>(false);
  readonly speed = input<number>(15);
  readonly position = input<'top' | 'bottom'>('top');

  // Outputs
  readonly toggleOpen = output<void>();
  readonly speedChange = output<number>();
  readonly togglePlay = output<void>();
  readonly reset = output<void>();

  onSpeedInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const val = Number(target.value);
    if (!isNaN(val)) {
      this.speedChange.emit(val);
    }
  }

  onAdjustSpeed(delta: number): void {
    const nextSpeed = this.speed() + delta;
    this.speedChange.emit(nextSpeed);
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

