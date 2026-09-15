import { TestBed } from "@angular/core/testing";
import {
  WeatherCacheService,
  WEATHER_THROTTLE_MS,
  WEATHER_CACHE_PREFIX,
  WEATHER_LEGACY_CACHE_PREFIX
} from "./weather-cache.service";
import { CachedRouteWeather } from "../../models/weather.model";

describe("WeatherCacheService", () => {
  let service: WeatherCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WeatherCacheService]
    });
    service = TestBed.inject(WeatherCacheService);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("should save and load cached weather payload using bpn_ prefix", () => {
    const payload: CachedRouteWeather = {
      routeId: "colorado-trail",
      lastFetchedTimestamp: Date.now(),
      riderKm: 50,
      segments: [],
      rawClimbs: []
    };

    const saved = service.saveCachedWeather(payload);
    expect(saved).toBe(true);
    expect(localStorage.getItem(`${WEATHER_CACHE_PREFIX}colorado-trail`)).toBeTruthy();

    const loaded = service.loadCachedWeather("colorado-trail");
    expect(loaded).toBeTruthy();
    expect(loaded?.routeId).toBe("colorado-trail");
    expect(service.lastUpdated()).toBe(payload.lastFetchedTimestamp);
  });

  it("should fall back to legacy td_weather_cache_ prefix when bpn_ key is absent", () => {
    const payload: CachedRouteWeather = {
      routeId: "tour-divide-2025",
      lastFetchedTimestamp: Date.now(),
      riderKm: 100,
      segments: [],
      rawClimbs: []
    };
    localStorage.setItem(`${WEATHER_LEGACY_CACHE_PREFIX}tour-divide-2025`, JSON.stringify(payload));

    const loaded = service.loadCachedWeather("tour-divide-2025");
    expect(loaded).toBeTruthy();
    expect(loaded?.routeId).toBe("tour-divide-2025");
  });

  it("should enforce 30-minute fair-use throttle and compute minutes remaining", () => {
    const now = Date.now();
    service.lastUpdated.set(now - 10 * 60 * 1000); // 10 minutes ago

    expect(service.isThrottled(false)).toBe(true);
    expect(service.isThrottled(true)).toBe(false); // force bypasses throttle
    expect(service.minutesUntilNextAllowedRefresh()).toBe(20);

    service.lastUpdated.set(now - 31 * 60 * 1000); // 31 minutes ago
    expect(service.isThrottled(false)).toBe(false);
    expect(service.minutesUntilNextAllowedRefresh()).toBe(0);
  });

  it("should compute isStale correctly based on 6-hour threshold", () => {
    expect(service.isStale()).toBe(true);

    const now = Date.now();
    service.lastUpdated.set(now - 2 * 60 * 60 * 1000); // 2h ago
    expect(service.isStale()).toBe(false);

    service.lastUpdated.set(now - 7 * 60 * 60 * 1000); // 7h ago
    expect(service.isStale()).toBe(true);
  });

  it("should safely handle malformed JSON in localStorage", () => {
    localStorage.setItem(`${WEATHER_CACHE_PREFIX}corrupt-route`, "{bad-json");
    const loaded = service.loadCachedWeather("corrupt-route");
    expect(loaded).toBeNull();
  });

  it("should clear cache for specified route and clear all weather caches", () => {
    service.saveCachedWeather({
      routeId: "route-a",
      lastFetchedTimestamp: Date.now(),
      riderKm: 0,
      segments: [],
      rawClimbs: []
    });
    service.saveCachedWeather({
      routeId: "route-b",
      lastFetchedTimestamp: Date.now(),
      riderKm: 0,
      segments: [],
      rawClimbs: []
    });

    service.clearCache("route-a");
    expect(service.loadCachedWeather("route-a")).toBeNull();
    expect(service.loadCachedWeather("route-b")).toBeTruthy();

    service.clearAll();
    expect(service.loadCachedWeather("route-b")).toBeNull();
    expect(service.lastUpdated()).toBeNull();
  });
});
