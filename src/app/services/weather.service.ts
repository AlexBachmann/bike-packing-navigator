import { Injectable, inject, signal, effect, WritableSignal, Signal } from '@angular/core';
import { NetworkStatusService } from './network-status.service';
import { RouteDataService } from './route-data.service';
import { SettingsService } from './settings.service';
import { EtaPhysicsService } from './eta-physics.service';
import { Climb } from '../models/elevation.model';
import {
  WeatherCurrentConditions,
  WeatherSegment,
  RawClimbForecastData,
  ClimbWeatherForecast,
  TwoHourWeatherOutlook,
  CachedRouteWeather,
  RawClimbPointForecast
} from '../models/weather.model';
import { getCoordinateAtKm } from '../utils/geo-math.utils';
import {
  WeatherApiClientService,
  WEATHER_SEGMENT_STEP_KM,
  OpenMeteoHourlyResponse,
  OpenMeteoPointResponse
} from './weather/weather-api-client.service';
import {
  WeatherCacheService,
  WEATHER_THROTTLE_MS
} from './weather/weather-cache.service';
import { ClimbWeatherService } from './weather/climb-weather.service';
import { TrailWeatherOutlookService } from './weather/trail-weather-outlook.service';

export {
  WEATHER_THROTTLE_MS,
  WEATHER_SEGMENT_STEP_KM
};
export type {
  OpenMeteoHourlyResponse,
  OpenMeteoPointResponse
};

@Injectable({
  providedIn: 'root'
})
export class WeatherService {
  private readonly networkStatus = inject(NetworkStatusService);
  private readonly routeData = inject(RouteDataService);
  private readonly settings = inject(SettingsService);
  private readonly etaPhysics = inject(EtaPhysicsService);

  readonly apiClient = inject(WeatherApiClientService);
  readonly cacheService = inject(WeatherCacheService);
  readonly climbWeather = inject(ClimbWeatherService);
  readonly trailOutlook = inject(TrailWeatherOutlookService);

  // Preserved Public Signals
  readonly currentWeather: WritableSignal<WeatherCurrentConditions | null> = this.trailOutlook.currentWeather;
  readonly segmentForecasts: WritableSignal<WeatherSegment[]> = this.trailOutlook.segmentForecasts;
  readonly rawClimbData: WritableSignal<RawClimbForecastData[]> = this.climbWeather.rawClimbData;
  readonly lastUpdated: WritableSignal<number | null> = this.cacheService.lastUpdated;
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Delegated Computed Signals
  readonly minutesUntilNextAllowedRefresh: Signal<number> = this.cacheService.minutesUntilNextAllowedRefresh;
  readonly isStale: Signal<boolean> = this.cacheService.isStale;
  readonly climbWeatherForecasts: Signal<Record<string, ClimbWeatherForecast>> = this.climbWeather.climbWeatherForecasts;
  readonly twoHourOutlook: Signal<TwoHourWeatherOutlook> = this.trailOutlook.twoHourOutlook;

  constructor() {
    // Automatically load cached weather or fetch when active route or track points change
    effect(() => {
      const routeId = typeof this.routeData.activeRouteId === 'function' ? this.routeData.activeRouteId() : null;
      const pts = typeof this.routeData.trackPoints === 'function' ? this.routeData.trackPoints() : [];
      if (!routeId || pts.length === 0) {
        this.clearState();
        return;
      }

      this.loadCachedWeather(routeId);
      this.autoFetchIfEligible(routeId);
    });
  }

  private clearState(): void {
    this.currentWeather.set(null);
    this.segmentForecasts.set([]);
    this.rawClimbData.set([]);
    this.lastUpdated.set(null);
    this.error.set(null);
  }

  getClimbForecast(climbId: string): ClimbWeatherForecast | null {
    return this.climbWeather.getClimbForecast(climbId);
  }

  loadCachedWeather(routeId: string): boolean {
    const cached = this.cacheService.loadCachedWeather(routeId);
    if (cached && cached.routeId === routeId) {
      if (cached.segments?.length > 0) {
        this.segmentForecasts.set(cached.segments);
        this.currentWeather.set(cached.segments[0].current);
      }
      if (cached.rawClimbs?.length) {
        this.rawClimbData.set(cached.rawClimbs);
      }
      return true;
    }
    return false;
  }

  private autoFetchIfEligible(routeId: string): void {
    if (!this.networkStatus.isOnline()) return;
    if (!this.cacheService.isThrottled(false)) {
      this.refreshWeather(false);
    }
  }

  getUpcomingClimbsIn24h(): Climb[] {
    return this.climbWeather.getUpcomingClimbsIn24h();
  }

  generateClimbSamplePoints(
    climb: Climb,
    trackPoints: [number, number, number, number, number][]
  ) {
    return this.climbWeather.generateClimbSamplePoints(climb, trackPoints);
  }

  getCoordinateAtKm(
    km: number,
    trackPoints: [number, number, number, number, number][]
  ) {
    return getCoordinateAtKm(km, trackPoints);
  }

  getWeatherAtKmAndTimestamp(routeKm: number, arrivalUnix: number) {
    return this.trailOutlook.getWeatherAtKmAndTimestamp(routeKm, arrivalUnix);
  }

  async refreshWeather(force = false): Promise<boolean> {
    const routeId = typeof this.routeData.activeRouteId === 'function' ? this.routeData.activeRouteId() : null;
    const pts = typeof this.routeData.trackPoints === 'function' ? this.routeData.trackPoints() : [];
    if (!routeId || pts.length === 0) return false;

    // Strict throttle check
    if (this.cacheService.isThrottled(force)) {
      return false;
    }

    if (!this.networkStatus.isOnline()) {
      this.error.set('Offline - showing cached forecast');
      return false;
    }

    // 1. Determine rider location and 24-hour horizon segments (50km step)
    const currentMile = this.settings.currentLocationMile() ?? 0;
    const currentKm = currentMile * 1.60934;
    const totalKm = this.routeData.totalDistanceKm || pts[pts.length - 1][3];

    const speedMph = this.settings.avgSpeedMph() || 10;
    const speedKmh = speedMph * 1.60934;
    const estimated24hDistanceKm = Math.max(150, Math.min(250, Math.round(speedKmh * 12)));
    const endKm = Math.min(totalKm, currentKm + estimated24hDistanceKm);

    const sampleKms: number[] = [];
    sampleKms.push(Math.min(totalKm, currentKm));
    let nextKm = Math.floor((currentKm + WEATHER_SEGMENT_STEP_KM) / WEATHER_SEGMENT_STEP_KM) * WEATHER_SEGMENT_STEP_KM;
    while (nextKm <= endKm && sampleKms.length < 5) {
      if (nextKm > currentKm + 5) {
        sampleKms.push(Math.min(totalKm, nextKm));
      }
      nextKm += WEATHER_SEGMENT_STEP_KM;
    }

    if (sampleKms.length === 1 && currentKm + 20 < totalKm) {
      sampleKms.push(Math.min(totalKm, currentKm + WEATHER_SEGMENT_STEP_KM));
    }

    const corridorCoordinates = sampleKms.map((km) => this.getCoordinateAtKm(km, pts));

    // 2. Identify upcoming climbs in the next 24 hours & sample every 1 km
    const upcomingClimbs = this.getUpcomingClimbsIn24h();
    const climbSampleMap = new Map<string, any[]>();
    const allClimbPoints: any[] = [];

    for (const climb of upcomingClimbs) {
      const climbPts = this.generateClimbSamplePoints(climb, pts);
      climbSampleMap.set(climb.id, climbPts);
      allClimbPoints.push(...climbPts);
    }

    // 3. Combine coordinates for batch retrieval
    const allCoordsToFetch = [
      ...corridorCoordinates,
      ...allClimbPoints.map((p) => ({ lat: p.lat, lon: p.lon }))
    ];

    this.isLoading.set(true);
    this.error.set(null);

    try {
      const pointResponses = await this.apiClient.fetchPointsBatch(allCoordsToFetch);

      // Parse 50km corridor segments
      const segments: WeatherSegment[] = [];
      for (let i = 0; i < sampleKms.length; i++) {
        const km = sampleKms[i];
        const coord = corridorCoordinates[i];
        const res = pointResponses[i] || pointResponses[0];
        const seg = this.apiClient.parseSegmentForecast(km, coord, res, i === 0, currentMile);
        segments.push(seg);
      }

      // Parse per-kilometer climb forecasts
      let responseOffset = sampleKms.length;
      const rawClimbs: RawClimbForecastData[] = [];

      for (const climb of upcomingClimbs) {
        const climbPts = climbSampleMap.get(climb.id) || [];
        const points: RawClimbPointForecast[] = [];

        for (const pt of climbPts) {
          const res = pointResponses[responseOffset++] || pointResponses[0];
          points.push(this.apiClient.parseRawClimbPointForecast(pt, res));
        }

        rawClimbs.push({
          climbId: climb.id,
          climbName: climb.name,
          startMile: climb.startMile,
          endMile: climb.endMile,
          startKm: climb.startKm,
          endKm: climb.endKm,
          points
        });
      }

      this.segmentForecasts.set(segments);
      if (segments.length > 0) {
        this.currentWeather.set(segments[0].current);
      }
      this.rawClimbData.set(rawClimbs);
      const now = Date.now();
      this.lastUpdated.set(now);

      // Save to localStorage for complete offline resilience
      const cachedPayload: CachedRouteWeather = {
        routeId,
        lastFetchedTimestamp: now,
        riderKm: currentKm,
        segments,
        rawClimbs
      };
      this.cacheService.saveCachedWeather(cachedPayload);

      this.isLoading.set(false);
      return true;
    } catch (err: any) {
      console.error('Failed to fetch Open-Meteo weather', err);
      this.error.set('Failed to update weather: ' + (err.message || 'Network error'));
      this.isLoading.set(false);
      return false;
    }
  }
}
