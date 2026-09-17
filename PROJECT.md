# Bike Packing Navigator — Project Documentation

## 1. Project Overview & Architecture

Bike Packing Navigator is an off-grid bikepacking route navigation application built with Angular 21 (zoneless, signal-first architecture, Tailwind CSS v4, and Vitest). The application delivers telemetry scrubbing, elevation profiling, resupply planning, POI discovery, and offline mapping.

### 1.1 Mapping Architecture: Dual-Tier Offline Map System
The application features a dual-tier map rendering engine powered by **MapLibre GL**:

- **Tier 1 (Strategy A: Out-of-the-Box Raster Baseline)**
  - High-resolution ArcGIS raster tiles (Esri World Topographic and Esri World Dark Gray Base & Reference).
  - Configured with native zoom up to level 16 (`maxzoom: 16`), completely eliminating blurry bilinear 64x pixelation.
  - Cached via browser `CacheStorage` (`bikepack-map-tiles-v1`) and intercepted transparently by the Service Worker (`public/sw.js`).
  - Active by default whenever vector archives are not downloaded or when forced by user preference.

- **Tier 2 (Strategy B: On-Demand PMTiles Vector Maps)**
  - Single-file corridor vector tile archives (`.pmtiles`) rendered natively using the `pmtiles://` protocol.
  - Random-access tile extraction using `BlobSource` and IndexedDB storage without range-header interception issues.
  - Bundled offline glyphs/fonts and responsive dark/topo vector stylesheets.

- **Reactive Fallback & User Preferences**
  - Persistent user preference: `auto` (vector if cached, else raster) vs `raster` (forced Strategy A).
  - Seamless, non-blocking fallback to Strategy A raster baseline if vector archives are unavailable or corrupted.

---

## 2. Milestones

- **Milestone 1: MapLibre GL Migration & Strategy A Raster Baseline** (Current)
  - Replace Leaflet with MapLibre GL `maplibregl.Map` in `RouteMapComponent`.
  - Coordinate order migration: `[lat, lon]` (Leaflet) -> `[lon, lat]` (MapLibre GL / GeoJSON).
  - GeoJSON route line layers with hardware-accelerated outer glow (`line-blur: 3`).
  - Interactive rider location marker (`maplibregl.Marker`), GPS marker with off-route dashed projection line.
  - Categorized POI markers with custom SVG/DOM badges and jump-to-mile popup dispatching.
  - Native resolution Esri Topo and Dark tile sources (`maxzoom: 16`).
  - Mock MapLibre GL in Vitest/JSDOM test environment; maintain 100% green tests (680+ tests) and clean production build.

- **Milestone 2: PMTiles Vector Map Engine & Offline Storage** (Completed)
  - Installed `pmtiles` package and implemented `PmtilesStorageService` with IndexedDB `BlobSource` seeking (`bikepack-pmtiles-v1`).
  - Registered `pmtiles://` protocol in MapLibre GL with custom URL instance management (`pmtiles://<route-id>` and `pmtiles://<route-id>/<section>`).
  - Implemented `CompositePMTiles` virtual source for multi-section transcontinental routes (e.g. Tour Divide 2025).
  - Provided responsive OpenMapTiles / Protomaps compatible outdoor topo and dark stylesheets in `public/assets/styles/`.
  - Bundled authentic Noto Sans font glyphs in `public/assets/fonts/` (Regular & Bold, 0-255 & 256-511 ranges) and sprites in `public/assets/sprites/`.
  - Configured Service Worker `public/sw.js` app shell precache (`bikepack-app-shell-v2`) for font glyphs, stylesheets, and sprites.
  - Built ingestion pipeline CLI tool `engine.tiles.pmtiles` (`python3 -m engine.cli.main tiles`) with bounding box validation and MVT encoding.
  - Generated authentic sample corridor `.pmtiles` archives in `public/data/routes/`.
  - 100% green unit tests (44 test files, 726 passed tests) and clean production build.

- **Milestone 3: Offline UX Across Touchpoints & Settings Toggle** (Completed)
  - Touchpoint 1: Route Selector modal with vector offline status badge ('Vector Ready' vs 'Raster Only'), size estimate, live download progress bar, and non-propagating download button (`event.stopPropagation()`).
  - Touchpoint 2: Quick-action status bar below map container showing active tier (`Vector Map (Offline Ready)` vs `Raster Map`), instant download button with live progress, and reactive renderer switching.
  - Touchpoint 3: Settings tab "Offline Maps & Storage" section with storage quota breakdown, per-route manager, Wipe All Archives action, and persistent `mapRenderer` toggle (`auto` vs `raster`).

- **Milestone 4: End-to-End Verification & Hardening** (Completed)
  - Multi-section route support with granular section downloading, individual section deletion, and composite virtual PMTiles seeking (e.g., Tour Divide 2025: Sections 1 to 4 with distinct regional corridor PMTiles archives for Canada/Montana, Wyoming, Colorado, and New Mexico).
  - Auto-detection and seamless fallback: vector rendering when PMTiles are cached in OPFS/IndexedDB with verified initial map load style application (`checkRouteCacheAndApplyRenderer(true)`), automatic fallback to Strategy A raster baseline when unavailable or if renderer forced to raster.
  - Robust offline error handling in `PmtilesStorageService`: genuine failure propagation, `status: 'error'`, `errorMessage` recording, active downloads cleanup, and zero synthetic dummy blobs.
  - Corrected DOM hierarchy in `RouteMapComponent`: map container cleanly closed prior to quick-action status bar (13 opens, 13 closes).
  - 100% green test suite across all 44 test files and full production build with zero regressions.

---

## 3. Interface Contracts & Component Specifications

### 3.1 RouteMapComponent Contracts
- **Selector**: `app-route-map`
- **Inputs**:
  - `currentMile`: `number` (active scrub position along route)
  - `unit`: `'miles' | 'km'`
  - `gpsState`: `GpsState | null` (current geolocation, accuracy, orthogonal route projection)
- **Outputs**:
  - `selectMile`: `EventEmitter<number>` (emitted when rider jumps to POI milestone)
- **Dependencies Injected**:
  - `RouteDataService`: provides `trackPoints()` signal `[lat, lon, ele, cum_km, cum_mi]`, `places()` signal, `totalDistanceKm`, `totalDistanceMiles`.
  - `SettingsService`: provides `mapStyle()` signal (`'dark' | 'topo'`), `mapZoomLevel()` signal, and zoom persistence.

### 3.2 Coordinate Systems
- **Route Track & Places Data**: In storage as `[latitude, longitude, elevation, cum_km, cum_mi]`.
- **MapLibre GL Coordinates**: Always `[longitude, latitude]` for `LngLatLike` and GeoJSON coordinates.

### 3.3 Popup Jump Events
- Window Custom Events: `bpn-jump-mile` and `td-jump-mile` with `e.detail` containing target mile number.
- Listening on `window` guarantees clicks inside MapLibre popups route to `selectMile.emit(detail)`.

---

## 4. Code Layout

```
src/
├── app/
│   ├── components/
│   │   ├── bottom-nav/
│   │   ├── category-filter/
│   │   ├── elevation-profile/
│   │   ├── milestone-jump/
│   │   ├── resupply-planner/
│   │   ├── route-map/               # Target of Milestone 1
│   │   │   ├── route-map.component.ts
│   │   │   ├── route-map.component.html
│   │   │   ├── route-map.component.css
│   │   │   └── route-map.component.spec.ts
│   │   ├── route-selector/
│   │   ├── settings-tab/
│   │   ├── waypoint-card/
│   │   ├── waypoints-list/
│   │   ├── weather-forecast/
│   │   └── welcome-screen/
│   ├── models/
│   │   ├── route.model.ts
│   │   ├── settings.model.ts
│   │   └── waypoint.model.ts
│   └── services/
│       ├── offline-storage.service.ts
│       ├── route-data.service.ts
│       ├── route-manifest.service.ts
│       ├── settings.service.ts
│       └── tile-cache.service.ts
public/
├── data/
│   ├── routes.json
│   └── routes/                      # Route telemetry and corridor.geojson
└── sw.js                            # CacheStorage tile interception
```
