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
import { Place, GpsState, isSelfServiceWaschsalon } from '../../models/waypoint.model';
import { MapStyle } from '../../models/settings.model';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';

export function getRasterBaselineStyle(style: MapStyle): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      'esri-dark-base': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        maxzoom: 16
      },
      'esri-dark-ref': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        maxzoom: 16
      },
      'esri-topo': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        maxzoom: 16
      }
    },
    layers: [
      {
        id: 'esri-dark-base-layer',
        type: 'raster',
        source: 'esri-dark-base',
        minzoom: 0,
        maxzoom: 22,
        layout: {
          visibility: style === 'dark' ? 'visible' : 'none'
        }
      },
      {
        id: 'esri-dark-ref-layer',
        type: 'raster',
        source: 'esri-dark-ref',
        minzoom: 0,
        maxzoom: 22,
        layout: {
          visibility: style === 'dark' ? 'visible' : 'none'
        }
      },
      {
        id: 'esri-topo-layer',
        type: 'raster',
        source: 'esri-topo',
        minzoom: 0,
        maxzoom: 22,
        layout: {
          visibility: style === 'topo' ? 'visible' : 'none'
        }
      }
    ]
  };
}

export async function getVectorStyleSpec(
  style: MapStyle,
  routeId: string,
  pmtilesStorage: PmtilesStorageService,
  isCached?: boolean
): Promise<maplibregl.StyleSpecification> {
  const cached = isCached ?? pmtilesStorage.isRouteCachedSync(routeId);
  const pmtilesUrl = pmtilesStorage.resolveTileUrl(routeId);
  const styleUrl = resolveBaseHref(`/assets/styles/vector-${style}.json`);
  try {
    const res = await fetch(styleUrl);
    if (res.ok) {
      const spec = await res.json();
      if (spec && spec.sources && spec.sources.openmaptiles) {
        spec.sources.openmaptiles.url = cached ? pmtilesUrl : 'https://tiles.openfreemap.org/planet';
      }
      return spec;
    }
  } catch {
    // Fallback in test/offline environment
  }

  return {
    version: 8,
    name: `Bikepack Vector ${style}`,
    sources: {
      openmaptiles: {
        type: 'vector',
        url: cached ? pmtilesUrl : 'https://tiles.openfreemap.org/planet'
      }
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': style === 'dark' ? '#0b0f19' : '#f8fafc'
        }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: {
          'fill-color': style === 'dark' ? '#1e293b' : '#bae6fd'
        }
      },
      {
        id: 'roads',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        paint: {
          'line-color': style === 'dark' ? '#475569' : '#94a3b8',
          'line-width': 1.5
        }
      },
      {
        id: 'corridor-boundary',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: {
          'fill-color': style === 'dark' ? '#064e3b' : '#10b981',
          'fill-opacity': style === 'dark' ? 0.15 : 0.06
        }
      }
    ]
  };
}

@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [CommonModule],
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
    const tileOptions = {
      maxZoom: 16,
      maxNativeZoom: 16,
      ...options
    };

    if (typeof window !== 'undefined' && 'caches' in window && typeof document !== 'undefined') {
      const handlers: { [event: string]: ((data?: any) => void)[] } = {};
      const layer = {
        url,
        options: tileOptions,
        on(event: string, fn: (data?: any) => void) {
          handlers[event] = handlers[event] || [];
          handlers[event].push(fn);
          return this;
        },
        fire(event: string, data: any) {
          if (handlers[event]) {
            handlers[event].forEach((h) => h(data));
          }
        },
        createTile(coords: { x: number; y: number; z: number }, done: (err: any, tile: any) => void): HTMLElement {
          const tile = document.createElement('img');
          const tileUrl = url
            .replace('{z}', String(coords.z))
            .replace('{x}', String(coords.x))
            .replace('{y}', String(coords.y));

          const setTileBlob = (blob: Blob) => {
            const objectUrl = URL.createObjectURL(blob);
            let revoked = false;
            const cleanup = () => {
              if (!revoked) {
                revoked = true;
                URL.revokeObjectURL(objectUrl);
              }
            };
            (tile as any)._cleanup = cleanup;
            tile.onload = () => {
              cleanup();
              done(undefined, tile);
            };
            tile.onerror = (err) => {
              cleanup();
              done(err, tile);
            };
            tile.src = objectUrl;
          };

          const setTileUrl = (src: string) => {
            tile.onload = () => done(undefined, tile);
            tile.onerror = (err) => done(err, tile);
            tile.src = src;
          };

          window.caches.open('bikepack-map-tiles-v1').then((cache) => {
            cache.match(tileUrl).then((cachedResponse) => {
              if (cachedResponse) {
                cachedResponse.blob()
                  .then((blob) => setTileBlob(blob))
                  .catch(() => setTileUrl(tileUrl));
              } else {
                fetch(tileUrl, { mode: 'cors' })
                  .then((res) => {
                    if (res.ok) {
                      cache.put(tileUrl, res.clone()).catch(() => {});
                      return res.blob();
                    }
                    throw new Error('Tile network error');
                  })
                  .then((blob) => setTileBlob(blob))
                  .catch(() => {
                    setTileUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
                  });
              }
            }).catch(() => setTileUrl(tileUrl));
          }).catch(() => setTileUrl(tileUrl));

          return tile;
        }
      };

      layer.on('tileunload', (e: any) => {
        if (e.tile && typeof e.tile._cleanup === 'function') {
          e.tile._cleanup();
        }
      });

      return layer;
    }

    return { url, options: tileOptions };
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
    const isMiles = this.unit() === 'miles';
    const distText = isMiles ? `Mile ${mile.toFixed(1)}` : `KM ${(mile * 1.60934).toFixed(1)}`;
    const eleText = isMiles ? `${Math.round(ele * 3.28084).toLocaleString()} ft` : `${Math.round(ele).toLocaleString()} m`;

    const popupContent = `
      <div style="font-family: ui-monospace, SFMono-Regular, monospace; min-width: 140px; padding: 4px;">
        <div style="font-weight: 700; color: #34d399; font-size: 12px;">Rider Position</div>
        <div style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-top: 2px;">${distText}</div>
        <div style="font-size: 11px; color: #94a3b8;">Elevation: ${eleText}</div>
      </div>
    `;

    const lngLat: [number, number] = [lon, lat];

    if (!this.riderMarker) {
      const el = document.createElement('div');
      el.className = 'rider-maplibre-icon';
      el.innerHTML = `
        <div class="relative flex items-center justify-center w-8 h-8 cursor-pointer">
          <div class="absolute w-7 h-7 rounded-full bg-emerald-400/40 animate-ping"></div>
          <div class="relative w-7 h-7 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center justify-center text-xs shadow-emerald-950">
            🚴
          </div>
        </div>
      `;

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
      const el = document.createElement('div');
      el.className = 'gps-maplibre-icon';
      el.innerHTML = `
        <div class="relative flex items-center justify-center w-7 h-7">
          <div class="absolute w-6 h-6 rounded-full bg-blue-500/40 animate-ping"></div>
          <div class="relative w-5 h-5 rounded-full bg-blue-500 border-2 border-white shadow-md flex items-center justify-center text-[10px]">
            📍
          </div>
        </div>
      `;
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

    const filtered = places.filter((p) => {
      const isCamp = p.category === 'campground' || /recreation site|rec site/i.test(p.name);
      const isHotel = p.category === 'hotel' && !isCamp;

      if (filterCategory === 'all') return true;
      if (filterCategory === 'town' && (p.category === 'town' || p.type === 'locality')) return true;
      if (filterCategory === 'bike_shop' && p.category === 'bike_shop') return true;
      if (filterCategory === 'grocery' && (p.category === 'grocery' || p.category === 'gas_station' || p.category === 'water')) return true;
      if (filterCategory === 'campground' && isCamp) return true;
      if (filterCategory === 'hotel' && isHotel) return true;
      if (filterCategory === 'laundromat' && (p.category === 'laundromat' || p.category === 'laundry')) {
        return isSelfServiceWaschsalon(p.name);
      }
      return false;
    });

    for (const place of filtered) {
      const iconConfig = this.getPoiIconConfig(place);
      const isMiles = this.unit() === 'miles';
      const mileText = isMiles ? `Mile ${place.route_mile.toFixed(1)}` : `KM ${place.route_km.toFixed(1)}`;
      const offRouteText = place.distance_to_trail_km > 0.1
        ? (isMiles ? `${(place.distance_to_trail_km * 0.621371).toFixed(1)} mi off route` : `${place.distance_to_trail_km.toFixed(1)} km off route`)
        : 'On Route';

      const popupHtml = `
        <div style="font-family: ui-monospace, SFMono-Regular, monospace; min-width: 180px; padding: 4px;">
          <div style="font-size: 10px; text-transform: uppercase; color: ${iconConfig.badgeColor}; font-weight: 700; letter-spacing: 0.05em;">
            ${iconConfig.emoji} ${iconConfig.label}
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #ffffff; margin-top: 2px; line-height: 1.25;">${place.name}</div>
          ${place.town ? `<div style="font-size: 11px; color: #cbd5e1; margin-top: 1px;">in ${place.town}${place.province_state ? ', ' + place.province_state : ''}</div>` : ''}
          <div style="font-size: 10px; color: #94a3b8; margin-top: 4px; line-height: 1.25;">
            ${iconConfig.description}
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; border-top: 1px solid #334155; padding-top: 4px;">
            <span style="color: #34d399; font-weight: 600;">${mileText}</span>
            <span style="color: #94a3b8;">${offRouteText}</span>
          </div>
          <button
            onclick="window.dispatchEvent(new CustomEvent('bpn-jump-mile', { detail: ${place.route_mile} }))"
            style="width: 100%; margin-top: 8px; padding: 4px 8px; background: #10b981; color: #022c22; font-weight: 700; font-size: 11px; border: none; border-radius: 6px; cursor: pointer;"
          >
            Jump Rider Here ↳
          </button>
        </div>
      `;

      const lat = place.location?.lat;
      const lon = place.location?.lon;
      if (lat === undefined || lon === undefined) continue;

      const el = document.createElement('div');
      el.className = 'poi-pin-icon';
      el.innerHTML = `
        <div class="w-6 h-6 rounded-full ${iconConfig.bg} border border-slate-900 shadow-md flex items-center justify-center text-[11px] cursor-pointer hover:scale-125 transition-transform">
          ${iconConfig.emoji}
        </div>
      `;

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

  private getPoiIconConfig(place: Place): { emoji: string; bg: string; label: string; badgeColor: string; description: string } {
    const isRecSite = /recreation site|rec site/i.test(place.name);

    if (isRecSite || place.category === 'campground') {
      return {
        emoji: '⛺',
        bg: 'bg-teal-600',
        label: isRecSite ? 'Recreation Site' : 'Campground',
        badgeColor: '#14b8a6',
        description: isRecSite
          ? '🌲 Primitive camping • Free / low-cost • Pit toilet • No showers'
          : '⛺ Outdoor camping • Tent & RV sites • Low cost'
      };
    }

    if (place.category === 'hotel') {
      const typeName = place.type
        ? place.type.charAt(0).toUpperCase() + place.type.slice(1).replace('_', ' ')
        : 'Lodging';
      return {
        emoji: '🏨',
        bg: 'bg-purple-600',
        label: typeName,
        badgeColor: '#c084fc',
        description: '🛏️ Indoor lodging • Bed, hot shower, roof & power'
      };
    }

    switch (place.category) {
      case 'town':
        return {
          emoji: '🏘️',
          bg: 'bg-emerald-600',
          label: 'Town',
          badgeColor: '#10b981',
          description: 'Resupply town with services'
        };
      case 'bike_shop':
        return {
          emoji: '🚲',
          bg: 'bg-blue-600',
          label: 'Bike Shop',
          badgeColor: '#3b82f6',
          description: 'Repairs, parts, tubes & tools'
        };
      case 'grocery':
      case 'gas_station':
        return {
          emoji: '🛒',
          bg: 'bg-amber-600',
          label: place.category === 'gas_station' ? 'Gas / Store' : 'Grocery',
          badgeColor: '#f59e0b',
          description: 'Food & water resupply'
        };
      case 'food':
        return {
          emoji: '🍽️',
          bg: 'bg-orange-600',
          label: 'Dining',
          badgeColor: '#f97316',
          description: 'Restaurant, cafe or bakery'
        };
      case 'laundromat':
      case 'laundry':
        return {
          emoji: '🧺',
          bg: 'bg-indigo-600',
          label: 'Laundry',
          badgeColor: '#6366f1',
          description: 'Laundromat & laundry services'
        };
      case 'water':
        return {
          emoji: '💧',
          bg: 'bg-cyan-600',
          label: 'Water',
          badgeColor: '#06b6d4',
          description: 'Water source / Cache'
        };
      default:
        return {
          emoji: '📍',
          bg: 'bg-slate-700',
          label: place.category,
          badgeColor: '#94a3b8',
          description: 'Checkpoint'
        };
    }
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
