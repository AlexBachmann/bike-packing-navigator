#!/usr/bin/env python3
"""
extract_18km_corridor.py - Backward-compatible forwarder for OSM corridor generation and water extraction.
"""

import argparse
from pathlib import Path
import sys


def _find_project_root() -> Path:
    p = Path(__file__).resolve()
    for parent in p.parents:
        if (parent / "engine").is_dir():
            return parent
    return p.parents[4]


PROJECT_ROOT = _find_project_root()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from engine.core.gpx import parse_gpx_track
from engine.core.models import RouteTrack
from engine.enrichment.water import extract_water_access
from engine.osm.corridor import compute_corridor_bbox, generate_corridor_polygon
from engine.utils.io import atomic_write_json, read_json

__all__ = ["generate_corridor_polygon", "compute_corridor_bbox", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract 18km corridor polygon GeoJSON around track")
    parser.add_argument("--route", help="Target route slug")
    parser.add_argument("--gpx", help="Path to GPX route file")
    parser.add_argument("--track", help="Path to route-track.json")
    parser.add_argument("--output-geojson", help="Output path for corridor.geojson")
    parser.add_argument("--buffer-km", type=float, default=18.0, help="Corridor buffer width in km (default: 18.0)")
    parser.add_argument("--input-pbf", "--osm-pbf", dest="osm_pbf", help="Optional raw OSM PBF extract")
    parser.add_argument("--output-pbf", help="Optional output clipped PBF")
    parser.add_argument("--extract-water-access", action="store_true", help="Extract water access points")
    parser.add_argument("--water-output", help="Output path for water_access.json")
    parser.add_argument("--segment-km", type=float, default=5.0, help="Water throttling segment km (default: 5.0)")
    parser.add_argument("--max-dist-m", type=float, default=250.0, help="Max distance in meters (default: 250.0)")
    args = parser.parse_args(argv)

    if args.route:
        r_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route
        track_path = Path(args.track) if args.track else r_dir / "route-track.json"
        out_geojson = Path(args.output_geojson) if args.output_geojson else r_dir / "corridor.geojson"
    else:
        track_path = Path(args.track) if args.track else (Path(args.gpx) if args.gpx else None)
        out_geojson = Path(args.output_geojson) if args.output_geojson else Path("corridor.geojson")

    if not track_path or not track_path.exists():
        parser.error("Must provide --track, --route, or --gpx pointing to valid file.")

    if track_path.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_path)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_path))

    corridor = generate_corridor_polygon(track, corridor_m=args.buffer_km * 1000.0)
    atomic_write_json(out_geojson, corridor)
    print(f"[Corridor] Wrote {args.buffer_km}km corridor to {out_geojson}")

    if args.extract_water_access:
        water_out = Path(args.water_output) if args.water_output else out_geojson.parent / "water_access.json"
        water_points = extract_water_access(
            corridor,
            track,
            segment_km=args.segment_km,
            max_distance_m=args.max_dist_m,
        )
        atomic_write_json(water_out, [w.to_dict() for w in water_points])
        print(f"[Corridor] Extracted {len(water_points)} water waypoints to {water_out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
