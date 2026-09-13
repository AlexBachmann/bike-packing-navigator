import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouteSummary } from '../../models/route.model';
import { RouteManifestService } from '../../services/route-manifest.service';

@Component({
  selector: 'app-route-selector-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './route-selector-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full text-left'
  }
})
export class RouteSelectorModalComponent implements OnInit {
  readonly manifestService = inject(RouteManifestService);

  readonly searchInputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly activeRouteId = input<string | null | undefined>(undefined);
  readonly availableRoutes = input<RouteSummary[] | null>(null);
  readonly unit = input<'miles' | 'km'>('miles');

  readonly routeSelect = output<string>();
  readonly close = output<void>();

  readonly searchQuery = signal<string>('');

  readonly routes = computed<RouteSummary[]>(() => {
    const passed = this.availableRoutes();
    if (passed && passed.length > 0) return passed;
    return this.manifestService.availableRoutes();
  });

  readonly currentRouteId = computed<string | null>(() => {
    const passed = this.activeRouteId();
    if (passed !== undefined) return passed;
    return this.manifestService.activeRouteId();
  });

  readonly filteredRoutes = computed<RouteSummary[]>(() => {
    const list = this.routes();
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return list;

    return list.filter((r) => {
      const matchName = r.name.toLowerCase().includes(query);
      const matchShort = (r.shortName || '').toLowerCase().includes(query);
      const matchBadge = (r.badge || '').toLowerCase().includes(query);
      const matchDesc = (r.description || '').toLowerCase().includes(query);
      const matchStart = (r.startLocation || '').toLowerCase().includes(query);
      const matchEnd = (r.endLocation || '').toLowerCase().includes(query);
      const matchHigh = (r.highestPoint || r.iconicPass || '').toLowerCase().includes(query);
      const matchCheckpoints = (r.iconicCheckpoints || []).some((c) => c.toLowerCase().includes(query));

      return (
        matchName ||
        matchShort ||
        matchBadge ||
        matchDesc ||
        matchStart ||
        matchEnd ||
        matchHigh ||
        matchCheckpoints
      );
    });
  });

  ngOnInit(): void {
    setTimeout(() => {
      this.searchInputRef()?.nativeElement?.focus();
    }, 50);
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchInputRef()?.nativeElement?.focus();
  }

  onSelect(routeId: string): void {
    this.routeSelect.emit(routeId);
  }

  onClose(): void {
    this.close.emit();
  }

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    this.onClose();
  }
}
