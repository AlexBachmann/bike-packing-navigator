"""
engine.osm.turns - OpenStreetMap turn guidance cue extraction, deflection angle detection, and junction analysis.

Features:
1. 8 angular turn intervals matching frontend OsmTurnDefinition:
   straight ([-15°, +15°]), slight_right ((15°, 45°]), right ((45°, 120°]),
   sharp_right ((120°, 165°]), u_turn (> 165° or < -165°), and left equivalents.
2. Direction modifier property translating to kebab-case ('slight-right', 'right', etc.).
3. Multi-trigger cue detection:
   - Geometric turns at branching junctions (branch_count >= 3).
   - Street / trail name transitions ("Continue onto...").
   - Surface and highway class transitions ("Pavement ends, onto unpaved track").
4. Topological false-positive filter: suppresses continuous mountain switchbacks where
   no junction exists (branch_count <= 2, same way ID).
5. 50m spacing and deduplication filter.
6. Clean export matching frontend OsmTurnDefinition format.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple, Union

from engine.core.models import RoutePoint, RouteTrack
from engine.osm.network import OsmRoadNetwork
from engine.utils.geo import (
    deflection_angle,
    dist_point_to_segment_m,
    haversine_distance_m,
    initial_bearing,
)
from engine.utils.io import atomic_write_json
from engine.utils.units import km_to_miles


class TurnType(str, Enum):
    """Standard navigation turn classifications based on signed deflection angle."""
    STRAIGHT = "straight"
    SLIGHT_RIGHT = "slight_right"
    RIGHT = "right"
    SHARP_RIGHT = "sharp_right"
    U_TURN = "u_turn"
    SHARP_LEFT = "sharp_left"
    LEFT = "left"
    SLIGHT_LEFT = "slight_left"

    @property
    def direction_modifier(self) -> str:
        """Translate to frontend kebab-case (e.g. 'slight-right', 'sharp-left')."""
        return self.value.replace("_", "-")


class CueTrigger(str, Enum):
    """Reason for triggering a navigation cue."""
    GEOMETRIC_TURN = "geometric_turn"
    NAME_TRANSITION = "name_transition"
    SURFACE_TRANSITION = "surface_transition"
    HIGHWAY_TRANSITION = "highway_transition"
    DEPARTURE = "departure"
    ARRIVAL = "arrival"


class JunctionType(str, Enum):
    """Topological type of road/trail junction."""
    CONTINUOUS = "continuous"        # Degree <= 2
    FORK = "fork"                    # Degree 3, trail split
    T_JUNCTION = "t_junction"        # Degree 3, perpendicular T
    CROSSROAD = "crossroad"          # Degree >= 4
    INTERSECTION = "intersection"    # Transition between different named ways
    ROUNDABOUT = "roundabout"


@dataclass
class TurnCue:
    """
    Represents a navigation turn cue or decision point along a route.
    Serializes to match frontend OsmTurnDefinition exactly.
    """
    km: float
    instruction: str
    turn_type: TurnType
    street_name: str
    coordinates: Tuple[float, float]  # (lat, lon)
    mile: float = 0.0
    deflection_deg: float = 0.0
    junction_type: str = "intersection"
    branch_count: int = 3
    trigger: CueTrigger = CueTrigger.GEOMETRIC_TURN
    surface: Optional[str] = None
    highway_class: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.km = float(self.km)
        if self.mile == 0.0 and self.km > 0.0:
            self.mile = round(km_to_miles(self.km), 3)
        self.deflection_deg = float(self.deflection_deg)
        if isinstance(self.turn_type, str) and not isinstance(self.turn_type, TurnType):
            self.turn_type = TurnType(self.turn_type.replace("-", "_"))
        if isinstance(self.trigger, str) and not isinstance(self.trigger, CueTrigger):
            self.trigger = CueTrigger(self.trigger)

    @property
    def direction_modifier(self) -> str:
        """Kebab-case turn direction for frontend compatibility (e.g. 'slight-right')."""
        return self.turn_type.direction_modifier

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to standard dictionary."""
        return {
            "km": round(self.km, 3),
            "mile": round(self.mile, 3),
            "instruction": self.instruction,
            "turn_type": self.turn_type.value,
            "direction": self.direction_modifier,
            "street_name": self.street_name,
            "coordinates": [round(self.coordinates[0], 6), round(self.coordinates[1], 6)],
            "deflection_deg": round(self.deflection_deg, 1),
            "junction_type": self.junction_type,
            "branch_count": self.branch_count,
            "trigger": self.trigger.value,
            "surface": self.surface,
            "highway_class": self.highway_class,
        }

    def to_osm_turn_json(self) -> Dict[str, Any]:
        """
        Serialize to frontend OsmTurnDefinition schema expected in turns.json.
        """
        return {
            "mile": round(self.mile, 3),
            "km": round(self.km, 3),
            "coordinates": [round(self.coordinates[0], 6), round(self.coordinates[1], 6)],
            "direction": self.direction_modifier,
            "deflectionDeg": round(self.deflection_deg, 1),
            "roadName": self.street_name,
            "junctionType": self.junction_type,
            "branchCount": self.branch_count,
            "instruction": self.instruction,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TurnCue":
        """Deserialize from dictionary."""
        raw_coords = data.get("coordinates", [0.0, 0.0])
        coords = (float(raw_coords[0]), float(raw_coords[1]))
        turn_type_raw = data.get("turn_type") or data.get("direction", "straight")
        turn_type_str = str(turn_type_raw).replace("-", "_")
        return cls(
            km=float(data.get("km", 0.0)),
            instruction=str(data.get("instruction", "")),
            turn_type=TurnType(turn_type_str),
            street_name=str(data.get("street_name") or data.get("roadName") or ""),
            coordinates=coords,
            mile=float(data.get("mile", 0.0)),
            deflection_deg=float(data.get("deflection_deg") or data.get("deflectionDeg", 0.0)),
            junction_type=str(data.get("junction_type") or data.get("junctionType", "intersection")),
            branch_count=int(data.get("branch_count") or data.get("branchCount", 3)),
            trigger=CueTrigger(data.get("trigger", CueTrigger.GEOMETRIC_TURN.value)),
            surface=data.get("surface"),
            highway_class=data.get("highway_class"),
        )


@dataclass
class OsmSegment:
    """Represents a directional 2-point segment of an OSM road or trail."""
    lat_a: float
    lon_a: float
    lat_b: float
    lon_b: float
    name: str = ""
    highway: str = "track"
    surface: Optional[str] = None
    way_id: Optional[int] = None
    oneway: bool = False

    @property
    def bearing(self) -> float:
        return initial_bearing(self.lat_a, self.lon_a, self.lat_b, self.lon_b)


@dataclass
class JunctionAnalysis:
    """Topological junction evaluation at a geographic point."""
    is_decision_point: bool
    branch_count: int
    junction_type: str
    is_switchback: bool
    road_name: str
    surface: Optional[str] = None
    highway_class: Optional[str] = None
    radiating_bearings: List[float] = field(default_factory=list)


class OsmNetworkIndex:
    """
    In-memory spatial index of OSM road/trail segments providing fast junction analysis.
    Can be loaded directly from segments, an OsmRoadNetwork instance, or PMTiles.
    """

    def __init__(self, grid_size_deg: float = 0.01):
        self.grid_size = grid_size_deg
        self.segments: List[OsmSegment] = []
        self.grid: Dict[Tuple[int, int], List[int]] = defaultdict(list)

    def add_segment(self, segment: OsmSegment) -> None:
        idx = len(self.segments)
        self.segments.append(segment)

        gx1 = int(math.floor(segment.lon_a / self.grid_size))
        gy1 = int(math.floor(segment.lat_a / self.grid_size))
        gx2 = int(math.floor(segment.lon_b / self.grid_size))
        gy2 = int(math.floor(segment.lat_b / self.grid_size))

        for gx in range(min(gx1, gx2), max(gx1, gx2) + 1):
            for gy in range(min(gy1, gy2), max(gy1, gy2) + 1):
                self.grid[(gx, gy)].append(idx)

    def find_nearby_segments(self, lat: float, lon: float, radius_m: float = 35.0) -> List[Tuple[OsmSegment, float]]:
        """Find all segments within radius_m of (lat, lon)."""
        gx = int(math.floor(lon / self.grid_size))
        gy = int(math.floor(lat / self.grid_size))

        cand_indices: Set[int] = set()
        for dgx in (-1, 0, 1):
            for dgy in (-1, 0, 1):
                cand_indices.update(self.grid.get((gx + dgx, gy + dgy), []))

        results: List[Tuple[OsmSegment, float]] = []
        for idx in cand_indices:
            seg = self.segments[idx]
            dist_m, _, _, _ = dist_point_to_segment_m(lat, lon, seg.lat_a, seg.lon_a, seg.lat_b, seg.lon_b)
            if dist_m <= radius_m:
                results.append((seg, dist_m))
        return results

    def analyze_junction(self, lat: float, lon: float, radius_m: float = 35.0) -> JunctionAnalysis:
        """
        Evaluate road topology within radius_m to detect authentic decision points
        and filter out continuous mountain switchbacks.
        """
        nearby = self.find_nearby_segments(lat, lon, radius_m)
        if not nearby:
            return JunctionAnalysis(
                is_decision_point=False,
                branch_count=0,
                junction_type="continuous",
                is_switchback=False,
                road_name="",
            )

        way_ids: Set[int] = set()
        names: Set[str] = set()
        classes: Set[str] = set()
        surfaces: Set[str] = set()
        bearings: List[float] = []

        for seg, _ in nearby:
            if seg.way_id is not None:
                way_ids.add(seg.way_id)
            if seg.name:
                names.add(seg.name)
            if seg.highway:
                classes.add(seg.highway)
            if seg.surface:
                surfaces.add(seg.surface)

            # Determine radiating bearing away from (lat, lon)
            d_a = haversine_distance_m(lat, lon, seg.lat_a, seg.lon_a)
            d_b = haversine_distance_m(lat, lon, seg.lat_b, seg.lon_b)

            if d_a <= 30.0 and d_b > 30.0:
                # Connected near A, radiating towards B
                bearings.append(initial_bearing(seg.lat_a, seg.lon_a, seg.lat_b, seg.lon_b))
            elif d_b <= 30.0 and d_a > 30.0:
                # Connected near B, radiating towards A
                bearings.append(initial_bearing(seg.lat_b, seg.lon_b, seg.lat_a, seg.lon_a))
            else:
                # (lat, lon) is along the segment
                b_fwd = seg.bearing
                bearings.append(b_fwd)
                bearings.append((b_fwd + 180.0) % 360.0)

        # Cluster radiating bearings into distinct angular branches (> 30° separation)
        distinct_branches: List[float] = []
        for b in bearings:
            if not any(abs(deflection_angle(eb, b)) < 30.0 for eb in distinct_branches):
                distinct_branches.append(b)

        branch_count = len(distinct_branches)
        road_name = sorted(names)[0] if names else ""
        surface = sorted(surfaces)[0] if surfaces else None
        highway = sorted(classes)[0] if classes else None

        # Switchback suppression filter:
        # If all segments belong to <= 1 way ID, branch_count <= 2, and names are identical,
        # it is a continuous curve with no junction -> suppress!
        if len(way_ids) <= 1 and branch_count <= 2 and len(names) <= 1:
            return JunctionAnalysis(
                is_decision_point=False,
                branch_count=branch_count,
                junction_type="continuous",
                is_switchback=True,
                road_name=road_name,
                surface=surface,
                highway_class=highway,
                radiating_bearings=distinct_branches,
            )

        # Genuine intersections
        if branch_count >= 4:
            j_type = "crossroad"
        elif branch_count == 3:
            j_type = "fork" if ("track" in classes or "path" in classes) else "t_junction"
        elif len(names) >= 2 or len(classes) >= 2:
            j_type = "intersection"
        else:
            j_type = "continuous"

        is_decision = branch_count >= 3 or len(names) >= 2 or len(classes) >= 2

        return JunctionAnalysis(
            is_decision_point=is_decision,
            branch_count=branch_count,
            junction_type=j_type,
            is_switchback=False,
            road_name=road_name,
            surface=surface,
            highway_class=highway,
            radiating_bearings=distinct_branches,
        )

    @classmethod
    def from_road_network(cls, network: OsmRoadNetwork) -> "OsmNetworkIndex":
        """Build OsmNetworkIndex from OsmRoadNetwork."""
        idx = cls(grid_size_deg=network.grid_size)
        for way_i, way in enumerate(network.ways):
            coords = way.coords
            w_name = way.name
            w_hw = way.highway
            w_surf = way.surface
            for s_i in range(len(coords) - 1):
                seg = OsmSegment(
                    lat_a=coords[s_i][0],
                    lon_a=coords[s_i][1],
                    lat_b=coords[s_i + 1][0],
                    lon_b=coords[s_i + 1][1],
                    name=w_name,
                    highway=w_hw,
                    surface=w_surf,
                    way_id=way.id if way.id is not None else way_i
                )
                idx.add_segment(seg)
        return idx


def classify_turn_type(deflection_deg: float) -> TurnType:
    """
    Classify signed deflection angle into exact 8-interval TurnType enum.

    Intervals:
    - straight: [-15.0°, +15.0°]
    - slight_right: (+15.0°, +45.0°]
    - right: (+45.0°, +120.0°]
    - sharp_right: (+120.0°, +165.0°]
    - u_turn: > +165.0° or < -165.0°
    - sharp_left: [-165.0°, -120.0°)
    - left: [-120.0°, -45.0°)
    - slight_left: [-45.0°, -15.0°)
    """
    # Normalize angle to [-180.0, +180.0]
    angle = ((deflection_deg + 180.0) % 360.0) - 180.0
    abs_angle = abs(angle)

    if abs_angle > 165.0:
        return TurnType.U_TURN
    elif abs_angle <= 15.0:
        return TurnType.STRAIGHT

    if angle > 0:
        if angle <= 45.0:
            return TurnType.SLIGHT_RIGHT
        elif angle <= 120.0:
            return TurnType.RIGHT
        else:
            return TurnType.SHARP_RIGHT
    else:
        if angle >= -45.0:
            return TurnType.SLIGHT_LEFT
        elif angle >= -120.0:
            return TurnType.LEFT
        else:
            return TurnType.SHARP_LEFT


def generate_instruction(
    turn_type: TurnType,
    street_name: str = "",
    junction_type: str = "intersection",
    trigger: CueTrigger = CueTrigger.GEOMETRIC_TURN,
    prev_surface: Optional[str] = None,
    new_surface: Optional[str] = None,
) -> str:
    """
    Generate natural human-readable navigation guidance instructions.
    """
    # Trigger: Surface transition
    if trigger == CueTrigger.SURFACE_TRANSITION:
        paved = {"asphalt", "paved", "concrete"}
        if prev_surface in paved and (new_surface not in paved or new_surface is None):
            if street_name:
                return f"Pavement ends, onto {street_name}"
            return "Pavement ends, onto unpaved track"
        elif prev_surface not in paved and new_surface in paved:
            if street_name:
                return f"Onto paved road ({street_name})"
            return "Onto paved road"
        elif new_surface:
            return f"Onto {new_surface} surface"

    # Trigger: Name transition on straight path
    if trigger == CueTrigger.NAME_TRANSITION:
        if street_name:
            return f"Continue onto {street_name}"
        return "Continue straight"

    # Trigger: Departure / Arrival
    if trigger == CueTrigger.DEPARTURE:
        return f"Depart on {street_name}" if street_name else "Depart"
    if trigger == CueTrigger.ARRIVAL:
        return "Arrive at destination"

    # Trigger: Geometric turn
    action = "Turn"
    if junction_type == "fork":
        action = "Fork"

    dir_str = turn_type.direction_modifier.replace("-", " ")

    if turn_type == TurnType.STRAIGHT:
        if street_name:
            return f"Continue onto {street_name}"
        return "Continue straight"
    elif turn_type == TurnType.U_TURN:
        return "Make U-turn"

    if street_name:
        return f"{action} {dir_str} onto {street_name}"
    return f"{action} {dir_str}"


def extract_turn_cues(
    track: Union[RouteTrack, Sequence[Any], Dict[str, Any]],
    network: Optional[Union[OsmNetworkIndex, OsmRoadNetwork]] = None,
    min_deflection_deg: float = 15.0,
    min_spacing_m: float = 50.0,
) -> List[TurnCue]:
    """
    Extract navigation turn cues and authentic decision points along a route.
    Filters out switchback curves on continuous roads.
    """
    # Extract coordinate tuples [lat, lon, ele, km, mi]
    pts: List[Tuple[float, float, float, float, float]] = []
    if isinstance(track, RouteTrack):
        for p in track.points:
            pts.append((p.lat, p.lon, p.ele, p.cum_km, p.cum_mi))
    elif isinstance(track, dict):
        cum_km = 0.0
        for p in track.get("points", []):
            lat = float(p[0])
            lon = float(p[1])
            ele = float(p[2]) if len(p) > 2 else 0.0
            km = float(p[3]) if len(p) > 3 else cum_km
            mi = float(p[4]) if len(p) > 4 else km_to_miles(km)
            pts.append((lat, lon, ele, km, mi))
    elif isinstance(track, (list, tuple)):
        for p in track:
            if isinstance(p, RoutePoint):
                pts.append((p.lat, p.lon, p.ele, p.cum_km, p.cum_mi))
            elif isinstance(p, (list, tuple)) and len(p) >= 2:
                lat = float(p[0])
                lon = float(p[1])
                ele = float(p[2]) if len(p) > 2 else 0.0
                km = float(p[3]) if len(p) > 3 else 0.0
                mi = float(p[4]) if len(p) > 4 else km_to_miles(km)
                pts.append((lat, lon, ele, km, mi))

    if len(pts) < 3:
        return []

    # Filter out consecutive duplicate coordinates
    filtered_pts: List[Tuple[float, float, float, float, float]] = [pts[0]]
    for i in range(1, len(pts)):
        d = haversine_distance_m(filtered_pts[-1][0], filtered_pts[-1][1], pts[i][0], pts[i][1])
        if d >= 0.5:
            filtered_pts.append(pts[i])

    if len(filtered_pts) < 3:
        return []

    # Network index
    net_idx: Optional[OsmNetworkIndex] = None
    if isinstance(network, OsmRoadNetwork):
        net_idx = OsmNetworkIndex.from_road_network(network)
    elif isinstance(network, OsmNetworkIndex):
        net_idx = network

    candidate_cues: List[TurnCue] = []
    prev_road_name: Optional[str] = None
    prev_surface: Optional[str] = None

    # Initialize previous road attributes from point 0
    if net_idx is not None and len(filtered_pts) > 0:
        p0_analysis = net_idx.analyze_junction(filtered_pts[0][0], filtered_pts[0][1], radius_m=35.0)
        if p0_analysis.road_name:
            prev_road_name = p0_analysis.road_name
        if p0_analysis.surface:
            prev_surface = p0_analysis.surface

    for i in range(1, len(filtered_pts) - 1):
        prev_p = filtered_pts[i - 1]
        curr_p = filtered_pts[i]
        next_p = filtered_pts[i + 1]

        b_in = initial_bearing(prev_p[0], prev_p[1], curr_p[0], curr_p[1])
        b_out = initial_bearing(curr_p[0], curr_p[1], next_p[0], next_p[1])
        defl = deflection_angle(b_in, b_out)

        # Topological junction evaluation
        analysis: Optional[JunctionAnalysis] = None
        in_name, out_name = None, None
        in_surf, out_surf = None, None

        if net_idx is not None:
            analysis = net_idx.analyze_junction(curr_p[0], curr_p[1], radius_m=35.0)

            # Switchback suppression filter:
            # If solitary switchback with no junction -> suppress immediately!
            if analysis.is_switchback and not analysis.is_decision_point:
                if analysis.road_name:
                    prev_road_name = analysis.road_name
                if analysis.surface:
                    prev_surface = analysis.surface
                continue

            # Identify incoming and outgoing segment attributes based on vector direction
            nearby_segs = net_idx.find_nearby_segments(curr_p[0], curr_p[1], radius_m=35.0)
            best_in_diff, best_out_diff = float("inf"), float("inf")
            for seg, _ in nearby_segs:
                d_a = haversine_distance_m(curr_p[0], curr_p[1], seg.lat_a, seg.lon_a)
                d_b = haversine_distance_m(curr_p[0], curr_p[1], seg.lat_b, seg.lon_b)

                # Bearing approaching curr_p
                if d_b <= 30.0 and d_a > 10.0:
                    b_approach = initial_bearing(seg.lat_a, seg.lon_a, seg.lat_b, seg.lon_b)
                elif d_a <= 30.0 and d_b > 10.0:
                    b_approach = initial_bearing(seg.lat_b, seg.lon_b, seg.lat_a, seg.lon_a)
                else:
                    b_approach = seg.bearing

                diff_in = abs(deflection_angle(b_in, b_approach))
                if diff_in < best_in_diff:
                    best_in_diff = diff_in
                    in_name = seg.name
                    in_surf = seg.surface

                # Bearing departing from curr_p
                if d_a <= 30.0 and d_b > 10.0:
                    b_depart = initial_bearing(seg.lat_a, seg.lon_a, seg.lat_b, seg.lon_b)
                elif d_b <= 30.0 and d_a > 10.0:
                    b_depart = initial_bearing(seg.lat_b, seg.lon_b, seg.lat_a, seg.lon_a)
                else:
                    b_depart = seg.bearing

                diff_out = abs(deflection_angle(b_out, b_depart))
                if diff_out < best_out_diff:
                    best_out_diff = diff_out
                    out_name = seg.name
                    out_surf = seg.surface

        turn_t = classify_turn_type(defl)
        r_name = out_name or (analysis.road_name if analysis and analysis.road_name else "")
        effective_prev_name = in_name or prev_road_name
        effective_prev_surf = in_surf or prev_surface
        curr_surf = out_surf or (analysis.surface if analysis else None)
        j_type = analysis.junction_type if analysis else "intersection"
        b_count = analysis.branch_count if analysis else 3

        cue: Optional[TurnCue] = None

        # Trigger 1: Geometric turns at junctions or when deflection exceeds threshold
        if abs(defl) >= min_deflection_deg:
            if analysis is None or analysis.is_decision_point:
                instr = generate_instruction(
                    turn_type=turn_t,
                    street_name=r_name,
                    junction_type=j_type,
                    trigger=CueTrigger.GEOMETRIC_TURN
                )
                cue = TurnCue(
                    km=curr_p[3],
                    instruction=instr,
                    turn_type=turn_t,
                    street_name=r_name,
                    coordinates=(curr_p[0], curr_p[1]),
                    mile=curr_p[4],
                    deflection_deg=defl,
                    junction_type=j_type,
                    branch_count=b_count,
                    trigger=CueTrigger.GEOMETRIC_TURN,
                    surface=curr_surf
                )

        # Trigger 2: Road / trail name transition on straight trajectories
        elif r_name and effective_prev_name and r_name != effective_prev_name:
            instr = generate_instruction(
                turn_type=TurnType.STRAIGHT,
                street_name=r_name,
                trigger=CueTrigger.NAME_TRANSITION
            )
            cue = TurnCue(
                km=curr_p[3],
                instruction=instr,
                turn_type=TurnType.STRAIGHT,
                street_name=r_name,
                coordinates=(curr_p[0], curr_p[1]),
                mile=curr_p[4],
                deflection_deg=defl,
                junction_type="intersection",
                branch_count=b_count,
                trigger=CueTrigger.NAME_TRANSITION,
                surface=curr_surf
            )

        # Trigger 3: Surface transition (e.g. pavement ends)
        elif effective_prev_surf and curr_surf and effective_prev_surf != curr_surf:
            paved = {"asphalt", "paved", "concrete"}
            if (effective_prev_surf in paved and curr_surf not in paved) or (effective_prev_surf not in paved and curr_surf in paved):
                instr = generate_instruction(
                    turn_type=TurnType.STRAIGHT,
                    street_name=r_name,
                    trigger=CueTrigger.SURFACE_TRANSITION,
                    prev_surface=effective_prev_surf,
                    new_surface=curr_surf
                )
                cue = TurnCue(
                    km=curr_p[3],
                    instruction=instr,
                    turn_type=TurnType.STRAIGHT,
                    street_name=r_name,
                    coordinates=(curr_p[0], curr_p[1]),
                    mile=curr_p[4],
                    deflection_deg=defl,
                    junction_type="intersection",
                    branch_count=b_count,
                    trigger=CueTrigger.SURFACE_TRANSITION,
                    surface=curr_surf
                )

        if cue is not None:
            candidate_cues.append(cue)

        if r_name:
            prev_road_name = r_name
        if curr_surf:
            prev_surface = curr_surf

    # Deduplication pass: merge / suppress cues within min_spacing_m
    final_cues: List[TurnCue] = []
    for c in candidate_cues:
        if not final_cues:
            final_cues.append(c)
            continue

        prev_c = final_cues[-1]
        dist_between = haversine_distance_m(
            prev_c.coordinates[0], prev_c.coordinates[1],
            c.coordinates[0], c.coordinates[1]
        )

        if dist_between < min_spacing_m:
            # If current cue has a street name and previous didn't, replace with current
            if c.street_name and not prev_c.street_name:
                final_cues[-1] = c
            # Or if current has larger deflection in same direction, keep larger
            elif abs(c.deflection_deg) > abs(prev_c.deflection_deg):
                final_cues[-1] = c
            continue

        final_cues.append(c)

    return final_cues


def extract_turns_from_pmtiles(
    track: Union[RouteTrack, Sequence[Any], Dict[str, Any]],
    pmtiles_path: Union[Path, str],
    min_deflection_deg: float = 15.0,
    min_spacing_m: float = 50.0,
) -> List[TurnCue]:
    """
    Load vector transportation features from corridor PMTiles and extract TurnCues.
    """
    p_path = Path(pmtiles_path)
    if not p_path.exists():
        # Fall back to purely geometric cues if pmtiles does not exist
        return extract_turn_cues(track, network=None, min_deflection_deg=min_deflection_deg, min_spacing_m=min_spacing_m)

    net = OsmRoadNetwork(pmtiles_path=p_path)
    pts = _extract_coords(track)
    net.load_from_pmtiles(track_points=pts)
    return extract_turn_cues(track, network=net, min_deflection_deg=min_deflection_deg, min_spacing_m=min_spacing_m)


def save_turns_json(turns: List[TurnCue], output_path: Union[Path, str]) -> None:
    """
    Write turns to a JSON file matching frontend OsmTurnDefinition[] format.
    """
    data = [t.to_osm_turn_json() for t in turns]
    atomic_write_json(Path(output_path), data)


def _extract_coords(track: Any) -> List[Tuple[float, float]]:
    """Helper to extract (lat, lon) coordinates."""
    if isinstance(track, RouteTrack):
        return [(p.lat, p.lon) for p in track.points]
    elif isinstance(track, dict):
        return [(float(p[0]), float(p[1])) for p in track.get("points", [])]
    elif isinstance(track, (list, tuple)):
        pts = []
        for p in track:
            if isinstance(p, RoutePoint):
                pts.append((p.lat, p.lon))
            elif isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append((float(p[0]), float(p[1])))
        return pts
    return []
