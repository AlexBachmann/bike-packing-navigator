import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TurnCue, TurnDirection } from '../../models/ride-cockpit.model';

export function getTurnIcon(direction: TurnDirection): string {
  switch (direction) {
    case 'slight-left': return '↖️';
    case 'left': return '⬅️';
    case 'sharp-left': return '↙️';
    case 'slight-right': return '↗️';
    case 'right': return '➡️';
    case 'sharp-right': return '↘️';
    default: return '⬆️';
  }
}

@Component({
  selector: 'app-ride-turn-guidance-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (turnCue(); as cue) {
      <div
        data-testid="turn-ahead-chip"
        role="status"
        aria-live="polite"
        class="pointer-events-auto max-w-[90%] bg-slate-900/95 backdrop-blur-md border border-emerald-500/40 text-slate-100 px-4 py-2 rounded-full shadow-2xl flex items-center gap-2.5 text-xs font-semibold tracking-wide animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <span class="text-base text-emerald-400 font-bold shrink-0">
          {{ getTurnIcon(cue.direction) }}
        </span>
        <span class="truncate">{{ cue.displayText }}</span>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RideTurnGuidanceBannerComponent {
  readonly turnCue = input<TurnCue | null>(null);

  getTurnIcon(direction: TurnDirection): string {
    return getTurnIcon(direction);
  }
}
