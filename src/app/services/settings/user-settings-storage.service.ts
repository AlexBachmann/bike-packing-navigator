import { Injectable } from '@angular/core';
import {
  UserSettings,
  DEFAULT_USER_SETTINGS,
  MapRendererMode,
  migrateNavigationTab
} from '../../models/settings.model';

export const MODERN_STORAGE_KEY = 'bpn_user_settings';
export const LEGACY_STORAGE_KEY = 'tour_divide_user_settings';
export const MAP_RENDERER_KEY = 'bpn_map_renderer';

@Injectable({
  providedIn: 'root'
})
export class UserSettingsStorageService {
  /**
   * Loads settings from localStorage with fallback:
   * 1. Check modern key (bpn_user_settings)
   * 2. Fallback to legacy key (tour_divide_user_settings)
   * 3. Fallback to DEFAULT_USER_SETTINGS
   * 4. Check dedicated MAP_RENDERER_KEY
   */
  loadSettings(): UserSettings {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_USER_SETTINGS };
    }

    try {
      const modernRaw = localStorage.getItem(MODERN_STORAGE_KEY);
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);

      // Prefer modernRaw; if absent, fallback to legacyRaw.
      // If both exist and differ, legacyRaw was modified by external code/tests, so respect legacyRaw.
      let raw: string | null = modernRaw;
      if (!modernRaw) {
        raw = legacyRaw;
      } else if (legacyRaw && legacyRaw !== modernRaw) {
        raw = legacyRaw;
      }

      const result: UserSettings = { ...DEFAULT_USER_SETTINGS };

      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UserSettings>;

        if (parsed.riderWeight !== undefined) {
          result.riderWeight =
            parsed.riderWeight !== null && !isNaN(parsed.riderWeight) && parsed.riderWeight > 0
              ? parsed.riderWeight
              : null;
        }
        if (parsed.bikeWeight !== undefined) {
          result.bikeWeight =
            parsed.bikeWeight !== null && !isNaN(parsed.bikeWeight) && parsed.bikeWeight > 0
              ? parsed.bikeWeight
              : null;
        }
        if (parsed.waterCapacityLiters !== undefined) {
          result.waterCapacityLiters =
            parsed.waterCapacityLiters !== null && !isNaN(parsed.waterCapacityLiters) && parsed.waterCapacityLiters >= 0
              ? parsed.waterCapacityLiters
              : null;
        }
        if (parsed.weightUnit === 'kg' || parsed.weightUnit === 'lbs') {
          result.weightUnit = parsed.weightUnit;
        }
        if (parsed.distanceUnit === 'miles' || parsed.distanceUnit === 'km') {
          result.distanceUnit = parsed.distanceUnit;
        }
        if (typeof parsed.avgSpeedMph === 'number' && !isNaN(parsed.avgSpeedMph)) {
          result.avgSpeedMph = Math.max(1.0, Math.min(50.0, parsed.avgSpeedMph));
        }
        if (typeof parsed.riderPowerWatts === 'number' && !isNaN(parsed.riderPowerWatts)) {
          result.riderPowerWatts = Math.max(0, Math.min(800, Math.round(parsed.riderPowerWatts)));
        }
        if (parsed.paceMode === 'power' || parsed.paceMode === 'speed') {
          result.paceMode = parsed.paceMode;
        }
        if (typeof parsed.climbSurgePercent === 'number' && !isNaN(parsed.climbSurgePercent)) {
          result.climbSurgePercent = Math.max(0, Math.min(100, Math.round(parsed.climbSurgePercent)));
        }
        if (typeof parsed.climbSurgeDurationMinutes === 'number' && !isNaN(parsed.climbSurgeDurationMinutes)) {
          result.climbSurgeDurationMinutes = Math.max(1, Math.min(120, Math.round(parsed.climbSurgeDurationMinutes)));
        }
        if (typeof parsed.hikeBikeThresholdKmh === 'number' && !isNaN(parsed.hikeBikeThresholdKmh)) {
          result.hikeBikeThresholdKmh = Math.max(1.0, Math.min(20.0, parsed.hikeBikeThresholdKmh));
        }
        if (typeof parsed.hikeBikeBaseSpeedKmh === 'number' && !isNaN(parsed.hikeBikeBaseSpeedKmh)) {
          result.hikeBikeBaseSpeedKmh = Math.max(1.0, Math.min(10.0, parsed.hikeBikeBaseSpeedKmh));
        }
        if (parsed.mapStyle === 'dark' || parsed.mapStyle === 'topo') {
          result.mapStyle = parsed.mapStyle;
        }
        if (typeof parsed.mapZoomLevel === 'number' && !isNaN(parsed.mapZoomLevel)) {
          result.mapZoomLevel = Math.max(2, Math.min(18, Math.round(parsed.mapZoomLevel)));
        }
        if (parsed.activeTab) {
          result.activeTab = migrateNavigationTab(parsed.activeTab);
        }
        if (parsed.selectedRouteKey !== undefined) {
          result.selectedRouteKey = parsed.selectedRouteKey;
        }
        if (typeof parsed.currentLocationMile === 'number' && !isNaN(parsed.currentLocationMile)) {
          result.currentLocationMile = Math.max(0, parsed.currentLocationMile);
        }
        if (parsed.routeLocations && typeof parsed.routeLocations === 'object') {
          result.routeLocations = { ...parsed.routeLocations };
        }
        if (typeof parsed.keepScreenAwake === 'boolean') {
          result.keepScreenAwake = parsed.keepScreenAwake;
        }
        if (typeof parsed.anonymousTelemetryEnabled === 'boolean') {
          result.anonymousTelemetryEnabled = parsed.anonymousTelemetryEnabled;
        }
        if (parsed.mapRenderer === 'auto' || parsed.mapRenderer === 'raster') {
          result.mapRenderer = parsed.mapRenderer;
        }
      }

      // Check dedicated MAP_RENDERER_KEY override
      const storedRenderer = localStorage.getItem(MAP_RENDERER_KEY);
      if (storedRenderer === 'auto' || storedRenderer === 'raster') {
        result.mapRenderer = storedRenderer;
      }

      return result;
    } catch (e) {
      console.warn('Could not read settings from localStorage', e);
      return { ...DEFAULT_USER_SETTINGS };
    }
  }

  /**
   * Persists settings using dual-write:
   * Writes to modern key (bpn_user_settings), legacy key (tour_divide_user_settings),
   * and dedicated map renderer key (bpn_map_renderer).
   */
  saveSettings(settings: UserSettings): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const json = JSON.stringify(settings);
      localStorage.setItem(LEGACY_STORAGE_KEY, json);
      localStorage.setItem(MODERN_STORAGE_KEY, json);
      if (settings.mapRenderer) {
        localStorage.setItem(MAP_RENDERER_KEY, settings.mapRenderer);
      }
    } catch (e) {
      console.warn('Could not write settings to localStorage', e);
    }
  }

  /**
   * Clears all settings from storage.
   */
  clearStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      localStorage.clear();
      localStorage.removeItem(MAP_RENDERER_KEY);
      localStorage.removeItem(MODERN_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      console.warn('Could not clear settings in localStorage', e);
    }
  }

  getMapRenderer(): MapRendererMode {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'auto';
    }
    const val = localStorage.getItem(MAP_RENDERER_KEY);
    return val === 'raster' ? 'raster' : 'auto';
  }

  setMapRenderer(mode: MapRendererMode): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      localStorage.setItem(MAP_RENDERER_KEY, mode);
    } catch (e) {
      console.warn('Could not set map renderer in localStorage', e);
    }
  }
}
