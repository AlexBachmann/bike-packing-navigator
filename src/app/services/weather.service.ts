import { Injectable, inject, signal, computed, effect } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { NetworkStatusService } from "./network-status.service";
import { RouteDataService } from "./route-data.service";
import { SettingsService } from "./settings.service";
import { EtaPhysicsService } from "./eta-physics.service";
import { Climb } from "../models/elevation.model";
import {
  WeatherHourPoint,
  WeatherCurrentConditions,
  WeatherSegment,
  CachedRouteWeather,
  RawClimbPointForecast,
  RawClimbForecastData,
  ClimbKmWeatherPoint,
  ClimbThunderstormHazard,
  ClimbWeatherForecast,
  interpretWmoWeatherCode,
  degreesToCardinal,
  isThunderstormWeatherCode,
  isRainWeatherCode,
  TwoHourAlertKind,
  TwoHourWeatherOutlook,
  calculateBearing,
  calculateRelativeWind,
  isMudSusceptibleSurface
} from "../models/weather.model";

interface OpenMeteoHourlyResponse {
  time: (number | string)[];
  temperature_2m: number[];
  precipitation: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  weather_code: number[];
}

interface OpenMeteoPointResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  utc_offset_seconds: number;
  hourly: OpenMeteoHourlyResponse;
}

export const WEATHER_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes
export const WEATHER_SEGMENT_STEP_KM = 50;         // 50 km segments

@Injectable({
  providedIn: "root"
})
export class WeatherService {
  private readonly http = inject(HttpClient);
  private readonly networkStatus = inject(NetworkStatusService);
  private readonly routeData = inject(RouteDataService);
  private readonly settings = inject(SettingsService);
  private readonly etaPhysics = inject(EtaPhysicsService);

  readonly currentWeather = signal<WeatherCurrentConditions | null>(null);
  readonly segmentForecasts = signal<WeatherSegment[]>([]);
  readonly rawClimbData = signal<RawClimbForecastData[]>([]);
  readonly lastUpdated = signal<number | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Time remaining until 30-minute fair use throttle expires (0 if refresh is allowed)
  readonly minutesUntilNextAllowedRefresh = computed<number>(() => {
    const last = this.lastUpdated();
    if (!last) return 0;
    const elapsed = Date.now() - last;
    if (elapsed >= WEATHER_THROTTLE_MS) return 0;
    return Math.ceil((WEATHER_THROTTLE_MS - elapsed) / 60000);
  });

  // Stale check (cache older than 6 hours)
  readonly isStale = computed<boolean>(() => {
    const last = this.lastUpdated();
    if (!last) return true;
    return Date.now() - last > 6 * 60 * 60 * 1000;
  });

  /**
   * Reactively evaluates weather for each upcoming climb matched to the rider estimated arrival time.
   * Whenever rider position, pacing power/speed, or time changes, arrival times are re-matched against
   * the cached 48-hour hourly curve without needing new network requests.
   */
  readonly climbWeatherForecasts = computed<Record<string, ClimbWeatherForecast>>(() => {
    const rawClimbs = this.rawClimbData();
    const currentMile = this.settings.currentLocationMile() ?? 0;
    this.settings.paceMode();
    this.settings.riderPowerWatts();
    this.settings.avgSpeedMph();
    if (typeof this.etaPhysics.cacheVersion === "function") {
      this.etaPhysics.cacheVersion();
    }

    if (!rawClimbs || rawClimbs.length === 0) return {};

    const now = Date.now();
    const result: Record<string, ClimbWeatherForecast> = {};

    for (const climb of rawClimbs) {
      const kmPoints: ClimbKmWeatherPoint[] = [];

      for (const pt of climb.points) {
        // ETA in seconds from current rider location to this climb kilometer point
        let etaSeconds = 0;
        if (currentMile < pt.routeMile) {
          etaSeconds = this.etaPhysics.calculateEtaSeconds(currentMile, pt.routeMile);
        } else {
          etaSeconds = 0; // Already at or past this point
        }

        const arrivalTimestamp = now + etaSeconds * 1000;
        const arrivalUnixSec = Math.floor(arrivalTimestamp / 1000);

        // Find matching hour in hourly forecast
        const timeArr = pt.hourly.time;
        let bestIdx = 0;
        if (timeArr && timeArr.length > 0) {
          let minDiff = Infinity;
          for (let i = 0; i < timeArr.length; i++) {
            const t = typeof timeArr[i] === "number"
              ? (timeArr[i] as number)
              : Math.floor(new Date(timeArr[i]).getTime() / 1000);
            const diff = Math.abs(t - arrivalUnixSec);
            if (diff < minDiff) {
              minDiff = diff;
              bestIdx = i;
            }
          }
        }

        const weatherCode = pt.hourly.weather_code[bestIdx] ?? 0;
        const isThunderstorm = isThunderstormWeatherCode(weatherCode);
        const tempC = pt.hourly.temperature_2m[bestIdx] ?? 15;
        const tempF = Math.round((tempC * 9) / 5 + 32);
        const precipitationMm = pt.hourly.precipitation[bestIdx] ?? 0;
        const precipitationInches = Math.round((precipitationMm / 25.4) * 100) / 100;
        const windSpeedKmh = pt.hourly.wind_speed_10m[bestIdx] ?? 10;
        const windSpeedMph = Math.round((windSpeedKmh / 1.60934) * 10) / 10;
        const windDirectionDeg = pt.hourly.wind_direction_10m[bestIdx] ?? 0;
        const windCardinal = degreesToCardinal(windDirectionDeg);
        const { description, icon } = interpretWmoWeatherCode(weatherCode);

        const arrivalDate = new Date(arrivalTimestamp);
        const arrivalFormatted = arrivalDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

        kmPoints.push({
          climbKm: pt.climbKm,
          routeKm: pt.routeKm,
          routeMile: pt.routeMile,
          lat: pt.lat,
          lon: pt.lon,
          elevationM: pt.elevationM,
          elevationFt: Math.round(pt.elevationM * 3.28084),
          estimatedArrivalSeconds: etaSeconds,
          estimatedArrivalTimestamp: arrivalTimestamp,
          estimatedArrivalFormatted: arrivalFormatted,
          weatherAtArrival: {
            tempC,
            tempF,
            precipitationMm,
            precipitationInches,
            windSpeedKmh,
            windSpeedMph,
            windDirectionDeg,
            windCardinal,
            weatherCode,
            weatherDescription: description,
            weatherIcon: icon,
            isThunderstorm
          }
        });
      }

      if (kmPoints.length === 0) continue;

      const baseWeather = kmPoints[0];
      const summitWeather = kmPoints[kmPoints.length - 1];

      // Identify thunderstorm hazard for points rider has yet to reach
      const futurePoints = kmPoints.filter((p) => p.routeMile >= currentMile - 0.2);
      const stormPoints = futurePoints.filter((p) => p.weatherAtArrival.isThunderstorm);
      const hasThunderstormHazard = stormPoints.length > 0;

      let thunderstormHazard: ClimbThunderstormHazard | undefined = undefined;
      if (hasThunderstormHazard) {
        const earliestKm = Math.min(...stormPoints.map((p) => p.climbKm));
        const latestKm = Math.max(...stormPoints.map((p) => p.climbKm));
        const firstStorm = stormPoints[0];
        const summitAffected = stormPoints.some((p) => p.climbKm >= summitWeather.climbKm - 0.5);
        const severity = stormPoints.some(
          (p) => p.weatherAtArrival.weatherCode === 99 || p.weatherAtArrival.weatherCode === 96
        )
          ? "severe"
          : "moderate";

        const message = summitAffected
          ? `Thunderstorm forecast at summit (KM ${summitWeather.climbKm.toFixed(1)}, ${summitWeather.elevationM}m) around ${firstStorm.estimatedArrivalFormatted}`
          : `Thunderstorm forecast along climb (KM ${earliestKm.toFixed(1)}–${latestKm.toFixed(1)}) around ${firstStorm.estimatedArrivalFormatted}`;

        thunderstormHazard = {
          hasHazard: true,
          earliestKm,
          latestKm,
          estimatedTimeFormatted: firstStorm.estimatedArrivalFormatted,
          estimatedArrivalTimestamp: firstStorm.estimatedArrivalTimestamp,
          weatherCode: firstStorm.weatherAtArrival.weatherCode,
          severity,
          message,
          summitAffected
        };
      }

      result[climb.climbId] = {
        climbId: climb.climbId,
        climbName: climb.climbName,
        hasThunderstormHazard,
        thunderstormHazard,
        summitWeather,
        baseWeather,
        kmPoints,
        estimatedStartTimestamp: baseWeather.estimatedArrivalTimestamp,
        estimatedSummitTimestamp: summitWeather.estimatedArrivalTimestamp,
        estimatedStartTimeFormatted: baseWeather.estimatedArrivalFormatted,
        estimatedSummitTimeFormatted: summitWeather.estimatedArrivalFormatted
      };
    }

    return result;
  });

  /**
   * Retrieves weather conditions at a specific route kilometer and unix timestamp
   * using fine-grained climb forecast curves where available, or the nearest corridor segment forecast.
   */
  getWeatherAtKmAndTimestamp(
    routeKm: number,
    arrivalUnix: number
  ): {
    weatherCode: number;
    tempC: number;
    precipitationMm: number;
    windSpeedKmh: number;
    windDirectionDeg: number;
  } {
    // 1. Check if routeKm falls within any cached climb
    const rawClimbs = this.rawClimbData();
    for (const climb of rawClimbs) {
      if (routeKm >= climb.startKm - 0.5 && routeKm <= climb.endKm + 0.5 && climb.points.length > 0) {
        let bestPt = climb.points[0];
        let bestDiff = Math.abs(bestPt.routeKm - routeKm);
        for (let i = 1; i < climb.points.length; i++) {
          const diff = Math.abs(climb.points[i].routeKm - routeKm);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestPt = climb.points[i];
          }
        }

        const times = bestPt.hourly.time;
        if (times && times.length > 0) {
          let bestIdx = 0;
          let bestTimeDiff = Math.abs(Number(times[0]) - arrivalUnix);
          for (let h = 1; h < times.length; h++) {
            const timeDiff = Math.abs(Number(times[h]) - arrivalUnix);
            if (timeDiff < bestTimeDiff) {
              bestTimeDiff = timeDiff;
              bestIdx = h;
            }
          }
          return {
            weatherCode: bestPt.hourly.weather_code[bestIdx] ?? 0,
            tempC: bestPt.hourly.temperature_2m[bestIdx] ?? 15,
            precipitationMm: bestPt.hourly.precipitation[bestIdx] ?? 0,
            windSpeedKmh: bestPt.hourly.wind_speed_10m[bestIdx] ?? 5,
            windDirectionDeg: bestPt.hourly.wind_direction_10m[bestIdx] ?? 0
          };
        }
      }
    }

    // 2. Otherwise fall back to nearest 50 km segment
    const segments = this.segmentForecasts();
    if (segments.length > 0) {
      let bestSeg = segments[0];
      let bestDist = Math.abs(bestSeg.km - routeKm);
      for (let i = 1; i < segments.length; i++) {
        const dist = Math.abs(segments[i].km - routeKm);
        if (dist < bestDist) {
          bestDist = dist;
          bestSeg = segments[i];
        }
      }

      if (bestSeg.hourly24h && bestSeg.hourly24h.length > 0) {
        let bestHourPt = bestSeg.hourly24h[0];
        let bestHourDiff = 999999999;
        for (const hp of bestSeg.hourly24h) {
          const hpTime = new Date(hp.time).getTime() / 1000;
          const diff = Math.abs(hpTime - arrivalUnix);
          if (diff < bestHourDiff) {
            bestHourDiff = diff;
            bestHourPt = hp;
          }
        }
        return {
          weatherCode: bestHourPt.weatherCode,
          tempC: bestHourPt.tempC,
          precipitationMm: bestHourPt.precipitationMm,
          windSpeedKmh: bestHourPt.windSpeedKmh,
          windDirectionDeg: bestHourPt.windDirectionDeg
        };
      }

      return {
        weatherCode: bestSeg.current.weatherCode,
        tempC: bestSeg.current.tempC,
        precipitationMm: bestSeg.current.precipitationMm,
        windSpeedKmh: bestSeg.current.windSpeedKmh,
        windDirectionDeg: bestSeg.current.windDirectionDeg
      };
    }

    // Default fallback to current weather
    const curr = this.currentWeather();
    return {
      weatherCode: curr ? curr.weatherCode : 0,
      tempC: curr ? curr.tempC : 15,
      precipitationMm: curr ? curr.precipitationMm : 0,
      windSpeedKmh: curr ? curr.windSpeedKmh : 5,
      windDirectionDeg: curr ? curr.windDirectionDeg : 0
    };
  }

  private formatEtaMinutes(mins: number): string {
    if (mins <= 2) return 'Now';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  /**
   * Reactively evaluates the 2-hour forward outlook along the rider's upcoming path.
   * Priority:
   * 1. Thunderstorm (⛈️)
   * 2. Heavy Mud (🚜)
   * 3. Heavy Headwind (🌬️)
   * 4. Heavy Tailwind (💨)
   * 5. Normal weather
   */
  readonly twoHourOutlook = computed<TwoHourWeatherOutlook>(() => {
    const currentMile = this.settings.currentLocationMile() ?? 0;
    const currentKm = currentMile * 1.60934;
    this.settings.paceMode();
    this.settings.riderPowerWatts();
    this.settings.avgSpeedMph();
    if (typeof this.etaPhysics.cacheVersion === 'function') {
      this.etaPhysics.cacheVersion();
    }
    const trackPts = typeof this.routeData.trackPoints === 'function' ? this.routeData.trackPoints() : [];
    const curr = this.currentWeather();
    const segments = this.segmentForecasts();

    if (!curr && segments.length === 0) {
      return {
        alertKind: 'normal',
        icon: '☀️',
        badgeText: 'Normal',
        title: 'Normal Conditions',
        summary: 'Weather data not yet loaded',
        detailMessage: 'Connect to cellular service to update trail forecasts.',
        advice: 'Ride safely and monitor changing mountain weather.'
      };
    }

    const nowMs = Date.now();
    const totalRouteKm = typeof this.routeData.totalKmSignal === 'function'
      ? this.routeData.totalKmSignal()
      : (this.routeData.totalDistanceKm || this.routeData.totalDistanceMiles * 1.60934 || 4000);

    // Step forward along the trail for up to 2 hours of travel (7,200 seconds)
    const pointsToCheck: Array<{
      routeKm: number;
      routeMile: number;
      etaSeconds: number;
      surface: { roadClass: string; surface: string; tracktype: string };
      travelBearing: number;
      weather: {
        weatherCode: number;
        tempC: number;
        precipitationMm: number;
        windSpeedKmh: number;
        windDirectionDeg: number;
      };
    }> = [];

    for (let offsetKm = 0; offsetKm <= 75; offsetKm += 1.0) {
      const routeKm = currentKm + offsetKm;
      if (totalRouteKm > 0 && routeKm > totalRouteKm) break;
      const routeMile = routeKm / 1.60934;
      const etaSeconds = offsetKm === 0 ? 0 : this.etaPhysics.calculateEtaSeconds(currentMile, routeMile);
      if (offsetKm > 0 && etaSeconds > 7200) {
        break; // Exceeded 2-hour horizon
      }

      const arrivalUnix = Math.floor((nowMs + etaSeconds * 1000) / 1000);
      const surf = this.etaPhysics.getSurfaceAtKm(routeKm);
      const p1 = this.getCoordinateAtKm(routeKm, trackPts);
      const p2 = this.getCoordinateAtKm(routeKm + 0.3, trackPts);
      const travelBearing = calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      const weather = this.getWeatherAtKmAndTimestamp(routeKm, arrivalUnix);

      pointsToCheck.push({
        routeKm,
        routeMile,
        etaSeconds,
        surface: surf,
        travelBearing,
        weather
      });
    }

    if (pointsToCheck.length === 0) {
      return {
        alertKind: 'normal',
        icon: curr ? curr.weatherIcon : '☀️',
        badgeText: 'Benign',
        title: 'Benign Trail Conditions',
        summary: curr ? `${curr.weatherDescription}, ${curr.tempC}°C` : 'Normal weather conditions',
        detailMessage: 'No thunderstorms, heavy mud, or punishing headwinds expected over the next 2 hours.',
        advice: 'Enjoy the ride!'
      };
    }

    // 1. TIER 1: Thunderstorm
    const stormPt = pointsToCheck.find((p) => isThunderstormWeatherCode(p.weather.weatherCode));
    if (stormPt) {
      const etaMins = Math.round(stormPt.etaSeconds / 60);
      const etaFormatted = this.formatEtaMinutes(etaMins);
      return {
        alertKind: 'thunderstorm',
        icon: '⛈️',
        badgeText: 'Thunderstorm',
        title: 'Thunderstorm Warning (Next 2h)',
        summary: `Thunderstorm forecast in ~${etaFormatted} at KM ${stormPt.routeKm.toFixed(1)}`,
        detailMessage: `Thunderstorm conditions forecast along your trail in approximately ${etaFormatted} around KM ${stormPt.routeKm.toFixed(1)}. High lightning hazard and sudden freezing rain.`,
        advice: 'Avoid exposed peaks and ridgelines. Plan ascent timing carefully or seek shelter before entering open terrain.',
        locationKmRange: { startKm: stormPt.routeKm, endKm: stormPt.routeKm },
        etaSeconds: stormPt.etaSeconds,
        etaFormatted,
        metrics: {
          precipitationMm: stormPt.weather.precipitationMm,
          windSpeedKmh: stormPt.weather.windSpeedKmh
        }
      };
    }

    // 2. TIER 2: Heavy Mud Hazard
    const mudPt = pointsToCheck.find((p) => {
      const isMudSurface = isMudSusceptibleSurface(p.surface.surface, p.surface.tracktype);
      const isRain = p.weather.precipitationMm >= 0.8 || isRainWeatherCode(p.weather.weatherCode);
      return isMudSurface && isRain;
    });

    if (mudPt) {
      const etaMins = Math.round(mudPt.etaSeconds / 60);
      const etaFormatted = this.formatEtaMinutes(etaMins);
      const surfDesc = mudPt.surface.tracktype ? `${mudPt.surface.surface} (${mudPt.surface.tracktype})` : mudPt.surface.surface;
      return {
        alertKind: 'mud',
        icon: '🚜',
        badgeText: 'Heavy Mud Risk',
        title: 'Heavy Mud Hazard (Next 2h)',
        summary: `Rain on ${mudPt.surface.surface} in ~${etaFormatted} (KM ${mudPt.routeKm.toFixed(1)})`,
        detailMessage: `Rain (${mudPt.weather.precipitationMm.toFixed(1)} mm/h) forecast over mud-susceptible terrain (${surfDesc}) in approximately ${etaFormatted} at KM ${mudPt.routeKm.toFixed(1)}. Soft dirt turns into unrideable "peanut butter" clay that clogs tire clearance and locks wheels.`,
        advice: 'Anticipate heavy tire packing and unavoidable hike-a-bike. Keep scrapers accessible to clean clearances, or pause on firm gravel while heavy rain passes.',
        locationKmRange: { startKm: mudPt.routeKm, endKm: mudPt.routeKm },
        etaSeconds: mudPt.etaSeconds,
        etaFormatted,
        metrics: {
          precipitationMm: mudPt.weather.precipitationMm,
          surface: mudPt.surface.surface,
          tracktype: mudPt.surface.tracktype
        }
      };
    }

    // 3. TIER 3: Heavy Headwinds (Bad News)
    let worstHeadwindPt: (typeof pointsToCheck)[0] | null = null;
    let maxHeadwindKmh = 0;

    for (const p of pointsToCheck) {
      const rel = calculateRelativeWind(p.travelBearing, p.weather.windDirectionDeg, p.weather.windSpeedKmh);
      if (rel.headwindKmh >= 20 && rel.headwindKmh > maxHeadwindKmh) {
        maxHeadwindKmh = rel.headwindKmh;
        worstHeadwindPt = p;
      }
    }

    if (worstHeadwindPt && maxHeadwindKmh >= 20) {
      const etaMins = Math.round(worstHeadwindPt.etaSeconds / 60);
      const etaFormatted = this.formatEtaMinutes(etaMins);
      const cardinal = degreesToCardinal(worstHeadwindPt.weather.windDirectionDeg);
      return {
        alertKind: 'headwind',
        icon: '🌬️',
        badgeText: 'Heavy Headwind',
        title: 'Heavy Headwind Ahead (Next 2h)',
        summary: `${maxHeadwindKmh.toFixed(0)} km/h direct headwind in ~${etaFormatted}`,
        detailMessage: `Punishing headwind (${maxHeadwindKmh.toFixed(0)} km/h opposing vector from ${cardinal}) expected around KM ${worstHeadwindPt.routeKm.toFixed(1)} in ~${etaFormatted}. Pacing will drop by 30-50% with heavy aerodynamic resistance.`,
        advice: 'Tuck into an aerodynamic position, pace your power output conservatively to avoid blowing up, and plan for longer travel times.',
        locationKmRange: { startKm: worstHeadwindPt.routeKm, endKm: worstHeadwindPt.routeKm },
        etaSeconds: worstHeadwindPt.etaSeconds,
        etaFormatted,
        metrics: {
          windSpeedKmh: worstHeadwindPt.weather.windSpeedKmh,
          headwindKmh: maxHeadwindKmh,
          windCardinal: cardinal
        }
      };
    }

    // 4. TIER 4: Heavy Tailwinds (Good News)
    let bestTailwindPt: (typeof pointsToCheck)[0] | null = null;
    let maxTailwindKmh = 0;

    for (const p of pointsToCheck) {
      const rel = calculateRelativeWind(p.travelBearing, p.weather.windDirectionDeg, p.weather.windSpeedKmh);
      if (rel.tailwindKmh >= 20 && rel.tailwindKmh > maxTailwindKmh) {
        maxTailwindKmh = rel.tailwindKmh;
        bestTailwindPt = p;
      }
    }

    if (bestTailwindPt && maxTailwindKmh >= 20) {
      const etaMins = Math.round(bestTailwindPt.etaSeconds / 60);
      const etaFormatted = this.formatEtaMinutes(etaMins);
      const cardinal = degreesToCardinal(bestTailwindPt.weather.windDirectionDeg);
      return {
        alertKind: 'tailwind',
        icon: '💨',
        badgeText: 'Tailwind Boost',
        title: 'Strong Tailwind Assist (Next 2h)',
        summary: `${maxTailwindKmh.toFixed(0)} km/h tailwind push in ~${etaFormatted}`,
        detailMessage: `Strong aerodynamic assist (${maxTailwindKmh.toFixed(0)} km/h tailwind push from ${cardinal}) expected around KM ${bestTailwindPt.routeKm.toFixed(1)} in ~${etaFormatted}. Faster cruising speeds with less pedaling effort!`,
        advice: 'Capitalize on this section to make fast miles with reduced energy expenditure.',
        locationKmRange: { startKm: bestTailwindPt.routeKm, endKm: bestTailwindPt.routeKm },
        etaSeconds: bestTailwindPt.etaSeconds,
        etaFormatted,
        metrics: {
          windSpeedKmh: bestTailwindPt.weather.windSpeedKmh,
          tailwindKmh: maxTailwindKmh,
          windCardinal: cardinal
        }
      };
    }

    // 5. TIER 5: Normal Weather
    return {
      alertKind: 'normal',
      icon: curr ? curr.weatherIcon : '☀️',
      badgeText: 'Benign',
      title: 'Clear 2-Hour Trail Outlook',
      summary: curr ? `${curr.weatherDescription}, ${curr.tempC}°C` : 'Normal weather conditions',
      detailMessage: 'No thunderstorms, heavy mud, or punishing headwinds forecast for the next 2 hours of travel.',
      advice: 'Smooth conditions ahead. Maintain target cadence and enjoy the trail.',
      metrics: curr ? {
        precipitationMm: curr.precipitationMm,
        windSpeedKmh: curr.windSpeedKmh,
        windCardinal: curr.windCardinal
      } : undefined
    };
  });

  constructor() {
    // Automatically load cached weather or fetch when active route or track points change
    effect(() => {
      const routeId = typeof this.routeData.activeRouteId === "function" ? this.routeData.activeRouteId() : null;
      const pts = typeof this.routeData.trackPoints === "function" ? this.routeData.trackPoints() : [];
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

  private getCacheKey(routeId: string): string {
    return `bpn_weather_cache_${routeId}`;
  }

  getClimbForecast(climbId: string): ClimbWeatherForecast | null {
    return this.climbWeatherForecasts()[climbId] || null;
  }

  /**
   * Loads cached forecast from localStorage for the active route
   */
  loadCachedWeather(routeId: string): boolean {
    if (typeof localStorage === "undefined") return false;
    try {
      let raw = localStorage.getItem(this.getCacheKey(routeId));
      if (!raw) {
        raw = localStorage.getItem(`td_weather_cache_${routeId}`);
      }
      if (!raw) return false;

      const cached: CachedRouteWeather = JSON.parse(raw);
      if (cached && cached.routeId === routeId) {
        if (cached.segments?.length > 0) {
          this.segmentForecasts.set(cached.segments);
          this.currentWeather.set(cached.segments[0].current);
        }
        if (cached.rawClimbs?.length) {
          this.rawClimbData.set(cached.rawClimbs);
        }
        this.lastUpdated.set(cached.lastFetchedTimestamp);
        return true;
      }
    } catch (e) {
      console.warn("Failed to parse cached weather from localStorage", e);
    }
    return false;
  }

  /**
   * Checks throttle and network status to auto-fetch if eligible
   */
  private autoFetchIfEligible(routeId: string): void {
    if (!this.networkStatus.isOnline()) return;

    const last = this.lastUpdated();
    const now = Date.now();
    if (!last || now - last >= WEATHER_THROTTLE_MS) {
      this.refreshWeather(false);
    }
  }

  /**
   * Returns upcoming climbs where the rider estimated start time is within the next 24 hours.
   */
  getUpcomingClimbsIn24h(): Climb[] {
    const currentMile = this.settings.currentLocationMile() ?? 0;
    const climbs = typeof this.routeData.climbs === "function" ? this.routeData.climbs() : [];
    if (!climbs || climbs.length === 0) return [];

    const upcoming: Climb[] = [];
    for (const climb of climbs) {
      // Rider already passed summit
      if (climb.endMile < currentMile) continue;

      let etaSeconds = 0;
      if (currentMile < climb.startMile) {
        etaSeconds = this.etaPhysics.calculateEtaSeconds(currentMile, climb.startMile);
      } else {
        // Actively on this climb
        etaSeconds = 0;
      }

      // Starts within 24 hours
      if (etaSeconds <= 24 * 3600) {
        upcoming.push(climb);
      }
    }

    return upcoming;
  }

  /**
   * Samples coordinates for every kilometer along a climb (including summit).
   */
  generateClimbSamplePoints(
    climb: Climb,
    trackPoints: [number, number, number, number, number][]
  ): {
    climbKm: number;
    routeKm: number;
    routeMile: number;
    lat: number;
    lon: number;
    elevationM: number;
  }[] {
    const points: {
      climbKm: number;
      routeKm: number;
      routeMile: number;
      lat: number;
      lon: number;
      elevationM: number;
    }[] = [];

    const climbSpanKm = Math.max(0.2, climb.endKm - climb.startKm);
    let offset = 0;
    while (offset < climbSpanKm) {
      const routeKm = Math.min(climb.endKm, climb.startKm + offset);
      const routeMile = routeKm / 1.609344;
      const coord = this.getCoordinateAtKm(routeKm, trackPoints);
      points.push({
        climbKm: Math.round(offset * 10) / 10,
        routeKm: Math.round(routeKm * 10) / 10,
        routeMile: Math.round(routeMile * 10) / 10,
        lat: coord.lat,
        lon: coord.lon,
        elevationM: coord.ele
      });
      offset += 1.0;
    }

    // Ensure terminal summit point (endKm) is always included
    const lastPoint = points[points.length - 1];
    if (!lastPoint || Math.abs(lastPoint.routeKm - climb.endKm) > 0.1) {
      const coord = this.getCoordinateAtKm(climb.endKm, trackPoints);
      points.push({
        climbKm: Math.round(climbSpanKm * 10) / 10,
        routeKm: Math.round(climb.endKm * 10) / 10,
        routeMile: Math.round((climb.endKm / 1.609344) * 10) / 10,
        lat: coord.lat,
        lon: coord.lon,
        elevationM: coord.ele
      });
    }

    return points;
  }

  /**
   * Fetches batch coordinates from Open-Meteo in chunks of up to 50 coordinates per HTTP GET request.
   */
  private async fetchPointsBatch(
    coords: { lat: number; lon: number }[]
  ): Promise<OpenMeteoPointResponse[]> {
    if (coords.length === 0) return [];

    const chunkSize = 50;
    const chunks: { lat: number; lon: number }[][] = [];
    for (let i = 0; i < coords.length; i += chunkSize) {
      chunks.push(coords.slice(i, i + chunkSize));
    }

    const chunkPromises = chunks.map(async (chunk) => {
      const lats = chunk.map((c) => c.lat.toFixed(4)).join(",");
      const lons = chunk.map((c) => c.lon.toFixed(4)).join(",");
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code&forecast_days=2&timeformat=unixtime&timezone=auto`;
      const res = await firstValueFrom(
        this.http.get<OpenMeteoPointResponse | OpenMeteoPointResponse[]>(url)
      );
      return Array.isArray(res) ? res : [res];
    });

    const results = await Promise.all(chunkPromises);
    return results.flat();
  }

  /**
   * Fetches weather forecast from Open-Meteo for the current location, next 24h 50km segments,
   * and every kilometer of all upcoming climbs in the next 24 hours.
   * @param force Bypass the 30-minute throttle (e.g. manual user refresh button)
   */
  async refreshWeather(force = false): Promise<boolean> {
    const routeId = typeof this.routeData.activeRouteId === "function" ? this.routeData.activeRouteId() : null;
    const pts = typeof this.routeData.trackPoints === "function" ? this.routeData.trackPoints() : [];
    if (!routeId || pts.length === 0) return false;

    // Strict throttle check
    const last = this.lastUpdated();
    const now = Date.now();
    if (!force && last && now - last < WEATHER_THROTTLE_MS) {
      return false; // Throttled
    }

    if (!this.networkStatus.isOnline()) {
      this.error.set("Offline - showing cached forecast");
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
    const climbSampleMap = new Map<
      string,
      Array<{
        climbKm: number;
        routeKm: number;
        routeMile: number;
        lat: number;
        lon: number;
        elevationM: number;
      }>
    >();
    const allClimbPoints: {
      climbKm: number;
      routeKm: number;
      routeMile: number;
      lat: number;
      lon: number;
      elevationM: number;
    }[] = [];

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
      const pointResponses = await this.fetchPointsBatch(allCoordsToFetch);

      // Parse 50km corridor segments
      const segments: WeatherSegment[] = [];
      for (let i = 0; i < sampleKms.length; i++) {
        const km = sampleKms[i];
        const coord = corridorCoordinates[i];
        const res = pointResponses[i] || pointResponses[0];
        const seg = this.parseSegmentForecast(km, coord, res, i === 0);
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
          points.push({
            climbKm: pt.climbKm,
            routeKm: pt.routeKm,
            routeMile: pt.routeMile,
            lat: pt.lat,
            lon: pt.lon,
            elevationM: pt.elevationM,
            hourly: {
              time: res.hourly.time as number[],
              weather_code: res.hourly.weather_code,
              temperature_2m: res.hourly.temperature_2m,
              precipitation: res.hourly.precipitation,
              wind_speed_10m: res.hourly.wind_speed_10m,
              wind_direction_10m: res.hourly.wind_direction_10m
            }
          });
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
      this.lastUpdated.set(now);

      // Save to localStorage for complete offline resilience
      if (typeof localStorage !== "undefined") {
        const cachedPayload: CachedRouteWeather = {
          routeId,
          lastFetchedTimestamp: now,
          riderKm: currentKm,
          segments,
          rawClimbs
        };
        localStorage.setItem(this.getCacheKey(routeId), JSON.stringify(cachedPayload));
      }

      this.isLoading.set(false);
      return true;
    } catch (err: any) {
      console.error("Failed to fetch Open-Meteo weather", err);
      this.error.set("Failed to update weather: " + (err.message || "Network error"));
      this.isLoading.set(false);
      return false;
    }
  }

  /**
   * Interpolates route track point at a specific distance along route
   */
  getCoordinateAtKm(
    km: number,
    trackPoints: [number, number, number, number, number][]
  ): { lat: number; lon: number; ele: number } {
    if (!trackPoints || trackPoints.length === 0) {
      return { lat: 0, lon: 0, ele: 0 };
    }
    if (km <= trackPoints[0][3]) {
      return { lat: trackPoints[0][0], lon: trackPoints[0][1], ele: trackPoints[0][2] };
    }
    const last = trackPoints[trackPoints.length - 1];
    if (km >= last[3]) {
      return { lat: last[0], lon: last[1], ele: last[2] };
    }

    // Binary search for track segment
    let low = 0;
    let high = trackPoints.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (trackPoints[mid][3] <= km && trackPoints[mid + 1] && trackPoints[mid + 1][3] >= km) {
        const p1 = trackPoints[mid];
        const p2 = trackPoints[mid + 1];
        const span = Math.max(0.0001, p2[3] - p1[3]);
        const t = (km - p1[3]) / span;
        return {
          lat: p1[0] + t * (p2[0] - p1[0]),
          lon: p1[1] + t * (p2[1] - p1[1]),
          ele: Math.round(p1[2] + t * (p2[2] - p1[2]))
        };
      } else if (trackPoints[mid][3] < km) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return { lat: last[0], lon: last[1], ele: last[2] };
  }

  /**
   * Parses Open-Meteo response into WeatherSegment with current conditions & 24h hourly array
   */
  private parseSegmentForecast(
    km: number,
    coord: { lat: number; lon: number; ele: number },
    res: OpenMeteoPointResponse,
    isCurrentLocation: boolean
  ): WeatherSegment {
    const hourly = res.hourly;
    const nowUnixSec = Math.floor(Date.now() / 1000);

    // Find closest current hour index (supports unix timestamps or ISO strings)
    let startIdx = 0;
    if (hourly && hourly.time && hourly.time.length > 0) {
      if (typeof hourly.time[0] === "number") {
        let bestDiff = Infinity;
        for (let i = 0; i < hourly.time.length; i++) {
          const diff = Math.abs((hourly.time[i] as number) - nowUnixSec);
          if (diff < bestDiff) {
            bestDiff = diff;
            startIdx = i;
          }
        }
      } else {
        const nowIsoHour = new Date().toISOString().slice(0, 13);
        const foundIdx = (hourly.time as string[]).findIndex((t) => t.startsWith(nowIsoHour));
        if (foundIdx >= 0) startIdx = foundIdx;
      }
    }

    const hourly24h: WeatherHourPoint[] = [];
    const count = Math.min(24, (hourly?.time?.length || 0) - startIdx);

    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      const rawTime = hourly.time[idx];
      const timeStr = typeof rawTime === "number"
        ? new Date(rawTime * 1000).toISOString()
        : rawTime;

      const tempC = hourly.temperature_2m[idx];
      const tempF = Math.round((tempC * 9) / 5 + 32);
      const precipitationMm = hourly.precipitation[idx];
      const precipitationInches = Math.round((precipitationMm / 25.4) * 100) / 100;
      const windSpeedKmh = hourly.wind_speed_10m[idx];
      const windSpeedMph = Math.round((windSpeedKmh / 1.60934) * 10) / 10;
      const windDirectionDeg = hourly.wind_direction_10m[idx];
      const windCardinal = degreesToCardinal(windDirectionDeg);
      const weatherCode = hourly.weather_code[idx];
      const { description, icon } = interpretWmoWeatherCode(weatherCode);

      hourly24h.push({
        time: timeStr,
        tempC,
        tempF,
        precipitationMm,
        precipitationInches,
        windSpeedKmh,
        windSpeedMph,
        windDirectionDeg,
        windCardinal,
        weatherCode,
        weatherDescription: description,
        weatherIcon: icon
      });
    }

    const currentPoint = hourly24h[0] || {
      time: new Date().toISOString(),
      tempC: 15,
      tempF: 59,
      precipitationMm: 0,
      precipitationInches: 0,
      windSpeedKmh: 10,
      windSpeedMph: 6.2,
      windDirectionDeg: 0,
      windCardinal: "N",
      weatherCode: 0,
      weatherDescription: "Clear",
      weatherIcon: "☀️"
    };

    const currentConditions: WeatherCurrentConditions = { ...currentPoint };
    const mile = Math.round((km / 1.60934) * 10) / 10;
    const label = isCurrentLocation
      ? `Current Location (KM ${km.toFixed(1)})`
      : `+${Math.round(km - (this.settings.currentLocationMile() || 0) * 1.60934)} km (KM ${km.toFixed(0)})`;

    return {
      km: Math.round(km * 10) / 10,
      mile,
      label,
      lat: coord.lat,
      lon: coord.lon,
      elevationM: coord.ele,
      current: currentConditions,
      hourly24h
    };
  }
}
