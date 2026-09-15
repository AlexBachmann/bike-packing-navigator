import { TestBed } from '@angular/core/testing';
import {
  UserSettingsStorageService,
  MODERN_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  MAP_RENDERER_KEY
} from './user-settings-storage.service';
import { DEFAULT_USER_SETTINGS, UserSettings } from '../../models/settings.model';

describe('UserSettingsStorageService', () => {
  let service: UserSettingsStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [UserSettingsStorageService]
    });
    service = TestBed.inject(UserSettingsStorageService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('1. should be created and return default settings when localStorage is empty', () => {
    expect(service).toBeTruthy();
    const loaded = service.loadSettings();
    expect(loaded).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('2. should load settings from modern bpn_user_settings key', () => {
    const custom: Partial<UserSettings> = {
      riderWeight: 80.5,
      bikeWeight: 11.2,
      waterCapacityLiters: 3.0,
      weightUnit: 'lbs',
      distanceUnit: 'km',
      riderPowerWatts: 175
    };
    localStorage.setItem(MODERN_STORAGE_KEY, JSON.stringify(custom));

    const loaded = service.loadSettings();
    expect(loaded.riderWeight).toBe(80.5);
    expect(loaded.bikeWeight).toBe(11.2);
    expect(loaded.waterCapacityLiters).toBe(3.0);
    expect(loaded.weightUnit).toBe('lbs');
    expect(loaded.distanceUnit).toBe('km');
    expect(loaded.riderPowerWatts).toBe(175);
    // Unspecified fields fallback to defaults
    expect(loaded.avgSpeedMph).toBe(DEFAULT_USER_SETTINGS.avgSpeedMph);
  });

  it('3. should fallback to legacy tour_divide_user_settings key when modern key is missing', () => {
    const legacy: Partial<UserSettings> = {
      riderWeight: 72.0,
      paceMode: 'speed',
      avgSpeedMph: 12.0
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

    const loaded = service.loadSettings();
    expect(loaded.riderWeight).toBe(72.0);
    expect(loaded.paceMode).toBe('speed');
    expect(loaded.avgSpeedMph).toBe(12.0);
  });

  it('4. should migrate legacy navigation tab "jump" to "resupply"', () => {
    const legacy = {
      activeTab: 'jump'
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

    const loaded = service.loadSettings();
    expect(loaded.activeTab).toBe('resupply');
  });

  it('5. should handle corrupted JSON gracefully and return defaults with a console warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(MODERN_STORAGE_KEY, '{invalid-json-data: true,');

    const loaded = service.loadSettings();
    expect(loaded).toEqual(DEFAULT_USER_SETTINGS);
    expect(warnSpy).toHaveBeenCalledWith('Could not read settings from localStorage', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('6. should clamp invalid or out-of-range numerical values during schema migration', () => {
    const invalid: Partial<UserSettings> = {
      riderPowerWatts: 9999, // clamp to 800
      avgSpeedMph: 999,      // clamp to 50.0
      climbSurgePercent: -50, // clamp to 0
      climbSurgeDurationMinutes: 500, // clamp to 120
      hikeBikeThresholdKmh: 50, // clamp to 20
      hikeBikeBaseSpeedKmh: 0,  // clamp to 1.0
      mapZoomLevel: 30, // clamp to 18
      riderWeight: -10, // negative weight -> null
      bikeWeight: 0,    // 0 weight -> null
      waterCapacityLiters: -5 // negative water -> null
    };
    localStorage.setItem(MODERN_STORAGE_KEY, JSON.stringify(invalid));

    const loaded = service.loadSettings();
    expect(loaded.riderPowerWatts).toBe(800);
    expect(loaded.avgSpeedMph).toBe(50.0);
    expect(loaded.climbSurgePercent).toBe(0);
    expect(loaded.climbSurgeDurationMinutes).toBe(120);
    expect(loaded.hikeBikeThresholdKmh).toBe(20.0);
    expect(loaded.hikeBikeBaseSpeedKmh).toBe(1.0);
    expect(loaded.mapZoomLevel).toBe(18);
    expect(loaded.riderWeight).toBeNull();
    expect(loaded.bikeWeight).toBeNull();
    expect(loaded.waterCapacityLiters).toBeNull();
  });

  it('7. should persist settings to both modern and legacy localStorage keys simultaneously (dual-write)', () => {
    const toSave: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      riderWeight: 68.0,
      bikeWeight: 10.5,
      mapRenderer: 'raster'
    };

    service.saveSettings(toSave);

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const modernRaw = localStorage.getItem(MODERN_STORAGE_KEY);
    const rendererRaw = localStorage.getItem(MAP_RENDERER_KEY);

    expect(legacyRaw).toBeTruthy();
    expect(modernRaw).toBeTruthy();
    expect(rendererRaw).toBe('raster');

    const parsedLegacy = JSON.parse(legacyRaw!);
    const parsedModern = JSON.parse(modernRaw!);

    expect(parsedLegacy.riderWeight).toBe(68.0);
    expect(parsedModern.riderWeight).toBe(68.0);
    expect(parsedLegacy.bikeWeight).toBe(10.5);
    expect(parsedModern.bikeWeight).toBe(10.5);
    expect(parsedLegacy.mapRenderer).toBe('raster');
    expect(parsedModern.mapRenderer).toBe('raster');
  });

  it('8. should persist and hydrate bpn_map_renderer key independently', () => {
    expect(service.getMapRenderer()).toBe('auto');

    service.setMapRenderer('raster');
    expect(service.getMapRenderer()).toBe('raster');
    expect(localStorage.getItem(MAP_RENDERER_KEY)).toBe('raster');

    // Dedicated key overrides user settings json if set
    localStorage.setItem(MODERN_STORAGE_KEY, JSON.stringify({ mapRenderer: 'auto' }));
    const loaded = service.loadSettings();
    expect(loaded.mapRenderer).toBe('raster');
  });

  it('9. should clear all user settings keys and wipe localStorage on clearStorage()', () => {
    service.saveSettings({ ...DEFAULT_USER_SETTINGS, riderWeight: 85 });
    localStorage.setItem('arbitrary_app_key', 'some_value');

    expect(localStorage.getItem(MODERN_STORAGE_KEY)).toBeTruthy();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeTruthy();

    service.clearStorage();

    expect(localStorage.getItem(MODERN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MAP_RENDERER_KEY)).toBeNull();
    expect(localStorage.getItem('arbitrary_app_key')).toBeNull();
  });

  it('10. should safely handle environments where window or localStorage is undefined (SSR safety)', () => {
    const originalLocalStorage = window.localStorage;
    try {
      Object.defineProperty(window, 'localStorage', {
        value: null,
        configurable: true
      });

      expect(() => service.loadSettings()).not.toThrow();
      expect(service.loadSettings()).toEqual(DEFAULT_USER_SETTINGS);
      expect(() => service.saveSettings(DEFAULT_USER_SETTINGS)).not.toThrow();
      expect(() => service.clearStorage()).not.toThrow();
      expect(service.getMapRenderer()).toBe('auto');
      expect(() => service.setMapRenderer('raster')).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true
      });
    }
  });

  it('11. should merge partial settings cleanly with DEFAULT_USER_SETTINGS', () => {
    localStorage.setItem(MODERN_STORAGE_KEY, JSON.stringify({ mapStyle: 'topo' }));

    const loaded = service.loadSettings();
    expect(loaded.mapStyle).toBe('topo');
    expect(loaded.weightUnit).toBe('kg');
    expect(loaded.distanceUnit).toBe('miles');
    expect(loaded.avgSpeedMph).toBe(10.5);
    expect(loaded.riderPowerWatts).toBe(150);
    expect(loaded.paceMode).toBe('power');
  });

  it('12. should preserve routeLocations map during load and save operations', () => {
    const routeLocs: Record<string, number> = {
      'tour-divide-2025': 240.5,
      'colorado-trail': 88.0,
      'arizona-trail-300': 15.2
    };

    const settings: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      routeLocations: routeLocs
    };

    service.saveSettings(settings);

    const loaded = service.loadSettings();
    expect(loaded.routeLocations).toEqual(routeLocs);
    expect(loaded.routeLocations!['tour-divide-2025']).toBe(240.5);
    expect(loaded.routeLocations!['colorado-trail']).toBe(88.0);
    expect(loaded.routeLocations!['arizona-trail-300']).toBe(15.2);
  });
});
