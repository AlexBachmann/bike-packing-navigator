export interface WeatherHourPoint {
  time: string;                     // ISO string e.g. "2026-09-13T14:00"
  tempC: number;                    // Celsius
  tempF: number;                    // Fahrenheit
  precipitationMm: number;          // mm of rain
  precipitationInches: number;      // inches of rain
  windSpeedKmh: number;             // km/h
  windSpeedMph: number;             // mph
  windDirectionDeg: number;         // 0-360 degrees
  windCardinal: string;             // 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'
  weatherCode: number;              // WMO code
  weatherDescription: string;       // e.g. "Clear sky", "Light rain", "Thunderstorm"
  weatherIcon: string;              // Emoji e.g. '☀️', '🌧️', '⚡'
}

export interface WeatherCurrentConditions {
  time: string;
  tempC: number;
  tempF: number;
  precipitationMm: number;
  precipitationInches: number;
  windSpeedKmh: number;
  windSpeedMph: number;
  windDirectionDeg: number;
  windCardinal: string;
  weatherCode: number;
  weatherDescription: string;
  weatherIcon: string;
}

export interface WeatherSegment {
  km: number;
  mile: number;
  label: string;                    // e.g. "Current Location (KM 160)", "+50 km (KM 210)"
  lat: number;
  lon: number;
  elevationM: number;
  current: WeatherCurrentConditions;
  hourly24h: WeatherHourPoint[];
}

export interface RawClimbPointForecast {
  climbKm: number;          // km along climb (0, 1, 2, ..., length)
  routeKm: number;          // route km
  routeMile: number;        // route mile
  lat: number;
  lon: number;
  elevationM: number;
  hourly: {
    time: number[];         // unix timestamps (seconds)
    weather_code: number[];
    temperature_2m: number[];
    precipitation: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
  };
}

export interface RawClimbForecastData {
  climbId: string;
  climbName: string;
  startMile: number;
  endMile: number;
  startKm: number;
  endKm: number;
  points: RawClimbPointForecast[];
}

export interface ClimbKmWeatherPoint {
  climbKm: number;
  routeKm: number;
  routeMile: number;
  lat: number;
  lon: number;
  elevationM: number;
  elevationFt: number;
  estimatedArrivalSeconds: number;
  estimatedArrivalTimestamp: number;
  estimatedArrivalFormatted: string;
  weatherAtArrival: {
    tempC: number;
    tempF: number;
    precipitationMm: number;
    precipitationInches: number;
    windSpeedKmh: number;
    windSpeedMph: number;
    windDirectionDeg: number;
    windCardinal: string;
    weatherCode: number;
    weatherDescription: string;
    weatherIcon: string;
    isThunderstorm: boolean;
  };
}

export interface ClimbThunderstormHazard {
  hasHazard: boolean;
  earliestKm: number;
  latestKm: number;
  estimatedTimeFormatted: string;
  estimatedArrivalTimestamp: number;
  weatherCode: number;
  severity: 'moderate' | 'severe';
  message: string;
  summitAffected: boolean;
}

export interface ClimbWeatherForecast {
  climbId: string;
  climbName: string;
  hasThunderstormHazard: boolean;
  thunderstormHazard?: ClimbThunderstormHazard;
  summitWeather: ClimbKmWeatherPoint;
  baseWeather: ClimbKmWeatherPoint;
  kmPoints: ClimbKmWeatherPoint[];
  estimatedStartTimestamp: number;
  estimatedSummitTimestamp: number;
  estimatedStartTimeFormatted: string;
  estimatedSummitTimeFormatted: string;
}

export interface CachedRouteWeather {
  routeId: string;
  lastFetchedTimestamp: number;     // Date.now()
  riderKm: number;
  segments: WeatherSegment[];
  rawClimbs?: RawClimbForecastData[];
}

/**
 * Maps WMO weather code to human-readable description and icon.
 * Reference: Open-Meteo WMO Weather interpretation codes
 */
export function interpretWmoWeatherCode(code: number): { description: string; icon: string } {
  switch (code) {
    case 0:
      return { description: 'Clear sky', icon: '☀️' };
    case 1:
      return { description: 'Mainly clear', icon: '🌤️' };
    case 2:
      return { description: 'Partly cloudy', icon: '⛅' };
    case 3:
      return { description: 'Overcast', icon: '☁️' };
    case 45:
    case 48:
      return { description: 'Fog / Depositing rime', icon: '🌫️' };
    case 51:
    case 53:
    case 55:
      return { description: 'Drizzle', icon: '🌦️' };
    case 56:
    case 57:
      return { description: 'Freezing drizzle', icon: '🌨️' };
    case 61:
      return { description: 'Slight rain', icon: '🌦️' };
    case 63:
      return { description: 'Moderate rain', icon: '🌧️' };
    case 65:
      return { description: 'Heavy rain', icon: '🌧️' };
    case 66:
    case 67:
      return { description: 'Freezing rain', icon: '🧊' };
    case 71:
      return { description: 'Slight snowfall', icon: '🌨️' };
    case 73:
      return { description: 'Moderate snowfall', icon: '❄️' };
    case 75:
      return { description: 'Heavy snowfall', icon: '❄️' };
    case 77:
      return { description: 'Snow grains', icon: '❄️' };
    case 80:
    case 81:
    case 82:
      return { description: 'Rain showers', icon: '🌦️' };
    case 85:
    case 86:
      return { description: 'Snow showers', icon: '🌨️' };
    case 95:
      return { description: 'Thunderstorm', icon: '⛈️' };
    case 96:
    case 99:
      return { description: 'Thunderstorm with hail', icon: '⛈️' };
    default:
      return { description: 'Variable', icon: '🌤️' };
  }
}

/**
 * Converts wind degrees (0-360) into standard 8-point compass cardinal directions
 */
export function degreesToCardinal(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normalized / 45) % 8;
  return cardinals[index];
}

/**
 * Checks if a WMO weather code indicates a thunderstorm (WMO 95, 96, 99).
 */
export function isThunderstormWeatherCode(code: number): boolean {
  return code >= 95 && code <= 99;
}

/**
 * Checks if WMO code indicates rain, showers, or drizzle.
 */
export function isRainWeatherCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
}

export type TwoHourAlertKind = 'thunderstorm' | 'mud' | 'headwind' | 'tailwind' | 'normal';

export interface TwoHourWeatherOutlook {
  alertKind: TwoHourAlertKind;
  icon: string;
  badgeText: string;
  title: string;
  summary: string;
  detailMessage: string;
  advice: string;
  locationKmRange?: { startKm: number; endKm: number };
  etaSeconds?: number;
  etaFormatted?: string;
  metrics?: {
    precipitationMm?: number;
    surface?: string;
    tracktype?: string;
    windSpeedKmh?: number;
    headwindKmh?: number;
    tailwindKmh?: number;
    windCardinal?: string;
  };
}

/**
 * Calculates initial forward azimuth / bearing in degrees (0-360) from point 1 to point 2
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/**
 * Calculates effective headwind and tailwind components along the rider travel bearing.
 * Meteorological wind direction is the direction FROM which the wind blows.
 */
export function calculateRelativeWind(
  travelBearing: number,
  windDirectionDeg: number,
  windSpeedKmh: number
): { headwindKmh: number; tailwindKmh: number; relativeAngleDeg: number } {
  // Angle difference between wind direction and rider travel direction
  const diffDeg = ((windDirectionDeg - travelBearing + 540) % 360) - 180;
  const diffRad = diffDeg * (Math.PI / 180);

  // Headwind is positive when wind blows directly opposite travel bearing
  const headwindKmh = Math.round(windSpeedKmh * Math.cos(diffRad) * 10) / 10;
  const tailwindKmh = Math.round(-headwindKmh * 10) / 10;

  return {
    headwindKmh,
    tailwindKmh,
    relativeAngleDeg: Math.abs(diffDeg)
  };
}

/**
 * Checks if a terrain surface and tracktype are susceptible to creating heavy mud when rained on.
 */
export function isMudSusceptibleSurface(surface: string, tracktype: string): boolean {
  const s = (surface || '').toLowerCase().trim();
  const tt = (tracktype || '').toLowerCase().trim();

  // Paved, concrete, asphalt, and hard compacted gravel drain well and don't turn into deep mud
  if (['asphalt', 'paved', 'concrete', 'compacted', 'fine_gravel'].includes(s) && (tt === 'grade1' || tt === 'grade2')) {
    return false;
  }

  // Soft unpaved / rough natural soil (OSM Grade 4 and Grade 5)
  if (tt === 'grade4' || tt === 'grade5') {
    return true;
  }

  // Soil/earth/dirt/clay/mud surfaces
  if (['dirt', 'earth', 'ground', 'clay', 'mud'].includes(s)) {
    return true;
  }

  // Unpaved tracks with grade 3+ or unspecified high-soil content
  if (s === 'unpaved' && (tt === 'grade3' || tt === 'grade4' || tt === 'grade5')) {
    return true;
  }

  return false;
}

