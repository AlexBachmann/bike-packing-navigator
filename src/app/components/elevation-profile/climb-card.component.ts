import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpcomingClimb } from '../../models/elevation.model';
import { ClimbWeatherBreakdownComponent } from './climb-weather-breakdown.component';

@Component({
  selector: 'app-climb-card',
  standalone: true,
  imports: [CommonModule, ClimbWeatherBreakdownComponent],
  template: `
    <div
      class="bg-slate-900/80 border rounded-xl p-3.5 transition flex flex-col gap-2.5"
      [ngClass]="{
        'border-amber-500/50 bg-amber-950/20 shadow-lg shadow-amber-950/20': climb().status === 'climbing',
        'border-slate-800/90 hover:border-slate-700': climb().status === 'upcoming',
        'opacity-60 border-slate-800/60 bg-slate-900/50': climb().status === 'passed'
      }"
      data-testid="climb-card"
    >
      <!-- Climb Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <!-- Status Badge -->
          @if (climb().status === 'passed') {
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700">
              ✔ PASSED
            </span>
          } @else if (climb().status === 'climbing') {
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/25 text-amber-300 border border-amber-500/50 animate-pulse flex items-center gap-1">
              <span>⚡</span> CURRENT CLIMB
            </span>
          } @else {
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
              UPCOMING
            </span>
          }

          <!-- Iconic Pass Badge -->
          @if (climb().isIconic) {
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/60 flex items-center gap-1">
              <span>🏔️</span> ICONIC PASS
            </span>
          }

          <!-- State Badge -->
          <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
            {{ climb().state }}
          </span>

          <!-- Difficulty Badge -->
          @if (climb().difficulty) {
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase"
              [ngClass]="{
                'bg-rose-950 text-rose-300 border border-rose-800': climb().difficulty === 'extreme',
                'bg-orange-950 text-orange-300 border border-orange-800': climb().difficulty === 'difficult',
                'bg-yellow-950 text-yellow-300 border border-yellow-800': climb().difficulty === 'moderate'
              }"
            >
              {{ climb().difficulty }}
            </span>
          }
        </div>

        <!-- Miniature Profile Sparkline -->
        @if (climb().miniProfile; as mini) {
          <div
            class="flex-1 flex items-center justify-center min-w-[65px] max-w-[170px] sm:max-w-[220px] h-9 sm:h-10 px-1.5 self-center"
            [ngClass]="climb().status === 'passed' ? 'opacity-50' : 'opacity-100'"
            title="Miniature elevation profile"
          >
            <svg
              [attr.viewBox]="'0 0 ' + mini.width + ' 36'"
              preserveAspectRatio="none"
              [style.width.px]="mini.width"
              class="max-w-full h-9 sm:h-10 overflow-visible shrink-0"
              aria-label="Miniature climb profile"
            >
              <defs>
                <linearGradient [id]="'miniSlopeGrad-' + climb().id" x1="0%" y1="0%" x2="100%" y2="0%">
                  @for (stop of mini.gradientStops; track $index) {
                    <stop [attr.offset]="stop.offset" [attr.stop-color]="stop.color" />
                  }
                </linearGradient>

                <linearGradient [id]="'miniAreaGrad-' + climb().id" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#10b981" stop-opacity="0.32" />
                  <stop offset="60%" stop-color="#059669" stop-opacity="0.12" />
                  <stop offset="100%" stop-color="#022c22" stop-opacity="0.0" />
                </linearGradient>
              </defs>

              <!-- Area Fill -->
              <path
                [attr.d]="mini.areaPathD"
                [attr.fill]="'url(#miniAreaGrad-' + climb().id + ')'"
              />

              <!-- Elevation Profile Line -->
              <path
                [attr.d]="mini.linePathD"
                fill="none"
                [attr.stroke]="'url(#miniSlopeGrad-' + climb().id + ')'"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              <!-- Base Anchor Dot -->
              <circle
                [attr.cx]="mini.startPoint.x"
                [attr.cy]="mini.startPoint.y"
                r="1.4"
                class="fill-slate-400 opacity-80"
              />

              <!-- Summit Peak Dot -->
              <circle
                [attr.cx]="mini.summitPoint.x"
                [attr.cy]="mini.summitPoint.y"
                r="2"
                class="fill-cyan-300 stroke-slate-950 stroke-[0.8]"
              />

              <!-- Active Climbing Rider Position Dot & Guideline -->
              @if (climb().status === 'climbing' && mini.riderDot) {
                <line
                  [attr.x1]="mini.riderDot.x"
                  [attr.y1]="mini.riderDot.y"
                  [attr.x2]="mini.riderDot.x"
                  [attr.y2]="36"
                  stroke="#38bdf8"
                  stroke-dasharray="1.5,1.5"
                  stroke-width="0.8"
                  opacity="0.7"
                />
                <circle
                  [attr.cx]="mini.riderDot.x"
                  [attr.cy]="mini.riderDot.y"
                  r="4"
                  class="fill-cyan-400/30 animate-ping"
                />
                <circle
                  [attr.cx]="mini.riderDot.x"
                  [attr.cy]="mini.riderDot.y"
                  r="2"
                  class="fill-cyan-300 stroke-slate-950 stroke-[1]"
                />
              }

              <!-- Thunderstorm Hazard Indicator on Miniature Profile -->
              @if (mini.thunderstormHazardPoint) {
                <circle
                  [attr.cx]="mini.thunderstormHazardPoint.x"
                  [attr.cy]="mini.thunderstormHazardPoint.y"
                  r="6"
                  class="fill-rose-500/50 animate-ping"
                />
                <circle
                  [attr.cx]="mini.thunderstormHazardPoint.x"
                  [attr.cy]="mini.thunderstormHazardPoint.y"
                  r="3.5"
                  class="fill-rose-600 stroke-amber-300 stroke-[0.8]"
                />
                <text
                  [attr.x]="mini.thunderstormHazardPoint.x"
                  [attr.y]="mini.thunderstormHazardPoint.y + 3"
                  text-anchor="middle"
                  font-size="8"
                  font-weight="bold"
                  class="select-none fill-amber-300 pointer-events-none"
                >
                  ⚡
                </text>
              }
            </svg>
          </div>
        }

        <!-- Summit Elevation & Span -->
        <div class="text-right font-mono shrink-0">
          <div class="font-bold text-white text-xs">
            @if (unit() === 'miles') {
              {{ climb().summitElevationFeet.toLocaleString() }} ft
            } @else {
              {{ climb().summitElevationMeters.toLocaleString() }} m
            }
          </div>
          <div class="text-[10px] text-slate-400">
            @if (unit() === 'miles') {
              Mi {{ climb().startMile.toFixed(1) }} → {{ climb().endMile.toFixed(1) }}
            } @else {
              KM {{ climb().startKm.toFixed(1) }} → {{ climb().endKm.toFixed(1) }}
            }
          </div>
        </div>
      </div>

      <!-- Climb Name & Description/Notes -->
      <div>
        <h4 class="font-bold text-white text-sm leading-snug flex flex-wrap items-center gap-1.5 break-words">
          <span>{{ climb().name }}</span>
        </h4>

        <!-- Geographic Context: Trail, Park & Landmark Badges -->
        @if (climb().trailName || climb().parkName || climb().landmark) {
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400 mt-1">
            @if (climb().trailName) {
              <span class="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <span class="select-none">🌲</span>
                <span>{{ climb().trailName }}</span>
              </span>
            }
            @if (climb().parkName) {
              <span class="inline-flex items-center gap-1 text-slate-400 text-[11px]">
                @if (climb().trailName) {
                  <span class="text-slate-600 select-none">•</span>
                }
                <span>🏞️ {{ climb().parkName }}</span>
              </span>
            }
            @if (climb().landmark) {
              <span class="inline-flex items-center gap-1 text-sky-400/90 text-[11px]">
                @if (climb().trailName || climb().parkName) {
                  <span class="text-slate-600 select-none">•</span>
                }
                <span>⛰️ {{ climb().landmark }}</span>
              </span>
            }
          </div>
        }

        <!-- Guidebook Notes -->
        @if (climb().notes) {
          <div class="mt-2 text-xs text-slate-300/90 leading-relaxed bg-slate-950/60 rounded-lg border-l-2 border-emerald-500/80 pl-3 pr-2.5 py-2 font-sans break-words">
            {{ climb().notes }}
          </div>
        }
      </div>

      <!-- Arrival Weather & Thunderstorm Hazard Section -->
      @if (climb().climbWeather; as weather) {
        <!-- Severe Thunderstorm Hazard Alert Banner -->
        @if (weather.hasThunderstormHazard && weather.thunderstormHazard) {
          <div class="rounded-xl p-3 bg-gradient-to-r from-rose-950/95 via-red-950/90 to-amber-950/80 border-2 border-rose-500/90 text-rose-100 flex items-start gap-3 shadow-lg shadow-rose-950/50 animate-pulse">
            <span class="text-2xl select-none shrink-0 leading-none mt-0.5">⚡</span>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center justify-between gap-1.5">
                <span class="font-bold text-xs uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>Thunderstorm Hazard at Arrival</span>
                </span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-900/90 border border-rose-500/80 font-bold text-white shadow-sm">
                  ETA: ~{{ weather.thunderstormHazard.estimatedTimeFormatted }}
                </span>
              </div>
              <p class="text-xs text-rose-200 mt-1 leading-snug font-medium">
                {{ weather.thunderstormHazard.message }}.
              </p>
              <p class="text-[10px] text-rose-300/90 font-mono mt-1 flex items-center gap-1">
                <span>⚡</span>
                <span>High lightning exposure hazard above treeline. Plan ascent timing or seek shelter before summiting.</span>
              </p>
            </div>
          </div>
        }

        <!-- Arrival Weather Summary Pill & Breakdown Toggle -->
        <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800/90 text-[11px] font-mono">
          <div class="flex flex-wrap items-center gap-2 text-slate-300">
            <span class="text-sm">{{ weather.summitWeather.weatherAtArrival.weatherIcon }}</span>
            <span class="font-semibold text-white">
              Summit at ETA (~{{ weather.estimatedSummitTimeFormatted }}):
            </span>
            <span [ngClass]="weather.hasThunderstormHazard ? 'text-rose-400 font-bold' : 'text-slate-300'">
              {{ weather.summitWeather.weatherAtArrival.weatherDescription }},
            </span>
            <span class="font-bold text-emerald-400">
              @if (unit() === 'miles') {
                {{ weather.summitWeather.weatherAtArrival.tempF }}°F
              } @else {
                {{ weather.summitWeather.weatherAtArrival.tempC }}°C
              }
            </span>
            <span class="text-slate-400">
              • 💨
              @if (unit() === 'miles') {
                {{ weather.summitWeather.weatherAtArrival.windSpeedMph }} mph
              } @else {
                {{ weather.summitWeather.weatherAtArrival.windSpeedKmh }} km/h
              }
              {{ weather.summitWeather.weatherAtArrival.windCardinal }}
            </span>
            <span class="text-slate-400">
              • 🌧️
              @if (unit() === 'miles') {
                {{ weather.summitWeather.weatherAtArrival.precipitationInches }} in
              } @else {
                {{ weather.summitWeather.weatherAtArrival.precipitationMm }} mm
              }
            </span>
          </div>
          <button
            type="button"
            (click)="onToggleWeather($event)"
            class="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer shrink-0 transition flex items-center gap-1 ml-auto"
          >
            <span>{{ isWeatherExpanded() ? '▲ Hide breakdown' : '▼ 1 km weather breakdown' }}</span>
          </button>
        </div>

        <!-- Fine-Grained 1 km Breakdown Drawer Component -->
        @if (isWeatherExpanded()) {
          <app-climb-weather-breakdown
            [kmPoints]="weather.kmPoints"
            [unit]="unit()"
          />
        }
      }

      <!-- Surface Firmness Grade & Explanation from OpenStreetMap -->
      @if (climb().firmness) {
        <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border font-mono"
            [ngClass]="{
              'bg-emerald-950/40 text-emerald-400 border-emerald-800/60': climb().tracktype === 'grade1',
              'bg-amber-950/40 text-amber-400 border-amber-800/60': climb().tracktype === 'grade2',
              'bg-yellow-950/40 text-yellow-400 border-yellow-800/60': climb().tracktype === 'grade3',
              'bg-orange-950/40 text-orange-400 border-orange-800/60': climb().tracktype === 'grade4',
              'bg-rose-950/40 text-rose-400 border-rose-800/60': climb().tracktype === 'grade5'
            }"
          >
            <span>🧱</span>
            <span>{{ climb().firmness }}</span>
          </span>
        </div>
      }

      <!-- Estimation Metrics (Estimated Time & Hike-a-Bike) -->
      <div class="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        <!-- Estimated Time Pill -->
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-700/80 text-slate-200">
          <span class="text-xs">⏱️</span>
          <span class="text-slate-400 font-medium">
            {{ climb().status === 'climbing' ? 'Estimated time remaining:' : 'Estimated time:' }}
          </span>
          <span class="font-bold text-amber-400">~{{ climb().estimatedTimeFormatted }}</span>
        </span>

        <!-- Hike-a-Bike Pill (Power Mode Only) -->
        @if (isPowerMode()) {
          <span
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px]"
            [ngClass]="climb().hikeBikeDistanceMeters > 0 ? 'bg-amber-950/40 border-amber-700/60 text-amber-300' : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400'"
          >
            <span class="text-xs">{{ climb().hikeBikeDistanceMeters > 0 ? '🥾' : '🚴' }}</span>
            <span class="opacity-80">
              {{ climb().status === 'climbing' ? 'Est. hike-a-bike remaining:' : 'Est. hike-a-bike:' }}
            </span>
            <span class="font-bold">
              @if (climb().hikeBikeDistanceMeters > 0) {
                {{ unit() === 'miles' ? climb().hikeBikeDistanceMiles.toFixed(1) + ' mi' : climb().hikeBikeDistanceKm.toFixed(1) + ' km' }}
                • ~{{ climb().hikeBikeTimeFormatted }}
              } @else {
                0 (100% rideable)
              }
            </span>
          </span>
        }
      </div>

      <!-- Telemetry Stats Pill Strip -->
      <div class="grid grid-cols-4 gap-1.5 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 text-center font-mono text-[10px]">
        <div>
          <span class="text-slate-500 uppercase block text-[8.5px]">Length</span>
          <span class="font-bold text-slate-200">
            @if (unit() === 'miles') {
              {{ climb().lengthMiles.toFixed(1) }} mi
            } @else {
              {{ climb().lengthKm.toFixed(1) }} km
            }
          </span>
        </div>
        <div>
          <span class="text-slate-500 uppercase block text-[8.5px]">Gain</span>
          <span class="font-bold text-amber-400">
            @if (unit() === 'miles') {
              +{{ climb().elevationGainFeet.toLocaleString() }} ft
            } @else {
              +{{ climb().elevationGainMeters.toLocaleString() }} m
            }
          </span>
        </div>
        <div>
          <span class="text-slate-500 uppercase block text-[8.5px]">Avg Grade</span>
          <span
            class="font-bold"
            [ngClass]="{
              'text-emerald-400': climb().avgGradePercent < 5,
              'text-yellow-400': climb().avgGradePercent >= 5 && climb().avgGradePercent < 7,
              'text-orange-400': climb().avgGradePercent >= 7 && climb().avgGradePercent < 10,
              'text-rose-400': climb().avgGradePercent >= 10
            }"
          >
            {{ climb().avgGradePercent }}%
          </span>
        </div>
        <div>
          <span class="text-slate-500 uppercase block text-[8.5px]">Max Grade</span>
          <span
            class="font-bold"
            [ngClass]="{
              'text-yellow-400': climb().maxGradePercent < 8,
              'text-orange-400': climb().maxGradePercent >= 8 && climb().maxGradePercent < 13,
              'text-rose-400': climb().maxGradePercent >= 13
            }"
          >
            {{ climb().maxGradePercent }}%
          </span>
        </div>
      </div>

      <!-- Live Progress Bar if Currently Climbing -->
      @if (climb().status === 'climbing') {
        <div class="space-y-1">
          <div class="flex justify-between text-[10px] font-mono">
            <span class="text-amber-400 font-bold">Climbing: {{ climb().climbCompletedPercent }}% completed</span>
            <span class="text-slate-300 font-semibold">
              @if (unit() === 'miles') {
                {{ climb().distanceToSummitMiles.toFixed(1) }} mi to summit
              } @else {
                {{ climb().distanceToSummitKm.toFixed(1) }} km to summit
              }
              • ~{{ climb().estimatedTimeFormatted }} left
            </span>
          </div>
          <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
            <div class="bg-amber-400 h-full rounded-full transition-all duration-300" [style.width.%]="climb().climbCompletedPercent"></div>
          </div>
        </div>
      }

      <!-- Distance Status & Jump Buttons Footer -->
      <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs gap-2">
        <div class="flex items-center gap-3 font-mono text-[11px]">
          @if (climb().status === 'upcoming') {
            <div>
              <span class="text-slate-500 text-[9px] uppercase block">Starts In</span>
              <span class="font-semibold text-emerald-400">
                @if (unit() === 'miles') {
                  +{{ climb().distanceToStartMiles.toFixed(1) }} mi
                } @else {
                  +{{ climb().distanceToStartKm.toFixed(1) }} km
                }
              </span>
            </div>
            <div>
              <span class="text-slate-500 text-[9px] uppercase block">Summit Ahead</span>
              <span class="font-semibold text-white">
                @if (unit() === 'miles') {
                  +{{ climb().distanceToSummitMiles.toFixed(1) }} mi
                } @else {
                  +{{ climb().distanceToSummitKm.toFixed(1) }} km
                }
              </span>
            </div>
          } @else if (climb().status === 'climbing') {
            <div>
              <span class="text-slate-500 text-[9px] uppercase block">Remaining Climb</span>
              <span class="font-semibold text-amber-400">
                @if (unit() === 'miles') {
                  +{{ climb().climbRemainingFeet.toLocaleString() }} ft
                } @else {
                  +{{ climb().climbRemainingMeters.toLocaleString() }} m
                }
              </span>
            </div>
          } @else {
            <div>
              <span class="text-slate-500 text-[9px] uppercase block">Summit Passed</span>
              <span class="font-semibold text-slate-400">
                @if (unit() === 'miles') {
                  {{ climb().distanceAgoMiles.toFixed(1) }} mi ago
                } @else {
                  {{ climb().distanceAgoKm.toFixed(1) }} km ago
                }
              </span>
            </div>
          }
        </div>

        <!-- Jump Action Buttons (Base and Summit) -->
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            (click)="onJumpBase($event)"
            title="Jump rider to base of climb"
            class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-emerald-600/30 border border-slate-700 font-mono text-[10px] text-slate-300 hover:text-white transition cursor-pointer"
          >
            Base ↳
          </button>
          <button
            type="button"
            (click)="onJumpSummit($event)"
            title="Jump rider to summit of climb"
            class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-emerald-600/30 border border-slate-700 font-mono text-[10px] text-slate-300 hover:text-white transition cursor-pointer"
          >
            Summit ↳
          </button>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ClimbCardComponent {
  readonly climb = input.required<UpcomingClimb>();
  readonly unit = input<'miles' | 'km'>('miles');
  readonly isPowerMode = input<boolean>(false);
  readonly isWeatherExpanded = input<boolean>(false);

  readonly jumpToMile = output<number>();
  readonly toggleWeatherBreakdown = output<string>();

  onToggleWeather(event: Event): void {
    event.stopPropagation();
    this.toggleWeatherBreakdown.emit(this.climb().id);
  }

  onJumpBase(event: Event): void {
    event.stopPropagation();
    this.jumpToMile.emit(this.climb().startMile);
  }

  onJumpSummit(event: Event): void {
    event.stopPropagation();
    this.jumpToMile.emit(this.climb().endMile);
  }
}
