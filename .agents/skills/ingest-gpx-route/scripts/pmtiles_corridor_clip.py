#!/usr/bin/env python3
"""
pmtiles_corridor_clip.py - Backward-compatible forwarder for clipping PMTiles archives to corridors.
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

from engine.tiles.pmtiles import PMTilesCorridorExtractor

__all__ = ["PMTilesCorridorExtractor", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Clip master PMTiles archive to route corridor")
    parser.add_argument("--source", required=True, help="Master PMTiles archive to extract from")
    parser.add_argument("--corridor", required=True, help="Path to corridor.geojson")
    parser.add_argument("--output", "-o", required=True, help="Path to output clipped PMTiles")
    parser.add_argument("--minzoom", type=int, default=0, help="Minimum zoom")
    parser.add_argument("--maxzoom", type=int, default=14, help="Maximum zoom")
    args = parser.parse_args(argv)

    extractor = PMTilesCorridorExtractor(Path(args.source))
    extractor.extract_corridor(
        Path(args.corridor),
        Path(args.output),
        min_zoom=args.minzoom,
        max_zoom=args.maxzoom,
    )
    print(f"[PMTiles Clip] Extracted corridor to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
