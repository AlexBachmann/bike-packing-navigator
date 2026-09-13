# Original User Request

## 2026-09-13T15:46:10Z

This is a single self-contained fix; keep it small and focused. Ingest the Arizona Trail Race 300 2025 GPX track (`route/gpx/arizona-trail-race-300-2025.gpx`) into Bikepack Navigator, producing all 6 required static route datasets, OSM surface segments, enriched climb intelligence, milestone checkpoints, and manifest registration in `public/data/routes.json`.

Working directory: /Users/alex/htdocs/bike-packing-navigator
Integrity mode: development

## Requirements

### R1. Route Telemetry & Datasets
Process the GPX file at `route/gpx/arizona-trail-race-300-2025.gpx` and produce the 6 standardized JSON files in `public/data/routes/arizona-trail-300/`:
- `route-track.json`: Dense coordinate stream `[lat, lon, ele, cum_km, cum_mi]`, total distance, and bounding box.
- `surfaces.json`: Contiguous trail surface intervals (singletrack, doubletrack, gravel, paved) along the route corridor.
- `climbs.json`: Categorized mountain climbs enriched with authentic summit/ridge names, trail names, park/national forest jurisdiction, landmarks, and narrative guidebook notes.
- `passes.json`: Named summits, passes, and high-elevation checkpoints.
- `milestones.json`: Navigation resupply checkpoints and jump targets from start to finish.
- `places.json`: Filtered points of interest (camping, water, services, bike shops) projected onto the trail.

### R2. Manifest Registration
Register the new route in `public/data/routes.json` with:
- `id`: `arizona-trail-300`
- `name`: `Arizona Trail Race 300 (2025)`
- `shortName`: `Arizona Trail 300`
- `badge`: `AZT`
- `startLocation`: `Coronado National Memorial, AZ`
- `endLocation`: `Picketpost Trailhead (Superior), AZ`
- Computed distance, elevation gain, highest elevation point, iconic checkpoints list, and bounding coordinates matching the data track.

### R3. Verification & Build Health
Ensure all unit tests pass with zero regressions and the production build compiles cleanly without errors.

## Acceptance Criteria

### Data Completeness & Schema Conformity
- [ ] Directory `public/data/routes/arizona-trail-300/` contains all 6 required JSON files: `route-track.json`, `surfaces.json`, `climbs.json`, `passes.json`, `milestones.json`, and `places.json`.
- [ ] All 6 JSON files parse cleanly and conform to the data structures used by existing routes (e.g. `public/data/routes/colorado-trail/`).
- [ ] `public/data/routes.json` contains the `arizona-trail-300` entry with valid bounding box coordinates and accurate telemetry.

### Climb Guidebook Enrichment
- [ ] Entries in `climbs.json` feature authentic geographic names, landmark / park references, and narrative notes rather than generic automated placeholders.

### Test & Build Integrity
- [ ] Unit tests (`npm test`) pass completely (100% green).
- [ ] Production build (`npm run build`) completes with exit code 0.
