#!/usr/bin/env python3
"""
extract_gpx_waypoints.py - Backward-compatible forwarder for embedded GPX waypoints extraction.
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

from engine.core.models import RouteTrack
from engine.enrichment.waypoints import (
    CustomWaypoint,
    extract_and_project_waypoints,
)
from engine.utils.io import atomic_write_json, read_json

__all__ = ["extract_and_project_waypoints", "CustomWaypoint", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract embedded waypoints from GPX file")
    parser.add_argument("--gpx", required=True, help="Path to input GPX")
    parser.add_argument("--track", required=True, help="Path to route-track.json")
    parser.add_argument("--output-places", required=True, help="Output places JSON path")
    parser.add_argument("--output-towns", required=True, help="Output towns JSON path")
    parser.add_argument("--max-dist-m", type=float, default=5000.0, help="Max distance in meters (default: 5000.0)")
    args = parser.parse_args(argv)

    track_dict = read_json(Path(args.track))
    track = RouteTrack.from_route_track_json(track_dict)
    waypoints = extract_and_project_waypoints(args.gpx, track, max_distance_m=args.max_dist_m)

    places = [w.to_dict() for w in waypoints]
    towns = [w.to_dict() for w in waypoints if w.is_in_town or w.category == "town"]

    atomic_write_json(Path(args.output_places), places)
    atomic_write_json(Path(args.output_towns), towns)
    print(f"[GPX Waypoints] Extracted {len(places)} waypoints and {len(towns)} towns.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
