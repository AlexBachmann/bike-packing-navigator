#!/usr/bin/env python3
"""
generate_milestones.py - Backward-compatible forwarder for milestone checkpoint generation.
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
from engine.enrichment.milestones import RouteMilestone, generate_route_milestones
from engine.utils.io import atomic_write_json, read_json

__all__ = ["generate_route_milestones", "RouteMilestone", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate route milestones and town resupply intervals")
    parser.add_argument("--track", required=True, help="Path to route-track.json or GPX")
    parser.add_argument("--output", required=True, help="Output milestones JSON path")
    parser.add_argument("--towns", help="Optional towns JSON path")
    parser.add_argument("--interval-miles", type=float, default=35.0, help="Interval in miles (default: 35.0)")
    parser.add_argument("--state", default="", help="Default state/region code")
    parser.add_argument("--start-name", default="Start Trailhead", help="Start location name")
    parser.add_argument("--end-name", default="Finish Terminus", help="End location name")
    args = parser.parse_args(argv)

    track_p = Path(args.track)
    if track_p.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_p)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_p))

    towns = read_json(Path(args.towns)) if args.towns and Path(args.towns).exists() else None
    milestones = generate_route_milestones(
        track,
        towns=towns,
        interval_km=args.interval_miles * 1.60934,
        start_name=args.start_name,
        end_name=args.end_name,
        state=args.state,
    )

    out_p = Path(args.output)
    atomic_write_json(out_p, [m.to_milestone_json() for m in milestones])
    print(f"[Milestones] Wrote {len(milestones)} milestones to {out_p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
