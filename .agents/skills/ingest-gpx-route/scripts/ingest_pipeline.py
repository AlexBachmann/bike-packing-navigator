#!/usr/bin/env python3
"""
ingest_pipeline.py - Master orchestrator to ingest a GPX route, enrich with
Google Places POIs, 18km OSM corridor, surface intervals, climbs, passes,
and milestones, and register the route in the Bikepack Navigator app.

Usage:
  python3 ingest_pipeline.py \
    --gpx <path_to_gpx> \
    [--id <route_id>] \
    [--name <route_name>] \
    [--short-name <short_name>] \
    [--badge <badge>] \
    [--start-location <start>] \
    [--end-location <end>] \
    [--description <desc>] \
    [--api-key <google_places_api_key>]
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[3]  # repository root
DATA_DIR = PROJECT_ROOT / "public" / "data"
ROUTES_JSON = DATA_DIR / "routes.json"

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text.strip('-')

def run_command(cmd: list):
    print(f"\n[PIPELINE] Running: {' '.join(cmd)}", flush=True)
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.stdout:
        print(res.stdout.strip(), flush=True)
    if res.returncode != 0:
        print(f"[PIPELINE ERROR] Command failed with code {res.returncode}:", file=sys.stderr)
        if res.stderr:
            print(res.stderr.strip(), file=sys.stderr)
        sys.exit(res.returncode)

def main():
    parser = argparse.ArgumentParser(description="Full End-to-End GPX Route Ingestion Pipeline")
    parser.add_argument("--gpx", required=True, help="Path to input GPX file")
    parser.add_argument("--id", required=False, help="Route slug ID (default: inferred from GPX filename)")
    parser.add_argument("--name", required=False, help="Full Route Name (default: inferred)")
    parser.add_argument("--short-name", required=False, help="Short Route Name (default: inferred)")
    parser.add_argument("--badge", required=False, help="2-3 letter badge (default: initials)")
    parser.add_argument("--start-location", default="Start Trailhead", help="Starting City/Location")
    parser.add_argument("--end-location", default="Finish Line", help="Ending City/Location")
    parser.add_argument("--description", default="", help="Route description")
    parser.add_argument("--api-key", default=os.environ.get("GOOGLE_PLACES_API_KEY") or os.environ.get("GOOGLE_MAPS_API_KEY"), help="Google Places API Key")
    parser.add_argument("--corridor-pbf", required=False, help="Optional OSM corridor PBF extract")
    args = parser.parse_args()

    gpx_path = Path(args.gpx).resolve()
    if not gpx_path.exists():
        print(f"Error: GPX file not found: {gpx_path}", file=sys.stderr)
        sys.exit(1)

    # 1. Infer metadata
    raw_name = gpx_path.stem.replace("-", " ").replace("_", " ").title()
    route_id = args.id or slugify(gpx_path.stem)
    route_name = args.name or raw_name
    short_name = args.short_name or raw_name
    badge = args.badge or "".join([w[0].upper() for w in short_name.split()[:3]])
    description = args.description or f"High-adventure self-supported bikepacking route: {route_name}."

    print("=" * 70)
    print(f"🚀 INGESTING ROUTE: {route_name} (ID: {route_id}, Badge: {badge})")
    print(f"📁 GPX Source: {gpx_path}")
    print("=" * 70)

    route_out_dir = DATA_DIR / "routes" / route_id
    route_out_dir.mkdir(parents=True, exist_ok=True)

    track_out = route_out_dir / "route-track.json"
    stats_out = route_out_dir / ".stats.json"
    corridor_out = route_out_dir / "corridor.geojson"
    surfaces_out = route_out_dir / "surfaces.json"
    climbs_out = route_out_dir / "climbs.json"
    passes_out = route_out_dir / "passes.json"
    milestones_out = route_out_dir / "milestones.json"
    places_out = route_out_dir / "places.json"
    cache_places = PROJECT_ROOT / "route" / "places" / f".cache_places_api_{route_id}.json"

    # Step 1: Parse GPX & Calculate Telemetry
    print("\n--- [Step 1/6] Parsing GPX & Calculating Distance / Elevation ---")
    run_command([
        sys.executable, str(SCRIPT_DIR / "parse_gpx.py"),
        "--gpx", str(gpx_path),
        "--output", str(track_out),
        "--stats", str(stats_out)
    ])

    # Step 2: Generate 18 km OSM Corridor Buffer
    print("\n--- [Step 2/6] Generating 18 km OSM Buffer Corridor ---")
    run_command([
        sys.executable, str(SCRIPT_DIR / "extract_osm_corridor.py"),
        "--track", str(track_out),
        "--output-geojson", str(corridor_out),
        "--buffer-km", "18.0"
    ])

    # Step 3: Road Classes & Surfaces
    print("\n--- [Step 3/6] Modeling Route Surfaces (Gravel, Dirt, Paved) ---")
    surf_cmd = [
        sys.executable, str(SCRIPT_DIR / "generate_surfaces.py"),
        "--track", str(track_out),
        "--output", str(surfaces_out)
    ]
    if args.corridor_pbf:
        surf_cmd.extend(["--osm-pbf", args.corridor_pbf])
    run_command(surf_cmd)

    # Step 4: Climbs & Mountain Passes
    print("\n--- [Step 4/6] Extracting Climbs, Grades & Mountain Passes ---")
    climbs_cmd = [
        sys.executable, str(SCRIPT_DIR / "extract_climbs_passes.py"),
        "--track", str(track_out),
        "--output-climbs", str(climbs_out),
        "--output-passes", str(passes_out)
    ]
    if args.corridor_pbf:
        climbs_cmd.extend(["--osm-pbf", args.corridor_pbf])
    run_command(climbs_cmd)

    # Step 5: Milestones
    print("\n--- [Step 5/6] Generating Navigation Milestones ---")
    run_command([
        sys.executable, str(SCRIPT_DIR / "extract_milestones.py"),
        "--track", str(track_out),
        "--output", str(milestones_out),
        "--start-name", args.start_location,
        "--end-name", args.end_location
    ])

    # Step 6: Google Places POI Extraction
    print("\n--- [Step 6/6] Extracting POIs via Google Places API (New) Pro Tier ---")
    places_cmd = [
        sys.executable, str(SCRIPT_DIR / "populate_places.py"),
        "--track", str(track_out),
        "--output", str(places_out),
        "--cache", str(cache_places)
    ]
    if args.api_key:
        places_cmd.extend(["--api-key", args.api_key])
    run_command(places_cmd)

    # Step 7: Register in routes.json
    print("\n--- Registering Route in Manifest (routes.json) ---")
    run_command([
        sys.executable, str(SCRIPT_DIR / "register_manifest.py"),
        "--routes-json", str(ROUTES_JSON),
        "--id", route_id,
        "--name", route_name,
        "--short-name", short_name,
        "--badge", badge,
        "--start-location", args.start_location,
        "--end-location", args.end_location,
        "--stats", str(stats_out),
        "--description", description
    ])

    print("\n" + "=" * 70)
    print(f"🎉 ROUTE INGESTION COMPLETE: '{route_name}' ({route_id})")
    print(f"All 6 required static datasets created in {route_out_dir}:")
    print(f"  ✓ route-track.json")
    print(f"  ✓ surfaces.json")
    print(f"  ✓ climbs.json")
    print(f"  ✓ passes.json")
    print(f"  ✓ milestones.json")
    print(f"  ✓ places.json")
    print(f"Manifest registered in: {ROUTES_JSON}")
    print("=" * 70)

if __name__ == "__main__":
    main()
