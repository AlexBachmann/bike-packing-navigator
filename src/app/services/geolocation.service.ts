import { Injectable, signal, computed, effect, inject, OnDestroy, Signal, WritableSignal } from '@angular/core';
import { GpsState, ProjectionResult } from '../models/waypoint.model';
import { RouteDataService } from './route-data.service';
import { DeadReckoningService } from './dead-reckoning.service';
import { SettingsService } from './settings.service';
import { haversineMeters, calculateBearing } from '../utils/geo-math.utils';

export const GPS_RIDE_FREQUENCY_SECONDS = 1;
export const GPS_DEFAULT_FREQUENCY_SECONDS = 30;

@Injectable({
  providedIn: 'root'
})
export class GeolocationService implements OnDestroy {
  private readonly routeService = inject(RouteDataService, { optional: true });
  private readonly deadReckoning = inject(DeadReckoningService, { optional: true });
  private readonly settings = inject(SettingsService, { optional: true });

  private gpsIntervalId: any = null;
  private customFrequencySeconds: number | null = null;
  private onMileUpdateCallback: ((mile: number) => void) | null = null;

  // Primary reactive state exposed as WritableSignal for test suite compatibility
  readonly gpsState: WritableSignal<GpsState> = signal<GpsState>({
    enabled: false,
    loading: false,
    lastUpdated: null,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    error: null,
    projection: null,
    speedKph: null,
    heading: null
  });

  readonly isTracking: Signal<boolean> = computed(() => this.gpsState().enabled);
  readonly isLoading: Signal<boolean> = computed(() => this.gpsState().loading);
  readonly currentError: Signal<string | null> = computed(() => this.gpsState().error);
  readonly currentProjection: Signal<ProjectionResult | null> = computed(() => this.gpsState().projection);

  constructor() {
    effect(() => {
      const tab = this.settings?.activeTab();
      if (this.isTracking()) {
        this.startGpsInterval();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopTracking();
  }

  // --- Public API ---

  /**
   * Registers a callback invoked whenever an on-route GPS fix snaps the rider's position.
   * Returns an unsubscribe function.
   */
  onLocationUpdate(callback: (mile: number) => void): () => void {
    this.onMileUpdateCallback = callback;
    return () => {
      if (this.onMileUpdateCallback === callback) {
        this.onMileUpdateCallback = null;
      }
    };
  }

  /**
   * Starts GPS tracking with optional frequency override in seconds.
   */
  startTracking(frequencySeconds?: number): void {
    if (typeof frequencySeconds === 'number' && frequencySeconds > 0) {
      this.customFrequencySeconds = frequencySeconds;
    }
    this.gpsState.update((s) => ({ ...s, enabled: true, error: null }));
    this.requestLocation();
    this.startGpsInterval();
  }

  /**
   * Alias for startTracking
   */
  startGpsTracking(frequencySeconds?: number): void {
    this.startTracking(frequencySeconds);
  }

  /**
   * Stops GPS tracking, cancels timers, resets dead reckoning, and resets state.
   */
  stopTracking(): void {
    this.stopGpsInterval();
    this.deadReckoning?.stop();
    this.customFrequencySeconds = null;
    this.gpsState.set({
      enabled: false,
      loading: false,
      lastUpdated: null,
      latitude: null,
      longitude: null,
      previousLatitude: null,
      previousLongitude: null,
      accuracyMeters: null,
      error: null,
      projection: null,
      speedKph: null,
      heading: null
    });
  }

  /**
   * Alias for stopTracking
   */
  stopGpsTracking(): void {
    this.stopTracking();
  }

  /**
   * Toggles tracking on/off.
   */
  toggleTracking(): void {
    if (this.gpsState().enabled) {
      this.stopTracking();
    } else {
      this.startTracking();
    }
  }

  /**
   * Alias for toggleTracking
   */
  toggleGps(): void {
    this.toggleTracking();
  }

  /**
   * Retries acquiring GPS tracking.
   */
  retryGps(): void {
    this.startTracking();
  }

  /**
   * Manually sets or overrides the GPS polling frequency in seconds.
   */
  setFrequency(seconds: number): void {
    this.customFrequencySeconds = Math.max(1, seconds);
    if (this.gpsState().enabled) {
      this.startGpsInterval();
    }
  }

  /**
   * Returns current active polling interval in seconds.
   */
  getFrequencySeconds(): number {
    if (this.customFrequencySeconds !== null) {
      return this.customFrequencySeconds;
    }
    return this.settings?.activeTab() === 'ride' ? GPS_RIDE_FREQUENCY_SECONDS : GPS_DEFAULT_FREQUENCY_SECONDS;
  }

  /**
   * Alias for getFrequencySeconds
   */
  getGpsFrequencySeconds(): number {
    return this.getFrequencySeconds();
  }

  /**
   * Requests a one-shot current location via Promise.
   */
  requestCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        const errorMsg = 'Geolocation is not supported by your browser.';
        this.gpsState.update((s) => ({ ...s, loading: false, error: errorMsg }));
        reject(new Error(errorMsg));
        return;
      }

      const isRide = this.getFrequencySeconds() <= 3 || this.settings?.activeTab() === 'ride';
      this.gpsState.update((s) => ({ ...s, loading: true, error: null }));

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.handleLocationSuccess(pos);
          resolve(pos);
        },
        (err) => {
          this.handleLocationError(err, isRide);
          reject(err);
        },
        {
          enableHighAccuracy: true,
          timeout: isRide ? 5000 : 15000,
          maximumAge: isRide ? 1000 : 10000
        }
      );
    });
  }

  /**
   * Clears off-route and error alert banners without disabling GPS.
   */
  dismissAlert(): void {
    this.gpsState.update((s) => ({ ...s, projection: null, error: null }));
  }

  /**
   * Alias for dismissAlert
   */
  dismissGpsAlert(): void {
    this.dismissAlert();
  }

  /**
   * Clears active GPS error banner.
   */
  clearError(): void {
    this.gpsState.update((s) => ({ ...s, error: null }));
  }

  /**
   * Alias for clearError
   */
  clearGpsError(): void {
    this.clearError();
  }

  /**
   * Simulates a GPS location at specified coordinates.
   */
  simulateGpsLocation(lat: number, lon: number): void {
    const projection = this.routeService?.projectOntoRoute(lat, lon) ?? null;
    this.gpsState.set({
      enabled: true,
      loading: false,
      lastUpdated: new Date(),
      latitude: lat,
      longitude: lon,
      accuracyMeters: 5,
      error: null,
      projection
    });

    if (projection && !projection.isOffRoute) {
      this.onMileUpdateCallback?.(projection.projectedRouteMile);
    }
  }

  // --- Internal Polling & Handlers ---

  requestLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.gpsState.update((s) => ({
        ...s,
        loading: false,
        error: 'Geolocation is not supported by your browser.'
      }));
      return;
    }

    if (!this.gpsState().enabled) {
      return;
    }

    this.gpsState.update((s) => ({ ...s, loading: true, error: null }));
    const isRide = this.getFrequencySeconds() <= 3 || this.settings?.activeTab() === 'ride';

    navigator.geolocation.getCurrentPosition(
      (pos) => this.handleLocationSuccess(pos),
      (err) => this.handleLocationError(err, isRide),
      {
        enableHighAccuracy: true,
        timeout: isRide ? 5000 : 15000,
        maximumAge: isRide ? 1000 : 10000
      }
    );
  }

  handleLocationSuccess(pos: GeolocationPosition): void {
    // In-flight guard: discard if tracking disabled during async delay, but ensure loading is cleared
    if (!this.gpsState().enabled) {
      this.gpsState.update((s) => ({ ...s, loading: false }));
      return;
    }

    const currentGps = this.gpsState();
    const nowTime = pos.timestamp || Date.now();

    // Guard against stale out-of-order fixes: discard if fix timestamp is strictly older than lastUpdated
    if (currentGps.lastUpdated && nowTime < currentGps.lastUpdated.getTime()) {
      return;
    }

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;

    const prevLat = currentGps.latitude;
    const prevLon = currentGps.longitude;
    const prevHeading = currentGps.heading ?? null;
    const prevTime = currentGps.lastUpdated ? currentGps.lastUpdated.getTime() : null;

    // 1. Calculate Speed
    let speedKph: number | null = null;
    if (prevLat !== null && prevLon !== null && prevTime !== null) {
      const distMeters = haversineMeters(prevLat, prevLon, lat, lon);
      const deltaSec = Math.max(0.05, (nowTime - prevTime) / 1000);
      if (distMeters >= 1.0 && deltaSec > 0.05) {
        speedKph = (distMeters / deltaSec) * 3.6;
      } else {
        speedKph = 0;
      }
    } else if (typeof pos.coords.speed === 'number' && !isNaN(pos.coords.speed) && pos.coords.speed >= 0) {
      speedKph = pos.coords.speed * 3.6;
    }

    if (speedKph !== null && speedKph < 1.0) {
      speedKph = 0;
    }

    // 2. Calculate Heading
    const rawHeading = typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading)
      ? pos.coords.heading
      : null;

    let heading: number | null = null;
    const isStanding = speedKph === null || speedKph < 1.0;

    if (isStanding) {
      if (rawHeading !== null) {
        heading = rawHeading;
      } else if (prevHeading !== null) {
        heading = prevHeading;
      }
    } else {
      if (prevLat !== null && prevLon !== null) {
        const distMeters = haversineMeters(prevLat, prevLon, lat, lon);
        if (distMeters >= 2.0) {
          heading = calculateBearing(prevLat, prevLon, lat, lon);
        } else if (prevHeading !== null) {
          heading = prevHeading;
        }
      } else if (rawHeading !== null) {
        heading = rawHeading;
      } else if (prevHeading !== null) {
        heading = prevHeading;
      }
    }

    // 3. Project onto Route
    const projection = this.routeService?.projectOntoRoute(lat, lon) ?? null;

    // 4. Update State
    this.gpsState.set({
      enabled: true,
      loading: false,
      lastUpdated: new Date(nowTime),
      latitude: lat,
      longitude: lon,
      previousLatitude: prevLat,
      previousLongitude: prevLon,
      accuracyMeters: accuracy,
      error: null,
      projection,
      speedKph,
      heading
    });

    // 5. Feed Dead Reckoning Service
    this.deadReckoning?.updateGpsFix({
      latitude: lat,
      longitude: lon,
      timestamp: nowTime,
      projectedMile: projection && !projection.isOffRoute ? projection.projectedRouteMile : null,
      heading,
      accuracyMeters: accuracy
    }, speedKph);

    // 6. Notify On-Route Mile Update
    if (projection && !projection.isOffRoute) {
      this.onMileUpdateCallback?.(projection.projectedRouteMile);
    }
  }

  handleLocationError(err: GeolocationPositionError, isRide = this.getFrequencySeconds() <= 3 || this.settings?.activeTab() === 'ride'): void {
    // In-flight guard: discard if tracking disabled during async delay, but ensure loading is cleared
    if (!this.gpsState().enabled) {
      this.gpsState.update((s) => ({ ...s, loading: false }));
      return;
    }

    let msg = 'Failed to retrieve current location.';
    if (err.code === err.PERMISSION_DENIED) {
      msg = 'Location permission denied. Please allow location access in your browser.';
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      msg = 'GPS signal unavailable. Please ensure GPS/location services are enabled.';
    } else if (err.code === err.TIMEOUT) {
      msg = isRide ? 'GPS signal weak...' : 'GPS request timed out. Retrying in 30 seconds...';
    }

    this.gpsState.update((s) => ({
      ...s,
      loading: false,
      error: msg
    }));
  }

  startGpsInterval(): void {
    this.stopGpsInterval();
    const intervalMs = this.getFrequencySeconds() * 1000;
    this.gpsIntervalId = window.setInterval(() => {
      this.requestLocation();
    }, intervalMs);
  }

  stopGpsInterval(): void {
    if (this.gpsIntervalId) {
      clearInterval(this.gpsIntervalId);
      this.gpsIntervalId = null;
    }
  }

  restartGpsInterval(): void {
    this.startGpsInterval();
  }
}
