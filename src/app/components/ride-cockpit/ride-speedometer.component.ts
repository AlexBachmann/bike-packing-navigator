import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ride-speedometer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      data-testid="speedometer-widget"
      class="pointer-events-auto shrink-0 bg-slate-950/90 border border-slate-800/90 rounded-2xl px-3.5 py-2 shadow-2xl backdrop-blur-md flex flex-col items-center min-w-[76px]"
    >
      <span class="text-[9px] uppercase font-mono font-bold tracking-wider text-slate-400">Speed</span>
      <div class="flex items-baseline gap-1 my-0.5">
        <span class="text-2xl font-black font-mono text-emerald-400 leading-none" data-testid="speed-value">
          {{ speedValue() }}
        </span>
        <span class="text-[10px] font-mono font-bold text-slate-400 uppercase" data-testid="speed-unit">
          {{ speedUnit() }}
        </span>
      </div>
      <span class="sr-only" data-testid="speed-text">{{ speedText() }}</span>
    </div>
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
}
