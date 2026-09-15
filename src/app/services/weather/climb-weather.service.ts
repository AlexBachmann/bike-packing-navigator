import { Injectable, inject, signal, computed, Signal, WritableSignal } from "@angular/core";
import { RouteDataService } from "../route-data.service";
import { SettingsService } from "../settings.service";
import { EtaPhysicsService } from "../eta-physics.service";
import { Climb } from "../../models/elevation.model";
import {
  RawClimbForecastData,
  ClimbWeatherForecast,
  ClimbKmWeatherPoint,
  ClimbThunderstormHazard,
  interpretWmoWeatherCode,
  degreesToCardinal,
  isThunderstormWeatherCode
} from "../../models/weather.model";
import { getCoordinateAtKm } from "../../utils/geo-math.utils";

@Injectable({
  providedIn: "root"
})
export class ClimbWeatherService {
  private readonly routeData = inject(RouteDataService);
  private readonly settings = inject(SettingsService);
  private readonly etaPhysics = inject(EtaPhysicsService);

  readonly rawClimbData: WritableSignal<RawClimbForecastData[]> = signal<RawClimbForecastData[]>([]);

  /**
   * Reactively evaluates weather for each upcoming climb matched to the rider estimated arrival time.
   */
  readonly climbWeatherForecasts: Signal<Record<string, ClimbWeatherForecast>> = computed<Record<string, ClimbWeatherForecast>>(() => {
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
        let etaSeconds = 0;
        if (currentMile < pt.routeMile) {
          etaSeconds = this.etaPhysics.calculateEtaSeconds(currentMile, pt.routeMile);
        } else {
          etaSeconds = 0;
        }

        const arrivalTimestamp = now + etaSeconds * 1000;
        const arrivalUnixSec = Math.floor(arrivalTimestamp / 1000);

        // Find nearest hour index in 48h forecast
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

      // Thunderstorm hazard detection for points rider has yet to reach
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

  getClimbForecast(climbId: string): ClimbWeatherForecast | null {
    return this.climbWeatherForecasts()[climbId] || null;
  }

  getUpcomingClimbsIn24h(): Climb[] {
    const currentMile = this.settings.currentLocationMile() ?? 0;
    const climbs = typeof this.routeData.climbs === "function" ? this.routeData.climbs() : [];
    if (!climbs || climbs.length === 0) return [];

    const upcoming: Climb[] = [];
    for (const climb of climbs) {
      if (climb.endMile < currentMile) continue;
      let etaSeconds = 0;
      if (currentMile < climb.startMile) {
        etaSeconds = this.etaPhysics.calculateEtaSeconds(currentMile, climb.startMile);
      } else {
        etaSeconds = 0;
      }
      if (etaSeconds <= 24 * 3600) {
        upcoming.push(climb);
      }
    }
    return upcoming;
  }

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
      const coord = getCoordinateAtKm(routeKm, trackPoints);
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

    const lastPoint = points[points.length - 1];
    if (!lastPoint || Math.abs(lastPoint.routeKm - climb.endKm) > 0.1) {
      const coord = getCoordinateAtKm(climb.endKm, trackPoints);
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

  getClimbWeatherAtKmAndTimestamp(
    routeKm: number,
    arrivalUnix: number
  ): { weatherCode: number; tempC: number; precipitationMm: number; windSpeedKmh: number; windDirectionDeg: number } | null {
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
    return null;
  }
}
