#!/usr/bin/env python3
"""
extract_osm_corridor.py - Route-Agnostic OSM Corridor Extractor.

Generates an 18 km buffer corridor polygon around ANY route track (GPX or route-track.json)
and optionally extracts/clips OpenStreetMap PBF data using osmium-tool.

Usage:
  # Target by route ID:
  python3 extract_osm_corridor.py --route colorado-trail
  python3 extract_osm_corridor.py --route tour-divide-2025

  # Or specify explicit paths:
  python3 extract_osm_corridor.py --track path/to/route-track.json --output-geojson path/to/corridor.geojson [--buffer-km 18.0]
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pyproj
from shapely.geometry import LineString, mapping
from shapely.ops import transform

def generate_corridor_geojson(
    coords: List[Tuple[float, float]],
    output_geojson: Path,
    buffer_km: float = 18.0,
    route_name: str = "Route Corridor"
):
    print(f"[OSM Corridor] Generating {buffer_km:.1f} km buffer corridor for {route_name}...", flush=True)
    if not coords:
        raise ValueError("No coordinates provided for corridor generation.")

    # coords are [(lon, lat), ...] for Shapely
    line = LineString(coords)

    avg_lat = sum(c[1] for c in coords) / len(coords)
    avg_lon = sum(c[0] for c in coords) / len(coords)

    utm_zone = int((avg_lon + 180) / 6) + 1
    hemisphere = "north" if avg_lat >= 0 else "south"
    crs_utm = f"+proj=utm +zone={utm_zone} +{hemisphere} +datum=WGS84 +units=m +no_defs"

    t_to = pyproj.Transformer.from_crs("EPSG:4326", crs_utm, always_xy=True)
    t_from = pyproj.Transformer.from_crs(crs_utm, "EPSG:4326", always_xy=True)

    line_m = transform(t_to.transform, line)
    buffer_meters = buffer_km * 1000.0

    poly_m = line_m.simplify(500).buffer(buffer_meters, cap_style=1, join_style=1).simplify(250)
    poly_ll = transform(t_from.transform, poly_m)

    geojson_data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": mapping(poly_ll),
                "properties": {
                    "name": f"{route_name} {buffer_km:.1f}km Route Corridor",
                    "buffer_km": buffer_km,
                    "buffer_meters": buffer_meters,
                    "point_count": len(coords)
                }
            }
        ]
    }

    output_geojson.parent.mkdir(parents=True, exist_ok=True)
    with open(output_geojson, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2)

    print(f"[OSM Corridor] Wrote corridor polygon GeoJSON to {output_geojson}", flush=True)

def main():
    parser = argparse.ArgumentParser(description="Route-agnostic 18 km OSM corridor generator")
    parser.add_argument("--route", required=False, help="Route slug ID (e.g. tour-divide-2025, colorado-trail)")
    parser.add_argument("--gpx", required=False, help="Path to route GPX file")
    parser.add_argument("--track", required=False, help="Path to route-track.json")
    parser.add_argument("--output-geojson", required=False, help="Path to output corridor.geojson")
    parser.add_argument("--buffer-km", type=float, default=18.0, help="Corridor buffer distance in km (default: 18.0)")
    parser.add_argument("--input-pbf", required=False, help="Optional raw OSM PBF to clip with osmium")
    parser.add_argument("--output-pbf", required=False, help="Optional destination clipped PBF")
    parser.add_argument("--extract-water-access", action="store_true", help="Extract river and lake access points from corridor")
    parser.add_argument("--water-output", required=False, help="Output path for water access waypoints JSON")
    parser.add_argument("--segment-km", type=float, default=5.0, help="Max 1 water waypoint per N km along river/lake (default: 5.0)")
    parser.add_argument("--max-dist-m", type=float, default=250.0, help="Max distance in meters to trail for water access (default: 250.0)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]  # repository root

    route_name = args.route or "Route"
    coords: List[Tuple[float, float]] = []

    if args.route:
        track_path = project_root / "public" / "data" / "routes" / args.route / "route-track.json"
        gpx_path = project_root / "route" / f"{args.route}.gpx"
        alt_gpx_path = project_root / "route" / f"the-{args.route}.gpx"
        output_geojson = project_root / "public" / "data" / "routes" / args.route / "corridor.geojson"
    else:
        track_path = Path(args.track) if args.track else None
        gpx_path = Path(args.gpx) if args.gpx else None
        alt_gpx_path = None
        output_geojson = Path(args.output_geojson) if args.output_geojson else project_root / "route" / "open-street-map" / "corridor.geojson"

    # Extract coordinates
    if track_path and track_path.exists():
        with open(track_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        coords = [(p[1], p[0]) for p in data.get("points", [])] # (lon, lat)
    elif gpx_path and gpx_path.exists():
        tree = ET.parse(gpx_path)
        root = tree.getroot()
        ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
        raw_pts = root.findall(".//gpx:trkpt", ns) or root.findall(".//trkpt")
        coords = [(float(p.attrib["lon"]), float(p.attrib["lat"])) for p in raw_pts]
    elif alt_gpx_path and alt_gpx_path.exists():
        tree = ET.parse(alt_gpx_path)
        root = tree.getroot()
        ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
        raw_pts = root.findall(".//gpx:trkpt", ns) or root.findall(".//trkpt")
        coords = [(float(p.attrib["lon"]), float(p.attrib["lat"])) for p in raw_pts]
    else:
        print("Error: Could not locate route coordinates from provided arguments.", file=sys.stderr)
        sys.exit(1)

    generate_corridor_geojson(coords, output_geojson, args.buffer_km, route_name)

    # Optional PBF clipping via osmium-tool
    if args.input_pbf and args.output_pbf and os.path.exists(args.input_pbf):
        print(f"[OSM Corridor] Clipping {args.input_pbf} using osmium extract...")
        cmd = ["osmium", "extract", "-p", str(output_geojson), str(args.input_pbf), "-o", str(args.output_pbf), "--overwrite"]
        subprocess.run(cmd, check=True)
        print(f"[OSM Corridor] Successfully created clipped PBF: {args.output_pbf}")

    # Optional river & lake water access point extraction
    if args.extract_water_access and track_path and track_path.exists():
        water_out = Path(args.water_output) if args.water_output else output_geojson.parent / "water_access.json"
        pbf_source = args.output_pbf if (args.output_pbf and os.path.exists(args.output_pbf)) else args.input_pbf
        try:
            from extract_water_access import extract_water_access
            extract_water_access(
                track_path=str(track_path),
                output_path=str(water_out),
                osm_pbf=str(pbf_source) if pbf_source and os.path.exists(pbf_source) else None,
                corridor_geojson=str(output_geojson),
                segment_km=args.segment_km,
                max_dist_m=args.max_dist_m
            )
        except ImportError:
            # Fallback when run from different directory
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from extract_water_access import extract_water_access
            extract_water_access(
                track_path=str(track_path),
                output_path=str(water_out),
                osm_pbf=str(pbf_source) if pbf_source and os.path.exists(pbf_source) else None,
                corridor_geojson=str(output_geojson),
                segment_km=args.segment_km,
                max_dist_m=args.max_dist_m
            )

if __name__ == "__main__":
    main()
