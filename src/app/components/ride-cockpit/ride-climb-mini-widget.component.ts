import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClimbMiniProfile } from '../../models/elevation.model';

export interface ActiveClimbStatus {
  climbId: string;
  name: string;
  remainingMiles: number;
  remainingKm: number;
  remainingFormatted: string;
  gradePercent: number;
  progressPercent: number;
  miniProfile: ClimbMiniProfile;
  svgPaths?: {
    linePath: string;
    areaPath: string;
    riderX: number;
    riderY: number;
  };
}

@Component({
  selector: 'app-ride-climb-mini-widget',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (climbStatus(); as climb) {
      <div
        data-testid="climb-mini-widget"
        class="pointer-events-auto flex-1 max-w-[260px] sm:max-w-[320px] mx-auto bg-slate-950/90 border border-slate-800/90 rounded-2xl px-2.5 py-1.5 shadow-2xl backdrop-blur-md flex flex-col items-center gap-0.5 animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <!-- Header Row -->
        <div class="w-full flex items-center justify-between text-[11px] leading-tight px-1 gap-1">
          <div class="flex items-center gap-1 font-bold text-slate-100 truncate min-w-0">
            <span class="text-amber-400 shrink-0">⛰️</span>
            <span class="truncate">{{ climb.name }}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0 text-slate-300 font-mono text-[10px]">
            <span class="text-amber-400 font-semibold">{{ climb.gradePercent.toFixed(1) }}% avg</span>
            <span class="text-slate-400">•</span>
            <span>{{ climb.remainingFormatted }} left</span>
          </div>
        </div>

        <!-- Mini Elevation Profile SVG (Identical to climb cards) -->
        <div class="relative w-full h-8 flex items-center justify-center overflow-visible">
          <svg
            [attr.viewBox]="'0 0 ' + climb.miniProfile.width + ' 36'"
            preserveAspectRatio="none"
            class="w-full h-8 overflow-visible"
            aria-label="Miniature climb profile"
          >
            <defs>
              <!-- Dynamic Horizontal Gradient for Slope Coloring -->
              <linearGradient [id]="'rideMiniSlopeGrad-' + climb.climbId" x1="0%" y1="0%" x2="100%" y2="0%">
                @for (stop of climb.miniProfile.gradientStops; track $index) {
                  <stop [attr.offset]="stop.offset" [attr.stop-color]="stop.color" />
                }
              </linearGradient>

              <!-- Emerald/Teal Area Fill matching Main Elevation Profile & Climb Cards -->
              <linearGradient [id]="'rideMiniAreaGrad-' + climb.climbId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.32" />
                <stop offset="60%" stop-color="#059669" stop-opacity="0.12" />
                <stop offset="100%" stop-color="#022c22" stop-opacity="0.0" />
              </linearGradient>
            </defs>

            <!-- Area Fill -->
            <path
              [attr.d]="climb.miniProfile.areaPathD"
              [attr.fill]="'url(#rideMiniAreaGrad-' + climb.climbId + ')'"
            />

            <!-- Elevation Profile Line with Multi-Color Grade Slope -->
            <path
              [attr.d]="climb.miniProfile.linePathD"
              fill="none"
              [attr.stroke]="'url(#rideMiniSlopeGrad-' + climb.climbId + ')'"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />

            <!-- Base Anchor Dot -->
            <circle
              [attr.cx]="climb.miniProfile.startPoint.x"
              [attr.cy]="climb.miniProfile.startPoint.y"
              r="1.4"
              class="fill-slate-400 opacity-80"
            />

            <!-- Summit Peak Dot -->
            <circle
              [attr.cx]="climb.miniProfile.summitPoint.x"
              [attr.cy]="climb.miniProfile.summitPoint.y"
              r="2"
              class="fill-cyan-300 stroke-slate-950 stroke-[0.8]"
            />

            <!-- Active Climbing Rider Position Dot & Guideline -->
            @if (climb.miniProfile.riderDot) {
              <line
                [attr.x1]="climb.miniProfile.riderDot.x"
                [attr.y1]="climb.miniProfile.riderDot.y"
                [attr.x2]="climb.miniProfile.riderDot.x"
                [attr.y2]="36"
                stroke="#38bdf8"
                stroke-dasharray="1.5,1.5"
                stroke-width="0.8"
                opacity="0.7"
              />
              <circle
                [attr.cx]="climb.miniProfile.riderDot.x"
                [attr.cy]="climb.miniProfile.riderDot.y"
                r="4"
                class="fill-cyan-400/30 animate-ping"
              />
              <circle
                [attr.cx]="climb.miniProfile.riderDot.x"
                [attr.cy]="climb.miniProfile.riderDot.y"
                r="2"
                class="fill-cyan-300 stroke-slate-950 stroke-[1]"
              />
            }
          </svg>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RideClimbMiniWidgetComponent {
  readonly climbStatus = input<ActiveClimbStatus | null>(null);
}
