#!/usr/bin/env python3
"""
densify_route_track.py - Backward-compatible forwarder for GPX parsing and track densification.
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

from engine.core.gpx import parse_gpx, parse_gpx_track
from engine.core.models import RoutePoint, RouteTrack
from engine.utils.io import atomic_write_json

__all__ = ["parse_gpx", "parse_gpx_track", "RouteTrack", "RoutePoint", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Parse GPX route and densify track coordinates")
    parser.add_argument("--gpx", required=True, help="Input GPX filepath")
    parser.add_argument("--output", required=True, help="Output route-track.json filepath")
    parser.add_argument("--stats", help="Optional output stats JSON filepath")
    parser.add_argument("--densify-step", type=float, default=100.0, help="Densify step in meters")
    parser.add_argument("--elevation-gain-m", type=float, help="Override calibrated elevation gain")
    parser.add_argument("--smooth-window", type=int, default=0, help="Smoothing window")
    args = parser.parse_args(argv)

    track = parse_gpx_track(args.gpx, densify_step_m=args.densify_step)
    if args.elevation_gain_m is not None:
        track.elevation_gain_m = int(round(args.elevation_gain_m))

    out_p = Path(args.output)
    atomic_write_json(out_p, track.to_route_track_json())
    print(f"[GPX Densifier] Wrote {len(track.points)} points to {out_p}")

    if args.stats:
        stats_p = Path(args.stats)
        atomic_write_json(stats_p, track.to_stats_json())
        print(f"[GPX Densifier] Wrote telemetry stats to {stats_p}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
