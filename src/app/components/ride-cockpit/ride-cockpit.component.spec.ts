import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import {
  RideCockpitComponent,
  formatSpeed,
  DEFAULT_3D_PITCH,
  MIN_3D_PITCH,
  MAX_3D_PITCH,
  LOWER_THIRD_BOTTOM_PADDING
} from './ride-cockpit.component';
import { RouteDataService } from '../../services/route-data.service';
import { RouteManifestService } from '../../services/route-manifest.service';
import { SettingsService } from '../../services/settings.service';
import { PmtilesStorageService } from '../../services/pmtiles-storage.service';
import { TurnGuidanceService } from '../../services/turn-guidance.service';
import { GpsSimulatorService } from '../../services/gps-simulator.service';
import { AudioAlertService } from '../../services/audio-alert.service';
import { Climb } from '../../models/elevation.model';
import { Place } from '../../models/waypoint.model';

// ============================================================================
// Comprehensive Mock of MapLibre GL for JSDOM
// ============================================================================

vi.mock('maplibre-gl', () => {
  class MockPopup {
    private html = '';
    options: any;

    constructor(options?: any) {
      this.options = options;
    }

    setHTML(html: string) {
      this.html = html;
      return this;
    }

    getHTML() {
      return this.html;
    }
  }

  class MockMarker {
    private lngLat: [number, number] = [0, 0];
    private rotation = 0;
    private rotationAlignment = 'map';
    private pitchAlignment = 'map';
    private popup: any = null;
    element: HTMLElement;
    removeCount = 0;

    constructor(options?: { element?: HTMLElement; anchor?: string; rotationAlignment?: string; pitchAlignment?: string }) {
      this.element = options?.element || document.createElement('div');
      if (options?.rotationAlignment) this.rotationAlignment = options.rotationAlignment;
      if (options?.pitchAlignment) this.pitchAlignment = options.pitchAlignment;
    }

    setPopup(popup: any) {
      this.popup = popup;
      return this;
    }

    getPopup() {
      return this.popup;
    }

    getPitchAlignment() {
      return this.pitchAlignment;
    }

    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }

    getLngLat() {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }

    setRotation(degrees: number) {
      this.rotation = ((degrees % 360) + 360) % 360;
      return this;
    }

    getRotation() {
      return this.rotation;
    }

    setRotationAlignment(alignment: string) {
      this.rotationAlignment = alignment;
      return this;
    }

    getRotationAlignment() {
      return this.rotationAlignment;
    }

    addTo(map: any) {
      return this;
    }

    remove() {
      this.removeCount++;
      return this;
    }

    getElement() {
      return this.element;
    }
  }

  class MockMap {
    private _pitch = 55;
    private _bearing = 0;
    private _center: [number, number] = [-105.0945, 39.4912];
    private _zoom = 16;
    private _padding = { top: 0, bottom: 160, left: 0, right: 0 };
    private sources = new Map<string, any>();
    private layers = new Map<string, any>();
    private listeners = new Map<string, Set<Function>>();
    private styleLoaded = true;
    private renderedFeatures: any[] = [];

    resizeCount = 0;
    removeCount = 0;

    constructor(options: any) {
      if (options?.pitch !== undefined) this._pitch = options.pitch;
      if (options?.bearing !== undefined) this._bearing = options.bearing;
      if (options?.center) this._center = options.center;
      if (options?.zoom !== undefined) this._zoom = options.zoom;
      if (options?.padding) this._padding = { ...this._padding, ...options.padding };
    }

    on(event: string, callback: Function) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event)!.add(callback);
      return this;
    }

    once(event: string, callback: Function) {
      const wrapper = (...args: any[]) => {
        this.off(event, wrapper);
        callback(...args);
      };
      this.on(event, wrapper);
      return this;
    }

    off(event: string, callback: Function) {
      this.listeners.get(event)?.delete(callback);
      return this;
    }

    fire(event: string, data?: any) {
      const callbacks = this.listeners.get(event);
      if (callbacks) callbacks.forEach((cb) => cb(data));
      return this;
    }

    isStyleLoaded() {
      return this.styleLoaded;
    }

    getPitch(): number {
      return this._pitch;
    }

    setPitch(pitch: number): this {
      this._pitch = Math.max(0, Math.min(85, pitch));
      return this;
    }

    getBearing(): number {
      return this._bearing;
    }

    setBearing(bearing: number): this {
      this._bearing = ((bearing % 360) + 360) % 360;
      return this;
    }

    getZoom(): number {
      return this._zoom;
    }

    setZoom(zoom: number): this {
      this._zoom = zoom;
      return this;
    }

    getCenter(): { lng: number; lat: number } {
      return { lng: this._center[0], lat: this._center[1] };
    }

    setCenter(center: [number, number]): this {
      if (Array.isArray(center) && !Number.isNaN(center[0]) && !Number.isNaN(center[1])) {
        this._center = center;
      }
      return this;
    }

    getContainer(): HTMLElement {
      const el = document.createElement('div');
      Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
      Object.defineProperty(el, 'clientWidth', { value: 800, configurable: true });
      return el;
    }

    getPadding(): { top: number; bottom: number; left: number; right: number } {
      return { ...this._padding };
    }

    setPadding(padding: { top?: number; bottom?: number; left?: number; right?: number }): this {
      this._padding = { ...this._padding, ...padding };
      return this;
    }

    easeTo(options: {
      center?: [number, number];
      pitch?: number;
      bearing?: number;
      padding?: any;
      duration?: number;
      easing?: (t: number) => number;
    }): this {
      if (options.center && !Number.isNaN(options.center[0]) && !Number.isNaN(options.center[1])) {
        this.setCenter(options.center);
      }
      if (options.pitch !== undefined) this.setPitch(options.pitch);
      if (options.bearing !== undefined) this.setBearing(options.bearing);
      if (options.padding) this.setPadding(options.padding);
      return this;
    }

    jumpTo(options: any): this {
      return this.easeTo(options);
    }

    resize(): this {
      this.resizeCount++;
      return this;
    }

    remove(): this {
      this.removeCount++;
      this.listeners.clear();
      this.sources.clear();
      this.layers.clear();
      return this;
    }

    addSource(id: string, source: any): this {
      const sourceObj = {
        ...source,
        setData: vi.fn((data: any) => {
          sourceObj.data = data;
        })
      };
      this.sources.set(id, sourceObj);
      return this;
    }

    getSource(id: string): any {
      return this.sources.get(id);
    }

    removeSource(id: string): this {
      this.sources.delete(id);
      return this;
    }

    addLayer(layer: any): this {
      this.layers.set(layer.id, layer);
      return this;
    }

    getLayer(id: string): any {
      return this.layers.get(id);
    }

    removeLayer(id: string): this {
      this.layers.delete(id);
      return this;
    }

    setRenderedFeatures(features: any[]): void {
      this.renderedFeatures = features;
    }

    queryRenderedFeatures(pointOrBbox?: any, filter?: any): any[] {
      return this.renderedFeatures;
    }
  }

  return {
    default: {
      Map: MockMap,
      Marker: MockMarker,
      Popup: MockPopup,
      addProtocol: vi.fn(),
      setWorkerUrl: vi.fn(),
      getWorkerUrl: vi.fn(() => '')
    },
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
    getWorkerUrl: vi.fn(() => '')
  };
});

describe('RideCockpitComponent Unit Test Suite', () => {
  let component: RideCockpitComponent;
  let fixture: ComponentFixture<RideCockpitComponent>;

  const mockTrackPoints: [number, number, number, number, number][] = [
    [39.4912, -105.0945, 1780, 0, 0],
    [39.4890, -105.0980, 1810, 0.45, 0.28],
    [39.4850, -105.1020, 1850, 0.95, 0.59],
    [39.4800, -105.1080, 1900, 1.65, 1.02]
  ];

  const mockClimbs: Climb[] = [
    {
      id: 'climb-1',
      name: 'Roxborough Ascent',
      state: 'CO',
      startMile: 0.2,
      endMile: 0.8,
      startKm: 0.32,
      endKm: 1.28,
      lengthMiles: 0.6,
      lengthKm: 0.96,
      startElevationMeters: 1780,
      summitElevationMeters: 1850,
      startElevationFeet: 5840,
      summitElevationFeet: 6070,
      elevationGainMeters: 70,
      elevationGainFeet: 230,
      avgGradePercent: 7.2,
      maxGradePercent: 11.0,
      isIconic: false
    }
  ];

  let mockRouteService: any;
  let mockRouteManifest: any;
  let mockSettingsService: any;
  let mockPmtilesStorage: any;
  let mockTurnGuidance: any;
  let mockAudioAlert: any;
  let mockSimulator: any;

  beforeEach(async () => {
    mockRouteService = {
      activeRouteId: signal<string | null>('colorado-trail'),
      trackPoints: signal<[number, number, number, number, number][]>(mockTrackPoints),
      places: signal<any[]>([]),
      climbs: signal<Climb[]>(mockClimbs),
      turns: signal<any[]>([]),
      projectOntoRoute: vi.fn((lat: number, lon: number) => ({
        distanceKm: 0.01,
        distanceMiles: 0.006,
        projectedRouteKm: 0.45,
        projectedRouteMile: 0.28,
        isOffRoute: false,
        nearestPointOnTrail: { lat: 39.4890, lon: -105.0980, ele: 1810 },
        nearestMile: 0.28
      }))
    };

    mockRouteManifest = {
      activeRouteSummary: signal({
        id: 'colorado-trail',
        name: 'Colorado Trail',
        totalDistanceMiles: 540
      })
    };

    mockSettingsService = {
      distanceUnit: signal<'miles' | 'km'>('miles'),
      mapStyle: signal<'dark' | 'topo'>('dark'),
      mapRenderer: signal<'auto' | 'raster'>('auto'),
      selectedRouteKey: signal<string>('colorado-trail')
    };

    mockPmtilesStorage = {
      isRouteCachedSync: vi.fn().mockReturnValue(true),
      isRouteCached: vi.fn().mockResolvedValue(true),
      downloadRoute: vi.fn().mockResolvedValue(new Blob([])),
      getEstimatedSize: vi.fn().mockReturnValue('~25 MB'),
      activeDownloads: signal<Record<string, any>>({})
    };

    mockTurnGuidance = {
      computeTurnAhead: vi.fn((mile: number, pts: any[], unit: string, turns?: any[]) => {
        if (mile < 0.5) {
          return {
            direction: 'right',
            distanceMeters: 140,
            displayText: unit === 'km' ? 'Turn right in 140 meters' : 'Turn right in 153 yards'
          };
        }
        return null;
      }),
      calculateBearing: vi.fn(() => 135),
      getRouteTangentBearing: vi.fn(() => 135),
      snapToTrail: vi.fn((coords: [number, number]) => coords)
    };

    const audioAlertedSignal = signal<boolean>(false);
    const playBeepSpy = vi.fn().mockResolvedValue(undefined);
    const resetLatchSpy = vi.fn(() => {
      audioAlertedSignal.set(false);
    });

    mockAudioAlert = {
      isAlerted: computed(() => audioAlertedSignal()),
      hasAlerted: vi.fn(() => audioAlertedSignal()),
      playOffCourseBeep: playBeepSpy,
      resetOffCourseLatch: resetLatchSpy,
      processDistance: vi.fn(async (deviationMeters: number) => {
        if (deviationMeters > 35) {
          if (!audioAlertedSignal()) {
            audioAlertedSignal.set(true);
            await playBeepSpy();
            return true;
          }
        } else if (deviationMeters <= 25) {
          resetLatchSpy();
        }
        return false;
      })
    };

    const simState = signal({
      running: false,
      speedKph: 15,
      simulatedMile: 0,
      simulatedCoords: null as [number, number] | null,
      simulatedHeading: 180,
      simulatedSpeedKph: 0
    });

    mockSimulator = {
      state: simState,
      running: computed(() => simState().running),
      simulatedMile: computed(() => simState().simulatedMile),
      simulatedCoords: computed(() => simState().simulatedCoords),
      simulatedHeading: computed(() => simState().simulatedHeading),
      simulatedSpeedKph: computed(() => simState().simulatedSpeedKph),
      setTrackPoints: vi.fn(),
      seek: vi.fn((mile: number) => {
        simState.update((s) => ({ ...s, simulatedMile: mile }));
      }),
      start: vi.fn((spd: number) => {
        simState.set({
          running: true,
          speedKph: spd,
          simulatedMile: 0.28,
          simulatedCoords: [39.4890, -105.0980],
          simulatedHeading: 135,
          simulatedSpeedKph: spd
        });
      }),
      stop: vi.fn(() => {
        simState.update((s) => ({ ...s, running: false, simulatedSpeedKph: 0 }));
      }),
      setSpeed: vi.fn((spd: number) => {
        simState.update((s) => ({ ...s, speedKph: spd }));
      }),
      reset: vi.fn(() => {
        simState.update((s) => ({
          ...s,
          running: false,
          simulatedMile: 0,
          simulatedCoords: null,
          simulatedSpeedKph: 0
        }));
      })
    };

    await TestBed.configureTestingModule({
      imports: [RideCockpitComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RouteDataService, useValue: mockRouteService },
        { provide: RouteManifestService, useValue: mockRouteManifest },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: PmtilesStorageService, useValue: mockPmtilesStorage },
        { provide: TurnGuidanceService, useValue: mockTurnGuidance },
        { provide: AudioAlertService, useValue: mockAudioAlert },
        { provide: GpsSimulatorService, useValue: mockSimulator }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RideCockpitComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentMile', 0.0);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.componentRef.setInput('gpsState', {
      enabled: true,
      latitude: 39.4912,
      longitude: -105.0945,
      speedKph: 20
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  // --------------------------------------------------------------------------
  // 1. 3D Perspective MapLibre View & Defaults
  // --------------------------------------------------------------------------
  describe('1. 3D Perspective MapLibre View & Defaults', () => {
    it('should initialize MapLibre GL in 3D tilted mode with default pitch 55°', () => {
      const map = (component as any).map;
      expect(map).toBeDefined();
      expect(map.getPitch()).toBe(55);
      expect(map.getPitch()).toBeGreaterThanOrEqual(MIN_3D_PITCH);
      expect(map.getPitch()).toBeLessThanOrEqual(MAX_3D_PITCH);
    });

    it('should enforce lower-quarter / lower-third anchor padding with top padding', () => {
      const map = (component as any).map;
      const padding = map.getPadding();
      expect(padding.top).toBeGreaterThan(0);
      expect(padding.bottom).toBe(0);
    });

    it('should clamp pitch strictly within [50, 60] range when adjusted', () => {
      component.setPitch(40);
      expect(component.cameraPitch()).toBe(50);
      component.setPitch(75);
      expect(component.cameraPitch()).toBe(60);
    });

    it('should ease camera to updated coordinates while preserving pitch and padding', () => {
      const map = (component as any).map;
      const easeSpy = vi.spyOn(map, 'easeTo');

      (component as any).easeCameraToPosition(39.4890, -105.0980, 135, 15);

      expect(easeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          center: [-105.0980, 39.4890],
          pitch: 55,
          bearing: 135,
          padding: expect.objectContaining({ top: expect.any(Number), bottom: 0 })
        })
      );
    });

    it('should wrap bearing within [0, 360) correctly', () => {
      const map = (component as any).map;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 375, 10, true);
      expect(map.getBearing()).toBe(15);

      (component as any).easeCameraToPosition(39.4890, -105.0980, -20, 10, true);
      expect(map.getBearing()).toBe(340);
    });

    it('should limit camera rotation speed to 45 deg/sec while moving', () => {
      const map = (component as any).map;
      // Initialize camera at bearing 0 (instant)
      (component as any).easeCameraToPosition(39.4890, -105.0980, 0, 15, true);
      expect(map.getBearing()).toBe(0);

      // Advance timestamp by 1.0s (1000ms). At 45 deg/sec, turns 45 deg.
      const t0 = (component as any).lastCameraTimestamp;
      (component as any).lastCameraTimestamp = t0 - 1000;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 90, 15);
      expect(map.getBearing()).toBeCloseTo(45, 1);

      // Advance another 1.0s (2.0s total at 45 deg/sec reaches 90 deg).
      const t1 = (component as any).lastCameraTimestamp;
      (component as any).lastCameraTimestamp = t1 - 1000;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 90, 15);
      expect(map.getBearing()).toBeCloseTo(90, 1);

      // Now request a turn from 90 deg to 260 deg (170 deg clockwise turn) with 1.0s elapsed.
      // At 45 deg/sec, in 1.0s it should turn 45 deg clockwise (90 + 45 = 135 deg), not jump immediately to 260!
      const t2 = (component as any).lastCameraTimestamp;
      (component as any).lastCameraTimestamp = t2 - 1000;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 260, 15);
      expect(map.getBearing()).toBeCloseTo(135, 1);

      // Advance another 1.0s (turns another 45 deg -> 180 deg)
      const t3 = (component as any).lastCameraTimestamp;
      (component as any).lastCameraTimestamp = t3 - 1000;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 260, 15);
      expect(map.getBearing()).toBeCloseTo(180, 1);
    });

    it('should take the shortest angular path across 0/360 boundary', () => {
      const map = (component as any).map;
      // Start at 10 deg
      (component as any).easeCameraToPosition(39.4890, -105.0980, 10, 15, true);
      expect(map.getBearing()).toBe(10);

      // Advance by 100ms (0.1s) and turn to 350 deg (shortest path is -20 deg, not +340 deg)
      // In 0.1s at 45 deg/sec, max step is 4.5 deg counter-clockwise: 10 - 4.5 = 5.5 deg
      const t0 = (component as any).lastCameraTimestamp;
      (component as any).lastCameraTimestamp = t0 - 100;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 350, 15);
      expect(map.getBearing()).toBeCloseTo(5.5, 0);
    });

    it('should scale stationary easeTo duration proportionally to deflection angle', () => {
      const map = (component as any).map;
      // Start at 0 deg (speed > 0 ensures 0 is recognized as initial heading, instant = true)
      (component as any).easeCameraToPosition(39.4890, -105.0980, 0, 15, true);
      expect(map.getBearing()).toBe(0);

      const easeSpy = vi.spyOn(map, 'easeTo');

      // Stationary turn 180 deg -> duration should be 4000ms (4.0s for 180 deg at 45 deg/sec)
      (component as any).easeCameraToPosition(39.4890, -105.0980, 180, 0);
      expect(easeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          bearing: 180,
          duration: 4000
        })
      );

      easeSpy.mockClear();

      // Stationary turn 90 deg (from 180 to 270) -> duration should be 2000ms (2.0s at 45 deg/sec)
      (component as any).easeCameraToPosition(39.4890, -105.0980, 270, 0);
      expect(easeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          bearing: 270,
          duration: 2000
        })
      );
    });

    it('should preserve last known heading when stationary and heading is zero', () => {
      const map = (component as any).map;
      (component as any).easeCameraToPosition(39.4890, -105.0980, 180, 15, true);
      expect(map.getBearing()).toBe(180);

      // Stopped: speed 0, heading 0 reported
      (component as any).easeCameraToPosition(39.4890, -105.0980, 0, 0);
      expect(map.getBearing()).toBe(180);
    });

    it('should register route-source with GeoJSON LineString coordinates', () => {
      const map = (component as any).map;
      const source = map.getSource('route-source');
      expect(source).toBeDefined();
      expect(source.data.geometry.type).toBe('LineString');
      expect(source.data.geometry.coordinates.length).toBe(mockTrackPoints.length);
    });

    it('should create route-glow and route-main layers with high-contrast styling', () => {
      const map = (component as any).map;
      const glow = map.getLayer('route-glow');
      const main = map.getLayer('route-main');

      expect(glow).toBeDefined();
      expect(glow.paint['line-color']).toBe('#10b981');

      expect(main).toBeDefined();
      expect(main.paint['line-color']).toBe('#34d399');
    });

    it('should update rider marker rotation tracking bearing', () => {
      const marker = (component as any).riderMarker;
      expect(marker).toBeDefined();
      (component as any).updateRiderMarker(39.4890, -105.0980, 215);

      expect(marker.getLngLat().lng).toBeCloseTo(-105.0980, 4);
      expect(marker.getLngLat().lat).toBeCloseTo(39.4890, 4);
      expect(marker.getRotation()).toBe(215);
    });

    it('should toggle autoFollow off on manual pan and restore on recenter', () => {
      expect(component.autoFollow()).toBe(true);
      const map = (component as any).map;
      map.fire('dragstart');
      expect(component.autoFollow()).toBe(false);

      component.recenterCamera();
      expect(component.autoFollow()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Vector Map (.pmtiles) Gating & Download Card
  // --------------------------------------------------------------------------
  describe('2. Vector Map Enforcement & Download Card', () => {
    it('should disable 3D map canvas and render download card when vector is not cached', async () => {
      mockPmtilesStorage.isRouteCached.mockResolvedValue(false);
      mockPmtilesStorage.isRouteCachedSync.mockReturnValue(false);

      await component.checkVectorCache('colorado-trail');
      fixture.detectChanges();

      expect(component.isVectorCached()).toBe(false);
      const card = fixture.nativeElement.querySelector('[data-testid="vector-download-card"]');
      expect(card).toBeTruthy();
      expect(card.textContent).toContain('Colorado Trail');
      expect(card.textContent).toContain('~25 MB');
    });

    it('should dismiss download card when vector map is cached', async () => {
      mockPmtilesStorage.isRouteCachedSync.mockReturnValue(true);
      mockPmtilesStorage.isRouteCached.mockResolvedValue(true);

      await component.checkVectorCache('colorado-trail');
      fixture.detectChanges();

      expect(component.isVectorCached()).toBe(true);
      const card = fixture.nativeElement.querySelector('[data-testid="vector-download-card"]');
      expect(card).toBeNull();
    });

    it('should trigger downloadRoute when download button is clicked and transition to cached', async () => {
      mockPmtilesStorage.isRouteCachedSync.mockReturnValue(false);
      mockPmtilesStorage.isRouteCached.mockResolvedValue(false);
      await component.checkVectorCache('colorado-trail');
      fixture.detectChanges();

      const btn = fixture.nativeElement.querySelector('[data-testid="download-vector-btn"]');
      expect(btn).toBeTruthy();

      await component.downloadVectorMap();
      fixture.detectChanges();

      expect(mockPmtilesStorage.downloadRoute).toHaveBeenCalledWith('colorado-trail', undefined, expect.any(Function));
      expect(component.isVectorCached()).toBe(true);
      const card = fixture.nativeElement.querySelector('[data-testid="vector-download-card"]');
      expect(card).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 3. GPS Disabled Warning Card
  // --------------------------------------------------------------------------
  describe('3. GPS Disabled Warning Card', () => {
    it('should display warning card when GPS tracking is disabled', () => {
      component.isVectorCached.set(true);
      fixture.componentRef.setInput('gpsState', {
        enabled: false,
        loading: false,
        lastUpdated: null,
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        error: null,
        projection: null
      });
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('[data-testid="gps-disabled-warning-card"]');
      expect(card).toBeTruthy();
      expect(card.textContent).toContain('GPS Disabled');
    });

    it('should emit enableGps when Enable GPS button is clicked', () => {
      component.isVectorCached.set(true);
      fixture.componentRef.setInput('gpsState', { enabled: false, loading: false });
      fixture.detectChanges();

      const spy = vi.spyOn(component.enableGps, 'emit');
      const btn = fixture.nativeElement.querySelector('[data-testid="enable-gps-btn"]');
      expect(btn).toBeTruthy();
      btn.click();

      expect(spy).toHaveBeenCalled();
    });

    it('should dismiss warning card once GPS is enabled', () => {
      component.isVectorCached.set(true);
      fixture.componentRef.setInput('gpsState', { enabled: true, loading: false });
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('[data-testid="gps-disabled-warning-card"]');
      expect(card).toBeNull();
    });

    it('should position the warning card in the top-right corner as a compact pill', () => {
      component.isVectorCached.set(true);
      fixture.componentRef.setInput('gpsState', { enabled: false, loading: false });
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('[data-testid="gps-disabled-warning-card"]');
      expect(card).toBeTruthy();
      expect(card.classList.contains('top-3')).toBe(true);
      expect(card.classList.contains('right-3')).toBe(true);
      expect(card.classList.contains('absolute')).toBe(true);
    });

    it('should display compact error message when gpsState has an error', () => {
      component.isVectorCached.set(true);
      fixture.componentRef.setInput('gpsState', {
        enabled: false,
        loading: false,
        error: 'Location permission denied by user.'
      });
      fixture.detectChanges();

      const card = fixture.nativeElement.querySelector('[data-testid="gps-disabled-warning-card"]');
      expect(card).toBeTruthy();
      expect(card.textContent).toContain('Location permission denied by user.');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Speedometer Widget & Formatting
  // --------------------------------------------------------------------------
  describe('4. Speedometer Widget', () => {
    it('should format speed correctly in km/h when unit is km', () => {
      expect(formatSpeed(24.2, 'km')).toBe('24 km/h');
      expect(formatSpeed(0, 'km')).toBe('0 km/h');
      expect(formatSpeed(85, 'km')).toBe('85 km/h');
      expect(formatSpeed(-5, 'km')).toBe('0 km/h');
    });

    it('should format speed correctly in mph with 1 decimal when unit is miles', () => {
      expect(formatSpeed(24.2, 'miles')).toBe('15.0 mph');
      expect(formatSpeed(0, 'miles')).toBe('0.0 mph');
      expect(formatSpeed(85, 'miles')).toBe('52.8 mph');
      expect(formatSpeed(16.0934, 'miles')).toBe('10.0 mph');
      expect(formatSpeed(-10, 'miles')).toBe('0.0 mph');
    });

    it('should render live speed widget in bottom-right corner', () => {
      fixture.componentRef.setInput('unit', 'km');
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        speedKph: 24.2
      });
      fixture.detectChanges();

      const widget = fixture.nativeElement.querySelector('[data-testid="speedometer-widget"]');
      expect(widget).toBeTruthy();
      expect(widget.textContent).toContain('24');
      expect(widget.textContent).toContain('km/h');
    });

    it('should prioritize simulator speed when simulation is running', () => {
      mockSimulator.start(32);
      fixture.componentRef.setInput('unit', 'km');
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        speedKph: 15
      });
      fixture.detectChanges();

      expect(component.currentSpeedKph()).toBe(32);
      expect(component.displaySpeedText()).toBe('32 km/h');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Turn-Ahead Guidance Chip & Road Snapping
  // --------------------------------------------------------------------------
  describe('5. Turn-Ahead Guidance Chip & Road Snapping', () => {
    it('should compute upcoming turn cue ahead of current mile', () => {
      expect(component.turnCue()).not.toBeNull();
      expect(component.turnCue()?.direction).toBe('right');
      expect(component.turnCue()?.displayText).toContain('Turn right');
    });

    it('should render turn guidance chip in template when turnCue is present', () => {
      const el = fixture.nativeElement as HTMLElement;
      const chip = el.querySelector('[data-testid="turn-ahead-chip"]');
      expect(chip).toBeTruthy();
      expect(chip?.textContent).toContain('Turn right in 153 yards');
    });

    it('should format turn guidance in meters when unit is km', () => {
      fixture.componentRef.setInput('unit', 'km');
      fixture.detectChanges();
      expect(mockTurnGuidance.computeTurnAhead).toHaveBeenCalledWith(0.0, expect.any(Array), 'km', expect.any(Array));
    });

    it('should map directional icons correctly', () => {
      expect(component.getTurnIcon('slight-left')).toBe('↖️');
      expect(component.getTurnIcon('left')).toBe('⬅️');
      expect(component.getTurnIcon('sharp-left')).toBe('↙️');
      expect(component.getTurnIcon('slight-right')).toBe('↗️');
      expect(component.getTurnIcon('right')).toBe('➡️');
      expect(component.getTurnIcon('sharp-right')).toBe('↘️');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Climb Mini-Depiction Widget Under Map
  // --------------------------------------------------------------------------
  describe('6. Climb Mini-Depiction Widget', () => {
    it('should not activate climb widget when rider is before climb start', () => {
      fixture.componentRef.setInput('currentMile', 0.1);
      fixture.detectChanges();
      expect(component.activeClimb()).toBeNull();
      expect(component.climbStatus()).toBeNull();
    });

    it('should activate climb widget when rider enters climb segment', () => {
      fixture.componentRef.setInput('currentMile', 0.4);
      fixture.detectChanges();
      const status = component.climbStatus();
      expect(status).not.toBeNull();
      expect(status?.name).toBe('Roxborough Ascent');
      expect(status?.gradePercent).toBe(7.2);
    });

    it('should render climb widget SVG and statistics in DOM', () => {
      fixture.componentRef.setInput('currentMile', 0.4);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const widget = el.querySelector('[data-testid="climb-mini-widget"]');
      expect(widget).toBeTruthy();
      expect(widget?.textContent).toContain('Roxborough Ascent');
      expect(widget?.textContent).toContain('7.2% avg');
      const svg = widget?.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should generate miniProfile with authentic slope gradient and dots matching climb cards', () => {
      fixture.componentRef.setInput('currentMile', 0.4);
      fixture.detectChanges();
      const status = component.climbStatus();
      expect(status?.miniProfile).toBeDefined();
      expect(status?.miniProfile.linePathD).toMatch(/^M\s/);
      expect(status?.miniProfile.areaPathD).toContain('Z');
      expect(status?.miniProfile.gradientStops.length).toBeGreaterThan(0);
      expect(status?.miniProfile.startPoint).toBeDefined();
      expect(status?.miniProfile.summitPoint).toBeDefined();
      expect(status?.miniProfile.riderDot).toBeDefined();
    });

    it('should position climb widget in center of hud-bottom-bar without overlapping speedometer', () => {
      fixture.componentRef.setInput('currentMile', 0.4);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const bottomBar = el.querySelector('.hud-bottom-bar');
      expect(bottomBar).toBeTruthy();
      const widget = bottomBar?.querySelector('[data-testid="climb-mini-widget"]');
      const speedometer = bottomBar?.querySelector('[data-testid="speedometer-widget"]');
      expect(widget).toBeTruthy();
      expect(speedometer).toBeTruthy();
      expect(widget?.classList.contains('mx-auto')).toBe(true);
    });


    it('should dismiss climb widget after summit', () => {
      fixture.componentRef.setInput('currentMile', 0.9);
      fixture.detectChanges();
      expect(component.activeClimb()).toBeNull();
      expect(component.climbStatus()).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 7. Off-Course Visual & Acoustic Alerting
  // --------------------------------------------------------------------------
  describe('7. Off-Course Visual & Acoustic Alerts', () => {
    it('should not trigger off-course alert when within 35m corridor', () => {
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.02, // 20m
        distanceMiles: 0.012,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.4913, longitude: -105.0945 });
      fixture.detectChanges();

      expect(component.offCourseStatus().isOffCourse).toBe(false);
      const banner = fixture.nativeElement.querySelector('[data-testid="off-course-banner"]');
      expect(banner).toBeNull();
    });

    it('should trigger off-course alert when deviation exceeds 35m', () => {
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.05, // 50m
        distanceMiles: 0.031,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.4917, longitude: -105.0945 });
      fixture.detectChanges();

      expect(component.offCourseStatus().isOffCourse).toBe(true);
      expect(component.offCourseStatus().displayText).toContain('Off Route');
      const banner = fixture.nativeElement.querySelector('[data-testid="off-course-banner"]');
      expect(banner).toBeTruthy();
      expect(mockAudioAlert.processDistance).toHaveBeenCalledWith(50);
    });

    it('should handle full 5-stage hysteresis sequence (30m -> 36m -> 38m -> 26m -> 24m)', async () => {
      // 1. Initial State: 30m deviation (within corridor threshold <= 35m)
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.030, // 30m
        distanceMiles: 0.0186,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.4914, longitude: -105.0945 });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.offCourseStatus().isOffCourse).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="off-course-banner"]')).toBeNull();
      expect(mockAudioAlert.playOffCourseBeep).not.toHaveBeenCalled();

      // 2. Trigger: 36m deviation (> 35m) -> alert triggered, banner visible, tone played
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.036, // 36m
        distanceMiles: 0.0224,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.4915, longitude: -105.0945 });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.offCourseStatus().isOffCourse).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="off-course-banner"]')).toBeTruthy();
      expect(mockAudioAlert.processDistance).toHaveBeenCalledWith(36);
      expect(mockAudioAlert.playOffCourseBeep).toHaveBeenCalledTimes(1);

      // 3. Excursion: 38m deviation (> 35m) -> banner remains, latch holds, no duplicate tone
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.038, // 38m
        distanceMiles: 0.0236,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.4916, longitude: -105.0945 });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.offCourseStatus().isOffCourse).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="off-course-banner"]')).toBeTruthy();
      expect(mockAudioAlert.processDistance).toHaveBeenCalledWith(38);
      expect(mockAudioAlert.playOffCourseBeep).toHaveBeenCalledTimes(1);

      // 4. Deadband: 26m deviation (25m < d <= 35m) -> latch holds, banner stays visible with return vector arrow
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.026, // 26m
        distanceMiles: 0.0162,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.49135, longitude: -105.0945 });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.offCourseStatus().isOffCourse).toBe(true);
      const banner26m = fixture.nativeElement.querySelector('[data-testid="off-course-banner"]');
      expect(banner26m).toBeTruthy();
      expect(banner26m.textContent).toContain('Return');
      const returnArrow = banner26m.querySelector('svg');
      expect(returnArrow).toBeTruthy();
      expect(mockAudioAlert.playOffCourseBeep).toHaveBeenCalledTimes(1);

      // 5. Recovery: 24m deviation (<= 25m) -> hysteresis reset, banner dismissed
      mockRouteService.projectOntoRoute.mockReturnValue({
        distanceKm: 0.024, // 24m
        distanceMiles: 0.0149,
        nearestPointOnTrail: { lat: 39.4912, lon: -105.0945, ele: 1680 }
      });
      fixture.componentRef.setInput('gpsState', { enabled: true, latitude: 39.4913, longitude: -105.0945 });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.offCourseStatus().isOffCourse).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="off-course-banner"]')).toBeNull();
      expect(mockAudioAlert.resetOffCourseLatch).toHaveBeenCalled();
      expect(mockAudioAlert.isAlerted()).toBe(false);
      expect(mockAudioAlert.playOffCourseBeep).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Interactive GPS Simulator Controls
  // --------------------------------------------------------------------------
  describe('8. Interactive GPS Simulator Controls', () => {
    it('should toggle simulator popup card when clicking speedometer', () => {
      const el = fixture.nativeElement as HTMLElement;
      const speedometer = el.querySelector('[data-testid="speedometer-widget"]') as HTMLElement;
      expect(speedometer).toBeTruthy();

      expect(component.isSimulatorOpen()).toBe(false);
      speedometer.click();
      fixture.detectChanges();
      expect(component.isSimulatorOpen()).toBe(true);
    });


    it('should allow setting speed presets', () => {
      component.setSimPreset(25);
      expect(component.simSpeedInput()).toBe(25);
    });

    it('should start simulation when clicking Play button', () => {
      component.setSimPreset(20);
      component.toggleSimulation();
      expect(mockSimulator.start).toHaveBeenCalledWith(20, mockTrackPoints);
    });

    it('should stop simulation when clicking Stop button while running', () => {
      const selectMileSpy = vi.spyOn(component.selectMile, 'emit');
      component.toggleSimulation(); // Start
      fixture.detectChanges();
      component.toggleSimulation(); // Stop
      expect(mockSimulator.stop).toHaveBeenCalled();
      expect(selectMileSpy).toHaveBeenCalledWith(0.28);
    });

    it('should not stop simulation when component is destroyed (preserving simulation on view change)', () => {
      component.toggleSimulation(); // Start
      fixture.detectChanges();
      mockSimulator.stop.mockClear();

      component.ngOnDestroy();
      expect(mockSimulator.stop).not.toHaveBeenCalled();
    });

    it('should prioritize simulated mile and coords over static inputs', () => {
      component.toggleSimulation();
      fixture.detectChanges();
      expect(component.effectiveMile()).toBe(0.28);
      expect(component.effectiveCoords()).toEqual([39.4890, -105.0980]);
    });

    it('should seek simulator when currentMile input changes while stopped', () => {
      mockSimulator.seek.mockClear();
      fixture.componentRef.setInput('currentMile', 350);
      fixture.detectChanges();
      expect(mockSimulator.seek).toHaveBeenCalledWith(350);
    });

    it('should seek simulator when currentMile jumps (>0.05 miles) while running', () => {
      component.toggleSimulation(); // Start running (simulatedMile becomes 0.28)
      fixture.detectChanges();
      mockSimulator.seek.mockClear();

      // Jump forward by 25 miles (e.g. +25 clicked in telemetry header)
      fixture.componentRef.setInput('currentMile', 25.28);
      fixture.detectChanges();
      expect(mockSimulator.seek).toHaveBeenCalledWith(25.28);
    });

    it('should seek to currentMile before starting simulation', () => {
      fixture.componentRef.setInput('currentMile', 42.5);
      fixture.detectChanges();
      mockSimulator.seek.mockClear();
      mockSimulator.start.mockClear();

      component.toggleSimulation();
      expect(mockSimulator.seek).toHaveBeenCalledWith(42.5);
      expect(mockSimulator.start).toHaveBeenCalled();
    });

    it('should emit selectMile(0) when resetSimulation is called', () => {
      const emitSpy = vi.spyOn(component.selectMile, 'emit');
      component.resetSimulation();
      expect(mockSimulator.reset).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(0);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Lifecycle Robustness & Post-Destruction Guards
  // --------------------------------------------------------------------------
  describe('9. Lifecycle Robustness & Post-Destruction Guards', () => {
    it('should not initialize map or update signals if component is destroyed while downloadVectorMap is in flight', async () => {
      let resolveDownload: (res: any) => void = () => {};
      mockPmtilesStorage.downloadRoute = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveDownload = resolve;
        });
      });

      mockPmtilesStorage.isRouteCachedSync.mockReturnValue(false);
      mockPmtilesStorage.isRouteCached.mockResolvedValue(false);

      const downloadPromise = component.downloadVectorMap();
      expect(component.isDownloadingVector()).toBe(true);

      const initSpy = vi.spyOn(component as any, 'init3DMap');

      fixture.destroy();

      resolveDownload({ ok: true });
      await downloadPromise;

      expect(initSpy).not.toHaveBeenCalled();
      expect((component as any).map).toBeNull();
    });

    it('should not initialize map if component is destroyed while checkVectorCache is in flight', async () => {
      let resolveCacheCheck: (cached: boolean) => void = () => {};
      mockPmtilesStorage.isRouteCachedSync.mockReturnValue(false);
      mockPmtilesStorage.isRouteCached = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveCacheCheck = resolve;
        });
      });

      const checkPromise = component.checkVectorCache('colorado-trail');
      const initSpy = vi.spyOn(component as any, 'init3DMap');

      fixture.destroy();

      resolveCacheCheck(true);
      await checkPromise;

      expect(initSpy).not.toHaveBeenCalled();
    });

    it('should early-return in init3DMap if container is detached from DOM or component is destroyed', () => {
      (component as any).map = null;
      const detachedEl = document.createElement('div');
      expect(detachedEl.isConnected).toBe(false);

      (component as any).init3DMap(detachedEl);
      expect((component as any).map).toBeNull();

      (component as any).isDestroyed = true;
      const connectedEl = fixture.nativeElement.querySelector('div') || document.body;
      (component as any).init3DMap(connectedEl);
      expect((component as any).map).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 10. Route Waypoint Markers on 3D Map (R2)
  // --------------------------------------------------------------------------
  describe('10. Route Waypoint Markers on 3D Map (R2)', () => {
    const samplePlaces: Place[] = [
      {
        id: 'place-water-1',
        name: 'Waterton Spring',
        category: 'water',
        type: 'spring',
        is_in_town: false,
        location: { lat: 39.49, lon: -105.09 },
        distance_to_trail_km: 0,
        route_km: 1.6,
        route_mile: 1.0
      },
      {
        id: 'place-camp-1',
        name: 'Indian Creek Campground',
        category: 'campground',
        type: 'campground',
        is_in_town: false,
        location: { lat: 39.48, lon: -105.10 },
        distance_to_trail_km: 0.1,
        route_km: 3.2,
        route_mile: 2.0
      },
      {
        id: 'place-town-1',
        name: 'Sedalia Resupply',
        category: 'town',
        type: 'town',
        is_in_town: true,
        location: { lat: 39.47, lon: -105.11 },
        distance_to_trail_km: 0.5,
        route_km: 8.0,
        route_mile: 5.0
      }
    ];

    it('should create and render MapLibre markers for route waypoints', () => {
      component.isVectorCached.set(true);
      mockRouteService.places.set(samplePlaces);
      fixture.detectChanges();

      const markers = component.getPoiMarkers();
      expect(markers.length).toBe(3);
    });

    it('should set billboard upright alignments on waypoint markers', () => {
      component.isVectorCached.set(true);
      mockRouteService.places.set(samplePlaces);
      fixture.detectChanges();

      const markers = component.getPoiMarkers();
      expect(markers.length).toBeGreaterThan(0);
      const firstMarker: any = markers[0];
      expect(firstMarker.getPitchAlignment()).toBe('viewport');
      expect(firstMarker.getRotationAlignment()).toBe('viewport');
    });

    it('should attach dark popups to route waypoint markers', () => {
      component.isVectorCached.set(true);
      mockRouteService.places.set(samplePlaces);
      fixture.detectChanges();

      const markers = component.getPoiMarkers();
      const firstMarker: any = markers[0];
      const popup = firstMarker.getPopup();
      expect(popup).toBeTruthy();
      expect(popup.options?.className).toBe('dark-maplibre-popup');
      expect(popup.getHTML()).toContain('Waterton Spring');
      expect(popup.getHTML()).toContain('Jump Rider Here');
    });

    it('should update markers when places signal updates', () => {
      component.isVectorCached.set(true);
      mockRouteService.places.set(samplePlaces);
      fixture.detectChanges();
      expect(component.getPoiMarkers().length).toBe(3);

      mockRouteService.places.set([samplePlaces[0]]);
      fixture.detectChanges();
      expect(component.getPoiMarkers().length).toBe(1);

      mockRouteService.places.set([]);
      fixture.detectChanges();
      expect(component.getPoiMarkers().length).toBe(0);
    });

    it('should clear all markers on component destroy', () => {
      component.isVectorCached.set(true);
      mockRouteService.places.set(samplePlaces);
      fixture.detectChanges();
      expect(component.getPoiMarkers().length).toBe(3);

      fixture.destroy();
      expect(component.getPoiMarkers().length).toBe(0);
    });

    it('should handle bpn-jump-mile custom event to seek simulator and emit selectMile', () => {
      component.isVectorCached.set(true);
      mockRouteService.places.set(samplePlaces);
      fixture.detectChanges();

      const selectSpy = vi.spyOn(component.selectMile, 'emit');
      const seekSpy = vi.spyOn(mockSimulator, 'seek');

      window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: 12.5 }));

      expect(selectSpy).toHaveBeenCalledWith(12.5);
      expect(seekSpy).toHaveBeenCalledWith(12.5);
    });
  });

  // --------------------------------------------------------------------------
  // 11. Proximity Heads-Up Notifications HUD (R3)
  // --------------------------------------------------------------------------
  describe('11. Proximity Heads-Up Notifications HUD (R3)', () => {
    const proximityPlaces: Place[] = [
      {
        id: 'w1',
        name: 'Roxborough Spring',
        category: 'water',
        type: 'spring',
        is_in_town: false,
        location: { lat: 39.49, lon: -105.09 },
        distance_to_trail_km: 0,
        route_km: 0.32,
        route_mile: 0.2 // Approaching (delta = 0.2 mi = ~322m)
      },
      {
        id: 'c1',
        name: 'Bear Creek Camp',
        category: 'campground',
        type: 'campground',
        is_in_town: false,
        location: { lat: 39.48, lon: -105.10 },
        distance_to_trail_km: 0,
        route_km: 0.45,
        route_mile: 0.28 // Approaching (delta = 0.28 mi = ~450m)
      },
      {
        id: 't1',
        name: 'Deckers Resupply',
        category: 'town',
        type: 'town',
        is_in_town: true,
        location: { lat: 39.47, lon: -105.11 },
        distance_to_trail_km: 0,
        route_km: 25.0,
        route_mile: 15.5 // Lookahead resupply candidate (> 1 mi ahead)
      }
    ];

    it('should suppress proximity HUD when rider is at position 0 to 50m', () => {
      mockRouteService.places.set(proximityPlaces);
      fixture.componentRef.setInput('currentMile', 0.0);
      fixture.detectChanges();

      const hud = fixture.nativeElement.querySelector('[data-testid="proximity-alerts-hud"]');
      expect(hud).toBeNull();
      expect(component.proximityAlerts().length).toBe(0);
    });

    it('should not render proximity HUD when no waypoints are in range', () => {
      mockRouteService.places.set(proximityPlaces);
      fixture.componentRef.setInput('currentMile', 5.0); // No waypoints within [-25m, 500m] of mile 5.0
      fixture.detectChanges();

      const hud = fixture.nativeElement.querySelector('[data-testid="proximity-alerts-hud"]');
      expect(hud).toBeNull();
      expect(component.proximityAlerts().length).toBe(0);
    });

    it('should render top-left HUD with active alerts when rider approaches waypoints past 50m', () => {
      mockRouteService.places.set(proximityPlaces);
      fixture.componentRef.setInput('currentMile', 0.1); // ~161m > 50m, within 500m of mile 0.2 & 0.28
      fixture.detectChanges();

      const alerts = component.proximityAlerts();
      expect(alerts.length).toBe(2);

      const hud = fixture.nativeElement.querySelector('[data-testid="proximity-alerts-hud"]');
      expect(hud).toBeTruthy();
      const topLeftHud = fixture.nativeElement.querySelector('[data-testid="hud-top-left"]');
      expect(topLeftHud).toBeTruthy();
      expect(topLeftHud.classList.contains('top-3')).toBe(true);
      expect(topLeftHud.classList.contains('left-3')).toBe(true);

      const cards = fixture.nativeElement.querySelectorAll('[data-testid="proximity-alert-card"]');
      expect(cards.length).toBe(2);
    });

    it('should display category badge, icon, and formatted proximity text without name in each alert card', () => {
      mockRouteService.places.set(proximityPlaces);
      fixture.componentRef.setInput('currentMile', 0.1);
      fixture.componentRef.setInput('unit', 'miles');
      fixture.detectChanges();

      const textElements = fixture.nativeElement.querySelectorAll('[data-testid="proximity-alert-text"]');
      expect(textElements.length).toBe(2);

      const waterCard = fixture.nativeElement.querySelector('[data-alert-category="water"]');
      expect(waterCard).toBeTruthy();
      expect(waterCard.textContent).toContain('💧');
      expect(waterCard.textContent).not.toContain('Roxborough Spring');
      expect(waterCard.textContent).toContain('in');
      expect(waterCard.textContent).toContain('yd');
      expect(waterCard.textContent).toContain('mi');

      const titleAttr = textElements[0].getAttribute('title');
      expect(titleAttr).toContain('Roxborough Spring');
    });

    it('should update HUD formatting reactively when distance unit changes to km', () => {
      mockRouteService.places.set(proximityPlaces);
      fixture.componentRef.setInput('currentMile', 0.1);
      fixture.componentRef.setInput('unit', 'km');
      fixture.detectChanges();

      const textElements = fixture.nativeElement.querySelectorAll('[data-testid="proximity-alert-text"]');
      expect(textElements.length).toBeGreaterThan(0);
      const text = textElements[0].textContent;
      expect(text).toContain('m');
    });
  });
});
