#!/usr/bin/env python3
"""
calculate_route_climbs.py - Backward-compatible forwarder for climb detection and categorization.
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
from engine.terrain.climbs import Climb, detect_climbs
from engine.terrain.passes import extract_mountain_passes
from engine.utils.io import atomic_write_json, read_json

__all__ = ["detect_climbs", "Climb", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Calculate climbs and mountain passes")
    parser.add_argument("--track", required=True, help="Path to route-track.json or GPX")
    parser.add_argument("--output-climbs", required=True, help="Output path for climbs.json")
    parser.add_argument("--output-passes", help="Output path for passes.json")
    parser.add_argument("--state", default="", help="State/province code")
    parser.add_argument("--osm-pbf", help="OSM PBF extract for enrichment")
    args = parser.parse_args(argv)

    track_p = Path(args.track)
    if track_p.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_p)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_p))

    climbs = detect_climbs(track)
    out_climbs = Path(args.output_climbs)
    atomic_write_json(out_climbs, [c.to_dict() for c in climbs])
    print(f"[Climbs] Wrote {len(climbs)} climbs to {out_climbs}")

    if args.output_passes:
        passes = extract_mountain_passes(track, climbs=climbs, default_state=args.state)
        out_passes = Path(args.output_passes)
        atomic_write_json(out_passes, [p.to_dict() for p in passes])
        print(f"[Passes] Wrote {len(passes)} passes to {out_passes}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
