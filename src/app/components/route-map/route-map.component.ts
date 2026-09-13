import { ChangeDetectionStrategy, Component, AfterViewInit, OnDestroy, input, output, effect, ElementRef, viewChild, signal, inject, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { Place, GpsState, isSelfServiceWaschsalon } from '../../models/waypoint.model';
import { MapStyle } from '../../models/settings.model';

@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './route-map.component.html',
  styleUrl: './route-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RouteMapComponent implements AfterViewInit, OnDestroy {
  private readonly settings = inject(SettingsService);

  // Inputs from shell
  readonly currentMile = input<number>(0);
  readonly unit = input<'miles' | 'km'>('miles');
  readonly gpsState = input<GpsState | null>(null);

  // Output event to change rider position
  readonly selectMile = output<number>();

  // Map container reference
  readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  // Active map layer style ('dark' | 'topo') synced with persistent user settings
  readonly mapStyle = this.settings.mapStyle;

  // Category filter for map POIs
  readonly activePoiFilter = signal<string>('all');

  private map: L.Map | null = null;
  private tileLayer: L.TileLayer | null = null;
  private referenceLayer: L.TileLayer | null = null;
  private routeLineGlow: L.Polyline | null = null;
  private routeLineMain: L.Polyline | null = null;
  private riderMarker: L.Marker | null = null;
  private gpsMarker: L.Marker | null = null;
  private projectionLine: L.Polyline | null = null;
  private poiLayerGroup: L.LayerGroup = L.layerGroup();

  constructor(public readonly routeService: RouteDataService) {
    // Effect to update rider marker position whenever currentMile changes
    effect(() => {
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

    // Effect to update base tile layer when mapStyle setting changes
    effect(() => {
      const style = this.settings.mapStyle();
      if (this.map) {
        this.setBaseTileLayer(style);
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

  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;

    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    this.initMap(container);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.removeEventListener('td-jump-mile', this.handlePopupJump as EventListener);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.map) {
      this.clearRouteLayers();
      this.map.remove();
      this.map = null;
    }
  }

  private initMap(container: HTMLElement): void {
    // Determine initial center and zoom from settings or rider position
    const points = this.routeService.trackPoints();
    const initialCoords = this.getCoordsForMile(this.currentMile());
    let initialCenter: [number, number] = [51.16, -115.56];
    if (initialCoords) {
      initialCenter = [initialCoords[0], initialCoords[1]];
    } else if (points && points.length > 0) {
      initialCenter = [points[0][0], points[0][1]];
    }
    const initialZoom = this.settings.mapZoomLevel() || 8;

    // Initialize Leaflet map
    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: false
    }).setView(initialCenter, initialZoom);

    // Zoom buttons in top-right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Persist zoom level changes when user zooms
    this.map.on('zoomend', () => {
      if (this.map) {
        this.settings.setMapZoomLevel(this.map.getZoom());
      }
    });

    // Set up base tile layer
    this.setBaseTileLayer(this.mapStyle());

    // Add POI layer group
    this.poiLayerGroup.addTo(this.map);

    // Render route track line
    this.drawRoute();

    // Render initial rider marker & POIs
    this.updateRiderMarker(this.currentMile());
    this.updatePoiMarkers(this.routeService.places(), this.activePoiFilter());
    this.updateGpsDisplay(this.gpsState());

    // Dynamically watch container size and invalidate map size
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.map?.invalidateSize();
      });
      this.resizeObserver.observe(container);
    }

    // Trigger size invalidation to handle any flexbox layout animations
    setTimeout(() => {
      this.map?.invalidateSize();
    }, 150);
  }

  toggleMapStyle(): void {
    this.settings.toggleMapStyle();
  }

  private createTileLayer(url: string, options: L.TileLayerOptions = {}): L.TileLayer {
    const tileOptions: L.TileLayerOptions = {
      maxZoom: 16,
      maxNativeZoom: 10,
      ...options
    };

    if (typeof window !== 'undefined' && 'caches' in window && typeof document !== 'undefined') {
      try {
        const OfflineLayer = L.TileLayer.extend({
          createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
            const tile = document.createElement('img');
            const tileUrl = (this as any).getTileUrl(coords);

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
                done(err as any, tile);
              };
              tile.src = objectUrl;
            };

            const setTileUrl = (src: string) => {
              tile.onload = () => done(undefined, tile);
              tile.onerror = (err) => done(err as any, tile);
              tile.src = src;
            };

            window.caches.open('bikepack-map-tiles-v1').then((cache) => {
              cache.match(tileUrl).then((cachedResponse) => {
                if (cachedResponse) {
                  cachedResponse.blob()
                    .then((blob) => {
                      setTileBlob(blob);
                    })
                    .catch(() => {
                      setTileUrl(tileUrl);
                    });
                } else {
                  fetch(tileUrl, { mode: 'cors' })
                    .then((res) => {
                      if (res.ok) {
                        cache.put(tileUrl, res.clone()).catch(() => {});
                        return res.blob();
                      }
                      throw new Error('Tile network error');
                    })
                    .then((blob) => {
                      setTileBlob(blob);
                    })
                    .catch(() => {
                      setTileUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
                    });
                }
              }).catch(() => {
                setTileUrl(tileUrl);
              });
            }).catch(() => {
              setTileUrl(tileUrl);
            });

            return tile;
          }
        });

        const layer = new (OfflineLayer as any)(url, tileOptions);
        layer.on('tileunload', (e: any) => {
          if (e.tile && typeof e.tile._cleanup === 'function') {
            e.tile._cleanup();
          }
        });
        return layer;
      } catch {
        return L.tileLayer(url, tileOptions);
      }
    }

    return L.tileLayer(url, tileOptions);
  }

  private setBaseTileLayer(style: MapStyle): void {
    if (!this.map) return;

    if (this.tileLayer) {
      this.map.removeLayer(this.tileLayer);
      this.tileLayer = null;
    }
    if (this.referenceLayer) {
      this.map.removeLayer(this.referenceLayer);
      this.referenceLayer = null;
    }

    if (style === 'dark') {
      // Esri World Dark Gray Base & Reference (with maxNativeZoom: 10 for smooth offline scaling)
      this.tileLayer = this.createTileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, maxNativeZoom: 10 }
      ).addTo(this.map);

      this.referenceLayer = this.createTileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, maxNativeZoom: 10 }
      ).addTo(this.map);
    } else {
      // Esri World Topographic Map with mountain contours & shaded relief
      this.tileLayer = this.createTileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, maxNativeZoom: 10 }
      ).addTo(this.map);
    }
  }

  clearRouteLayers(): void {
    if (!this.map) return;

    if (this.routeLineGlow) {
      this.map.removeLayer(this.routeLineGlow);
      this.routeLineGlow = null;
    }
    if (this.routeLineMain) {
      this.map.removeLayer(this.routeLineMain);
      this.routeLineMain = null;
    }
    if (this.riderMarker) {
      this.map.removeLayer(this.riderMarker);
      this.riderMarker = null;
    }
  }

  private drawRoute(): void {
    if (!this.map) return;

    // Clear previous route polylines before redrawing
    this.clearRouteLayers();

    const points = this.routeService.trackPoints();
    if (!points || points.length < 2) return;

    const latLngs: [number, number][] = points.map((p) => [p[0], p[1]]);

    // Background glowing line
    this.routeLineGlow = L.polyline(latLngs, {
      color: '#10b981',
      weight: 6,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Foreground sharp track line
    this.routeLineMain = L.polyline(latLngs, {
      color: '#34d399',
      weight: 3.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Center dynamically on rider position or active route start coordinates, preserving user's zoom level
    if (points.length > 0) {
      const zoom = this.map.getZoom() || this.settings.mapZoomLevel() || 8;
      const riderCoords = this.getCoordsForMile(this.currentMile()) || [points[0][0], points[0][1]];
      this.map.setView([riderCoords[0], riderCoords[1]], zoom);
    }
  }

  private updateRiderMarker(mile: number): void {
    if (!this.map) return;

    const coords = this.getCoordsForMile(mile);
    if (!coords) {
      if (this.riderMarker) {
        this.map.removeLayer(this.riderMarker);
        this.riderMarker = null;
      }
      return;
    }

    const [lat, lon, ele] = coords;
    const isMiles = this.unit() === 'miles';
    const distText = isMiles ? `Mile ${mile.toFixed(1)}` : `KM ${(mile * 1.60934).toFixed(1)}`;
    const eleText = isMiles ? `${Math.round(ele * 3.28084).toLocaleString()} ft` : `${Math.round(ele).toLocaleString()} m`;

    const customIcon = L.divIcon({
      className: 'rider-leaflet-icon',
      html: `
        <div class="relative flex items-center justify-center w-8 h-8 cursor-pointer">
          <div class="absolute w-7 h-7 rounded-full bg-emerald-400/40 animate-ping"></div>
          <div class="relative w-7 h-7 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center justify-center text-xs shadow-emerald-950">
            🚴
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const popupContent = `
      <div style="font-family: ui-monospace, SFMono-Regular, monospace; min-width: 140px; padding: 4px;">
        <div style="font-weight: 700; color: #34d399; font-size: 12px;">Rider Position</div>
        <div style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-top: 2px;">${distText}</div>
        <div style="font-size: 11px; color: #94a3b8;">Elevation: ${eleText}</div>
      </div>
    `;

    if (!this.riderMarker) {
      this.riderMarker = L.marker([lat, lon], { icon: customIcon, zIndexOffset: 1000 })
        .addTo(this.map)
        .bindPopup(popupContent, { className: 'dark-leaflet-popup' });
    } else {
      this.riderMarker.setLatLng([lat, lon]);
      this.riderMarker.setIcon(customIcon);
      this.riderMarker.setPopupContent(popupContent);
    }

    // Automatically pan & recenter map on rider position
    this.map.panTo([lat, lon], { animate: true, duration: 0.3 });
  }

  private updateGpsDisplay(gps: GpsState | null): void {
    if (!this.map) return;

    if (!gps || !gps.enabled || gps.latitude === null || gps.longitude === null) {
      if (this.gpsMarker) {
        this.map.removeLayer(this.gpsMarker);
        this.gpsMarker = null;
      }
      if (this.projectionLine) {
        this.map.removeLayer(this.projectionLine);
        this.projectionLine = null;
      }
      return;
    }

    const gpsPos: [number, number] = [gps.latitude, gps.longitude];

    // Blue pulsating GPS icon
    const gpsIcon = L.divIcon({
      className: 'gps-leaflet-icon',
      html: `
        <div class="relative flex items-center justify-center w-7 h-7">
          <div class="absolute w-6 h-6 rounded-full bg-blue-500/40 animate-ping"></div>
          <div class="relative w-5 h-5 rounded-full bg-blue-500 border-2 border-white shadow-md flex items-center justify-center text-[10px]">
            📍
          </div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    if (!this.gpsMarker) {
      this.gpsMarker = L.marker(gpsPos, { icon: gpsIcon, zIndexOffset: 950 }).addTo(this.map);
    } else {
      this.gpsMarker.setLatLng(gpsPos);
    }

    // If off-route (> 10 km), currentMile is not adjusted, so recenter map on GPS position directly
    if (gps.projection?.isOffRoute) {
      this.map.panTo(gpsPos, { animate: true, duration: 0.3 });
    }

    // Draw orthogonal projection line connecting GPS position to route centerline
    if (gps.projection && gps.projection.nearestPointOnTrail) {
      const trailPos: [number, number] = [
        gps.projection.nearestPointOnTrail.lat,
        gps.projection.nearestPointOnTrail.lon
      ];

      const isOff = gps.projection.isOffRoute;
      const lineColor = isOff ? '#f43f5e' : '#38bdf8'; // Red if >10km, Cyan if <=10km

      if (!this.projectionLine) {
        this.projectionLine = L.polyline([gpsPos, trailPos], {
          color: lineColor,
          dashArray: '4, 4',
          weight: 2.5,
          opacity: 0.9
        }).addTo(this.map);
      } else {
        this.projectionLine.setLatLngs([gpsPos, trailPos]);
        this.projectionLine.setStyle({ color: lineColor });
      }
    }
  }

  private updatePoiMarkers(places: Place[], filterCategory: string): void {
    if (!this.map) return;

    this.poiLayerGroup.clearLayers();
    if (!places || places.length === 0) return;

    // Filter places based on selected map category
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

    // Add POI pins
    for (const place of filtered) {
      const iconConfig = this.getPoiIconConfig(place);
      const customIcon = L.divIcon({
        className: 'poi-pin-icon',
        html: `
          <div class="w-6 h-6 rounded-full ${iconConfig.bg} border border-slate-900 shadow-md flex items-center justify-center text-[11px] cursor-pointer hover:scale-125 transition-transform">
            ${iconConfig.emoji}
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

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

      const marker = L.marker([lat, lon], { icon: customIcon })
        .bindPopup(popupHtml, { className: 'dark-leaflet-popup' });

      this.poiLayerGroup.addLayer(marker);
    }

    // Set up window event listener for jump buttons clicked inside Leaflet popups
    if (typeof window !== 'undefined') {
      window.removeEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.removeEventListener('td-jump-mile', this.handlePopupJump as EventListener);
      window.addEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.addEventListener('td-jump-mile', this.handlePopupJump as EventListener);
    }
  }

  private handlePopupJump = (e: CustomEvent<number>): void => {
    if (typeof e.detail === 'number') {
      this.selectMile.emit(e.detail);
      this.map?.closePopup();
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
        ? (place.type.charAt(0).toUpperCase() + place.type.slice(1).replace('_', ' '))
        : 'Lodging';
      return {
        emoji: '🏨',
        bg: 'bg-purple-600',
        label: typeName, // Hotel, Motel, Lodge, Cabin, Hostel
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
      this.map.flyTo([coords[0], coords[1]], currentZoom, { duration: 0.5 });
    }
  }

  fitFullRoute(): void {
    if (!this.map || !this.routeLineMain) return;
    this.map.fitBounds(this.routeLineMain.getBounds(), { padding: [30, 30] });
  }

  setPoiFilter(category: string): void {
    this.activePoiFilter.set(category);
  }
}
