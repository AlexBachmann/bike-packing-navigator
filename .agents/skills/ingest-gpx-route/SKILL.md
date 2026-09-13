---
name: ingest-gpx-route
description: Ingest any GPX bikepacking route file, enrich with Google Places API POIs, 18km OSM corridor, surface intervals, climbs, passes, and milestones, and register the route into the Bikepack Navigator application.
---

# Ingest GPX Route Skill

This skill teaches the agent how to take any user-provided `.gpx` file and execute the complete route ingestion and enrichment pipeline using the tools in `route/scripts`, transforming raw GPX coordinates into a fully featured, interactive, and offline-capable route in Bikepack Navigator.

---

## When to Use This Skill
Use this skill whenever:
- The user provides a new `.gpx` file (e.g. *"Here is the-colorado-trail.gpx, add it to the app"* or *"Integrate this Arizona Trail GPX file"*).
- The user asks to enrich an existing GPX track with Google Places POIs, elevation profiles, or OSM surface data.
- The user wants to add a new bikepacking route to the top-left route selector dropdown.

---

## The 6 Required Route Datasets
Every route in the application requires a dedicated directory at:
`public/data/routes/<route-id>/`

Containing these 6 standardized JSON files:
1. **`route-track.json`**: Dense coordinates `[lat, lon, ele, cum_km, cum_mi]`, total distance, and bounds.
2. **`surfaces.json`**: Contiguous surface intervals `[start_km, end_km, highway, surface, tracktype]`.
3. **`climbs.json`**: Categorized mountain climbs with gradients, elevation gains, and difficulties.
4. **`passes.json`**: Named summits, passes, and high-altitude checkpoints.
5. **`milestones.json`**: Navigation town checkpoints and jump targets.
6. **`places.json`**: Filtered and categorized POIs (campsites, hotels, groceries, restaurants, bike shops, water, laundromats) projected onto the trail.

And registration in the central route manifest:
- **`public/data/routes.json`**

---

## Execution Environment

All commands MUST run inside the project's Docker container:
```bash
docker compose exec -T app <command>
```

The pipeline scripts are located in:
`.agents/skills/ingest-gpx-route/scripts/`

---

## Complete End-to-End Workflow

### Step 1: Place the GPX File & Determine Metadata
Place or locate the user's GPX file in the workspace (e.g., `route/<filename>.gpx`).
Determine:
- **Route ID Slug**: Lowercase, hyphenated (e.g., `colorado-trail`, `arizona-trail`, `timber-trail`).
- **Full Name**: e.g., `The Colorado Trail`.
- **Short Name**: e.g., `Colorado Trail`.
- **Badge**: 2–3 letter uppercase abbreviation (e.g., `CT`, `AZT`, `TT`).
- **Start / End Locations**: e.g., `Denver (Waterton Canyon), CO` to `Durango, CO`.

---

### Step 2: Run the Master Pipeline (One-Command Ingestion)

Execute the master orchestrator inside Docker:

```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/ingest_pipeline.py \
  --gpx "route/<filename>.gpx" \
  --id "<route-id>" \
  --name "<Full Route Name>" \
  --short-name "<Short Name>" \
  --badge "<BADGE>" \
  --start-location "<Start City, ST>" \
  --end-location "<End City, ST>" \
  --description "<Engaging route summary description>"
```

*Note: If the user provides a Google Places API key, pass `--api-key "<key>"` or ensure `GOOGLE_PLACES_API_KEY` is set in the environment.*

The orchestrator automatically executes all steps below in sequence.

---

### Step-by-Step Tool Execution (Manual or Customized Run)

If you need to customize parameters or run individual stages:

#### 1. Parse GPX Track & Calculate Telemetry
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/parse_gpx.py \
  --gpx "route/<filename>.gpx" \
  --output "public/data/routes/<route-id>/route-track.json" \
  --stats "public/data/routes/<route-id>/.stats.json"
```

#### 2. Generate 18 km OSM Corridor Buffer
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/extract_osm_corridor.py \
  --track "public/data/routes/<route-id>/route-track.json" \
  --output-geojson "public/data/routes/<route-id>/corridor.geojson" \
  --buffer-km 18.0
```

#### 3. Model Route Surfaces (Gravel, Dirt, Paved)
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/generate_surfaces.py \
  --track "public/data/routes/<route-id>/route-track.json" \
  --output "public/data/routes/<route-id>/surfaces.json"
```
*(Optionally pass `--osm-pbf <path_to_corridor_pbf>` if an OSM PBF extract is available).*

#### 4. Extract Climbs & Mountain Passes (with OSM Geographic Enrichment)
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/extract_climbs_passes.py \
  --track "public/data/routes/<route-id>/route-track.json" \
  --output-climbs "public/data/routes/<route-id>/climbs.json" \
  --output-passes "public/data/routes/<route-id>/passes.json" \
  --state "<ST>" \
  [--osm-pbf "path/to/corridor.osm.pbf"]
```

#### 5. Generate Navigation Milestones
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/extract_milestones.py \
  --track "public/data/routes/<route-id>/route-track.json" \
  --output "public/data/routes/<route-id>/milestones.json" \
  --interval-miles 35.0 \
  --start-name "<Start Location>" \
  --end-name "<End Location>"
```

#### 6. Extract POIs via Google Places API (New) Pro Tier ($0 Cost)
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/populate_places.py \
  --track "public/data/routes/<route-id>/route-track.json" \
  --output "public/data/routes/<route-id>/places.json" \
  --cache "route/places/.cache_places_api_<route-id>.json"
```

#### 7. Register Route in Manifest (`routes.json`)
```bash
docker compose exec -T app python3 .agents/skills/ingest-gpx-route/scripts/register_manifest.py \
  --routes-json "public/data/routes.json" \
  --id "<route-id>" \
  --name "<Full Route Name>" \
  --short-name "<Short Name>" \
  --badge "<BADGE>" \
  --start-location "<Start Location>" \
  --end-location "<End Location>" \
  --stats "public/data/routes/<route-id>/.stats.json" \
  --description "<Description>"
```

---

## Climb Intelligence & Geographic Enrichment (The Trail Guidebook Pattern)

Raw GPX elevation segmentation often produces generic auto-generated names (e.g. *"Climb south of Banff"*, *"Climb to Summit at Mile 14.2"*). To turn the app into an immersive trail companion, enrich climbs with authentic geographic identity using OpenStreetMap and regional knowledge:

### 1. The 5 Core Enrichment Attributes
In `climbs.json`, enrich each climb with:
1. **`name`**: An authentic, evocative summit/ridge/pass name (e.g. `Goat Pond Overlook`, `Boreas Pass Ascent`, `Marshall Pass Summit`) instead of generic numbered placeholders.
2. **`trailName`**: The verified trail name or highway classification from OSM (`highway=path|track`, `name`, `network=ncn`, `ref`), e.g. `High Rockies Trail (TCT)` or `Colorado Trail Segment 4`.
3. **`parkName`**: Public lands, provincial park, national park, or national forest jurisdiction (`boundary=protected_area`, `national_park`), e.g. `Spray Valley Provincial Park` or `White River National Forest`.
4. **`landmark`**: Prominent mountain peaks, massifs, or water bodies (`natural=peak`, `water=lake|pond|reservoir`), e.g. `Mt. Lawrence Grassi / Goat Pond`.
5. **`notes`**: A concise 1–2 sentence narrative describing the ascent, surroundings, surface difficulty, and summit views.

### 2. OSM Discovery Workflow
To extract these details for any climb:
1. **Query Trail Ways**: Match the route track coordinates against OSM ways within 35 meters (`highway in ['path', 'track', 'unclassified']`). Extract `name`, `ref`, and relation membership (`route=bicycle|mtb|hiking`).
2. **Query Regional Parks**: Query overlapping or containing boundaries (`boundary=protected_area`, `national_park`, `nature_reserve`).
3. **Query Peaks & Lakes**: Search nodes/ways within 3.5 km of the summit coordinate for `natural=peak`, `mountain_pass=yes`, or `natural=water`.
4. **Automated Pipeline**: When running `extract_climbs_passes.py`, pass `--osm-pbf path/to/corridor.osm.pbf` to run spatial matching automatically.
5. **Wikipedia / Regional Ingestion**: For major iconic climbs or passes, consult Wikipedia or local trail guides (e.g., via `read_url_content`) to discover cultural history, peak names, and trail context.

### 3. Application UI Rendering
The Angular frontend (`ElevationProfileComponent`) automatically detects these fields:
- **Title & Header**: Displays `climb.name` alongside summit elevation and distance span.
- **Context Strip**: Renders `🌲 {climb.trailName} • 🏞️ {climb.parkName} • ⛰️ {climb.landmark}` immediately below the title.
- **Guidebook Callout**: Renders `climb.notes` inside an emerald-accented callout box (`border-l-2 border-emerald-500/80 bg-slate-950/60 pl-3 pr-2.5 py-2`).

---

## Step 3: Verification & Integrity Testing

Once the data files are generated and the route is registered in `routes.json`:

1. **Run Unit Tests**:
   ```bash
   docker compose exec -T app npm test
   ```
   All test suites must pass (100% green).

2. **Verify Production Build**:
   ```bash
   docker compose exec -T app npm run build
   ```
   Must compile with 0 errors.

3. **Verify Route Selection in Browser**:
   - Open the application with `?route=<route-id>`.
   - Verify that:
     - The top-left header dropdown displays the new route and badge.
     - The route map renders the polyline and fits bounds.
     - The elevation profile displays summits and climbs.
     - The waypoints feed lists nearby resupply, water, and camping POIs.
     - The jump tab displays milestone towns.
     - Switching between routes unloads and reloads cleanly.

---

## Key Design & Cost Constraints

- **Strict Pro Tier Masking**: Never include fields from Enterprise (phone/web) or Atmosphere (ratings/reviews) in Places API queries. Keep requests within the 5,000 free monthly requests.
- **Persistent Caching**: Always write and commit `.cache_places_api_<route-id>.json` so future rebuilds or adjustments cost 0 API calls.
- **Pure Static Architecture**: No backend server or dynamic database. All route telemetry must resolve strictly from `public/data/routes/<route-id>/`.
