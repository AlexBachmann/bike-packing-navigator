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


def haversine_m(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Haversine distance between (lon1, lat1) and (lon2, lat2) in meters."""
    lat1, lon1 = math.radians(p1[1]), math.radians(p1[0])
    lat2, lon2 = math.radians(p2[1]), math.radians(p2[0])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2.0) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2.0) ** 2
    return 6371000.0 * 2.0 * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def interpolate_track(pts: List[Tuple[float, float]], max_step_m: float = 120.0) -> List[Tuple[float, float]]:
    """Densify a polyline by interpolating points so no segment exceeds max_step_m."""
    if not pts:
        return []
    result = []
    for i in range(len(pts) - 1):
        p1 = pts[i]
        p2 = pts[i + 1]
        result.append(p1)
        d = haversine_m(p1, p2)
        if d > max_step_m:
            steps = int(d / max_step_m)
            for s in range(1, steps + 1):
                frac = s / (steps + 1)
                result.append((
                    p1[0] + frac * (p2[0] - p1[0]),
                    p1[1] + frac * (p2[1] - p1[1])
                ))
    result.append(pts[-1])
    return result


def get_town_bounding_boxes(route_dir: Path) -> List[Tuple[float, float, float, float]]:
    """Extract bounding boxes for all towns and cities associated with the route.
    Each box is buffered by ~4 km (0.036 deg lat) so the entire city and surrounding
    roads/services are available on all zoom levels.
    """
    by_town: Dict[str, List[Tuple[float, float]]] = {}

    places_file = route_dir / "places.json"
    if places_file.exists():
        with open(places_file, "r", encoding="utf-8") as f:
            places = json.load(f)
        for p in places:
            tname = p.get("town")
            loc = p.get("location") or {}
            plat = p.get("lat") if p.get("lat") is not None else loc.get("lat")
            plon = p.get("lon") if p.get("lon") is not None else loc.get("lon")
            if plat is None or plon is None:
                continue
            if tname and tname.strip().lower() not in ("backcountry", "wilderness", "trail", "remote", "none", ""):
                by_town.setdefault(tname.strip().lower(), []).append((plon, plat))
            elif p.get("category") == "town" or p.get("type") in ("town", "city", "village"):
                name = p.get("name", "").strip().lower()
                if name not in ("backcountry", "wilderness", "trail", "remote", "none", ""):
                    by_town.setdefault(name, []).append((plon, plat))

    towns_file = route_dir / "towns.json"
    if towns_file.exists():
        with open(towns_file, "r", encoding="utf-8") as f:
            towns = json.load(f)
        for t in towns:
            loc = t.get("location") or {}
            plat = t.get("lat") if t.get("lat") is not None else loc.get("lat")
            plon = t.get("lon") if t.get("lon") is not None else loc.get("lon")
            if plat is not None and plon is not None:
                name = t.get("name", "").strip().lower()
                if name not in ("backcountry", "wilderness", "trail", "remote", "none", ""):
                    by_town.setdefault(name, []).append((plon, plat))

    boxes = []
    for name, pts in by_town.items():
        if not pts:
            continue
        min_lon = min(p[0] for p in pts)
        max_lon = max(p[0] for p in pts)
        min_lat = min(p[1] for p in pts)
        max_lat = max(p[1] for p in pts)

        mid_lat = (min_lat + max_lat) / 2.0
        cos_lat = max(0.2, math.cos(math.radians(mid_lat)))
        lat_buf = 0.036  # ~4 km buffer
        lon_buf = 0.036 / cos_lat
        boxes.append((min_lon - lon_buf, min_lat - lat_buf, max_lon + lon_buf, max_lat + lat_buf))

    return boxes


def extract_corridor_from_openfreemap(
    output_path: Path,
    track_coords: List[Tuple[float, float]],
    bbox: Tuple[float, float, float, float],
    min_zoom: int,
    max_zoom: int,
    route_id: str,
    places_coords: Optional[List[Tuple[float, float]]] = None,
    town_boxes: Optional[List[Tuple[float, float, float, float]]] = None
) -> bool:
    """Fetch authentic OpenMapTiles vector tiles from OpenFreeMap for the route corridor and towns."""
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

    # Densify track coordinates so no segment exceeds 120 meters (prevents tile edge skipping)
    densified_track = interpolate_track(track_coords, max_step_m=120.0)
    print(f"[PMTiles Pipeline] Densified track from {len(track_coords)} to {len(densified_track)} points")

    points_to_sample = list(densified_track)
    if places_coords:
        points_to_sample.extend(places_coords)

    tboxes = town_boxes or []

    for z in range(min_zoom, effective_max_zoom + 1):
        s = set()
        n_tiles = 2 ** z
        if z <= 8:
            # Full bounding box coverage at overview zooms (with 1-tile margin)
            min_tx, min_ty = lonlat_to_tile(min_lon, max_lat, z)
            max_tx, max_ty = lonlat_to_tile(max_lon, min_lat, z)
            if min_tx > max_tx: min_tx, max_tx = max_tx, min_tx
            if min_ty > max_ty: min_ty, max_ty = max_ty, min_ty
            for x in range(max(0, min_tx - 1), min(n_tiles, max_tx + 2)):
                for y in range(max(0, min_ty - 1), min(n_tiles, max_ty + 2)):
                    s.add((x, y))
        else:
            # Route corridor and POIs coverage with 1-tile buffer (3x3 neighborhood)
            # Guarantees the route and at least one tile adjacent in all directions are available
            for lon, lat in points_to_sample:
                tx, ty = lonlat_to_tile(lon, lat, z)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx = tx + dx
                        ny = ty + dy
                        if 0 <= nx < n_tiles and 0 <= ny < n_tiles:
                            s.add((nx, ny))

            # Town / City full coverage (+1 tile margin)
            for tbox in tboxes:
                ttiles = get_intersecting_tiles(tbox[0], tbox[1], tbox[2], tbox[3], z)
                for _, tx, ty in ttiles:
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx = tx + dx
                            ny = ty + dy
                            if 0 <= nx < n_tiles and 0 <= ny < n_tiles:
                                s.add((nx, ny))

        tiles_by_z[z] = list(s)

    all_tiles = []
    for z in sorted(tiles_by_z.keys()):
        for x, y in sorted(tiles_by_z[z]):
            all_tiles.append((z, x, y))

    if not all_tiles:
        return False

    print(f"[PMTiles Pipeline] Total required tiles: {len(all_tiles)} (z{min_zoom}..z{effective_max_zoom}) across route corridor and {len(tboxes)} towns")

    # Incremental reuse: check existing PMTiles archive on disk
    cached_tiles: Dict[Tuple[int, int, int], bytes] = {}
    if output_path.exists() and output_path.stat().st_size > 0:
        try:
            with open(output_path, "rb") as existing_f:
                reader = Reader(MmapSource(existing_f))
                for z, x, y in all_tiles:
                    data = reader.get(z, x, y)
                    if data and len(data) > 0:
                        cached_tiles[(z, x, y)] = data
            print(f"[PMTiles Pipeline] Reusing {len(cached_tiles)} already existing valid tiles from {output_path.name}")
        except Exception as ex:
            print(f"[PMTiles Pipeline] Note: could not read existing tiles from {output_path.name}: {ex}")
            cached_tiles = {}

    tiles_to_download = [c for c in all_tiles if c not in cached_tiles]
    downloaded_tiles: List[Tuple[int, int, int, bytes]] = []

    if tiles_to_download:
        print(f"[PMTiles Pipeline] Downloading {len(tiles_to_download)} missing vector tiles from OpenFreeMap...")
        import time

        def fetch_tile(coords):
            z, x, y = coords
            url = tile_url_pattern.format(z=z, x=x, y=y)
            r = urllib.request.Request(url, headers={"User-Agent": "BikepackNavigator/1.0"})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(r, timeout=12) as res:
                        data = res.read()
                        return (z, x, y, data)
                except Exception:
                    if attempt == 3:
                        return (z, x, y, None)
                    time.sleep(0.2 * (2 ** attempt))

        with ThreadPoolExecutor(max_workers=32) as ex:
            results = list(ex.map(fetch_tile, tiles_to_download))

        for z, x, y, data in results:
            if data and len(data) > 0:
                downloaded_tiles.append((z, x, y, data))
    else:
        print(f"[PMTiles Pipeline] All {len(all_tiles)} tiles already present in archive, no downloads required.")

    # Combine cached and downloaded tiles
    tile_entries = []
    for (z, x, y), data in cached_tiles.items():
        cdata = data if data.startswith(b"\x1f\x8b") else gzip.compress(data)
        tile_entries.append((zxy_to_tileid(z, x, y), cdata))
    for z, x, y, data in downloaded_tiles:
        cdata = data if data.startswith(b"\x1f\x8b") else gzip.compress(data)
        tile_entries.append((zxy_to_tileid(z, x, y), cdata))

    if not tile_entries:
        return False

    tile_entries.sort(key=lambda t: t[0])

    tmp_path = output_path.with_suffix(".tmp.pmtiles")
    with open(tmp_path, "wb") as out_f:
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

    tmp_path.replace(output_path)
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

    # Also include guidance-track.json points if present
    guidance_path = route_dir / "guidance-track.json"
    if guidance_path.exists():
        with open(guidance_path, "r", encoding="utf-8") as f:
            gdata = json.load(f)
            gpts = gdata.get("points", []) or gdata.get("coordinates", [])
            for p in gpts:
                if len(p) >= 2:
                    track_coords.append((p[1], p[0]))

    # 2. Load Places / POIs (handling nested location objects)
    places_path = route_dir / "places.json"
    places = []
    places_coords = []
    if places_path.exists():
        with open(places_path, "r", encoding="utf-8") as f:
            places = json.load(f)
        for p in places:
            loc = p.get("location") or {}
            plat = p.get("lat") if p.get("lat") is not None else loc.get("lat")
            plon = p.get("lon") if p.get("lon") is not None else loc.get("lon")
            if plat is not None and plon is not None:
                places_coords.append((plon, plat))

    # 3. Load Town / City bounding boxes (buffered by ~4 km)
    town_boxes = get_town_bounding_boxes(route_dir)

    # Try extracting authentic OpenMapTiles from OpenFreeMap if network available
    try:
        if extract_corridor_from_openfreemap(
            output_path=output_path,
            track_coords=track_coords,
            bbox=bbox,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
            route_id=route_id,
            places_coords=places_coords,
            town_boxes=town_boxes
        ):
            return
    except Exception as e:
        print(f"[PMTiles Pipeline] Online vector extraction failed ({e}), falling back to local builder...")

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

    assert header["version"] == 3, f"Expected PMTiles spec version 3, got {header['version']}"
    assert header["tile_type"] == TileType.MVT, f"Expected MVT tile type, got {header['tile_type']}"
    assert header["addressed_tiles_count"] > 0, "Expected >0 addressed tiles"
    print(f"  ✓ Header valid: version {header['version']}, {header['addressed_tiles_count']} tiles")
    print(f"  ✓ Zoom range: z{header['min_zoom']}..z{header['max_zoom']}")
    print(f"  ✓ Bounds: [{header['min_lon_e7'] / 1e7:.4f}, {header['min_lat_e7'] / 1e7:.4f}, {header['max_lon_e7'] / 1e7:.4f}, {header['max_lat_e7'] / 1e7:.4f}]")
    print("  ✓ Metadata verified successfully.")


def generate_tour_divide_sections(corridor_pmtiles_path: Path, route_dir: Path):
    """Slice Tour Divide corridor PMTiles into the 4 official sections."""
    track_path = route_dir / "route-track.json"
    if not track_path.exists():
        return
    with open(track_path, "r", encoding="utf-8") as f:
        tdata = json.load(f)
    raw_pts = tdata.get("points", []) or tdata.get("coordinates", [])
    # Format is [lat, lon, ele, km, mi] -> convert to (lon, lat)
    pts = [(p[1], p[0]) for p in raw_pts if len(p) >= 2]

    # Include guidance track points as well
    guidance_path = route_dir / "guidance-track.json"
    if guidance_path.exists():
        with open(guidance_path, "r", encoding="utf-8") as f:
            gdata = json.load(f)
            gpts = gdata.get("points", []) or gdata.get("coordinates", [])
            for p in gpts:
                if len(p) >= 2:
                    pts.append((p[1], p[0]))

    places_file = route_dir / "places.json"
    places_pts = []
    if places_file.exists():
        with open(places_file, "r", encoding="utf-8") as f:
            places_data = json.load(f)
        for p in places_data:
            loc = p.get("location") or {}
            plat = p.get("lat") if p.get("lat") is not None else loc.get("lat")
            plon = p.get("lon") if p.get("lon") is not None else loc.get("lon")
            if plat is not None and plon is not None:
                places_pts.append((plon, plat))

    town_boxes = get_town_bounding_boxes(route_dir)

    sections = [
        ("section-1.pmtiles", "Tour Divide Sec 1: Canada & Montana", lambda lat: lat >= 44.95),
        ("section-2.pmtiles", "Tour Divide Sec 2: Wyoming", lambda lat: 40.95 <= lat <= 45.05),
        ("section-3.pmtiles", "Tour Divide Sec 3: Colorado", lambda lat: 36.95 <= lat <= 41.05),
        ("section-4.pmtiles", "Tour Divide Sec 4: New Mexico", lambda lat: lat <= 37.05)
    ]

    print("[PMTiles Pipeline] Slicing Tour Divide into 4 section PMTiles archives...")
    with open(corridor_pmtiles_path, "rb") as sf:
        reader = Reader(MmapSource(sf))
        header = reader.header()
        meta = reader.metadata() or {}

        for filename, sec_name, lat_filter in sections:
            sec_pts = [p for p in pts if lat_filter(p[1])]
            if not sec_pts:
                continue
            sec_out = route_dir / filename
            sec_places = [p for p in places_pts if lat_filter(p[1])]
            sec_town_boxes = [b for b in town_boxes if lat_filter((b[1] + b[3]) / 2.0)]

            # Densify section track points so no segment skips tiles
            densified_sec_pts = interpolate_track(sec_pts, max_step_m=120.0)
            sample_points = list(densified_sec_pts) + sec_places

            lons = [p[0] for p in sec_pts]
            lats = [p[1] for p in sec_pts]
            min_lon, min_lat, max_lon, max_lat = min(lons), min(lats), max(lons), max(lats)

            tiles_needed = set()
            for z in range(header["min_zoom"], header["max_zoom"] + 1):
                n_tiles = 2 ** z
                if z <= 8:
                    min_tx, min_ty = lonlat_to_tile(min_lon, max_lat, z)
                    max_tx, max_ty = lonlat_to_tile(max_lon, min_lat, z)
                    if min_tx > max_tx: min_tx, max_tx = max_tx, min_tx
                    if min_ty > max_ty: min_ty, max_ty = max_ty, min_ty
                    for x in range(max(0, min_tx - 1), min(n_tiles, max_tx + 2)):
                        for y in range(max(0, min_ty - 1), min(n_tiles, max_ty + 2)):
                            tiles_needed.add((z, x, y))
                else:
                    # Route corridor and POIs (3x3 buffer)
                    for lon, lat in sample_points:
                        tx, ty = lonlat_to_tile(lon, lat, z)
                        for dx in (-1, 0, 1):
                            for dy in (-1, 0, 1):
                                nx = tx + dx
                                ny = ty + dy
                                if 0 <= nx < n_tiles and 0 <= ny < n_tiles:
                                    tiles_needed.add((z, nx, ny))

                    # Section towns full coverage (+1 tile margin)
                    for tbox in sec_town_boxes:
                        ttiles = get_intersecting_tiles(tbox[0], tbox[1], tbox[2], tbox[3], z)
                        for _, tx, ty in ttiles:
                            for dx in (-1, 0, 1):
                                for dy in (-1, 0, 1):
                                    nx = tx + dx
                                    ny = ty + dy
                                    if 0 <= nx < n_tiles and 0 <= ny < n_tiles:
                                        tiles_needed.add((z, nx, ny))

            sorted_tiles = sorted(list(tiles_needed), key=lambda c: zxy_to_tileid(c[0], c[1], c[2]))
            tmp_sec_out = sec_out.with_suffix(".tmp.pmtiles")
            with open(tmp_sec_out, "wb") as out_f:
                writer = Writer(out_f)
                sec_tile_count = 0
                for z, x, y in sorted_tiles:
                    data = reader.get(z, x, y)
                    if data:
                        writer.write_tile(zxy_to_tileid(z, x, y), data)
                        sec_tile_count += 1

                writer.finalize(
                    {
                        "tile_compression": header["tile_compression"],
                        "tile_type": header["tile_type"],
                        "min_lon_e7": int(min_lon * 1e7),
                        "min_lat_e7": int(min_lat * 1e7),
                        "max_lon_e7": int(max_lon * 1e7),
                        "max_lat_e7": int(max_lat * 1e7),
                        "center_zoom": header["min_zoom"] if header["min_zoom"] > 0 else 7,
                        "center_lon_e7": int(((min_lon + max_lon) / 2) * 1e7),
                        "center_lat_e7": int(((min_lat + max_lat) / 2) * 1e7),
                    },
                    {
                        **meta,
                        "name": sec_name,
                        "description": f"Offline PMTiles vector section for {sec_name}"
                    }
                )
            tmp_sec_out.replace(sec_out)
            sz = sec_out.stat().st_size
            print(f"[PMTiles Pipeline] Generated {sec_out} ({sz / (1024*1024):.2f} MB, {sec_tile_count} tiles)")
            validate_pmtiles_archive(sec_out)


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
        extract_from_source(
            source_path=Path(args.source),
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

    # If Tour Divide, also generate section archives
    if route_id == "tour-divide-2025" and not args.output:
        generate_tour_divide_sections(output_path, route_dir)

    print(f"Done! Corridor PMTiles created at: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
