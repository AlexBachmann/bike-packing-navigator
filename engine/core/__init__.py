"""
engine.core - Core GPX parsing, telemetry calculation, track operations, and route manifest management.
"""

from engine.core.models import (
    GPXError,
    EmptyGPXError,
    CorruptedGPXError,
    InvalidGPXError,
    EmptyTrackError,
    RoutePoint,
    RouteWaypoint,
    RouteTrack,
)

from engine.core.gpx import (
    parse_gpx,
    parse_gpx_track,
)

from engine.core.track import (
    TrackTelemetry,
    ProjectionResult,
    build_track_points,
    smooth_elevations,
    calculate_elevation_gain_loss,
    compute_track_telemetry,
    calculate_point_grades,
    calculate_segment_grade,
    compute_track_bounding_box,
    slice_track_by_km,
    find_nearest_track_point,
    project_point_to_track_segment,
    sample_elevation_profile,
)

from engine.core.manifest import (
    REQUIRED_ROUTE_DATA_FILES,
    OPTIONAL_ROUTE_DATA_FILES,
    ManifestError,
    ManifestNotFoundError,
    ManifestCorruptError,
    MissingRouteDataError,
    RouteVerificationResult,
    RouteManifestEntry,
    RouteManifest,
    load_manifest,
    backup_manifest,
    save_manifest,
    verify_route_data_files,
    register_route,
)

__all__ = [
    # models
    "GPXError",
    "EmptyGPXError",
    "CorruptedGPXError",
    "InvalidGPXError",
    "EmptyTrackError",
    "RoutePoint",
    "RouteWaypoint",
    "RouteTrack",
    # gpx
    "parse_gpx",
    "parse_gpx_track",
    # track
    "TrackTelemetry",
    "ProjectionResult",
    "build_track_points",
    "smooth_elevations",
    "calculate_elevation_gain_loss",
    "compute_track_telemetry",
    "calculate_point_grades",
    "calculate_segment_grade",
    "compute_track_bounding_box",
    "slice_track_by_km",
    "find_nearest_track_point",
    "project_point_to_track_segment",
    "sample_elevation_profile",
    # manifest
    "REQUIRED_ROUTE_DATA_FILES",
    "OPTIONAL_ROUTE_DATA_FILES",
    "ManifestError",
    "ManifestNotFoundError",
    "ManifestCorruptError",
    "MissingRouteDataError",
    "RouteVerificationResult",
    "RouteManifestEntry",
    "RouteManifest",
    "load_manifest",
    "backup_manifest",
    "save_manifest",
    "verify_route_data_files",
    "register_route",
]
