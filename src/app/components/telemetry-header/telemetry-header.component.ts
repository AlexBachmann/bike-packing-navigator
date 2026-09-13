import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { RouteManifestService } from '../../services/route-manifest.service';
import { WeatherService } from '../../services/weather.service';
import { GpsState, Place } from '../../models/waypoint.model';
import { RouteSummary } from '../../models/route.model';

@Component({
  selector: 'app-telemetry-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './telemetry-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sticky top-0 z-30 block'
  }
})
export class TelemetryHeaderComponent implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef);
  private resizeObserver?: ResizeObserver;

  readonly routeService = inject(RouteDataService);
  readonly settings = inject(SettingsService);
  readonly manifestService = inject(RouteManifestService);
  readonly weatherService = inject(WeatherService);
  readonly twoHourOutlook = this.weatherService.twoHourOutlook;

  readonly currentMile = input.required<number>();
  readonly isHeaderCollapsed = input<boolean>(false);
  readonly gpsState = input.required<GpsState>();
  readonly nextTown = input<Place | undefined>();
  readonly nextBikeShop = input<Place | undefined>();

  // Route Agnostic Inputs/Outputs
  readonly availableRoutesInput = input<RouteSummary[] | null>(null, { alias: 'availableRoutes' });
  readonly activeRouteIdInput = input<string | null | undefined>(undefined, { alias: 'activeRouteId' });
  readonly routeChange = output<string>();

  readonly availableRoutes = computed<RouteSummary[]>(() => {
    const inputRoutes = this.availableRoutesInput();
    if (inputRoutes && inputRoutes.length > 0) return inputRoutes;
    return this.manifestService.availableRoutes();
  });

  readonly activeRouteId = computed<string | null>(() => {
    const inputId = this.activeRouteIdInput();
    if (inputId !== undefined) return inputId;
    return this.manifestService.activeRouteId();
  });

  readonly activeRouteSummary = computed<RouteSummary | null>(() => {
    const id = this.activeRouteId();
    if (!id) return null;
    return this.availableRoutes().find((r) => r.id === id) || this.manifestService.activeRouteSummary();
  });

  readonly toggleHeaderCollapse = output<void>();
  readonly toggleGps = output<void>();
  readonly dismissGpsAlert = output<void>();
  readonly clearGpsError = output<void>();
  readonly stepLocation = output<number>();
  readonly sliderChange = output<number>();
  readonly openWeatherModal = output<void>();
  readonly openRouteModal = output<void>();

  // Settings signals
  readonly unit = this.settings.distanceUnit;
  readonly riderPowerWatts = this.settings.riderPowerWatts;
  readonly paceMode = this.settings.paceMode;
  readonly displaySpeed = this.settings.displaySpeed;
  readonly speedUnit = this.settings.speedUnit;

  // Unit-aware calculations for location & slider
  readonly currentDistanceInUnit = computed(() => {
    return this.unit() === 'miles'
      ? this.currentMile()
      : Math.round(this.currentMile() * 1.60934 * 10) / 10;
  });

  readonly maxDistanceInUnit = computed(() => {
    return this.unit() === 'miles'
      ? this.routeService.totalDistanceMiles
      : this.routeService.totalDistanceKm;
  });

  readonly sliderStep = computed(() => (this.unit() === 'miles' ? 0.5 : 1.0));

  readonly steppers = [
    { delta: -25, label: '-25' },
    { delta: -5, label: '-5' },
    { delta: 5, label: '+5' },
    { delta: 25, label: '+25' }
  ];

  adjustPower(delta: number): void {
    this.settings.adjustPower(delta);
  }

  adjustSpeed(delta: number): void {
    this.settings.adjustSpeed(delta);
  }

  togglePaceMode(): void {
    this.settings.togglePaceMode();
  }

  toggleUnit(): void {
    const next = this.unit() === 'miles' ? 'km' : 'miles';
    this.settings.distanceUnit.set(next);
  }

  onStepLocation(delta: number): void {
    this.stepLocation.emit(delta);
  }

  onSliderChange(value: number): void {
    this.sliderChange.emit(value);
  }

  onRouteChange(newRouteId: string): void {
    this.routeChange.emit(newRouteId);
  }

  ngAfterViewInit(): void {
    this.updateHeaderHeight();
    if (typeof ResizeObserver !== 'undefined' && this.el?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateHeaderHeight();
      });
      this.resizeObserver.observe(this.el.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private updateHeaderHeight(): void {
    if (typeof document === 'undefined' || !this.el?.nativeElement) return;
    const height = this.el.nativeElement.getBoundingClientRect().height;
    if (height > 0) {
      document.documentElement.style.setProperty('--telemetry-header-height', `${height}px`);
    }
  }
}
