#!/usr/bin/env python3
"""
fetch_dem_cogs.py - Backward-compatible forwarder for Copernicus DEM GLO-30 tile fetching.
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

from engine.terrain.dem import (
    DemTile,
    calculate_intersecting_dem_tiles,
    download_dem_tile,
    get_dem_tile_name,
)
from engine.utils.io import ensure_directory, read_json
from engine.utils.spatial import BoundingBox

__all__ = [
    "calculate_intersecting_dem_tiles",
    "get_dem_tile_name",
    "download_dem_tile",
    "DemTile",
    "main",
]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Download Copernicus 30m DEM COGs for route corridor")
    parser.add_argument("--route", help="Target route slug")
    parser.add_argument("--corridor", help="Path to corridor.geojson")
    parser.add_argument("--output-dir", help="Output directory for DEM tiles")
    parser.add_argument("--dem-only", action="store_true", help="Download DEM only")
    args = parser.parse_args(argv)

    if args.route:
        r_dir = PROJECT_ROOT / "public" / "data" / "routes" / args.route
        corridor_path = Path(args.corridor) if args.corridor else r_dir / "corridor.geojson"
        out_dir = Path(args.output_dir) if args.output_dir else PROJECT_ROOT / "route" / "terrain" / args.route
    else:
        if not args.corridor or not args.output_dir:
            parser.error("Must provide --route or both --corridor and --output-dir.")
        corridor_path = Path(args.corridor)
        out_dir = Path(args.output_dir)

    ensure_directory(out_dir)
    print(f"[DEM Fetcher] Target corridor: {corridor_path}, output: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
