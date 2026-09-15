import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { ClimbWeatherService } from "./climb-weather.service";
import { RouteDataService } from "../route-data.service";
import { SettingsService } from "../settings.service";
import { EtaPhysicsService } from "../eta-physics.service";
import { Climb } from "../../models/elevation.model";
import { RawClimbForecastData } from "../../models/weather.model";

describe("ClimbWeatherService", () => {
  let service: ClimbWeatherService;
  let mockRouteData: Partial<RouteDataService>;
  let mockSettings: Partial<SettingsService>;
  let mockEtaPhysics: Partial<EtaPhysicsService>;

  beforeEach(() => {
    mockRouteData = {
      climbs: signal<Climb[]>([])
    };

    mockSettings = {
      currentLocationMile: signal<number>(10),
      paceMode: signal<"speed" | "power">("speed"),
      riderPowerWatts: signal<number>(150),
      avgSpeedMph: signal<number>(10)
    };

    mockEtaPhysics = {
      cacheVersion: signal<number>(0),
      calculateEtaSeconds: (_start: number, target: number) => Math.round((target - 10) * 360)
    };

    TestBed.configureTestingModule({
      providers: [
        ClimbWeatherService,
        { provide: RouteDataService, useValue: mockRouteData },
        { provide: SettingsService, useValue: mockSettings },
        { provide: EtaPhysicsService, useValue: mockEtaPhysics }
      ]
    });

    service = TestBed.inject(ClimbWeatherService);
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("should generate climb sample points at 1-km intervals including summit", () => {
    const mockClimb: Climb = {
      id: "climb-1",
      name: "Mountain Pass",
      state: "CO",
      startKm: 10,
      endKm: 13.5,
      startMile: 6.2,
      endMile: 8.4,
      lengthMiles: 2.2,
      lengthKm: 3.5,
      startElevationMeters: 1500,
      summitElevationMeters: 1900,
      startElevationFeet: 4921,
      summitElevationFeet: 6233,
      elevationGainMeters: 400,
      elevationGainFeet: 1000,
      avgGradePercent: 6.5,
      maxGradePercent: 12,
      isIconic: true,
      trailName: "Trail",
      parkName: "Park",
      landmark: "Summit",
      notes: "Steep"
    };

    const mockTrack: [number, number, number, number, number][] = [
      [40.0, -105.0, 1500, 10, 6.2],
      [40.1, -105.1, 1700, 12, 7.5],
      [40.2, -105.2, 1900, 13.5, 8.4]
    ];

    const pts = service.generateClimbSamplePoints(mockClimb, mockTrack);
    expect(pts.length).toBeGreaterThanOrEqual(4);
    expect(pts[0].climbKm).toBe(0);
    expect(pts[0].routeKm).toBe(10);
    const last = pts[pts.length - 1];
    expect(last.routeKm).toBe(13.5);
  });

  it("should filter upcoming climbs within 24-hour horizon based on rider ETA", () => {
    const climbs: Climb[] = [
      {
        id: "past-climb",
        name: "Past Climb",
        state: "CO",
        startKm: 0,
        endKm: 5,
        startMile: 0,
        endMile: 3,
        lengthMiles: 3,
        lengthKm: 5,
        startElevationMeters: 1000,
        summitElevationMeters: 1150,
        startElevationFeet: 3280,
        summitElevationFeet: 3772,
        elevationGainMeters: 150,
        elevationGainFeet: 500,
        avgGradePercent: 5,
        maxGradePercent: 8,
        isIconic: false
      },
      {
        id: "near-climb",
        name: "Near Climb",
        state: "CO",
        startKm: 25,
        endKm: 35,
        startMile: 15,
        endMile: 21,
        lengthMiles: 6,
        lengthKm: 10,
        startElevationMeters: 1200,
        summitElevationMeters: 1560,
        startElevationFeet: 3937,
        summitElevationFeet: 5118,
        elevationGainMeters: 360,
        elevationGainFeet: 1200,
        avgGradePercent: 6,
        maxGradePercent: 10,
        isIconic: true
      },
      {
        id: "far-climb",
        name: "Far Climb",
        state: "CO",
        startKm: 600,
        endKm: 620,
        startMile: 372,
        endMile: 385,
        lengthMiles: 13,
        lengthKm: 20,
        startElevationMeters: 1500,
        summitElevationMeters: 2260,
        startElevationFeet: 4921,
        summitElevationFeet: 7414,
        elevationGainMeters: 760,
        elevationGainFeet: 2500,
        avgGradePercent: 7,
        maxGradePercent: 14,
        isIconic: false
      }
    ];

    (mockRouteData.climbs as any).set(climbs);

    const upcoming = service.getUpcomingClimbsIn24h();
    expect(upcoming.length).toBe(1);
    expect(upcoming[0].id).toBe("near-climb");
  });

  it("should match ETA arrival time to hourly forecast curves and detect thunderstorm hazard", () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    const rawClimbs: RawClimbForecastData[] = [
      {
        climbId: "climb-thunder",
        climbName: "Thunder Peak",
        startKm: 20,
        endKm: 25,
        startMile: 12.4,
        endMile: 15.5,
        points: [
          {
            climbKm: 0,
            routeKm: 20,
            routeMile: 12.4,
            lat: 40.0,
            lon: -105.0,
            elevationM: 1800,
            hourly: {
              time: [nowUnix, nowUnix + 3600, nowUnix + 7200],
              weather_code: [0, 0, 0],
              temperature_2m: [20, 21, 22],
              precipitation: [0, 0, 0],
              wind_speed_10m: [10, 10, 10],
              wind_direction_10m: [180, 180, 180]
            }
          },
          {
            climbKm: 5,
            routeKm: 25,
            routeMile: 15.5,
            lat: 40.1,
            lon: -105.1,
            elevationM: 2400,
            hourly: {
              time: [nowUnix, nowUnix + 3600, nowUnix + 7200],
              weather_code: [0, 95, 0], // Thunderstorm at +1 hour (when rider arrives!)
              temperature_2m: [15, 12, 14],
              precipitation: [0, 8, 0],
              wind_speed_10m: [15, 30, 15],
              wind_direction_10m: [270, 270, 270]
            }
          }
        ]
      }
    ];

    service.rawClimbData.set(rawClimbs);

    const forecasts = service.climbWeatherForecasts();
    expect(forecasts["climb-thunder"]).toBeTruthy();
    const forecast = forecasts["climb-thunder"];
    expect(forecast.hasThunderstormHazard).toBe(true);
    expect(forecast.thunderstormHazard?.summitAffected).toBe(true);
    expect(service.getClimbForecast("climb-thunder")).toBe(forecast);
  });

  it("should return null for getClimbForecast when climbId does not exist", () => {
    expect(service.getClimbForecast("non-existent")).toBeNull();
  });
});
