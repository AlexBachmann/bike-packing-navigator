#!/usr/bin/env python3
"""
snap_to_roads.py - Backward-compatible forwarder for 50m road snapping.
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
from engine.osm.network import CLASS_PENALTIES, OsmRoadNetwork
from engine.osm.snapping import SnappedGuidanceTrack, SnappingConfig, snap_track_to_osm
from engine.utils.io import atomic_write_json, read_json

__all__ = [
    "snap_track_to_osm",
    "SnappingConfig",
    "SnappedGuidanceTrack",
    "OsmRoadNetwork",
    "CLASS_PENALTIES",
    "main",
]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Snap route track coordinates to OSM roads and trails")
    parser.add_argument("--route", help="Target route slug ID")
    parser.add_argument("--track", help="Path to input route-track.json")
    parser.add_argument("--pmtiles", help="Path to input corridor.pmtiles")
    parser.add_argument("--output", help="Path to output guidance-track.json")
    parser.add_argument("--threshold-m", type=float, default=50.0, help="Snapping threshold in meters (default: 50.0)")
    parser.add_argument("--all", action="store_true", help="Process all routes")
    args = parser.parse_args(argv)

    if args.route:
        r_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route
        track_path = Path(args.track) if args.track else r_dir / "route-track.json"
        pmtiles_path = Path(args.pmtiles) if args.pmtiles else r_dir / "corridor.pmtiles"
        out_path = Path(args.output) if args.output else r_dir / "guidance-track.json"
    else:
        if not args.track or not args.pmtiles or not args.output:
            parser.error("Must provide --route or all of --track, --pmtiles, and --output.")
        track_path, pmtiles_path, out_path = Path(args.track), Path(args.pmtiles), Path(args.output)

    if not track_path.exists():
        parser.error(f"Track file not found: {track_path}")
    if not pmtiles_path.exists():
        parser.error(f"PMTiles file not found: {pmtiles_path}")

    track_data = read_json(track_path)
    track = RouteTrack.from_route_track_json(track_data)
    cfg = SnappingConfig(threshold_m=args.threshold_m)
    guidance = snap_track_to_osm(track, pmtiles_path, config=cfg)
    atomic_write_json(out_path, guidance.to_dict())
    print(f"[OSM Snapper] Output saved to {out_path} ({len(guidance.points)} points).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
