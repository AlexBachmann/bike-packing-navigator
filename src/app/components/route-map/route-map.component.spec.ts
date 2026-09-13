import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RouteMapComponent } from './route-map.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

describe('RouteMapComponent', () => {
  let component: RouteMapComponent;
  let fixture: ComponentFixture<RouteMapComponent>;
  let mockRouteService: Partial<RouteDataService>;

  beforeEach(async () => {
    mockRouteService = {
      totalDistanceMiles: 2679.2,
      totalDistanceKm: 4311.8,
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
    // Update trackPoints signal to Colorado Trail points
    (mockRouteService.trackPoints as any).set([
      [39.49, -105.09, 1670, 0.0, 0.0],
      [39.40, -105.15, 1750, 16.0, 10.0]
    ]);
    fixture.detectChanges();

    // Map should still exist and drawRoute executed without errors
    expect(component).toBeTruthy();
  });

  it('should remove route polylines when trackPoints becomes empty (route unloaded)', () => {
    // Initially trackPoints has 3 points, so polylines exist
    expect((component as any).routeLineGlow).not.toBeNull();
    expect((component as any).routeLineMain).not.toBeNull();

    // Now unload route by setting trackPoints to []
    (mockRouteService.trackPoints as any).set([]);
    fixture.detectChanges();

    // Both polylines should be cleared and nulled
    expect((component as any).routeLineGlow).toBeNull();
    expect((component as any).routeLineMain).toBeNull();
  });

  it('should clear polylines when trackPoints has fewer than 2 points', () => {
    expect((component as any).routeLineMain).not.toBeNull();

    // 1 point is insufficient for a valid polyline
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

    // Simulate zoom change
    map.setZoom(12);
    map.fire('zoomend');

    expect(settingsService.mapZoomLevel()).toBe(12);
  });

  it('should preserve zoom level when rider position changes', () => {
    const map = (component as any).map;
    expect(map).toBeTruthy();

    map.setZoom(14);
    expect(map.getZoom()).toBe(14);

    // Change rider position
    fixture.componentRef.setInput('currentMile', 25.0);
    fixture.detectChanges();

    // Zoom level must remain unchanged
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
});
