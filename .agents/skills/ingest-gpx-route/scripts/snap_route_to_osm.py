#!/usr/bin/env python3
"""
snap_route_to_osm.py - OpenStreetMap Road & Trail Snapping Pipeline for Bikepack Navigator.

Snaps raw GPX route coordinates to OSM road/trail centerlines extracted from corridor.pmtiles
(transportation layer) to generate a high-fidelity, road-aligned guidance-track.json:
  - 50m Road Snapping: Centers the guidance line on OSM ways within 50m of the GPX track.
  - Off-Road Fallback: Gracefully retains raw GPX coordinates when > 50m from mapped ways.
  - Topological Continuity: Viterbi sequence optimization prevents erratic jumping across parallel ways.
  - Bikepacking Preference Bias: Prefers tracks, paths, and cycleways over major motorways when equidistant.
  - Road Centerline Curve Following: Traverses road geometry vertices rather than cutting corners.
  - Telemetry Calculation: Computes cumulative kilometers and miles along the guidance line.

Usage:
  python3 snap_route_to_osm.py --route silk-road-mountain-race-2026
  python3 snap_route_to_osm.py --track route-track.json --pmtiles corridor.pmtiles --output guidance-track.json
  python3 snap_route_to_osm.py --all
"""

import argparse
from collections import defaultdict
import gzip
import json
import math
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import mapbox_vector_tile
from pmtiles.reader import Reader, MmapSource
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge


# Highway class penalties for bikepacking preference bias (in equivalent meters)
# Lower is preferred. Distant trails are never chosen over an immediate road (bounded bias).
CLASS_PENALTIES: Dict[str, float] = {
    'track': 0.0,
    'path': 0.0,
    'cycleway': 0.0,
    'bridleway': 0.0,
    'footway': 0.5,
    'pedestrian': 0.5,
    'unclassified': 0.5,
    'living_street': 1.0,
    'service': 1.5,
    'residential': 1.5,
    'tertiary': 2.0,
    'tertiary_link': 2.0,
    'minor': 2.0,
    'secondary': 3.5,
    'secondary_link': 3.5,
    'primary': 4.5,
    'primary_link': 4.5,
    'trunk': 6.0,
    'trunk_link': 6.0,
    'motorway': 8.0,
    'motorway_link': 8.0,
}

NON_CYCLABLE_CLASSES = {'rail', 'transit', 'aerialway', 'ferry'}


def lonlat_to_tile(lon: float, lat: float, zoom: int = 14) -> Tuple[int, int]:
    """Converts longitude, latitude to tile X, Y at zoom level."""
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile


def tile_to_bounds(tx: int, ty: int, zoom: int = 14) -> Tuple[float, float, float, float]:
    """Converts tile coordinates to (min_lon, min_lat, max_lon, max_lat)."""
    n = 2.0 ** zoom
    w = tx / n * 360.0 - 180.0
    e = (tx + 1) / n * 360.0 - 180.0
    n_lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * ty / n))))
    s_lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (ty + 1) / n))))
    return w, s_lat, e, n_lat


def mvt_pixel_to_lonlat(
    z: int, tx: int, ty: int, px: float, py: float, extent: int = 4096
) -> Tuple[float, float]:
    """Converts MVT pixel coordinates (px, py) to WGS84 (lon, lat)."""
    n = 2.0 ** z
    x_norm = tx + px / extent
    y_norm = ty + py / extent
    lon = x_norm / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y_norm / n)))
    return lon, math.degrees(lat_rad)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance in meters between two coordinates."""
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def dist_point_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> Tuple[float, float, float, float]:
    """
    Computes perpendicular distance, interpolation factor t [0, 1],
    and projected coordinates (qx, qy) from point P to segment AB.
    """
    dx = bx - ax
    dy = by - ay
    l2 = dx * dx + dy * dy
    if l2 <= 1e-9:
        d = math.hypot(px - ax, py - ay)
        return d, 0.0, ax, ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    d = math.hypot(px - proj_x, py - proj_y)
    return d, t, proj_x, proj_y


class OsmRoadNetwork:
    """Extracts, merges, and spatially indexes OSM transportation line features from PMTiles."""

    def __init__(self, pmtiles_path: Path):
        self.pmtiles_path = pmtiles_path
        self.ways: List[Dict[str, Any]] = []
        self.grid: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)
        self.grid_size = 0.005  # ~500 meters per spatial cell

    def load_corridor_ways(self, track_points: List[List[float]], threshold_m: float = 50.0):
        """Loads vector tiles along the route, merges connected ways, and indexes segments."""
        buf_deg = threshold_m / 111132.0
        needed_tiles: Set[Tuple[int, int]] = set()

        for pt in track_points:
            lat, lon = pt[0], pt[1]
            tx, ty = lonlat_to_tile(lon, lat, 14)
            needed_tiles.add((tx, ty))
            w, s, e, n = tile_to_bounds(tx, ty, 14)
            near_w = lon - w < buf_deg
            near_e = e - lon < buf_deg
            near_s = lat - s < buf_deg
            near_n = n - lat < buf_deg
            if near_w:
                needed_tiles.add((tx - 1, ty))
            elif near_e:
                needed_tiles.add((tx + 1, ty))
            if near_s:
                needed_tiles.add((tx, ty + 1))
            elif near_n:
                needed_tiles.add((tx, ty - 1))
            if near_w and near_s:
                needed_tiles.add((tx - 1, ty + 1))
            elif near_w and near_n:
                needed_tiles.add((tx - 1, ty - 1))
            elif near_e and near_s:
                needed_tiles.add((tx + 1, ty + 1))
            elif near_e and near_n:
                needed_tiles.add((tx + 1, ty - 1))

        print(f"[OSM Snapper] Scanning {len(needed_tiles)} tiles at z=14 for transportation features...")
        raw_lines_by_class = defaultdict(list)

        with open(self.pmtiles_path, "rb") as f:
            reader = Reader(MmapSource(f))
            decoded_count = 0
            for tx, ty in needed_tiles:
                raw = reader.get(14, tx, ty)
                if not raw:
                    continue
                try:
                    dec = mapbox_vector_tile.decode(gzip.decompress(raw), default_options={'y_coord_down': True})
                except Exception:
                    continue

                if 'transportation' not in dec:
                    continue

                decoded_count += 1
                trans = dec['transportation']
                extent = trans.get('extent', 4096)
                for feat in trans.get('features', []):
                    props = feat.get('properties', {})
                    cls = props.get('class', 'track')
                    if cls in NON_CYCLABLE_CLASSES:
                        continue

                    geom = feat.get('geometry', {})
                    g_type = geom.get('type', '')
                    if g_type == 'LineString':
                        lines = [geom.get('coordinates', [])]
                    elif g_type == 'MultiLineString':
                        lines = geom.get('coordinates', [])
                    else:
                        continue

                    for line in lines:
                        if not isinstance(line, list) or len(line) < 2:
                            continue
                        if not all(isinstance(p, (list, tuple)) and len(p) >= 2 for p in line):
                            continue
                        w_pts = [mvt_pixel_to_lonlat(14, tx, ty, p[0], p[1], extent) for p in line]
                        rounded = [(round(p[0], 6), round(p[1], 6)) for p in w_pts]
                        raw_lines_by_class[cls].append(LineString(rounded))

        # Stitch contiguous segments across tile borders using linemerge
        print(f"[OSM Snapper] Merging roads across {decoded_count} loaded tiles...")
        self.ways = []
        for cls, lines in raw_lines_by_class.items():
            merged = linemerge(lines)
            geoms = [merged] if isinstance(merged, LineString) else (
                merged.geoms if hasattr(merged, 'geoms') else []
            )
            for g in geoms:
                if len(g.coords) >= 2:
                    self.ways.append({
                        'class': cls,
                        'penalty': CLASS_PENALTIES.get(cls, 2.0),
                        'coords': [(lat, lon) for (lon, lat) in g.coords]
                    })

        # Spatially index segments
        total_segs = 0
        for w_idx, w in enumerate(self.ways):
            coords = w['coords']
            for k in range(len(coords) - 1):
                lat1, lon1 = coords[k]
                lat2, lon2 = coords[k + 1]
                gx1, gy1 = int(math.floor(lon1 / self.grid_size)), int(math.floor(lat1 / self.grid_size))
                gx2, gy2 = int(math.floor(lon2 / self.grid_size)), int(math.floor(lat2 / self.grid_size))
                for gx in range(min(gx1, gx2), max(gx1, gx2) + 1):
                    for gy in range(min(gy1, gy2), max(gy1, gy2) + 1):
                        self.grid[(gx, gy)].append((w_idx, k))
                total_segs += 1

        self.build_adjacency()
        print(f"[OSM Snapper] Indexed {total_segs} segments across {len(self.ways)} continuous OSM ways.")

    def build_adjacency(self):
        """Builds an adjacency graph between ways based on shared or proximate endpoints and T-junctions."""
        self.adjacency: Dict[int, Set[int]] = defaultdict(set)
        v_grid = defaultdict(list)
        v_size = 0.0003  # ~30 meters

        # Index all vertices across all ways
        for w_idx, w in enumerate(self.ways):
            for pt in w['coords']:
                gx = int(math.floor(pt[1] / v_size))
                gy = int(math.floor(pt[0] / v_size))
                v_grid[(gx, gy)].append((w_idx, pt))

        # Check endpoints of each way against nearby vertices (discovers intersections & T-junctions)
        for w_idx, w in enumerate(self.ways):
            coords = w['coords']
            for pt in (coords[0], coords[-1]):
                gx = int(math.floor(pt[1] / v_size))
                gy = int(math.floor(pt[0] / v_size))
                for dgx in (-1, 0, 1):
                    for dgy in (-1, 0, 1):
                        for other_w, opt in v_grid.get((gx + dgx, gy + dgy), []):
                            if other_w != w_idx and haversine_m(pt[0], pt[1], opt[0], opt[1]) <= 20.0:
                                self.adjacency[w_idx].add(other_w)
                                self.adjacency[other_w].add(w_idx)

    def are_ways_connected(self, w1: int, w2: int) -> bool:
        """Returns True if w1 and w2 share an endpoint or intersection within 20m."""
        if w1 == w2:
            return True
        if not hasattr(self, 'adjacency') or not self.adjacency:
            return False
        return w2 in self.adjacency.get(w1, set())


def find_candidates_for_point(
    network: OsmRoadNetwork,
    lat: float,
    lon: float,
    threshold_m: float = 50.0
) -> List[Dict[str, Any]]:
    """
    Finds road candidate projections within threshold_m of (lat, lon).
    Returns list of candidate dicts sorted by effective distance.
    Always includes an off-road fallback candidate.
    """
    cos_lat = math.cos(math.radians(lat))
    gx = int(math.floor(lon / network.grid_size))
    gy = int(math.floor(lat / network.grid_size))

    candidate_segs = []
    for dgx in (-1, 0, 1):
        for dgy in (-1, 0, 1):
            candidate_segs.extend(network.grid.get((gx + dgx, gy + dgy), []))

    seen_segs: Set[Tuple[int, int]] = set()
    best_by_way: Dict[int, Dict[str, Any]] = {}

    for w_idx, k in candidate_segs:
        if (w_idx, k) in seen_segs:
            continue
        seen_segs.add((w_idx, k))

        way = network.ways[w_idx]
        lat1, lon1 = way['coords'][k]
        lat2, lon2 = way['coords'][k + 1]

        ax = (lon1 - lon) * 111132.0 * cos_lat
        ay = (lat1 - lat) * 111132.0
        bx = (lon2 - lon) * 111132.0 * cos_lat
        by = (lat2 - lat) * 111132.0

        d, t, qx, qy = dist_point_to_segment(0, 0, ax, ay, bx, by)
        if d <= threshold_m:
            proj_lat = lat1 + t * (lat2 - lat1)
            proj_lon = lon1 + t * (lon2 - lon1)
            penalty = way['penalty']
            eff_dist = d + penalty

            cand = {
                'way_idx': w_idx,
                'seg_idx': k,
                't': t,
                'proj_lat': proj_lat,
                'proj_lon': proj_lon,
                'dist_m': d,
                'eff_dist': eff_dist,
                'class': way['class'],
                'is_fallback': False
            }

            if w_idx not in best_by_way or eff_dist < best_by_way[w_idx]['eff_dist']:
                best_by_way[w_idx] = cand

    road_candidates = sorted(best_by_way.values(), key=lambda c: c['eff_dist'])[:5]

    # Off-road fallback candidate (retains raw GPX coords)
    fallback_cand = {
        'way_idx': -1,
        'seg_idx': -1,
        't': 0.0,
        'proj_lat': lat,
        'proj_lon': lon,
        'dist_m': 0.0,
        'eff_dist': threshold_m + 5.0,  # Penalty so road is preferred if within 50m
        'class': 'off_road',
        'is_fallback': True
    }

    if not road_candidates:
        # Strictly off-road: only fallback with zero penalty
        fallback_cand['eff_dist'] = 0.0
        return [fallback_cand]

    return road_candidates + [fallback_cand]


def compute_transition_cost(
    c1: Dict[str, Any],
    c2: Dict[str, Any],
    gpx_dist_m: float,
    network: OsmRoadNetwork,
    p1: Optional[Any] = None,
    p2: Optional[Any] = None
) -> float:
    """
    Computes topological continuity transition cost between candidate c1 and candidate c2.
    Penalizes jumping between parallel disconnected ways and promotes smooth progression.
    Supports both forward and reverse traversal along OSM ways.
    """
    is_fb1 = c1['is_fallback']
    is_fb2 = c2['is_fallback']

    if is_fb1 and is_fb2:
        return 0.0

    if is_fb1 != is_fb2:
        jump_dist = haversine_m(c1['proj_lat'], c1['proj_lon'], c2['proj_lat'], c2['proj_lon'])
        return abs(jump_dist - gpx_dist_m) * 0.4 + 2.0

    # Both are on road
    if c1['way_idx'] == c2['way_idx']:
        # Same continuous way: compute distance along the way regardless of vertex direction
        way = network.ways[c1['way_idx']]
        coords = way['coords']
        s1 = c1['seg_idx'] + c1['t']
        s2 = c2['seg_idx'] + c2['t']

        start_c, end_c = (c1, c2) if s2 >= s1 else (c2, c1)
        along_dist = 0.0
        curr_lat, curr_lon = start_c['proj_lat'], start_c['proj_lon']
        for seg in range(start_c['seg_idx'], end_c['seg_idx']):
            next_lat, next_lon = coords[seg + 1]
            along_dist += haversine_m(curr_lat, curr_lon, next_lat, next_lon)
            curr_lat, curr_lon = next_lat, next_lon
        along_dist += haversine_m(curr_lat, curr_lon, end_c['proj_lat'], end_c['proj_lon'])

        trans_dist = haversine_m(c1['proj_lat'], c1['proj_lon'], c2['proj_lat'], c2['proj_lon'])

        # Check for genuine spatial backtrack relative to GPX movement
        if p1 is not None and p2 is not None:
            d_lat_gpx = p2[0] - p1[0]
            d_lon_gpx = p2[1] - p1[1]
            d_lat_cand = c2['proj_lat'] - c1['proj_lat']
            d_lon_cand = c2['proj_lon'] - c1['proj_lon']
            dot = d_lat_gpx * d_lat_cand + d_lon_gpx * d_lon_cand
            if dot < 0 and trans_dist > 5.0:
                return 25.0 + trans_dist * 2.0

        return abs(along_dist - gpx_dist_m) * 0.3

    # Different ways: evaluate connection
    trans_dist = haversine_m(c1['proj_lat'], c1['proj_lon'], c2['proj_lat'], c2['proj_lon'])
    is_connected = network.are_ways_connected(c1['way_idx'], c2['way_idx'])
    if is_connected:
        # Connected intersection or nearby junction: modest way-switch penalty
        return abs(trans_dist - gpx_dist_m) * 0.3 + 4.0
    else:
        # Disconnected parallel ways: heavy penalty prevents erratic jumping
        return 35.0 + trans_dist


def densify_track_points(points: List[List[float]], max_step_m: float = 40.0) -> List[List[float]]:
    """Linearly interpolates points along segments longer than max_step_m to bridge way gaps and avoid corner-cutting."""
    if not points or len(points) < 2:
        return points
    densified = [points[0]]
    for i in range(1, len(points)):
        p1 = densified[-1]
        p2 = points[i]
        dist = haversine_m(p1[0], p1[1], p2[0], p2[1])
        if dist > max_step_m:
            steps = int(math.ceil(dist / max_step_m))
            for s in range(1, steps):
                t = s / steps
                lat = p1[0] + t * (p2[0] - p1[0])
                lon = p1[1] + t * (p2[1] - p1[1])
                ele = p1[2] + t * (p2[2] - p1[2])
                km = p1[3] + t * (p2[3] - p1[3])
                mi = p1[4] + t * (p2[4] - p1[4])
                densified.append([lat, lon, ele, km, mi])
        densified.append(p2)
    return densified


def snap_track_to_osm(
    track_data: Dict[str, Any],
    pmtiles_path: Path,
    threshold_m: float = 50.0
) -> Dict[str, Any]:
    """
    Main snapping pipeline: processes route-track.json and corridor.pmtiles
    to generate the high-fidelity road-aligned guidance-track.json.
    """
    input_points = track_data.get('points', [])
    if not input_points:
        return {"total_km": 0.0, "total_miles": 0.0, "points": []}
    if len(input_points) < 2:
        return {
            "total_km": track_data.get("total_km", 0.0),
            "total_miles": track_data.get("total_miles", 0.0),
            "points": input_points
        }

    # Densify coarse tracks (> 40m between points) to preserve trail curvature across long chords
    raw_points = densify_track_points(input_points, max_step_m=40.0)

    print(f"\n[OSM Snapper] Starting OSM road snapping for {len(raw_points)} points (densified from {len(input_points)}, threshold={threshold_m}m)...")
    network = OsmRoadNetwork(pmtiles_path)
    network.load_corridor_ways(raw_points, threshold_m)

    # 1. Candidate Generation
    print(f"[OSM Snapper] Generating candidate projections along track...")
    t0 = time.time()
    candidates_list: List[List[Dict[str, Any]]] = []
    for pt in raw_points:
        cands = find_candidates_for_point(network, pt[0], pt[1], threshold_m)
        candidates_list.append(cands)
    print(f"[OSM Snapper] Candidates evaluated in {time.time() - t0:.2f}s.")

    # 2. Viterbi Sequence Optimization
    print(f"[OSM Snapper] Running Viterbi topological sequence solver...")
    t_vit = time.time()
    n = len(raw_points)
    dp: List[float] = [c['eff_dist'] for c in candidates_list[0]]
    backpointers: List[List[int]] = []

    for i in range(1, n):
        prev_cands = candidates_list[i - 1]
        curr_cands = candidates_list[i]
        gpx_dist = haversine_m(raw_points[i - 1][0], raw_points[i - 1][1], raw_points[i][0], raw_points[i][1])

        new_dp = []
        bp = []
        for c2 in curr_cands:
            best_cost = float('inf')
            best_prev = 0
            for j, c1 in enumerate(prev_cands):
                t_cost = compute_transition_cost(c1, c2, gpx_dist, network, raw_points[i - 1], raw_points[i])
                cost = dp[j] + t_cost + c2['eff_dist']
                if cost < best_cost:
                    best_cost = cost
                    best_prev = j
            new_dp.append(best_cost)
            bp.append(best_prev)

        dp = new_dp
        backpointers.append(bp)

    # Reconstruct optimal sequence
    best_final_idx = min(range(len(dp)), key=lambda k: dp[k])
    chosen_cands: List[Dict[str, Any]] = [None] * n  # type: ignore
    chosen_cands[-1] = candidates_list[-1][best_final_idx]

    curr_idx = best_final_idx
    for i in range(n - 2, -1, -1):
        curr_idx = backpointers[i][curr_idx]
        chosen_cands[i] = candidates_list[i][curr_idx]

    print(f"[OSM Snapper] Optimal path solved in {time.time() - t_vit:.2f}s.")

    # 3. Guidance Polyline Reconstruction & Curve Following
    print(f"[OSM Snapper] Reconstructing curve-aligned guidance line...")
    guidance_coords: List[Tuple[float, float, float]] = []

    snapped_count = sum(1 for c in chosen_cands if not c['is_fallback'])
    fallback_count = sum(1 for c in chosen_cands if c['is_fallback'])
    print(f"[OSM Snapper] Progression summary: {snapped_count} road-snapped points, {fallback_count} off-road fallback points.")

    for i in range(n):
        curr_cand = chosen_cands[i]
        curr_raw = raw_points[i]

        if i == 0:
            guidance_coords.append((curr_cand['proj_lat'], curr_cand['proj_lon'], curr_raw[2]))
            continue

        prev_cand = chosen_cands[i - 1]
        prev_raw = raw_points[i - 1]

        # Check if both consecutive points are snapped to the same OSM way
        if (
            not prev_cand['is_fallback']
            and not curr_cand['is_fallback']
            and prev_cand['way_idx'] == curr_cand['way_idx']
        ):
            way = network.ways[curr_cand['way_idx']]
            coords = way['coords']
            s1 = prev_cand['seg_idx'] + prev_cand['t']
            s2 = curr_cand['seg_idx'] + curr_cand['t']

            step_pts: List[Tuple[float, float]] = []

            if s2 > s1:
                # Forward progression: insert intermediate road vertices between s1 and s2
                seg_start = prev_cand['seg_idx']
                seg_end = curr_cand['seg_idx']
                if seg_end > seg_start:
                    for v_idx in range(seg_start + 1, seg_end + 1):
                        step_pts.append((coords[v_idx][0], coords[v_idx][1]))
            elif s2 < s1:
                # Reverse progression: insert intermediate road vertices in reverse order
                seg_start = prev_cand['seg_idx']
                seg_end = curr_cand['seg_idx']
                if seg_start > seg_end:
                    for v_idx in range(seg_start, seg_end, -1):
                        step_pts.append((coords[v_idx][0], coords[v_idx][1]))

            # Destination point
            step_pts.append((curr_cand['proj_lat'], curr_cand['proj_lon']))

            # Linearly interpolate elevation along intermediate curve points
            total_step_len = 0.0
            last_p = (guidance_coords[-1][0], guidance_coords[-1][1])
            dists = []
            for p in step_pts:
                seg_len = haversine_m(last_p[0], last_p[1], p[0], p[1])
                total_step_len += seg_len
                dists.append(total_step_len)
                last_p = p

            for idx, p in enumerate(step_pts):
                ratio = dists[idx] / total_step_len if total_step_len > 0 else 1.0
                ele = prev_raw[2] + ratio * (curr_raw[2] - prev_raw[2])
                guidance_coords.append((p[0], p[1], ele))
        elif (
            not prev_cand['is_fallback']
            and not curr_cand['is_fallback']
            and network.are_ways_connected(prev_cand['way_idx'], curr_cand['way_idx'])
        ):
            # Connected ways: follow road geometry through shared endpoint if nearby
            w1 = network.ways[prev_cand['way_idx']]
            w2 = network.ways[curr_cand['way_idx']]
            coords1 = w1['coords']
            coords2 = w2['coords']

            junction = None
            best_dist_sum = float('inf')
            cand_dist = haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], curr_cand['proj_lat'], curr_cand['proj_lon'])
            search_radius = max(200.0, cand_dist * 1.5 + 50.0)
            cand_j1 = [
                idx for idx in range(len(coords1))
                if haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], coords1[idx][0], coords1[idx][1]) <= search_radius
            ]
            cand_j2 = [
                idx for idx in range(len(coords2))
                if haversine_m(curr_cand['proj_lat'], curr_cand['proj_lon'], coords2[idx][0], coords2[idx][1]) <= search_radius
            ]

            for j1 in cand_j1:
                p1_j = coords1[j1]
                d1 = haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], p1_j[0], p1_j[1])
                for j2 in cand_j2:
                    p2_j = coords2[j2]
                    d2 = haversine_m(curr_cand['proj_lat'], curr_cand['proj_lon'], p2_j[0], p2_j[1])
                    if haversine_m(p1_j[0], p1_j[1], p2_j[0], p2_j[1]) <= 20.0:
                        if d1 + d2 < best_dist_sum:
                            best_dist_sum = d1 + d2
                            junction = (j1, j2)

            step_pts = []
            if junction:
                j1, j2 = junction
                seg_start1 = prev_cand['seg_idx']
                if j1 > seg_start1:
                    for v_idx in range(seg_start1 + 1, j1):
                        step_pts.append((coords1[v_idx][0], coords1[v_idx][1]))
                elif j1 < seg_start1:
                    for v_idx in range(seg_start1, j1, -1):
                        step_pts.append((coords1[v_idx][0], coords1[v_idx][1]))
                step_pts.append((coords1[j1][0], coords1[j1][1]))

                if haversine_m(coords1[j1][0], coords1[j1][1], coords2[j2][0], coords2[j2][1]) > 2.0:
                    step_pts.append((coords2[j2][0], coords2[j2][1]))

                seg_end2 = curr_cand['seg_idx']
                if j2 < seg_end2:
                    for v_idx in range(j2 + 1, seg_end2 + 1):
                        step_pts.append((coords2[v_idx][0], coords2[v_idx][1]))
                elif j2 > seg_end2:
                    for v_idx in range(j2 - 1, seg_end2, -1):
                        step_pts.append((coords2[v_idx][0], coords2[v_idx][1]))

            step_pts.append((curr_cand['proj_lat'], curr_cand['proj_lon']))

            total_step_len = 0.0
            last_p = (guidance_coords[-1][0], guidance_coords[-1][1])
            dists = []
            for p in step_pts:
                seg_len = haversine_m(last_p[0], last_p[1], p[0], p[1])
                total_step_len += seg_len
                dists.append(total_step_len)
                last_p = p

            for idx, p in enumerate(step_pts):
                ratio = dists[idx] / total_step_len if total_step_len > 0 else 1.0
                ele = prev_raw[2] + ratio * (curr_raw[2] - prev_raw[2])
                guidance_coords.append((p[0], p[1], ele))
        else:
            # Different ways, or to/from fallback: direct connection
            guidance_coords.append((curr_cand['proj_lat'], curr_cand['proj_lon'], curr_raw[2]))

    # 4. Telemetry Calculation (cumulative km and miles with strict monotonicity)
    print(f"[OSM Snapper] Calculating final telemetry and cumulative distances...")
    final_points: List[List[float]] = []
    cum_km = 0.0

    for p in guidance_coords:
        lat_r = round(p[0], 5)
        lon_r = round(p[1], 5)
        ele_r = round(p[2], 1)

        if not final_points:
            final_points.append([lat_r, lon_r, ele_r, 0.0, 0.0])
            continue

        last = final_points[-1]
        step_m = haversine_m(last[0], last[1], lat_r, lon_r)

        # Deduplicate identical consecutive coordinates and sub-resolution micro-steps (< 1.5m)
        if step_m < 1.5 or (lat_r == last[0] and lon_r == last[1]):
            continue

        cum_km += step_m / 1000.0
        cum_mi = cum_km * 0.621371
        final_points.append([
            lat_r,
            lon_r,
            ele_r,
            round(cum_km, 3),
            round(cum_mi, 3)
        ])

    # Ensure the destination finish point is retained
    if guidance_coords and final_points:
        last_guidance = guidance_coords[-1]
        dest_lat = round(last_guidance[0], 5)
        dest_lon = round(last_guidance[1], 5)
        dest_ele = round(last_guidance[2], 1)
        last = final_points[-1]
        if dest_lat != last[0] or dest_lon != last[1]:
            step_m = haversine_m(last[0], last[1], dest_lat, dest_lon)
            if step_m >= 1.5:
                cum_km += step_m / 1000.0
                cum_mi = cum_km * 0.621371
                final_points.append([dest_lat, dest_lon, dest_ele, round(cum_km, 3), round(cum_mi, 3)])
            else:
                final_points[-1][0] = dest_lat
                final_points[-1][1] = dest_lon
                final_points[-1][2] = dest_ele

    total_km = final_points[-1][3] if final_points else 0.0
    total_miles = final_points[-1][4] if final_points else 0.0

    print(f"[OSM Snapper] Generated guidance line with {len(final_points)} vertices ({total_km:.1f} km / {total_miles:.1f} mi).")

    return {
        "total_km": round(total_km, 1),
        "total_miles": round(total_miles, 1),
        "points": final_points
    }


def process_route(route_dir: Path, threshold_m: float = 50.0) -> bool:
    """Processes a single route directory to generate guidance-track.json."""
    track_path = route_dir / "route-track.json"
    pmtiles_path = route_dir / "corridor.pmtiles"
    output_path = route_dir / "guidance-track.json"

    if not track_path.exists():
        print(f"[OSM Snapper] Skipping {route_dir.name}: route-track.json not found.", file=sys.stderr)
        return False
    if not pmtiles_path.exists():
        print(f"[OSM Snapper] Skipping {route_dir.name}: corridor.pmtiles not found.", file=sys.stderr)
        return False

    print(f"\n{'='*70}\n[OSM Snapper] Processing route: {route_dir.name}\n{'='*70}")
    with open(track_path, "r", encoding="utf-8") as f:
        track_data = json.load(f)

    guidance_data = snap_track_to_osm(track_data, pmtiles_path, threshold_m)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(guidance_data, f, separators=(',', ':'))

    print(f"[OSM Snapper] Successfully wrote {output_path} ({len(guidance_data['points'])} points).")
    return True


def main():
    parser = argparse.ArgumentParser(description="OpenStreetMap Road & Trail Snapper for Guidance Polyline")
    parser.add_argument("--route", help="Route directory or route ID under public/data/routes/")
    parser.add_argument("--track", help="Path to input route-track.json")
    parser.add_argument("--pmtiles", help="Path to input corridor.pmtiles")
    parser.add_argument("--output", help="Path to output guidance-track.json")
    parser.add_argument("--threshold-m", type=float, default=50.0, help="Snapping distance threshold in meters (default: 50.0)")
    parser.add_argument("--all", action="store_true", help="Process all routes in public/data/routes with corridor.pmtiles")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[4]
    if not (project_root / "public" / "data" / "routes").exists():
        project_root = Path.cwd()
    routes_dir = project_root / "public" / "data" / "routes"

    if args.all:
        processed = 0
        for r_dir in sorted(routes_dir.iterdir()):
            if r_dir.is_dir() and (r_dir / "corridor.pmtiles").exists() and (r_dir / "route-track.json").exists():
                if process_route(r_dir, args.threshold_m):
                    processed += 1
        print(f"\n[OSM Snapper] Done. Processed {processed} routes.")
        return

    if args.route:
        route_path = Path(args.route)
        if not route_path.is_dir():
            route_path = routes_dir / args.route
        if not route_path.is_dir():
            print(f"Error: Route directory not found: {args.route}", file=sys.stderr)
            sys.exit(1)
        if not process_route(route_path, args.threshold_m):
            sys.exit(1)
        return

    if args.track and args.pmtiles and args.output:
        track_path = Path(args.track)
        pmtiles_path = Path(args.pmtiles)
        out_path = Path(args.output)
        if not track_path.exists():
            print(f"Error: Track not found: {track_path}", file=sys.stderr)
            sys.exit(1)
        if not pmtiles_path.exists():
            print(f"Error: PMTiles not found: {pmtiles_path}", file=sys.stderr)
            sys.exit(1)

        with open(track_path, "r", encoding="utf-8") as f:
            track_data = json.load(f)

        guidance_data = snap_track_to_osm(track_data, pmtiles_path, args.threshold_m)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(guidance_data, f, separators=(',', ':'))
        print(f"[OSM Snapper] Output saved to {out_path}.")
        return

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
