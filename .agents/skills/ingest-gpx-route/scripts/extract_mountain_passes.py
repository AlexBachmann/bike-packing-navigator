#!/usr/bin/env python3
"""
extract_mountain_passes.py - Backward-compatible forwarder for mountain pass and saddle identification.
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
from engine.terrain.climbs import detect_climbs
from engine.terrain.passes import MountainPass, extract_mountain_passes
from engine.utils.io import atomic_write_json, read_json

__all__ = ["extract_mountain_passes", "MountainPass", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract mountain passes and topographic saddles")
    parser.add_argument("--track", required=True, help="Path to route-track.json or GPX")
    parser.add_argument("--output", required=True, help="Output path for passes.json")
    parser.add_argument("--corridor-geojson", help="Optional corridor GeoJSON for pass matching")
    parser.add_argument("--prominence-m", type=float, default=50.0, help="Minimum prominence in meters")
    parser.add_argument("--state", default="", help="Default state/region code")
    args = parser.parse_args(argv)

    track_p = Path(args.track)
    if track_p.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_p)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_p))

    corridor_data = read_json(Path(args.corridor_geojson)) if args.corridor_geojson and Path(args.corridor_geojson).exists() else None
    climbs = detect_climbs(track)
    passes = extract_mountain_passes(
        track,
        corridor_geojson=corridor_data,
        prominence_m=args.prominence_m,
        climbs=climbs,
        default_state=args.state,
    )

    out_p = Path(args.output)
    atomic_write_json(out_p, [p.to_dict() for p in passes])
    print(f"[Passes] Wrote {len(passes)} passes to {out_p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
