#!/usr/bin/env python3
"""
generate_turn_cues.py - Backward-compatible forwarder for navigation turn cue generation.
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
from engine.osm.turns import (
    TurnCue,
    extract_turn_cues,
    extract_turns_from_pmtiles,
    save_turns_json,
)
from engine.utils.io import read_json

__all__ = ["extract_turns_from_pmtiles", "extract_turn_cues", "save_turns_json", "TurnCue", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract turn-by-turn guidance cues along route")
    parser.add_argument("--route", help="Target route directory slug")
    parser.add_argument("--track", help="Path to input route-track.json or GPX")
    parser.add_argument("--pmtiles", help="Path to input corridor.pmtiles")
    parser.add_argument("--output", help="Path to output turns.json")
    parser.add_argument("--all", action="store_true", help="Process all route directories")
    args = parser.parse_args(argv)

    if args.route:
        r_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route
        track_path = Path(args.track) if args.track else r_dir / "route-track.json"
        pmtiles_path = Path(args.pmtiles) if args.pmtiles else r_dir / "corridor.pmtiles"
        out_path = Path(args.output) if args.output else r_dir / "turns.json"
    else:
        if not args.track or not args.output:
            parser.error("Must provide --route or both --track and --output.")
        track_path = Path(args.track)
        pmtiles_path = Path(args.pmtiles) if args.pmtiles else None
        out_path = Path(args.output)

    if track_path.suffix.lower() == ".gpx":
        track = parse_gpx_track(track_path)
    else:
        track = RouteTrack.from_route_track_json(read_json(track_path))

    if pmtiles_path and pmtiles_path.exists():
        turns = extract_turns_from_pmtiles(track, pmtiles_path)
    else:
        turns = extract_turn_cues(track, network=None)

    save_turns_json(turns, out_path)
    print(f"[Turn Cues] Wrote {len(turns)} turn cues to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
