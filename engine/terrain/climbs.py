"""
engine.terrain.climbs - Climb detection, UCI Cat 1-4/HC difficulty categorization,
Fiets Index calculation, rolling-window maximum grade, and surface enrichment.
"""

from collections import Counter
from dataclasses import dataclass, field
from enum import Enum
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.utils.geo import haversine_distance_m
from engine.utils.io import read_json
from engine.utils.text import slugify
from engine.utils.units import km_to_miles, meters_to_feet

try:
    from shapely.geometry import Point as ShapelyPoint, shape as shapely_shape
except ImportError:
    ShapelyPoint = None
    shapely_shape = None


# -----------------------------------------------------------------------------
# Categories & Enums
# -----------------------------------------------------------------------------

class ClimbCategory(str, Enum):
    """UCI / Cycling climb difficulty categories based on the Fiets Index."""
    HC = "HC"
    CAT_1 = "Cat 1"
    CAT_2 = "Cat 2"
    CAT_3 = "Cat 3"
    CAT_4 = "Cat 4"
    UNCATEGORIZED = "Uncategorized"

    @property
    def difficulty(self) -> str:
        """Map to frontend difficulty: 'moderate' | 'difficult' | 'extreme'."""
        if self in (ClimbCategory.HC, ClimbCategory.CAT_1):
            return "extreme"
        elif self == ClimbCategory.CAT_2:
            return "difficult"
        return "moderate"


# -----------------------------------------------------------------------------
# Dataclass Model
# -----------------------------------------------------------------------------

@dataclass
class Climb:
    """
    Domain representation of a continuous mountain or hill climb segment.
    Provides dual-compatibility dictionary serialization for both domain snake_case
    and frontend camelCase interfaces (src/app/models/elevation.model.ts).
    """
    id: str
    name: str
    start_km: float
    end_km: float
    length_km: float
    elevation_gain_m: float
    avg_grade: float
    max_grade: float
    category: str = "Cat 4"
    surface_summary: str = "Unpaved Gravel"
    start_ele_m: float = 0.0
    summit_ele_m: float = 0.0
    start_mile: float = 0.0
    end_mile: float = 0.0
    length_miles: float = 0.0
    elevation_gain_ft: float = 0.0
    start_ele_ft: float = 0.0
    summit_ele_ft: float = 0.0
    fiets_score: float = 0.0
    difficulty: str = "moderate"
    is_iconic: bool = False
    pass_id: Optional[str] = None
    trail_name: Optional[str] = None
    park_name: Optional[str] = None
    landmark: Optional[str] = None
    road_class: Optional[str] = None
    surface: Optional[str] = None
    firmness: Optional[str] = None
    tracktype: Optional[str] = None
    notes: Optional[str] = None
    state: str = ""
    start_coords: Optional[Tuple[float, float]] = None   # (lat, lon)
    summit_coords: Optional[Tuple[float, float]] = None  # (lat, lon)
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.start_km = round(float(self.start_km), 3)
        self.end_km = round(float(self.end_km), 3)
        self.length_km = round(float(self.length_km), 3)
        self.elevation_gain_m = round(float(self.elevation_gain_m), 1)
        self.avg_grade = round(float(self.avg_grade), 1)
        self.max_grade = round(float(self.max_grade), 1)
        self.fiets_score = round(float(self.fiets_score), 2)
        self.start_ele_m = round(float(self.start_ele_m), 1)
        self.summit_ele_m = round(float(self.summit_ele_m), 1)

        # Derived Imperial telemetry
        self.start_mile = round(km_to_miles(self.start_km), 2)
        self.end_mile = round(km_to_miles(self.end_km), 2)
        self.length_miles = round(km_to_miles(self.length_km), 2)
        self.elevation_gain_ft = round(meters_to_feet(self.elevation_gain_m), 1)
        self.start_ele_ft = round(meters_to_feet(self.start_ele_m), 1)
        self.summit_ele_ft = round(meters_to_feet(self.summit_ele_m), 1)

    def to_dict(self) -> Dict[str, Any]:
        """
        Export dictionary conforming simultaneously to:
        1. Pure Python domain snake_case contracts.
        2. Angular camelCase interfaces (src/app/models/elevation.model.ts).
        """
        return {
            # Domain snake_case keys
            "id": self.id,
            "name": self.name,
            "start_km": round(self.start_km, 3),
            "end_km": round(self.end_km, 3),
            "length_km": round(self.length_km, 3),
            "elevation_gain_m": round(self.elevation_gain_m, 1),
            "avg_grade": round(self.avg_grade, 1),
            "max_grade": round(self.max_grade, 1),
            "category": self.category,
            "surface_summary": self.surface_summary,
            "fiets_score": round(self.fiets_score, 2),
            "start_ele_m": round(self.start_ele_m, 1),
            "summit_ele_m": round(self.summit_ele_m, 1),
            "pass_id": self.pass_id,
            "trail_name": self.trail_name,
            "park_name": self.park_name,
            "landmark": self.landmark,
            "is_iconic": self.is_iconic,

            # Frontend camelCase keys
            "state": self.state,
            "startMile": round(self.start_mile, 1),
            "endMile": round(self.end_mile, 1),
            "startKm": round(self.start_km, 1),
            "endKm": round(self.end_km, 1),
            "lengthMiles": round(self.length_miles, 1),
            "lengthKm": round(self.length_km, 1),
            "startElevationMeters": round(self.start_ele_m),
            "summitElevationMeters": round(self.summit_ele_m),
            "startElevationFeet": round(self.start_ele_ft),
            "summitElevationFeet": round(self.summit_ele_ft),
            "elevationGainMeters": round(self.elevation_gain_m),
            "elevationGainFeet": round(self.elevation_gain_ft),
            "avgGradePercent": round(self.avg_grade, 1),
            "maxGradePercent": round(self.max_grade, 1),
            "isIconic": self.is_iconic,
            "difficulty": self.difficulty,
            "passId": self.pass_id,
            "roadClass": self.road_class or "Unclassified Gravel Road",
            "surface": self.surface or "Gravel",
            "firmness": self.firmness or "Grade 2: Solid Unpaved (Compacted Gravel)",
            "tracktype": self.tracktype or "grade2",
            "trailName": self.trail_name,
            "parkName": self.park_name,
            "landmark": self.landmark,
            "notes": self.notes or f"Sustained climb gaining {round(self.elevation_gain_m)}m over {round(self.length_km, 1)}km."
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Climb":
        """
        Parse a dictionary into a Climb dataclass instance.
        Supports both domain snake_case and frontend camelCase keys,
        handling category parsing via ClimbCategory enum lookup or fallback.
        """
        climb_id = str(data.get("id", ""))
        name = str(data.get("name", ""))

        start_km = float(data.get("start_km", data.get("startKm", 0.0)))
        end_km = float(data.get("end_km", data.get("endKm", 0.0)))
        length_km = float(data.get("length_km", data.get("lengthKm", abs(end_km - start_km))))
        elevation_gain_m = float(data.get("elevation_gain_m", data.get("elevationGainMeters", 0.0)))
        avg_grade = float(data.get("avg_grade", data.get("avgGradePercent", 0.0)))
        max_grade = float(data.get("max_grade", data.get("maxGradePercent", avg_grade)))

        # Category parsing with ClimbCategory enum lookup and fallback
        cat_raw = data.get("category")
        if cat_raw is not None:
            if isinstance(cat_raw, ClimbCategory):
                category = cat_raw.value
            elif isinstance(cat_raw, str):
                try:
                    category = ClimbCategory[cat_raw].value
                except KeyError:
                    matched = False
                    for enum_item in ClimbCategory:
                        if enum_item.value.lower() == cat_raw.lower() or enum_item.name.lower() == cat_raw.lower():
                            category = enum_item.value
                            matched = True
                            break
                    if not matched:
                        category = cat_raw
            else:
                category = str(cat_raw)
        else:
            category = "Cat 4"

        start_ele_m = float(data.get("start_ele_m", data.get("startElevationMeters", 0.0)))
        summit_ele_m = float(data.get("summit_ele_m", data.get("summitElevationMeters", 0.0)))

        fiets_score = float(data.get("fiets_score", data.get("fietsScore", 0.0)))
        if fiets_score == 0.0 and length_km > 0.0 and elevation_gain_m > 0.0:
            fiets_score = calculate_fiets_index(elevation_gain_m, length_km * 1000.0, summit_ele_m)

        surface_summary = str(data.get("surface_summary", data.get("surfaceSummary", data.get("surface", "Unpaved Gravel"))))
        difficulty = str(data.get("difficulty", "moderate"))
        is_iconic = bool(data.get("is_iconic", data.get("isIconic", False)))
        pass_id = data.get("pass_id", data.get("passId"))
        trail_name = data.get("trail_name", data.get("trailName"))
        park_name = data.get("park_name", data.get("parkName"))
        landmark = data.get("landmark")
        road_class = data.get("road_class", data.get("roadClass"))
        surface = data.get("surface")
        firmness = data.get("firmness")
        tracktype = data.get("tracktype")
        notes = data.get("notes")
        state = str(data.get("state", ""))

        start_coords = None
        if "start_coords" in data and data["start_coords"]:
            start_coords = (float(data["start_coords"][0]), float(data["start_coords"][1]))
        elif "startCoords" in data and data["startCoords"]:
            start_coords = (float(data["startCoords"][0]), float(data["startCoords"][1]))
        elif "start_lat" in data and "start_lon" in data:
            start_coords = (float(data["start_lat"]), float(data["start_lon"]))

        summit_coords = None
        if "summit_coords" in data and data["summit_coords"]:
            summit_coords = (float(data["summit_coords"][0]), float(data["summit_coords"][1]))
        elif "summitCoords" in data and data["summitCoords"]:
            summit_coords = (float(data["summitCoords"][0]), float(data["summitCoords"][1]))
        elif "summit_lat" in data and "summit_lon" in data:
            summit_coords = (float(data["summit_lat"]), float(data["summit_lon"]))

        extra = data.get("extra", {})

        return cls(
            id=climb_id,
            name=name,
            start_km=start_km,
            end_km=end_km,
            length_km=length_km,
            elevation_gain_m=elevation_gain_m,
            avg_grade=avg_grade,
            max_grade=max_grade,
            category=category,
            surface_summary=surface_summary,
            start_ele_m=start_ele_m,
            summit_ele_m=summit_ele_m,
            fiets_score=fiets_score,
            difficulty=difficulty,
            is_iconic=is_iconic,
            pass_id=str(pass_id) if pass_id is not None else None,
            trail_name=str(trail_name) if trail_name is not None else None,
            park_name=str(park_name) if park_name is not None else None,
            landmark=str(landmark) if landmark is not None else None,
            road_class=str(road_class) if road_class is not None else None,
            surface=str(surface) if surface is not None else None,
            firmness=str(firmness) if firmness is not None else None,
            tracktype=str(tracktype) if tracktype is not None else None,
            notes=str(notes) if notes is not None else None,
            state=state,
            start_coords=start_coords,
            summit_coords=summit_coords,
            extra=extra,
        )


# -----------------------------------------------------------------------------
# Fiets Index & UCI Categorization
# -----------------------------------------------------------------------------

def calculate_fiets_index(
    elevation_gain_m: float,
    length_m: float,
    summit_elevation_m: float = 0.0
) -> float:
    """
    Compute Fiets difficulty score: (H^2 / (D * 10)) + max(0, (T - 1000)/1000).
    - H: Elevation gain in meters
    - D: Distance in meters
    - T: Summit elevation in meters (altitudes above 1000m receive hypoxia difficulty penalty)
    """
    if elevation_gain_m <= 0.0 or length_m <= 0.0:
        return 0.0

    base = (elevation_gain_m ** 2) / (length_m * 10.0)
    altitude_bonus = max(0.0, (summit_elevation_m - 1000.0) / 1000.0)
    return round(base + altitude_bonus, 2)


def classify_climb_category(
    fiets_score: float,
    elevation_gain_m: float = 0.0,
    length_m: float = 0.0,
    avg_grade: float = 0.0
) -> str:
    """
    Classify a climb into UCI category based on Fiets Index score:
    - HC: >= 6.5
    - Cat 1: >= 5.0
    - Cat 2: >= 3.5
    - Cat 3: >= 2.0
    - Cat 4: >= 0.5 (or >= 0.25 if meeting minimum climb threshold)
    - Uncategorized: < 0.5
    """
    if fiets_score >= 6.5:
        return ClimbCategory.HC.value
    elif fiets_score >= 5.0:
        return ClimbCategory.CAT_1.value
    elif fiets_score >= 3.5:
        return ClimbCategory.CAT_2.value
    elif fiets_score >= 2.0:
        return ClimbCategory.CAT_3.value
    elif fiets_score >= 0.5:
        return ClimbCategory.CAT_4.value
    elif elevation_gain_m >= 50.0 and length_m >= 500.0 and avg_grade >= 3.0:
        return ClimbCategory.CAT_4.value
    return ClimbCategory.UNCATEGORIZED.value


# -----------------------------------------------------------------------------
# Rolling Window Maximum Grade
# -----------------------------------------------------------------------------

def compute_rolling_max_grade(
    points: Sequence[Any],
    start_idx: int,
    end_idx: int,
    window_m: float = 100.0
) -> float:
    """
    Calculate maximum sustained grade over a rolling distance window (default ~100m).
    Prevents false elevation spikes from GPS noise while capturing genuine steep kickers.
    """
    if not points or start_idx >= end_idx:
        return 0.0

    max_grade = 0.0
    n = len(points)
    end_idx = min(end_idx, n - 1)

    for i in range(start_idx, end_idx):
        p1 = points[i]
        p1_km = float(p1[3])
        p1_ele = float(p1[2])

        for j in range(i + 1, end_idx + 1):
            p2 = points[j]
            p2_km = float(p2[3])
            dist_m = (p2_km - p1_km) * 1000.0

            if dist_m >= window_m:
                gain_m = float(p2[2]) - p1_ele
                if dist_m > 0.0:
                    local_grade = (gain_m / dist_m) * 100.0
                    if local_grade > max_grade:
                        max_grade = local_grade
                break

    # Physical clamping to plausible cycling gradients [0.0%, 35.0%]
    clamped = max(0.0, min(35.0, max_grade))
    return round(clamped, 1)


# -----------------------------------------------------------------------------
# Surface Annotation
# -----------------------------------------------------------------------------

def annotate_climb_surfaces(
    climbs: List[Climb],
    road_network_or_corridor: Any = None
) -> List[Climb]:
    """
    Enrich climbs with surface attributes, road class, and surface summary
    using spatial intersection against OSM ways or adaptive terrain heuristic.
    """
    for c in climbs:
        # Check if road network or surface intervals are available
        matched_hw = None
        matched_surf = None
        matched_tt = None

        if road_network_or_corridor is not None:
            try:
                if hasattr(road_network_or_corridor, "find_nearest_way") and c.start_coords:
                    match = road_network_or_corridor.find_nearest_way(
                        c.start_coords[0], c.start_coords[1], max_dist_m=100.0
                    )
                    if match:
                        way = getattr(match, "way", None)
                        if way is None and hasattr(road_network_or_corridor, "ways"):
                            if isinstance(road_network_or_corridor.ways, list) and 0 <= match.way_id < len(road_network_or_corridor.ways):
                                way = road_network_or_corridor.ways[match.way_id]
                            elif isinstance(road_network_or_corridor.ways, dict) and match.way_id in road_network_or_corridor.ways:
                                way = road_network_or_corridor.ways[match.way_id]
                        tags = getattr(way, "tags", {}) if way else (getattr(match, "tags", {}) or {})
                        matched_hw = getattr(way, "highway", None) or getattr(match, "highway", None)
                        matched_surf = getattr(way, "surface", None) or tags.get("surface")
                        matched_tt = getattr(way, "tracktype", None) or tags.get("tracktype")
            except Exception:
                pass

        # Fallback adaptive heuristic based on average grade
        if not matched_hw or not matched_surf:
            if c.avg_grade >= 8.0:
                c.road_class = "Singletrack Trail"
                c.surface = "Natural Dirt / Ground"
                c.firmness = "Grade 4: Soft Dirt (High Mud Risk)"
                c.tracktype = "grade4"
            elif c.avg_grade >= 5.0:
                c.road_class = "Forest Road (Doubletrack)"
                c.surface = "Gravel"
                c.firmness = "Grade 2: Solid Unpaved (Compacted Gravel)"
                c.tracktype = "grade2"
            else:
                c.road_class = "Unclassified Gravel Road"
                c.surface = "Compacted Hardpack"
                c.firmness = "Grade 2: Solid Unpaved (Compacted Gravel)"
                c.tracktype = "grade2"
        else:
            c.road_class = matched_hw
            c.surface = matched_surf or "Gravel"
            c.tracktype = matched_tt or "grade2"
            c.firmness = "Grade 2: Solid Unpaved (Compacted Gravel)"

        c.surface_summary = f"{c.surface} ({c.tracktype})"

    return climbs


# -----------------------------------------------------------------------------
# OSM Spatial Harvesting & Geographic Identity Enrichment
# -----------------------------------------------------------------------------

def extract_osm_peaks(corridor_data: Any) -> List[Dict[str, Any]]:
    """
    Extract mountain peak landmarks (natural=peak, natural=volcano)
    from Overpass JSON elements or GeoJSON FeatureCollection.
    """
    if not corridor_data:
        return []

    if isinstance(corridor_data, (str, Path)):
        corridor_data = read_json(Path(corridor_data), default={})

    peaks: List[Dict[str, Any]] = []

    # 1. Overpass elements
    if isinstance(corridor_data, dict) and "elements" in corridor_data:
        for elem in corridor_data["elements"]:
            tags = elem.get("tags") or {}
            if tags.get("natural") in ("peak", "volcano") or tags.get("mountain_pass") == "yes":
                name = tags.get("name") or tags.get("name:en")
                if not name:
                    continue
                lat = elem.get("lat")
                lon = elem.get("lon")
                if lat is None or lon is None:
                    continue
                ele = None
                if "ele" in tags:
                    try:
                        ele = float(tags["ele"])
                    except (ValueError, TypeError):
                        ele = None
                peaks.append({
                    "osm_id": elem.get("id"),
                    "name": name,
                    "lat": float(lat),
                    "lon": float(lon),
                    "ele": ele,
                    "tags": tags,
                })

    # 2. GeoJSON FeatureCollection
    elif isinstance(corridor_data, dict) and "features" in corridor_data:
        for feat in corridor_data.get("features", []):
            props = feat.get("properties") or {}
            geom = feat.get("geometry") or {}
            is_peak = (
                props.get("natural") in ("peak", "volcano") or
                props.get("mountain_pass") == "yes" or
                props.get("landmark_type") == "peak"
            )
            if is_peak:
                name = props.get("name") or props.get("name:en")
                if not name:
                    continue
                gtype = geom.get("type")
                coords = geom.get("coordinates")
                if gtype == "Point" and coords and len(coords) >= 2:
                    lon, lat = float(coords[0]), float(coords[1])
                    ele = None
                    if "ele" in props:
                        try:
                            ele = float(props["ele"])
                        except (ValueError, TypeError):
                            ele = None
                    peaks.append({
                        "osm_id": feat.get("id") or props.get("osm_id"),
                        "name": name,
                        "lat": lat,
                        "lon": lon,
                        "ele": ele,
                        "tags": props,
                    })

    elif isinstance(corridor_data, list):
        for item in corridor_data:
            if isinstance(item, dict) and "name" in item and "lat" in item and "lon" in item:
                peaks.append(item)

    return peaks


def extract_osm_boundaries(corridor_data: Any) -> List[Dict[str, Any]]:
    """
    Extract national parks, protected areas, nature reserves, and public land boundaries
    from Overpass JSON elements or GeoJSON FeatureCollection.
    """
    if not corridor_data:
        return []

    if isinstance(corridor_data, (str, Path)):
        corridor_data = read_json(Path(corridor_data), default={})

    boundaries: List[Dict[str, Any]] = []

    def _is_boundary_tags(tags: Dict[str, Any]) -> bool:
        b_val = str(tags.get("boundary", "")).lower()
        l_val = str(tags.get("leisure", "")).lower()
        p_val = str(tags.get("protection_title", "")).lower()
        lu_val = str(tags.get("landuse", "")).lower()

        if b_val in ("national_park", "protected_area", "forest", "national_forest", "state_park", "nature_reserve"):
            return True
        if l_val in ("nature_reserve", "park"):
            return True
        if lu_val in ("forest", "nature_reserve"):
            return True
        if p_val in ("national park", "nature reserve", "wilderness", "monument"):
            return True
        if str(tags.get("protect_class", "")) in ("1", "2", "3", "4", "5", "6"):
            return True
        return False

    if isinstance(corridor_data, dict) and "features" in corridor_data:
        for feat in corridor_data.get("features", []):
            props = feat.get("properties") or {}
            name = props.get("name") or props.get("name:en") or props.get("official_name")
            if not name:
                continue
            if _is_boundary_tags(props):
                geom = feat.get("geometry") or {}
                shapely_obj = None
                if shapely_shape is not None and geom:
                    try:
                        shapely_obj = shapely_shape(geom)
                    except Exception:
                        shapely_obj = None

                boundaries.append({
                    "name": name,
                    "geometry": geom,
                    "shapely_geom": shapely_obj,
                    "tags": props,
                })

    elif isinstance(corridor_data, dict) and "elements" in corridor_data:
        for elem in corridor_data.get("elements", []):
            tags = elem.get("tags") or {}
            name = tags.get("name") or tags.get("name:en") or tags.get("official_name")
            if not name or not _is_boundary_tags(tags):
                continue
            if "geometry" in elem and len(elem["geometry"]) >= 3:
                ring = [[float(pt["lon"]), float(pt["lat"])] for pt in elem["geometry"]]
                geom = {"type": "Polygon", "coordinates": [ring]}
                shapely_obj = None
                if shapely_shape is not None:
                    try:
                        shapely_obj = shapely_shape(geom)
                    except Exception:
                        shapely_obj = None
                boundaries.append({
                    "name": name,
                    "geometry": geom,
                    "shapely_geom": shapely_obj,
                    "tags": tags,
                })

    return boundaries


def _point_in_polygon_ring(lat: float, lon: float, ring: Sequence[Sequence[float]]) -> bool:
    """
    Ray-casting point-in-polygon test.
    ring: sequence of [lon, lat] coordinate pairs.
    """
    inside = False
    n = len(ring)
    if n < 3:
        return False
    p1x, p1y = float(ring[0][0]), float(ring[0][1])  # lon, lat
    for i in range(1, n + 1):
        p2x, p2y = float(ring[i % n][0]), float(ring[i % n][1])
        if (p1y <= lat < p2y) or (p2y <= lat < p1y):
            if p1y != p2y:
                xinters = (lat - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                if lon <= xinters:
                    inside = not inside
        p1x, p1y = p2x, p2y
    return inside


def is_point_in_boundary(lat: float, lon: float, boundary: Dict[str, Any]) -> bool:
    """Determine if geographic point (lat, lon) falls inside a boundary polygon."""
    if boundary.get("shapely_geom") is not None and ShapelyPoint is not None:
        try:
            return bool(boundary["shapely_geom"].contains(ShapelyPoint(lon, lat)))
        except Exception:
            pass

    geom = boundary.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []

    if gtype == "Polygon" and coords:
        if _point_in_polygon_ring(lat, lon, coords[0]):
            for hole in coords[1:]:
                if _point_in_polygon_ring(lat, lon, hole):
                    return False
            return True
    elif gtype == "MultiPolygon" and coords:
        for poly in coords:
            if poly and _point_in_polygon_ring(lat, lon, poly[0]):
                in_hole = False
                for hole in poly[1:]:
                    if _point_in_polygon_ring(lat, lon, hole):
                        in_hole = True
                        break
                if not in_hole:
                    return True
    return False


def extract_dominant_trail_name(
    climb: Climb,
    track_or_points: Any,
    road_network: Any
) -> Optional[str]:
    """
    Sample points along a climb segment against the road network to harvest
    the authentic trail or road name / ref.
    """
    if road_network is None or not hasattr(road_network, "find_nearest_way"):
        return None

    pts = track_or_points.points if hasattr(track_or_points, "points") else track_or_points
    if not pts:
        return None

    climb_pts: List[Tuple[float, float]] = []
    for pt in pts:
        pt_km = float(pt[3])
        if climb.start_km <= pt_km <= climb.end_km:
            climb_pts.append((float(pt[0]), float(pt[1])))

    if not climb_pts:
        if climb.start_coords and climb.summit_coords:
            climb_pts = [climb.start_coords, climb.summit_coords]
        else:
            return None

    sample_count = min(7, len(climb_pts))
    step = max(1, len(climb_pts) // sample_count)
    sampled = [climb_pts[idx] for idx in range(0, len(climb_pts), step)]

    name_counts: Counter[str] = Counter()

    for lat, lon in sampled:
        try:
            match = road_network.find_nearest_way(lat, lon, threshold_m=100.0)
            if match and hasattr(road_network, "ways"):
                way = None
                if isinstance(road_network.ways, list) and 0 <= match.way_id < len(road_network.ways):
                    way = road_network.ways[match.way_id]
                elif isinstance(road_network.ways, dict) and match.way_id in road_network.ways:
                    way = road_network.ways[match.way_id]
                if way:
                    tags = getattr(way, "tags", {}) or {}
                    w_name = getattr(way, "name", "") or tags.get("tiger:name_base") or tags.get("ref") or ""
                    w_name = w_name.strip()
                    if w_name and w_name.lower() not in ("unnamed", "track", "path", "trail"):
                        name_counts[w_name] += 1
        except Exception:
            continue

    if name_counts:
        dominant_name, _ = name_counts.most_common(1)[0]
        return dominant_name

    return None


def find_nearby_landmark(
    climb: Climb,
    peaks: List[Dict[str, Any]],
    max_dist_m: float = 3500.0
) -> Optional[str]:
    """
    Find the most prominent mountain peak or landmark within max_dist_m (default 3.5 km)
    of the climb summit.
    """
    if not peaks or not climb.summit_coords:
        return None

    s_lat, s_lon = climb.summit_coords
    candidates: List[Tuple[float, float, str, Optional[float]]] = []

    for p in peaks:
        dist_m = haversine_distance_m(s_lat, s_lon, p["lat"], p["lon"])
        if dist_m <= max_dist_m:
            ele = p.get("ele")
            ele_val = float(ele) if ele is not None else 0.0
            p_name = p["name"].strip()
            if p_name:
                candidates.append((-ele_val, dist_m, p_name, ele))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1]))
    _, _, best_name, best_ele = candidates[0]

    if best_ele is not None and best_ele > 0:
        return f"{best_name} ({int(round(float(best_ele)))}m)"
    return best_name


def generate_evocative_climb_name(climb: Climb) -> str:
    """
    Generate an authentic, evocative climb name derived from landmark peak,
    trail, or mountain park identity.
    """
    if not climb.name.startswith("Climb "):
        return climb.name

    if climb.landmark:
        base_landmark = climb.landmark.split(" (")[0].strip()
        if climb.category in (ClimbCategory.HC.value, ClimbCategory.CAT_1.value) or climb.elevation_gain_m >= 800.0:
            return f"{base_landmark} Ascent"
        elif climb.elevation_gain_m <= 250.0:
            return f"{base_landmark} Approach"
        return f"{base_landmark} Climb"

    if climb.trail_name:
        trail = climb.trail_name.strip()
        trail_lower = trail.lower()
        trail_suffixes = ("road", "trail", "track", "piste", "path", "way", "drive", "highway", "pass", "ridge", "crest", "gap", "col")
        if any(trail_lower.endswith(s) for s in trail_suffixes):
            return f"{trail} Climb"
        return f"{trail} Ascent"

    if climb.park_name:
        return f"{climb.park_name} Crest Ascent"

    return climb.name


def generate_tactical_climb_notes(climb: Climb) -> str:
    """
    Generate tactical narrative advice summarizing physical grade profile,
    surface firmness, and geographic context.
    """
    if climb.category == ClimbCategory.HC.value or climb.elevation_gain_m >= 1000.0 or climb.max_grade >= 18.0:
        adj = "Monster" if climb.elevation_gain_m >= 1200.0 else ("Brutal" if climb.max_grade >= 18.0 else "Epic")
    elif climb.category == ClimbCategory.CAT_1.value or climb.elevation_gain_m >= 700.0:
        adj = "Grueling"
    elif climb.category == ClimbCategory.CAT_2.value:
        adj = "Sustained"
    elif climb.category == ClimbCategory.CAT_3.value:
        adj = "Challenging" if climb.avg_grade >= 6.0 else "Steady"
    else:
        adj = "Punchy" if climb.max_grade >= 12.0 else "Rolling"

    s1 = f"{adj} {climb.category} ascent gaining {int(round(climb.elevation_gain_m))}m over {round(climb.length_km, 1)}km at an average {climb.avg_grade}% grade (max {climb.max_grade}%)."

    surf_label = climb.surface or "unpaved gravel"
    road_label = climb.road_class or "mountain track"
    s2 = f"Traverses {surf_label} on {road_label}."

    if climb.landmark and climb.park_name:
        s3 = f"Ascends toward {climb.landmark} within {climb.park_name}."
    elif climb.landmark:
        s3 = f"Ascends toward {climb.landmark}."
    elif climb.park_name:
        s3 = f"Traverses through {climb.park_name}."
    elif climb.trail_name:
        s3 = f"Follows {climb.trail_name}."
    else:
        s3 = ""

    parts = [s1, s2]
    if s3:
        parts.append(s3)
    return " ".join(parts)


def enrich_climbs_geographic_identity(
    climbs: List[Climb],
    track_or_points: Any,
    road_network: Any = None,
    corridor_data: Any = None,
    default_state: str = "",
) -> List[Climb]:
    """
    Automated Tier 1 OpenStreetMap geographic identity harvesting:
    1. Extracts dominant trail/road name from underlying OSM road network ways.
    2. Identifies prominent mountain peak landmarks within 3.5km of climb summits.
    3. Detects park, nature reserve, or protected public land boundary containment.
    4. Generates evocative authentic climb names (e.g. 'Mount Smolikas Ascent').
    5. Flags iconic climbs (HC/Cat 1, elevation gain >= 800m).
    6. Produces tactical narrative notes summarizing grade, surface, and context.
    """
    if not climbs:
        return []

    peaks = extract_osm_peaks(corridor_data)
    boundaries = extract_osm_boundaries(corridor_data)

    for c in climbs:
        if default_state and not c.state:
            c.state = default_state

        # 1. Trail name from road network
        if not c.trail_name and road_network is not None:
            c.trail_name = extract_dominant_trail_name(c, track_or_points, road_network)

        # 2. Landmark peak within 3.5 km
        if not c.landmark and peaks:
            c.landmark = find_nearby_landmark(c, peaks, max_dist_m=3500.0)

        # 3. Park / protected area boundary containment
        if not c.park_name and boundaries:
            if c.summit_coords:
                for b in boundaries:
                    if is_point_in_boundary(c.summit_coords[0], c.summit_coords[1], b):
                        c.park_name = b["name"]
                        break
            if not c.park_name and c.start_coords:
                for b in boundaries:
                    if is_point_in_boundary(c.start_coords[0], c.start_coords[1], b):
                        c.park_name = b["name"]
                        break

        # 4. Iconic climb classification
        if c.category in (ClimbCategory.HC.value, ClimbCategory.CAT_1.value) or c.elevation_gain_m >= 800.0:
            c.is_iconic = True

        # 5. Evocative climb naming
        c.name = generate_evocative_climb_name(c)

        # 6. Tactical narrative advice notes
        if not c.notes or c.notes.startswith("Sustained climb gaining "):
            c.notes = generate_tactical_climb_notes(c)

    return climbs


# -----------------------------------------------------------------------------
# Curated Climb Helpers & Overrides
# -----------------------------------------------------------------------------

def load_curated_climbs(climbs_file: Union[str, Path]) -> List[Climb]:
    """Load Climb domain objects from an existing curated JSON file."""
    path = Path(climbs_file)
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get("climbs", [])
    return [Climb.from_dict(item) for item in items if isinstance(item, dict)]


def is_curated_climb_list(climbs: Sequence[Climb]) -> bool:
    """Check whether a list of climbs contains authentic human curation overrides."""
    if not climbs:
        return False
    for c in climbs:
        if not c.name.startswith("Climb "):
            return True
        if c.trail_name or c.park_name or c.landmark:
            return True
        if c.notes and not c.notes.startswith("Sustained climb gaining "):
            return True
        if c.is_iconic:
            return True
    return False


def apply_curated_climbs(climbs: List[Climb], curated_climbs: List[Climb]) -> List[Climb]:
    """
    Apply curated climb overrides to detected climbs by matching ID or route distance.
    Preserves hand-curated names, trail names, park names, landmarks, notes, and iconic flags.
    """
    if not curated_climbs or not climbs:
        return climbs

    for c in climbs:
        best_match = None
        min_dist_km = 3.5
        for cur in curated_climbs:
            dist_km = min(abs(c.end_km - cur.end_km), abs(c.start_km - cur.start_km))
            if c.id == cur.id and dist_km <= 5.0:
                best_match = cur
                min_dist_km = dist_km
                break
            if dist_km < min_dist_km:
                min_dist_km = dist_km
                best_match = cur

        if best_match:
            if best_match.name and not best_match.name.startswith("Climb "):
                c.name = best_match.name
            if best_match.trail_name:
                c.trail_name = best_match.trail_name
            if best_match.park_name:
                c.park_name = best_match.park_name
            if best_match.landmark:
                c.landmark = best_match.landmark
            if best_match.notes:
                c.notes = best_match.notes
            if best_match.is_iconic:
                c.is_iconic = True
            if best_match.pass_id:
                c.pass_id = best_match.pass_id
            if best_match.road_class:
                c.road_class = best_match.road_class
            if best_match.surface:
                c.surface = best_match.surface
            if best_match.firmness:
                c.firmness = best_match.firmness
            if best_match.tracktype:
                c.tracktype = best_match.tracktype
            if best_match.difficulty:
                c.difficulty = best_match.difficulty

    return climbs


# -----------------------------------------------------------------------------
# Climb Detection State Machine
# -----------------------------------------------------------------------------

def detect_climbs(
    track_or_points: Any,
    road_network: Any = None,
    min_len_km: float = 0.5,
    min_gain_m: float = 50.0,
    min_grade: float = 3.0,
    descent_tolerance_m: float = 30.0,
    default_state: str = "",
    corridor_data: Any = None,
    curated_climbs: Optional[List[Climb]] = None,
) -> List[Climb]:
    """
    Detect continuous mountain or hill climbs along route telemetry.
    Thresholds:
      - min_len_km: minimum climb distance (default >= 0.5 km / 500m)
      - min_gain_m: minimum elevation gain (default >= 50.0m)
      - min_grade: minimum average slope (default >= 3.0%)
    """
    pts = track_or_points.points if hasattr(track_or_points, "points") else track_or_points
    if not pts or len(pts) < 2:
        return []

    # Apply 3-point moving average smoothing to elevations to suppress single-point GPS glitches
    smoothed_eles: List[float] = []
    n = len(pts)
    for i in range(n):
        if i == 0:
            smoothed_eles.append(float(pts[0][2]))
        elif i == n - 1:
            smoothed_eles.append(float(pts[-1][2]))
        else:
            smoothed_eles.append((float(pts[i - 1][2]) + float(pts[i][2]) + float(pts[i + 1][2])) / 3.0)

    climbs: List[Climb] = []
    climb_counter = 1

    in_climb = False
    start_idx = 0
    max_ele_seen = smoothed_eles[0]
    max_ele_idx = 0

    for i in range(1, n):
        ele = smoothed_eles[i]

        if not in_climb:
            if ele > smoothed_eles[i - 1]:
                # Onset of potential ascent
                in_climb = True
                start_idx = i - 1
                max_ele_seen = ele
                max_ele_idx = i
        else:
            if ele > max_ele_seen:
                max_ele_seen = ele
                max_ele_idx = i
            else:
                gain_so_far = max_ele_seen - smoothed_eles[start_idx]
                tol = max(20.0, min(45.0, 0.20 * gain_so_far))
                drop_from_peak = max_ele_seen - ele
                dist_from_peak_km = float(pts[i][3]) - float(pts[max_ele_idx][3])

                # Climb termination conditions
                if drop_from_peak > tol or dist_from_peak_km > 1.5:
                    # Evaluate candidate climb bounded by [start_idx, max_ele_idx]
                    length_km = float(pts[max_ele_idx][3]) - float(pts[start_idx][3])
                    gain_m = max_ele_seen - smoothed_eles[start_idx]

                    if length_km >= min_len_km and gain_m >= min_gain_m:
                        avg_grade = (gain_m / (length_km * 1000.0)) * 100.0
                        if avg_grade >= min_grade:
                            # Valid climb detected!
                            fiets = calculate_fiets_index(gain_m, length_km * 1000.0, max_ele_seen)
                            cat = classify_climb_category(fiets, gain_m, length_km * 1000.0, avg_grade)
                            max_g = compute_rolling_max_grade(pts, start_idx, max_ele_idx)
                            max_g = max(max_g, round(avg_grade, 1))

                            start_pt = pts[start_idx]
                            summit_pt = pts[max_ele_idx]
                            c_id = f"climb-{climb_counter}"
                            c_name = f"Climb {climb_counter} (Mile {round(km_to_miles(start_pt[3]), 1)})"

                            climb_obj = Climb(
                                id=c_id,
                                name=c_name,
                                start_km=start_pt[3],
                                end_km=summit_pt[3],
                                length_km=length_km,
                                elevation_gain_m=gain_m,
                                avg_grade=round(avg_grade, 1),
                                max_grade=max_g,
                                category=cat,
                                fiets_score=fiets,
                                start_ele_m=smoothed_eles[start_idx],
                                summit_ele_m=max_ele_seen,
                                difficulty=ClimbCategory(cat).difficulty if cat in ClimbCategory._value2member_map_ else "moderate",
                                state=default_state,
                                start_coords=(float(start_pt[0]), float(start_pt[1])),
                                summit_coords=(float(summit_pt[0]), float(summit_pt[1])),
                            )
                            climbs.append(climb_obj)
                            climb_counter += 1

                    # Reset to look for next climb
                    in_climb = False
                    start_idx = i

    # Terminal point check
    if in_climb and max_ele_idx > start_idx:
        length_km = float(pts[max_ele_idx][3]) - float(pts[start_idx][3])
        gain_m = max_ele_seen - smoothed_eles[start_idx]
        if length_km >= min_len_km and gain_m >= min_gain_m:
            avg_grade = (gain_m / (length_km * 1000.0)) * 100.0
            if avg_grade >= min_grade:
                fiets = calculate_fiets_index(gain_m, length_km * 1000.0, max_ele_seen)
                cat = classify_climb_category(fiets, gain_m, length_km * 1000.0, avg_grade)
                max_g = compute_rolling_max_grade(pts, start_idx, max_ele_idx)
                max_g = max(max_g, round(avg_grade, 1))

                start_pt = pts[start_idx]
                summit_pt = pts[max_ele_idx]
                c_id = f"climb-{climb_counter}"
                c_name = f"Climb {climb_counter} (Mile {round(km_to_miles(start_pt[3]), 1)})"

                climb_obj = Climb(
                    id=c_id,
                    name=c_name,
                    start_km=start_pt[3],
                    end_km=summit_pt[3],
                    length_km=length_km,
                    elevation_gain_m=gain_m,
                    avg_grade=round(avg_grade, 1),
                    max_grade=max_g,
                    category=cat,
                    fiets_score=fiets,
                    start_ele_m=smoothed_eles[start_idx],
                    summit_ele_m=max_ele_seen,
                    difficulty=ClimbCategory(cat).difficulty if cat in ClimbCategory._value2member_map_ else "moderate",
                    state=default_state,
                    start_coords=(float(start_pt[0]), float(start_pt[1])),
                    summit_coords=(float(summit_pt[0]), float(summit_pt[1])),
                )
                climbs.append(climb_obj)

    # Annotate surface info
    annotate_climb_surfaces(climbs, road_network)

    # Enrich with OSM geographic identity (trailName, parkName, landmark, authentic name, notes, iconic)
    enrich_climbs_geographic_identity(
        climbs,
        track_or_points,
        road_network=road_network,
        corridor_data=corridor_data,
        default_state=default_state,
    )

    # Apply curated climb overrides if provided
    if curated_climbs:
        apply_curated_climbs(climbs, curated_climbs)

    return climbs
