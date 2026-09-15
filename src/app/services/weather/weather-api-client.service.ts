import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import {
  WeatherHourPoint,
  WeatherCurrentConditions,
  WeatherSegment,
  RawClimbPointForecast,
  interpretWmoWeatherCode,
  degreesToCardinal
} from "../../models/weather.model";

export const WEATHER_SEGMENT_STEP_KM = 50;
export const OPEN_METEO_MAX_BATCH_COORDINATES = 50;

export interface OpenMeteoHourlyResponse {
  time: (number | string)[];
  temperature_2m: number[];
  precipitation: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  weather_code: number[];
}

export interface OpenMeteoPointResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  utc_offset_seconds: number;
  hourly: OpenMeteoHourlyResponse;
}

@Injectable({
  providedIn: "root"
})
export class WeatherApiClientService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches batch coordinates from Open-Meteo in chunks of up to 50 coordinates per HTTP GET request.
   */
  async fetchPointsBatch(
    coords: { lat: number; lon: number }[],
    chunkSize = OPEN_METEO_MAX_BATCH_COORDINATES
  ): Promise<OpenMeteoPointResponse[]> {
    if (coords.length === 0) return [];

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
   * Parses Open-Meteo response into WeatherSegment with current conditions & 24h hourly array.
   */
  parseSegmentForecast(
    km: number,
    coord: { lat: number; lon: number; ele: number },
    res: OpenMeteoPointResponse,
    isCurrentLocation: boolean,
    currentLocationMile = 0
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
      : `+${Math.round(km - (currentLocationMile || 0) * 1.60934)} km (KM ${km.toFixed(0)})`;

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

  /**
   * Parses raw point responses into RawClimbPointForecast structures.
   */
  parseRawClimbPointForecast(
    pt: { climbKm: number; routeKm: number; routeMile: number; lat: number; lon: number; elevationM: number },
    res: OpenMeteoPointResponse
  ): RawClimbPointForecast {
    return {
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
    };
  }
}
