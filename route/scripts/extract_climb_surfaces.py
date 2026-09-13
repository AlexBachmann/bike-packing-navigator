#!/usr/bin/env python3
"""
extract_climb_surfaces.py - Route-Agnostic Climb Surface & Road Class Extractor.

Enriches climb intervals with OpenStreetMap highway attributes (roadClass, surface, firmness, tracktype)
by matching climb boundaries against OSM ways extracted from a corridor PBF extract.

Usage:
  # Target by route ID:
  python3 extract_climb_surfaces.py --route colorado-trail
  python3 extract_climb_surfaces.py --route tour-divide-2025

  # Or specify explicit paths:
  python3 extract_climb_surfaces.py --track path/to/route-track.json --climbs path/to/climbs.json [--output path/to/output.json] [--osm-pbf path/to/corridor.osm.pbf]
"""

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROAD_CLASS_LABELS = {
    'track': 'Forest Road (Doubletrack)',
    'unclassified': 'Unclassified Gravel Road',
    'tertiary': 'County Rural Road',
    'secondary': 'Secondary Highway',
    'primary': 'State Highway (Paved)',
    'trunk': 'Paved Highway',
    'path': 'Singletrack Trail',
    'footway': 'Backcountry Trail',
    'cycleway': 'Dedicated Bike Path',
    'service': 'Service Access Road',
    'residential': 'Local Road'
}

SURFACE_LABELS = {
    'gravel': 'Gravel',
    'fine_gravel': 'Fine Compacted Gravel',
    'compacted': 'Compacted Hardpack',
    'unpaved': 'Unpaved Gravel',
    'dirt': 'Dirt Road',
    'ground': 'Natural Dirt / Ground',
    'earth': 'Dirt / Earth',
    'sand': 'Sandy Soil',
    'rock': 'Rough Rock / Scree',
    'scree': 'Loose Scree / Rock',
    'asphalt': 'Paved Asphalt',
    'paved': 'Paved Surface',
    'concrete': 'Concrete'
}

TRACKTYPE_LABELS = {
    'grade1': 'Grade 1: Solid Paved / Hard Base',
    'grade2': 'Grade 2: Solid Unpaved (Compacted Gravel)',
    'grade3': 'Grade 3: Mixed Unpaved (Loose Gravel / Soft)',
    'grade4': 'Grade 4: Soft Dirt (High Mud Risk)',
    'grade5': 'Grade 5: Rough Soil & Exposed Rock'
}


def load_climbs(climbs_path: Path) -> Tuple[List[Dict[str, Any]], str]:
    """Loads climbs from either a .json or .ts file."""
    with open(climbs_path, "r", encoding="utf-8") as f:
        content = f.read()

    if climbs_path.suffix == ".ts":
        match = re.search(r'export const \w+: Climb\[\] = (\[[\s\S]*?\]);', content)
        if not match:
            match = re.search(r'(\[[\s\S]*?\]);?', content)
        if not match:
            raise ValueError(f"Could not parse Climb array from TypeScript file: {climbs_path}")
        return json.loads(match.group(1)), "ts"
    else:
        return json.loads(content), "json"


def save_climbs(climbs: List[Dict[str, Any]], output_path: Path, format_type: str):
    """Saves climbs to either .json or .ts format."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if format_type == "ts" or output_path.suffix == ".ts":
        export_name = "TOUR_DIVIDE_CLIMBS"
        output_ts = (
            'import { Climb } from "../models/elevation.model";\n\n'
            f'export const {export_name}: Climb[] = {json.dumps(climbs, indent=2)};\n'
        )
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(output_ts)
    else:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(climbs, f, indent=2)


def match_osm_ways(pts: List[List[float]], pbf_path: str) -> List[Dict[str, Any]]:
    """Uses osmium to scan highway ways and match those overlapping the track."""
    try:
        import osmium
    except ImportError:
        print("[CLIMB SURFACES] osmium library not found, skipping PBF matching.", file=sys.stderr)
        return []

    GRID_SIZE = 0.02  # ~2 km cells
    grid: Dict[Tuple[int, int], List[Tuple[float, float, float, int]]] = {}
    for i, pt in enumerate(pts):
        lat, lon, ele, km, mi = pt
        gx = math.floor(lon / GRID_SIZE)
        gy = math.floor(lat / GRID_SIZE)
        key = (gx, gy)
        if key not in grid:
            grid[key] = []
        grid[key].append((lat, lon, km, i))

    print(f"[CLIMB SURFACES] Spatial index built with {len(grid)} cells.")

    class RouteWayMatcher(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.matched_ways = []

        def way(self, w):
            if 'highway' not in w.tags:
                return
            matched_kms = []
            for n in w.nodes:
                try:
                    n_lat = n.lat
                    n_lon = n.lon
                except Exception:
                    continue
                gx = math.floor(n_lon / GRID_SIZE)
                gy = math.floor(n_lat / GRID_SIZE)
                found = False
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        cell = grid.get((gx + dx, gy + dy))
                        if not cell:
                            continue
                        for t_lat, t_lon, t_km, t_i in cell:
                            if abs(n_lat - t_lat) < 0.0006 and abs(n_lon - t_lon) < 0.0008:
                                matched_kms.append(t_km)
                                found = True
                                break
                        if found:
                            break
                    if found:
                        break

            if matched_kms:
                self.matched_ways.append({
                    'id': w.id,
                    'name': w.tags.get('name', ''),
                    'highway': w.tags.get('highway', ''),
                    'surface': w.tags.get('surface', ''),
                    'tracktype': w.tags.get('tracktype', ''),
                    'smoothness': w.tags.get('smoothness', ''),
                    'min_km': min(matched_kms),
                    'max_km': max(matched_kms),
                })

    t0 = time.time()
    matcher = RouteWayMatcher()
    matcher.apply_file(pbf_path, locations=True)
    t1 = time.time()
    print(f"[CLIMB SURFACES] Scanned OSM ways in {t1 - t0:.2f}s. Matched {len(matcher.matched_ways)} ways along the route.")
    return matcher.matched_ways


def enrich_climbs(climbs: List[Dict[str, Any]], matched_ways: List[Dict[str, Any]]):
    """Enriches climbs with surface, road class, firmness and tracktype."""
    for climb in climbs:
        c_start = climb.get('startKm', 0.0)
        c_end = climb.get('endKm', 0.0)
        avg_grade = climb.get('avgGradePercent', 0.0)

        overlapping = [
            w for w in matched_ways
            if not (w['max_km'] < c_start - 0.5 or w['min_km'] > c_end + 0.5)
        ]

        if overlapping:
            highways = [w['highway'] for w in overlapping if w['highway']]
            surfaces = [w['surface'] for w in overlapping if w['surface']]
            tracktypes = [w['tracktype'] for w in overlapping if w['tracktype']]

            hw_counts: Dict[str, int] = {}
            for h in highways:
                hw_counts[h] = hw_counts.get(h, 0) + 1
            top_hw = max(hw_counts.items(), key=lambda x: x[1])[0] if hw_counts else 'track'
            road_class = ROAD_CLASS_LABELS.get(top_hw, f'{top_hw.capitalize()} Road')

            surf_counts: Dict[str, int] = {}
            for s in surfaces:
                surf_counts[s] = surf_counts.get(s, 0) + 1
            top_surf = max(surf_counts.items(), key=lambda x: x[1])[0] if surf_counts else None

            if not top_surf:
                if top_hw in ('primary', 'trunk', 'secondary', 'residential'):
                    top_surf = 'asphalt'
                elif top_hw == 'path':
                    top_surf = 'dirt'
                else:
                    top_surf = 'gravel'
            surface_label = SURFACE_LABELS.get(top_surf, top_surf.capitalize())

            tt_counts: Dict[str, int] = {}
            for t in tracktypes:
                tt_counts[t] = tt_counts.get(t, 0) + 1
            top_tt = max(tt_counts.items(), key=lambda x: x[1])[0] if tt_counts else None

            if not top_tt:
                if top_surf in ('asphalt', 'paved', 'concrete'):
                    top_tt = 'grade1'
                elif top_surf in ('compacted', 'fine_gravel'):
                    top_tt = 'grade2'
                elif top_surf in ('dirt', 'ground', 'earth'):
                    top_tt = 'grade4'
                elif top_surf in ('rock', 'scree'):
                    top_tt = 'grade5'
                else:
                    top_tt = 'grade2'
            firmness_label = TRACKTYPE_LABELS.get(top_tt, f'Grade {top_tt}')

        else:
            # Fallback heuristic if no overlapping OSM ways were found
            if avg_grade >= 8.0:
                road_class = 'Singletrack Trail'
                surface_label = 'Natural Dirt / Ground'
                firmness_label = 'Grade 4: Soft Dirt (High Mud Risk)'
                top_tt = 'grade4'
            elif avg_grade >= 5.0:
                road_class = 'Forest Road (Doubletrack)'
                surface_label = 'Gravel'
                firmness_label = 'Grade 2: Solid Unpaved (Compacted Gravel)'
                top_tt = 'grade2'
            else:
                road_class = 'Unclassified Gravel Road'
                surface_label = 'Compacted Hardpack'
                firmness_label = 'Grade 2: Solid Unpaved (Compacted Gravel)'
                top_tt = 'grade2'

        climb['roadClass'] = road_class
        climb['surface'] = surface_label
        climb['firmness'] = firmness_label
        climb['tracktype'] = top_tt


def main():
    parser = argparse.ArgumentParser(description="Extract road class, surface, and firmness for climbs along any route")
    parser.add_argument("--route", required=False, help="Target route slug (e.g. tour-divide-2025, colorado-trail)")
    parser.add_argument("--track", required=False, help="Path to route-track.json")
    parser.add_argument("--climbs", required=False, help="Path to climbs.json or climbs.data.ts")
    parser.add_argument("--output", required=False, help="Path to destination climbs file")
    parser.add_argument("--osm-pbf", required=False, help="Path to corridor OSM PBF extract")
    parser.add_argument("--update-ts", action="store_true", help="Also write updates to src/app/data/climbs.data.ts if available")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]  # src/private/tour-divide-27

    if args.route:
        route_dir = project_root / "public" / "data" / "routes" / args.route
        track_path = route_dir / "route-track.json"
        if not track_path.exists():
            track_path = project_root / "public" / "data" / "route-track.json"

        climbs_path = route_dir / "climbs.json"
        if not climbs_path.exists() and args.route == "tour-divide-2025":
            climbs_path = project_root / "src" / "app" / "data" / "climbs.data.ts"

        output_path = Path(args.output) if args.output else route_dir / "climbs.json"

        pbf_path = None
        candidate_pbfs = [
            project_root / "route" / "open-street-map" / f"{args.route}-corridor.osm.pbf",
            project_root / "route" / "open-street-map" / "tour-divide-corridor.osm.pbf",
            Path("/tmp/highways.osm.pbf")
        ]
        for cp in candidate_pbfs:
            if cp.exists():
                pbf_path = cp
                break
    else:
        if not args.track or not args.climbs:
            print("Error: Either --route or both --track and --climbs must be provided.", file=sys.stderr)
            sys.exit(1)
        track_path = Path(args.track)
        climbs_path = Path(args.climbs)
        output_path = Path(args.output) if args.output else climbs_path
        pbf_path = Path(args.osm_pbf) if args.osm_pbf and os.path.exists(args.osm_pbf) else None

    if not track_path.exists():
        print(f"Error: Track file not found at {track_path}", file=sys.stderr)
        sys.exit(1)

    if not climbs_path.exists():
        print(f"Error: Climbs file not found at {climbs_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[CLIMB SURFACES] Loading track from {track_path}...")
    with open(track_path, "r", encoding="utf-8") as f:
        track_data = json.load(f)
    pts = track_data.get("points", [])

    print(f"[CLIMB SURFACES] Loading climbs from {climbs_path}...")
    climbs, fmt = load_climbs(climbs_path)
    print(f"[CLIMB SURFACES] Loaded {len(climbs)} climbs.")

    matched_ways = []
    if pbf_path and pbf_path.exists():
        print(f"[CLIMB SURFACES] Matching OSM ways from {pbf_path}...")
        matched_ways = match_osm_ways(pts, str(pbf_path))
    else:
        print("[CLIMB SURFACES] No OSM PBF found. Using adaptive heuristic climb surface model.")

    enrich_climbs(climbs, matched_ways)

    save_climbs(climbs, output_path, "json" if output_path.suffix == ".json" else fmt)
    print(f"[CLIMB SURFACES] Successfully updated {len(climbs)} climbs saved to {output_path}!")

    if args.update_ts:
        ts_path = project_root / "src" / "app" / "data" / "climbs.data.ts"
        if ts_path.exists():
            save_climbs(climbs, ts_path, "ts")
            print(f"[CLIMB SURFACES] Also updated {ts_path}!")


if __name__ == "__main__":
    main()
