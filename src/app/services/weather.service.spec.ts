import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { WeatherService, WEATHER_THROTTLE_MS } from './weather.service';
import { NetworkStatusService } from './network-status.service';
import { RouteDataService } from './route-data.service';
import { SettingsService } from './settings.service';
import { EtaPhysicsService } from './eta-physics.service';
import {
  degreesToCardinal,
  interpretWmoWeatherCode,
  calculateBearing,
  calculateRelativeWind,
  isMudSusceptibleSurface,
  isThunderstormWeatherCode,
  isRainWeatherCode
} from '../models/weather.model';

describe('WeatherService', () => {
  let service: WeatherService;
  let etaPhysics: EtaPhysicsService;
  let httpTesting: HttpTestingController;
  let mockNetwork: { isOnline: ReturnType<typeof signal<boolean>> };
  let mockRoute: {
    activeRouteId: ReturnType<typeof signal<string | null>>;
    trackPoints: ReturnType<typeof signal<[number, number, number, number, number][]>>;
    totalDistanceKm: number;
    totalKmSignal?: ReturnType<typeof signal<number>>;
  };
  let mockSettings: {
    currentLocationMile: ReturnType<typeof signal<number>>;
    avgSpeedMph: ReturnType<typeof signal<number>>;
    paceMode: ReturnType<typeof signal<'speed' | 'power'>>;
    riderPowerWatts: ReturnType<typeof signal<number>>;
  };

  const sampleTrack: [number, number, number, number, number][] = [
    [51.17, -115.57, 1400, 0.0, 0.0],
    [51.00, -115.40, 1500, 50.0, 31.0],
    [50.80, -115.20, 1600, 100.0, 62.0],
    [50.60, -115.00, 1700, 150.0, 93.0],
    [50.40, -114.80, 1800, 200.0, 124.0]
  ];

  const sampleHourlyResponse = {
    latitude: 51.17,
    longitude: -115.57,
    elevation: 1400,
    utc_offset_seconds: 0,
    hourly: {
      time: Array.from({ length: 48 }, (_, i) => `2026-09-13T${String(i % 24).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 48 }, () => 15.0),
      precipitation: Array.from({ length: 48 }, () => 0.5),
      wind_speed_10m: Array.from({ length: 48 }, () => 20.0),
      wind_direction_10m: Array.from({ length: 48 }, () => 180),
      weather_code: Array.from({ length: 48 }, () => 61) // slight rain
    }
  };

  beforeEach(() => {
    localStorage.clear();
    mockNetwork = { isOnline: signal(true) };
    mockRoute = {
      activeRouteId: signal<string | null>('tour-divide-2025'),
      trackPoints: signal(sampleTrack),
      totalDistanceKm: 200,
      totalKmSignal: signal(200)
    };
    mockSettings = {
      currentLocationMile: signal(0),
      avgSpeedMph: signal(10),
      paceMode: signal<'speed' | 'power'>('speed'),
      riderPowerWatts: signal(150)
    };

    TestBed.configureTestingModule({
      providers: [
        WeatherService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NetworkStatusService, useValue: mockNetwork },
        { provide: RouteDataService, useValue: mockRoute },
        { provide: SettingsService, useValue: mockSettings }
      ]
    });

    httpTesting = TestBed.inject(HttpTestingController);
    service = TestBed.inject(WeatherService);
    etaPhysics = TestBed.inject(EtaPhysicsService);
  });

  afterEach(() => {
    httpTesting.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should correctly interpolate coordinates along trackPoints', () => {
    const coord0 = service.getCoordinateAtKm(0, sampleTrack);
    expect(coord0.lat).toBeCloseTo(51.17, 2);
    expect(coord0.lon).toBeCloseTo(-115.57, 2);

    const coord50 = service.getCoordinateAtKm(50, sampleTrack);
    expect(coord50.lat).toBeCloseTo(51.00, 2);
    expect(coord50.ele).toBe(1500);

    const coord25 = service.getCoordinateAtKm(25, sampleTrack);
    expect(coord25.lat).toBeCloseTo(51.085, 2);
    expect(coord25.ele).toBe(1450);
  });

  it('should convert wind degrees to correct cardinal direction', () => {
    expect(degreesToCardinal(0)).toBe('N');
    expect(degreesToCardinal(45)).toBe('NE');
    expect(degreesToCardinal(90)).toBe('E');
    expect(degreesToCardinal(135)).toBe('SE');
    expect(degreesToCardinal(180)).toBe('S');
    expect(degreesToCardinal(225)).toBe('SW');
    expect(degreesToCardinal(270)).toBe('W');
    expect(degreesToCardinal(315)).toBe('NW');
    expect(degreesToCardinal(360)).toBe('N');
  });

  it('should interpret WMO weather codes', () => {
    expect(interpretWmoWeatherCode(0).description).toBe('Clear sky');
    expect(interpretWmoWeatherCode(61).description).toBe('Slight rain');
    expect(interpretWmoWeatherCode(95).description).toBe('Thunderstorm');
    expect(interpretWmoWeatherCode(999).description).toBe('Variable');
  });

  it('should fetch weather from Open-Meteo in a single batch request and cache to localStorage', async () => {
    const promise = service.refreshWeather(true);

    const req = httpTesting.expectOne((r) => r.url.includes('api.open-meteo.com/v1/forecast'));
    expect(req.request.method).toBe('GET');
    expect(req.request.url).toContain('hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code');

    // Return array of responses for the batch query
    req.flush([sampleHourlyResponse, sampleHourlyResponse, sampleHourlyResponse]);

    const success = await promise;
    expect(success).toBe(true);

    expect(service.segmentForecasts().length).toBeGreaterThan(0);
    expect(service.currentWeather()).toBeTruthy();
    expect(service.currentWeather()?.tempC).toBe(15.0);
    expect(service.currentWeather()?.tempF).toBe(59);
    expect(service.currentWeather()?.windCardinal).toBe('S');
    expect(service.currentWeather()?.weatherDescription).toBe('Slight rain');

    // Verify localStorage cache was written
    const cachedRaw = localStorage.getItem('bpn_weather_cache_tour-divide-2025');
    expect(cachedRaw).toBeTruthy();
    const cached = JSON.parse(cachedRaw!);
    expect(cached.routeId).toBe('tour-divide-2025');
    expect(cached.segments.length).toBe(service.segmentForecasts().length);
  });

  it('should enforce 30-minute fair-use throttle and reject repeated calls unless forced', async () => {
    // Prime the cache
    const promise = service.refreshWeather(true);
    const req = httpTesting.expectOne((r) => r.url.includes('api.open-meteo.com'));
    req.flush([sampleHourlyResponse]);
    await promise;

    expect(service.minutesUntilNextAllowedRefresh()).toBeGreaterThanOrEqual(29);

    // Call without force within 30 minutes -> must be blocked
    const throttledPromise = service.refreshWeather(false);
    httpTesting.expectNone((r) => r.url.includes('api.open-meteo.com'));
    const throttledResult = await throttledPromise;
    expect(throttledResult).toBe(false);

    // Call WITH force=true -> must proceed
    const forcedPromise = service.refreshWeather(true);
    const forcedReq = httpTesting.expectOne((r) => r.url.includes('api.open-meteo.com'));
    forcedReq.flush([sampleHourlyResponse]);
    const forcedResult = await forcedPromise;
    expect(forcedResult).toBe(true);
  });

  it('should serve cached data when offline and avoid network requests', async () => {
    // Prime localStorage cache
    const mockCache = {
      routeId: 'tour-divide-2025',
      lastFetchedTimestamp: Date.now() - 10000,
      riderKm: 0,
      segments: [
        {
          km: 0,
          mile: 0,
          label: 'Current Location (KM 0)',
          lat: 51.17,
          lon: -115.57,
          elevationM: 1400,
          current: {
            time: '2026-09-13T12:00',
            tempC: 18,
            tempF: 64,
            precipitationMm: 0,
            precipitationInches: 0,
            windSpeedKmh: 12,
            windSpeedMph: 7.5,
            windDirectionDeg: 90,
            windCardinal: 'E',
            weatherCode: 0,
            weatherDescription: 'Clear sky',
            weatherIcon: '☀️'
          },
          hourly24h: []
        }
      ]
    };
    localStorage.setItem('bpn_weather_cache_tour-divide-2025', JSON.stringify(mockCache));

    // Simulate offline
    mockNetwork.isOnline.set(false);

    const loaded = service.loadCachedWeather('tour-divide-2025');
    expect(loaded).toBe(true);
    expect(service.currentWeather()?.tempC).toBe(18);
    expect(service.currentWeather()?.weatherDescription).toBe('Clear sky');

    // Attempt refresh while offline
    const refreshResult = await service.refreshWeather(true);
    expect(refreshResult).toBe(false);
    expect(service.error()).toContain('Offline');
    httpTesting.expectNone((r) => r.url.includes('api.open-meteo.com'));
  });

  it('should support backward compatibility with legacy td_weather_cache_ prefix', () => {
    const mockCache = {
      routeId: 'tour-divide-2025',
      lastFetchedTimestamp: Date.now() - 5000,
      segments: [
        {
          km: 10,
          mile: 6.2,
          label: 'Legacy Point',
          lat: 51.2,
          lon: -115.6,
          elevationM: 1500,
          current: {
            time: '2026-09-13T12:00',
            tempC: 22,
            tempF: 72,
            precipitationMm: 0,
            precipitationInches: 0,
            windSpeedKmh: 10,
            windSpeedMph: 6.2,
            windDirectionDeg: 180,
            windCardinal: 'S',
            weatherCode: 0,
            weatherDescription: 'Clear',
            weatherIcon: '☀️'
          },
          hourly24h: []
        }
      ]
    };
    localStorage.setItem('td_weather_cache_tour-divide-2025', JSON.stringify(mockCache));
    const loaded = service.loadCachedWeather('tour-divide-2025');
    expect(loaded).toBe(true);
    expect(service.currentWeather()?.tempC).toBe(22);
  });

  it('should generate sample points for every kilometer along a climb', () => {
    const mockClimb = {
      id: 'climb-test',
      name: 'Test Mountain Pass',
      state: 'BC',
      startMile: 10.0,
      endMile: 13.5,
      startKm: 16.1,
      endKm: 21.7,
      lengthMiles: 3.5,
      lengthKm: 5.6,
      startElevationMeters: 1400,
      summitElevationMeters: 1800,
      startElevationFeet: 4593,
      summitElevationFeet: 5905,
      elevationGainMeters: 400,
      elevationGainFeet: 1312,
      avgGradePercent: 7.1,
      maxGradePercent: 12.0,
      isIconic: true
    };

    const pts = service.generateClimbSamplePoints(mockClimb, sampleTrack);
    // Span is 5.6 km -> 0, 1, 2, 3, 4, 5, 5.6 (summit) = 7 points
    expect(pts.length).toBeGreaterThanOrEqual(6);
    expect(pts[0].climbKm).toBe(0);
    expect(pts[0].routeKm).toBeCloseTo(16.1, 1);
    const summitPt = pts[pts.length - 1];
    expect(summitPt.routeKm).toBeCloseTo(21.7, 1);
  });

  it('should filter upcoming climbs within the 24-hour horizon', () => {
    const mockClimbs = [
      {
        id: 'climb-past',
        name: 'Passed Climb',
        state: 'AB',
        startMile: 5,
        endMile: 10,
        startKm: 8,
        endKm: 16,
        lengthMiles: 5,
        lengthKm: 8,
        startElevationMeters: 1000,
        summitElevationMeters: 1400,
        startElevationFeet: 3280,
        summitElevationFeet: 4593,
        elevationGainMeters: 400,
        elevationGainFeet: 1312,
        avgGradePercent: 5,
        maxGradePercent: 8,
        isIconic: false
      },
      {
        id: 'climb-soon',
        name: 'Upcoming Climb Soon',
        state: 'AB',
        startMile: 30,
        endMile: 40,
        startKm: 48,
        endKm: 64,
        lengthMiles: 10,
        lengthKm: 16,
        startElevationMeters: 1400,
        summitElevationMeters: 2000,
        startElevationFeet: 4593,
        summitElevationFeet: 6561,
        elevationGainMeters: 600,
        elevationGainFeet: 1968,
        avgGradePercent: 6,
        maxGradePercent: 10,
        isIconic: true
      },
      {
        id: 'climb-far',
        name: 'Far Away Climb (in 40 hours)',
        state: 'MT',
        startMile: 500,
        endMile: 515,
        startKm: 800,
        endKm: 825,
        lengthMiles: 15,
        lengthKm: 25,
        startElevationMeters: 1500,
        summitElevationMeters: 2200,
        startElevationFeet: 4921,
        summitElevationFeet: 7217,
        elevationGainMeters: 700,
        elevationGainFeet: 2296,
        avgGradePercent: 4.5,
        maxGradePercent: 7,
        isIconic: false
      }
    ];

    (mockRoute as any).climbs = signal(mockClimbs);
    mockSettings.currentLocationMile.set(20); // Past climb 1, before climb 2

    const upcoming = service.getUpcomingClimbsIn24h();
    expect(upcoming.length).toBe(1);
    expect(upcoming[0].id).toBe('climb-soon');
  });

  it('should prevent false alarms: storm occurring NOW does not alarm if clear at arrival', () => {
    // Rider is at mile 0. Climb starts at mile 30 (ETA ~3 hours at 10 mph)
    mockSettings.currentLocationMile.set(0);
    mockSettings.avgSpeedMph.set(10);

    const nowSec = Math.floor(Date.now() / 1000);
    const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

    // Weather codes: Storm NOW at hours 0 and 1 (WMO 95), but CLEAR (WMO 0) at hour 3 (ETA of arrival)
    const weatherCodesScenarioA = Array.from({ length: 48 }, (_, i) => (i < 2 ? 95 : 0));

    service.rawClimbData.set([
      {
        climbId: 'climb-storm-now',
        climbName: 'Elk Pass',
        startMile: 30,
        endMile: 35,
        startKm: 48,
        endKm: 56,
        points: [
          {
            climbKm: 0,
            routeKm: 48,
            routeMile: 30,
            lat: 50.8,
            lon: -115.2,
            elevationM: 1600,
            hourly: {
              time: hourlyTimes,
              weather_code: weatherCodesScenarioA,
              temperature_2m: Array(48).fill(16),
              precipitation: Array(48).fill(0),
              wind_speed_10m: Array(48).fill(12),
              wind_direction_10m: Array(48).fill(220)
            }
          },
          {
            climbKm: 8,
            routeKm: 56,
            routeMile: 35,
            lat: 50.7,
            lon: -115.1,
            elevationM: 2100,
            hourly: {
              time: hourlyTimes,
              weather_code: weatherCodesScenarioA,
              temperature_2m: Array(48).fill(12),
              precipitation: Array(48).fill(0),
              wind_speed_10m: Array(48).fill(18),
              wind_direction_10m: Array(48).fill(240)
            }
          }
        ]
      }
    ]);

    const forecasts = service.climbWeatherForecasts();
    const climbForecast = forecasts['climb-storm-now'];
    expect(climbForecast).toBeTruthy();
    // At arrival in ~3 hours, weather is clear -> NO FALSE ALARM!
    expect(climbForecast.hasThunderstormHazard).toBe(false);
  });

  it('should trigger alarm: clear weather NOW triggers alert if thunderstorm is forecast at arrival', () => {
    mockSettings.currentLocationMile.set(0);
    mockSettings.avgSpeedMph.set(10);

    const nowSec = Math.floor(Date.now() / 1000);
    const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

    // Weather codes: CLEAR (WMO 0) NOW at hours 0 and 1, but THUNDERSTORM (WMO 95) at hour 3 (ETA of arrival)
    const weatherCodesScenarioB = Array.from({ length: 48 }, (_, i) => (i >= 3 && i <= 5 ? 95 : 0));

    service.rawClimbData.set([
      {
        climbId: 'climb-storm-later',
        climbName: 'Koko Claims Summit',
        startMile: 30,
        endMile: 35,
        startKm: 48,
        endKm: 56,
        points: [
          {
            climbKm: 0,
            routeKm: 48,
            routeMile: 30,
            lat: 50.8,
            lon: -115.2,
            elevationM: 1600,
            hourly: {
              time: hourlyTimes,
              weather_code: weatherCodesScenarioB,
              temperature_2m: Array(48).fill(18),
              precipitation: Array(48).fill(0.2),
              wind_speed_10m: Array(48).fill(15),
              wind_direction_10m: Array(48).fill(180)
            }
          },
          {
            climbKm: 8,
            routeKm: 56,
            routeMile: 35,
            lat: 50.7,
            lon: -115.1,
            elevationM: 2200,
            hourly: {
              time: hourlyTimes,
              weather_code: weatherCodesScenarioB,
              temperature_2m: Array(48).fill(11),
              precipitation: Array(48).fill(8.0),
              wind_speed_10m: Array(48).fill(35),
              wind_direction_10m: Array(48).fill(270)
            }
          }
        ]
      }
    ]);

    const forecasts = service.climbWeatherForecasts();
    const climbForecast = forecasts['climb-storm-later'];
    expect(climbForecast).toBeTruthy();
    // At arrival in ~3 hours, thunderstorm is forecast -> ALERT TRIGGERED!
    expect(climbForecast.hasThunderstormHazard).toBe(true);
    expect(climbForecast.thunderstormHazard?.weatherCode).toBe(95);
    expect(climbForecast.thunderstormHazard?.summitAffected).toBe(true);
    expect(climbForecast.thunderstormHazard?.message).toContain('Thunderstorm forecast');
  });

  describe('2-Hour Weather Hazard & Priority Hierarchy', () => {
    const baseCurrentWeather = {
      time: '2026-09-13T12:00',
      tempC: 15,
      tempF: 59,
      precipitationMm: 0,
      precipitationInches: 0,
      windSpeedKmh: 10,
      windSpeedMph: 6,
      windDirectionDeg: 180,
      windCardinal: 'S',
      weatherCode: 0,
      weatherDescription: 'Clear sky',
      weatherIcon: '☀️'
    };

    beforeEach(() => {
      service.currentWeather.set(baseCurrentWeather);
      service.segmentForecasts.set([]);
      service.rawClimbData.set([]);
    });

    it('should correctly calculate initial bearing between coordinates', () => {
      // Due north
      const bNorth = calculateBearing(50.0, -115.0, 51.0, -115.0);
      expect(bNorth).toBeCloseTo(0, 1);

      // Due east
      const bEast = calculateBearing(50.0, -115.0, 50.0, -114.0);
      expect(bEast).toBeCloseTo(90, 0);

      // Due south
      const bSouth = calculateBearing(50.0, -115.0, 49.0, -115.0);
      expect(bSouth).toBeCloseTo(180, 1);

      // Due west
      const bWest = calculateBearing(50.0, -115.0, 50.0, -116.0);
      expect(bWest).toBeCloseTo(270, 0);
    });

    it('should calculate relative headwind and tailwind vectors', () => {
      // Rider traveling South (180 deg). Wind from South (180 deg) -> direct headwind
      const headwindCase = calculateRelativeWind(180, 180, 25);
      expect(headwindCase.headwindKmh).toBe(25);
      expect(headwindCase.tailwindKmh).toBe(-25);

      // Rider traveling South (180 deg). Wind from North (0 deg) -> direct tailwind
      const tailwindCase = calculateRelativeWind(180, 0, 30);
      expect(tailwindCase.headwindKmh).toBe(-30);
      expect(tailwindCase.tailwindKmh).toBe(30);

      // Rider traveling South (180 deg). Wind from East (90 deg) -> crosswind (0 headwind/tailwind)
      const crosswindCase = calculateRelativeWind(180, 90, 20);
      expect(crosswindCase.headwindKmh).toBeCloseTo(0, 0);
      expect(crosswindCase.tailwindKmh).toBeCloseTo(0, 0);
    });

    it('should detect mud-susceptible surfaces and ignore resilient surfaces', () => {
      // Dirt / clay / soft soil are susceptible
      expect(isMudSusceptibleSurface('dirt', 'grade3')).toBe(true);
      expect(isMudSusceptibleSurface('clay', 'grade2')).toBe(true);
      expect(isMudSusceptibleSurface('earth', 'grade2')).toBe(true);
      expect(isMudSusceptibleSurface('unpaved', 'grade4')).toBe(true);
      expect(isMudSusceptibleSurface('gravel', 'grade5')).toBe(true);

      // Asphalt / paved / compacted gravel are NOT susceptible
      expect(isMudSusceptibleSurface('asphalt', 'grade1')).toBe(false);
      expect(isMudSusceptibleSurface('paved', 'grade1')).toBe(false);
      expect(isMudSusceptibleSurface('concrete', 'grade1')).toBe(false);
      expect(isMudSusceptibleSurface('compacted', 'grade2')).toBe(false);
      expect(isMudSusceptibleSurface('fine_gravel', 'grade1')).toBe(false);
    });

    it('should identify thunderstorm and rain weather codes', () => {
      expect(isThunderstormWeatherCode(95)).toBe(true);
      expect(isThunderstormWeatherCode(96)).toBe(true);
      expect(isThunderstormWeatherCode(99)).toBe(true);
      expect(isThunderstormWeatherCode(0)).toBe(false);
      expect(isThunderstormWeatherCode(61)).toBe(false);

      expect(isRainWeatherCode(51)).toBe(true);
      expect(isRainWeatherCode(61)).toBe(true);
      expect(isRainWeatherCode(65)).toBe(true);
      expect(isRainWeatherCode(80)).toBe(true);
      expect(isRainWeatherCode(0)).toBe(false);
    });

    it('should evaluate 2-hour outlook with normal benign defaults when no data is loaded', () => {
      service.currentWeather.set(null);
      service.segmentForecasts.set([]);
      const outlook = service.twoHourOutlook();
      expect(outlook.alertKind).toBe('normal');
      expect(outlook.icon).toBe('☀️');
      expect(outlook.badgeText).toBe('Normal');
    });

    it('should return Priority 1: Thunderstorm when thunderstorm is forecast within 2 hours', () => {
      // Setup rider at mile 0 (KM 0)
      mockSettings.currentLocationMile.set(0);
      mockSettings.avgSpeedMph.set(10); // ~16 km/h -> in 2 hours will reach ~32 km

      // Setup surface as dirt
      etaPhysics.surfaceIntervals.set([[0, 100, 'track', 'dirt', 'grade4']]);

      // Set corridor segment at KM 0 with clear weather, and KM 50 with thunderstorm
      const nowSec = Math.floor(Date.now() / 1000);
      const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

      // Also set climb at KM 10 (within 2-hour window) with thunderstorm at arrival
      service.rawClimbData.set([
        {
          climbId: 'climb-storm',
          climbName: 'Stormy Pass',
          startMile: 6.2,
          endMile: 12.4,
          startKm: 10,
          endKm: 20,
          points: [
            {
              climbKm: 0,
              routeKm: 10,
              routeMile: 6.2,
              lat: 51.10,
              lon: -115.50,
              elevationM: 1450,
              hourly: {
                time: hourlyTimes,
                weather_code: Array(48).fill(95), // Thunderstorm!
                temperature_2m: Array(48).fill(15),
                precipitation: Array(48).fill(5),
                wind_speed_10m: Array(48).fill(25),
                wind_direction_10m: Array(48).fill(180)
              }
            }
          ]
        }
      ]);

      const outlook = service.twoHourOutlook();
      expect(outlook.alertKind).toBe('thunderstorm');
      expect(outlook.icon).toBe('⛈️');
      expect(outlook.badgeText).toBe('Thunderstorm');
      expect(outlook.title).toContain('Thunderstorm Warning');
      expect(outlook.advice).toContain('Avoid exposed peaks');
    });

    it('should return Priority 2: Mud Hazard when rain is forecast on mud-susceptible surface', () => {
      mockSettings.currentLocationMile.set(0);
      mockSettings.avgSpeedMph.set(10);

      // Dirt surface
      etaPhysics.surfaceIntervals.set([[0, 100, 'track', 'dirt', 'grade4']]);

      // No thunderstorms (weather code 61 = moderate rain), 3mm rain
      const nowSec = Math.floor(Date.now() / 1000);
      const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

      service.rawClimbData.set([
        {
          climbId: 'climb-rain',
          climbName: 'Muddy Pass',
          startMile: 5,
          endMile: 10,
          startKm: 8,
          endKm: 16,
          points: [
            {
              climbKm: 0,
              routeKm: 8,
              routeMile: 5,
              lat: 51.10,
              lon: -115.50,
              elevationM: 1450,
              hourly: {
                time: hourlyTimes,
                weather_code: Array(48).fill(61), // Rain, not thunderstorm
                temperature_2m: Array(48).fill(14),
                precipitation: Array(48).fill(2.5),
                wind_speed_10m: Array(48).fill(10),
                wind_direction_10m: Array(48).fill(90)
              }
            }
          ]
        }
      ]);

      const outlook = service.twoHourOutlook();
      expect(outlook.alertKind).toBe('mud');
      expect(outlook.icon).toBe('🚜');
      expect(outlook.badgeText).toBe('Heavy Mud Risk');
      expect(outlook.title).toContain('Heavy Mud Hazard');
      expect(outlook.advice).toContain('Anticipate heavy tire packing');
    });

    it('should NOT trigger mud hazard when rain falls on asphalt road', () => {
      mockSettings.currentLocationMile.set(0);
      mockSettings.avgSpeedMph.set(10);

      // Asphalt paved surface
      etaPhysics.surfaceIntervals.set([[0, 100, 'primary', 'asphalt', 'grade1']]);

      const nowSec = Math.floor(Date.now() / 1000);
      const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

      service.rawClimbData.set([
        {
          climbId: 'climb-paved-rain',
          climbName: 'Paved Pass',
          startMile: 5,
          endMile: 10,
          startKm: 8,
          endKm: 16,
          points: [
            {
              climbKm: 0,
              routeKm: 8,
              routeMile: 5,
              lat: 51.10,
              lon: -115.50,
              elevationM: 1450,
              hourly: {
                time: hourlyTimes,
                weather_code: Array(48).fill(61), // Rain
                temperature_2m: Array(48).fill(14),
                precipitation: Array(48).fill(2.5),
                wind_speed_10m: Array(48).fill(10),
                wind_direction_10m: Array(48).fill(90)
              }
            }
          ]
        }
      ]);

      const outlook = service.twoHourOutlook();
      // On asphalt, rain is NOT a mud hazard
      expect(outlook.alertKind).not.toBe('mud');
    });

    it('should return Priority 3: Headwind when facing direct headwind >= 20 km/h without storm or mud', () => {
      mockSettings.currentLocationMile.set(0);
      mockSettings.avgSpeedMph.set(10);

      // Firm asphalt surface (no mud)
      etaPhysics.surfaceIntervals.set([[0, 100, 'primary', 'asphalt', 'grade1']]);

      // Rider heads south (~140-160 deg from sampleTrack). Set wind blowing directly from South at 28 km/h
      const nowSec = Math.floor(Date.now() / 1000);
      const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

      service.rawClimbData.set([
        {
          climbId: 'climb-wind',
          climbName: 'Windy Ridge',
          startMile: 5,
          endMile: 10,
          startKm: 8,
          endKm: 16,
          points: [
            {
              climbKm: 0,
              routeKm: 8,
              routeMile: 5,
              lat: 51.10,
              lon: -115.50,
              elevationM: 1450,
              hourly: {
                time: hourlyTimes,
                weather_code: Array(48).fill(1), // Mainly clear, no rain
                temperature_2m: Array(48).fill(16),
                precipitation: Array(48).fill(0),
                wind_speed_10m: Array(48).fill(28),
                wind_direction_10m: Array(48).fill(145) // opposing bearing ~145 deg
              }
            }
          ]
        }
      ]);

      const outlook = service.twoHourOutlook();
      expect(outlook.alertKind).toBe('headwind');
      expect(outlook.icon).toBe('🌬️');
      expect(outlook.badgeText).toBe('Heavy Headwind');
      expect(outlook.title).toContain('Heavy Headwind Ahead');
      expect(outlook.advice).toContain('Tuck into an aerodynamic position');
    });

    it('should return Priority 4: Tailwind when experiencing tailwind >= 20 km/h without hazards', () => {
      mockSettings.currentLocationMile.set(0);
      mockSettings.avgSpeedMph.set(10);

      // Firm asphalt surface
      etaPhysics.surfaceIntervals.set([[0, 100, 'primary', 'asphalt', 'grade1']]);

      // Rider heads South (~145 deg). Set wind blowing FROM North (~325 deg) at 25 km/h -> tailwind
      const nowSec = Math.floor(Date.now() / 1000);
      const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

      service.rawClimbData.set([
        {
          climbId: 'climb-tailwind',
          climbName: 'Tailwind Valley',
          startMile: 5,
          endMile: 10,
          startKm: 8,
          endKm: 16,
          points: [
            {
              climbKm: 0,
              routeKm: 8,
              routeMile: 5,
              lat: 51.10,
              lon: -115.50,
              elevationM: 1450,
              hourly: {
                time: hourlyTimes,
                weather_code: Array(48).fill(0), // Clear
                temperature_2m: Array(48).fill(18),
                precipitation: Array(48).fill(0),
                wind_speed_10m: Array(48).fill(25),
                wind_direction_10m: Array(48).fill(325) // opposite 145 deg -> tailwind push
              }
            }
          ]
        }
      ]);

      const outlook = service.twoHourOutlook();
      expect(outlook.alertKind).toBe('tailwind');
      expect(outlook.icon).toBe('💨');
      expect(outlook.badgeText).toBe('Tailwind Boost');
      expect(outlook.title).toContain('Strong Tailwind Assist');
      expect(outlook.advice).toContain('Capitalize on this section');
    });

    it('should respect hierarchy: Thunderstorm overrides Mud and Headwinds', () => {
      mockSettings.currentLocationMile.set(0);
      mockSettings.avgSpeedMph.set(10);

      // Dirt surface AND heavy rain AND thunderstorm AND headwind
      etaPhysics.surfaceIntervals.set([[0, 100, 'track', 'dirt', 'grade4']]);

      const nowSec = Math.floor(Date.now() / 1000);
      const hourlyTimes = Array.from({ length: 48 }, (_, i) => nowSec + i * 3600);

      service.rawClimbData.set([
        {
          climbId: 'climb-storm-and-mud',
          climbName: 'Chaos Pass',
          startMile: 5,
          endMile: 10,
          startKm: 8,
          endKm: 16,
          points: [
            {
              climbKm: 0,
              routeKm: 8,
              routeMile: 5,
              lat: 51.10,
              lon: -115.50,
              elevationM: 1450,
              hourly: {
                time: hourlyTimes,
                weather_code: Array(48).fill(95), // Thunderstorm!
                temperature_2m: Array(48).fill(10),
                precipitation: Array(48).fill(10), // Rain on dirt!
                wind_speed_10m: Array(48).fill(40), // Punishing wind!
                wind_direction_10m: Array(48).fill(145)
              }
            }
          ]
        }
      ]);

      const outlook = service.twoHourOutlook();
      // Thunderstorm is top priority (Tier 1)
      expect(outlook.alertKind).toBe('thunderstorm');
      expect(outlook.icon).toBe('⛈️');
    });
  });
});

