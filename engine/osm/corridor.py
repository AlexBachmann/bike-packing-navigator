"""
engine.osm.corridor - OpenStreetMap corridor extraction, bounding box expansion, and Overpass QL querying.

Provides tools to:
1. Compute axis-aligned bounding boxes expanded by an 18 km buffer.
2. Partition long routes (> 50-100 km) into overlapping bounding boxes to avoid Overpass memory and timeout limits.
3. Generate GeoJSON corridor polygon geometry using local transverse Mercator projection.
4. Build standard and composite Overpass QL queries using `out geom;`.
5. Fetch Overpass data with multi-mirror failover, exponential backoff, atomic JSON caching, and deterministic mock mode.
"""

from enum import Enum
import json
import logging
import math
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import urllib.error
import urllib.parse
import urllib.request

from engine.core.models import RoutePoint, RouteTrack
from engine.utils.geo import haversine_distance_m
from engine.utils.io import atomic_write_json, read_json
from engine.utils.spatial import BoundingBox

logger = logging.getLogger(__name__)

# Default public Overpass API endpoints in order of priority
DEFAULT_OVERPASS_MIRRORS: List[str] = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]


class OSMError(Exception):
    """Base exception for all OSM corridor operations."""
    pass


class OverpassError(OSMError):
    """Raised when an Overpass query fails across all available mirrors."""
    pass


class OverpassTimeoutError(OverpassError):
    """Raised when an Overpass query times out across all mirrors."""
    pass


class FeatureType(str, Enum):
    """OSM feature categories to query."""
    HIGHWAYS = "highways"
    WATER = "water"
    ALL = "all"


def _extract_points(
    points_or_track: Union[RouteTrack, Sequence[RoutePoint], Sequence[Sequence[float]], Dict[str, Any]]
) -> List[Tuple[float, float]]:
    """
    Extract a list of (lat, lon) 2D tuples from various route representations.
    """
    if isinstance(points_or_track, RouteTrack):
        return [(p.lat, p.lon) for p in points_or_track.points]
    elif isinstance(points_or_track, dict):
        raw_pts = points_or_track.get("points", [])
        return [(float(p[0]), float(p[1])) for p in raw_pts]
    elif isinstance(points_or_track, (list, tuple)):
        pts: List[Tuple[float, float]] = []
        for item in points_or_track:
            if isinstance(item, RoutePoint):
                pts.append((item.lat, item.lon))
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                pts.append((float(item[0]), float(item[1])))
            elif hasattr(item, "lat") and hasattr(item, "lon"):
                pts.append((float(item.lat), float(item.lon)))
        return pts
    return []


def compute_corridor_bbox(
    points_or_track: Union[RouteTrack, Sequence[RoutePoint], Sequence[Sequence[float]], Dict[str, Any]],
    corridor_m: float = 18000.0
) -> BoundingBox:
    """
    Compute an axis-aligned bounding box expanded by corridor_m buffer margin.

    Args:
        points_or_track: RouteTrack instance, list of RoutePoints, or 5D/2D coordinates.
        corridor_m: Expansion margin in meters (default: 18,000 m = 18 km).

    Returns:
        BoundingBox expanded by the specified margin.

    Raises:
        ValueError: If points_or_track contains no valid coordinates.
    """
    pts = _extract_points(points_or_track)
    if not pts:
        raise ValueError("Points sequence cannot be empty for compute_corridor_bbox")

    raw_bbox = BoundingBox.from_points(pts)
    return raw_bbox.expand_by_meters(margin_m=corridor_m)


def partition_track_bboxes(
    points_or_track: Union[RouteTrack, Sequence[RoutePoint], Sequence[Sequence[float]], Dict[str, Any]],
    max_chunk_km: float = 50.0,
    overlap_km: float = 5.0,
    corridor_m: float = 18000.0
) -> List[BoundingBox]:
    """
    Partition a route track into consecutive, slightly overlapping bounding boxes.

    Helps avoid Overpass memory and timeout limits on long routes (> 50-100 km).

    Args:
        points_or_track: RouteTrack instance or coordinate sequence.
        max_chunk_km: Maximum track distance per chunk in km (default: 50.0 km).
        overlap_km: Distance overlap between consecutive chunks in km (default: 5.0 km).
        corridor_m: Corridor buffer margin in meters to expand each chunk bbox (default: 18,000 m).

    Returns:
        List of BoundingBox instances covering each track partition.
    """
    pts = _extract_points(points_or_track)
    if not pts:
        return []

    if len(pts) == 1:
        return [compute_corridor_bbox(pts, corridor_m=corridor_m)]

    # Compute cumulative distances along the track
    cum_dists_m: List[float] = [0.0]
    total_dist_m = 0.0
    for i in range(1, len(pts)):
        d = haversine_distance_m(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
        total_dist_m += d
        cum_dists_m.append(total_dist_m)

    chunk_size_m = max_chunk_km * 1000.0
    overlap_m = overlap_km * 1000.0

    # If track is short enough, return a single expanded bbox
    if total_dist_m <= chunk_size_m:
        return [compute_corridor_bbox(pts, corridor_m=corridor_m)]

    bboxes: List[BoundingBox] = []
    start_idx = 0

    while start_idx < len(pts):
        start_dist = cum_dists_m[start_idx]
        target_end_dist = start_dist + chunk_size_m

        # Find end index for this chunk
        end_idx = start_idx
        while end_idx < len(pts) and cum_dists_m[end_idx] < target_end_dist:
            end_idx += 1

        # Include at least 2 points or clamp to end of track
        end_idx = min(len(pts), max(end_idx + 1, start_idx + 2))
        chunk_pts = pts[start_idx:end_idx]

        if chunk_pts:
            bboxes.append(compute_corridor_bbox(chunk_pts, corridor_m=corridor_m))

        if end_idx >= len(pts):
            break

        # Next chunk starts overlap_m before end_idx
        target_next_start_dist = max(start_dist + 1.0, cum_dists_m[end_idx - 1] - overlap_m)
        next_start_idx = start_idx + 1
        while next_start_idx < end_idx - 1 and cum_dists_m[next_start_idx] < target_next_start_dist:
            next_start_idx += 1

        start_idx = next_start_idx

    return bboxes


def generate_corridor_polygon(
    points_or_track: Union[RouteTrack, Sequence[RoutePoint], Sequence[Sequence[float]], Dict[str, Any]],
    corridor_m: float = 18000.0,
    simplify_m: float = 500.0,
    route_name: str = "Route Corridor"
) -> Dict[str, Any]:
    """
    Generate a GeoJSON FeatureCollection polygon buffered around the route track.

    Uses a local transverse Mercator projection centered on route centroid
    to eliminate UTM zone boundary distortions.

    Args:
        points_or_track: Route track coordinates or models.
        corridor_m: Buffer radius in meters (default: 18,000 m = 18 km).
        simplify_m: Simplification tolerance in meters (default: 500 m).
        route_name: Name property in GeoJSON metadata.

    Returns:
        GeoJSON FeatureCollection dictionary containing the corridor polygon.

    Raises:
        ValueError: If points sequence is empty.
    """
    pts = _extract_points(points_or_track)
    if not pts:
        raise ValueError("Points sequence cannot be empty for generate_corridor_polygon")

    # Attempt high-fidelity shapely + pyproj buffering
    try:
        from pyproj import Transformer
        from shapely.geometry import LineString, mapping
        from shapely.ops import transform

        # Centroid coordinates
        centroid_lat = sum(p[0] for p in pts) / len(pts)
        centroid_lon = sum(p[1] for p in pts) / len(pts)

        # Local transverse Mercator centered on the route centroid
        proj_str = (
            f"+proj=tmerc +lat_0={centroid_lat:.6f} +lon_0={centroid_lon:.6f} "
            f"+k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
        )
        to_local = Transformer.from_crs("EPSG:4326", proj_str, always_xy=True).transform
        to_wgs84 = Transformer.from_crs(proj_str, "EPSG:4326", always_xy=True).transform

        # Convert (lat, lon) -> (lon, lat) for pyproj (x, y)
        lon_lats = [(p[1], p[0]) for p in pts]
        line_wgs84 = LineString(lon_lats)

        # Transform to local meters
        line_local = transform(to_local, line_wgs84)

        # Simplify input line if long
        if line_local.length > simplify_m * 2.0 and simplify_m > 0:
            line_local = line_local.simplify(simplify_m, preserve_topology=True)

        # Buffer with round caps and joins
        buffered_local = line_local.buffer(corridor_m, cap_style=1, join_style=1)

        # Simplify resulting polygon boundary
        if simplify_m > 0:
            buffered_local = buffered_local.simplify(simplify_m / 2.0, preserve_topology=True)

        # Reproject back to WGS84
        buffered_wgs84 = transform(to_wgs84, buffered_local)
        geom_dict = mapping(buffered_wgs84)

        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "name": route_name,
                    "buffer_km": corridor_m / 1000.0,
                    "corridor_m": corridor_m,
                },
                "geometry": geom_dict
            }]
        }
    except Exception as e:
        logger.warning(f"Shapely/pyproj buffering failed ({e}), using fallback envelope polygon")
        # Pure-Python fallback: expand bounding box to a GeoJSON polygon
        bbox = compute_corridor_bbox(pts, corridor_m=corridor_m)
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {
                    "name": route_name,
                    "buffer_km": corridor_m / 1000.0,
                    "corridor_m": corridor_m,
                    "fallback": True
                },
                "geometry": bbox.to_geojson()
            }]
        }


def build_overpass_query(
    bbox: BoundingBox,
    feature_type: FeatureType = FeatureType.ALL,
    timeout_sec: int = 180,
    max_size_mb: int = 512,
    custom_filters: Optional[List[str]] = None
) -> str:
    """
    Build a standard Overpass QL query string with out geom.

    Args:
        bbox: BoundingBox for spatial bounds.
        feature_type: FeatureType enum (HIGHWAYS, WATER, or ALL).
        timeout_sec: Server execution timeout in seconds.
        max_size_mb: Server memory allocation limit in MB.
        custom_filters: Optional list of additional Overpass filter clauses.

    Returns:
        Overpass QL query string formatted with [out:json] and out geom;.
    """
    s, w, n, e = bbox.to_overpass()
    max_size_bytes = max_size_mb * 1024 * 1024
    statements: List[str] = []

    if feature_type in (FeatureType.HIGHWAYS, FeatureType.ALL):
        statements.append(
            f'way["highway"~"^(track|path|cycleway|bridleway|footway|pedestrian|living_street|unclassified|residential|service|tertiary|secondary|primary)$"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});'
        )

    if feature_type in (FeatureType.WATER, FeatureType.ALL):
        statements.extend([
            f'way["waterway"~"^(river|stream|canal)$"]["name"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});',
            f'way["natural"="water"]["name"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});',
            f'relation["natural"="water"]["name"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});',
            f'node["natural"="spring"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});',
            f'node["amenity"="drinking_water"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});',
        ])

    if custom_filters:
        for f in custom_filters:
            statements.append(f'{f}({s:.5f},{w:.5f},{n:.5f},{e:.5f});')

    query_body = "\n  ".join(statements)
    return f"""[out:json][timeout:{timeout_sec}][maxsize:{max_size_bytes}];
(
  {query_body}
);
out geom;"""


def fetch_overpass_data(
    query: str,
    cache_path: Optional[Union[Path, str]] = None,
    mirrors: Optional[List[str]] = None,
    mock_response: Optional[Dict[str, Any]] = None,
    timeout: int = 120,
    retries: int = 3
) -> Dict[str, Any]:
    """
    Execute an Overpass query with mirror failover, caching, and deterministic mock mode.

    Args:
        query: Overpass QL query string.
        cache_path: Optional path to JSON file for atomic caching.
        mirrors: Optional list of Overpass API interpreter endpoints.
        mock_response: Optional mock dictionary to return immediately (bypasses network).
        timeout: Socket timeout per request in seconds.
        retries: Number of retry attempts per mirror.

    Returns:
        Dictionary parsed from Overpass JSON response.

    Raises:
        OverpassTimeoutError: If all mirrors time out.
        OverpassError: If all mirrors fail with network, rate limit, or server errors.
    """
    # 1. Mock response parameter takes immediate precedence
    if mock_response is not None:
        if cache_path:
            atomic_write_json(Path(cache_path), mock_response)
        return mock_response

    # 2. Check environment variable for mock mode
    if os.environ.get("OVERPASS_MOCK") == "1":
        mock_file = os.environ.get("OVERPASS_MOCK_FILE")
        if mock_file and Path(mock_file).exists():
            data = read_json(Path(mock_file))
            if cache_path:
                atomic_write_json(Path(cache_path), data)
            return data
        fallback_mock: Dict[str, Any] = {"version": 0.6, "generator": "mock", "elements": []}
        if cache_path:
            atomic_write_json(Path(cache_path), fallback_mock)
        return fallback_mock

    # 3. Check local cache
    if cache_path:
        c_path = Path(cache_path)
        if c_path.exists():
            try:
                cached_data = read_json(c_path)
                if isinstance(cached_data, dict) and "elements" in cached_data:
                    return cached_data
            except Exception as e:
                logger.warning(f"Failed to read cache {c_path}: {e}")

    # 4. Multi-mirror network fetching
    endpoints = mirrors if mirrors is not None else DEFAULT_OVERPASS_MIRRORS
    errors: List[str] = []
    timed_out_count = 0

    encoded_data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    headers = {
        "User-Agent": "BikepackNavigatorEngine/1.0 (corridor-fetcher)",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    for mirror in endpoints:
        for attempt in range(retries):
            try:
                req = urllib.request.Request(mirror, data=encoded_data, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    status = getattr(resp, "status", None) or (resp.getcode() if hasattr(resp, "getcode") else 200)
                    if status == 200:
                        raw_body = resp.read().decode("utf-8")
                        data = json.loads(raw_body)
                        if cache_path:
                            atomic_write_json(Path(cache_path), data)
                        return data
                    else:
                        errors.append(f"{mirror} HTTP {status}")
            except urllib.error.HTTPError as e:
                msg = f"{mirror} HTTP {e.code}: {e.reason}"
                errors.append(msg)
                if e.code in (429, 502, 504):
                    time.sleep(1.0 * (attempt + 1))
                else:
                    break
            except (urllib.error.URLError, TimeoutError) as e:
                msg = f"{mirror} connection error: {e}"
                errors.append(msg)
                timed_out_count += 1
                time.sleep(1.0 * (attempt + 1))
            except Exception as e:
                errors.append(f"{mirror} unexpected error: {e}")
                break

    if timed_out_count >= len(endpoints) * retries:
        raise OverpassTimeoutError(f"All Overpass mirrors timed out. Errors: {'; '.join(errors)}")
    raise OverpassError(f"All Overpass mirrors failed. Errors: {'; '.join(errors)}")


def extract_osm_corridor_data(
    points_or_track: Union[RouteTrack, Sequence[RoutePoint], Sequence[Sequence[float]], Dict[str, Any]],
    cache_path: Optional[Union[Path, str]] = None,
    feature_type: FeatureType = FeatureType.ALL,
    corridor_m: float = 18000.0,
    max_chunk_km: float = 50.0,
    overlap_km: float = 5.0,
    mock_response: Optional[Dict[str, Any]] = None,
    timeout: int = 120
) -> Dict[str, Any]:
    """
    High-level orchestration: computes bboxes, queries cache or Overpass per chunk,
    and deduplicates elements into a single response dictionary.

    Args:
        points_or_track: Route coordinates or models.
        cache_path: Optional path for aggregate caching.
        feature_type: Categories of OSM features to query.
        corridor_m: Corridor buffer margin in meters.
        max_chunk_km: Maximum track partition distance in km.
        overlap_km: Overlap distance between consecutive partitions in km.
        mock_response: Optional mock response for testing.
        timeout: Query timeout in seconds.

    Returns:
        Consolidated Overpass JSON dictionary with deduplicated elements.
    """
    if cache_path and Path(cache_path).exists() and mock_response is None:
        try:
            return read_json(Path(cache_path))
        except Exception:
            pass

    bboxes = partition_track_bboxes(
        points_or_track,
        max_chunk_km=max_chunk_km,
        overlap_km=overlap_km,
        corridor_m=corridor_m
    )

    if not bboxes:
        return {"version": 0.6, "generator": "engine.osm.corridor", "elements": []}

    all_elements: List[Dict[str, Any]] = []
    seen_keys = set()

    for idx, bbox in enumerate(bboxes):
        chunk_cache = None
        if cache_path and len(bboxes) > 1:
            p = Path(cache_path)
            chunk_cache = p.parent / f"{p.stem}_chunk{idx}{p.suffix}"

        query = build_overpass_query(bbox, feature_type=feature_type)
        res = fetch_overpass_data(
            query=query,
            cache_path=chunk_cache,
            mock_response=mock_response,
            timeout=timeout
        )

        for el in res.get("elements", []):
            key = (el.get("type"), el.get("id"))
            if key not in seen_keys:
                seen_keys.add(key)
                all_elements.append(el)

    result = {
        "version": 0.6,
        "generator": "engine.osm.corridor",
        "elements": all_elements
    }

    if cache_path:
        atomic_write_json(Path(cache_path), result)

    return result


def extract_water_features_from_pmtiles(
    pmtiles_paths: Union[Path, str, Sequence[Union[Path, str]]],
    track: Union[RouteTrack, Sequence[Any]],
    zoom: int = 12
) -> List[Dict[str, Any]]:
    """
    Extract OpenStreetMap water features (rivers, streams, lakes, drinking water)
    directly from local PMTiles vector tile archives along the route corridor.

    Args:
        pmtiles_paths: Single PMTiles path or sequence of PMTiles paths.
        track: RouteTrack or sequence of RoutePoint/[lat, lon, ...].
        zoom: Tile zoom level to query (default: 12).

    Returns:
        List of standardized OSM feature dictionaries with 'tags', 'coords' (lat, lon), and 'osm_id'.
    """
    try:
        import gzip
        import mapbox_vector_tile
        from pmtiles.reader import MmapSource, Reader
        from engine.utils.tiles import latlon_to_tile, mvt_pixel_to_lonlat
    except ImportError as e:
        logger.warning(f"PMTiles / mapbox_vector_tile not available for water extraction: {e}")
        return []

    if isinstance(pmtiles_paths, (str, Path)):
        paths = [Path(pmtiles_paths)]
    else:
        paths = [Path(p) for p in pmtiles_paths]

    valid_paths = [p for p in paths if p.exists() and p.is_file() and p.stat().st_size > 0]
    if not valid_paths:
        return []

    # Extract track points
    if isinstance(track, RouteTrack):
        track_points = track.points
    else:
        track_points = track

    if not track_points:
        return []

    # Identify corridor tiles along track points
    tiles: set = set()
    for pt in track_points:
        lat = pt.lat if hasattr(pt, "lat") else pt[0]
        lon = pt.lon if hasattr(pt, "lon") else pt[1]
        tx, ty = latlon_to_tile(lat, lon, zoom)
        tiles.add((zoom, tx, ty))

    if not tiles:
        return []

    features: List[Dict[str, Any]] = []
    seen_features: set = set()

    for p_path in valid_paths:
        try:
            with open(p_path, "rb") as f:
                reader = Reader(MmapSource(f))
                for tz, tx, ty in tiles:
                    t_bytes = reader.get(tz, tx, ty)
                    if not t_bytes:
                        continue
                    try:
                        if t_bytes.startswith(b"\x1f\x8b"):
                            t_bytes = gzip.decompress(t_bytes)
                        tile_data = mapbox_vector_tile.decode(t_bytes, default_options={"y_coord_down": True})
                    except Exception:
                        continue

                    # 1. waterway layer (rivers, streams, canals)
                    if "waterway" in tile_data:
                        ext = tile_data["waterway"].get("extent", 4096)
                        for feat in tile_data["waterway"].get("features", []):
                            props = feat.get("properties", {})
                            name = props.get("name") or props.get("name_en")
                            if not name:
                                continue
                            w_class = props.get("class", "stream")
                            feat_id = feat.get("id") or f"{name}_{w_class}"
                            key = ("waterway", feat_id)
                            if key in seen_features:
                                continue
                            seen_features.add(key)

                            geom = feat.get("geometry", {})
                            g_type = geom.get("type")
                            c_raw = geom.get("coordinates", [])
                            lines = [c_raw] if g_type == "LineString" else (c_raw if g_type == "MultiLineString" else [])
                            coords = []
                            for line in lines:
                                for px, py in line:
                                    lon, lat = mvt_pixel_to_lonlat(tz, tx, ty, px, py, ext)
                                    coords.append((lat, lon))
                            if coords:
                                tags = {
                                    "waterway": w_class,
                                    "name": name,
                                    "intermittent": "yes" if props.get("intermittent") == 1 else "no"
                                }
                                features.append({
                                    "osm_id": feat.get("id"),
                                    "tags": tags,
                                    "coords": coords,
                                })

                    # 2. water_name layer (lakes, reservoirs, ponds)
                    if "water_name" in tile_data:
                        ext = tile_data["water_name"].get("extent", 4096)
                        for feat in tile_data["water_name"].get("features", []):
                            props = feat.get("properties", {})
                            name = props.get("name") or props.get("name_en")
                            if not name:
                                continue
                            w_class = props.get("class", "lake")
                            feat_id = feat.get("id") or f"{name}_{w_class}"
                            key = ("water_name", feat_id)
                            if key in seen_features:
                                continue
                            seen_features.add(key)

                            geom = feat.get("geometry", {})
                            g_type = geom.get("type")
                            c_raw = geom.get("coordinates", [])
                            coords = []
                            if g_type == "Point" and len(c_raw) >= 2:
                                lon, lat = mvt_pixel_to_lonlat(tz, tx, ty, c_raw[0], c_raw[1], ext)
                                coords.append((lat, lon))
                            elif g_type in ("LineString", "MultiPoint"):
                                for pt in c_raw:
                                    if len(pt) >= 2:
                                        lon, lat = mvt_pixel_to_lonlat(tz, tx, ty, pt[0], pt[1], ext)
                                        coords.append((lat, lon))
                            elif g_type == "Polygon":
                                for ring in c_raw:
                                    for pt in ring:
                                        if len(pt) >= 2:
                                            lon, lat = mvt_pixel_to_lonlat(tz, tx, ty, pt[0], pt[1], ext)
                                            coords.append((lat, lon))
                            if coords:
                                tags = {
                                    "natural": "water",
                                    "water": w_class,
                                    "name": name,
                                    "intermittent": "yes" if props.get("intermittent") == 1 else "no"
                                }
                                features.append({
                                    "osm_id": feat.get("id"),
                                    "tags": tags,
                                    "coords": coords,
                                })

                    # 3. poi layer (potable water amenities)
                    if "poi" in tile_data:
                        ext = tile_data["poi"].get("extent", 4096)
                        for feat in tile_data["poi"].get("features", []):
                            props = feat.get("properties", {})
                            subclass = props.get("subclass") or ""
                            p_class = props.get("class") or ""
                            if subclass in ("drinking_water", "water_point") or p_class in ("drinking_water", "water_point"):
                                feat_id = feat.get("id") or f"poi_{tz}_{tx}_{ty}_{len(features)}"
                                key = ("poi_water", feat_id)
                                if key in seen_features:
                                    continue
                                seen_features.add(key)

                                geom = feat.get("geometry", {})
                                g_type = geom.get("type")
                                c_raw = geom.get("coordinates", [])
                                coords = []
                                if g_type == "Point" and len(c_raw) >= 2:
                                    lon, lat = mvt_pixel_to_lonlat(tz, tx, ty, c_raw[0], c_raw[1], ext)
                                    coords.append((lat, lon))
                                if coords:
                                    p_name = props.get("name") or "Drinking Water Tap"
                                    tags = {
                                        "amenity": "drinking_water",
                                        "name": p_name,
                                        "drinking_water": "yes"
                                    }
                                    features.append({
                                        "osm_id": feat.get("id"),
                                        "tags": tags,
                                        "coords": coords,
                                    })
        except Exception as exc:
            logger.warning(f"Error extracting water from PMTiles {p_path}: {exc}")
            continue

    logger.info(f"Extracted {len(features)} raw water features from {len(valid_paths)} PMTiles archives.")
    return features

