"""
engine.terrain - Terrain intelligence: climbs, mountain passes, surfaces, and DEM processing.
"""

from engine.terrain.climbs import (
    Climb,
    ClimbCategory,
    calculate_fiets_index,
    classify_climb_category,
    compute_rolling_max_grade,
    detect_climbs,
    annotate_climb_surfaces,
)
from engine.terrain.passes import (
    MountainPass,
    extract_mountain_passes,
    extract_osm_pass_nodes,
    match_pass_nodes_to_track,
    detect_saddles_and_high_points,
)
from engine.terrain.surfaces import (
    SurfaceType,
    SurfaceInterval,
    SurfaceStats,
    classify_surface,
    infer_firmness,
    tracktype_to_firmness_score,
    firmness_score_to_tracktype,
    clean_and_merge_intervals,
    compute_surface_stats,
    generate_route_surfaces,
    PAVED_SURFACES,
    GRAVEL_SURFACES,
    DIRT_SURFACES,
    SAND_SURFACES,
    PAVED_HIGHWAYS,
    SINGLETRACK_HIGHWAYS,
    TRACKTYPE_FIRMNESS,
    FIRMNESS_LABELS,
)
from engine.terrain.dem import (
    DemTile,
    ElevationSample,
    ElevationSampler,
    get_dem_tile_name,
    calculate_intersecting_dem_tiles,
    download_dem_tile,
    create_synthetic_dem_cog,
)

__all__ = [
    # Climbs
    "Climb",
    "ClimbCategory",
    "calculate_fiets_index",
    "classify_climb_category",
    "compute_rolling_max_grade",
    "detect_climbs",
    "annotate_climb_surfaces",
    # Passes
    "MountainPass",
    "extract_mountain_passes",
    "extract_osm_pass_nodes",
    "match_pass_nodes_to_track",
    "detect_saddles_and_high_points",
    # Surfaces
    "SurfaceType",
    "SurfaceInterval",
    "SurfaceStats",
    "classify_surface",
    "infer_firmness",
    "tracktype_to_firmness_score",
    "firmness_score_to_tracktype",
    "clean_and_merge_intervals",
    "compute_surface_stats",
    "generate_route_surfaces",
    "PAVED_SURFACES",
    "GRAVEL_SURFACES",
    "DIRT_SURFACES",
    "SAND_SURFACES",
    "PAVED_HIGHWAYS",
    "SINGLETRACK_HIGHWAYS",
    "TRACKTYPE_FIRMNESS",
    "FIRMNESS_LABELS",
    # DEM
    "DemTile",
    "ElevationSample",
    "ElevationSampler",
    "get_dem_tile_name",
    "calculate_intersecting_dem_tiles",
    "download_dem_tile",
    "create_synthetic_dem_cog",
]
