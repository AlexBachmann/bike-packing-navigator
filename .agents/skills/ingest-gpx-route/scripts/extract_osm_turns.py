#!/usr/bin/env python3
"""
extract_osm_turns.py - OpenStreetMap Route Turn & Junction Decision Point Extractor.

Ingests corridor PMTiles (OpenMapTiles transportation layer) and route-track.json
to extract authentic turn-by-turn guidance cues.

Guiding Principle:
A turn notification is ONLY generated when the rider approaches a true junction,
fork, or intersection where there is an option between two or more ways.
Solitary curves, switchbacks, and bends along a single continuous road/trail
(with degree <= 2) are filtered out and suppressed.

Usage:
  python3 .agents/skills/ingest-gpx-route/scripts/extract_osm_turns.py --route tour-divide-2025
  python3 .agents/skills/ingest-gpx-route/scripts/extract_osm_turns.py --route silk-road-mountain-race-2026
  python3 .agents/skills/ingest-gpx-route/scripts/extract_osm_turns.py --all
"""

import argparse
import gzip
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from pmtiles.reader import Reader, MmapSource
import mapbox_vector_tile


def lonlat_to_tile(lon: float, lat: float, zoom: int = 14) -> Tuple[int, int]:
    """Convert longitude, latitude to tile X, Y at a given zoom level."""
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile


def mvt_pixel_to_lonlat(z: int, tx: int, ty: int, px: float, py: float, extent: int = 4096) -> Tuple[float, float]:
    """Convert MVT pixel coordinates (px, py) within tile (z, tx, ty) to WGS84 (lon, lat)."""
    n = 2.0 ** z
    x_norm = tx + px / extent
    y_norm = ty + py / extent
    lon = x_norm / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y_norm / n)))
    lat = math.degrees(lat_rad)
    return lon, lat


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates forward azimuth / bearing in degrees [0, 360) from point 1 to point 2."""
    to_rad = math.pi / 180.0
    phi1 = lat1 * to_rad
    phi2 = lat2 * to_rad
    delta = (lon2 - lon1) * to_rad
    y = math.sin(delta) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta)
    return (math.atan2(y, x) * (180.0 / math.pi) + 360.0) % 360.0


def calculate_deflection_angle(incoming_bearing: float, outgoing_bearing: float) -> float:
    """Calculates signed deflection angle in degrees [-180, +180]."""
    return ((outgoing_bearing - incoming_bearing + 540.0) % 360.0) - 180.0


def classify_direction(deflection_deg: float) -> str:
    """Classifies turn direction from signed deflection angle."""
    abs_angle = abs(deflection_deg)
    is_right = deflection_deg > 0
    if abs_angle >= 120.0:
        return "sharp-right" if is_right else "sharp-left"
    elif abs_angle >= 60.0:
        return "right" if is_right else "left"
    else:
        return "slight-right" if is_right else "slight-left"


def dist_point_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> Tuple[float, float, float]:
    """Returns (distance_meters, projected_x, projected_y) from point P to segment AB in local projected meters."""
    dx = bx - ax
    dy = by - ay
    l2 = dx * dx + dy * dy
    if l2 <= 1e-7:
        d = math.hypot(px - ax, py - ay)
        return d, ax, ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    d = math.hypot(px - proj_x, py - proj_y)
    return d, proj_x, proj_y


class OsmRoadNetwork:
    """Loads and spatially indexes OSM transportation line features from PMTiles."""

    def __init__(self, pmtiles_path: Path):
        self.pmtiles_path = pmtiles_path
        self.reader: Optional[Reader] = None
        self.f_handle = None
        # Segments: list of (lat1, lon1, lat2, lon2, name, road_class)
        self.segments: List[Tuple[float, float, float, float, str, str]] = []
        self.grid: Dict[Tuple[int, int], List[int]] = defaultdict(list)
        self.grid_size = 0.01  # ~1 km spatial cells
        self.loaded_tiles = set()

    def open(self):
        self.f_handle = open(self.pmtiles_path, "rb")
        self.reader = Reader(MmapSource(self.f_handle))

    def close(self):
        if self.f_handle:
            self.f_handle.close()
            self.f_handle = None

    def load_tiles_along_route(self, track_points: List[List[float]], zoom: int = 14):
        """Loads and indexes transportation features for all tiles touching route trackpoints."""
        if not self.reader:
            return

        needed_tiles = set()
        for pt in track_points:
            lat, lon = pt[0], pt[1]
            tx, ty = lonlat_to_tile(lon, lat, zoom)
            for dtx in (-1, 0, 1):
                for dty in (-1, 0, 1):
                    needed_tiles.add((tx + dtx, ty + dty))

        print(f"[OSM Turns] Loading transportation features from {len(needed_tiles)} tiles at z={zoom}...")
        count = 0
        for tx, ty in needed_tiles:
            if (tx, ty) in self.loaded_tiles:
                continue
            self.loaded_tiles.add((tx, ty))

            raw = self.reader.get(zoom, tx, ty)
            if not raw:
                continue

            try:
                dec = mapbox_vector_tile.decode(gzip.decompress(raw))
            except Exception:
                continue

            if "transportation" not in dec:
                continue

            trans = dec["transportation"]
            extent = trans.get("extent", 4096)
            for feat in trans.get("features", []):
                geom = feat.get("geometry", {})
                props = feat.get("properties", {})
                name = props.get("name", "")
                r_class = props.get("class", "track")

                lines = []
                if geom.get("type") == "LineString":
                    lines = [geom.get("coordinates", [])]
                elif geom.get("type") == "MultiLineString":
                    lines = geom.get("coordinates", [])

                for line in lines:
                    if len(line) < 2:
                        continue
                    coords = [mvt_pixel_to_lonlat(zoom, tx, ty, p[0], p[1], extent) for p in line]
                    for k in range(len(coords) - 1):
                        lonA, latA = coords[k]
                        lonB, latB = coords[k + 1]
                        seg_idx = len(self.segments)
                        self.segments.append((latA, lonA, latB, lonB, name, r_class))
                        count += 1

                        # Index into spatial grid cells
                        gx1, gy1 = int(math.floor(lonA / self.grid_size)), int(math.floor(latA / self.grid_size))
                        gx2, gy2 = int(math.floor(lonB / self.grid_size)), int(math.floor(latB / self.grid_size))
                        for gx in range(min(gx1, gx2), max(gx1, gx2) + 1):
                            for gy in range(min(gy1, gy2), max(gy1, gy2) + 1):
                                self.grid[(gx, gy)].append(seg_idx)

        print(f"[OSM Turns] Indexed {count} OSM road segments across route corridor.")

    def find_nearby_segments(
        self, lat: float, lon: float, radius_meters: float = 30.0
    ) -> List[Tuple[Tuple[float, float, float, float, str, str], float, float]]:
        """Finds all road segments within radius_meters of (lat, lon). Returns [(seg, dist, bearing), ...]."""
        cos_lat = math.cos(math.radians(lat))
        gx = int(math.floor(lon / self.grid_size))
        gy = int(math.floor(lat / self.grid_size))

        candidate_indices = set()
        for dgx in (-1, 0, 1):
            for dgy in (-1, 0, 1):
                candidate_indices.update(self.grid.get((gx + dgx, gy + dgy), []))

        results = []
        for idx in candidate_indices:
            seg = self.segments[idx]
            latA, lonA, latB, lonB, name, r_class = seg

            ax = (lonA - lon) * 111132.0 * cos_lat
            ay = (latA - lat) * 111132.0
            bx = (lonB - lon) * 111132.0 * cos_lat
            by = (latB - lat) * 111132.0

            d, _, _ = dist_point_to_segment(0, 0, ax, ay, bx, by)
            if d <= radius_meters:
                b = calculate_bearing(latA, lonA, latB, lonB)
                results.append((seg, d, b))

        return results

    def analyze_junction(
        self, lat: float, lon: float, radius_meters: float = 30.0
    ) -> Tuple[bool, int, str, str]:
        """
        Analyzes road topology at (lat, lon):
        Returns (is_genuine_junction, branch_count, road_name, junction_type).
        is_genuine_junction is True ONLY if branch_count >= 3 or road transitions.
        """
        nearby = self.find_nearby_segments(lat, lon, radius_meters)
        if not nearby:
            return False, 0, "", "straight"

        # Collect bearings of all connected ways radiating from the point
        all_bearings = []
        names = set()
        classes = set()

        for seg, d, b in nearby:
            all_bearings.append(b)
            all_bearings.append((b + 180.0) % 360.0)
            if seg[4]:
                names.add(seg[4])
            if seg[5]:
                classes.add(seg[5])

        # Cluster radiating bearings into distinct angular branches (> 30 deg apart)
        distinct_branches = []
        for b in all_bearings:
            if not any(abs(((b - eb + 540.0) % 360.0) - 180.0) < 30.0 for eb in distinct_branches):
                distinct_branches.append(b)

        branch_count = len(distinct_branches)
        road_name = sorted(names)[0] if names else ""

        if branch_count >= 4:
            return True, branch_count, road_name, "crossroad"
        elif branch_count == 3:
            return True, branch_count, road_name, "fork" if "track" in classes or "path" in classes else "t-junction"
        elif len(names) >= 2 or len(classes) >= 2:
            # Transition between two named roads/classes
            return True, branch_count, road_name, "intersection"

        # Solitary continuous road or trail (degree <= 2)
        return False, branch_count, road_name, "continuous"


def extract_turns_for_route(route_dir: Path) -> List[Dict[str, Any]]:
    """Extracts authentic decision-point TurnCues for a single route directory."""
    track_path = route_dir / "route-track.json"
    pmtiles_path = route_dir / "corridor.pmtiles"

    if not track_path.exists() or not pmtiles_path.exists():
        print(f"[OSM Turns] Skipping {route_dir.name}: missing route-track.json or corridor.pmtiles")
        return []

    with open(track_path, "r", encoding="utf-8") as f:
        track = json.load(f)

    points = track.get("points", [])
    if len(points) < 3:
        return []

    print(f"\n[OSM Turns] Processing {route_dir.name} ({len(points)} track points)...")

    network = OsmRoadNetwork(pmtiles_path)
    try:
        network.open()
        network.load_tiles_along_route(points)

        # Step 1: Detect all track deflections >= 20 deg
        candidate_turns = []
        for i in range(1, len(points) - 1):
            p_prev = points[i - 1]
            p_curr = points[i]
            p_next = points[i + 1]

            b_in = calculate_bearing(p_prev[0], p_prev[1], p_curr[0], p_curr[1])
            b_out = calculate_bearing(p_curr[0], p_curr[1], p_next[0], p_next[1])
            defl = calculate_deflection_angle(b_in, b_out)

            if abs(defl) >= 20.0:
                candidate_turns.append((i, p_curr, defl))

        print(f"[OSM Turns] Found {len(candidate_turns)} initial GPX deflection points.")

        # Step 2: Test candidate points against OSM road network topology
        valid_junctions = []
        for idx, pt, defl in candidate_turns:
            lat, lon, ele, km, mi = pt
            is_junction, branch_count, road_name, j_type = network.analyze_junction(lat, lon, radius_meters=35.0)

            if is_junction:
                direction = classify_direction(defl)
                valid_junctions.append({
                    "mile": round(mi, 3),
                    "km": round(km, 3),
                    "coordinates": [round(lat, 6), round(lon, 6)],
                    "direction": direction,
                    "deflectionDeg": round(defl, 1),
                    "roadName": road_name,
                    "junctionType": j_type,
                    "branchCount": branch_count
                })

        # Step 3: Deduplicate / merge consecutive turns within 100 meters (0.062 miles)
        merged_turns: List[Dict[str, Any]] = []
        for turn in valid_junctions:
            if not merged_turns:
                merged_turns.append(turn)
                continue

            last = merged_turns[-1]
            dist_miles = turn["mile"] - last["mile"]
            if dist_miles < 0.062:  # within ~100m
                # Keep the one with higher deflection or authentic road name
                if abs(turn["deflectionDeg"]) > abs(last["deflectionDeg"]) or (turn["roadName"] and not last["roadName"]):
                    merged_turns[-1] = turn
            else:
                merged_turns.append(turn)

        print(f"[OSM Turns] Extracted {len(merged_turns)} genuine OSM decision-point TurnCues (filtered from {len(candidate_turns)} kinks).")
        return merged_turns

    finally:
        network.close()


def process_route(route_id: str, routes_base: Path):
    route_dir = routes_base / route_id
    turns = extract_turns_for_route(route_dir)
    out_path = route_dir / "turns.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(turns, f, indent=2)
    print(f"[OSM Turns] Saved {len(turns)} turns to {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Extract authentic OSM decision-point TurnCues")
    parser.add_argument("--route", help="Target route directory slug (e.g. tour-divide-2025)")
    parser.add_argument("--all", action="store_true", help="Process all route directories")
    args = parser.parse_args()

    routes_base = Path("public/data/routes")
    if not routes_base.exists():
        routes_base = Path("/Users/alex/htdocs/bike-packing-navigator/public/data/routes")

    if args.all:
        for r_dir in sorted(routes_base.iterdir()):
            if r_dir.is_dir() and (r_dir / "corridor.pmtiles").exists():
                process_route(r_dir.name, routes_base)
    elif args.route:
        process_route(args.route, routes_base)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
