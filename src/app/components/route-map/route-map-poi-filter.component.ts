import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-route-map-poi-filter',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="absolute top-2.5 left-2.5 right-12 z-20 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
      <button
        type="button"
        (click)="selectFilter('all')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'all'
          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        All
      </button>
      <button
        type="button"
        (click)="selectFilter('town')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'town'
          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>🏘️</span>
        <span>Towns</span>
      </button>
      <button
        type="button"
        (click)="selectFilter('bike_shop')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'bike_shop'
          ? 'bg-blue-500 text-white border-blue-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>🚲</span>
        <span>Shops</span>
      </button>
      <button
        type="button"
        (click)="selectFilter('campground')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'campground'
          ? 'bg-teal-500 text-slate-950 border-teal-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>⛺</span>
        <span>Camp</span>
      </button>
      <button
        type="button"
        (click)="selectFilter('hotel')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'hotel'
          ? 'bg-purple-500 text-white border-purple-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>🏨</span>
        <span>Lodging</span>
      </button>
      <button
        type="button"
        (click)="selectFilter('grocery')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'grocery'
          ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>🛒</span>
        <span>Stores</span>
      </button>
      <button
        type="button"
        (click)="selectFilter('laundromat')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'laundromat'
          ? 'bg-indigo-500 text-white border-indigo-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>🧺</span>
        <span>Laundry</span>
      </button>
      <button
        type="button"
        (click)="selectFilter('water')"
        class="px-2.5 py-1 rounded-full text-xs font-semibold font-mono shadow-md backdrop-blur-md transition border flex items-center gap-1 cursor-pointer shrink-0"
        [ngClass]="activeFilter() === 'water'
          ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white'"
      >
        <span>💧</span>
        <span>Water</span>
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'contents'
  }
})
export class RouteMapPoiFilterComponent {
  readonly activeFilter = input.required<string>();
  readonly filterChange = output<string>();

  selectFilter(category: string): void {
    this.filterChange.emit(category);
  }
}
