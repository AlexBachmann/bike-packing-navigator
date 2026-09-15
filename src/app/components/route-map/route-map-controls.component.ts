import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-route-map-controls',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="absolute bottom-3 right-2.5 z-20 flex flex-col gap-1.5">
      <!-- Center on Rider Button -->
      <button
        type="button"
        (click)="centerOnRider.emit()"
        title="Center map on current rider location"
        aria-label="Center map on current rider location"
        class="w-9 h-9 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-emerald-400 border border-slate-700/80 shadow-lg backdrop-blur-md flex items-center justify-center text-base cursor-pointer transition active:scale-95"
      >
        🎯
      </button>

      <!-- Fit Full Route Button -->
      <button
        type="button"
        (click)="fitFullRoute.emit()"
        [title]="'Zoom out to show entire ' + (totalDistanceKm() ? totalDistanceKm()!.toLocaleString() : 'route') + ' km route'"
        [attr.aria-label]="'Zoom out to show entire ' + (totalDistanceKm() ? totalDistanceKm()!.toLocaleString() : 'route') + ' km route'"
        class="w-9 h-9 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 shadow-lg backdrop-blur-md flex items-center justify-center text-sm cursor-pointer transition active:scale-95"
      >
        📍
      </button>

      <!-- Toggle Map Layer Button -->
      <button
        type="button"
        (click)="toggleMapStyle.emit()"
        [title]="mapStyle() === 'dark' ? 'Switch to Topographic Contours' : 'Switch to Dark Matter Style'"
        [attr.aria-label]="mapStyle() === 'dark' ? 'Switch to Topographic Contours' : 'Switch to Dark Matter Style'"
        class="w-9 h-9 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 shadow-lg backdrop-blur-md flex items-center justify-center text-sm cursor-pointer transition active:scale-95"
      >
        {{ mapStyle() === 'dark' ? '🗺️' : '🌓' }}
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RouteMapControlsComponent {
  readonly mapStyle = input<'dark' | 'topo'>('dark');
  readonly totalDistanceKm = input<number | undefined>(undefined);

  readonly centerOnRider = output<void>();
  readonly fitFullRoute = output<void>();
  readonly toggleMapStyle = output<void>();
}
