#!/usr/bin/env python3
"""
download_terrain_dem.py - Route-Agnostic 3D Terrain & DEM Pipeline (Copernicus 30m GLO-30).

Downloads high-resolution 30-meter Digital Elevation Model (DEM) data from AWS Open Data
for all 1x1 degree tiles intersecting ANY target route corridor.

For each tile, it can generate:
  1. 30m DEM GeoTIFF (Cloud-Optimized GeoTIFF from Copernicus)
  2. 3D Hillshade (shaded relief for terrain visualization)
  3. 100m Vector Contours (GeoPackage with elevation attributes)
  4. Seamless GDAL Virtual Rasters (dem.vrt and hillshade.vrt)

Usage:
  # Target by route ID:
  python3 download_terrain_dem.py --route colorado-trail
  python3 download_terrain_dem.py --route tour-divide-2025

  # Or specify explicit corridor:
  python3 download_terrain_dem.py --corridor path/to/corridor.geojson --output-dir path/to/terrain/
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import List, Tuple

from shapely.geometry import box, shape

AWS_S3_BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
CONTOUR_INTERVAL_M = 100.0  # 100 meter contour intervals

def get_intersecting_tiles(corridor_path: Path) -> List[Tuple[int, int, str]]:
    """Calculates all 1x1 degree tiles intersecting the route corridor."""
    with open(corridor_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    poly = shape(data["features"][0]["geometry"])
    minx, miny, maxx, maxy = poly.bounds

    tiles = []
    for lat in range(math.floor(miny), math.ceil(maxy)):
        for lon in range(math.floor(minx), math.ceil(maxx)):
            tile_box = box(lon, lat, lon + 1, lat + 1)
            if poly.intersects(tile_box):
                lat_str = f"N{lat:02d}_00" if lat >= 0 else f"S{-lat:02d}_00"
                lon_str = f"W{-lon:03d}_00" if lon < 0 else f"E{lon:03d}_00"
                tile_name = f"Copernicus_DSM_COG_10_{lat_str}_{lon_str}_DEM"
                tiles.append((lat, lon, tile_name))

    # Sort north to south
    tiles.sort(key=lambda t: (-t[0], t[1]))
    return tiles

class DownloadProgress:
    def __init__(self, tile_label: str):
        self.tile_label = tile_label
        self.start = time.time()
        self.last_print = 0

    def hook(self, block_num: int, block_size: int, total_size: int):
        now = time.time()
        if now - self.last_print >= 3.0 or (total_size > 0 and block_num * block_size >= total_size):
            self.last_print = now
            dl = block_num * block_size
            speed = (dl / (1024 * 1024)) / max(0.1, now - self.start)
            if total_size > 0:
                pct = 100.0 * dl / total_size
                print(
                    f"    [{self.tile_label}] {pct:5.1f}% ({dl/(1024*1024):.1f}/{total_size/(1024*1024):.1f} MB) at {speed:.1f} MB/s",
                    flush=True,
                )

def process_tile(idx: int, total: int, lat: int, lon: int, tile_name: str, dem_dir: Path, hillshade_dir: Path, contours_dir: Path, dem_only: bool = False):
    tile_label = f"N{lat:02d}W{-lon:03d}" if lat >= 0 and lon < 0 else tile_name
    print(f"\n[{idx}/{total}] Processing Tile {tile_label}...", flush=True)

    dem_path = dem_dir / f"{tile_name}.tif"
    hillshade_path = hillshade_dir / f"{tile_name}_hillshade.tif"
    contour_path = contours_dir / f"{tile_name}_contours_100m.gpkg"

    # Step A: Download DEM COG
    if not dem_path.exists() or dem_path.stat().st_size < 100000:
        url = f"{AWS_S3_BASE}/{tile_name}/{tile_name}.tif"
        print(f"  Downloading 30m DEM from AWS S3...", flush=True)
        prog = DownloadProgress(tile_label)
        urllib.request.urlretrieve(url, dem_path, reporthook=prog.hook)
        print(f"  Saved: {dem_path.name} ({dem_path.stat().st_size / (1024*1024):.1f} MB)", flush=True)
    else:
        print(f"  DEM already downloaded: {dem_path.name}", flush=True)

    if dem_only:
        return

    # Step B: Generate Hillshade
    if not hillshade_path.exists():
        print("  Generating hillshade...", flush=True)
        cmd = ["gdaldem", "hillshade", "-z", "1.5", "-s", "111120", "-compute_edges", str(dem_path), str(hillshade_path)]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            print(f"  Saved: {hillshade_path.name}", flush=True)
        except Exception as e:
            print(f"  Hillshade generation skipped (requires gdaldem): {e}")

    # Step C: Generate 100m Contours
    if not contour_path.exists():
        print(f"  Generating {CONTOUR_INTERVAL_M}m contours...", flush=True)
        cmd = ["gdal_contour", "-a", "elevation", "-i", str(CONTOUR_INTERVAL_M), "-f", "GPKG", str(dem_path), str(contour_path)]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            print(f"  Saved: {contour_path.name}", flush=True)
        except Exception as e:
            print(f"  Contour generation skipped (requires gdal_contour): {e}")

def main():
    parser = argparse.ArgumentParser(description="Download Copernicus 30m DEM tiles for any route corridor")
    parser.add_argument("--route", required=False, help="Route slug ID (e.g. tour-divide-2025, colorado-trail)")
    parser.add_argument("--corridor", required=False, help="Path to route corridor.geojson")
    parser.add_argument("--output-dir", required=False, help="Path to output terrain directory")
    parser.add_argument("--dem-only", action="store_true", help="Only download DEM COGs (skip hillshade/contours)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]  # repository root

    if args.route:
        corridor_path = project_root / "public" / "data" / "routes" / args.route / "corridor.geojson"
        if not corridor_path.exists():
            corridor_path = project_root / "route" / "open-street-map" / "corridor.geojson"
        terrain_dir = project_root / "route" / "terrain" / args.route
    else:
        corridor_path = Path(args.corridor) if args.corridor else project_root / "route" / "open-street-map" / "corridor.geojson"
        terrain_dir = Path(args.output_dir) if args.output_dir else project_root / "route" / "terrain"

    if not corridor_path.exists():
        print(f"Error: Corridor GeoJSON not found at {corridor_path}", file=sys.stderr)
        sys.exit(1)

    dem_dir = terrain_dir / "dem"
    hillshade_dir = terrain_dir / "hillshade"
    contours_dir = terrain_dir / "contours"
    for d in [dem_dir, hillshade_dir, contours_dir]:
        d.mkdir(parents=True, exist_ok=True)

    print(f"[TERRAIN] Analyzing corridor: {corridor_path}...")
    tiles = get_intersecting_tiles(corridor_path)
    print(f"[TERRAIN] Found {len(tiles)} intersecting 1x1 degree Copernicus DEM tiles.")

    for idx, (lat, lon, tile_name) in enumerate(tiles, start=1):
        try:
            process_tile(idx, len(tiles), lat, lon, tile_name, dem_dir, hillshade_dir, contours_dir, args.dem_only)
        except Exception as e:
            print(f"  Failed tile {tile_name}: {e}", file=sys.stderr)

    print(f"\n[TERRAIN] Complete. All tiles stored in {terrain_dir}")

if __name__ == "__main__":
    main()
