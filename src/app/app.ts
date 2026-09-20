import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, untracked, OnDestroy, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouteDataService } from './services/route-data.service';
import { SettingsService } from './services/settings.service';
import { GpsSimulatorService } from './services/gps-simulator.service';
import {
  WaypointViewModel,
  GpsState,
  CategoryItem,
  Milestone,
  AVAILABLE_CATEGORIES,
  MAJOR_MILESTONES
} from './models/waypoint.model';
import { NavigationTab } from './models/settings.model';
import { ElevationProfileComponent } from './components/elevation-profile/elevation-profile.component';
import { RouteMapComponent } from './components/route-map/route-map.component';
import { TelemetryHeaderComponent } from './components/telemetry-header/telemetry-header.component';
import { CategoryFilterComponent } from './components/category-filter/category-filter.component';
import { WaypointsListComponent } from './components/waypoints-list/waypoints-list.component';
import { ResupplyPlannerComponent } from './components/resupply-planner/resupply-planner.component';
import { SettingsTabComponent } from './components/settings-tab/settings-tab.component';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { WelcomeScreenComponent } from './components/welcome-screen/welcome-screen.component';
import { WeatherForecastComponent } from './components/weather-forecast/weather-forecast.component';
import { RouteSelectorModalComponent } from './components/route-selector/route-selector-modal.component';
import { RideCockpitComponent } from './components/ride-cockpit/ride-cockpit.component';
import { RouteManifestService } from './services/route-manifest.service';
import { ToastService } from './services/toast.service';
import { NetworkStatusService } from './services/network-status.service';
import { OfflineStorageService } from './services/offline-storage.service';
import { WakeLockService } from './services/wake-lock.service';
import { AnalyticsService } from './services/analytics.service';
import { DeadReckoningService } from './services/dead-reckoning.service';
import { GeolocationService } from './services/geolocation.service';
import { haversineMeters } from './utils/geo-math.utils';

// Backward compatibility re-export
export { haversineMeters } from './utils/geo-math.utils';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    ElevationProfileComponent,
    RouteMapComponent,
    RideCockpitComponent,
    TelemetryHeaderComponent,
    CategoryFilterComponent,
    WaypointsListComponent,
    ResupplyPlannerComponent,
    SettingsTabComponent,
    BottomNavComponent,
    WelcomeScreenComponent,
    WeatherForecastComponent,
    RouteSelectorModalComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit, OnDestroy {
  readonly routeService = inject(RouteDataService);
  readonly settings = inject(SettingsService);
  readonly manifestService = inject(RouteManifestService);
  readonly toastService = inject(ToastService);
  readonly networkStatus = inject(NetworkStatusService);
  readonly offlineStorage = inject(OfflineStorageService);
  readonly wakeLock = inject(WakeLockService);
  readonly analytics = inject(AnalyticsService);
  readonly deadReckoning = inject(DeadReckoningService);
  readonly geolocation = inject(GeolocationService);
  readonly gpsSimulator = inject(GpsSimulatorService);

  readonly activeRouteId = this.manifestService.activeRouteId;
  readonly activeRouteSummary = this.manifestService.activeRouteSummary;

  readonly showWeatherModal = signal<boolean>(false);
  readonly showRouteModal = signal<boolean>(false);

  private unsubscribeLocationUpdate: (() => void) | null = null;

  constructor() {
    effect(() => {
      this.updateBroadLocation();
    });
    this.unsubscribeLocationUpdate = this.geolocation.onLocationUpdate((mile: number) => {
      this.setMile(mile);
    });

    // Effect: Synchronize simulation ticks to currentMile across all views
    let previousRunning = false;
    effect(() => {
      const isRunning = this.gpsSimulator.running();
      const simMile = this.gpsSimulator.simulatedMile();
      untracked(() => {
        if (isRunning || previousRunning) {
          this.setMile(simMile);
        }
        previousRunning = isRunning;
      });
    });

    // Effect: Keep trackpoints synced with GpsSimulatorService across all views
    effect(() => {
      const points = this.routeService.trackPoints();
      const guidance = typeof this.routeService?.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
      const effectivePoints = guidance && guidance.length >= 2 ? guidance : points;
      if (effectivePoints && effectivePoints.length >= 2) {
        untracked(() => {
          if (!this.gpsSimulator.running() && typeof this.gpsSimulator.setTrackPoints === 'function') {
            this.gpsSimulator.setTrackPoints(effectivePoints);
          }
        });
      }
    });
  }



  ngOnInit(): void {
    if ((this.settings.activeTab() as string) === 'jump') {
      this.settings.setActiveTab('resupply');
    }
    this.manifestService.loadManifest().subscribe(() => {
      const activeId = this.manifestService.activeRouteId();
      if (activeId) {
        this.routeService.loadRoute(activeId);
        const savedLocation = this.settings.getLocationForRoute(activeId);
        if (savedLocation > 0) {
          this.setMile(savedLocation);
        }
        const summary = this.manifestService.activeRouteSummary();
        this.analytics.trackRouteLoaded(activeId, summary?.name || activeId, summary?.totalDistanceMiles || 0);
        this.analytics.trackPageView(summary?.name || activeId, '/' + activeId);
      }
    });
  }

  // Rider position & speed signals
  readonly currentMile = signal<number>(
    this.settings.getLocationForRoute(this.manifestService.activeRouteId())
  );
  readonly avgSpeedMph = this.settings.avgSpeedMph;
  readonly unit = this.settings.distanceUnit;
  readonly riderPowerWatts = this.settings.riderPowerWatts;
  readonly paceMode = this.settings.paceMode;
  readonly displaySpeed = this.settings.displaySpeed;
  readonly speedUnit = this.settings.speedUnit;
  readonly activeTab = this.settings.activeTab;
  readonly searchQuery = signal<string>('');

  // Sticky header collapsible resupply/bike shop segment state
  readonly isHeaderCollapsed = signal<boolean>(false);
  private lastScrollY = 0;
  private manualToggleTime = 0;

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const currentY = window.scrollY || document.documentElement.scrollTop || 0;
    const diff = currentY - this.lastScrollY;

    // Ignore layout-shift scroll events immediately following a manual toggle
    if (Date.now() - this.manualToggleTime < 600) {
      this.lastScrollY = currentY;
      return;
    }

    if (currentY <= 15) {
      this.isHeaderCollapsed.set(false);
    } else if (diff > 5) {
      // Scrolling down: collapse next resupply and next bike shop bar
      this.isHeaderCollapsed.set(true);
    } else if (diff < -10) {
      // Scrolling up: reveal next resupply and next bike shop bar
      this.isHeaderCollapsed.set(false);
    }
    this.lastScrollY = currentY;
  }

  toggleHeaderCollapse(): void {
    this.manualToggleTime = Date.now();
    this.isHeaderCollapsed.update((v) => !v);
  }

  switchTab(tab: NavigationTab): void {
    this.settings.setActiveTab(tab);
    this.analytics.trackTabChanged(tab);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    this.isHeaderCollapsed.set(false);
    if (this.gpsState().enabled) {
      this.startGpsInterval();
    }
  }

  adjustPower(delta: number): void {
    this.settings.adjustPower(delta);
  }

  adjustSpeed(delta: number): void {
    this.settings.adjustSpeed(delta);
  }

  togglePaceMode(): void {
    this.settings.togglePaceMode();
  }

  // GPS Geolocation State (Delegated to GeolocationService)
  readonly gpsState = this.geolocation.gpsState;

  // Category Long-Press / Filter state
  private longPressTimer: any = null;
  private longPressFired = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  readonly holdingCategory = signal<string | null>(null);

  ngOnDestroy(): void {
    this.cancelCategoryPress();
    this.unsubscribeLocationUpdate?.();
    this.geolocation.stopTracking();
  }


  // Selected filter categories
  readonly availableCategories: CategoryItem[] = AVAILABLE_CATEGORIES;

  readonly selectedCategories = signal<Set<string>>(
    new Set(['town', 'grocery', 'food', 'campground', 'hotel', 'bike_shop', 'gas_station', 'pharmacy', 'laundromat', 'water'])
  );

  // Key milestone towns for quick navigation jumping
  readonly majorMilestones = computed<Milestone[]>(() => {
    const list = this.routeService.milestones();
    return list.length ? list : MAJOR_MILESTONES;
  });

  async selectRoute(routeId: string): Promise<boolean> {
    if (this.gpsState().enabled) {
      this.stopGpsTracking();
    }
    if (typeof this.gpsSimulator?.stop === 'function') {
      this.gpsSimulator.stop();
    }
    const success = await this.manifestService.selectRoute(routeId);
    if (!success) {
      return false;
    }
    if (routeId) {
      this.routeService.loadRoute(routeId);
      const summary = this.manifestService.activeRouteSummary();
      this.analytics.trackRouteLoaded(routeId, summary?.name || routeId, summary?.totalDistanceMiles || 0);
      this.analytics.trackPageView(summary?.name || routeId, '/' + routeId);
    } else {
      this.routeService.unloadRoute();
    }
    // Explicitly reset location to 0 when switching the route
    this.setMile(0);
    return true;
  }

  // Computed: Filtered waypoints ahead
  readonly waypointsAhead = computed(() => {
    const mile = this.currentMile();
    const speed = this.avgSpeedMph();
    const filters = this.selectedCategories();
    const query = this.searchQuery().toLowerCase().trim();

    let list = this.routeService.calculateWaypointsAhead(mile, speed, filters, 80);

    if (query) {
      list = list.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          (w.town && w.town.toLowerCase().includes(query)) ||
          w.type.toLowerCase().includes(query)
      );
    }
    return list;
  });

  // Computed: Next major town
  readonly nextTown = computed(() => {
    const mile = this.currentMile();
    const all = this.routeService.places();
    return all.find((p) => (p.category === 'town' || p.type === 'locality') && p.route_mile > mile + 0.5);
  });

  // Computed: Next bike shop
  readonly nextBikeShop = computed(() => {
    const mile = this.currentMile();
    const all = this.routeService.places();
    return all.find((p) => p.category === 'bike_shop' && p.route_mile > mile + 0.1);
  });

  // Actions
  setMile(mile: number): void {
    const total = this.routeService.totalDistanceMiles > 0 ? this.routeService.totalDistanceMiles : Infinity;
    const clamped = Math.max(0, Math.min(total, Math.round(mile * 1000000) / 1000000));
    this.currentMile.set(clamped);

    const activeRouteId = this.manifestService.activeRouteId();
    this.settings.saveLocation(activeRouteId, clamped);

    if (typeof this.gpsSimulator?.seek === 'function') {
      if (this.gpsSimulator.running()) {
        if (Math.abs(clamped - this.gpsSimulator.simulatedMile()) > 0.05) {
          this.gpsSimulator.seek(clamped);
        }
      } else {
        if (Math.abs(clamped - this.gpsSimulator.simulatedMile()) > 1e-4) {
          this.gpsSimulator.seek(clamped);
        }
      }
    }
  }

  adjustMile(delta: number): void {
    const total = this.routeService.totalDistanceMiles > 0 ? this.routeService.totalDistanceMiles : 2679.2;
    const next = Math.max(0, Math.min(total, Math.round((this.currentMile() + delta) * 1000000) / 1000000));
    this.setMile(next);
  }

  stepLocation(deltaInUnit: number): void {
    // Jump out of GPS tracking mode when user steps manually
    if (this.gpsState().enabled) {
      this.stopGpsTracking();
    }

    if (this.unit() === 'miles') {
      const currentMiles = this.currentMile();
      const total = this.routeService.totalDistanceMiles > 0 ? this.routeService.totalDistanceMiles : 2679.2;
      const nextMiles = Math.max(0, Math.min(total, Math.round((currentMiles + deltaInUnit) * 10) / 10));
      this.setMile(nextMiles);
    } else {
      // Unit is KM: calculate step directly in KM to prevent accumulated floating-point conversion/rounding errors
      const currentKm = Math.round(this.currentMile() * 1.60934 * 10) / 10;
      const totalKm = this.routeService.totalDistanceKm || (this.routeService.totalDistanceMiles * 1.60934) || 4311.8;
      const nextKm = Math.max(0, Math.min(totalKm, Math.round((currentKm + deltaInUnit) * 10) / 10));
      this.setMile(nextKm / 1.60934);
    }
  }

  onSliderChange(valueInUnit: number): void {
    if (this.gpsState().enabled) {
      this.stopGpsTracking();
    }
    if (this.unit() === 'miles') {
      this.setMile(valueInUnit);
    } else {
      this.setMile(valueInUnit / 1.60934);
    }
  }

  selectMileFromUser(mile: number): void {
    if (this.gpsState().enabled) {
      this.stopGpsTracking();
    }
    this.setMile(mile);
  }

  selectOnlyCategory(category: string): void {
    this.selectedCategories.set(new Set([category]));
  }

  handleCategoryPointerDown(category: string, event: PointerEvent): void {
    if (event.button !== 0) return; // Only primary button / touch

    this.longPressFired = false;
    this.holdingCategory.set(category);
    this.pointerStartX = event.clientX;
    this.pointerStartY = event.clientY;

    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
    }

    this.longPressTimer = setTimeout(() => {
      this.longPressFired = true;
      this.holdingCategory.set(null);
      this.deselectOrToggleCategory(category);
    }, 1000);
  }

  handleCategoryPointerMove(event: PointerEvent): void {
    if (!this.longPressTimer) return;
    const dx = Math.abs(event.clientX - this.pointerStartX);
    const dy = Math.abs(event.clientY - this.pointerStartY);
    if (dx > 8 || dy > 8) {
      // User is scrolling / dragging: cancel long press
      this.cancelCategoryPress();
    }
  }

  handleCategoryPointerUp(event: PointerEvent): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.holdingCategory.set(null);
  }

  cancelCategoryPress(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.holdingCategory.set(null);
  }

  handleCategoryClick(category: string, event: MouseEvent): void {
    event.preventDefault();
    if (this.longPressFired) {
      // Long press already handled the action; suppress short click
      this.longPressFired = false;
      return;
    }
    // Short click: select ONLY this category
    this.selectOnlyCategory(category);
  }

  deselectOrToggleCategory(category: string): void {
    const current = new Set(this.selectedCategories());
    if (current.has(category)) {
      current.delete(category);
    } else {
      current.add(category);
    }
    this.selectedCategories.set(current);
    this.analytics.trackCategoryFiltered(category, current.size);

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50);
      } catch (_) {}
    }
  }

  toggleCategory(category: string): void {
    this.deselectOrToggleCategory(category);
  }

  toggleAllCategories(): void {
    if (this.selectedCategories().size === this.availableCategories.length) {
      this.selectedCategories.set(new Set());
    } else {
      this.selectedCategories.set(new Set(this.availableCategories.map((c) => c.key)));
    }
  }

  selectAllCategories(): void {
    this.selectedCategories.set(new Set(this.availableCategories.map((c) => c.key)));
  }

  getCategoryBadge(category: string): { icon: string; label: string; badgeClass: string } {
    const key = category === 'laundry' ? 'laundromat' : category;
    const found = this.availableCategories.find((c) => c.key === key);
    if (found) return found;
    return { icon: '📍', label: category, badgeClass: 'bg-slate-700/50 text-slate-300 border-slate-600' };
  }

  // GPS Geolocation Actions (Delegated to GeolocationService facade)
  toggleGps(): void {
    this.geolocation.toggleTracking();
  }

  getGpsFrequencySeconds(): number {
    return this.geolocation.getFrequencySeconds();
  }

  startGpsTracking(): void {
    this.geolocation.startTracking();
  }

  stopGpsTracking(): void {
    this.geolocation.stopTracking();
  }

  retryGps(): void {
    this.geolocation.startTracking();
  }

  dismissGpsAlert(): void {
    this.geolocation.dismissAlert();
  }

  clearGpsError(): void {
    this.geolocation.clearError();
  }

  startGpsInterval(): void {
    this.geolocation.startGpsInterval();
  }

  stopGpsInterval(): void {
    this.geolocation.stopGpsInterval();
  }

  requestLocation(): void {
    this.geolocation.requestLocation();
  }

  handleLocationSuccess(pos: GeolocationPosition): void {
    this.geolocation.handleLocationSuccess(pos);
  }

  handleLocationError(err: GeolocationPositionError, isRide = this.activeTab() === 'ride'): void {
    this.geolocation.handleLocationError(err, isRide);
  }

  /**
   * Helper for testing/simulating GPS coordinates along the Tour Divide
   */
  simulateGpsLocation(lat: number, lon: number): void {
    this.geolocation.simulateGpsLocation(lat, lon);
  }


  /**
   * Updates broad location context in AnalyticsService:
   * Coarsened 1-decimal ~11km grid box, 50-mile corridor bucket, state/province, and nearest town.
   * Strips all exact GPS coordinates to protect backcountry campsite and rider privacy.
   */
  private updateBroadLocation(): void {
    const activeRoute = this.manifestService.activeRouteId();
    if (!activeRoute) {
      this.analytics.setBroadLocation({});
      return;
    }

    const mile = this.currentMile();
    const allPlaces = this.routeService.places();

    // 1. 50-mile corridor bucket
    const lower = Math.floor(mile / 50) * 50;
    const upper = lower + 50;
    const mileBucket = `${lower}-${upper}mi`;

    // 2. Nearest town and state/province
    let nearestTown = '';
    let routeState = '';
    let minDiff = Infinity;

    for (const p of allPlaces) {
      const diff = Math.abs(p.route_mile - mile);
      if ((p.category === 'town' || p.type === 'locality' || p.town) && diff < minDiff) {
        minDiff = diff;
        nearestTown = p.town || p.name;
        if (p.province_state) {
          routeState = p.province_state;
        }
      }
    }

    if (!routeState) {
      let placeMinDiff = Infinity;
      for (const p of allPlaces) {
        const diff = Math.abs(p.route_mile - mile);
        if (p.province_state && diff < placeMinDiff) {
          placeMinDiff = diff;
          routeState = p.province_state;
        }
      }
    }

    // 3. Approximate coordinates (~11km / 7-mile bounding box)
    let approxLat: number | undefined;
    let approxLng: number | undefined;
    let geoGrid: string | undefined;

    const gps = this.gpsState();
    if (gps.enabled && gps.latitude !== null && gps.longitude !== null) {
      approxLat = Math.round(gps.latitude * 10) / 10;
      approxLng = Math.round(gps.longitude * 10) / 10;
      geoGrid = `${approxLat},${approxLng}`;
    } else {
      const points = this.routeService.trackPoints();
      if (points && points.length > 0) {
        let closestPt = points[0];
        let closestDist = Math.abs(closestPt[4] - mile);
        for (let i = 1; i < points.length; i++) {
          const dist = Math.abs(points[i][4] - mile);
          if (dist < closestDist) {
            closestDist = dist;
            closestPt = points[i];
          }
        }
        if (closestPt) {
          approxLat = Math.round(closestPt[0] * 10) / 10;
          approxLng = Math.round(closestPt[1] * 10) / 10;
          geoGrid = `${approxLat},${approxLng}`;
        }
      }
    }

    this.analytics.setBroadLocation({
      route_state: routeState || undefined,
      nearest_town: nearestTown ? `Near ${nearestTown}` : undefined,
      mile_bucket: mileBucket,
      approx_lat: approxLat,
      approx_lng: approxLng,
      geo_grid: geoGrid
    });
  }
}
