#!/usr/bin/env python3
"""
analyze_route_surfaces.py - Backward-compatible forwarder for surface and climb correlation.
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

from engine.terrain.climbs import Climb, annotate_climb_surfaces
from engine.utils.io import atomic_write_json, read_json

__all__ = ["annotate_climb_surfaces", "Climb", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Analyze route climb surfaces and trail firmness")
    parser.add_argument("--route", help="Target route slug")
    parser.add_argument("--track", help="Path to route-track.json")
    parser.add_argument("--climbs", help="Path to climbs.json")
    parser.add_argument("--output", help="Path to output climbs.json")
    parser.add_argument("--osm-pbf", help="Path to corridor OSM PBF")
    parser.add_argument("--update-ts", action="store_true", help="Update climbs.data.ts")
    args = parser.parse_args(argv)

    if args.route:
        r_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route
        climbs_path = Path(args.climbs) if args.climbs else r_dir / "climbs.json"
        out_path = Path(args.output) if args.output else climbs_path
    else:
        if not args.climbs:
            parser.error("Must provide --route or --climbs.")
        climbs_path = Path(args.climbs)
        out_path = Path(args.output) if args.output else climbs_path

    climbs_data = read_json(climbs_path)
    climbs = [Climb.from_dict(c) for c in climbs_data]
    annotated = annotate_climb_surfaces(climbs)
    atomic_write_json(out_path, [c.to_dict() for c in annotated])
    print(f"[Climb Surfaces] Annotated {len(annotated)} climbs in {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
