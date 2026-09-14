import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RouteMapComponent, getRasterBaselineStyle } from './route-map.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { Place, GpsState } from '../../models/waypoint.model';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Spies and tracking structures for MapLibre GL mock
export interface MockMarkerInstance {
  element: HTMLElement;
  lngLat: [number, number];
  popup: any;
  addedToMap: any;
  removeCount: number;
}

const mockMarkerInstances: MockMarkerInstance[] = [];

vi.mock('maplibre-gl', () => {
  class MockMarker {
    private _lngLat: [number, number] = [0, 0];
    private _popup: any = null;
    element: HTMLElement;
    addedToMap: any = null;
    removeCount = 0;

    constructor(options?: { element?: HTMLElement; anchor?: string }) {
      this.element = options?.element || document.createElement('div');
      mockMarkerInstances.push(this as unknown as MockMarkerInstance);
    }

    setLngLat(lngLat: [number, number]) {
      this._lngLat = lngLat;
      return this;
    }

    getLngLat() {
      return { lng: this._lngLat[0], lat: this._lngLat[1] };
    }

    setPopup(popup: any) {
      this._popup = popup;
      return this;
    }

    getPopup() {
      return this._popup;
    }

    addTo(map: any) {
      this.addedToMap = map;
      if (map && map.getContainer && this.element) {
        map.getContainer().appendChild(this.element);
      }
      return this;
    }

    remove() {
      this.removeCount++;
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      if (this._popup && typeof this._popup.remove === 'function') {
        this._popup.remove();
      }
      return this;
    }

    getElement() {
      return this.element;
    }
  }

  class MockPopup {
    private html = '';
    private lngLat: [number, number] = [0, 0];
    element: HTMLElement;
    removeCount = 0;

    constructor(options?: any) {
      this.element = document.createElement('div');
      this.element.className = 'maplibregl-popup';
    }

    setHTML(html: string) {
      this.html = html;
      this.element.innerHTML = html;
      return this;
    }

    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }

    addTo(map: any) {
      if (map && map.getContainer) {
        map.getContainer().appendChild(this.element);
      }
      return this;
    }

    remove() {
      this.removeCount++;
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
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
    private container: HTMLElement;
    public removeCount = 0;
    public resizeCount = 0;
    public panToCalls: Array<{ coords: [number, number]; options?: any }> = [];
    public flyToCalls: Array<any> = [];

    constructor(options: any) {
      if (options?.zoom !== undefined) this.zoom = options.zoom;
      if (options?.center) this.center = options.center;
      this.container = options?.container || document.createElement('div');
    }

    getContainer() {
      return this.container;
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

    isStyleLoaded() {
      return true;
    }

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
      this.flyToCalls.push({ arg1, arg2, arg3 });
      if (typeof arg2 === 'number') {
        this.zoom = arg2;
      } else if (arg1 && typeof arg1 === 'object' && arg1.zoom !== undefined) {
        this.zoom = arg1.zoom;
      }
      return this;
    }

    panTo(coords: [number, number], options?: any) {
      this.panToCalls.push({ coords, options });
      this.center = coords;
      return this;
    }

    fitBounds(bounds: any, options?: any) {
      return this;
    }

    resize() {
      this.resizeCount++;
      return this;
    }

    invalidateSize() {
      return this.resize();
    }

    remove() {
      this.removeCount++;
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
      addProtocol: vi.fn()
    },
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    NavigationControl: MockNavigationControl,
    addProtocol: vi.fn()
  };
});

describe('RouteMapComponent Adversarial Empirical Challenge Suite', () => {
  let component: RouteMapComponent;
  let fixture: ComponentFixture<RouteMapComponent>;
  let mockRouteService: {
    totalDistanceMiles: number;
    totalDistanceKm: number;
    trackPoints: ReturnType<typeof signal<number[][]>>;
    places: ReturnType<typeof signal<Place[]>>;
  };

  const sampleTrack: number[][] = [
    [51.16, -115.56, 1400, 0.0, 0.0],
    [51.10, -115.50, 1500, 16.0, 10.0],
    [50.60, -115.08, 1930, 80.0, 50.0]
  ];

  const samplePlaces: Place[] = [
    {
      id: 'poi-1',
      name: 'Banff Hotel',
      town: 'Banff',
      province_state: 'AB',
      category: 'hotel',
      type: 'hotel',
      route_mile: 0.5,
      route_km: 0.8,
      is_in_town: true,
      location: { lat: 51.16, lon: -115.56 },
      distance_to_trail_km: 0.0
    },
    {
      id: 'poi-2',
      name: 'Spray Lake Campground',
      town: 'Canmore',
      province_state: 'AB',
      category: 'campground',
      type: 'campground',
      route_mile: 12.0,
      route_km: 19.3,
      is_in_town: false,
      location: { lat: 51.05, lon: -115.40 },
      distance_to_trail_km: 0.2
    },
    {
      id: 'poi-3',
      name: 'Canmore Cycle Shop',
      town: 'Canmore',
      province_state: 'AB',
      category: 'bike_shop',
      type: 'bike_shop',
      route_mile: 18.0,
      route_km: 29.0,
      is_in_town: true,
      location: { lat: 51.09, lon: -115.36 },
      distance_to_trail_km: 0.1
    },
    {
      id: 'poi-4',
      name: 'Safeway Grocery',
      town: 'Canmore',
      province_state: 'AB',
      category: 'grocery',
      type: 'supermarket',
      route_mile: 18.5,
      route_km: 29.8,
      is_in_town: true,
      location: { lat: 51.08, lon: -115.35 },
      distance_to_trail_km: 0.0
    },
    {
      id: 'poi-5',
      name: 'Self-Service Waschsalon Laundry',
      town: 'Canmore',
      province_state: 'AB',
      category: 'laundromat',
      type: 'laundromat',
      route_mile: 19.0,
      route_km: 30.5,
      is_in_town: true,
      location: { lat: 51.08, lon: -115.34 },
      distance_to_trail_km: 0.1
    },
    {
      id: 'poi-6',
      name: 'Highwood Junction Town Point',
      town: 'Highwood',
      province_state: 'AB',
      category: 'town',
      type: 'locality',
      route_mile: 45.0,
      route_km: 72.4,
      is_in_town: true,
      location: { lat: 50.62, lon: -115.10 },
      distance_to_trail_km: 0.0
    }
  ];

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockMarkerInstances.length = 0;

    mockRouteService = {
      totalDistanceMiles: 50.0,
      totalDistanceKm: 80.0,
      trackPoints: signal<number[][]>(sampleTrack),
      places: signal<Place[]>(samplePlaces)
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

  afterEach(() => {
    if (fixture) {
      fixture.destroy();
    }
  });

  // =========================================================================
  // TARGET 1: Empty or single-point route coordinates
  // =========================================================================
  describe('Target 1: Empty or single-point route coordinates', () => {
    it('1.1 should handle completely empty route coordinates [] without throwing or crashing', () => {
      expect(() => {
        mockRouteService.trackPoints.set([]);
        fixture.detectChanges();
      }).not.toThrow();

      const map = (component as any).map;
      expect(map).toBeTruthy();
      expect((component as any).routeLineGlow).toBeNull();
      expect((component as any).routeLineMain).toBeNull();
      expect(component.riderLocation()).toBeNull();

      // fitFullRoute and centerOnRider should safely no-op
      expect(() => component.fitFullRoute()).not.toThrow();
      expect(() => component.centerOnRider()).not.toThrow();
    });

    it('1.2 should handle 2-element single-point coordinates [[lat, lon]] without crashing', () => {
      // Hostile single point with only [lat, lon], omitting elevation, cum_km, cum_mi
      expect(() => {
        mockRouteService.trackPoints.set([[51.16, -115.56]]);
        fixture.detectChanges();
      }).not.toThrow();

      // When track has < 2 points, route line should not be drawn
      expect((component as any).routeLineGlow).toBeNull();
      expect((component as any).routeLineMain).toBeNull();

      // riderLocation should be safe
      const loc = component.riderLocation();
      expect(loc).toBeTruthy();
      expect(loc![0]).toBe(51.16);
      expect(loc![1]).toBe(-115.56);

      // Verify fitFullRoute safely no-ops without error
      expect(() => component.fitFullRoute()).not.toThrow();
    });

    it('1.3 should handle 5-element single-point coordinates [[lat, lon, ele, km, mi]] without crashing', () => {
      expect(() => {
        mockRouteService.trackPoints.set([[51.16, -115.56, 1400, 0.0, 0.0]]);
        fixture.detectChanges();
      }).not.toThrow();

      expect((component as any).routeLineMain).toBeNull();
      expect(() => component.centerOnRider()).not.toThrow();
    });

    it('1.4 should handle rapid dynamic transitions between empty, single-point, and multi-point tracks', () => {
      const map = (component as any).map;

      expect(() => {
        // Transition 1: Clear to empty
        mockRouteService.trackPoints.set([]);
        fixture.detectChanges();
        expect((component as any).routeLineMain).toBeNull();

        // Transition 2: Single 2-element point
        mockRouteService.trackPoints.set([[51.16, -115.56]]);
        fixture.detectChanges();
        expect((component as any).routeLineMain).toBeNull();

        // Transition 3: Back to multi-point track
        mockRouteService.trackPoints.set(sampleTrack);
        fixture.detectChanges();
        expect((component as any).routeLineMain).not.toBeNull();
        expect(map.getSource('route-source')).toBeTruthy();

        // Transition 4: Single 5-element point
        mockRouteService.trackPoints.set([[50.0, -114.0, 1200, 0.0, 0.0]]);
        fixture.detectChanges();
        expect((component as any).routeLineMain).toBeNull();

        // Transition 5: Empty again
        mockRouteService.trackPoints.set([]);
        fixture.detectChanges();
        expect((component as any).routeLineMain).toBeNull();
      }).not.toThrow();
    });
  });

  // =========================================================================
  // TARGET 2: Rider location outside bounds or null
  // =========================================================================
  describe('Target 2: Rider location outside bounds or null', () => {
    it('2.1 should not crash when currentMile is negative or far exceeds route total', () => {
      const map = (component as any).map;
      const initialPanCalls = map.panToCalls.length;

      // Negative mile: should clamp/find closest (start of route)
      expect(() => {
        fixture.componentRef.setInput('currentMile', -100);
        fixture.detectChanges();
      }).not.toThrow();

      expect(component.riderLocation()).toEqual([51.16, -115.56, 1400]);
      expect(map.panToCalls.length).toBeGreaterThan(initialPanCalls);

      // Huge mile far beyond route: should find closest (end of route)
      expect(() => {
        fixture.componentRef.setInput('currentMile', 999999);
        fixture.detectChanges();
      }).not.toThrow();

      expect(component.riderLocation()).toEqual([50.60, -115.08, 1930]);
    });

    it('2.2 should not crash map panning when riderLocation is null (empty track)', () => {
      mockRouteService.trackPoints.set([]);
      fixture.detectChanges();

      const map = (component as any).map;
      const panCallsBefore = map.panToCalls.length;

      expect(component.riderLocation()).toBeNull();

      expect(() => {
        fixture.componentRef.setInput('currentMile', 25);
        fixture.detectChanges();
      }).not.toThrow();

      // With null riderLocation, no invalid panTo should be triggered
      expect(map.panToCalls.length).toBe(panCallsBefore);

      // centerOnRider should safely no-op
      expect(() => component.centerOnRider()).not.toThrow();
    });

    it('2.3 should safely handle extreme / polar coordinates without throwing', () => {
      const extremeTrack = [
        [89.5, 179.5, 0, 0.0, 0.0],
        [-89.5, -179.5, 0, 20000.0, 12000.0]
      ];

      expect(() => {
        mockRouteService.trackPoints.set(extremeTrack);
        fixture.detectChanges();
        fixture.componentRef.setInput('currentMile', 0);
        fixture.detectChanges();
        component.centerOnRider();
      }).not.toThrow();

      const loc = component.riderLocation();
      expect(loc).toEqual([89.5, 179.5, 0]);
    });
  });

  // =========================================================================
  // TARGET 3: GPS state changes
  // =========================================================================
  describe('Target 3: GPS state changes', () => {
    it('3.1 should handle null GPS state without rendering GPS marker or projection line', () => {
      fixture.componentRef.setInput('gpsState', null);
      fixture.detectChanges();

      expect((component as any).gpsMarker).toBeNull();
      expect((component as any).projectionLine).toBeNull();
    });

    it('3.2 should handle disabled GPS state by removing any existing GPS markers or lines', () => {
      // First enable GPS
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

      expect((component as any).gpsMarker).not.toBeNull();
      expect((component as any).projectionLine).not.toBeNull();

      // Now disable GPS
      fixture.componentRef.setInput('gpsState', {
        enabled: false,
        loading: false,
        lastUpdated: new Date(),
        latitude: 51.16,
        longitude: -115.56,
        accuracyMeters: 5,
        error: null,
        projection: null
      });
      fixture.detectChanges();

      expect((component as any).gpsMarker).toBeNull();
      expect((component as any).projectionLine).toBeNull();
    });

    it('3.3 should render blue dashed projection line for valid on-route GPS fix', () => {
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        loading: false,
        lastUpdated: new Date(),
        latitude: 51.15,
        longitude: -115.55,
        accuracyMeters: 8,
        error: null,
        projection: {
          nearestPoint: [51.16, -115.56, 1400],
          nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
          projectedRouteMile: 0.0,
          projectedRouteKm: 0.0,
          distanceMiles: 0.8,
          distanceKm: 1.3,
          isOffRoute: false
        }
      });
      fixture.detectChanges();

      const map = (component as any).map;
      const projLayer = map.getLayer('gps-projection-line');
      expect(projLayer).toBeTruthy();
      expect(projLayer.paint['line-color']).toBe('#38bdf8'); // Sky blue for on-route
      expect(projLayer.paint['line-dasharray']).toEqual([2, 2]);

      const projSource = map.getSource('gps-projection-source');
      expect(projSource).toBeTruthy();
      expect(projSource.data.geometry.coordinates).toEqual([
        [-115.55, 51.15],
        [-115.56, 51.16]
      ]);
    });

    it('3.4 should render rose dashed line and pan map when GPS is miles off route', () => {
      const map = (component as any).map;
      const panCallsBefore = map.panToCalls.length;

      // 45 km off-route fix
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        loading: false,
        lastUpdated: new Date(),
        latitude: 51.80,
        longitude: -116.50,
        accuracyMeters: 15,
        error: null,
        projection: {
          nearestPoint: [51.16, -115.56, 1400],
          nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
          projectedRouteMile: 0.0,
          projectedRouteKm: 0.0,
          distanceMiles: 28.0,
          distanceKm: 45.0,
          isOffRoute: true // > 10 km off route
        }
      });
      fixture.detectChanges();

      const projLayer = map.getLayer('gps-projection-line');
      expect(projLayer).toBeTruthy();
      expect(projLayer.paint['line-color']).toBe('#f43f5e'); // Rose/red for off-route

      // Verify map panned to off-route GPS position
      expect(map.panToCalls.length).toBeGreaterThan(panCallsBefore);
      const lastPan = map.panToCalls[map.panToCalls.length - 1];
      expect(lastPan.coords).toEqual([-116.50, 51.80]);
    });

    it('3.5 should handle rapid GPS transitions between on-route, off-route, and null', () => {
      const map = (component as any).map;

      expect(() => {
        // Step 1: On-route
        fixture.componentRef.setInput('gpsState', {
          enabled: true,
          latitude: 51.16,
          longitude: -115.56,
          projection: {
            nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
            isOffRoute: false
          }
        });
        fixture.detectChanges();
        expect(map.getLayer('gps-projection-line').paint['line-color']).toBe('#38bdf8');

        // Step 2: Off-route
        fixture.componentRef.setInput('gpsState', {
          enabled: true,
          latitude: 52.00,
          longitude: -116.00,
          projection: {
            nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
            isOffRoute: true
          }
        });
        fixture.detectChanges();
        expect(map.getLayer('gps-projection-line').paint['line-color']).toBe('#f43f5e');

        // Step 3: Transition to null
        fixture.componentRef.setInput('gpsState', null);
        fixture.detectChanges();
        expect((component as any).gpsMarker).toBeNull();
        expect(map.getLayer('gps-projection-line')).toBeUndefined();

        // Step 4: Re-enable on-route
        fixture.componentRef.setInput('gpsState', {
          enabled: true,
          latitude: 51.10,
          longitude: -115.50,
          projection: {
            nearestPointOnTrail: { lat: 51.10, lon: -115.50, ele: 1500 },
            isOffRoute: false
          }
        });
        fixture.detectChanges();
        expect((component as any).gpsMarker).not.toBeNull();
        expect(map.getLayer('gps-projection-line').paint['line-color']).toBe('#38bdf8');
      }).not.toThrow();
    });

    it('3.6 should inspect projection behavior when GPS is enabled but projection is missing', () => {
      // Set valid GPS fix with projection first
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        latitude: 51.16,
        longitude: -115.56,
        projection: {
          nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
          isOffRoute: false
        }
      });
      fixture.detectChanges();
      expect((component as any).projectionLine).not.toBeNull();

      // Now GPS position updates but projection calculation returned null (e.g. calculation pending)
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        latitude: 51.20,
        longitude: -115.60,
        projection: null
      });
      fixture.detectChanges();

      // GPS marker updated to new position
      expect((component as any).gpsMarker.getLngLat()).toEqual({ lng: -115.60, lat: 51.20 });
    });

    it('3.7 should remove stale projection line when gpsState.projection becomes null while GPS is enabled', () => {
      const map = (component as any).map;

      // 1. Initial valid GPS with projection line
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        latitude: 51.16,
        longitude: -115.56,
        projection: {
          nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
          isOffRoute: false
        }
      });
      fixture.detectChanges();

      expect(map.getLayer('gps-projection-line')).toBeTruthy();

      // 2. New GPS update where projection is null
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        latitude: 51.20,
        longitude: -115.60,
        projection: null
      });
      fixture.detectChanges();

      // The projection line should be removed because projection is null
      expect(map.getLayer('gps-projection-line')).toBeUndefined();
    });
  });

  // =========================================================================
  // TARGET 4: Rapid category filtering
  // =========================================================================
  describe('Target 4: Rapid category filtering', () => {
    it('4.1 should correctly filter POI markers according to category specification', () => {
      // All: 6 places
      component.setPoiFilter('all');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(6);

      // Hotel: 1 place
      component.setPoiFilter('hotel');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(1);

      // Campground: 1 place
      component.setPoiFilter('campground');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(1);

      // Bike shop: 1 place
      component.setPoiFilter('bike_shop');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(1);

      // Grocery: 1 place
      component.setPoiFilter('grocery');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(1);

      // Laundromat: 1 place
      component.setPoiFilter('laundromat');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(1);

      // Town: 1 place
      component.setPoiFilter('town');
      fixture.detectChanges();
      expect((component as any).poiMarkers.length).toBe(1);
    });

    it('4.2 should withstand rapid toggling of activePoiCategories without leaking DOM markers', () => {
      const categories = ['all', 'campground', 'hotel', 'bike_shop', 'grocery', 'laundromat', 'town'];
      const mapContainer = (component as any).map.getContainer();

      // Toggle 100 times rapidly
      for (let i = 0; i < 100; i++) {
        const cat = categories[i % categories.length];
        component.setPoiFilter(cat);
        fixture.detectChanges();
      }

      // End on 'hotel'
      component.setPoiFilter('hotel');
      fixture.detectChanges();

      const activeMarkers = (component as any).poiMarkers;
      expect(activeMarkers.length).toBe(1);

      // Ensure that older removed markers had their remove() method called
      const removedCount = mockMarkerInstances.filter((m) => m.removeCount > 0).length;
      expect(removedCount).toBeGreaterThan(100);

      // Ensure no orphaned marker DOM elements remain attached to container
      const poiDoms = mapContainer.querySelectorAll('.poi-pin-icon');
      expect(poiDoms.length).toBe(1);
    });

    it('4.3 should not accumulate duplicate window event listeners during rapid filtering', () => {
      let jumpCallCount = 0;
      component.selectMile.subscribe(() => {
        jumpCallCount++;
      });

      // Rapidly toggle filter 50 times
      for (let i = 0; i < 50; i++) {
        component.setPoiFilter(i % 2 === 0 ? 'all' : 'hotel');
        fixture.detectChanges();
      }

      // Dispatch jump event once
      window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: 10.0 }));

      // MUST only be received once, proving no listener leakage
      expect(jumpCallCount).toBe(1);
    });
  });

  // =========================================================================
  // TARGET 5: Lifecycle cleanup
  // =========================================================================
  describe('Target 5: Lifecycle cleanup', () => {
    it('5.1 should clean up window listeners, resize observer, and call map.remove() on ngOnDestroy', () => {
      const map = (component as any).map;
      expect(map).toBeTruthy();

      // Enable GPS to test GPS cleanup
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        latitude: 51.16,
        longitude: -115.56,
        projection: {
          nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
          isOffRoute: false
        }
      });
      fixture.detectChanges();

      let jumpEmitted = false;
      component.selectMile.subscribe(() => {
        jumpEmitted = true;
      });

      const resizeSpy = vi.spyOn(map, 'resize');

      // Trigger destruction
      component.ngOnDestroy();

      // 1. Map instance removed and nulled
      expect(map.removeCount).toBe(1);
      expect((component as any).map).toBeNull();

      // 2. ResizeObserver nulled
      expect((component as any).resizeObserver).toBeNull();

      // 3. Window event listeners removed
      window.dispatchEvent(new Event('resize'));
      expect(resizeSpy).not.toHaveBeenCalled();

      window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: 20.0 }));
      expect(jumpEmitted).toBe(false);

      window.dispatchEvent(new CustomEvent('td-jump-mile', { detail: 20.0 }));
      expect(jumpEmitted).toBe(false);

      // 4. Calling methods after destroy should be safe and not throw
      expect(() => component.centerOnRider()).not.toThrow();
      expect(() => component.fitFullRoute()).not.toThrow();
      expect(() => component.toggleMapStyle()).not.toThrow();
    });

    it('5.2 should verify whether gpsMarker is explicitly removed on ngOnDestroy', () => {
      // Enable GPS
      fixture.componentRef.setInput('gpsState', {
        enabled: true,
        latitude: 51.16,
        longitude: -115.56,
        projection: {
          nearestPointOnTrail: { lat: 51.16, lon: -115.56, ele: 1400 },
          isOffRoute: false
        }
      });
      fixture.detectChanges();

      const gpsMarkerInstance = (component as any).gpsMarker;
      expect(gpsMarkerInstance).not.toBeNull();

      component.ngOnDestroy();

      // Adversarial test: Does ngOnDestroy explicitly remove gpsMarker?
      // In RouteMapComponent line 199:
      // if (this.map) {
      //   this.clearRouteLayers();
      //   this.clearPoiMarkers();
      //   this.map.remove();
      //   this.map = null;
      // }
      // Notice: clearRouteLayers removes riderMarker, but gpsMarker is neither removed nor cleared in ngOnDestroy!
      expect(gpsMarkerInstance.removeCount).toBeGreaterThan(0);
    });

    it('5.3 should not crash if deferred 150ms setTimeout fires after component is destroyed', () => {
      vi.useFakeTimers();
      try {
        // Create new component instance
        const localFixture = TestBed.createComponent(RouteMapComponent);
        const localComp = localFixture.componentInstance;
        localFixture.detectChanges();

        // Destroy immediately before 150ms timer fires
        localComp.ngOnDestroy();

        // Advance timer by 200ms
        expect(() => {
          vi.advanceTimersByTime(200);
        }).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
