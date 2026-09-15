import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TrailWeatherOutlookService } from './trail-weather-outlook.service';
import { RouteDataService } from '../route-data.service';
import { SettingsService } from '../settings.service';
import { EtaPhysicsService } from '../eta-physics.service';
import { ClimbWeatherService } from './climb-weather.service';
import { WeatherCurrentConditions, WeatherSegment } from '../../models/weather.model';

describe('TrailWeatherOutlookService', () => {
  let service: TrailWeatherOutlookService;
  let mockRouteData: any;
  let mockSettings: any;
  let mockEtaPhysics: any;
  let mockClimbWeather: any;

  beforeEach(() => {
    mockRouteData = {
      trackPoints: signal<[number, number, number, number, number][]>([
        [40.0, -105.0, 1600, 0, 0],
        [40.0, -105.1, 1600, 10, 6.2],
        [40.0, -105.2, 1600, 20, 12.4],
        [40.0, -105.3, 1600, 30, 18.6]
      ]),
      totalKmSignal: signal<number>(100),
      totalDistanceKm: 100
    };

    mockSettings = {
      currentLocationMile: signal<number>(0),
      paceMode: signal<'speed' | 'power'>('speed'),
      riderPowerWatts: signal<number>(150),
      avgSpeedMph: signal<number>(10)
    };

    mockEtaPhysics = {
      cacheVersion: signal<number>(0),
      calculateEtaSeconds: (_start: number, target: number) => Math.round(target * 360),
      getSurfaceAtKm: (_km: number) => ({
        roadClass: 'track',
        surface: 'gravel',
        tracktype: 'grade2'
      })
    };

    mockClimbWeather = {
      rawClimbData: signal([]),
      getClimbWeatherAtKmAndTimestamp: () => null
    };

    TestBed.configureTestingModule({
      providers: [
        TrailWeatherOutlookService,
        { provide: RouteDataService, useValue: mockRouteData },
        { provide: SettingsService, useValue: mockSettings },
        { provide: EtaPhysicsService, useValue: mockEtaPhysics },
        { provide: ClimbWeatherService, useValue: mockClimbWeather }
      ]
    });

    service = TestBed.inject(TrailWeatherOutlookService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return benign defaults when no weather data is loaded', () => {
    service.currentWeather.set(null);
    service.segmentForecasts.set([]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('normal');
    expect(outlook.title).toBe('Normal Conditions');
  });

  it('should evaluate 2-hour outlook with normal benign defaults when clear segment is loaded', () => {
    const clearSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 20,
        tempF: 68,
        precipitationMm: 0,
        precipitationInches: 0,
        windSpeedKmh: 5,
        windSpeedMph: 3.1,
        windDirectionDeg: 0,
        windCardinal: 'N',
        weatherCode: 0,
        weatherDescription: 'Clear sky',
        weatherIcon: '☀️'
      },
      hourly24h: []
    };

    service.currentWeather.set(clearSegment.current);
    service.segmentForecasts.set([clearSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('normal');
    expect(outlook.icon).toBe('☀️');
  });

  it('should return Priority 1: Thunderstorm when thunderstorm is forecast within 2 hours', () => {
    const stormSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 18,
        tempF: 64,
        precipitationMm: 5,
        precipitationInches: 0.2,
        windSpeedKmh: 30,
        windSpeedMph: 18.6,
        windDirectionDeg: 270,
        windCardinal: 'W',
        weatherCode: 95, // Thunderstorm
        weatherDescription: 'Thunderstorm',
        weatherIcon: '⛈️'
      },
      hourly24h: []
    };

    service.currentWeather.set(stormSegment.current);
    service.segmentForecasts.set([stormSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('thunderstorm');
    expect(outlook.icon).toBe('⛈️');
    expect(outlook.title).toContain('Thunderstorm Warning');
  });

  it('should return Priority 2: Mud Hazard when rain is forecast on mud-susceptible surface', () => {
    mockEtaPhysics.getSurfaceAtKm = () => ({
      roadClass: 'track',
      surface: 'dirt',
      tracktype: 'grade4'
    });

    const rainSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 12,
        tempF: 54,
        precipitationMm: 3.5, // Significant rain
        precipitationInches: 0.14,
        windSpeedKmh: 10,
        windSpeedMph: 6.2,
        windDirectionDeg: 0,
        windCardinal: 'N',
        weatherCode: 63, // Moderate rain
        weatherDescription: 'Rain',
        weatherIcon: '🌧️'
      },
      hourly24h: []
    };

    service.currentWeather.set(rainSegment.current);
    service.segmentForecasts.set([rainSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('mud');
    expect(outlook.icon).toBe('🚜');
  });

  it('should NOT trigger mud hazard when rain falls on asphalt road', () => {
    mockEtaPhysics.getSurfaceAtKm = () => ({
      roadClass: 'primary',
      surface: 'asphalt',
      tracktype: ''
    });

    const rainSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 12,
        tempF: 54,
        precipitationMm: 3.5,
        precipitationInches: 0.14,
        windSpeedKmh: 10,
        windSpeedMph: 6.2,
        windDirectionDeg: 0,
        windCardinal: 'N',
        weatherCode: 63,
        weatherDescription: 'Rain',
        weatherIcon: '🌧️'
      },
      hourly24h: []
    };

    service.currentWeather.set(rainSegment.current);
    service.segmentForecasts.set([rainSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).not.toBe('mud');
  });

  it('should return Priority 3: Headwind when facing direct headwind >= 20 km/h', () => {
    // Travel bearing from -105.0 to -105.1 along lat 40 is West (~270 deg)
    // Wind coming FROM West (270) is direct headwind!
    const headwindSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 18,
        tempF: 64,
        precipitationMm: 0,
        precipitationInches: 0,
        windSpeedKmh: 28,
        windSpeedMph: 17.4,
        windDirectionDeg: 270, // Opposing travel direction
        windCardinal: 'W',
        weatherCode: 0,
        weatherDescription: 'Clear',
        weatherIcon: '☀️'
      },
      hourly24h: []
    };

    service.currentWeather.set(headwindSegment.current);
    service.segmentForecasts.set([headwindSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('headwind');
    expect(outlook.icon).toBe('🌬️');
  });

  it('should return Priority 4: Tailwind when experiencing tailwind >= 20 km/h without hazards', () => {
    // Travel bearing is West (~270 deg). Wind coming FROM East (90 deg) is direct tailwind!
    const tailwindSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 18,
        tempF: 64,
        precipitationMm: 0,
        precipitationInches: 0,
        windSpeedKmh: 28,
        windSpeedMph: 17.4,
        windDirectionDeg: 90, // Pushing from behind
        windCardinal: 'E',
        weatherCode: 0,
        weatherDescription: 'Clear',
        weatherIcon: '☀️'
      },
      hourly24h: []
    };

    service.currentWeather.set(tailwindSegment.current);
    service.segmentForecasts.set([tailwindSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('tailwind');
    expect(outlook.icon).toBe('💨');
  });

  it('should respect hierarchy: Thunderstorm overrides Mud and Headwinds', () => {
    mockEtaPhysics.getSurfaceAtKm = () => ({
      roadClass: 'track',
      surface: 'dirt',
      tracktype: 'grade4'
    });

    const stormSegment: WeatherSegment = {
      km: 0,
      mile: 0,
      label: 'Start',
      lat: 40.0,
      lon: -105.0,
      elevationM: 1600,
      current: {
        time: new Date().toISOString(),
        tempC: 15,
        tempF: 59,
        precipitationMm: 10, // Rain on dirt
        precipitationInches: 0.4,
        windSpeedKmh: 40, // Heavy headwind
        windSpeedMph: 24.8,
        windDirectionDeg: 270,
        windCardinal: 'W',
        weatherCode: 95, // Thunderstorm!
        weatherDescription: 'Thunderstorm',
        weatherIcon: '⛈️'
      },
      hourly24h: []
    };

    service.currentWeather.set(stormSegment.current);
    service.segmentForecasts.set([stormSegment]);

    const outlook = service.twoHourOutlook();
    expect(outlook.alertKind).toBe('thunderstorm');
  });
});
