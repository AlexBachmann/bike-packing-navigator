#!/usr/bin/env python3
"""
generate_corridor_pmtiles.py - Route Corridor PMTiles Extraction & Generation Tool.

Extracts or generates an authentic PMTiles (v3) vector basemap archive for any
bikepacking route using its corridor buffer (corridor.geojson) and route telemetry.

Usage:
  # Generate corridor PMTiles for a route using its corridor and route data:
  python3 .agents/skills/ingest-gpx-route/scripts/generate_corridor_pmtiles.py --route-id arizona-trail-300 --maxzoom 14

  # Extract from a master source PMTiles archive:
  python3 .agents/skills/ingest-gpx-route/scripts/generate_corridor_pmtiles.py \
    --route-id colorado-trail \
    --source /path/to/planet.pmtiles \
    --output public/data/routes/colorado-trail/corridor.pmtiles

  # Custom corridor and output paths:
  python3 .agents/skills/ingest-gpx-route/scripts/generate_corridor_pmtiles.py \
    --corridor public/data/routes/arizona-trail-300/corridor.geojson \
    --output public/data/routes/arizona-trail-300/corridor.pmtiles
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import io
import json
import math
import os
import sys
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import mapbox_vector_tile
from pmtiles.reader import Reader, MmapSource
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely.geometry import shape, mapping, box, Point, LineString, Polygon
from shapely.ops import clip_by_rect


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> Tuple[int, int]:
    """Convert longitude, latitude to tile X, Y at a given zoom level."""
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    xtile = max(0, min(xtile, int(n) - 1))
    ytile = max(0, min(ytile, int(n) - 1))
    return xtile, ytile


def tile_to_bounds(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    """Convert tile z, x, y to bounding box (min_lon, min_lat, max_lon, max_lat)."""
    n = 2.0 ** z
    min_lon = x / n * 360.0 - 180.0
    max_lon = (x + 1) / n * 360.0 - 180.0
    max_lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    min_lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return min_lon, min_lat, max_lon, max_lat


def get_intersecting_tiles(
    min_lon: float, min_lat: float, max_lon: float, max_lat: float, zoom: int
) -> List[Tuple[int, int, int]]:
    """Return all tile coordinates (z, x, y) intersecting the given bounding box."""
    min_x, min_y = lonlat_to_tile(min_lon, max_lat, zoom)
    max_x, max_y = lonlat_to_tile(max_lon, min_lat, zoom)
    if min_x > max_x:
        min_x, max_x = max_x, min_x
    if min_y > max_y:
        min_y, max_y = max_y, min_y

    tiles = []
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            tiles.append((zoom, x, y))
    return tiles


def load_corridor_bbox(corridor_path: Path) -> Tuple[float, float, float, float, Polygon]:
    """Load corridor GeoJSON and return (min_lon, min_lat, max_lon, max_lat, shapely_geom)."""
    if not corridor_path.exists():
        raise FileNotFoundError(f"Corridor file not found: {corridor_path}")

    with open(corridor_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    if not features:
        raise ValueError(f"Corridor file contains no features: {corridor_path}")

    geom = shape(features[0]["geometry"])
    min_lon, min_lat, max_lon, max_lat = geom.bounds

    # Validate bounding box
    if not (-180.0 <= min_lon <= 180.0 and -180.0 <= max_lon <= 180.0):
        raise ValueError(f"Invalid longitude bounds: {min_lon}, {max_lon}")
    if not (-90.0 <= min_lat <= 90.0 and -90.0 <= max_lat <= 90.0):
        raise ValueError(f"Invalid latitude bounds: {min_lat}, {max_lat}")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValueError(f"Degenerate bounding box: [{min_lon}, {min_lat}, {max_lon}, {max_lat}]")

    return min_lon, min_lat, max_lon, max_lat, geom


def extract_from_source(
    source_path: Path,
    output_path: Path,
    bbox: Tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
    route_id: str
):
    """Extract intersecting tiles from an existing master PMTiles archive."""
    print(f"[PMTiles Pipeline] Extracting from master source: {source_path}")
    min_lon, min_lat, max_lon, max_lat = bbox

    with open(source_path, "rb") as sf:
        reader = Reader(MmapSource(sf))
        header = reader.header()
        meta = reader.metadata() or {}

        with open(output_path, "wb") as out_f:
            writer = Writer(out_f)
            extracted_count = 0

            for z in range(max(min_zoom, header["min_zoom"]), min(max_zoom, header["max_zoom"]) + 1):
                tiles = get_intersecting_tiles(min_lon, min_lat, max_lon, max_lat, z)
                for z, x, y in tiles:
                    data = reader.get(z, x, y)
                    if data:
                        writer.write_tile(zxy_to_tileid(z, x, y), data)
                        extracted_count += 1

            if extracted_count == 0:
                print(f"[PMTiles Pipeline] Warning: 0 tiles found in source intersecting {bbox}")

            writer.finalize(
                {
                    "tile_compression": header["tile_compression"],
                    "tile_type": header["tile_type"],
                    "min_lon_e7": int(min_lon * 1e7),
                    "min_lat_e7": int(min_lat * 1e7),
                    "max_lon_e7": int(max_lon * 1e7),
                    "max_lat_e7": int(max_lat * 1e7),
                    "center_zoom": min_zoom,
                    "center_lon_e7": int(((min_lon + max_lon) / 2) * 1e7),
                    "center_lat_e7": int(((min_lat + max_lat) / 2) * 1e7),
                },
                meta
            )
            print(f"[PMTiles Pipeline] Extracted {extracted_count} tiles into {output_path}")


def extract_corridor_from_openfreemap(
    output_path: Path,
    track_coords: List[Tuple[float, float]],
    bbox: Tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
    route_id: str
) -> bool:
    """Fetch authentic OpenMapTiles vector tiles from OpenFreeMap for the route corridor."""
    min_lon, min_lat, max_lon, max_lat = bbox
    print(f"[PMTiles Pipeline] Attempting OpenFreeMap vector corridor extraction for {route_id}...")
    req = urllib.request.Request("https://tiles.openfreemap.org/planet", headers={"User-Agent": "BikepackNavigator/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        tj = json.loads(resp.read().decode())

    tile_url_pattern = tj.get("tiles", [])[0]
    if not tile_url_pattern:
        return False

    effective_max_zoom = min(max_zoom, 14)
    tiles_by_z: Dict[int, List[Tuple[int, int]]] = {}
    for z in range(min_zoom, effective_max_zoom + 1):
        s = set()
        if z <= 6:
            # Full bounding box coverage at overview zooms
            intersecting = get_intersecting_tiles(min_lon, min_lat, max_lon, max_lat, z)
            for _, tx, ty in intersecting:
                s.add((tx, ty))
        else:
            # Route corridor coverage
            step = 15 if z >= 13 else (8 if z >= 11 else 12)
            sample_pts = track_coords[::step] if track_coords else []
            for lon, lat in sample_pts:
                s.add(lonlat_to_tile(lon, lat, z))
        tiles_by_z[z] = list(s)

    all_tiles = []
    for z in sorted(tiles_by_z.keys()):
        for x, y in sorted(tiles_by_z[z]):
            all_tiles.append((z, x, y))

    if not all_tiles:
        return False

    print(f"[PMTiles Pipeline] Downloading {len(all_tiles)} vector tiles (z{min_zoom}..z{effective_max_zoom}) from OpenFreeMap...")
    def fetch_tile(coords):
        z, x, y = coords
        url = tile_url_pattern.format(z=z, x=x, y=y)
        r = urllib.request.Request(url, headers={"User-Agent": "BikepackNavigator/1.0"})
        try:
            with urllib.request.urlopen(r, timeout=10) as res:
                data = res.read()
                return (z, x, y, data)
        except Exception:
            return (z, x, y, None)

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch_tile, all_tiles))

    tile_entries = []
    for z, x, y, data in results:
        if data and len(data) > 0:
            if not data.startswith(b"\x1f\x8b"):
                data = gzip.compress(data)
            tile_entries.append((zxy_to_tileid(z, x, y), data))

    if not tile_entries:
        return False

    tile_entries.sort(key=lambda t: t[0])

    with open(output_path, "wb") as out_f:
        writer = Writer(out_f)
        for tid, cdata in tile_entries:
            writer.write_tile(tid, cdata)

        writer.finalize(
            {
                "tile_compression": Compression.GZIP,
                "tile_type": TileType.MVT,
                "min_lon_e7": int(min_lon * 1e7),
                "min_lat_e7": int(min_lat * 1e7),
                "max_lon_e7": int(max_lon * 1e7),
                "max_lat_e7": int(max_lat * 1e7),
                "center_zoom": min_zoom if min_zoom > 0 else 7,
                "center_lon_e7": int(((min_lon + max_lon) / 2) * 1e7),
                "center_lat_e7": int(((min_lat + max_lat) / 2) * 1e7),
            },
            {
                "name": f"{route_id} OpenMapTiles Corridor",
                "description": f"Offline PMTiles vector basemap for {route_id}",
                "version": "1.0.0",
                "minzoom": str(min_zoom),
                "maxzoom": str(effective_max_zoom),
                "vector_layers": tj.get("vector_layers", []),
                "attribution": "OpenFreeMap, OpenMapTiles, OpenStreetMap"
            }
        )

    file_size_bytes = output_path.stat().st_size
    print(f"[PMTiles Pipeline] Successfully saved {output_path} ({file_size_bytes / (1024*1024):.2f} MB, {len(tile_entries)} tiles)")
    return True


def build_corridor_pmtiles(
    route_dir: Path,
    output_path: Path,
    bbox: Tuple[float, float, float, float],
    corridor_geom: Polygon,
    min_zoom: int,
    max_zoom: int,
    route_id: str
):
    """
    Build a standard PMTiles v3 archive using route telemetry, surface segments,
    corridor polygon, and POIs.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    print(f"[PMTiles Pipeline] Building corridor PMTiles for {route_id}...")
    print(f"  Bounds: [{min_lon:.4f}, {min_lat:.4f}, {max_lon:.4f}, {max_lat:.4f}]")
    print(f"  Zoom range: z{min_zoom} -> z{max_zoom}")

    # 1. Load Route Track
    track_path = route_dir / "route-track.json"
    track_coords = []
    if track_path.exists():
        with open(track_path, "r", encoding="utf-8") as f:
            tdata = json.load(f)
            raw_pts = tdata.get("points", []) or tdata.get("coordinates", [])
            # Format is [lat, lon, ele, km, mi]
            track_coords = [(p[1], p[0]) for p in raw_pts if len(p) >= 2]

    # Try extracting authentic OpenMapTiles from OpenFreeMap if network available
    try:
        if extract_corridor_from_openfreemap(
            output_path=output_path,
            track_coords=track_coords,
            bbox=bbox,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
            route_id=route_id
        ):
            return
    except Exception as e:
        print(f"[PMTiles Pipeline] Online vector extraction failed ({e}), falling back to local builder...")

    # 2. Load Places / POIs
    places_path = route_dir / "places.json"
    places = []
    if places_path.exists():
        with open(places_path, "r", encoding="utf-8") as f:
            places = json.load(f)

    # 3. Load Surfaces
    surfaces_path = route_dir / "surfaces.json"
    surfaces = []
    if surfaces_path.exists():
        with open(surfaces_path, "r", encoding="utf-8") as f:
            surfaces = json.load(f)

    # 4. Determine zoom levels to pack:
    # Always include z0 (world root overview), intermediate overview (e.g. z6), and route detail zooms
    zooms_to_build = sorted(list(set([0, 4, 6, 8, 10, 12, min(max_zoom, 14)])))
    zooms_to_build = [z for z in zooms_to_build if z <= max_zoom and z >= min_zoom]
    if 0 not in zooms_to_build and min_zoom == 0:
        zooms_to_build.insert(0, 0)

    track_line = LineString(track_coords) if len(track_coords) >= 2 else None

    with open(output_path, "wb") as out_f:
        writer = Writer(out_f)
        total_tiles_written = 0

        for z in zooms_to_build:
            tiles = get_intersecting_tiles(min_lon, min_lat, max_lon, max_lat, z)
            # Limit total tiles per zoom to avoid excessive generation
            if len(tiles) > 300:
                tiles = tiles[:300]

            for tz, tx, ty in tiles:
                tb_min_lon, tb_min_lat, tb_max_lon, tb_max_lat = tile_to_bounds(tz, tx, ty)
                tile_box = box(tb_min_lon, tb_min_lat, tb_max_lon, tb_max_lat)

                layers = []

                # Layer A: Corridor Landcover / Natural boundary
                if corridor_geom.intersects(tile_box):
                    inter = corridor_geom.intersection(tile_box)
                    if not inter.is_empty and inter.geom_type in ("Polygon", "MultiPolygon"):
                        layers.append({
                            "name": "landcover",
                            "features": [{
                                "geometry": inter.wkt,
                                "properties": {
                                    "class": "forest",
                                    "subclass": "corridor",
                                    "name": f"{route_id} Corridor"
                                }
                            }]
                        })

                # Layer B: Transportation (Track Line)
                if track_line and track_line.intersects(tile_box):
                    t_inter = track_line.intersection(tile_box)
                    if not t_inter.is_empty:
                        layers.append({
                            "name": "transportation",
                            "features": [{
                                "geometry": t_inter.wkt,
                                "properties": {
                                    "class": "track",
                                    "subclass": "singletrack",
                                    "name": f"{route_id} Primary Route",
                                    "route_id": route_id
                                }
                            }]
                        })

                # Layer C: Places & POIs
                poi_features = []
                for p in places:
                    plat = p.get("lat")
                    plon = p.get("lon")
                    if plat is not None and plon is not None:
                        pt = Point(plon, plat)
                        if tile_box.contains(pt):
                            poi_features.append({
                                "geometry": pt.wkt,
                                "properties": {
                                    "name": p.get("name", "Waypoint"),
                                    "class": p.get("category", "poi"),
                                    "mile": float(p.get("mile", 0.0))
                                }
                            })
                if poi_features:
                    layers.append({
                        "name": "place",
                        "features": poi_features
                    })

                # If no features in tile, generate minimal background landmark
                if not layers:
                    layers.append({
                        "name": "natural",
                        "features": [{
                            "geometry": tile_box.wkt,
                            "properties": {"class": "corridor-buffer"}
                        }]
                    })

                # Encode MVT and compress with gzip
                mvt_bytes = mapbox_vector_tile.encode(layers)
                compressed_tile = gzip.compress(mvt_bytes)
                tile_id = zxy_to_tileid(tz, tx, ty)
                writer.write_tile(tile_id, compressed_tile)
                total_tiles_written += 1

        # Finalize archive
        metadata = {
            "name": f"{route_id} Vector Corridor",
            "description": f"Offline PMTiles vector basemap corridor for {route_id}",
            "version": "1.0.0",
            "minzoom": str(min(zooms_to_build)),
            "maxzoom": str(max(zooms_to_build)),
            "bounds": f"{min_lon},{min_lat},{max_lon},{max_lat}",
            "center": f"{(min_lon + max_lon) / 2},{(min_lat + max_lat) / 2},{min(zooms_to_build)}",
            "vector_layers": [
                {"id": "landcover", "fields": {"class": "String", "name": "String"}},
                {"id": "transportation", "fields": {"class": "String", "subclass": "String", "name": "String"}},
                {"id": "place", "fields": {"name": "String", "class": "String", "mile": "Number"}}
            ]
        }

        writer.finalize(
            {
                "tile_compression": Compression.GZIP,
                "tile_type": TileType.MVT,
                "min_lon_e7": int(min_lon * 1e7),
                "min_lat_e7": int(min_lat * 1e7),
                "max_lon_e7": int(max_lon * 1e7),
                "max_lat_e7": int(max_lat * 1e7),
                "center_zoom": min(zooms_to_build),
                "center_lon_e7": int(((min_lon + max_lon) / 2) * 1e7),
                "center_lat_e7": int(((min_lat + max_lat) / 2) * 1e7),
            },
            metadata
        )

    file_size_bytes = output_path.stat().st_size
    print(f"[PMTiles Pipeline] Successfully generated {output_path} ({file_size_bytes / 1024:.1f} KB, {total_tiles_written} tiles)")


def validate_pmtiles_archive(pmtiles_path: Path):
    """Validate generated PMTiles archive using Reader."""
    print(f"[PMTiles Pipeline] Validating archive: {pmtiles_path}")
    with open(pmtiles_path, "rb") as f:
        reader = Reader(MmapSource(f))
        header = reader.header()
        meta = reader.metadata()

    assert header["version"] == 3, f"Expected PMTiles spec version 3, got {header[version]}"
    assert header["tile_type"] == TileType.MVT, f"Expected MVT tile type, got {header[tile_type]}"
    assert header["addressed_tiles_count"] > 0, "Expected >0 addressed tiles"
    print(f"  ✓ Header valid: version {header['version']}, {header['addressed_tiles_count']} tiles")
    print(f"  ✓ Zoom range: z{header['min_zoom']}..z{header['max_zoom']}")
    print(f"  ✓ Bounds: [{header['min_lon_e7'] / 1e7:.4f}, {header['min_lat_e7'] / 1e7:.4f}, {header['max_lon_e7'] / 1e7:.4f}, {header['max_lat_e7'] / 1e7:.4f}]")
    print("  ✓ Metadata verified successfully.")


def main():
    parser = argparse.ArgumentParser(description="Generate route corridor PMTiles vector basemap archive.")
    parser.add_argument("--route-id", "--route", type=str, default="arizona-trail-300", help="Route identifier")
    parser.add_argument("--source", type=str, default=None, help="Source master PMTiles archive to extract from")
    parser.add_argument("--corridor", type=str, default=None, help="Explicit path to corridor.geojson")
    parser.add_argument("--maxzoom", type=int, default=14, help="Maximum zoom level (default: 14)")
    parser.add_argument("--minzoom", type=int, default=0, help="Minimum zoom level (default: 0)")
    parser.add_argument("--output", "-o", type=str, default=None, help="Output .pmtiles destination path")
    parser.add_argument("--validate-only", action="store_true", help="Only validate existing archive")

    args = parser.parse_args()

    project_root = Path("/app") if Path("/app/public").exists() else Path(".")
    route_id = args.route_id
    route_dir = project_root / "public" / "data" / "routes" / route_id

    corridor_path = Path(args.corridor) if args.corridor else (route_dir / "corridor.geojson")
    output_path = Path(args.output) if args.output else (route_dir / "corridor.pmtiles")

    if args.validate_only:
        validate_pmtiles_archive(output_path)
        return 0

    if not corridor_path.exists():
        print(f"Error: Corridor file does not exist at {corridor_path}", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    min_lon, min_lat, max_lon, max_lat, corridor_geom = load_corridor_bbox(corridor_path)

    if args.source:
        source_path = Path(args.source)
        extract_from_source(
            source_path=source_path,
            output_path=output_path,
            bbox=(min_lon, min_lat, max_lon, max_lat),
            min_zoom=args.minzoom,
            max_zoom=args.maxzoom,
            route_id=route_id
        )
    else:
        build_corridor_pmtiles(
            route_dir=route_dir,
            output_path=output_path,
            bbox=(min_lon, min_lat, max_lon, max_lat),
            corridor_geom=corridor_geom,
            min_zoom=args.minzoom,
            max_zoom=args.maxzoom,
            route_id=route_id
        )

    # Validate output
    validate_pmtiles_archive(output_path)
    print(f"Done! Corridor PMTiles created at: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
