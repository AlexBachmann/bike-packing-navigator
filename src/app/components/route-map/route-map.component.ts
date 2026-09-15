import {
  ChangeDetectionStrategy,
  Component,
  AfterViewInit,
  OnDestroy,
  input,
  output,
  effect,
  ElementRef,
  viewChild,
  signal,
  computed,
  inject,
  untracked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as maplibregl from 'maplibre-gl';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { PmtilesStorageService } from '../../services/pmtiles-storage.service';
import { ToastService } from '../../services/toast.service';
import { Place, GpsState } from '../../models/waypoint.model';
import { MapStyle } from '../../models/settings.model';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';
import { RouteMapPoiFilterComponent } from './route-map-poi-filter.component';
import { RouteMapControlsComponent } from './route-map-controls.component';
import { RouteMapStatusPillComponent } from './route-map-status-pill.component';
import {
  getRasterBaselineStyle,
  getVectorStyleSpec,
  createTileLayer
} from './route-map-styles.helper';
import {
  getPoiIconConfig,
  filterPlaces,
  createPoiPopupHtml,
  createPoiMarkerElement,
  createRiderMarkerElement,
  createRiderPopupHtml,
  createGpsMarkerElement,
  PoiIconConfig
} from './route-map-poi.helper';

export { getRasterBaselineStyle, getVectorStyleSpec, createTileLayer } from './route-map-styles.helper';
export {
  getPoiIconConfig,
  filterPlaces,
  createPoiPopupHtml,
  createPoiMarkerElement,
  createRiderMarkerElement,
  createRiderPopupHtml,
  createGpsMarkerElement
} from './route-map-poi.helper';
export type { PoiIconConfig } from './route-map-poi.helper';

@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [
    CommonModule,
    RouteMapPoiFilterComponent,
    RouteMapControlsComponent,
    RouteMapStatusPillComponent
  ],
  templateUrl: './route-map.component.html',
  styleUrl: './route-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RouteMapComponent implements AfterViewInit, OnDestroy {
  readonly settings = inject(SettingsService);
  readonly pmtilesStorage = inject(PmtilesStorageService);
  readonly toast = inject(ToastService, { optional: true });

  // Inputs from shell
  readonly currentMile = input<number>(0);
  readonly unit = input<'miles' | 'km'>('miles');
  readonly gpsState = input<GpsState | null>(null);

  // Output event to change rider position
  readonly selectMile = output<number>();
  readonly jumpToMile = this.selectMile;

  // Map container reference
  readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  // Active map layer style ('dark' | 'topo') synced with persistent user settings
  readonly mapStyle = this.settings.mapStyle;

  // Map renderer status & offline PMTiles auto-detection
  readonly activeMapMode = signal<'vector' | 'raster'>('raster');
  readonly isVectorCached = signal<boolean>(false);

  readonly activeRouteId = computed(() => {
    const fromService = typeof this.routeService?.activeRouteId === 'function'
      ? this.routeService.activeRouteId()
      : (this.routeService as any)?.activeRouteId || null;
    return fromService || this.settings.selectedRouteKey() || null;
  });

  readonly isDownloading = computed(() => {
    const id = this.activeRouteId();
    return id ? this.pmtilesStorage.isDownloading(id) : false;
  });

  readonly downloadPercentage = computed(() => {
    const id = this.activeRouteId();
    return id ? this.pmtilesStorage.getDownloadProgress(id)?.percentage || 0 : 0;
  });

  readonly activeRouteSizeEstimate = computed(() => {
    const id = this.activeRouteId();
    return id ? this.pmtilesStorage.getEstimatedSize(id) : '~15 MB';
  });

  // Category filter for map POIs
  readonly activePoiFilter = signal<string>('all');
  readonly activePoiCategories = this.activePoiFilter;

  // Derived rider coordinate [lat, lon, ele]
  readonly riderLocation = computed(() => this.getCoordsForMile(this.currentMile()));

  private map: maplibregl.Map | null = null;
  private routeLineGlow: { id: string } | null = null;
  private routeLineMain: { id: string; getBounds: () => [[number, number], [number, number]] } | null = null;
  private riderMarker: maplibregl.Marker | null = null;
  private gpsMarker: maplibregl.Marker | null = null;
  private projectionLine: { id: string; setLatLngs: (coords: any) => void; setStyle: (style: any) => void } | null = null;
  private poiMarkers: maplibregl.Marker[] = [];
  private poiLayerGroup = {
    clearLayers: () => this.clearPoiMarkers(),
    getLayers: () => this.poiMarkers,
    addLayer: (m: maplibregl.Marker) => this.poiMarkers.push(m)
  };

  private resizeObserver: ResizeObserver | null = null;

  constructor(public readonly routeService: RouteDataService) {
    // Effect to update rider marker position whenever riderLocation changes
    effect(() => {
      const loc = this.riderLocation();
      const mile = this.currentMile();
      this.updateRiderMarker(mile);
    });

    // Effect to update GPS position and off-route line
    effect(() => {
      const gps = this.gpsState();
      this.updateGpsDisplay(gps);
    });

    // Effect to update POI markers when places load or filter changes
    effect(() => {
      const places = this.routeService.places();
      const filter = this.activePoiFilter();
      this.updatePoiMarkers(places, filter);
    });

    // Effect to update map when mapStyle setting changes
    effect(() => {
      const style = this.settings.mapStyle();
      if (this.map) {
        if (this.activeMapMode() === 'vector') {
          this.applyMapRenderer('vector');
        } else {
          this.setBaseTileLayer(style);
        }
      }
    });

    // Effect to react immediately to changes in settings.mapRenderer()
    effect(() => {
      const renderer = this.settings.mapRenderer();
      if (this.map) {
        this.checkRouteCacheAndApplyRenderer();
      }
    });

    // Effect to detect route changes and re-verify PMTiles cache & style
    effect(() => {
      const routeId = this.activeRouteId();
      if (this.map) {
        this.checkRouteCacheAndApplyRenderer();
      }
    });

    // Effect to reactively redraw route track when route changes, or clear layers when route unloaded
    effect(() => {
      const points = this.routeService.trackPoints();
      if (!this.map) return;

      if (points && points.length >= 2) {
        this.drawRoute();
      } else {
        this.clearRouteLayers();
      }
      untracked(() => {
        this.updateRiderMarker(this.currentMile());
      });
    });
  }

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;

    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    this.initMap(container);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
      window.removeEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.removeEventListener('td-jump-mile', this.handlePopupJump as EventListener);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.gpsMarker) {
      this.gpsMarker.remove();
      this.gpsMarker = null;
    }
    this.clearProjectionLine();
    if (this.map) {
      this.clearRouteLayers();
      this.clearPoiMarkers();
      this.map.remove();
      this.map = null;
    }
  }

  private handleWindowResize = (): void => {
    this.map?.resize();
  };

  private initMap(container: HTMLElement): void {
    if (typeof maplibregl !== 'undefined' && typeof maplibregl.setWorkerUrl === 'function') {
      maplibregl.setWorkerUrl(resolveBaseHref('/maplibre-gl-worker.mjs'));
    }

    const points = this.routeService.trackPoints();
    const initialCoords = this.getCoordsForMile(this.currentMile());
    // MapLibre GL center coordinates order: [longitude, latitude]
    let initialCenter: [number, number] = [-115.56, 51.16];
    if (initialCoords) {
      initialCenter = [initialCoords[1], initialCoords[0]];
    } else if (points && points.length > 0) {
      initialCenter = [points[0][1], points[0][0]];
    }
    const initialZoom = this.settings.mapZoomLevel() || 8;

    const routeId = this.activeRouteId();
    const isCached = routeId ? this.pmtilesStorage.isRouteCachedSync(routeId) : false;
    this.isVectorCached.set(isCached);

    const initialMode: 'vector' | 'raster' = (isCached && this.settings.mapRenderer() === 'auto') ? 'vector' : 'raster';
    this.activeMapMode.set(initialMode);

    const style = getRasterBaselineStyle(this.mapStyle());

    const map = new maplibregl.Map({
      container,
      style,
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false
    });
    this.map = map;

    // Zoom controls in top-right
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Adapt flyTo to support both MapLibre ({ center, zoom }) and positional calls ([lon, lat], zoom, opts)
    const originalFlyTo = map.flyTo.bind(map);
    map.flyTo = ((arg1: any, arg2?: any, arg3?: any) => {
      if (Array.isArray(arg1) || (typeof arg1 === 'object' && arg1 !== null && 'lat' in arg1 && 'lng' in arg1)) {
        const center = Array.isArray(arg1) ? arg1 : [arg1.lng, arg1.lat];
        return originalFlyTo({
          center,
          zoom: typeof arg2 === 'number' ? arg2 : undefined,
          ...arg3
        });
      }
      return originalFlyTo(arg1);
    }) as any;

    // Persist zoom level changes when user zooms
    map.on('zoomend', () => {
      this.settings.setMapZoomLevel(Math.round(map.getZoom()));
    });

    const onReady = () => {
      if (this.activeMapMode() === 'raster') {
        this.setBaseTileLayer(this.mapStyle());
      }
      this.drawRoute(true);
      this.updateRiderMarker(this.currentMile());
      this.updatePoiMarkers(this.routeService.places(), this.activePoiFilter());
      this.updateGpsDisplay(this.gpsState());

      // Auto-detect PMTiles cache and switch seamlessly if ready
      this.checkRouteCacheAndApplyRenderer(true);
    };

    if (map.isStyleLoaded()) {
      onReady();
    } else {
      map.once('load', onReady);
    }

    // Window resize listener
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
    }

    // Dynamically watch container size and invalidate/resize map
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.map?.resize();
      });
      this.resizeObserver.observe(container);
    }

    // Trigger size resize to handle flexbox animations
    setTimeout(() => {
      this.map?.resize();
    }, 150);
  }

  toggleMapStyle(): void {
    this.settings.toggleMapStyle();
  }

  createTileLayer(url: string, options: any = {}): any {
    return createTileLayer(url, options);
  }

  async getVectorStyleSpec(style: MapStyle, routeId: string): Promise<maplibregl.StyleSpecification> {
    return getVectorStyleSpec(style, routeId, this.pmtilesStorage, this.isVectorCached());
  }

  async applyMapRenderer(mode: 'vector' | 'raster'): Promise<void> {
    if (!this.map) return;

    if (mode === 'vector') {
      const routeId = this.activeRouteId();
      if (!routeId) {
        return this.applyMapRenderer('raster');
      }

      try {
        const vectorStyle = await this.getVectorStyleSpec(this.settings.mapStyle(), routeId);
        if (typeof this.map.setStyle === 'function') {
          this.map.setStyle(vectorStyle);
        }
        this.activeMapMode.set('vector');
        this.reapplyOverlayLayersAfterStyleChange();
      } catch (err) {
        console.warn('[RouteMap] Vector loading failed, seamlessly falling back to raster tiles:', err);
        this.toast?.showWarning('Vector map failed to load, fell back to raster tiles');
        return this.applyMapRenderer('raster');
      }
    } else {
      const rasterStyle = getRasterBaselineStyle(this.settings.mapStyle());
      if (typeof this.map.setStyle === 'function') {
        this.map.setStyle(rasterStyle);
      }
      this.activeMapMode.set('raster');
      this.reapplyOverlayLayersAfterStyleChange();
    }
  }

  private reapplyOverlayLayersAfterStyleChange(): void {
    if (!this.map) return;
    const onStyleReady = () => {
      if (this.activeMapMode() === 'raster') {
        this.setBaseTileLayer(this.settings.mapStyle());
      }
      this.drawRoute(true);
      this.updateRiderMarker(this.currentMile());
      this.updateGpsDisplay(this.gpsState());
      this.updatePoiMarkers(this.routeService.places(), this.activePoiFilter());
    };

    let executed = false;
    const onReady = () => {
      if (executed) return;
      executed = true;
      if (this.map) {
        this.map.off('style.load', onReady);
        this.map.off('styledata', onReady);
        this.map.off('load', onReady);
      }
      onStyleReady();
    };

    this.map.once('style.load', onReady);
    this.map.once('styledata', onReady);
    this.map.once('load', onReady);
  }

  async checkRouteCacheAndApplyRenderer(forceStyleReload = false): Promise<void> {
    const routeId = this.activeRouteId();
    const cached = routeId ? await this.pmtilesStorage.isRouteCached(routeId) : false;
    this.isVectorCached.set(cached);

    const rendererPref = this.settings.mapRenderer();
    const targetMode: 'vector' | 'raster' = (cached && rendererPref === 'auto') ? 'vector' : 'raster';
    const currentMode = this.activeMapMode();

    if (targetMode !== currentMode || forceStyleReload) {
      await this.applyMapRenderer(targetMode);
    } else if (targetMode === 'raster') {
      this.setBaseTileLayer(this.settings.mapStyle());
    }
  }

  async downloadActiveRouteVector(): Promise<void> {
    const routeId = this.activeRouteId();
    if (!routeId) return;

    try {
      await this.pmtilesStorage.downloadRoute(routeId);
      this.isVectorCached.set(true);
      if (this.settings.mapRenderer() === 'auto') {
        await this.applyMapRenderer('vector');
        this.toast?.showSuccess('Vector map downloaded and active!');
      } else {
        this.toast?.showSuccess('Vector map downloaded (forced raster mode active in Settings)');
      }
    } catch (err) {
      console.error('[RouteMap] Failed to download vector map:', err);
      this.toast?.showError('Failed to download vector map');
    }
  }

  private runWhenStyleLoaded(action: () => void): void {
    if (!this.map) return;
    if (this.map.isStyleLoaded()) {
      action();
      return;
    }

    let executed = false;
    const onReady = () => {
      if (executed) return;
      executed = true;
      if (this.map) {
        this.map.off('style.load', onReady);
        this.map.off('styledata', onReady);
        this.map.off('load', onReady);
      }
      action();
    };

    this.map.once('style.load', onReady);
    this.map.on('styledata', onReady);
    this.map.once('load', onReady);
  }

  private setBaseTileLayer(style: MapStyle): void {
    if (!this.map) return;
    if (!this.map.isStyleLoaded()) {
      this.runWhenStyleLoaded(() => this.setBaseTileLayer(style));
      return;
    }

    const isDark = style === 'dark';
    if (this.map.getLayer('esri-dark-base-layer')) {
      this.map.setLayoutProperty('esri-dark-base-layer', 'visibility', isDark ? 'visible' : 'none');
    }
    if (this.map.getLayer('esri-dark-ref-layer')) {
      this.map.setLayoutProperty('esri-dark-ref-layer', 'visibility', isDark ? 'visible' : 'none');
    }
    if (this.map.getLayer('esri-topo-layer')) {
      this.map.setLayoutProperty('esri-topo-layer', 'visibility', isDark ? 'none' : 'visible');
    }
  }

  clearRouteLayers(): void {
    if (this.map) {
      try {
        if (this.map.getLayer('route-glow')) {
          this.map.removeLayer('route-glow');
        }
        if (this.map.getLayer('route-main')) {
          this.map.removeLayer('route-main');
        }
        if (this.map.getSource('route-source')) {
          this.map.removeSource('route-source');
        }
      } catch {
        // Style may not be ready or layer already removed
      }
    }
    this.routeLineGlow = null;
    this.routeLineMain = null;
    if (this.riderMarker) {
      this.riderMarker.remove();
      this.riderMarker = null;
    }
  }

  clearProjectionLine(): void {
    if (this.map) {
      try {
        if (this.map.getLayer('gps-projection-line')) {
          this.map.removeLayer('gps-projection-line');
        }
        if (this.map.getSource('gps-projection-source')) {
          this.map.removeSource('gps-projection-source');
        }
      } catch {
        // Style may not be ready or layer already removed
      }
    }
    this.projectionLine = null;
  }

  private getRouteBounds(): [[number, number], [number, number]] {
    const points = this.routeService.trackPoints();
    if (!points || points.length === 0) {
      return [[-180, -90], [180, 90]];
    }
    let minLat = points[0][0], maxLat = points[0][0];
    let minLon = points[0][1], maxLon = points[0][1];
    for (const p of points) {
      if (p[0] < minLat) minLat = p[0];
      if (p[0] > maxLat) maxLat = p[0];
      if (p[1] < minLon) minLon = p[1];
      if (p[1] > maxLon) maxLon = p[1];
    }
    // In MapLibre GL, bounds format: [[minLon, minLat], [maxLon, maxLat]]
    return [[minLon, minLat], [maxLon, maxLat]];
  }

  drawRoute(force = false): void {
    if (!this.map) return;
    if (!force && !this.map.isStyleLoaded()) {
      this.runWhenStyleLoaded(() => this.drawRoute(true));
      return;
    }

    const points = this.routeService.trackPoints();
    if (!points || points.length < 2) {
      this.clearRouteLayers();
      return;
    }

    // Convert [lat, lon, ele, cum_km, cum_mi] to MapLibre GeoJSON coordinates [lon, lat]
    const coordinates: [number, number][] = points.map((p) => [p[1], p[0]]);

    const geojson: any = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates
      }
    };

    try {
      const existingSource = this.map.getSource('route-source') as maplibregl.GeoJSONSource;
      if (!existingSource) {
        this.map.addSource('route-source', {
          type: 'geojson',
          data: geojson
        });
      } else {
        existingSource.setData(geojson);
      }

      if (!this.map.getLayer('route-glow')) {
        this.map.addLayer({
          id: 'route-glow',
          type: 'line',
          source: 'route-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#10b981',
            'line-width': 7,
            'line-opacity': 0.4,
            'line-blur': 3
          }
        });
      }

      if (!this.map.getLayer('route-main')) {
        this.map.addLayer({
          id: 'route-main',
          type: 'line',
          source: 'route-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#34d399',
            'line-width': 3.5,
            'line-opacity': 0.95
          }
        });
      }

      this.routeLineGlow = { id: 'route-glow' };
      this.routeLineMain = {
        id: 'route-main',
        getBounds: () => this.getRouteBounds()
      };
    } catch {
      this.runWhenStyleLoaded(() => this.drawRoute(true));
      return;
    }

    // Center dynamically on rider position or active route start coordinates, preserving user's zoom level
    if (points.length > 0) {
      const zoom = this.map.getZoom() || this.settings.mapZoomLevel() || 8;
      const riderCoords = this.getCoordsForMile(this.currentMile());
      const targetLonLat: [number, number] = riderCoords
        ? [riderCoords[1], riderCoords[0]]
        : [points[0][1], points[0][0]];
      this.map.setCenter(targetLonLat);
      this.map.setZoom(zoom);
    }
  }

  private updateRiderMarker(mile: number): void {
    if (!this.map) return;

    const coords = this.getCoordsForMile(mile);
    if (!coords) {
      if (this.riderMarker) {
        this.riderMarker.remove();
        this.riderMarker = null;
      }
      return;
    }

    const [lat, lon, ele] = coords;
    const popupContent = createRiderPopupHtml(mile, ele, this.unit());
    const lngLat: [number, number] = [lon, lat];

    if (!this.riderMarker) {
      const el = createRiderMarkerElement();

      const popup = new maplibregl.Popup({
        className: 'dark-maplibre-popup',
        offset: 15,
        closeButton: false
      }).setHTML(popupContent);

      this.riderMarker = new maplibregl.Marker({ element: el, anchor: 'center', subpixelPositioning: true })
        .setLngLat(lngLat)
        .setPopup(popup)
        .addTo(this.map);
    } else {
      this.riderMarker.setLngLat(lngLat);
      const popup = this.riderMarker.getPopup();
      if (popup) {
        popup.setHTML(popupContent);
      }
    }

    // Automatically pan map to rider position
    this.map.panTo(lngLat, { duration: 300 });
  }

  private updateGpsDisplay(gps: GpsState | null): void {
    if (!this.map) return;

    if (
      !gps ||
      !gps.enabled ||
      (gps as any).active === false ||
      gps.latitude === null ||
      gps.longitude === null
    ) {
      if (this.gpsMarker) {
        this.gpsMarker.remove();
        this.gpsMarker = null;
      }
      this.clearProjectionLine();
      return;
    }

    const gpsPos: [number, number] = [gps.longitude, gps.latitude];

    if (!this.gpsMarker) {
      const el = createGpsMarkerElement();
      this.gpsMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(gpsPos)
        .addTo(this.map);
    } else {
      this.gpsMarker.setLngLat(gpsPos);
    }

    // If off-route (> 10 km), recenter map on GPS position directly
    if (gps.projection?.isOffRoute) {
      this.map.panTo(gpsPos, { duration: 300 });
    }

    // Draw orthogonal projection dashed line connecting GPS position to route centerline
    if (gps.projection && gps.projection.nearestPointOnTrail) {
      if (!this.map.isStyleLoaded()) {
        this.runWhenStyleLoaded(() => this.updateGpsDisplay(this.gpsState()));
        return;
      }

      const trailPos: [number, number] = [
        gps.projection.nearestPointOnTrail.lon,
        gps.projection.nearestPointOnTrail.lat
      ];

      const isOff = gps.projection.isOffRoute;
      const lineColor = isOff ? '#f43f5e' : '#38bdf8';

      const projectionGeojson: any = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [gpsPos, trailPos]
        }
      };

      const existingSource = this.map.getSource('gps-projection-source') as maplibregl.GeoJSONSource;
      if (existingSource) {
        existingSource.setData(projectionGeojson);
        if (this.map.getLayer('gps-projection-line')) {
          this.map.setPaintProperty('gps-projection-line', 'line-color', lineColor);
        }
      } else {
        this.map.addSource('gps-projection-source', {
          type: 'geojson',
          data: projectionGeojson
        });

        this.map.addLayer({
          id: 'gps-projection-line',
          type: 'line',
          source: 'gps-projection-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': lineColor,
            'line-width': 2.5,
            'line-opacity': 0.9,
            'line-dasharray': [2, 2]
          }
        });
      }

      this.projectionLine = {
        id: 'gps-projection-line',
        setLatLngs: (coords: any) => {
          const source = this.map?.getSource('gps-projection-source') as maplibregl.GeoJSONSource;
          if (source) {
            const p1 = coords[0];
            const p2 = coords[1];
            source.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  Array.isArray(p1) ? (p1[0] > 0 && p1[1] < 0 ? [p1[1], p1[0]] : [p1[0], p1[1]]) : [p1.lng || p1.lon, p1.lat],
                  Array.isArray(p2) ? (p2[0] > 0 && p2[1] < 0 ? [p2[1], p2[0]] : [p2[0], p2[1]]) : [p2.lng || p2.lon, p2.lat]
                ]
              }
            });
          }
        },
        setStyle: (style: any) => {
          if (style.color && this.map?.getLayer('gps-projection-line')) {
            this.map.setPaintProperty('gps-projection-line', 'line-color', style.color);
          }
        }
      };
    } else {
      this.clearProjectionLine();
    }
  }

  private updatePoiMarkers(places: Place[], filterCategory: string): void {
    if (!this.map) return;

    this.clearPoiMarkers();
    if (!places || places.length === 0) return;

    const filtered = filterPlaces(places, filterCategory);

    for (const place of filtered) {
      const iconConfig = getPoiIconConfig(place);
      const popupHtml = createPoiPopupHtml(place, iconConfig, this.unit());

      const lat = place.location?.lat;
      const lon = place.location?.lon;
      if (lat === undefined || lon === undefined) continue;

      const el = createPoiMarkerElement(iconConfig);

      const popup = new maplibregl.Popup({
        className: 'dark-maplibre-popup',
        offset: 15,
        closeButton: true,
        closeOnClick: false
      }).setHTML(popupHtml);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(this.map);

      this.poiMarkers.push(marker);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.removeEventListener('td-jump-mile', this.handlePopupJump as EventListener);
      window.addEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.addEventListener('td-jump-mile', this.handlePopupJump as EventListener);
    }
  }

  private clearPoiMarkers(): void {
    for (const marker of this.poiMarkers) {
      marker.remove();
    }
    this.poiMarkers = [];
  }

  private handlePopupJump = (e: CustomEvent<number>): void => {
    if (typeof e.detail === 'number') {
      this.selectMile.emit(e.detail);
      const popups = document.querySelectorAll('.maplibregl-popup');
      popups.forEach((p) => p.remove());
    }
  };

  getPoiIconConfig(place: Place): PoiIconConfig {
    return getPoiIconConfig(place);
  }

  private getCoordsForMile(targetMile: number): [number, number, number] | null {
    const points = this.routeService.trackPoints();
    if (!points || points.length === 0) return null;

    let closest = points[0];
    let minDiff = Math.abs(points[0][4] - targetMile);

    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i][4] - targetMile);
      if (diff < minDiff) {
        minDiff = diff;
        closest = points[i];
      }
    }

    return [closest[0], closest[1], closest[2]];
  }

  centerOnRider(): void {
    if (!this.map) return;
    const coords = this.getCoordsForMile(this.currentMile());
    if (coords) {
      const currentZoom = this.map.getZoom() || this.settings.mapZoomLevel() || 10;
      (this.map as any).flyTo([coords[1], coords[0]], currentZoom, { duration: 500 });
    }
  }

  fitFullRoute(): void {
    if (!this.map || !this.routeLineMain) return;
    const bounds = this.routeLineMain.getBounds();
    this.map.fitBounds(bounds as any, { padding: 30 });
  }

  setPoiFilter(category: string): void {
    this.activePoiFilter.set(category);
  }
}
