import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ride-speedometer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      type="button"
      data-testid="speedometer-widget"
      (click)="toggleSimulator.emit()"
      (keydown.enter)="toggleSimulator.emit()"
      (keydown.space)="$event.preventDefault(); toggleSimulator.emit()"
      class="pointer-events-auto shrink-0 bg-slate-950/90 border border-slate-800/90 hover:border-slate-700 active:scale-95 rounded-2xl px-3.5 py-2 shadow-2xl backdrop-blur-md flex flex-col items-center min-w-[76px] transition cursor-pointer select-none text-left"
      aria-label="Toggle GPS Simulator"
      title="Tap to toggle GPS simulator"
    >
      <div class="flex items-center gap-1.5">
        <span class="text-[9px] uppercase font-mono font-bold tracking-wider text-slate-400">Speed</span>
        @if (isSimulating()) {
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping" title="GPS Simulator active"></span>
        }
      </div>
      <div class="flex items-baseline gap-1 my-0.5">
        <span class="text-2xl font-black font-mono text-emerald-400 leading-none" data-testid="speed-value">
          {{ speedValue() }}
        </span>
        <span class="text-[10px] font-mono font-bold text-slate-400 uppercase" data-testid="speed-unit">
          {{ speedUnit() }}
        </span>
      </div>
      <span class="sr-only" data-testid="speed-text">{{ speedText() }}</span>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RideSpeedometerComponent {
  readonly speedValue = input.required<string>();
  readonly speedUnit = input.required<string>();
  readonly speedText = input<string>('');
  readonly isSimulating = input<boolean>(false);

  readonly toggleSimulator = output<void>();
}

