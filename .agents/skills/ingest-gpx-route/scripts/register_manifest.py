#!/usr/bin/env python3
"""
register_manifest.py - Backward-compatible forwarder for central routes.json registration.
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

from engine.core.manifest import (
    RouteManifestEntry,
    load_manifest,
    register_route,
    save_manifest,
)
from engine.utils.io import read_json

__all__ = ["register_route", "load_manifest", "save_manifest", "RouteManifestEntry", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Register or update route in routes.json manifest")
    parser.add_argument("--routes-json", required=True, help="Path to routes.json")
    parser.add_argument("--id", required=True, help="Route slug ID")
    parser.add_argument("--name", required=True, help="Full Route Name")
    parser.add_argument("--short-name", required=True, help="Short Route Name")
    parser.add_argument("--badge", required=True, help="Badge abbreviation")
    parser.add_argument("--start-location", required=True, help="Start location")
    parser.add_argument("--end-location", required=True, help="End location")
    parser.add_argument("--stats", required=True, help="Path to .stats.json or route-track.json")
    parser.add_argument("--description", required=True, help="Route description")
    parser.add_argument("--checkpoints", default="", help="Comma-separated checkpoints")
    parser.add_argument("--highest-point", default="", help="Highest point")
    parser.add_argument("--iconic-pass", default="", help="Iconic pass")
    args = parser.parse_args(argv)

    stats = read_json(Path(args.stats))
    ckpts = [c.strip() for c in args.checkpoints.split(",") if c.strip()] if args.checkpoints else None

    register_route(
        routes_json_path=Path(args.routes_json),
        route_id=args.id,
        name=args.name,
        short_name=args.short_name,
        badge=args.badge,
        start_location=args.start_location,
        end_location=args.end_location,
        description=args.description,
        stats=stats,
        checkpoints=ckpts,
        highest_point=args.highest_point or None,
        iconic_pass=args.iconic_pass or None,
        verify_files=False,
    )
    print(f"[Manifest] Registered route '{args.id}' in {args.routes_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
