import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouteSummary } from '../../models/route.model';
import { DistanceUnit } from '../../models/settings.model';
import { RouteManifestService } from '../../services/route-manifest.service';

@Component({
  selector: 'app-welcome-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './welcome-screen.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full py-4'
  }
})
export class WelcomeScreenComponent {
  private readonly manifestService = inject(RouteManifestService);

  readonly routesInput = input<RouteSummary[] | null>(null, { alias: 'routes' });
  readonly unit = input<DistanceUnit>('miles');

  readonly routeSelect = output<string>();

  readonly availableRoutes = computed<RouteSummary[]>(() => {
    const fromInput = this.routesInput();
    if (fromInput && fromInput.length > 0) return fromInput;
    return this.manifestService.availableRoutes();
  });

  onSelect(routeId: string): void {
    this.routeSelect.emit(routeId);
    this.manifestService.selectRoute(routeId);
  }
}
