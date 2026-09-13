#!/usr/bin/env python3
"""
extract_osm_corridor.py - Generate an 18 km corridor buffer GeoJSON around a route track.
Optionally extract/clip OSM PBF data for the corridor using osmium-tool.

Usage:
  python3 extract_osm_corridor.py --track <path_to_route_track_json> --output-geojson <path_to_corridor_geojson> [--buffer-km 18]
"""

import argparse
import json
import os
import sys
from typing import List, Tuple
import pyproj
from shapely.geometry import LineString, mapping
from shapely.ops import transform

def generate_corridor(track_path: str, output_geojson: str, buffer_km: float = 18.0):
    if not os.path.exists(track_path):
        raise FileNotFoundError(f"Track file not found: {track_path}")

    print(f"[OSM Corridor] Loading route track: {track_path}")
    with open(track_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    points = data.get("points", [])
    if not points:
        raise ValueError("No points found in route-track.json")

    # Extract (lon, lat) tuples for Shapely LineString
    coords: List[Tuple[float, float]] = [(pt[1], pt[0]) for pt in points]
    print(f"[OSM Corridor] Creating LineString from {len(coords)} coordinates...")
    line = LineString(coords)

    # Transform to an equidistant / conformal projection for accurate metric buffering
    # Using EPSG:3857 (Web Mercator) or EPSG:5070 / local UTM
    # For global support, use World Equidistant Cylindrical or dynamic UTM
    avg_lat = sum(pt[0] for pt in points) / len(points)
    avg_lon = sum(pt[1] for pt in points) / len(points)
    
    # North America Albers (EPSG:5070) or UTM zone for optimal metric buffer
    utm_zone = int((avg_lon + 180) / 6) + 1
    hemisphere = "north" if avg_lat >= 0 else "south"
    crs_utm = f"+proj=utm +zone={utm_zone} +{hemisphere} +datum=WGS84 +units=m +no_defs"

    t_to = pyproj.Transformer.from_crs("EPSG:4326", crs_utm, always_xy=True)
    t_from = pyproj.Transformer.from_crs(crs_utm, "EPSG:4326", always_xy=True)

    line_m = transform(t_to.transform, line)
    buffer_meters = buffer_km * 1000.0
    print(f"[OSM Corridor] Buffering route line by {buffer_km:.1f} km ({buffer_meters:.0f} meters)...")
    
    # Simplify slightly before and after buffer for clean, compact polygon geometry
    poly_m = line_m.simplify(500).buffer(buffer_meters, cap_style=1, join_style=1).simplify(250)
    poly_ll = transform(t_from.transform, poly_m)

    num_vertices = len(poly_ll.exterior.coords) if hasattr(poly_ll, 'exterior') else 'complex'
    print(f"[OSM Corridor] Generated corridor polygon with {num_vertices} vertices.")

    geojson_data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": mapping(poly_ll),
                "properties": {
                    "buffer_km": buffer_km,
                    "buffer_meters": buffer_meters,
                    "route_points": len(points)
                }
            }
        ]
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_geojson)), exist_ok=True)
    with open(output_geojson, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2)

    print(f"[OSM Corridor] Successfully saved corridor GeoJSON to {output_geojson}")

def main():
    parser = argparse.ArgumentParser(description="Generate 18 km route corridor buffer polygon")
    parser.add_argument("--track", required=True, help="Path to input route-track.json")
    parser.add_argument("--output-geojson", required=True, help="Path to output corridor.geojson")
    parser.add_argument("--buffer-km", type=float, default=18.0, help="Buffer radius in km (default: 18)")
    args = parser.parse_args()

    generate_corridor(args.track, args.output_geojson, args.buffer_km)

if __name__ == "__main__":
    main()
