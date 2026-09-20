import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-route-map-status-pill',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="absolute bottom-3 left-2.5 z-20 flex flex-col-reverse items-start gap-1.5 max-w-[calc(100%-110px)] pointer-events-auto">

      <!-- Bottom Floating Telemetry Info Pill (Anchored at bottom) -->
      <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl px-2.5 py-1 text-xs font-mono backdrop-blur-md flex items-center gap-1.5 shadow-lg shrink-0">
        <div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
        <span class="text-slate-400 text-[11px]">Position:</span>
        <span class="font-bold text-white text-[11px]">
          @if (unit() === 'miles') {
            Mile {{ currentMile().toFixed(1) }}
          } @else {
            KM {{ (currentMile() * 1.60934).toFixed(1) }}
          }
        </span>
      </div>

      <!-- Compact Floating Map Mode & Download Quick-Action Pill (Floats above telemetry pill) -->
      <div class="flex items-center gap-1.5 px-2.5 py-1 bg-slate-950/90 border border-slate-800/90 rounded-xl text-xs font-mono shadow-lg backdrop-blur-md shrink-0">
        @if (activeMapMode() === 'vector') {
          <span class="inline-flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Vector Map
          </span>
          <button
            type="button"
            (click)="toggleMapMode.emit()"
            class="ml-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 hover:text-white border border-slate-700/80 rounded-lg font-mono text-[10px] transition shadow cursor-pointer flex items-center gap-1 active:scale-95"
            aria-label="Switch to raster map"
            title="Switch to raster map (contains additional topographic and aerial details)"
          >
            <span>⇄</span>
            <span>Raster</span>
          </button>
        } @else {
          <span class="inline-flex items-center gap-1.5 text-amber-300 font-medium text-[11px]">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            Raster Map
          </span>

          @if (isDownloading()) {
            <div class="flex items-center gap-1.5 text-slate-300 text-[11px] ml-1">
              <span>{{ downloadPercentage() }}%</span>
              <div class="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full bg-emerald-500 transition-all duration-200" [style.width.%]="downloadPercentage()"></div>
              </div>
            </div>
          } @else if (isVectorCached()) {
            <button
              type="button"
              (click)="toggleMapMode.emit()"
              class="ml-1 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg font-mono font-bold text-[10px] transition shadow cursor-pointer flex items-center gap-1 active:scale-95"
              aria-label="Switch to vector map"
              title="Switch to offline vector map"
            >
              <span>⇄</span>
              <span>Vector</span>
            </button>
          } @else {
            <button
              type="button"
              (click)="downloadVector.emit()"
              class="ml-1 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg font-bold text-[10px] transition shadow cursor-pointer flex items-center gap-1 active:scale-95"
              aria-label="Download offline vector map for active route"
            >
              <span>⚡</span>
              <span>Download Vector ({{ activeRouteSizeEstimate() }})</span>
            </button>
          }
        }
      </div>

    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RouteMapStatusPillComponent {
  readonly currentMile = input<number>(0);
  readonly unit = input<'miles' | 'km'>('miles');
  readonly activeMapMode = input<'vector' | 'raster'>('raster');
  readonly isVectorCached = input<boolean>(false);
  readonly isDownloading = input<boolean>(false);
  readonly downloadPercentage = input<number>(0);
  readonly activeRouteSizeEstimate = input<string>('~15 MB');
  readonly isForcedRaster = input<boolean>(false);

  readonly downloadVector = output<void>();
  readonly toggleMapMode = output<void>();
}
