import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import {
  WeatherApiClientService,
  OpenMeteoPointResponse
} from "./weather-api-client.service";

describe("WeatherApiClientService", () => {
  let service: WeatherApiClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WeatherApiClientService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(WeatherApiClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("should return empty array when coords is empty", async () => {
    const res = await service.fetchPointsBatch([]);
    expect(res).toEqual([]);
  });

  it("should chunk 65 coordinates into 2 batch requests (50, 15)", async () => {
    const coords: { lat: number; lon: number }[] = [];
    for (let i = 0; i < 65; i++) {
      coords.push({ lat: 40 + i * 0.01, lon: -105 - i * 0.01 });
    }

    const fetchPromise = service.fetchPointsBatch(coords);

    const requests = httpMock.match((req) =>
      req.url.startsWith("https://api.open-meteo.com/v1/forecast")
    );
    expect(requests.length).toBe(2);

    const mockResponse: OpenMeteoPointResponse = {
      latitude: 40.0,
      longitude: -105.0,
      elevation: 1600,
      utc_offset_seconds: -25200,
      hourly: {
        time: [1700000000],
        temperature_2m: [20],
        precipitation: [0],
        wind_speed_10m: [10],
        wind_direction_10m: [180],
        weather_code: [0]
      }
    };

    requests[0].flush([mockResponse]);
    requests[1].flush(mockResponse);

    const results = await fetchPromise;
    expect(results.length).toBe(2);
  });

  it("should parse 24h hourly points and current conditions with metric/imperial conversion", () => {
    const mockPointRes: OpenMeteoPointResponse = {
      latitude: 40.0,
      longitude: -105.0,
      elevation: 1600,
      utc_offset_seconds: 0,
      hourly: {
        time: [Math.floor(Date.now() / 1000)],
        temperature_2m: [25], // 25C = 77F
        precipitation: [25.4], // 25.4mm = 1.0 in
        wind_speed_10m: [16.0934], // ~10 mph
        wind_direction_10m: [180],
        weather_code: [0]
      }
    };

    const coord = { lat: 40.0, lon: -105.0, ele: 1600 };
    const seg = service.parseSegmentForecast(50, coord, mockPointRes, true, 0);

    expect(seg.km).toBe(50);
    expect(seg.mile).toBeCloseTo(31.1, 1);
    expect(seg.current.tempC).toBe(25);
    expect(seg.current.tempF).toBe(77);
    expect(seg.current.precipitationInches).toBe(1);
    expect(seg.current.windSpeedMph).toBe(10);
    expect(seg.current.windCardinal).toBe("S");
    expect(seg.label).toContain("Current Location");
  });

  it("should parse raw climb point forecast correctly", () => {
    const pt = {
      climbKm: 0,
      routeKm: 10,
      routeMile: 6.2,
      lat: 40.0,
      lon: -105.0,
      elevationM: 1500
    };

    const mockPointRes: OpenMeteoPointResponse = {
      latitude: 40.0,
      longitude: -105.0,
      elevation: 1500,
      utc_offset_seconds: 0,
      hourly: {
        time: [1700000000],
        weather_code: [95],
        temperature_2m: [15],
        precipitation: [5],
        wind_speed_10m: [20],
        wind_direction_10m: [90]
      }
    };

    const parsed = service.parseRawClimbPointForecast(pt, mockPointRes);
    expect(parsed.climbKm).toBe(0);
    expect(parsed.routeKm).toBe(10);
    expect(parsed.hourly.weather_code).toEqual([95]);
    expect(parsed.hourly.temperature_2m).toEqual([15]);
  });
});
