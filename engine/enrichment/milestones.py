"""
engine.enrichment.milestones - Navigation milestones, town resupply checkpoints,
resupply interval calculations, and max dry stretch analysis.
"""

from dataclasses import dataclass, field
from enum import Enum
import logging
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.core.models import RoutePoint, RouteTrack
from engine.utils.spatial import TrackIndex
from engine.utils.text import slugify
from engine.utils.units import km_to_miles, meters_to_feet

logger = logging.getLogger(__name__)


class MilestoneType(str, Enum):
    """Milestone checkpoint types."""
    START = "start"
    TOWN = "town"
    PASS = "pass"
    WATER = "water"
    CHECKPOINT = "checkpoint"
    FINISH = "finish"


class ServiceType(str, Enum):
    """Resupply services available at milestone checkpoints."""
    FOOD = "food"
    WATER = "water"
    BIKE_SHOP = "bike_shop"
    LODGING = "lodging"
    CAMP = "camp"


@dataclass
class RouteMilestone:
    """
    Domain representation of a route navigation checkpoint or town resupply hub.
    
    Adheres to pure Python domain contracts while maintaining 100% backward
    compatibility with legacy milestones.json files consumed by Angular components.
    """
    km: float
    name: str
    type: str = "town"
    services: List[str] = field(default_factory=list)
    distance_to_next_km: Optional[float] = None
    elevation_m: float = 0.0
    coordinates: Optional[Tuple[float, float]] = None  # (lat, lon)
    state: str = ""
    description: str = ""
    id: str = ""

    def __post_init__(self) -> None:
        self.km = round(float(self.km), 3)
        self.elevation_m = round(float(self.elevation_m), 1)
        if self.distance_to_next_km is not None:
            self.distance_to_next_km = round(float(self.distance_to_next_km), 3)
        if isinstance(self.type, MilestoneType):
            self.type = str(self.type.value)
        if not self.id:
            slug = slugify(self.name, sep="_") or f"milestone_{int(round(self.km))}km"
            self.id = f"ms_{slug}_{int(round(self.km))}km"

    @property
    def mile(self) -> float:
        """Cumulative statute miles along route."""
        return round(km_to_miles(self.km), 1)

    @property
    def elevation(self) -> int:
        """Rounded elevation in meters for backward-compatible JSON export."""
        return int(round(self.elevation_m))

    def to_dict(self) -> Dict[str, Any]:
        """Complete domain dictionary representation."""
        return {
            "id": self.id,
            "name": self.name,
            "km": round(self.km, 1),
            "mile": self.mile,
            "elevation_m": round(self.elevation_m, 1),
            "elevation": self.elevation,
            "type": self.type,
            "services": list(self.services),
            "distance_to_next_km": round(self.distance_to_next_km, 1) if self.distance_to_next_km is not None else None,
            "coordinates": [round(self.coordinates[0], 5), round(self.coordinates[1], 5)] if self.coordinates else None,
            "state": self.state,
            "description": self.description,
        }

    def to_milestone_json(self) -> Dict[str, Any]:
        """
        Export dictionary conforming to existing public/data/routes/*/milestones.json
        while including enriched fields.
        """
        res: Dict[str, Any] = {
            "name": self.name,
            "mile": self.mile,
            "km": round(self.km, 1),
            "elevation": self.elevation,
            "state": self.state,
            "type": self.type,
            "services": list(self.services),
        }
        if self.distance_to_next_km is not None:
            res["distance_to_next_km"] = round(self.distance_to_next_km, 1)
        if self.coordinates:
            res["coordinates"] = [round(self.coordinates[0], 5), round(self.coordinates[1], 5)]
        if self.description:
            res["description"] = self.description
        return res

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "RouteMilestone":
        coords_raw = d.get("coordinates")
        coords = (float(coords_raw[0]), float(coords_raw[1])) if coords_raw and len(coords_raw) >= 2 else None
        ele = d.get("elevation_m")
        if ele is None:
            ele = d.get("elevation", 0.0)

        return cls(
            km=float(d.get("km", 0.0)),
            name=str(d.get("name", "Milestone")),
            type=str(d.get("type", "town")),
            services=list(d.get("services", [])),
            distance_to_next_km=float(d["distance_to_next_km"]) if d.get("distance_to_next_km") is not None else None,
            elevation_m=float(ele),
            coordinates=coords,
            state=str(d.get("state", "")),
            description=str(d.get("description", "")),
            id=str(d.get("id", "")),
        )


@dataclass
class ResupplyInterval:
    """
    Physical and logistical telemetry between two consecutive resupply hubs.
    
    Provides distance, total climbing, descending, and the critical 'max dry stretch'
    (maximum distance between consecutive water access points).
    """
    from_milestone: str
    to_milestone: str
    start_km: float
    end_km: float
    distance_km: float
    elevation_gain_m: float
    elevation_loss_m: float
    max_dry_stretch_km: float
    water_points_count: int = 0
    services: List[str] = field(default_factory=list)
    notes: str = ""

    def __post_init__(self) -> None:
        self.start_km = round(float(self.start_km), 3)
        self.end_km = round(float(self.end_km), 3)
        self.distance_km = round(float(self.distance_km), 3)
        self.elevation_gain_m = round(float(self.elevation_gain_m), 1)
        self.elevation_loss_m = round(float(self.elevation_loss_m), 1)
        self.max_dry_stretch_km = round(float(self.max_dry_stretch_km), 3)

    @property
    def distance_mi(self) -> float:
        """Distance in statute miles."""
        return round(km_to_miles(self.distance_km), 1)

    @property
    def max_dry_stretch_mi(self) -> float:
        """Maximum dry stretch in miles."""
        return round(km_to_miles(self.max_dry_stretch_km), 1)

    @property
    def elevation_gain_ft(self) -> int:
        """Elevation gain in feet."""
        return int(round(meters_to_feet(self.elevation_gain_m)))

    @property
    def elevation_loss_ft(self) -> int:
        """Elevation loss in feet."""
        return int(round(meters_to_feet(self.elevation_loss_m)))

    def to_dict(self) -> Dict[str, Any]:
        """Export dictionary supporting both snake_case domain and camelCase frontend."""
        return {
            # Domain snake_case
            "from_milestone": self.from_milestone,
            "to_milestone": self.to_milestone,
            "start_km": round(self.start_km, 1),
            "end_km": round(self.end_km, 1),
            "distance_km": round(self.distance_km, 1),
            "distance_mi": self.distance_mi,
            "elevation_gain_m": round(self.elevation_gain_m),
            "elevation_gain_ft": self.elevation_gain_ft,
            "elevation_loss_m": round(self.elevation_loss_m),
            "elevation_loss_ft": self.elevation_loss_ft,
            "max_dry_stretch_km": round(self.max_dry_stretch_km, 1),
            "max_dry_stretch_mi": self.max_dry_stretch_mi,
            "water_points_count": self.water_points_count,
            "services": list(self.services),
            "notes": self.notes,
            # Frontend camelCase
            "fromMilestone": self.from_milestone,
            "toMilestone": self.to_milestone,
            "startKm": round(self.start_km, 1),
            "endKm": round(self.end_km, 1),
            "distanceKm": round(self.distance_km, 1),
            "distanceMiles": self.distance_mi,
            "elevationGainM": round(self.elevation_gain_m),
            "elevationGainFt": self.elevation_gain_ft,
            "elevationLossM": round(self.elevation_loss_m),
            "elevationLossFt": self.elevation_loss_ft,
            "maxDryStretchKm": round(self.max_dry_stretch_km, 1),
            "maxDryStretchMiles": self.max_dry_stretch_mi,
            "waterPointsCount": self.water_points_count,
            "servicesAvailable": list(self.services),
        }


def calculate_max_dry_stretch(
    start_km: float,
    end_km: float,
    water_waypoints: Optional[Sequence[Any]] = None,
    start_has_water: bool = True,
    end_has_water: bool = True
) -> float:
    """
    Compute the maximum contiguous distance between water sources within an interval.
    
    Args:
        start_km: Beginning kilometer mark of interval.
        end_km: Ending kilometer mark of interval.
        water_waypoints: Sequence of WaterWaypoint objects, Places, dicts, or float positions.
        start_has_water: Whether start milestone has reliable water resupply.
        end_has_water: Whether end milestone has reliable water resupply.

    Returns:
        Max dry stretch distance in kilometers.
    """
    total_interval_km = max(0.0, end_km - start_km)
    if total_interval_km == 0.0:
        return 0.0

    # Extract kilometer positions within (start_km, end_km)
    inner_km: List[float] = []
    if water_waypoints:
        for w in water_waypoints:
            w_km = None
            is_reliable = True
            if isinstance(w, (int, float)):
                w_km = float(w)
            elif hasattr(w, "km"):
                w_km = float(w.km)
                if hasattr(w, "reliability") and str(w.reliability).lower() == "emergency_only":
                    is_reliable = False
            elif hasattr(w, "route_km"):
                w_km = float(w.route_km)
            elif isinstance(w, dict):
                w_km = float(w.get("km", w.get("route_km", 0.0)))
                if str(w.get("reliability", "")).lower() == "emergency_only":
                    is_reliable = False

            if w_km is not None and is_reliable and start_km < w_km < end_km:
                inner_km.append(w_km)

    inner_km.sort()

    # Build sequence of checkpoints: start -> w1 -> w2 -> ... -> end
    checkpoints = [start_km] + inner_km + [end_km]

    max_gap = 0.0
    for i in range(len(checkpoints) - 1):
        gap = checkpoints[i + 1] - checkpoints[i]
        if gap > max_gap:
            max_gap = gap

    return round(max_gap, 1)


def compute_resupply_intervals(
    milestones: Sequence[RouteMilestone],
    track: Union[RouteTrack, Sequence[Any]],
    water_waypoints: Optional[Sequence[Any]] = None
) -> List[ResupplyInterval]:
    """
    Compute physical distance, climbing/descending, and max dry stretch between resupply hubs.
    """
    if len(milestones) < 2:
        return []

    # Normalize track points
    if isinstance(track, RouteTrack):
        pts_5d = [p.to_list_5d() for p in track.points]
    elif track and isinstance(track[0], RoutePoint):
        pts_5d = [p.to_list_5d() for p in track]
    else:
        pts_5d = list(track)

    intervals: List[ResupplyInterval] = []

    for i in range(len(milestones) - 1):
        m_from = milestones[i]
        m_to = milestones[i + 1]

        s_km = m_from.km
        e_km = m_to.km
        dist_km = max(0.0, e_km - s_km)

        # Slice track points for elevation gain & loss
        gain_m = 0.0
        loss_m = 0.0
        sub_pts = [p for p in pts_5d if s_km <= p[3] <= e_km]

        if len(sub_pts) >= 2:
            for j in range(len(sub_pts) - 1):
                diff = sub_pts[j + 1][2] - sub_pts[j][2]
                if diff > 0:
                    gain_m += diff
                else:
                    loss_m += abs(diff)
        else:
            # Fallback to direct elevation difference between milestones
            ele_diff = m_to.elevation_m - m_from.elevation_m
            if ele_diff > 0:
                gain_m = ele_diff
            else:
                loss_m = abs(ele_diff)

        # Count water points in interval
        w_count = 0
        if water_waypoints:
            for w in water_waypoints:
                w_km = None
                if isinstance(w, (int, float)):
                    w_km = float(w)
                elif hasattr(w, "km"):
                    w_km = float(w.km)
                elif hasattr(w, "route_km"):
                    w_km = float(w.route_km)
                elif isinstance(w, dict):
                    w_km = float(w.get("km", w.get("route_km", 0.0)))
                if w_km is not None and s_km < float(w_km) < e_km:
                    w_count += 1

        dry_km = calculate_max_dry_stretch(s_km, e_km, water_waypoints)

        combined_services = list(set(m_from.services + m_to.services))
        notes = f"Resupply leg from {m_from.name} to {m_to.name}. Max water carry: {dry_km:.1f} km."

        intervals.append(ResupplyInterval(
            from_milestone=m_from.name,
            to_milestone=m_to.name,
            start_km=s_km,
            end_km=e_km,
            distance_km=dist_km,
            elevation_gain_m=gain_m,
            elevation_loss_m=loss_m,
            max_dry_stretch_km=dry_km,
            water_points_count=w_count,
            services=sorted(combined_services),
            notes=notes
        ))

    return intervals


def generate_route_milestones(
    track: Union[RouteTrack, Sequence[Any]],
    towns: Optional[Sequence[Dict[str, Any]]] = None,
    passes: Optional[Sequence[Any]] = None,
    custom_waypoints: Optional[Sequence[Any]] = None,
    places: Optional[Sequence[Any]] = None,
    interval_km: float = 50.0,
    start_name: str = "Trailhead / Start",
    end_name: str = "Finish Terminus",
    state: str = "",
    min_spacing_km: float = 5.0
) -> List[RouteMilestone]:
    """
    Generate navigation milestones, town checkpoints, and spaced backcountry intervals.
    """
    # 1. Normalize track points
    if isinstance(track, RouteTrack):
        pts_5d = [p.to_list_5d() for p in track.points]
    elif track and isinstance(track[0], RoutePoint):
        pts_5d = [p.to_list_5d() for p in track]
    else:
        pts_5d = list(track)

    if not pts_5d:
        raise ValueError("Cannot generate milestones for empty route track.")

    total_km = pts_5d[-1][3] if len(pts_5d[-1]) > 3 else 0.0
    first_pt = pts_5d[0]
    last_pt = pts_5d[-1]
    track_index = TrackIndex(pts_5d)

    # 2. Gather candidates
    candidates: List[RouteMilestone] = []

    # Ingest towns
    if towns:
        for t in towns:
            t_name = t.get("name", "Town")
            t_km = t.get("km") or t.get("route_km")
            t_ele = t.get("elevation") or t.get("elevation_m", 0.0)
            t_state = t.get("state") or t.get("province_state", state)
            coords = None

            t_lat = t.get("lat") or (t.get("location", {}).get("lat"))
            t_lon = t.get("lon") or (t.get("location", {}).get("lon"))

            if t_km is None and t_lat is not None and t_lon is not None:
                dist_km, r_km, _ = track_index.project_point(float(t_lat), float(t_lon), max_dist_km=15.0)
                t_km = r_km
                coords = (float(t_lat), float(t_lon))
            elif t_lat is not None and t_lon is not None:
                coords = (float(t_lat), float(t_lon))

            if t_km is not None and 0.0 <= float(t_km) <= total_km:
                candidates.append(RouteMilestone(
                    km=float(t_km),
                    name=t_name,
                    type="town",
                    services=t.get("services", ["food", "lodging"]),
                    elevation_m=float(t_ele),
                    coordinates=coords,
                    state=t_state,
                    description=t.get("description", f"Town resupply hub: {t_name}")
                ))

    # Ingest mountain passes
    if passes:
        for p in passes:
            p_name = getattr(p, "name", None) or (p.get("name") if isinstance(p, dict) else "Mountain Pass")
            p_km = getattr(p, "route_km", None) or (p.get("route_km") if isinstance(p, dict) else None)
            p_ele = getattr(p, "elevation_m", None) or (p.get("elevation_m", 0.0) if isinstance(p, dict) else 0.0)
            if p_km is not None and 0.0 <= float(p_km) <= total_km:
                candidates.append(RouteMilestone(
                    km=float(p_km),
                    name=p_name,
                    type="pass",
                    elevation_m=float(p_ele),
                    state=state,
                    description=f"Mountain summit / pass: {p_name}"
                ))

    # Ingest custom waypoints (checkpoints/towns)
    if custom_waypoints:
        for cw in custom_waypoints:
            cw_name = getattr(cw, "name", None) or (cw.get("name") if isinstance(cw, dict) else "")
            cw_type = getattr(cw, "type", "") or (cw.get("type", "") if isinstance(cw, dict) else "")
            cw_km = getattr(cw, "route_km", None) or (cw.get("route_km") if isinstance(cw, dict) else None)
            cw_ele = getattr(cw, "ele", 0.0) or (cw.get("ele", 0.0) if isinstance(cw, dict) else 0.0)
            if cw_km is not None and 0.0 <= float(cw_km) <= total_km and cw_type.lower() in ("checkpoint", "town", "finish", "start"):
                candidates.append(RouteMilestone(
                    km=float(cw_km),
                    name=cw_name,
                    type="checkpoint",
                    elevation_m=float(cw_ele or 0.0),
                    state=state,
                ))

    # 3. Filter candidates by min_spacing_km and sort
    candidates.sort(key=lambda m: m.km)
    deduped_candidates: List[RouteMilestone] = []

    for c in candidates:
        # Don't duplicate start or finish
        if c.km <= min_spacing_km or c.km >= (total_km - min_spacing_km):
            continue

        if not deduped_candidates:
            deduped_candidates.append(c)
            continue

        prev = deduped_candidates[-1]
        if abs(c.km - prev.km) < min_spacing_km:
            # Prefer official town or checkpoint
            if c.type == "town" and prev.type != "town":
                deduped_candidates[-1] = c
        else:
            deduped_candidates.append(c)

    # 4. Insert backcountry interval checkpoints if gap > interval_km * 1.4
    all_milestones: List[RouteMilestone] = []
    start_ms = RouteMilestone(
        km=0.0,
        name=start_name,
        type="start",
        services=["food", "water"],
        elevation_m=first_pt[2],
        coordinates=(first_pt[0], first_pt[1]),
        state=state,
        description=f"Route start terminus: {start_name}"
    )
    all_milestones.append(start_ms)

    # Build sequence with intermediate intervals
    current_km = 0.0
    max_gap = interval_km * 1.4

    for c in deduped_candidates:
        gap = c.km - current_km
        if gap > max_gap and interval_km > 0:
            # Insert intermediate synthetic checkpoint
            steps = int(math.floor(gap / interval_km))
            for s in range(1, steps + 1):
                synth_km = round(current_km + (s * interval_km), 1)
                if synth_km < c.km - min_spacing_km:
                    synth_pt = min(pts_5d, key=lambda p: abs(p[3] - synth_km))
                    all_milestones.append(RouteMilestone(
                        km=synth_km,
                        name=f"Checkpoint Km {int(round(synth_km))}",
                        type="checkpoint",
                        elevation_m=synth_pt[2],
                        coordinates=(synth_pt[0], synth_pt[1]),
                        state=state,
                    ))
        all_milestones.append(c)
        current_km = c.km

    # Final gap to finish
    gap = total_km - current_km
    if gap > max_gap and interval_km > 0:
        steps = int(math.floor(gap / interval_km))
        for s in range(1, steps + 1):
            synth_km = round(current_km + (s * interval_km), 1)
            if synth_km < total_km - min_spacing_km:
                synth_pt = min(pts_5d, key=lambda p: abs(p[3] - synth_km))
                all_milestones.append(RouteMilestone(
                    km=synth_km,
                    name=f"Checkpoint Km {int(round(synth_km))}",
                    type="checkpoint",
                    elevation_m=synth_pt[2],
                    coordinates=(synth_pt[0], synth_pt[1]),
                    state=state,
                ))

    finish_ms = RouteMilestone(
        km=total_km,
        name=end_name,
        type="finish",
        services=["food", "water", "lodging"],
        elevation_m=last_pt[2],
        coordinates=(last_pt[0], last_pt[1]),
        state=state,
        description=f"Route finish terminus: {end_name}"
    )
    all_milestones.append(finish_ms)

    # 5. Calculate distance_to_next_km
    for i in range(len(all_milestones) - 1):
        all_milestones[i].distance_to_next_km = round(all_milestones[i + 1].km - all_milestones[i].km, 1)
    all_milestones[-1].distance_to_next_km = 0.0

    return all_milestones
