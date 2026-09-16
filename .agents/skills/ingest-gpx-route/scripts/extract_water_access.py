#!/usr/bin/env python3
"""
extract_water_access.py - Backward-compatible forwarder for backcountry water extraction.
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
from engine.enrichment.water import WaterWaypoint, extract_water_access
from engine.utils.io import atomic_write_json, read_json

__all__ = ["extract_water_access", "WaterWaypoint", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract backcountry water access points")
    parser.add_argument("--track", required=True, help="Path to route-track.json or GPX")
    parser.add_argument("--output", required=True, help="Output water waypoints JSON path")
    parser.add_argument("--osm-pbf", help="Corridor OSM PBF extract")
    parser.add_argument("--corridor", help="Path to corridor.geojson")
    parser.add_argument("--segment-km", type=float, default=5.0, help="Max 1 per N km")
    parser.add_argument("--max-dist-m", type=float, default=250.0, help="Max dist in meters")
    parser.add_argument("--cache", help="Path to cache")
    args = parser.parse_args(argv)

    track_p = Path(args.track)
    if track_p.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_p)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_p))

    corridor_data = {}
    if args.corridor and Path(args.corridor).exists():
        corridor_data = read_json(Path(args.corridor))

    water_points = extract_water_access(
        corridor_data,
        track,
        segment_km=args.segment_km,
        max_distance_m=args.max_dist_m,
    )

    out_p = Path(args.output)
    atomic_write_json(out_p, [w.to_dict() for w in water_points])
    print(f"[Water Access] Wrote {len(water_points)} water waypoints to {out_p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
