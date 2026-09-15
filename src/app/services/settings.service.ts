import { Injectable, signal, computed, effect, inject } from '@angular/core';
import {
  UserSettings,
  DEFAULT_USER_SETTINGS,
  WeightUnit,
  DistanceUnit,
  PaceMode,
  MapStyle,
  MapRendererMode,
  NavigationTab
} from '../models/settings.model';
import { ResupplyCatalogService } from './resupply-catalog.service';
import { UserSettingsStorageService, MAP_RENDERER_KEY } from './settings/user-settings-storage.service';

export { MAP_RENDERER_KEY } from './settings/user-settings-storage.service';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly storage = inject(UserSettingsStorageService);
  private readonly resupplyCatalog = inject(ResupplyCatalogService, { optional: true });

  readonly riderWeight = signal<number | null>(null);
  readonly bikeWeight = signal<number | null>(null);
  readonly waterCapacityLiters = signal<number | null>(null);
  readonly weightUnit = signal<WeightUnit>('kg');
  readonly distanceUnit = signal<DistanceUnit>('miles');
  readonly avgSpeedMph = signal<number>(10.5);
  readonly riderPowerWatts = signal<number>(150);
  readonly paceMode = signal<PaceMode>('power');
  readonly mapStyle = signal<MapStyle>('dark');
  readonly mapRenderer = signal<MapRendererMode>('auto');
  readonly mapZoomLevel = signal<number>(8);
  readonly activeTab = signal<NavigationTab>('waypoints');
  readonly selectedRouteKey = signal<string | null>(null);
  readonly currentLocationMile = signal<number>(0);
  readonly routeLocations = signal<Record<string, number>>({});
  readonly keepScreenAwake = signal<boolean>(DEFAULT_USER_SETTINGS.keepScreenAwake ?? true);
  readonly anonymousTelemetryEnabled = signal<boolean>(DEFAULT_USER_SETTINGS.anonymousTelemetryEnabled ?? true);

  // Climb Surge & Hike-a-Bike Settings
  readonly climbSurgePercent = signal<number>(10);
  readonly climbSurgeDurationMinutes = signal<number>(10);
  readonly hikeBikeThresholdKmh = signal<number>(6.0);
  readonly hikeBikeBaseSpeedKmh = signal<number>(4.0);

  // Computed display values for hike-a-bike speeds in current distance unit
  readonly displayHikeBikeThreshold = computed(() => {
    const isMiles = this.distanceUnit() === 'miles';
    const kmh = this.hikeBikeThresholdKmh();
    return isMiles ? Math.round(kmh * 0.621371 * 10) / 10 : Math.round(kmh * 10) / 10;
  });

  readonly displayHikeBikeBaseSpeed = computed(() => {
    const isMiles = this.distanceUnit() === 'miles';
    const kmh = this.hikeBikeBaseSpeedKmh();
    return isMiles ? Math.round(kmh * 0.621371 * 10) / 10 : Math.round(kmh * 10) / 10;
  });

  // Computed Climb Surge metrics
  readonly maxClimbSurgePowerWatts = computed(() => {
    return Math.round(this.riderPowerWatts() * (1 + this.climbSurgePercent() / 100));
  });

  readonly climbSurgeWattsDelta = computed(() => {
    return this.maxClimbSurgePowerWatts() - this.riderPowerWatts();
  });

  // Total loaded system mass in kg (rider + dry bike + water)
  // Uses defaults (75 kg rider + 14 kg bike) if user has not entered custom weights
  readonly totalSystemMassKg = computed(() => {
    const r = this.riderWeight();
    const b = this.bikeWeight();
    const w = this.waterCapacityLiters() || 0; // 1 L = 1 kg
    const isKg = this.weightUnit() === 'kg';
    const riderKg = r !== null ? (isKg ? r : r / 2.20462) : 75.0;
    const bikeKg = b !== null ? (isKg ? b : b / 2.20462) : 14.0;
    return Math.round((riderKg + bikeKg + w) * 10) / 10;
  });

  // Computed speed in current display units, rounded to 0.5 precision
  readonly displaySpeed = computed(() => {
    const isKm = this.distanceUnit() === 'km';
    const val = isKm ? this.avgSpeedMph() * 1.609344 : this.avgSpeedMph();
    return Math.round(val * 2) / 2;
  });

  readonly speedUnit = computed(() => {
    return this.distanceUnit() === 'km' ? 'kph' : 'mph';
  });

  // Computed summary metrics
  readonly waterWeightInUnit = computed(() => {
    const liters = this.waterCapacityLiters();
    if (liters === null || liters <= 0) return 0;
    // 1 L of water = 1 kg = 2.20462 lbs
    return this.weightUnit() === 'kg'
      ? Math.round(liters * 10) / 10
      : Math.round(liters * 2.20462 * 10) / 10;
  });

  readonly totalBaseWeight = computed(() => {
    const r = this.riderWeight() || 0;
    const b = this.bikeWeight() || 0;
    if (!r && !b) return null;
    return Math.round((r + b) * 10) / 10;
  });

  readonly totalLoadedWeight = computed(() => {
    const r = this.riderWeight() || 0;
    const b = this.bikeWeight() || 0;
    const w = this.waterWeightInUnit();
    if (!r && !b && !w) return null;
    return Math.round((r + b + w) * 10) / 10;
  });

  constructor() {
    this.loadSettings();

    // Also persist upon any signal changes reactively
    effect(() => {
      this.persist();
    });
  }

  loadSettings(): void {
    const loaded = this.storage.loadSettings();
    if (loaded.riderWeight !== undefined) this.riderWeight.set(loaded.riderWeight);
    if (loaded.bikeWeight !== undefined) this.bikeWeight.set(loaded.bikeWeight);
    if (loaded.waterCapacityLiters !== undefined) this.waterCapacityLiters.set(loaded.waterCapacityLiters);
    if (loaded.weightUnit) this.weightUnit.set(loaded.weightUnit);
    if (loaded.distanceUnit) this.distanceUnit.set(loaded.distanceUnit);
    if (loaded.avgSpeedMph !== undefined) this.avgSpeedMph.set(loaded.avgSpeedMph);
    if (loaded.riderPowerWatts !== undefined) this.riderPowerWatts.set(loaded.riderPowerWatts);
    if (loaded.paceMode) this.paceMode.set(loaded.paceMode);
    if (loaded.climbSurgePercent !== undefined) this.climbSurgePercent.set(loaded.climbSurgePercent);
    if (loaded.climbSurgeDurationMinutes !== undefined) this.climbSurgeDurationMinutes.set(loaded.climbSurgeDurationMinutes);
    if (loaded.hikeBikeThresholdKmh !== undefined) this.hikeBikeThresholdKmh.set(loaded.hikeBikeThresholdKmh);
    if (loaded.hikeBikeBaseSpeedKmh !== undefined) this.hikeBikeBaseSpeedKmh.set(loaded.hikeBikeBaseSpeedKmh);
    if (loaded.mapStyle) this.mapStyle.set(loaded.mapStyle);
    if (loaded.mapZoomLevel !== undefined) this.mapZoomLevel.set(loaded.mapZoomLevel);
    if (loaded.activeTab) this.activeTab.set(loaded.activeTab);
    if (loaded.selectedRouteKey !== undefined) this.selectedRouteKey.set(loaded.selectedRouteKey);
    if (loaded.currentLocationMile !== undefined) this.currentLocationMile.set(loaded.currentLocationMile);
    if (loaded.routeLocations) this.routeLocations.set(loaded.routeLocations);
    if (loaded.keepScreenAwake !== undefined) this.keepScreenAwake.set(loaded.keepScreenAwake);
    if (loaded.anonymousTelemetryEnabled !== undefined) this.anonymousTelemetryEnabled.set(loaded.anonymousTelemetryEnabled);
    if (loaded.mapRenderer === 'auto' || loaded.mapRenderer === 'raster') {
      this.mapRenderer.set(loaded.mapRenderer);
    }
  }

  persist(): void {
    const currentSettings: UserSettings = {
      riderWeight: this.riderWeight(),
      bikeWeight: this.bikeWeight(),
      waterCapacityLiters: this.waterCapacityLiters(),
      weightUnit: this.weightUnit(),
      distanceUnit: this.distanceUnit(),
      avgSpeedMph: this.avgSpeedMph(),
      riderPowerWatts: this.riderPowerWatts(),
      paceMode: this.paceMode(),
      climbSurgePercent: this.climbSurgePercent(),
      climbSurgeDurationMinutes: this.climbSurgeDurationMinutes(),
      hikeBikeThresholdKmh: this.hikeBikeThresholdKmh(),
      hikeBikeBaseSpeedKmh: this.hikeBikeBaseSpeedKmh(),
      mapStyle: this.mapStyle(),
      mapZoomLevel: this.mapZoomLevel(),
      activeTab: this.activeTab(),
      selectedRouteKey: this.selectedRouteKey(),
      currentLocationMile: this.currentLocationMile(),
      routeLocations: this.routeLocations(),
      keepScreenAwake: this.keepScreenAwake(),
      anonymousTelemetryEnabled: this.anonymousTelemetryEnabled(),
      mapRenderer: this.mapRenderer()
    };
    this.storage.saveSettings(currentSettings);
  }

  setKeepScreenAwake(awake: boolean): void {
    this.keepScreenAwake.set(awake);
    this.persist();
  }

  toggleKeepScreenAwake(): void {
    this.keepScreenAwake.set(!this.keepScreenAwake());
    this.persist();
  }

  setRiderWeight(weight: number | null): void {
    this.riderWeight.set(weight !== null && !isNaN(weight) && weight > 0 ? weight : null);
    this.persist();
  }

  setBikeWeight(weight: number | null): void {
    this.bikeWeight.set(weight !== null && !isNaN(weight) && weight > 0 ? weight : null);
    this.persist();
  }

  setWaterCapacity(liters: number | null): void {
    this.waterCapacityLiters.set(liters !== null && !isNaN(liters) && liters >= 0 ? liters : null);
    this.persist();
  }

  setPaceMode(mode: PaceMode): void {
    this.paceMode.set(mode);
    this.persist();
  }

  togglePaceMode(): void {
    this.paceMode.set(this.paceMode() === 'power' ? 'speed' : 'power');
    this.persist();
  }

  adjustPower(delta: number): void {
    const current = this.riderPowerWatts();
    const next = Math.max(0, Math.min(800, current + delta));
    this.riderPowerWatts.set(next);
    this.persist();
  }

  setPower(watts: number): void {
    const clamped = Math.max(0, Math.min(800, Math.round(watts)));
    this.riderPowerWatts.set(clamped);
    this.persist();
  }

  adjustSpeed(delta: number): void {
    const isKm = this.distanceUnit() === 'km';
    const currentSpeed = isKm ? this.avgSpeedMph() * 1.609344 : this.avgSpeedMph();
    const roundedCurrent = Math.round(currentSpeed * 2) / 2;
    const step = delta > 0 ? 0.5 : -0.5;
    const nextSpeed = Math.max(isKm ? 2.0 : 1.0, Math.min(isKm ? 80.0 : 50.0, roundedCurrent + step));
    const nextMph = isKm ? nextSpeed / 1.609344 : nextSpeed;
    this.avgSpeedMph.set(Math.round(nextMph * 1000) / 1000);
    this.persist();
  }

  setAvgSpeedMph(speed: number): void {
    const clamped = Math.max(1.0, Math.min(50.0, Math.round(speed * 10) / 10));
    this.avgSpeedMph.set(clamped);
    this.persist();
  }

  toggleWeightUnit(): void {
    const currentUnit = this.weightUnit();
    const nextUnit: WeightUnit = currentUnit === 'kg' ? 'lbs' : 'kg';

    // Convert existing entered weights when toggling unit
    const r = this.riderWeight();
    const b = this.bikeWeight();

    if (currentUnit === 'kg' && nextUnit === 'lbs') {
      if (r !== null) this.riderWeight.set(Math.round(r * 2.20462 * 10) / 10);
      if (b !== null) this.bikeWeight.set(Math.round(b * 2.20462 * 10) / 10);
    } else if (currentUnit === 'lbs' && nextUnit === 'kg') {
      if (r !== null) this.riderWeight.set(Math.round((r / 2.20462) * 10) / 10);
      if (b !== null) this.bikeWeight.set(Math.round((b / 2.20462) * 10) / 10);
    }

    this.weightUnit.set(nextUnit);
    this.persist();
  }

  setClimbSurgePercent(percent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.climbSurgePercent.set(clamped);
    this.persist();
  }

  setClimbSurgeDurationMinutes(minutes: number): void {
    const clamped = Math.max(1, Math.min(120, Math.round(minutes)));
    this.climbSurgeDurationMinutes.set(clamped);
    this.persist();
  }

  setHikeBikeThresholdKmh(kmh: number): void {
    const clamped = Math.max(1.0, Math.min(20.0, Math.round(kmh * 10) / 10));
    this.hikeBikeThresholdKmh.set(clamped);
    this.persist();
  }

  setHikeBikeBaseSpeedKmh(kmh: number): void {
    const clamped = Math.max(1.0, Math.min(10.0, Math.round(kmh * 10) / 10));
    this.hikeBikeBaseSpeedKmh.set(clamped);
    this.persist();
  }

  setHikeBikeThresholdInUnit(value: number): void {
    if (value === null || isNaN(value) || value <= 0) return;
    const isMiles = this.distanceUnit() === 'miles';
    const kmh = isMiles ? value / 0.621371 : value;
    this.setHikeBikeThresholdKmh(kmh);
  }

  setHikeBikeBaseSpeedInUnit(value: number): void {
    if (value === null || isNaN(value) || value <= 0) return;
    const isMiles = this.distanceUnit() === 'miles';
    const kmh = isMiles ? value / 0.621371 : value;
    this.setHikeBikeBaseSpeedKmh(kmh);
  }

  setMapStyle(style: MapStyle): void {
    this.mapStyle.set(style);
    this.persist();
  }

  toggleMapStyle(): void {
    this.mapStyle.set(this.mapStyle() === 'dark' ? 'topo' : 'dark');
    this.persist();
  }

  setMapRenderer(mode: MapRendererMode): void {
    this.mapRenderer.set(mode);
    this.storage.setMapRenderer(mode);
    this.persist();
  }

  setActiveTab(tab: NavigationTab): void {
    this.activeTab.set(tab);
    this.persist();
  }

  setMapZoomLevel(zoom: number): void {
    if (typeof zoom === 'number' && !isNaN(zoom)) {
      const clamped = Math.max(2, Math.min(18, Math.round(zoom)));
      this.mapZoomLevel.set(clamped);
      this.persist();
    }
  }

  /**
   * Completely clears all items in localStorage and resets settings to defaults.
   */
  clearAllLocalStorage(): void {
    this.storage.clearStorage();
    this.resupplyCatalog?.resetAllToDefault();
    this.riderWeight.set(DEFAULT_USER_SETTINGS.riderWeight);
    this.bikeWeight.set(DEFAULT_USER_SETTINGS.bikeWeight);
    this.waterCapacityLiters.set(DEFAULT_USER_SETTINGS.waterCapacityLiters);
    this.weightUnit.set(DEFAULT_USER_SETTINGS.weightUnit);
    this.distanceUnit.set(DEFAULT_USER_SETTINGS.distanceUnit);
    this.avgSpeedMph.set(DEFAULT_USER_SETTINGS.avgSpeedMph);
    this.riderPowerWatts.set(DEFAULT_USER_SETTINGS.riderPowerWatts);
    this.paceMode.set(DEFAULT_USER_SETTINGS.paceMode ?? 'power');
    this.climbSurgePercent.set(DEFAULT_USER_SETTINGS.climbSurgePercent ?? 10);
    this.climbSurgeDurationMinutes.set(DEFAULT_USER_SETTINGS.climbSurgeDurationMinutes ?? 10);
    this.hikeBikeThresholdKmh.set(DEFAULT_USER_SETTINGS.hikeBikeThresholdKmh ?? 6.0);
    this.hikeBikeBaseSpeedKmh.set(DEFAULT_USER_SETTINGS.hikeBikeBaseSpeedKmh ?? 4.0);
    this.mapStyle.set(DEFAULT_USER_SETTINGS.mapStyle ?? 'dark');
    this.mapRenderer.set(DEFAULT_USER_SETTINGS.mapRenderer ?? 'auto');
    this.mapZoomLevel.set(DEFAULT_USER_SETTINGS.mapZoomLevel ?? 8);
    this.activeTab.set(DEFAULT_USER_SETTINGS.activeTab ?? 'waypoints');
    this.selectedRouteKey.set(null);
    this.currentLocationMile.set(0);
    this.routeLocations.set({});
    this.keepScreenAwake.set(DEFAULT_USER_SETTINGS.keepScreenAwake ?? true);
    this.anonymousTelemetryEnabled.set(DEFAULT_USER_SETTINGS.anonymousTelemetryEnabled ?? true);
  }

  setAnonymousTelemetryEnabled(enabled: boolean): void {
    this.anonymousTelemetryEnabled.set(enabled);
    this.persist();
  }

  toggleAnonymousTelemetry(): void {
    this.anonymousTelemetryEnabled.set(!this.anonymousTelemetryEnabled());
    this.persist();
  }

  setSelectedRouteKey(routeKey: string | null): void {
    this.selectedRouteKey.set(routeKey);
    this.persist();
  }

  saveLocation(routeId: string | null, mile: number): void {
    const validMile = Math.max(0, isNaN(mile) ? 0 : mile);
    this.currentLocationMile.set(validMile);
    if (routeId) {
      this.routeLocations.update((locs) => ({
        ...locs,
        [routeId]: validMile
      }));
    }
    this.persist();
  }

  getLocationForRoute(routeId: string | null): number {
    if (!routeId) {
      return this.currentLocationMile() || 0;
    }
    const locs = this.routeLocations();
    if (locs[routeId] !== undefined) {
      return locs[routeId];
    }
    return this.currentLocationMile() || 0;
  }
}
