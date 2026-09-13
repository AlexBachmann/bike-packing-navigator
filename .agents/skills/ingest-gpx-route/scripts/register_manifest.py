#!/usr/bin/env python3
"""
register_manifest.py - Register a newly processed route into public/data/routes.json

Usage:
  python3 register_manifest.py \
    --routes-json <path_to_routes_json> \
    --id <route_id> \
    --name <full_name> \
    --short-name <short_name> \
    --badge <badge> \
    --start-location <start> \
    --end-location <end> \
    --stats <path_to_stats_json> \
    --description <desc> \
    [--checkpoints "CP1,CP2,CP3"]
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List

REQUIRED_FILES = [
    "route-track.json",
    "surfaces.json",
    "climbs.json",
    "passes.json",
    "milestones.json",
    "places.json"
]

def register_route(
    routes_json_path: str,
    route_id: str,
    name: str,
    short_name: str,
    badge: str,
    start_loc: str,
    end_loc: str,
    stats_path: str,
    description: str,
    checkpoints_str: str = ""
):
    if not os.path.exists(routes_json_path):
        manifest_data = {"version": 1, "routes": []}
    else:
        with open(routes_json_path, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)

    with open(stats_path, "r", encoding="utf-8") as f:
        stats = json.load(f)

    # Validate route data folder
    routes_dir = os.path.dirname(routes_json_path)
    route_data_dir = os.path.join(routes_dir, "routes", route_id)
    print(f"[MANIFEST] Verifying required route files in {route_data_dir}...")

    missing = []
    for req_file in REQUIRED_FILES:
        fp = os.path.join(route_data_dir, req_file)
        if not os.path.exists(fp):
            missing.append(req_file)

    if missing:
        print(f"[MANIFEST WARNING] The following route files are missing in {route_data_dir}: {missing}", file=sys.stderr)

    checkpoints = [cp.strip() for cp in checkpoints_str.split(",") if cp.strip()]
    if not checkpoints:
        checkpoints = [start_loc, "Midway Summit", end_loc]

    highest_name = f"Summit Peak ({stats['highest_elevation_ft']:,} ft)"
    highest_pass = highest_name

    route_entry = {
        "id": route_id,
        "name": name,
        "shortName": short_name,
        "badge": badge,
        "startLocation": start_loc,
        "endLocation": end_loc,
        "startPoint": start_loc,
        "endPoint": end_loc,
        "totalDistanceMiles": stats["total_miles"],
        "totalDistanceKm": stats["total_km"],
        "distanceMiles": stats["total_miles"],
        "distanceKm": stats["total_km"],
        "elevationGainFt": stats["elevation_gain_ft"],
        "elevationGainM": stats["elevation_gain_m"],
        "elevationGainFeet": stats["elevation_gain_ft"],
        "elevationGainMeters": stats["elevation_gain_m"],
        "highestElevationFeet": stats["highest_elevation_ft"],
        "highestElevationMeters": stats["highest_elevation_m"],
        "highestPoint": highest_name,
        "iconicPass": highest_pass,
        "iconicCheckpoints": checkpoints,
        "description": description,
        "startCoordinates": stats["start_coordinates"],
        "bounds": stats["bounds"],
        "dataPath": f"/data/routes/{route_id}"
    }

    # Check if route already exists in manifest
    existing_idx = None
    for idx, r in enumerate(manifest_data.get("routes", [])):
        if r.get("id") == route_id:
            existing_idx = idx
            break

    if existing_idx is not None:
        manifest_data["routes"][existing_idx] = route_entry
        print(f"[MANIFEST] Updated existing route entry for '{route_id}' in {routes_json_path}")
    else:
        manifest_data["routes"].append(route_entry)
        print(f"[MANIFEST] Appended new route entry for '{route_id}' in {routes_json_path}")

    with open(routes_json_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    print(f"[MANIFEST] Successfully updated {routes_json_path}")

def main():
    parser = argparse.ArgumentParser(description="Register route in routes.json manifest")
    parser.add_argument("--routes-json", required=True, help="Path to public/data/routes.json")
    parser.add_argument("--id", required=True, help="Unique route slug ID (e.g. colorado-trail)")
    parser.add_argument("--name", required=True, help="Full route display name")
    parser.add_argument("--short-name", required=True, help="Short display name")
    parser.add_argument("--badge", required=True, help="2-3 letter badge abbreviation")
    parser.add_argument("--start-location", required=True, help="Start location (City, ST)")
    parser.add_argument("--end-location", required=True, help="End location (City, ST)")
    parser.add_argument("--stats", required=True, help="Path to telemetry stats JSON")
    parser.add_argument("--description", required=True, help="Route description summary")
    parser.add_argument("--checkpoints", default="", help="Comma-separated iconic checkpoints")
    args = parser.parse_args()

    register_route(
        args.routes_json,
        args.id,
        args.name,
        args.short_name,
        args.badge,
        args.start_location,
        args.end_location,
        args.stats,
        args.description,
        args.checkpoints
    )

if __name__ == "__main__":
    main()
