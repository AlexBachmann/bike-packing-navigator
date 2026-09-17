"""
engine.osm - OpenStreetMap intelligence, corridor extraction, 50m road snapping, and turn guidance.
"""

from engine.osm.corridor import (
    FeatureType,
    OSMError,
    OverpassError,
    OverpassTimeoutError,
    build_overpass_query,
    compute_corridor_bbox,
    extract_osm_corridor_data,
    extract_water_features_from_pmtiles,
    fetch_overpass_data,
    generate_corridor_polygon,
    partition_track_bboxes,
)
from engine.osm.network import (
    CLASS_PENALTIES,
    OsmNode,
    OsmRoadNetwork,
    OsmWay,
    OsmWaySegment,
    WayCandidate,
)
from engine.osm.snapping import (
    CandidateProjection,
    SnappedGuidanceTrack,
    SnappingConfig,
    calculate_bearing_deflection,
    compute_transition_cost,
    find_candidates_for_point,
    score_candidate,
    snap_track_to_osm,
)
from engine.osm.turns import (
    CueTrigger,
    JunctionAnalysis,
    JunctionType,
    OsmNetworkIndex,
    OsmSegment,
    TurnCue,
    TurnType,
    classify_turn_type,
    extract_turn_cues,
    extract_turns_from_pmtiles,
    generate_instruction,
    save_turns_json,
)

__all__ = [
    # corridor
    "FeatureType",
    "OSMError",
    "OverpassError",
    "OverpassTimeoutError",
    "compute_corridor_bbox",
    "partition_track_bboxes",
    "generate_corridor_polygon",
    "build_overpass_query",
    "fetch_overpass_data",
    "extract_osm_corridor_data",
    "extract_water_features_from_pmtiles",
    # network
    "CLASS_PENALTIES",
    "OsmNode",
    "OsmWay",
    "OsmWaySegment",
    "WayCandidate",
    "OsmRoadNetwork",
    # snapping
    "SnappingConfig",
    "CandidateProjection",
    "SnappedGuidanceTrack",
    "calculate_bearing_deflection",
    "score_candidate",
    "find_candidates_for_point",
    "compute_transition_cost",
    "snap_track_to_osm",
    # turns
    "TurnType",
    "CueTrigger",
    "JunctionType",
    "TurnCue",
    "OsmSegment",
    "JunctionAnalysis",
    "OsmNetworkIndex",
    "classify_turn_type",
    "generate_instruction",
    "extract_turn_cues",
    "extract_turns_from_pmtiles",
    "save_turns_json",
]
