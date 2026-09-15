import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MountainPass, ElevationScrubData, ClimbGradientStop } from '../../models/elevation.model';
import { SvgPoint } from './elevation-profile.component';

export interface VisiblePassMarker extends MountainPass {
  svgX: number;
  svgY: number;
}

export interface RiderSvgPosition {
  x: number;
  y: number;
  eleFeet: number;
  eleMeters: number;
}

export interface ChartElevationStats {
  minMeters: number;
  maxMeters: number;
  minFeet: number;
  maxFeet: number;
  gainMeters: number;
  gainFeet: number;
}

export interface ActiveProfileWindow {
  start: number;
  end: number;
}

@Component({
  selector: 'app-elevation-profile-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-xl relative overflow-hidden" data-testid="elevation-profile-chart">
      <!-- Scrubbing Tooltip HUD -->
      @if (scrubData(); as s) {
        <div
          class="absolute top-3 sm:top-4 z-20 bg-slate-950/95 border border-emerald-500/50 rounded-lg p-2.5 text-xs shadow-2xl backdrop-blur-md w-[190px] sm:w-[200px]"
          [ngClass]="popupSide() === 'left' ? 'left-3 sm:left-4' : 'right-3 sm:right-4'"
          data-testid="scrub-hud"
        >
          <div class="flex items-center justify-between gap-1.5 border-b border-slate-800 pb-1.5 mb-1.5">
            <span class="font-mono font-bold text-white text-[11px] truncate">
              @if (unit() === 'miles') {
                Mi {{ s.routeMile.toFixed(1) }}
              } @else {
                KM {{ s.routeKm.toFixed(1) }}
              }
            </span>
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border"
                [ngClass]="{
                  'bg-emerald-950 text-emerald-300 border-emerald-700': s.gradePercent < 4 && s.gradePercent >= -4,
                  'bg-yellow-950 text-yellow-300 border-yellow-700': s.gradePercent >= 4 && s.gradePercent < 8,
                  'bg-orange-950 text-orange-300 border-orange-700': s.gradePercent >= 8 && s.gradePercent < 12,
                  'bg-rose-950 text-rose-300 border-rose-700': s.gradePercent >= 12,
                  'bg-cyan-950 text-cyan-300 border-cyan-700': s.gradePercent < -4
                }"
                data-testid="scrub-grade-badge"
              >
                {{ s.gradePercent > 0 ? '+' : '' }}{{ s.gradePercent }}%
              </span>
              <button
                type="button"
                (click)="onCloseScrub($event)"
                class="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 active:bg-slate-700 text-xs font-mono transition cursor-pointer -mr-1"
                title="Close inspection window"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div class="space-y-1 font-mono text-[10px] text-slate-300">
            <div class="flex justify-between">
              <span class="text-slate-500">Altitude:</span>
              <span class="text-emerald-400 font-bold">
                @if (unit() === 'miles') {
                  {{ s.elevationFeet.toLocaleString() }} ft
                } @else {
                  {{ s.elevationMeters.toLocaleString() }} m
                }
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">From Rider:</span>
              <span>
                @if (unit() === 'miles') {
                  {{ s.distanceAheadMiles > 0 ? '+' : '' }}{{ s.distanceAheadMiles }} mi
                } @else {
                  {{ s.distanceAheadKm > 0 ? '+' : '' }}{{ s.distanceAheadKm }} km
                }
              </span>
            </div>
          </div>

          <button
            type="button"
            (click)="onJumpScrub(s.routeMile, $event)"
            class="w-full mt-2 py-1 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-[10px] font-mono rounded transition cursor-pointer"
            data-testid="jump-rider-btn"
          >
            Jump Rider Here
          </button>
        </div>
      }

      <!-- SVG Canvas -->
      <div
        class="relative w-full aspect-[800/240] cursor-crosshair touch-none select-none"
        (mousemove)="chartMouseMove.emit($event)"
        (click)="chartClick.emit($event)"
        (touchmove)="chartTouchMove.emit($event)"
        (touchstart)="chartTouchStart.emit($event)"
        (mouseleave)="chartMouseLeave.emit()"
        data-testid="svg-canvas-container"
      >
        <svg
          [attr.viewBox]="'0 0 ' + svgWidth() + ' ' + svgHeight()"
          class="w-full h-full overflow-visible"
        >
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#10b981" stop-opacity="0.35" />
              <stop offset="60%" stop-color="#059669" stop-opacity="0.15" />
              <stop offset="100%" stop-color="#022c22" stop-opacity="0.0" />
            </linearGradient>

            <linearGradient id="slopeStrokeGradient" x1="0%" y1="0" x2="100%" y2="0">
              @for (stop of gradientStops(); track $index) {
                <stop [attr.offset]="stop.offset" [attr.stop-color]="stop.color" />
              }
            </linearGradient>
          </defs>

          <!-- Horizontal Gridlines & Elevation Labels -->
          <line [attr.x1]="padLeft()" [attr.y1]="padTop()" [attr.x2]="svgWidth() - padRight()" [attr.y2]="padTop()" stroke="#334155" stroke-dasharray="3,3" stroke-width="0.8" opacity="0.6" />
          <line [attr.x1]="padLeft()" [attr.y1]="(padTop() + svgHeight() - padBottom()) / 2" [attr.x2]="svgWidth() - padRight()" [attr.y2]="(padTop() + svgHeight() - padBottom()) / 2" stroke="#334155" stroke-dasharray="3,3" stroke-width="0.8" opacity="0.4" />
          <line [attr.x1]="padLeft()" [attr.y1]="svgHeight() - padBottom()" [attr.x2]="svgWidth() - padRight()" [attr.y2]="svgHeight() - padBottom()" stroke="#475569" stroke-width="1" />

          <!-- Vertical Midpoint Gridline -->
          <line
            [attr.x1]="(padLeft() + svgWidth() - padRight()) / 2"
            [attr.y1]="padTop()"
            [attr.x2]="(padLeft() + svgWidth() - padRight()) / 2"
            [attr.y2]="svgHeight() - padBottom()"
            stroke="#334155"
            stroke-dasharray="3,3"
            stroke-width="0.8"
            opacity="0.3"
          />

          <!-- Elevation Axis Labels (Left) -->
          <text [attr.x]="padLeft() - 6" [attr.y]="padTop() + 4" fill="#94a3b8" font-size="9" text-anchor="end" font-family="monospace">
            @if (unit() === 'miles') {
              {{ chartStats().maxFeet }}'
            } @else {
              {{ chartStats().maxMeters }}m
            }
          </text>
          <text [attr.x]="padLeft() - 6" [attr.y]="(padTop() + svgHeight() - padBottom()) / 2 + 3" fill="#64748b" font-size="8.5" text-anchor="end" font-family="monospace" opacity="0.75">
            @if (unit() === 'miles') {
              {{ Math.round((chartStats().minFeet + chartStats().maxFeet) / 2) }}'
            } @else {
              {{ Math.round((chartStats().minMeters + chartStats().maxMeters) / 2) }}m
            }
          </text>
          <text [attr.x]="padLeft() - 6" [attr.y]="svgHeight() - padBottom()" fill="#64748b" font-size="9" text-anchor="end" font-family="monospace">
            @if (unit() === 'miles') {
              {{ chartStats().minFeet }}'
            } @else {
              {{ chartStats().minMeters }}m
            }
          </text>

          <!-- Distance Axis Labels (Bottom) -->
          <text [attr.x]="padLeft()" [attr.y]="svgHeight() - 10" fill="#64748b" font-size="9" text-anchor="start" font-family="monospace">
            @if (unit() === 'miles') {
              Mi {{ activeWindow().start.toFixed(0) }}
            } @else {
              KM {{ (activeWindow().start * 1.60934).toFixed(0) }}
            }
          </text>
          <text [attr.x]="(padLeft() + svgWidth() - padRight()) / 2" [attr.y]="svgHeight() - 10" fill="#64748b" font-size="9" text-anchor="middle" font-family="monospace">
            @if (unit() === 'miles') {
              Mi {{ ((activeWindow().start + activeWindow().end) / 2).toFixed(0) }}
            } @else {
              KM {{ (((activeWindow().start + activeWindow().end) / 2) * 1.60934).toFixed(0) }}
            }
          </text>
          <text [attr.x]="svgWidth() - padRight()" [attr.y]="svgHeight() - 10" fill="#64748b" font-size="9" text-anchor="end" font-family="monospace">
            @if (unit() === 'miles') {
              Mi {{ activeWindow().end.toFixed(0) }}
            } @else {
              KM {{ (activeWindow().end * 1.60934).toFixed(0) }}
            }
          </text>

          <!-- Area Fill under Mountain Curve -->
          @if (areaPathD()) {
            <path [attr.d]="areaPathD()" fill="url(#areaGradient)" />
          }

          <!-- Elevation Curve Stroke with Slope Gradients -->
          @if (linePathD()) {
            <path
              [attr.d]="linePathD()"
              fill="none"
              stroke="url(#slopeStrokeGradient)"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          }

          <!-- Mountain Pass Summit Markers on Curve -->
          @for (pass of visiblePasses(); track pass.id) {
            <g (click)="onPassClick(pass.routeMile, $event)" class="cursor-pointer group">
              <title>{{ pass.name }}: {{ unit() === 'miles' ? pass.elevationFeet.toLocaleString() + ' ft (Mile ' + pass.routeMile.toFixed(1) + ')' : pass.elevationMeters.toLocaleString() + ' m (KM ' + pass.routeKm.toFixed(1) + ')' }}</title>
              <line
                [attr.x1]="pass.svgX"
                [attr.y1]="pass.svgY"
                [attr.x2]="pass.svgX"
                [attr.y2]="Math.max(12, pass.svgY - 18)"
                stroke="#f59e0b"
                stroke-width="1.2"
                stroke-dasharray="2,2"
              />
              <circle
                [attr.cx]="pass.svgX"
                [attr.cy]="pass.svgY"
                r="3.5"
                fill="#f59e0b"
                stroke="#0f172a"
                stroke-width="1.5"
              />
              <text
                [attr.x]="pass.svgX"
                [attr.y]="Math.max(10, pass.svgY - 22)"
                fill="#fbbf24"
                font-size="8.5"
                font-weight="bold"
                text-anchor="middle"
                font-family="monospace"
                class="drop-shadow"
              >
                ▲ {{ pass.name }}
              </text>
            </g>
          }

          <!-- Current Rider Location Vertical Indicator & Dot -->
          @if (riderSvgPos(); as rider) {
            <g>
              <line
                [attr.x1]="rider.x"
                [attr.y1]="rider.y"
                [attr.x2]="rider.x"
                [attr.y2]="svgHeight() - padBottom()"
                stroke="#34d399"
                stroke-width="1.5"
                stroke-dasharray="3,3"
              />
              <circle
                [attr.cx]="rider.x"
                [attr.cy]="rider.y"
                r="7"
                fill="#10b981"
                fill-opacity="0.3"
                class="animate-ping"
              />
              <circle
                [attr.cx]="rider.x"
                [attr.cy]="rider.y"
                r="4.5"
                fill="#10b981"
                stroke="#ffffff"
                stroke-width="2"
              />
              <text
                [attr.x]="rider.x"
                [attr.y]="Math.max(14, rider.y - 12)"
                fill="#34d399"
                font-size="9"
                font-weight="bold"
                text-anchor="middle"
                font-family="monospace"
              >
                🚴 YOU
              </text>
            </g>
          }

          <!-- Interactive Scrubbing Crosshair -->
          @if (scrubX() !== null && scrubY() !== null) {
            <g>
              <line
                [attr.x1]="scrubX()!"
                [attr.y1]="padTop()"
                [attr.x2]="scrubX()!"
                [attr.y2]="svgHeight() - padBottom()"
                stroke="#ffffff"
                stroke-width="1"
                stroke-dasharray="2,2"
                opacity="0.8"
              />
              <circle
                [attr.cx]="scrubX()!"
                [attr.cy]="scrubY()!"
                r="5"
                fill="#38bdf8"
                stroke="#ffffff"
                stroke-width="2"
              />
            </g>
          }
        </svg>
      </div>

      <!-- Chart Interaction Prompt -->
      <div class="mt-2 text-center text-[10px] text-slate-500 font-mono">
        💡 Touch & scrub along profile to inspect grades, summits, and jump position.
      </div>
    </div>
  `,
  styles: [`
    svg text {
      user-select: none;
      -webkit-user-select: none;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class ElevationProfileChartComponent {
  // Chart visual inputs
  readonly chartPoints = input<SvgPoint[]>([]);
  readonly linePathD = input<string>('');
  readonly areaPathD = input<string>('');
  readonly gradientStops = input<ClimbGradientStop[]>([]);
  readonly visiblePasses = input<VisiblePassMarker[]>([]);
  readonly riderSvgPos = input<RiderSvgPosition | null>(null);

  // Scrubbing & HUD inputs
  readonly scrubData = input<ElevationScrubData | null>(null);
  readonly scrubX = input<number | null>(null);
  readonly scrubY = input<number | null>(null);
  readonly popupSide = input<'left' | 'right'>('right');
  readonly isPinned = input<boolean>(false);

  // Metric context
  readonly unit = input<'miles' | 'km'>('miles');
  readonly chartStats = input<ChartElevationStats>({
    minMeters: 0,
    maxMeters: 0,
    minFeet: 0,
    maxFeet: 0,
    gainMeters: 0,
    gainFeet: 0
  });
  readonly activeWindow = input<ActiveProfileWindow>({ start: 0, end: 100 });

  // Canvas layout dimensions
  readonly svgWidth = input<number>(800);
  readonly svgHeight = input<number>(240);
  readonly padLeft = input<number>(46);
  readonly padRight = input<number>(16);
  readonly padTop = input<number>(24);
  readonly padBottom = input<number>(28);

  // Interaction outputs
  readonly chartMouseMove = output<MouseEvent>();
  readonly chartClick = output<MouseEvent>();
  readonly chartTouchStart = output<TouchEvent>();
  readonly chartTouchMove = output<TouchEvent>();
  readonly chartMouseLeave = output<void>();
  readonly clearScrub = output<boolean>();
  readonly jumpToMile = output<number>();

  protected readonly Math = Math;

  onCloseScrub(event: Event): void {
    event.stopPropagation();
    this.clearScrub.emit(true);
  }

  onJumpScrub(mile: number, event: Event): void {
    event.stopPropagation();
    this.jumpToMile.emit(mile);
  }

  onPassClick(routeMile: number, event: Event): void {
    event.stopPropagation();
    this.jumpToMile.emit(routeMile);
  }
}
