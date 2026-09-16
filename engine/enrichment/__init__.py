"""
engine.enrichment - Backcountry points of interest, persistent API caching,
water access intelligence, navigation milestones, and custom GPX waypoints.
"""

from engine.enrichment.cache import (
    CacheEntry,
    CacheError,
    CacheCorruptedError,
    APICache,
    DEFAULT_CACHE_ROOT,
    DEFAULT_TTL_PLACES_SEC,
    DEFAULT_TTL_OVERPASS_SEC,
)

from engine.enrichment.places import (
    ResupplyCategory,
    PlaceLocation,
    Place,
    GooglePlacesClient,
    MockPlacesClient,
    fetch_places_along_route,
    PLACES_TYPE_TO_CATEGORY,
    FRONTEND_CATEGORY_MAP,
)

from engine.enrichment.water import (
    WaterTier,
    WaterReliability,
    WaterWaypoint,
    classify_osm_water_feature,
    water_priority_score,
    deduplicate_water_waypoints,
    throttle_water_segments,
    parse_corridor_water_features,
    extract_water_access,
    analyze_water_gaps,
)

from engine.enrichment.milestones import (
    MilestoneType,
    ServiceType,
    RouteMilestone,
    ResupplyInterval,
    generate_route_milestones,
    compute_resupply_intervals,
    calculate_max_dry_stretch,
)

from engine.enrichment.waypoints import (
    CustomWaypoint,
    classify_waypoint,
    extract_raw_gpx_waypoints,
    project_waypoints_to_track,
    extract_and_project_waypoints,
)

__all__ = [
    # cache
    "CacheEntry",
    "CacheError",
    "CacheCorruptedError",
    "APICache",
    "DEFAULT_CACHE_ROOT",
    "DEFAULT_TTL_PLACES_SEC",
    "DEFAULT_TTL_OVERPASS_SEC",
    # places
    "ResupplyCategory",
    "PlaceLocation",
    "Place",
    "GooglePlacesClient",
    "MockPlacesClient",
    "fetch_places_along_route",
    "PLACES_TYPE_TO_CATEGORY",
    "FRONTEND_CATEGORY_MAP",
    # water
    "WaterTier",
    "WaterReliability",
    "WaterWaypoint",
    "classify_osm_water_feature",
    "water_priority_score",
    "deduplicate_water_waypoints",
    "throttle_water_segments",
    "parse_corridor_water_features",
    "extract_water_access",
    "analyze_water_gaps",
    # milestones
    "MilestoneType",
    "ServiceType",
    "RouteMilestone",
    "ResupplyInterval",
    "generate_route_milestones",
    "compute_resupply_intervals",
    "calculate_max_dry_stretch",
    # waypoints
    "CustomWaypoint",
    "classify_waypoint",
    "extract_raw_gpx_waypoints",
    "project_waypoints_to_track",
    "extract_and_project_waypoints",
]
