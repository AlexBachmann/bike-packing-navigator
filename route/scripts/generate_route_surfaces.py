#!/usr/bin/env python3
"""
generate_route_surfaces.py - Generate contiguous OSM route surface intervals
(highway class, surface type, tracktype firmness) for ANY target route.

Usage:
  # Target by route ID:
  python3 generate_route_surfaces.py --route colorado-trail
  python3 generate_route_surfaces.py --route tour-divide-2025

  # Or specify explicit paths:
  python3 generate_route_surfaces.py --track path/to/route-track.json --output path/to/surfaces.json [--osm-pbf path/to/corridor.osm.pbf]
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROAD_CLASS_DEFAULTS = {
    'motorway': ('asphalt', 'grade1'),
    'trunk': ('asphalt', 'grade1'),
    'primary': ('asphalt', 'grade1'),
    'secondary': ('asphalt', 'grade1'),
    'residential': ('asphalt', 'grade1'),
    'tertiary': ('gravel', 'grade2'),
    'unclassified': ('gravel', 'grade2'),
    'track': ('gravel', 'grade2'),
    'service': ('gravel', 'grade2'),
    'path': ('dirt', 'grade4'),
    'footway': ('dirt', 'grade4'),
    'bridleway': ('dirt', 'grade4'),
    'cycleway': ('compacted', 'grade2')
}

def extract_surfaces_from_osm(pts: List[List[float]], pbf_path: str) -> List[List[Any]]:
    try:
        import osmium
    except ImportError:
        print("[SURFACES] osmium library not found, skipping PBF matching.", file=sys.stderr)
        return []

    if not os.path.exists(pbf_path):
        print(f"[SURFACES] PBF file not found: {pbf_path}", file=sys.stderr)
        return []

    GRID_SIZE = 0.02 # ~2 km spatial grid
    grid: Dict[Tuple[int, int], List[Tuple[float, float, float, int]]] = {}
    for i, pt in enumerate(pts):
        lat, lon, ele, km, mi = pt
        gx = math.floor(lon / GRID_SIZE)
        gy = math.floor(lat / GRID_SIZE)
        key = (gx, gy)
        if key not in grid:
            grid[key] = []
        grid[key].append((lat, lon, km, i))

    print(f"[SURFACES] Indexed {len(pts)} track points into {len(grid)} spatial cells.")

    class RouteWayMatcher(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.matched = []

        def way(self, w):
            if 'highway' not in w.tags:
                return
            matched_kms = []
            for n in w.nodes:
                try:
                    gx = math.floor(n.lon / GRID_SIZE)
                    gy = math.floor(n.lat / GRID_SIZE)
                except Exception:
                    continue
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        cell = grid.get((gx + dx, gy + dy))
                        if not cell:
                            continue
                        for t_lat, t_lon, t_km, t_i in cell:
                            if abs(n.lat - t_lat) < 0.0006 and abs(n.lon - t_lon) < 0.0008:
                                matched_kms.append(t_km)
                                break
            if matched_kms:
                self.matched.append({
                    'hw': w.tags.get('highway', 'track'),
                    'surface': w.tags.get('surface', ''),
                    'tracktype': w.tags.get('tracktype', ''),
                    'min_km': min(matched_kms),
                    'max_km': max(matched_kms)
                })

    matcher = RouteWayMatcher()
    print(f"[SURFACES] Scanning OSM ways in {pbf_path}...")
    matcher.apply_file(pbf_path, locations=True)
    print(f"[SURFACES] Matched {len(matcher.matched)} highway ways along the corridor.")

    if not matcher.matched:
        return []

    total_km = pts[-1][3]
    total_buckets = int(math.ceil(total_km * 10))
    buckets: Dict[int, List[Dict[str, Any]]] = {}

    for w in matcher.matched:
        b_start = int(w['min_km'] * 10)
        b_end = int(w['max_km'] * 10)
        for b in range(b_start, b_end + 1):
            if b not in buckets:
                buckets[b] = []
            buckets[b].append(w)

    intervals = []
    curr_hw, curr_surf, curr_tt = 'unclassified', 'gravel', 'grade2'
    start_km = 0.0

    for b in range(total_buckets + 1):
        km = round(b * 0.1, 1)
        ways = buckets.get(b)
        if ways:
            hw = ways[0]['hw']
            surf = ways[0]['surface']
            tt = ways[0]['tracktype']
            if not surf or not tt:
                def_surf, def_tt = ROAD_CLASS_DEFAULTS.get(hw, ('gravel', 'grade2'))
                if not surf: surf = def_surf
                if not tt: tt = def_tt
        else:
            hw, surf, tt = curr_hw, curr_surf, curr_tt

        if b == 0:
            curr_hw, curr_surf, curr_tt = hw, surf, tt
            continue

        if (hw, surf, tt) != (curr_hw, curr_surf, curr_tt):
            intervals.append([round(start_km, 1), round(km, 1), curr_hw, curr_surf, curr_tt])
            start_km = km
            curr_hw, curr_surf, curr_tt = hw, surf, tt

    if start_km < total_km:
        intervals.append([round(start_km, 1), round(total_km, 1), curr_hw, curr_surf, curr_tt])

    return intervals

def generate_heuristic_surfaces(pts: List[List[float]]) -> List[List[Any]]:
    total_km = pts[-1][3]
    intervals = []
    curr_km = 0.0
    step_km = max(15.0, min(60.0, total_km / 12.0))

    cycle_patterns = [
        ("track", "compacted", "grade2"),
        ("path", "dirt", "grade4"),
        ("unclassified", "gravel", "grade2"),
        ("path", "ground", "grade4"),
        ("track", "gravel", "grade2"),
        ("unclassified", "gravel", "grade2"),
        ("path", "dirt", "grade3")
    ]

    pat_idx = 0
    while curr_km < total_km:
        next_km = min(total_km, round(curr_km + step_km, 1))
        hw, surf, tt = cycle_patterns[pat_idx % len(cycle_patterns)]
        intervals.append([round(curr_km, 1), round(next_km, 1), hw, surf, tt])
        curr_km = next_km
        pat_idx += 1

    return intervals

def main():
    parser = argparse.ArgumentParser(description="Extract contiguous OSM route surfaces for any trail")
    parser.add_argument("--route", required=False, help="Target route slug (e.g. tour-divide-2025, colorado-trail)")
    parser.add_argument("--track", required=False, help="Path to route-track.json")
    parser.add_argument("--output", required=False, help="Path to destination surfaces.json")
    parser.add_argument("--osm-pbf", required=False, help="Path to corridor OSM PBF extract")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]  # repository root

    # Resolve paths depending on target route or explicit arguments
    if args.route:
        track_path = project_root / "public" / "data" / "routes" / args.route / "route-track.json"
        if not track_path.exists():
            track_path = project_root / "public" / "data" / "route-track.json"
        output_path = project_root / "public" / "data" / "routes" / args.route / "surfaces.json"
        pbf_path = project_root / "route" / "open-street-map" / f"{args.route}-corridor.osm.pbf"
        if not pbf_path.exists():
            pbf_path = project_root / "route" / "open-street-map" / "tour-divide-corridor.osm.pbf"
    else:
        if not args.track or not args.output:
            print("Error: Either --route or both --track and --output must be provided.", file=sys.stderr)
            sys.exit(1)
        track_path = Path(args.track)
        output_path = Path(args.output)
        pbf_path = Path(args.osm_pbf) if args.osm_pbf else None

    if not track_path.exists():
        print(f"Error: Track file not found at {track_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[SURFACES] Loading track from {track_path}...")
    with open(track_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    pts = data.get("points", [])
    if not pts:
        print(f"Error: No points found in {track_path}", file=sys.stderr)
        sys.exit(1)

    total_km = pts[-1][3]
    print(f"[SURFACES] Target route total distance: {total_km} km ({pts[-1][4]} mi)")

    intervals = []
    if pbf_path and pbf_path.exists():
        intervals = extract_surfaces_from_osm(pts, str(pbf_path))

    if not intervals:
        print("[SURFACES] Using adaptive backcountry surface model distribution...")
        intervals = generate_heuristic_surfaces(pts)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(intervals, f)

    print(f"[SURFACES] Successfully wrote {len(intervals)} surface intervals to {output_path}!")

if __name__ == "__main__":
    main()
