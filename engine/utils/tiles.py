"""
engine.utils.tiles - Slippy map tile calculations and MVT pixel transformations.

Handles standard Web Mercator (EPSG:3857) tile math, bounding box queries,
clamping, and MVT tile coordinate conversions.
"""

from typing import Any, List, Optional, Tuple, Union
import math

MAX_LAT: float = 85.0511287798066
MIN_LAT: float = -85.0511287798066


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> Tuple[int, int]:
    """
    Convert (lon, lat) to tile (x, y) coordinates at a given zoom level.

    Coordinates are safely clamped to Web Mercator bounds and valid tile index limits.

    Args:
        lon: Longitude in degrees [-180.0, 180.0].
        lat: Latitude in degrees [-85.0511, 85.0511].
        zoom: Zoom level (0 to 30).

    Returns:
        (tile_x, tile_y) integer coordinates in [0, 2^zoom - 1].
    """
    lat_clamped = max(MIN_LAT, min(MAX_LAT, lat))
    lat_rad = math.radians(lat_clamped)
    n = 2.0 ** zoom

    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)

    max_idx = max(0, int(n) - 1)
    return max(0, min(xtile, max_idx)), max(0, min(ytile, max_idx))


def latlon_to_tile(lat: float, lon: float, zoom: int) -> Tuple[int, int]:
    """
    Convert (lat, lon) to tile (x, y) coordinates at a given zoom level.

    Convenience alias for lonlat_to_tile with (lat, lon) parameter order.
    """
    return lonlat_to_tile(lon=lon, lat=lat, zoom=zoom)


def is_valid_tile(tx: int, ty: int, zoom: int) -> bool:
    """
    Check whether (tx, ty) coordinates are geometrically valid for zoom level.

    Args:
        tx: Tile X index.
        ty: Tile Y index.
        zoom: Zoom level.

    Returns:
        True if zoom is in [0, 30] and coordinates are in [0, 2^zoom - 1].
    """
    if not (0 <= zoom <= 30):
        return False
    max_coord = 1 << zoom
    return 0 <= tx < max_coord and 0 <= ty < max_coord


def tile_to_bounds(
    a: Optional[int] = None,
    b: Optional[int] = None,
    c: Optional[int] = None,
    *,
    zoom: Optional[int] = None,
    tx: Optional[int] = None,
    ty: Optional[int] = None,
    z: Optional[int] = None,
    x: Optional[int] = None,
    y: Optional[int] = None,
) -> Tuple[float, float, float, float]:
    """
    Convert tile coordinates to standard GIS bounding box (min_lon, min_lat, max_lon, max_lat).

    Parameter Resolution:
    - Keyword arguments are unambiguous and always prioritized:
        tile_to_bounds(zoom=4, x=2, y=3)
        tile_to_bounds(tx=2, ty=3, zoom=4)
        tile_to_bounds(z=4, x=2, y=3)
    - Two positional arguments with keyword zoom:
        tile_to_bounds(tx, ty, zoom=z)
    - Three positional arguments (a, b, c):
        1. If coordinates are only geometrically valid as (zoom, x, y) (e.g. tile_to_bounds(10, 511, 340)
           or tile_to_bounds(10, 5, 2) where coords exceed zoom 2 limits), they are resolved as (zoom, x, y).
        2. If coordinates are only geometrically valid as (tx, ty, zoom) (e.g. tile_to_bounds(511, 340, 10)),
           they are resolved as (tx, ty, zoom).
        3. If coordinates are geometrically valid under both conventions (e.g. small indices at low zoom),
           the canonical GIS/Mercator positional convention (tx, ty, zoom) is used. Use keyword arguments
           (e.g. zoom=4, x=2, y=3) to explicitly select zoom-first order for ambiguous low-zoom coordinates.

    Returns:
        (min_lon, min_lat, max_lon, max_lat) in decimal degrees.

    Raises:
        TypeError: If required tile coordinates or zoom are missing.
        ValueError: If tile coordinates or zoom level are geometrically invalid.
    """
    # Normalize keyword aliases
    kw_zoom = zoom if zoom is not None else z
    kw_tx = tx if tx is not None else x
    kw_ty = ty if ty is not None else y

    if kw_zoom is not None and kw_tx is not None and kw_ty is not None:
        actual_zoom, actual_tx, actual_ty = kw_zoom, kw_tx, kw_ty
    elif a is not None and b is not None and kw_zoom is not None:
        actual_tx, actual_ty, actual_zoom = a, b, kw_zoom
    elif a is not None and b is not None and c is not None:
        v_xyz = is_valid_tile(a, b, c)  # (tx=a, ty=b, zoom=c)
        v_zxy = is_valid_tile(b, c, a)  # (zoom=a, x=b, y=c)

        if v_zxy and not v_xyz:
            actual_zoom, actual_tx, actual_ty = a, b, c
        elif v_xyz and not v_zxy:
            actual_tx, actual_ty, actual_zoom = a, b, c
        elif v_xyz and v_zxy:
            # Canonical standard positional order: (tx, ty, zoom)
            actual_tx, actual_ty, actual_zoom = a, b, c
        else:
            raise ValueError(
                f"Invalid tile coordinates: ({a}, {b}, {c}) is not geometrically valid as (tx, ty, zoom) or (zoom, x, y)"
            )
    else:
        raise TypeError("tile_to_bounds requires (tx, ty, zoom) or (zoom, x, y) or explicit keyword arguments")

    if not is_valid_tile(actual_tx, actual_ty, actual_zoom):
        raise ValueError(
            f"Tile coordinates ({actual_tx}, {actual_ty}) are out of bounds for zoom {actual_zoom}"
        )

    n = 2.0 ** actual_zoom
    min_lon = actual_tx / n * 360.0 - 180.0
    max_lon = (actual_tx + 1) / n * 360.0 - 180.0

    max_lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * actual_ty / n))))
    min_lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (actual_ty + 1) / n))))

    return min_lon, min_lat, max_lon, max_lat


def _normalize_bbox_and_zoom(
    bbox_or_min_lon: Any = None,
    min_lat_or_zoom: Any = None,
    max_lon: Optional[float] = None,
    max_lat: Optional[float] = None,
    zoom: Optional[int] = None,
    **kwargs: Any,
) -> Tuple[float, float, float, float, int]:
    """
    Helper to normalize either (bbox, zoom) or (min_lon, min_lat, max_lon, max_lat, zoom),
    supporting all combinations of positional and keyword arguments.
    """
    bbox_obj = kwargs.get("bbox", kwargs.get("bounds", bbox_or_min_lon))
    actual_zoom = zoom if zoom is not None else kwargs.get("zoom", kwargs.get("z"))

    if bbox_obj is not None and (
        hasattr(bbox_obj, "min_lon")
        or (isinstance(bbox_obj, (tuple, list)) and len(bbox_obj) == 4)
    ):
        z = actual_zoom if actual_zoom is not None else min_lat_or_zoom
        if z is None:
            raise TypeError("zoom must be provided when passing a BoundingBox or bounds tuple")
        if hasattr(bbox_obj, "min_lon"):
            return (
                float(bbox_obj.min_lon),
                float(bbox_obj.min_lat),
                float(bbox_obj.max_lon),
                float(bbox_obj.max_lat),
                int(z),
            )
        else:
            return (
                float(bbox_obj[0]),
                float(bbox_obj[1]),
                float(bbox_obj[2]),
                float(bbox_obj[3]),
                int(z),
            )

    actual_min_lon = kwargs.get("min_lon", bbox_or_min_lon)
    actual_min_lat = kwargs.get("min_lat", min_lat_or_zoom)
    actual_max_lon = kwargs.get("max_lon", max_lon)
    actual_max_lat = kwargs.get("max_lat", max_lat)

    if None in (actual_min_lon, actual_min_lat, actual_max_lon, actual_max_lat, actual_zoom):
        raise TypeError("Expected either (bbox, zoom) or (min_lon, min_lat, max_lon, max_lat, zoom)")

    return (
        float(actual_min_lon),
        float(actual_min_lat),
        float(actual_max_lon),
        float(actual_max_lat),
        int(actual_zoom),
    )


def tile_range_for_bbox(
    bbox_or_min_lon: Any = None,
    min_lat_or_zoom: Any = None,
    max_lon: Optional[float] = None,
    max_lat: Optional[float] = None,
    zoom: Optional[int] = None,
    **kwargs: Any,
) -> Tuple[int, int, int, int]:
    """
    Compute inclusive tile index ranges for a bounding box at a given zoom level.

    Supports polymorphic invocation:
      - tile_range_for_bbox(bbox, zoom)
      - tile_range_for_bbox(min_lon, min_lat, max_lon, max_lat, zoom)

    Returns:
        (min_x, min_y, max_x, max_y)
    """
    min_lon_f, min_lat_f, max_lon_f, max_lat_f, zoom_i = _normalize_bbox_and_zoom(
        bbox_or_min_lon, min_lat_or_zoom, max_lon, max_lat, zoom, **kwargs
    )

    # Note: Y increases southward, so max_lat corresponds to min_y
    min_x, min_y = lonlat_to_tile(min_lon_f, max_lat_f, zoom_i)
    max_x, max_y = lonlat_to_tile(max_lon_f, min_lat_f, zoom_i)

    if min_x > max_x:
        min_x, max_x = max_x, min_x
    if min_y > max_y:
        min_y, max_y = max_y, min_y

    return min_x, min_y, max_x, max_y


def get_intersecting_tiles(
    bbox_or_min_lon: Any = None,
    min_lat_or_zoom: Any = None,
    max_lon: Optional[float] = None,
    max_lat: Optional[float] = None,
    zoom: Optional[int] = None,
    **kwargs: Any,
) -> List[Tuple[int, int, int]]:
    """
    Return all tile coordinates (zoom, x, y) covering the bounding box.

    Supports polymorphic invocation:
      - get_intersecting_tiles(bbox, zoom)
      - get_intersecting_tiles(min_lon, min_lat, max_lon, max_lat, zoom)

    Returns:
        List of (zoom, x, y) tuples.
    """
    min_lon_f, min_lat_f, max_lon_f, max_lat_f, zoom_i = _normalize_bbox_and_zoom(
        bbox_or_min_lon, min_lat_or_zoom, max_lon, max_lat, zoom, **kwargs
    )
    min_x, min_y, max_x, max_y = tile_range_for_bbox(
        min_lon_f, min_lat_f, max_lon_f, max_lat_f, zoom_i
    )
    tiles: List[Tuple[int, int, int]] = []
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            tiles.append((zoom_i, x, y))
    return tiles


def mvt_pixel_to_lonlat(
    zoom: int, tx: int, ty: int, px: float, py: float, extent: int = 4096
) -> Tuple[float, float]:
    """
    Convert MVT pixel coordinates (px, py) within tile (zoom, tx, ty) to WGS84 (lon, lat).

    Args:
        zoom: Tile zoom level.
        tx: Tile X index.
        ty: Tile Y index.
        px: Pixel X within tile [0, extent].
        py: Pixel Y within tile [0, extent].
        extent: Tile coordinate extent (default: 4096).

    Returns:
        (lon, lat) in decimal degrees.
    """
    n = 2.0 ** zoom
    x_norm = tx + px / extent
    y_norm = ty + py / extent
    lon = x_norm / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * y_norm / n)))
    return lon, math.degrees(lat_rad)


def lonlat_to_mvt_pixel(
    lon: float, lat: float, zoom: int, tx: int, ty: int, extent: int = 4096
) -> Tuple[float, float]:
    """
    Convert WGS84 (lon, lat) to MVT pixel coordinates (px, py) within tile (zoom, tx, ty).

    Returns:
        (px, py) in tile pixel space.
    """
    lat_clamped = max(MIN_LAT, min(MAX_LAT, lat))
    lat_rad = math.radians(lat_clamped)
    n = 2.0 ** zoom

    x_norm = (lon + 180.0) / 360.0 * n
    y_norm = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n

    px = (x_norm - tx) * extent
    py = (y_norm - ty) * extent
    return px, py


def dem_tile_name(lat: int, lon: int) -> str:
    """
    Generate the Copernicus DEM 30m COG tile identifier for a 1x1 degree cell.

    Args:
        lat: Integer floor latitude [-90, 89].
        lon: Integer floor longitude [-180, 179].

    Returns:
        Tile string, e.g. "Copernicus_DSM_COG_10_N42_00_W106_00_DEM".
    """
    lat_str = f"N{lat:02d}_00" if lat >= 0 else f"S{-lat:02d}_00"
    lon_str = f"E{lon:03d}_00" if lon >= 0 else f"W{-lon:03d}_00"
    return f"Copernicus_DSM_COG_10_{lat_str}_{lon_str}_DEM"
