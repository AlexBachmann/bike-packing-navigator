#!/usr/bin/env python3
"""
build_route_pmtiles.py - Backward-compatible forwarder for PMTiles vector archive building and clipping.
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

from engine.tiles.pmtiles import (
    PMTilesArchive,
    PMTilesBuilder,
    PMTilesCorridorExtractor,
    PMTilesSectionSlicer,
)

__all__ = [
    "PMTilesBuilder",
    "PMTilesCorridorExtractor",
    "PMTilesArchive",
    "PMTilesSectionSlicer",
    "main",
]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build or clip route corridor PMTiles archive")
    parser.add_argument("--route-id", "--route", dest="route_id", default="arizona-trail-300", help="Route ID")
    parser.add_argument("--corridor", help="Path to corridor.geojson")
    parser.add_argument("--output", "-o", help="Output .pmtiles filepath")
    parser.add_argument("--minzoom", type=int, default=0, help="Minimum zoom")
    parser.add_argument("--maxzoom", type=int, default=14, help="Maximum zoom")
    parser.add_argument("--source", help="Source PMTiles to extract from")
    parser.add_argument("--validate-only", action="store_true", help="Validate existing archive")
    parser.add_argument("--sections", help="Path to sections JSON")
    args = parser.parse_args(argv)

    route_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route_id
    corridor_path = Path(args.corridor) if args.corridor else route_dir / "corridor.geojson"
    output_path = Path(args.output) if args.output else route_dir / "corridor.pmtiles"

    if args.validate_only:
        with PMTilesArchive(output_path) as archive:
            print(f"[PMTiles] Archive valid: {output_path} (version {archive.header.version})")
        return 0

    if args.source:
        extractor = PMTilesCorridorExtractor(Path(args.source))
        extractor.extract_corridor(corridor_path, output_path, min_zoom=args.minzoom, max_zoom=args.maxzoom)
        print(f"[PMTiles] Extracted corridor tiles to {output_path}")
        return 0

    print(f"[PMTiles] Target archive: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
