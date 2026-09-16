#!/usr/bin/env python3
"""
generate_surface_intervals.py - Backward-compatible forwarder for surface interval modeling.
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
from engine.terrain.surfaces import (
    SurfaceInterval,
    clean_and_merge_intervals,
    generate_route_surfaces,
)
from engine.utils.io import atomic_write_json, read_json

__all__ = ["generate_route_surfaces", "clean_and_merge_intervals", "SurfaceInterval", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate surfaces.json for route")
    parser.add_argument("--route", help="Target route slug")
    parser.add_argument("--track", help="Path to input route-track.json or GPX")
    parser.add_argument("--output", help="Path to output surfaces.json")
    parser.add_argument("--osm-pbf", help="Optional OSM corridor PBF extract")
    args = parser.parse_args(argv)

    if args.route:
        r_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route
        track_path = Path(args.track) if args.track else r_dir / "route-track.json"
        out_path = Path(args.output) if args.output else r_dir / "surfaces.json"
    else:
        if not args.track or not args.output:
            parser.error("Either --route or both --track and --output must be provided.")
        track_path, out_path = Path(args.track), Path(args.output)

    if track_path.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_path)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_path))

    intervals = generate_route_surfaces(track)
    atomic_write_json(out_path, [list(iv) for iv in intervals])
    print(f"[Surfaces] Wrote {len(intervals)} intervals to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
