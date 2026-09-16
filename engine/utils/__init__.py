"""
engine.utils - Centralized mathematical, spatial, unit, string, and I/O utilities.
"""

from engine.utils.geo import (
    haversine_distance,
    haversine_distance_m,
    initial_bearing,
    deflection_angle,
    bearing_to_compass,
    dist_point_to_segment_2d,
    dist_point_to_segment_m,
    densify_polyline,
    interpolate_track,
)

from engine.utils.tiles import (
    lonlat_to_tile,
    latlon_to_tile,
    tile_to_bounds,
    tile_range_for_bbox,
    get_intersecting_tiles,
    mvt_pixel_to_lonlat,
    lonlat_to_mvt_pixel,
    dem_tile_name,
)

from engine.utils.spatial import (
    BoundingBox,
    calculate_bbox,
    point_in_bbox,
    expand_bbox,
    SpatialHashGrid,
    TrackIndex,
)

from engine.utils.units import (
    EARTH_RADIUS_KM,
    EARTH_RADIUS_M,
    METERS_PER_DEGREE_LAT,
    KM_TO_MILES,
    MILES_TO_KM,
    METERS_TO_FEET,
    FEET_TO_METERS,
    km_to_miles,
    miles_to_km,
    meters_to_feet,
    feet_to_meters,
    calculate_grade,
    calculate_grade_percent,
    grade_percentage,
)

from engine.utils.text import (
    slugify,
    sanitize_name,
    sanitize_identifier,
    sanitize_id,
    format_distance,
    format_distance_km,
    format_elevation,
)

from engine.utils.io import (
    ensure_directory,
    atomic_write_text,
    atomic_write_bytes,
    atomic_write_json,
    read_json,
    safe_read_json,
    read_text,
)

__all__ = [
    # geo
    "haversine_distance",
    "haversine_distance_m",
    "initial_bearing",
    "deflection_angle",
    "bearing_to_compass",
    "dist_point_to_segment_2d",
    "dist_point_to_segment_m",
    "densify_polyline",
    "interpolate_track",
    # tiles
    "lonlat_to_tile",
    "latlon_to_tile",
    "tile_to_bounds",
    "tile_range_for_bbox",
    "get_intersecting_tiles",
    "mvt_pixel_to_lonlat",
    "lonlat_to_mvt_pixel",
    "dem_tile_name",
    # spatial
    "BoundingBox",
    "calculate_bbox",
    "point_in_bbox",
    "expand_bbox",
    "SpatialHashGrid",
    "TrackIndex",
    # units
    "EARTH_RADIUS_KM",
    "EARTH_RADIUS_M",
    "METERS_PER_DEGREE_LAT",
    "KM_TO_MILES",
    "MILES_TO_KM",
    "METERS_TO_FEET",
    "FEET_TO_METERS",
    "km_to_miles",
    "miles_to_km",
    "meters_to_feet",
    "feet_to_meters",
    "calculate_grade",
    "calculate_grade_percent",
    "grade_percentage",
    # text
    "slugify",
    "sanitize_name",
    "sanitize_identifier",
    "sanitize_id",
    "format_distance",
    "format_distance_km",
    "format_elevation",
    # io
    "ensure_directory",
    "atomic_write_text",
    "atomic_write_bytes",
    "atomic_write_json",
    "read_json",
    "safe_read_json",
    "read_text",
]
