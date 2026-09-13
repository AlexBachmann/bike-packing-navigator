#!/usr/bin/env python3
"""
parse_gpx.py - Parse a GPX route file into the application's route-track.json format
and calculate key telemetry metrics (distance, cumulative gain, bounds, highest point).

Usage:
  python3 parse_gpx.py --gpx <path_to_gpx> --output <path_to_route_track_json> [--stats <path_to_stats_json>]
"""

import argparse
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
from typing import Dict, List, Tuple, Any

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate Great Circle distance in kilometers between two coordinates."""
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def parse_gpx(gpx_path: str) -> Tuple[List[List[float]], Dict[str, Any]]:
    if not os.path.exists(gpx_path):
        raise FileNotFoundError(f"GPX file not found: {gpx_path}")

    print(f"[GPX] Parsing {gpx_path}...")
    tree = ET.parse(gpx_path)
    root = tree.getroot()

    # Support all standard GPX namespaces
    namespaces = [
        {'gpx': 'http://www.topografix.com/GPX/1/1'},
        {'gpx': 'http://www.topografix.com/GPX/1/0'},
        {'gpx': ''}
    ]

    trkpts = []
    for ns in namespaces:
        if ns['gpx']:
            pts = root.findall('.//gpx:trkpt', ns) or root.findall('.//gpx:rtept', ns)
        else:
            pts = root.findall('.//trkpt') or root.findall('.//rtept')
        if pts:
            trkpts = pts
            break

    if not trkpts:
        raise ValueError("No <trkpt> or <rtept> points found in GPX file.")

    print(f"[GPX] Extracted {len(trkpts)} raw points.")

    raw_coords: List[Tuple[float, float, float]] = []
    for pt in trkpts:
        lat = float(pt.attrib['lat'])
        lon = float(pt.attrib['lon'])
        ele_elem = None
        for tag in ('ele', '{http://www.topografix.com/GPX/1/1}ele', '{http://www.topografix.com/GPX/1/0}ele'):
            found = pt.find(tag)
            if found is not None:
                ele_elem = found
                break
        if ele_elem is None:
            for child in pt:
                if child.tag.endswith('ele'):
                    ele_elem = child
                    break
        ele = float(ele_elem.text) if ele_elem is not None and ele_elem.text else 0.0
        raw_coords.append((lat, lon, ele))

    # Process points and compute cumulative distances
    points: List[List[float]] = []
    cum_km = 0.0
    total_gain_m = 0.0
    highest_ele = -9999.0
    highest_coords = (0.0, 0.0)

    min_lat = 90.0
    max_lat = -90.0
    min_lon = 180.0
    max_lon = -180.0

    # Slight threshold for elevation gain summation to ignore minor GPS noise jitter (< 1.5m)
    last_ele = raw_coords[0][2]

    for i, (lat, lon, ele) in enumerate(raw_coords):
        min_lat = min(min_lat, lat)
        max_lat = max(max_lat, lat)
        min_lon = min(min_lon, lon)
        max_lon = max(max_lon, lon)

        if ele > highest_ele:
            highest_ele = ele
            highest_coords = (lat, lon)

        if i > 0:
            prev_lat, prev_lon, _ = raw_coords[i - 1]
            seg_dist = haversine_km(prev_lat, prev_lon, lat, lon)
            cum_km += seg_dist

            ele_diff = ele - last_ele
            if ele_diff > 1.5:
                total_gain_m += ele_diff
                last_ele = ele
            elif ele_diff < -1.5:
                last_ele = ele

        cum_mi = cum_km * 0.621371
        points.append([
            round(lat, 6),
            round(lon, 6),
            round(ele, 1),
            round(cum_km, 3),
            round(cum_mi, 3)
        ])

    total_km = round(cum_km, 1)
    total_miles = round(cum_km * 0.621371, 1)
    elevation_gain_ft = round(total_gain_m * 3.28084)
    elevation_gain_m = round(total_gain_m)
    highest_ele_ft = round(highest_ele * 3.28084)
    highest_ele_m = round(highest_ele)

    stats = {
        "total_km": total_km,
        "total_miles": total_miles,
        "elevation_gain_m": elevation_gain_m,
        "elevation_gain_ft": elevation_gain_ft,
        "highest_elevation_m": highest_ele_m,
        "highest_elevation_ft": highest_ele_ft,
        "highest_coords": [round(highest_coords[0], 5), round(highest_coords[1], 5)],
        "start_coordinates": [round(raw_coords[0][0], 5), round(raw_coords[0][1], 5)],
        "end_coordinates": [round(raw_coords[-1][0], 5), round(raw_coords[-1][1], 5)],
        "bounds": [
            [round(min_lat, 4), round(min_lon, 4)],
            [round(max_lat, 4), round(max_lon, 4)]
        ],
        "point_count": len(points)
    }

    return points, stats

def main():
    parser = argparse.ArgumentParser(description="Convert GPX to route-track.json")
    parser.add_argument("--gpx", required=True, help="Input GPX filepath")
    parser.add_argument("--output", required=True, help="Output route-track.json filepath")
    parser.add_argument("--stats", required=False, help="Optional output telemetry stats JSON filepath")
    args = parser.parse_args()

    points, stats = parse_gpx(args.gpx)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    payload = {
        "total_km": stats["total_km"],
        "total_miles": stats["total_miles"],
        "points": points
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(f"[GPX] Successfully wrote {len(points)} track points to {args.output}")
    print(f"[GPX] Route summary: {stats['total_km']} km ({stats['total_miles']} mi), {stats['elevation_gain_m']}m / {stats['elevation_gain_ft']}ft gain, Peak: {stats['highest_elevation_m']}m ({stats['highest_elevation_ft']}ft)")

    if args.stats:
        os.makedirs(os.path.dirname(os.path.abspath(args.stats)), exist_ok=True)
        with open(args.stats, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)
        print(f"[GPX] Wrote telemetry stats to {args.stats}")

if __name__ == "__main__":
    main()
