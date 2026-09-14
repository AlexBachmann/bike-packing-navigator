import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RouteMapComponent, getRasterBaselineStyle } from './route-map.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { PmtilesStorageService } from '../../services/pmtiles-storage.service';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// MapLibre GL Mock for JSDOM headless testing
vi.mock('maplibre-gl', () => {
  class MockMarker {
    private lngLat: [number, number] = [0, 0];
    private popup: any = null;
    element: HTMLElement;

    constructor(options?: { element?: HTMLElement; anchor?: string }) {
      this.element = options?.element || document.createElement('div');
    }

    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }

    getLngLat() {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }

    setPopup(popup: any) {
      this.popup = popup;
      return this;
    }

    getPopup() {
      return this.popup;
    }

    addTo(map: any) {
      return this;
    }

    removeCount = 0;

    remove() {
      this.removeCount++;
      return this;
    }

    getElement() {
      return this.element;
    }
  }

  class MockPopup {
    private html = '';
    private lngLat: [number, number] = [0, 0];

    constructor(options?: any) {}

    setHTML(html: string) {
      this.html = html;
      return this;
    }

    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }

    addTo(map: any) {
      return this;
    }

    remove() {
      return this;
    }
  }

  class MockNavigationControl {
    constructor(options?: any) {}
  }

  class MockMap {
    private zoom = 8;
    private center: [number, number] = [-115.56, 51.16];
    private sources = new Map<string, any>();
    private layers = new Map<string, any>();
    private listeners = new Map<string, Set<Function>>();

    constructor(options: any) {
      if (options?.zoom !== undefined) this.zoom = options.zoom;
      if (options?.center) this.center = options.center;
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
      if (callbacks) {
        callbacks.forEach((cb) => cb(data));
      }
      return this;
    }

    private styleLoaded = true;

    setStyleLoaded(loaded: boolean) {
      this.styleLoaded = loaded;
      return this;
    }

    isStyleLoaded() {
      return this.styleLoaded;
    }

    setStyle = vi.fn((style: any) => {
      this.styleLoaded = true;
      this.fire('styledata');
      return this;
    });

    getZoom() {
      return this.zoom;
    }

    setZoom(zoom: number) {
      this.zoom = zoom;
      return this;
    }

    getCenter() {
      return { lng: this.center[0], lat: this.center[1] };
    }

    setCenter(center: [number, number]) {
      this.center = center;
      return this;
    }

    flyTo(arg1: any, arg2?: any, arg3?: any) {
      if (typeof arg2 === 'number') {
        this.zoom = arg2;
      } else if (arg1 && typeof arg1 === 'object' && arg1.zoom !== undefined) {
        this.zoom = arg1.zoom;
      }
      return this;
    }

    panTo(coords: [number, number], options?: any) {
      this.center = coords;
      return this;
    }

    fitBounds(bounds: any, options?: any) {
      return this;
    }

    resize() {
      return this;
    }

    invalidateSize() {
      return this.resize();
    }

    remove() {
      this.listeners.clear();
      this.sources.clear();
      this.layers.clear();
      return this;
    }

    addControl(control: any, position?: string) {
      return this;
    }

    addSource(id: string, source: any) {
      const sourceObj = {
        ...source,
        setData: vi.fn((data: any) => {
          sourceObj.data = data;
        })
      };
      this.sources.set(id, sourceObj);
      return this;
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    removeSource(id: string) {
      this.sources.delete(id);
      return this;
    }

    addLayer(layer: any) {
      this.layers.set(layer.id, layer);
      return this;
    }

    getLayer(id: string) {
      return this.layers.get(id);
    }

    removeLayer(id: string) {
      this.layers.delete(id);
      return this;
    }

    setLayoutProperty(layerId: string, name: string, value: any) {
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.layout = layer.layout || {};
        layer.layout[name] = value;
      }
      return this;
    }

    setPaintProperty(layerId: string, name: string, value: any) {
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.paint = layer.paint || {};
        layer.paint[name] = value;
      }
      return this;
    }
  }

  return {
    default: {
      Map: MockMap,
      Marker: MockMarker,
      Popup: MockPopup,
      NavigationControl: MockNavigationControl,
      addProtocol: vi.fn(),
      setWorkerUrl: vi.fn(),
      getWorkerUrl: vi.fn(() => '')
    },
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    NavigationControl: MockNavigationControl,
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
    getWorkerUrl: vi.fn(() => '')
  };
});

describe('RouteMapComponent', () => {
  let component: RouteMapComponent;
  let fixture: ComponentFixture<RouteMapComponent>;
  let mockRouteService: Partial<RouteDataService>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockRouteService = {
      totalDistanceMiles: 2679.2,
      totalDistanceKm: 4311.8,
      activeRouteId: signal<string | null>('colorado-trail') as any,
      trackPoints: signal([
        [51.16, -115.56, 1400, 0.0, 0.0],
        [51.10, -115.50, 1500, 16.0, 10.0],
        [50.60, -115.08, 1930, 80.0, 50.0]
      ]),
      places: signal([
        {
          id: 'place-1',
          name: 'Banff Springs Hotel',
          town: 'Banff',
          province_state: 'AB',
          category: 'hotel',
          type: 'hotel',
          route_mile: 0.5,
          route_km: 0.8,
          is_in_town: true,
          location: {
            lat: 51.16,
            lon: -115.56
          },
          distance_to_trail_km: 0.0
        }
      ])
    };

    await TestBed.configureTestingModule({
      imports: [RouteMapComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RouteDataService, useValue: mockRouteService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RouteMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the route map component', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle map style between dark and topo', () => {
    expect(component.mapStyle()).toBe('dark');
    component.toggleMapStyle();
    expect(component.mapStyle()).toBe('topo');
    component.toggleMapStyle();
    expect(component.mapStyle()).toBe('dark');
  });

  it('should update active POI filter', () => {
    expect(component.activePoiFilter()).toBe('all');
    component.setPoiFilter('town');
    expect(component.activePoiFilter()).toBe('town');
  });

  it('should allow filtering campgrounds, hotels, and laundromats independently', () => {
    component.setPoiFilter('campground');
    expect(component.activePoiFilter()).toBe('campground');
    component.setPoiFilter('hotel');
    expect(component.activePoiFilter()).toBe('hotel');
    component.setPoiFilter('laundromat');
    expect(component.activePoiFilter()).toBe('laundromat');
  });

  it('should emit selectMile when bpn-jump-mile custom event is dispatched', () => {
    let emittedMile: number | undefined;
    component.selectMile.subscribe((mile) => {
      emittedMile = mile;
    });

    window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: 42.5 }));
    expect(emittedMile).toBe(42.5);
  });

  it('should remove bpn-jump-mile window event listener on ngOnDestroy', () => {
    let emittedMile: number | undefined;
    component.selectMile.subscribe((mile) => {
      emittedMile = mile;
    });

    component.ngOnDestroy();
    window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: 100.0 }));
    expect(emittedMile).toBeUndefined();
  });

  it('should render and update GPS display when gpsState is active', () => {
    fixture.componentRef.setInput('gpsState', {
      enabled: true,
      loading: false,
      lastUpdated: new Date(),
      latitude: 51.16,
      longitude: -115.56,
      accuracyMeters: 10,
      error: null,
      projection: {
        nearestPoint: [51.16, -115.56, 1400],
        nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
        projectedRouteMile: 0.0,
        projectedRouteKm: 0.0,
        distanceMiles: 0.0,
        distanceKm: 0.0,
        isOffRoute: false
      }
    });
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('should have type="button" on all buttons and aria-label on map control buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });

    const actionBtns = el.querySelectorAll('.bottom-3.right-2\\.5 button');
    actionBtns.forEach((btn) => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('should display dynamic distance in zoom out button title and aria-label', () => {
    const el = fixture.nativeElement as HTMLElement;
    const zoomBtn = el.querySelector('button[title*="Zoom out to show entire"]') as HTMLButtonElement;
    expect(zoomBtn).not.toBeNull();
    expect(zoomBtn.getAttribute('title')).toContain('4,311.8 km route');
    expect(zoomBtn.getAttribute('aria-label')).toContain('4,311.8 km route');
  });

  it('should reactively redraw track and update center when trackPoints changes', () => {
    (mockRouteService.trackPoints as any).set([
      [39.49, -105.09, 1670, 0.0, 0.0],
      [39.40, -105.15, 1750, 16.0, 10.0]
    ]);
    fixture.detectChanges();

    expect(component).toBeTruthy();
  });

  it('should remove route polylines when trackPoints becomes empty (route unloaded)', () => {
    expect((component as any).routeLineGlow).not.toBeNull();
    expect((component as any).routeLineMain).not.toBeNull();

    (mockRouteService.trackPoints as any).set([]);
    fixture.detectChanges();

    expect((component as any).routeLineGlow).toBeNull();
    expect((component as any).routeLineMain).toBeNull();
  });

  it('should clear polylines when trackPoints has fewer than 2 points', () => {
    expect((component as any).routeLineMain).not.toBeNull();

    (mockRouteService.trackPoints as any).set([[51.16, -115.56, 1400, 0.0, 0.0]]);
    fixture.detectChanges();

    expect((component as any).routeLineGlow).toBeNull();
    expect((component as any).routeLineMain).toBeNull();
  });

  it('should revoke object URL when tile loads from blob cache', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test-tile');

    const mockResponse = {
      blob: () => Promise.resolve(new Blob(['test-image'], { type: 'image/png' }))
    };

    (window as any).caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn().mockResolvedValue(undefined)
      })
    };

    const layer = (component as any).createTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(layer).toBeTruthy();

    if (layer.createTile) {
      const coords = { x: 1, y: 2, z: 3 };
      const doneCallback = vi.fn();

      const tile = layer.createTile(coords, doneCallback) as HTMLImageElement;
      expect(tile).toBeTruthy();

      await new Promise((r) => setTimeout(r, 20));

      expect(createSpy).toHaveBeenCalled();
      tile.dispatchEvent(new Event('load'));

      expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/test-tile');
      expect(doneCallback).toHaveBeenCalledWith(undefined, tile);
    }
  });

  it('should revoke object URL when tile fails to load or unloads early', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test-tile-err');

    const mockResponse = {
      blob: () => Promise.resolve(new Blob(['test-image'], { type: 'image/png' }))
    };

    (window as any).caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn().mockResolvedValue(undefined)
      })
    };

    const layer = (component as any).createTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png');

    if (layer.createTile) {
      const coords = { x: 1, y: 2, z: 3 };
      const doneCallback = vi.fn();

      const tile = layer.createTile(coords, doneCallback) as HTMLImageElement;

      await new Promise((r) => setTimeout(r, 20));

      layer.fire('tileunload', { tile });

      expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/test-tile-err');
    }
  });

  it('should persist zoom level on map zoomend', () => {
    const settingsService = TestBed.inject(SettingsService);
    const map = (component as any).map;
    expect(map).toBeTruthy();

    map.setZoom(12);
    map.fire('zoomend');

    expect(settingsService.mapZoomLevel()).toBe(12);
  });

  it('should preserve zoom level when rider position changes', () => {
    const map = (component as any).map;
    expect(map).toBeTruthy();

    map.setZoom(14);
    expect(map.getZoom()).toBe(14);

    fixture.componentRef.setInput('currentMile', 25.0);
    fixture.detectChanges();

    expect(map.getZoom()).toBe(14);
  });

  it('should preserve zoom level when centering on rider', () => {
    const map = (component as any).map;
    expect(map).toBeTruthy();

    map.setZoom(13);
    const flyToSpy = vi.spyOn(map, 'flyTo');

    component.centerOnRider();

    expect(flyToSpy).toHaveBeenCalled();
    const passedZoom = flyToSpy.mock.calls[0][1];
    expect(passedZoom).toBe(13);
  });

  it('should configure Strategy A raster baseline style with maxzoom 16 and native Esri sources', () => {
    const darkStyle = getRasterBaselineStyle('dark');
    expect(darkStyle.version).toBe(8);
    expect((darkStyle.sources['esri-dark-base'] as any).maxzoom).toBe(16);
    expect((darkStyle.sources['esri-dark-ref'] as any).maxzoom).toBe(16);
    expect((darkStyle.sources['esri-topo'] as any).maxzoom).toBe(16);

    const topoStyle = getRasterBaselineStyle('topo');
    expect(topoStyle.layers.find((l) => l.id === 'esri-topo-layer')?.layout?.visibility).toBe('visible');
    expect(topoStyle.layers.find((l) => l.id === 'esri-dark-base-layer')?.layout?.visibility).toBe('none');
  });

  it('should call map.resize on window resize and observer notifications', () => {
    const map = (component as any).map;
    const resizeSpy = vi.spyOn(map, 'resize');

    window.dispatchEvent(new Event('resize'));
    expect(resizeSpy).toHaveBeenCalled();
  });

  it('should remove stale projection line and source when gpsState.projection becomes null or disabled', () => {
    const map = (component as any).map;

    // 1. Initial valid GPS with projection
    fixture.componentRef.setInput('gpsState', {
      enabled: true,
      loading: false,
      lastUpdated: new Date(),
      latitude: 51.16,
      longitude: -115.56,
      accuracyMeters: 5,
      error: null,
      projection: {
        nearestPoint: [51.16, -115.56, 1400],
        nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
        projectedRouteMile: 0.0,
        projectedRouteKm: 0.0,
        distanceMiles: 0.0,
        distanceKm: 0.0,
        isOffRoute: false
      }
    });
    fixture.detectChanges();

    expect(map.getLayer('gps-projection-line')).toBeTruthy();
    expect(map.getSource('gps-projection-source')).toBeTruthy();
    expect((component as any).projectionLine).not.toBeNull();

    // 2. Projection becomes null
    fixture.componentRef.setInput('gpsState', {
      enabled: true,
      loading: false,
      lastUpdated: new Date(),
      latitude: 51.20,
      longitude: -115.60,
      accuracyMeters: 5,
      error: null,
      projection: null
    });
    fixture.detectChanges();

    expect(map.getLayer('gps-projection-line')).toBeUndefined();
    expect(map.getSource('gps-projection-source')).toBeUndefined();
    expect((component as any).projectionLine).toBeNull();
  });

  it('should remove gpsMarker and clear projection line upon ngOnDestroy', () => {
    const map = (component as any).map;

    fixture.componentRef.setInput('gpsState', {
      enabled: true,
      loading: false,
      lastUpdated: new Date(),
      latitude: 51.16,
      longitude: -115.56,
      accuracyMeters: 5,
      error: null,
      projection: {
        nearestPoint: [51.16, -115.56, 1400],
        nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
        projectedRouteMile: 0.0,
        projectedRouteKm: 0.0,
        distanceMiles: 0.0,
        distanceKm: 0.0,
        isOffRoute: false
      }
    });
    fixture.detectChanges();

    const gpsMarkerInstance = (component as any).gpsMarker;
    expect(gpsMarkerInstance).not.toBeNull();
    expect(map.getLayer('gps-projection-line')).toBeTruthy();

    component.ngOnDestroy();

    expect(gpsMarkerInstance.removeCount).toBeGreaterThan(0);
    expect((component as any).gpsMarker).toBeNull();
    expect((component as any).projectionLine).toBeNull();
    expect(map.getLayer('gps-projection-line')).toBeUndefined();
  });

  it('should wait for style readiness before drawing route when style is not loaded', () => {
    const map = (component as any).map;
    map.setStyleLoaded(false);

    // Clear existing route layers to test redraw
    component.clearRouteLayers();
    expect(map.getLayer('route-main')).toBeUndefined();

    // Trigger drawRoute while style is not loaded
    (component as any).drawRoute();

    // Layers should not be added yet
    expect(map.getLayer('route-main')).toBeUndefined();

    // Now style finishes loading
    map.setStyleLoaded(true);
    map.fire('styledata');

    // Route layer should now be added
    expect(map.getLayer('route-main')).toBeTruthy();
  });

  it('should wait for style readiness before adding GPS projection line when style is not loaded', () => {
    const map = (component as any).map;
    component.clearProjectionLine();
    map.setStyleLoaded(false);

    fixture.componentRef.setInput('gpsState', {
      enabled: true,
      loading: false,
      lastUpdated: new Date(),
      latitude: 51.16,
      longitude: -115.56,
      accuracyMeters: 5,
      error: null,
      projection: {
        nearestPoint: [51.16, -115.56, 1400],
        nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
        projectedRouteMile: 0.0,
        projectedRouteKm: 0.0,
        distanceMiles: 0.0,
        distanceKm: 0.0,
        isOffRoute: false
      }
    });
    fixture.detectChanges();

    // Line should not be added yet because style is not loaded
    expect(map.getLayer('gps-projection-line')).toBeUndefined();

    // Now style finishes loading
    map.setStyleLoaded(true);
    map.fire('load');

    // Projection line should now be added
    expect(map.getLayer('gps-projection-line')).toBeTruthy();
  });

  describe('Dual-Tier Offline Map & UX Touchpoint (Milestones 3 & 4)', () => {
    let pmtilesStorage: PmtilesStorageService;
    let settingsService: SettingsService;
    const testHeader = new Uint8Array([0x50, 0x4d, 0x54, 0x03, 1, 2, 3, 4]);
    const mockBlob = new Blob([testHeader], { type: 'application/octet-stream' });

    beforeEach(async () => {
      pmtilesStorage = TestBed.inject(PmtilesStorageService);
      settingsService = TestBed.inject(SettingsService);
      await pmtilesStorage.clearAllArchives();
      settingsService.setMapRenderer('auto');
    });

    it('should default activeMapMode to raster and toggle between raster and vector', async () => {
      expect(component.activeMapMode()).toBe('raster');

      await component.applyMapRenderer('vector');
      expect(component.activeMapMode()).toBe('vector');

      await component.applyMapRenderer('raster');
      expect(component.activeMapMode()).toBe('raster');
    });

    it('should track isVectorCached signal based on archive availability', async () => {
      expect(component.isVectorCached()).toBe(false);

      await pmtilesStorage.saveArchive('colorado-trail', mockBlob);
      await component.checkRouteCacheAndApplyRenderer();

      expect(component.isVectorCached()).toBe(true);
    });

    it('should auto-switch renderer to vector when route is cached and mapRenderer is auto', async () => {
      const map = (component as any).map;
      const setStyleSpy = vi.spyOn(map, 'setStyle');

      await pmtilesStorage.saveArchive('colorado-trail', mockBlob);
      settingsService.setMapRenderer('auto');

      await component.checkRouteCacheAndApplyRenderer();

      expect(component.activeMapMode()).toBe('vector');
      expect(setStyleSpy).toHaveBeenCalled();
      const passedStyle = setStyleSpy.mock.calls[setStyleSpy.mock.calls.length - 1][0] as any;
      expect(passedStyle.sources.openmaptiles).toBeDefined();
    });

    it('should force raster style when settings.mapRenderer is raster even if cached', async () => {
      await pmtilesStorage.saveArchive('colorado-trail', mockBlob);
      settingsService.setMapRenderer('raster');

      await component.checkRouteCacheAndApplyRenderer();

      expect(component.activeMapMode()).toBe('raster');
    });

    it('should apply vector style on initial load when route is pre-cached (onReady forceStyleReload)', async () => {
      // Pre-cache archive before component creation
      await pmtilesStorage.saveArchive('colorado-trail', mockBlob);

      const newFixture = TestBed.createComponent(RouteMapComponent);
      const newComp = newFixture.componentInstance;
      newFixture.detectChanges();

      const map = (newComp as any).map;
      expect(map).toBeTruthy();
      expect(newComp.activeMapMode()).toBe('vector');
      expect(newComp.isVectorCached()).toBe(true);
    });

    it('should invoke downloadRoute on PmtilesStorageService when downloadActiveRouteVector is called', async () => {
      const downloadSpy = vi.spyOn(pmtilesStorage, 'downloadRoute').mockResolvedValue(mockBlob);

      await component.downloadActiveRouteVector();

      expect(downloadSpy).toHaveBeenCalledWith('colorado-trail');
      expect(component.isVectorCached()).toBe(true);
    });

    it('should handle downloadActiveRouteVector failure cleanly without throwing unhandled error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(pmtilesStorage, 'downloadRoute').mockRejectedValue(new Error('Network error'));

      await expect(component.downloadActiveRouteVector()).resolves.toBeUndefined();
    });

    it('should render quick-action status bar with mode pill and download button in DOM', () => {
      component.activeMapMode.set('raster');
      component.isVectorCached.set(false);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Raster Map');

      const downloadBtn = el.querySelector('button[aria-label="Download offline vector map for active route"]');
      expect(downloadBtn).toBeTruthy();
      expect(downloadBtn?.textContent).toContain('Download Vector');
    });

    it('should render vector ready pill and offline ready indicator when vector is active and cached', () => {
      component.activeMapMode.set('vector');
      component.isVectorCached.set(true);
      settingsService.setMapRenderer('auto');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Vector Map (Offline Ready)');
      expect(el.textContent).toContain('Offline Ready');
      const downloadBtn = el.querySelector('button[aria-label="Download offline vector map for active route"]');
      expect(downloadBtn).toBeNull();
    });

    it('should render forced raster indicator when cached but settings force raster', () => {
      component.activeMapMode.set('raster');
      component.isVectorCached.set(true);
      settingsService.setMapRenderer('raster');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Raster Map');
      expect(el.textContent).toContain('Forced Raster (Settings)');
    });

    it('should trigger downloadActiveRouteVector when download button in DOM is clicked', () => {
      component.activeMapMode.set('raster');
      component.isVectorCached.set(false);
      fixture.detectChanges();

      const downloadSpy = vi.spyOn(component, 'downloadActiveRouteVector').mockImplementation(async () => {});
      const downloadBtn = fixture.nativeElement.querySelector(
        'button[aria-label="Download offline vector map for active route"]'
      ) as HTMLButtonElement;

      expect(downloadBtn).toBeTruthy();
      downloadBtn.click();

      expect(downloadSpy).toHaveBeenCalled();
    });

    it('should resolve base href when fetching vector style spec', async () => {
      const baseEl = document.querySelector('base') || document.createElement('base');
      if (!baseEl.parentElement) {
        document.head.appendChild(baseEl);
      }
      baseEl.setAttribute('href', '/bike-packing-navigator/');

      try {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(JSON.stringify({
            version: 8,
            sources: {
              openmaptiles: { type: 'vector', url: '' }
            },
            layers: []
          }), { status: 200 })
        );

        const spec = await component.getVectorStyleSpec('dark', 'colorado-trail');
        expect(fetchSpy).toHaveBeenCalledWith('/bike-packing-navigator/assets/styles/vector-dark.json');
        expect(spec.version).toBe(8);
      } finally {
        baseEl.setAttribute('href', '/');
      }
    });
  });
});
