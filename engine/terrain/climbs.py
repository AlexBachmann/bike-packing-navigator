"""
engine.terrain.climbs - Climb detection, UCI Cat 1-4/HC difficulty categorization,
Fiets Index calculation, rolling-window maximum grade, and surface enrichment.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.utils.text import slugify
from engine.utils.units import km_to_miles, meters_to_feet


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
                        matched_hw = match.way.highway_class
                        matched_surf = match.way.surface
                        matched_tt = match.way.tracktype
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
# Climb Detection State Machine
# -----------------------------------------------------------------------------

def detect_climbs(
    track_or_points: Any,
    road_network: Any = None,
    min_len_km: float = 0.5,
    min_gain_m: float = 50.0,
    min_grade: float = 3.0,
    descent_tolerance_m: float = 30.0,
    default_state: str = ""
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
    return climbs
