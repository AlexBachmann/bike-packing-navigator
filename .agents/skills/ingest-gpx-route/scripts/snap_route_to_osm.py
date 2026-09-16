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
import heapq
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
        """Builds an adjacency graph and connection lookup between ways based on shared or proximate endpoints and T-junctions."""
        self.adjacency: Dict[int, Set[int]] = defaultdict(set)
        self.connections: Dict[int, Dict[int, Tuple[int, int, float]]] = defaultdict(dict)
        v_grid = defaultdict(list)
        v_size = 0.0003  # ~30 meters

        # Index all vertices across all ways
        for w_idx, w in enumerate(self.ways):
            coords = w['coords']
            w['length_m'] = sum(
                haversine_m(coords[k][0], coords[k][1], coords[k + 1][0], coords[k + 1][1])
                for k in range(len(coords) - 1)
            )
            for v_idx, pt in enumerate(coords):
                gx = int(math.floor(pt[1] / v_size))
                gy = int(math.floor(pt[0] / v_size))
                v_grid[(gx, gy)].append((w_idx, v_idx, pt))

        # Check intersections across all multi-way cells (discovers 4-way intersections and crossings as well as endpoints)
        for (gx, gy), items in v_grid.items():
            if len(items) > 1:
                for i in range(len(items)):
                    w1, v1, pt1 = items[i]
                    for j in range(i + 1, len(items)):
                        w2, v2, pt2 = items[j]
                        if w1 != w2:
                            d = haversine_m(pt1[0], pt1[1], pt2[0], pt2[1])
                            if d <= 25.0:
                                self.adjacency[w1].add(w2)
                                self.adjacency[w2].add(w1)
                                if w2 not in self.connections[w1] or d < self.connections[w1][w2][2]:
                                    self.connections[w1][w2] = (v1, v2, d)
                                if w1 not in self.connections[w2] or d < self.connections[w2][w1][2]:
                                    self.connections[w2][w1] = (v2, v1, d)

        # Also check endpoints against 9 neighbor cells in case endpoint is near a grid boundary
        for w_idx, w in enumerate(self.ways):
            coords = w['coords']
            endpoints = [(0, coords[0]), (len(coords) - 1, coords[-1])]
            for j1, pt in endpoints:
                gx = int(math.floor(pt[1] / v_size))
                gy = int(math.floor(pt[0] / v_size))
                for dgx in (-1, 0, 1):
                    for dgy in (-1, 0, 1):
                        if dgx == 0 and dgy == 0:
                            continue
                        for other_w, j2, opt in v_grid.get((gx + dgx, gy + dgy), []):
                            if other_w != w_idx:
                                d = haversine_m(pt[0], pt[1], opt[0], opt[1])
                                if d <= 25.0:
                                    self.adjacency[w_idx].add(other_w)
                                    self.adjacency[other_w].add(w_idx)
                                    if other_w not in self.connections[w_idx] or d < self.connections[w_idx][other_w][2]:
                                        self.connections[w_idx][other_w] = (j1, j2, d)
                                    if w_idx not in self.connections[other_w] or d < self.connections[other_w][w_idx][2]:
                                        self.connections[other_w][w_idx] = (j2, j1, d)

    def are_ways_connected(self, w1: int, w2: int) -> bool:
        """Returns True if w1 and w2 share an endpoint or intersection within 25m, or are reachable within 3 hops."""
        if w1 == w2:
            return True
        if not hasattr(self, 'connections') or not self.connections:
            return False
        if w2 in self.connections.get(w1, {}):
            return True
        return self.find_way_path(w1, w2, max_hops=3, max_distance_m=1200.0) is not None

    def find_way_path(
        self,
        w_start: int,
        w_end: int,
        max_hops: int = 10,
        max_distance_m: float = 2000.0
    ) -> Optional[List[int]]:
        """Finds the shortest sequence of connected ways connecting w_start to w_end using Dijkstra."""
        if w_start == w_end:
            return [w_start]
        if not hasattr(self, 'connections') or not self.connections:
            return None
        if w_end in self.connections.get(w_start, {}):
            return [w_start, w_end]
        if w_start not in self.connections or w_end not in self.connections:
            return None

        # Priority queue: (cost_m, curr_way, path)
        queue: List[Tuple[float, int, List[int]]] = [(0.0, w_start, [w_start])]
        best_cost: Dict[int, float] = {w_start: 0.0}

        while queue:
            dist_so_far, curr, path = heapq.heappop(queue)
            if curr == w_end:
                return path
            if len(path) > max_hops or dist_so_far > max_distance_m:
                continue
            if dist_so_far > best_cost.get(curr, float('inf')):
                continue

            for nxt, (j1, j2, d_gap) in self.connections.get(curr, {}).items():
                if nxt == w_end:
                    new_cost = dist_so_far + d_gap
                    if new_cost <= max_distance_m:
                        return path + [nxt]
                w_len = self.ways[nxt].get('length_m', 50.0)
                new_cost = dist_so_far + d_gap + w_len
                if new_cost < best_cost.get(nxt, float('inf')) and new_cost <= max_distance_m:
                    best_cost[nxt] = new_cost
                    heapq.heappush(queue, (new_cost, nxt, path + [nxt]))

        return None

    def extract_path_geometry(
        self,
        way_path: List[int],
        c_start: Dict[str, Any],
        c_end: Dict[str, Any]
    ) -> List[Tuple[float, float]]:
        """
        Traverses a sequence of connected ways from c_start to c_end,
        extracting all intermediate curve vertices along the road network.
        """
        if not way_path:
            return [(c_end['proj_lat'], c_end['proj_lon'])]

        if len(way_path) == 1:
            w = way_path[0]
            coords = self.ways[w]['coords']
            s1 = c_start['seg_idx'] + c_start['t']
            s2 = c_end['seg_idx'] + c_end['t']
            pts: List[Tuple[float, float]] = []
            if s2 >= s1:
                for v in range(c_start['seg_idx'] + 1, c_end['seg_idx'] + 1):
                    pts.append(coords[v])
            else:
                for v in range(c_start['seg_idx'], c_end['seg_idx'], -1):
                    pts.append(coords[v])
            pts.append((c_end['proj_lat'], c_end['proj_lon']))
            return pts

        pts = []
        # 1. First way: traverse from c_start to junction with next way
        w0 = way_path[0]
        coords0 = self.ways[w0]['coords']
        j_exit, _, _ = self.connections.get(w0, {}).get(way_path[1], (len(coords0) - 1, 0, 0.0))
        s0 = c_start['seg_idx'] + c_start['t']
        if j_exit >= s0:
            for v in range(c_start['seg_idx'] + 1, j_exit + 1):
                pts.append(coords0[v])
        else:
            for v in range(c_start['seg_idx'], j_exit - 1, -1):
                pts.append(coords0[v])

        # 2. Intermediate ways: traverse from entry junction to exit junction
        for i in range(1, len(way_path) - 1):
            w_curr = way_path[i]
            coords_curr = self.ways[w_curr]['coords']
            _, j_entry, _ = self.connections.get(way_path[i - 1], {}).get(w_curr, (0, 0, 0.0))
            j_exit, _, _ = self.connections.get(w_curr, {}).get(way_path[i + 1], (len(coords_curr) - 1, 0, 0.0))
            if j_exit >= j_entry:
                for v in range(j_entry, j_exit + 1):
                    pts.append(coords_curr[v])
            else:
                for v in range(j_entry, j_exit - 1, -1):
                    pts.append(coords_curr[v])

        # 3. Final way: traverse from entry junction to c_end projection
        w_end = way_path[-1]
        coords_end = self.ways[w_end]['coords']
        _, j_entry, _ = self.connections.get(way_path[-2], {}).get(w_end, (0, 0, 0.0))
        s_end = c_end['seg_idx'] + c_end['t']
        if s_end >= j_entry:
            for v in range(j_entry, c_end['seg_idx'] + 1):
                pts.append(coords_end[v])
        else:
            for v in range(j_entry, c_end['seg_idx'], -1):
                pts.append(coords_end[v])

        pts.append((c_end['proj_lat'], c_end['proj_lon']))
        return pts


def find_candidates_for_point(
    network: OsmRoadNetwork,
    lat: float,
    lon: float,
    threshold_m: float = 50.0
) -> List[Dict[str, Any]]:
    """
    Finds road candidate projections within extended search radius of (lat, lon).
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
        'eff_dist': threshold_m + 8.0,  # Penalty so nearby roads are preferred
        'class': 'off_road',
        'is_fallback': True
    }

    if not road_candidates:
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
        return abs(jump_dist - gpx_dist_m) * 0.4 + 10.0

    # Both are on road
    if c1['way_idx'] == c2['way_idx']:
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

        return abs(along_dist - gpx_dist_m) * 0.2

    # Different ways: evaluate connection via shortest path
    trans_dist = haversine_m(c1['proj_lat'], c1['proj_lon'], c2['proj_lat'], c2['proj_lon'])
    w_path = network.find_way_path(c1['way_idx'], c2['way_idx'], max_hops=4, max_distance_m=max(800.0, gpx_dist_m * 2.5))
    if w_path is not None:
        pts = network.extract_path_geometry(w_path, c1, c2)
        path_len = sum(haversine_m(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]) for k in range(len(pts) - 1))
        return abs(path_len - gpx_dist_m) * 0.2 + 3.0
    else:
        # Disconnected ways: apply fixed switching penalty plus progression discrepancy penalty
        return 35.0 + abs(trans_dist - gpx_dist_m) * 0.5


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

    raw_points = densify_track_points(input_points, max_step_m=40.0)

    print(f"\n[OSM Snapper] Starting OSM road snapping for {len(raw_points)} points (threshold={threshold_m}m)...")
    network = OsmRoadNetwork(pmtiles_path)
    network.load_corridor_ways(raw_points, max(threshold_m, 60.0))

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

    # 3. Guidance Polyline Reconstruction & Look-Ahead Curve Bridging
    print(f"[OSM Snapper] Reconstructing curve-aligned guidance line with look-ahead bridging...")
    guidance_coords: List[Tuple[float, float, float]] = []

    snapped_count = sum(1 for c in chosen_cands if not c['is_fallback'])
    fallback_count = sum(1 for c in chosen_cands if c['is_fallback'])
    print(f"[OSM Snapper] Progression summary: {snapped_count} road-snapped points, {fallback_count} off-road fallback points.")

    i = 0
    while i < n:
        curr_cand = chosen_cands[i]
        curr_raw = raw_points[i]

        if i == 0:
            guidance_coords.append((curr_cand['proj_lat'], curr_cand['proj_lon'], curr_raw[2]))
            i += 1
            continue

        prev_cand = chosen_cands[i - 1]
        prev_raw = raw_points[i - 1]

        # If previous point is on a road/trail
        if not prev_cand['is_fallback']:
            if not curr_cand['is_fallback']:
                # Both on road: check if connected along road network (same way or connected ways within 4 hops)
                gpx_dist = haversine_m(prev_raw[0], prev_raw[1], curr_raw[0], curr_raw[1])
                w_path = network.find_way_path(prev_cand['way_idx'], curr_cand['way_idx'], max_hops=4, max_distance_m=max(800.0, gpx_dist * 2.5))
                if w_path is not None:
                    step_pts = network.extract_path_geometry(w_path, prev_cand, curr_cand)
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

                    i += 1
                    continue
            else:
                # curr_cand is fallback (wilderness chord across a curve/switchback)!
                # Look ahead across fallback points to find the first upcoming on-road point
                bridged_to = None
                bridged_path = None
                gpx_accum_dist = 0.0

                for look in range(i, min(i + 12, n)):
                    cand_k = chosen_cands[look]
                    gpx_step = haversine_m(
                        raw_points[look - 1][0], raw_points[look - 1][1],
                        raw_points[look][0], raw_points[look][1]
                    )
                    gpx_accum_dist += gpx_step
                    if gpx_accum_dist > 1800.0:
                        break

                    if not cand_k['is_fallback']:
                        # First on-road point found! Check if reachable along road network
                        w_path = network.find_way_path(prev_cand['way_idx'], cand_k['way_idx'], max_hops=10, max_distance_m=2000.0)
                        if w_path is not None:
                            pts_test = network.extract_path_geometry(w_path, prev_cand, cand_k)
                            p_len = sum(
                                haversine_m(pts_test[m][0], pts_test[m][1], pts_test[m + 1][0], pts_test[m + 1][1])
                                for m in range(len(pts_test) - 1)
                            )
                            if p_len <= max(3.0 * gpx_accum_dist, gpx_accum_dist + 600.0):
                                bridged_to = look
                                bridged_path = w_path
                        # Stop searching further ahead: do not skip past on-road points!
                        break

                if bridged_to is not None and bridged_path is not None:
                    dest_cand = chosen_cands[bridged_to]
                    dest_raw = raw_points[bridged_to]
                    step_pts = network.extract_path_geometry(bridged_path, prev_cand, dest_cand)

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
                        ele = prev_raw[2] + ratio * (dest_raw[2] - prev_raw[2])
                        guidance_coords.append((p[0], p[1], ele))

                    i = bridged_to + 1
                    continue

        # Fallback progression: direct connection to curr_cand
        guidance_coords.append((curr_cand['proj_lat'], curr_cand['proj_lon'], curr_raw[2]))
        i += 1

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
