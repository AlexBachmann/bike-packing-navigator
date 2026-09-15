import { Injectable, signal, computed, Signal, WritableSignal } from "@angular/core";
import { CachedRouteWeather } from "../../models/weather.model";

export const WEATHER_THROTTLE_MS = 30 * 60 * 1000;            // 30 minutes
export const WEATHER_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;   // 6 hours
export const WEATHER_CACHE_PREFIX = "bpn_weather_cache_";
export const WEATHER_LEGACY_CACHE_PREFIX = "td_weather_cache_";

@Injectable({
  providedIn: "root"
})
export class WeatherCacheService {
  readonly lastUpdated: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Time remaining until 30-minute fair use throttle expires (0 if refresh is allowed).
   */
  readonly minutesUntilNextAllowedRefresh: Signal<number> = computed<number>(() => {
    const last = this.lastUpdated();
    if (!last) return 0;
    const elapsed = Date.now() - last;
    if (elapsed >= WEATHER_THROTTLE_MS) return 0;
    return Math.ceil((WEATHER_THROTTLE_MS - elapsed) / 60000);
  });

  /**
   * True if cache is older than 6 hours or missing.
   */
  readonly isStale: Signal<boolean> = computed<boolean>(() => {
    const last = this.lastUpdated();
    if (!last) return true;
    return Date.now() - last > WEATHER_STALE_THRESHOLD_MS;
  });

  getCacheKey(routeId: string): string {
    return `${WEATHER_CACHE_PREFIX}${routeId}`;
  }

  isThrottled(force = false): boolean {
    if (force) return false;
    const last = this.lastUpdated();
    if (!last) return false;
    return Date.now() - last < WEATHER_THROTTLE_MS;
  }

  loadCachedWeather(routeId: string): CachedRouteWeather | null {
    if (typeof localStorage === "undefined") return null;
    try {
      let raw = localStorage.getItem(this.getCacheKey(routeId));
      if (!raw) {
        raw = localStorage.getItem(`${WEATHER_LEGACY_CACHE_PREFIX}${routeId}`);
      }
      if (!raw) return null;

      const cached: CachedRouteWeather = JSON.parse(raw);
      if (cached && cached.routeId === routeId) {
        this.lastUpdated.set(cached.lastFetchedTimestamp);
        return cached;
      }
    } catch (e) {
      console.warn("Failed to parse cached weather from localStorage", e);
    }
    return null;
  }

  saveCachedWeather(payload: CachedRouteWeather): boolean {
    if (typeof localStorage === "undefined") return false;
    try {
      localStorage.setItem(this.getCacheKey(payload.routeId), JSON.stringify(payload));
      this.lastUpdated.set(payload.lastFetchedTimestamp);
      return true;
    } catch (e) {
      console.warn("Failed to persist weather to localStorage", e);
      return false;
    }
  }

  clearCache(routeId: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(this.getCacheKey(routeId));
      localStorage.removeItem(`${WEATHER_LEGACY_CACHE_PREFIX}${routeId}`);
    } catch (e) {
      console.warn("Failed to clear weather cache", e);
    }
  }

  clearAll(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(WEATHER_CACHE_PREFIX) || k.startsWith(WEATHER_LEGACY_CACHE_PREFIX))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      this.lastUpdated.set(null);
    } catch (e) {
      console.warn("Failed to clear all weather caches", e);
    }
  }
}
