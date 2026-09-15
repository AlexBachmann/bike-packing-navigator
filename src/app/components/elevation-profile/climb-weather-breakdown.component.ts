import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClimbKmWeatherPoint } from '../../models/weather.model';

@Component({
  selector: 'app-climb-weather-breakdown',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-lg bg-slate-950 border border-slate-800 p-2.5 space-y-2" data-testid="climb-weather-breakdown">
      <div class="flex items-center justify-between text-[10px] text-slate-400 uppercase font-mono tracking-wider border-b border-slate-800 pb-1 px-1">
        <span>1 KM Interval Forecast (matched to your estimated arrival)</span>
        <span class="text-emerald-400 font-semibold" data-testid="km-points-count">{{ kmPoints().length }} points</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1" data-testid="km-points-grid">
        @for (pt of kmPoints(); track pt.climbKm) {
          <div
            class="p-2.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 transition"
            [ngClass]="{
              'bg-rose-950/60 border-rose-500/80 text-rose-200': pt.weatherAtArrival.isThunderstorm,
              'bg-slate-900/80 border-slate-800/80 text-slate-300': !pt.weatherAtArrival.isThunderstorm
            }"
            data-testid="km-point-item"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-lg shrink-0 select-none">{{ pt.weatherAtArrival.weatherIcon }}</span>
              <div class="min-w-0">
                <div class="font-bold text-white text-[11px] flex flex-wrap items-center gap-1.5 leading-tight">
                  <span>
                    @if ($first) {
                      Base
                    } @else if ($last) {
                      Summit
                    } @else {
                      @if (unit() === 'miles') {
                        +{{ (pt.climbKm / 1.60934).toFixed(1) }} mi
                      } @else {
                        +{{ pt.climbKm.toFixed(1) }} km
                      }
                    }
                  </span>
                  <span class="text-[10px] text-slate-400 font-normal">
                    @if (unit() === 'miles') {
                      (Mi {{ pt.routeMile.toFixed(1) }})
                    } @else {
                      (KM {{ pt.routeKm.toFixed(1) }})
                    }
                  </span>
                  @if (pt.weatherAtArrival.isThunderstorm) {
                    <span class="px-1 py-0.5 rounded text-[8.5px] font-bold bg-rose-500/30 text-rose-300 border border-rose-500/50 leading-none" data-testid="storm-badge">
                      ⚡ STORM
                    </span>
                  }
                </div>
                <div class="text-[9.5px] text-slate-400 mt-0.5 leading-tight">
                  Elev: {{ unit() === 'miles' ? pt.elevationFt.toLocaleString() + ' ft' : pt.elevationM.toLocaleString() + ' m' }}
                  • ETA: {{ pt.estimatedArrivalFormatted }}
                </div>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-bold text-xs" [ngClass]="pt.weatherAtArrival.isThunderstorm ? 'text-rose-300' : 'text-slate-100'">
                @if (unit() === 'miles') {
                  {{ pt.weatherAtArrival.tempF }}°F
                } @else {
                  {{ pt.weatherAtArrival.tempC }}°C
                }
              </div>
              <div class="text-[9.5px] text-slate-400 mt-0.5 leading-tight">
                @if (unit() === 'miles') {
                  {{ pt.weatherAtArrival.precipitationInches > 0 ? pt.weatherAtArrival.precipitationInches + 'in' : 'Dry' }}
                  • {{ pt.weatherAtArrival.windSpeedMph }}mph
                } @else {
                  {{ pt.weatherAtArrival.precipitationMm > 0 ? pt.weatherAtArrival.precipitationMm + 'mm' : 'Dry' }}
                  • {{ pt.weatherAtArrival.windSpeedKmh }}km/h
                }
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ClimbWeatherBreakdownComponent {
  readonly kmPoints = input<ClimbKmWeatherPoint[]>([]);
  readonly unit = input<'miles' | 'km'>('miles');
}
