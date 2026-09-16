"""
engine.enrichment.water - Backcountry water source extraction, hierarchical 4-tier
priority scoring, 200m spatial deduplication, and 5km segment throttling.
"""

from dataclasses import dataclass, field
from enum import Enum, IntEnum
import json
import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.core.models import RoutePoint, RouteTrack
from engine.utils.geo import haversine_distance, haversine_distance_m
from engine.utils.io import read_json
from engine.utils.spatial import TrackIndex
from engine.utils.text import slugify
from engine.utils.units import km_to_miles

logger = logging.getLogger(__name__)


class WaterTier(IntEnum):
    """Hierarchical water quality tiers. Lower value = higher priority."""
    POTABLE_AMENITY = 1     # Municipal tap, fountain, verified potable amenity
    NATURAL_SPRING = 2      # Natural spring, artesian well
    STREAM_RIVER = 3        # Flowing creek, stream, river crossing
    LAKE_RESERVOIR = 4      # Standing lake, reservoir, pond, tank


class WaterReliability(str, Enum):
    """Water reliability classification."""
    RELIABLE = "reliable"
    SEASONAL = "seasonal"
    TREATMENT_REQUIRED = "treatment_required"
    EMERGENCY_ONLY = "emergency_only"


RELIABILITY_RANKS: Dict[Union[WaterReliability, str], int] = {
    WaterReliability.RELIABLE: 0,
    "reliable": 0,
    WaterReliability.SEASONAL: 1,
    "seasonal": 1,
    WaterReliability.TREATMENT_REQUIRED: 2,
    "treatment_required": 2,
    WaterReliability.EMERGENCY_ONLY: 3,
    "emergency_only": 3,
}


@dataclass
class WaterWaypoint:
    """
    Domain representation of a backcountry water source or potable resupply waypoint.
    """
    id: str
    name: str
    type: str = "water"
    km: float = 0.0
    mile: float = 0.0
    elevation_m: Optional[float] = None
    dist_off_route_m: float = 0.0
    coordinates: Tuple[float, float] = (0.0, 0.0)
    reliability: str = "reliable"
    treatment_required: bool = True
    source_type: str = "spring"
    tier: int = 2
    osm_id: Optional[int] = None
    description: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.km = round(float(self.km), 3)
        if self.mile == 0.0 and self.km > 0.0:
            self.mile = round(km_to_miles(self.km), 3)
        else:
            self.mile = round(float(self.mile), 3)
        if self.elevation_m is not None:
            self.elevation_m = round(float(self.elevation_m), 1)
        self.dist_off_route_m = round(float(self.dist_off_route_m), 1)

        # Standardize tier to int
        if isinstance(self.tier, WaterTier):
            self.tier = int(self.tier.value)
        else:
            self.tier = int(self.tier)

        # Standardize reliability to str
        if isinstance(self.reliability, WaterReliability):
            self.reliability = str(self.reliability.value)
        else:
            self.reliability = str(self.reliability)

        if not self.id:
            slug = slugify(self.name, sep="_") or f"water_{int(round(self.km))}km"
            self.id = f"water_osm_{slug}_{int(round(self.km))}km"

    @property
    def distance_to_trail_km(self) -> float:
        """Distance lateral offset in kilometers."""
        return round(self.dist_off_route_m / 1000.0, 3)

    def to_dict(self) -> Dict[str, Any]:
        """Export domain snake_case dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "km": round(self.km, 1),
            "mile": round(self.mile, 1),
            "elevation_m": self.elevation_m,
            "dist_off_route_m": self.dist_off_route_m,
            "distance_to_trail_km": self.distance_to_trail_km,
            "coordinates": [round(self.coordinates[0], 5), round(self.coordinates[1], 5)],
            "reliability": self.reliability,
            "treatment_required": self.treatment_required,
            "source_type": self.source_type,
            "tier": self.tier,
            "osm_id": self.osm_id,
            "description": self.description,
            "extra": self.extra,
        }

    def to_places_dict(self) -> Dict[str, Any]:
        """Export standardized places.json schema for Bikepack Navigator."""
        dist_desc = (
            f"{self.dist_off_route_m:.0f}m from trail"
            if self.dist_off_route_m > 10.0
            else "Directly on trail"
        )
        treat_desc = (
            "Natural water source (filtration/treatment required)."
            if self.treatment_required
            else "Potable water (no treatment required)."
        )
        desc = self.description or f"{self.name}. {dist_desc}. {treat_desc}"

        return {
            "id": self.id,
            "name": self.name,
            "category": "water",
            "type": self.type,
            "town": "",
            "is_in_town": False,
            "location": {
                "lat": round(self.coordinates[0], 5),
                "lon": round(self.coordinates[1], 5),
            },
            "distance_to_trail_km": self.distance_to_trail_km,
            "route_km": round(self.km, 1),
            "route_mile": round(self.mile, 1),
            "elevation_m": self.elevation_m,
            "address": self.name,
            "google_maps_url": f"https://maps.google.com/?q={self.coordinates[0]:.5f},{self.coordinates[1]:.5f}",
            "business_status": "OPERATIONAL",
            "reliability": self.reliability,
            "treatment_required": self.treatment_required,
            "source_type": self.source_type,
            "description": desc,
        }


def water_priority_score(candidate: Union[WaterWaypoint, Dict[str, Any]]) -> Tuple[int, int, float]:
    """
    Hierarchical sort key: (tier, reliability_rank, dist_off_route_m).
    Lower tuple is strictly higher priority.
    """
    if isinstance(candidate, WaterWaypoint):
        tier_val = candidate.tier
        rel_val = candidate.reliability
        dist_m = candidate.dist_off_route_m
    else:
        tier_val = int(candidate.get("tier", 4))
        rel_val = candidate.get("reliability", "treatment_required")
        dist_m = float(candidate.get("dist_off_route_m", 0.0))

    rel_rank = RELIABILITY_RANKS.get(rel_val, 2)
    return (int(tier_val), int(rel_rank), float(dist_m))


def classify_osm_water_feature(tags: Dict[str, Any]) -> Tuple[WaterTier, str, WaterReliability, bool, str]:
    """
    Determine (tier, source_type, reliability, treatment_required, label) from OSM tags.
    """
    amenity = tags.get("amenity", "")
    waterway = tags.get("waterway", "")
    natural = tags.get("natural", "")
    water = tags.get("water", "")
    drinking = str(tags.get("drinking_water", "")).lower()
    intermittent = str(tags.get("intermittent", "")).lower() == "yes"
    seasonal = str(tags.get("seasonal", "")).lower() in ("yes", "spring", "summer", "autumn", "winter", "wet_season")
    disused = str(tags.get("disused", "")).lower() == "yes" or str(tags.get("abandoned", "")).lower() == "yes"

    # Tier 1: Potable amenities & explicitly drinking water
    if amenity == "drinking_water" or waterway == "water_point" or drinking == "yes" or tags.get("man_made") == "water_tap":
        tier = WaterTier.POTABLE_AMENITY
        source_type = "amenity"
        treatment = False
        reliability = WaterReliability.EMERGENCY_ONLY if disused else WaterReliability.RELIABLE
        label = "Drinking Water"
        return tier, source_type, reliability, treatment, label

    # Tier 2: Natural springs & groundwater wells
    if natural == "spring" or tags.get("man_made") == "water_well":
        tier = WaterTier.NATURAL_SPRING
        source_type = "spring"
        treatment = True
        if intermittent or seasonal:
            reliability = WaterReliability.SEASONAL
        elif disused:
            reliability = WaterReliability.EMERGENCY_ONLY
        else:
            reliability = WaterReliability.RELIABLE
        label = "Spring"
        return tier, source_type, reliability, treatment, label

    # Tier 3: Flowing waterways
    if waterway in ("river", "stream", "canal", "waterfall", "rapids", "drain", "ditch"):
        tier = WaterTier.STREAM_RIVER
        source_type = "river" if waterway == "river" else "stream"
        treatment = True
        if intermittent or seasonal:
            reliability = WaterReliability.SEASONAL
        elif waterway in ("drain", "ditch"):
            reliability = WaterReliability.EMERGENCY_ONLY
        else:
            reliability = WaterReliability.TREATMENT_REQUIRED
        label = "River Access" if waterway == "river" else "Creek Access"
        return tier, source_type, reliability, treatment, label

    # Tier 4: Standing water bodies (lakes, reservoirs, ponds, tanks)
    if natural == "water" or water in ("lake", "reservoir", "pond", "basin") or tags.get("landuse") == "reservoir" or tags.get("man_made") == "water_tank":
        tier = WaterTier.LAKE_RESERVOIR
        source_type = "reservoir" if (water == "reservoir" or tags.get("landuse") == "reservoir") else "lake"
        treatment = True
        if intermittent or seasonal:
            reliability = WaterReliability.SEASONAL
        elif water in ("pond", "basin") or disused:
            reliability = WaterReliability.EMERGENCY_ONLY
        else:
            reliability = WaterReliability.TREATMENT_REQUIRED
        label = "Reservoir Access" if source_type == "reservoir" else "Lake Access"
        return tier, source_type, reliability, treatment, label

    # Fallback
    return WaterTier.LAKE_RESERVOIR, "water", WaterReliability.TREATMENT_REQUIRED, True, "Water Access"


GENERIC_WATER_NAMES = {
    "water",
    "water access",
    "water point",
    "water source",
    "water tap",
    "drinking water",
    "drinking_water",
    "potable water",
}


def _is_generic_water_name(name: str) -> bool:
    if not name:
        return True
    n = name.strip().lower()
    return (
        n in GENERIC_WATER_NAMES
        or n.startswith("water point")
        or n.startswith("water access")
        or n.startswith("water source")
    )


def deduplicate_water_waypoints(
    waypoints: Sequence[WaterWaypoint],
    threshold_m: float = 200.0
) -> List[WaterWaypoint]:
    """
    200m spatial deduplication along track progression.
    Merges overlapping features within threshold_m, strictly retaining the highest-priority waypoint.
    """
    if not waypoints:
        return []

    sorted_wps = sorted(waypoints, key=lambda w: w.km)
    deduped: List[WaterWaypoint] = []
    threshold_km = threshold_m / 1000.0

    for wp in sorted_wps:
        if not deduped:
            deduped.append(wp)
            continue

        prev = deduped[-1]
        if abs(wp.km - prev.km) <= threshold_km + 1e-6:
            # Overlapping within threshold: compare priority scores (lower tuple is higher priority)
            if water_priority_score(wp) < water_priority_score(prev):
                # Only inherit descriptive name if same tier and wp has a generic placeholder name
                if wp.tier == prev.tier and _is_generic_water_name(wp.name) and not _is_generic_water_name(prev.name):
                    if prev.name.strip():
                        wp.name = prev.name
                deduped[-1] = wp
            else:
                # prev is retained. If prev has a generic name and wp has a specific name of the same tier, upgrade prev.name
                if prev.tier == wp.tier and _is_generic_water_name(prev.name) and not _is_generic_water_name(wp.name):
                    if wp.name.strip():
                        prev.name = wp.name
        else:
            deduped.append(wp)

    return deduped


def throttle_water_segments(
    waypoints: Sequence[WaterWaypoint],
    segment_km: float = 5.0,
    min_spacing_km: Optional[float] = None
) -> List[WaterWaypoint]:
    """
    Throttles water sources to at most 1 primary waypoint per segment_km chunk.
    Enforces min_spacing_km between consecutive waypoints to prevent boundary crowding,
    while guaranteeing that sparse water sources in arid zones are fully preserved.
    """
    if not waypoints:
        return []

    min_spacing = min_spacing_km if min_spacing_km is not None else (segment_km * 0.75)

    # 1. Bucket candidates by segment_km
    buckets: Dict[int, List[WaterWaypoint]] = {}
    for wp in waypoints:
        b_idx = int(math.floor(wp.km / segment_km))
        if b_idx not in buckets:
            buckets[b_idx] = []
        buckets[b_idx].append(wp)

    # 2. Pick best candidate in each bucket based on priority score
    bucket_winners: List[WaterWaypoint] = []
    for b_idx in sorted(buckets.keys()):
        best_wp = min(buckets[b_idx], key=water_priority_score)
        bucket_winners.append(best_wp)

    # 3. Anti-crowding boundary filter across bucket seams
    bucket_winners.sort(key=lambda w: w.km)
    filtered: List[WaterWaypoint] = []

    for wp in bucket_winners:
        if not filtered:
            filtered.append(wp)
            continue

        prev = filtered[-1]
        gap_km = wp.km - prev.km

        if gap_km < min_spacing:
            # Boundary conflict: if current has strictly higher priority, replace previous
            if water_priority_score(wp) < water_priority_score(prev):
                filtered[-1] = wp
        else:
            filtered.append(wp)

    return filtered


def parse_corridor_water_features(
    corridor_data: Union[Dict[str, Any], List[Dict[str, Any]], Path, str]
) -> List[Dict[str, Any]]:
    """
    Parse OSM features from:
    1. Overpass API JSON elements (nodes/ways with tags)
    2. GeoJSON FeatureCollection or list of Features
    3. File path to JSON/GeoJSON file
    """
    if isinstance(corridor_data, (str, Path)):
        corridor_data = read_json(Path(corridor_data), default={})

    features: List[Dict[str, Any]] = []

    if isinstance(corridor_data, dict):
        if "elements" in corridor_data:
            for elem in corridor_data["elements"]:
                tags = elem.get("tags", {})
                if not tags:
                    continue
                coords: List[Tuple[float, float]] = []
                if elem.get("type") == "node" and "lat" in elem and "lon" in elem:
                    coords.append((float(elem["lat"]), float(elem["lon"])))
                elif "geometry" in elem:
                    for pt in elem["geometry"]:
                        if "lat" in pt and "lon" in pt:
                            coords.append((float(pt["lat"]), float(pt["lon"])))
                if coords:
                    features.append({
                        "osm_id": elem.get("id"),
                        "tags": tags,
                        "coords": coords,
                    })

        elif corridor_data.get("type") == "FeatureCollection":
            for feat in corridor_data.get("features", []):
                props = feat.get("properties", {})
                geom = feat.get("geometry", {})
                gtype = geom.get("type", "")
                gcoords = geom.get("coordinates", [])

                coords = []
                if gtype == "Point" and len(gcoords) >= 2:
                    coords.append((float(gcoords[1]), float(gcoords[0])))  # lon,lat -> lat,lon
                elif gtype in ("LineString", "MultiPoint"):
                    for c in gcoords:
                        if len(c) >= 2:
                            coords.append((float(c[1]), float(c[0])))
                elif gtype == "Polygon":
                    for ring in gcoords:
                        for c in ring:
                            if len(c) >= 2:
                                coords.append((float(c[1]), float(c[0])))

                if coords and props:
                    features.append({
                        "osm_id": feat.get("id") or props.get("osm_id"),
                        "tags": props,
                        "coords": coords,
                    })

    elif isinstance(corridor_data, list):
        for item in corridor_data:
            if isinstance(item, dict) and "tags" in item and "coords" in item:
                features.append(item)

    return features


def extract_water_access(
    corridor_geojson_or_elements: Union[Dict[str, Any], List[Dict[str, Any]], Path, str],
    track: Union[RouteTrack, Sequence[Any]],
    max_distance_m: float = 1000.0,
    segment_km: float = 5.0,
    min_spacing_km: Optional[float] = 3.75,
    dedup_threshold_m: float = 200.0
) -> List[WaterWaypoint]:
    """
    Master water access pipeline:
    1. Parses corridor data (Overpass or GeoJSON)
    2. Projects water candidates onto route track
    3. Performs 200m spatial deduplication preserving higher-priority sources
    4. Throttles to 1 source per 5km segment with anti-crowding boundary checks
    """
    # 1. Normalize route track points
    if isinstance(track, RouteTrack):
        pts_5d = [p.to_list_5d() for p in track.points]
    elif track and isinstance(track[0], RoutePoint):
        pts_5d = [p.to_list_5d() for p in track]
    else:
        pts_5d = list(track)

    if not pts_5d:
        return []

    track_index = TrackIndex(pts_5d)
    osm_features = parse_corridor_water_features(corridor_geojson_or_elements)
    max_dist_km = max_distance_m / 1000.0
    candidates: List[WaterWaypoint] = []

    for feat in osm_features:
        tags = feat["tags"]
        coords = feat["coords"]
        name = tags.get("name") or tags.get("description") or ""

        tier, source_type, reliability, treatment, label = classify_osm_water_feature(tags)

        # Build informative name
        if not name and tier >= WaterTier.STREAM_RIVER and source_type not in ("spring", "amenity"):
            name = f"{label}"

        disp_name = f"{name} ({label})" if (name and label not in name) else (name or label)

        best_dist_km = 1e9
        best_pt: Optional[Tuple[float, float]] = None
        best_r_km = 0.0
        best_r_mi = 0.0

        for lat, lon in coords:
            dist_km, r_km, r_mi = track_index.project_point(lat, lon, max_dist_km=max_dist_km)
            if dist_km <= max_dist_km and dist_km < best_dist_km:
                best_dist_km = dist_km
                best_pt = (lat, lon)
                best_r_km = r_km
                best_r_mi = r_mi

        if best_pt is not None:
            ele = None
            if "ele" in tags:
                try:
                    ele = float(tags["ele"])
                except (ValueError, TypeError):
                    pass

            dist_m = best_dist_km * 1000.0
            slug = slugify(name or label, sep="_")
            wid = f"water_osm_{slug}_{int(round(best_r_km))}km"

            wp = WaterWaypoint(
                id=wid,
                name=disp_name,
                type="water",
                km=best_r_km,
                mile=best_r_mi,
                elevation_m=ele,
                dist_off_route_m=dist_m,
                coordinates=best_pt,
                reliability=str(reliability.value if isinstance(reliability, WaterReliability) else reliability),
                treatment_required=treatment,
                source_type=source_type,
                tier=int(tier.value if isinstance(tier, WaterTier) else tier),
                osm_id=feat.get("osm_id"),
                extra={"tags": tags}
            )
            candidates.append(wp)

    # Deduplicate within 200m
    deduped = deduplicate_water_waypoints(candidates, threshold_m=dedup_threshold_m)

    # Throttle segments to 5km
    throttled = throttle_water_segments(
        deduped,
        segment_km=segment_km,
        min_spacing_km=min_spacing_km
    )

    return throttled


def analyze_water_gaps(
    water_waypoints: Sequence[WaterWaypoint],
    total_km: float,
    alert_threshold_km: float = 30.0
) -> List[Dict[str, Any]]:
    """
    Identifies long water carries exceeding alert_threshold_km between reliable water points.
    """
    sorted_wps = sorted(
        [w for w in water_waypoints if w.reliability != WaterReliability.EMERGENCY_ONLY and w.reliability != "emergency_only"],
        key=lambda w: w.km
    )
    gaps: List[Dict[str, Any]] = []

    last_km = 0.0
    for wp in sorted_wps:
        gap = wp.km - last_km
        if gap >= alert_threshold_km:
            gaps.append({
                "start_km": round(last_km, 1),
                "end_km": round(wp.km, 1),
                "gap_km": round(gap, 1),
                "next_source": wp.name,
                "warning": f"Long dry stretch: {gap:.1f} km without reliable water access."
            })
        last_km = wp.km

    final_gap = total_km - last_km
    if final_gap >= alert_threshold_km:
        gaps.append({
            "start_km": round(last_km, 1),
            "end_km": round(total_km, 1),
            "gap_km": round(final_gap, 1),
            "next_source": "Route Finish",
            "warning": f"Final dry stretch: {final_gap:.1f} km to finish without reliable water access."
        })

    return gaps
