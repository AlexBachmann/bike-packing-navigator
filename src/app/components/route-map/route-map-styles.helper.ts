import * as maplibregl from 'maplibre-gl';
import { MapStyle } from '../../models/settings.model';
import { PmtilesStorageService } from '../../services/pmtiles-storage.service';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';

/**
 * Strategy A: Baseline raster basemap style specification for MapLibre GL.
 * Leverages Esri World Dark Gray Canvas and World Topo Map with native 256px tiles
 * and high-resolution maxzoom 16.
 */
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

/**
 * Strategy B: Vector MapLibre GL style specification using PMTiles vector archive
 * or online fallback tiles.
 */
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
        spec.sources.openmaptiles.maxzoom = 14;
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
        url: cached ? pmtilesUrl : 'https://tiles.openfreemap.org/planet',
        maxzoom: 14
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

/**
 * Creates a custom raster tile layer with browser CacheStorage integration and blob lifecycle cleanup.
 */
export function createTileLayer(url: string, options: any = {}): any {
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
