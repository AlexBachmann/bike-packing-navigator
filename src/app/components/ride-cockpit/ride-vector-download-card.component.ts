import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ride-vector-download-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      data-testid="vector-download-card"
      class="absolute inset-0 z-40 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in"
    >
      <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 text-center">
        <!-- Icon Badge -->
        <div class="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-2xl flex items-center justify-center mx-auto text-emerald-400 shadow-inner">
          🗺️
        </div>

        <!-- Title & Description -->
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            Vector Map Required
          </div>
          <h2 class="text-lg font-black text-white tracking-tight">
            {{ routeTitle() }}
          </h2>
          <p class="text-xs text-slate-300 leading-relaxed max-w-xs mx-auto">
            The 3D Ride Cockpit requires offline vector map tiles (.pmtiles) to render high-pitch 3D trail perspective and road snapping.
          </p>
        </div>

        <!-- Size Strip -->
        <div class="py-2.5 px-4 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs font-mono">
          <span class="text-slate-400">Estimated Download</span>
          <span class="text-emerald-400 font-bold">{{ estimatedSize() }}</span>
        </div>

        <!-- Live Download Progress -->
        @if (isDownloading()) {
          <div class="space-y-2 text-left" data-testid="download-progress-block">
            <div class="flex items-center justify-between text-xs font-mono">
              <span class="text-sky-300 flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
                Downloading tiles...
              </span>
              <span class="text-white font-bold">{{ downloadPercentage() }}%</span>
            </div>
            <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-200"
                [style.width.%]="downloadPercentage()"
              ></div>
            </div>
          </div>
        }

        <!-- Error State -->
        @if (downloadError(); as err) {
          <div class="p-3 rounded-xl bg-rose-950/60 border border-rose-500/50 text-rose-200 text-xs font-mono text-left">
            ⚠️ {{ err }}
          </div>
        }

        <!-- 1-Click Action Button -->
        <div class="pt-1">
          @if (!isDownloading()) {
            <button
              type="button"
              data-testid="download-vector-btn"
              (click)="onDownloadClick()"
              class="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold text-sm tracking-wide shadow-lg shadow-emerald-950/50 transition cursor-pointer active:scale-95 flex items-center justify-center gap-2"
            >
              <span>⚡</span>
              <span>Download Vector Map ({{ estimatedSize() }})</span>
            </button>
          } @else {
            <button
              type="button"
              disabled
              class="w-full py-3 px-4 rounded-xl bg-slate-800 text-slate-400 font-semibold text-sm cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span class="animate-spin">⏳</span>
              <span>Downloading {{ downloadPercentage() }}%...</span>
            </button>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RideVectorDownloadCardComponent {
  // Inputs
  readonly routeTitle = input<string>('Active Route');
  readonly estimatedSize = input<string>('~25 MB');
  readonly isDownloading = input<boolean>(false);
  readonly downloadPercentage = input<number>(0);
  readonly downloadError = input<string | null>(null);

  // Output
  readonly download = output<void>();

  onDownloadClick(): void {
    if (!this.isDownloading()) {
      this.download.emit();
    }
  }
}
