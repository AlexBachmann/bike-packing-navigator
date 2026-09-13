# Route Data Extraction Scripts

Route-agnostic data extraction and enrichment tools for bikepacking routes (e.g. Tour Divide, Colorado Trail, or any custom trail).

Every tool in this directory accepts a universal `--route <route-id>` parameter, automatically resolving standard paths under `public/data/routes/<route-id>/` and `route/`, while also allowing explicit path overrides (`--track`, `--output`, `--osm-pbf`, etc.).

---

## Tool Suite

### 1. `populate_places.py`
Enriches routes with town POIs and backcountry resupply points using Google Places API (New).
- **Zero Cost Guarantee**: Operates strictly within Google's **"Nearby Search (Pro)"** SKU tier with 5,000 FREE requests/month and Pro-tier field mask.
- **Smart Caching**: Per-route cache files (`route/places/.cache_places_api_<route>.json`) guarantee $0 cost on re-runs.
- **Usage**:
  ```bash
  # Run for any route
  docker compose exec -T app python3 route/scripts/populate_places.py --route colorado-trail
  docker compose exec -T app python3 route/scripts/populate_places.py --route tour-divide-2025
  ```

### 2. `find_places.py`
Interactive CLI utility to search POIs around specific GPS coordinates or along any trail by mile/km.
- Supports mock mode (`--mock`) for instant offline testing without an API key.
- **Usage**:
  ```bash
  # Search around mile 100 on Colorado Trail:
  docker compose exec -T app python3 route/scripts/find_places.py --route colorado-trail --mile 100 --mock

  # Search at route start with live Google API:
  docker compose exec -T app python3 route/scripts/find_places.py --route tour-divide-2025 --categories bike_shop,grocery
  ```

### 3. `generate_route_surfaces.py`
Generates contiguous OSM surface intervals (`[startKm, endKm, roadClass, surface, tracktype]`) along any trail.
- Reads `route-track.json`, scans OSM ways via `osmium` if a corridor PBF is present, and falls back to an adaptive backcountry surface model.
- **Usage**:
  ```bash
  docker compose exec -T app python3 route/scripts/generate_route_surfaces.py --route colorado-trail
  docker compose exec -T app python3 route/scripts/generate_route_surfaces.py --route tour-divide-2025
  ```

### 4. `extract_climb_surfaces.py`
Enriches elevation climb intervals with OSM highway classification, surface material, and track firmness (`roadClass`, `surface`, `firmness`, `tracktype`).
- Supports both JSON (`climbs.json`) and TypeScript (`climbs.data.ts`) models.
- **Usage**:
  ```bash
  docker compose exec -T app python3 route/scripts/extract_climb_surfaces.py --route colorado-trail
  docker compose exec -T app python3 route/scripts/extract_climb_surfaces.py --route tour-divide-2025
  ```

### 5. `extract_osm_corridor.py`
Generates an 18 km buffer polygon GeoJSON around any route track (GPX or JSON) and optionally clips raw OpenStreetMap PBF files using `osmium extract`.
- **Usage**:
  ```bash
  docker compose exec -T app python3 route/scripts/extract_osm_corridor.py --route colorado-trail
  docker compose exec -T app python3 route/scripts/extract_osm_corridor.py --route tour-divide-2025
  ```

### 6. `download_terrain_dem.py`
Downloads Copernicus 30m Digital Elevation Model (GLO-30) tiles from AWS Open Data for all 1x1 degree bounding boxes intersecting any route corridor, generating hillshades and 100m vector contours.
- **Usage**:
  ```bash
  docker compose exec -T app python3 route/scripts/download_terrain_dem.py --route colorado-trail --dem-only
  ```

---

## Directory Conventions for Routes

When targeting `--route <route-id>`, scripts expect or produce assets under:
```
public/data/routes/<route-id>/
├── route-track.json     # [lat, lon, ele, km, mi] track points
├── towns.json           # Defined resupply towns & search radii
├── places.json          # Extracted Google Places resupply waypoints
├── surfaces.json        # Contiguous surface segments
├── climbs.json          # Analyzed climbs with surface/firmness
└── corridor.geojson     # 18km buffered corridor boundary
```

