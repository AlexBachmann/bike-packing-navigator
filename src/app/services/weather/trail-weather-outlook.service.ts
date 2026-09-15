import { Injectable, inject, signal, computed, Signal, WritableSignal } from '@angular/core';
import { RouteDataService } from '../route-data.service';
import { SettingsService } from '../settings.service';
import { EtaPhysicsService } from '../eta-physics.service';
import { ClimbWeatherService } from './climb-weather.service';
import {
  WeatherCurrentConditions,
  WeatherSegment,
  TwoHourWeatherOutlook,
  degreesToCardinal,
  isThunderstormWeatherCode,
  isRainWeatherCode,
  isMudSusceptibleSurface
} from '../../models/weather.model';
import {
  calculateBearing,
  calculateRelativeWind,
  getCoordinateAtKm
} from '../../utils/geo-math.utils';

@Injectable({
  providedIn: 'root'
})
export class TrailWeatherOutlookService {
  private readonly routeData = inject(RouteDataService);
  private readonly settings = inject(SettingsService);
  private readonly etaPhysics = inject(EtaPhysicsService);
  private readonly climbWeather = inject(ClimbWeatherService);

  readonly currentWeather: WritableSignal<WeatherCurrentConditions | null> = signal<WeatherCurrentConditions | null>(null);
  readonly segmentForecasts: WritableSignal<WeatherSegment[]> = signal<WeatherSegment[]>([]);

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
    // 1. Check if routeKm falls within any cached climb in ClimbWeatherService
    const climbWeather = this.climbWeather.getClimbWeatherAtKmAndTimestamp(routeKm, arrivalUnix);
    if (climbWeather) {
      return climbWeather;
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

  formatEtaMinutes(mins: number): string {
    if (mins <= 2) return 'Now';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  /**
   * Reactively evaluates the 2-hour forward outlook along the rider's upcoming path.
   */
  readonly twoHourOutlook: Signal<TwoHourWeatherOutlook> = computed<TwoHourWeatherOutlook>(() => {
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
    const rawClimbs = typeof this.climbWeather?.rawClimbData === 'function' ? this.climbWeather.rawClimbData() : [];

    if (!curr && segments.length === 0 && (!rawClimbs || rawClimbs.length === 0)) {
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
      const p1 = getCoordinateAtKm(routeKm, trackPts);
      const p2 = getCoordinateAtKm(routeKm + 0.3, trackPts);
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

    // 3. TIER 3: Heavy Headwinds
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

    // 4. TIER 4: Heavy Tailwinds
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
}
