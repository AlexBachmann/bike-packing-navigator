"""
engine.enrichment.waypoints - Custom GPX waypoint (<wpt>) extraction, classification,
orthogonal segment projection, and integration into the bikepacking POI layer.
"""

from dataclasses import dataclass, field
from io import BytesIO, StringIO
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, TextIO, Tuple, Union
import xml.etree.ElementTree as ET

from engine.core.models import CorruptedGPXError, EmptyGPXError, RoutePoint, RouteTrack
from engine.utils.geo import dist_point_to_segment_m, haversine_distance_m
from engine.utils.spatial import TrackIndex
from engine.utils.text import slugify
from engine.utils.units import km_to_miles

logger = logging.getLogger(__name__)


@dataclass
class CustomWaypoint:
    """
    Represents an embedded GPX waypoint (<wpt>) projected onto a route track.
    
    Preserves original GPX tags (name, desc, cmt, sym, type, ele) alongside
    computed track telemetry (route_km, dist_off_route_m) and categorized metadata.
    """
    name: str
    lat: float
    lon: float
    ele: Optional[float] = None
    desc: str = ""
    cmt: str = ""
    sym: str = ""
    type: str = ""
    category: str = "other"
    route_km: Optional[float] = None
    dist_off_route_m: Optional[float] = None
    is_in_town: bool = False
    id: str = ""
    address: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.lat = float(self.lat)
        self.lon = float(self.lon)
        if self.ele is not None:
            self.ele = round(float(self.ele), 1)
        if self.route_km is not None:
            self.route_km = round(float(self.route_km), 3)
        if self.dist_off_route_m is not None:
            self.dist_off_route_m = round(float(self.dist_off_route_m), 1)
        if not self.id:
            self.id = slugify(self.name, sep="_", default="wpt")

    @property
    def route_mile(self) -> Optional[float]:
        """Cumulative miles along route."""
        return round(km_to_miles(self.route_km), 1) if self.route_km is not None else None

    @property
    def distance_to_trail_km(self) -> Optional[float]:
        """Lateral offset in kilometers."""
        return round(self.dist_off_route_m / 1000.0, 3) if self.dist_off_route_m is not None else None

    def to_dict(self) -> Dict[str, Any]:
        """Convert CustomWaypoint to domain dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "ele": self.ele,
            "desc": self.desc,
            "cmt": self.cmt,
            "sym": self.sym,
            "type": self.type,
            "category": self.category,
            "route_km": round(self.route_km, 1) if self.route_km is not None else None,
            "route_mile": self.route_mile,
            "dist_off_route_m": self.dist_off_route_m,
            "distance_to_trail_km": self.distance_to_trail_km,
            "is_in_town": self.is_in_town,
            "address": self.address,
            "extra": self.extra,
        }

    def to_place_dict(self) -> Dict[str, Any]:
        """Convert to frontend Place object format (public/data/routes/*/places.json)."""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "type": self.type or "point",
            "town": self.extra.get("town", ""),
            "is_in_town": self.is_in_town,
            "location": {
                "lat": round(self.lat, 6),
                "lon": round(self.lon, 6),
            },
            "distance_to_trail_km": self.distance_to_trail_km if self.distance_to_trail_km is not None else 0.0,
            "route_km": round(self.route_km, 1) if self.route_km is not None else 0.0,
            "route_mile": self.route_mile if self.route_mile is not None else 0.0,
            "elevation": int(round(self.ele)) if self.ele is not None else None,
            "address": self.address,
            "google_maps_url": f"https://maps.google.com/?q={self.lat:.5f},{self.lon:.5f}",
            "description": self.desc or self.cmt or self.name,
            "sym": self.sym,
            "cmt": self.cmt,
        }


def classify_waypoint(
    name: str,
    desc: str = "",
    cmt: str = "",
    sym: str = "",
    wpt_type: str = ""
) -> Tuple[str, str, bool]:
    """
    Map raw GPX waypoint metadata to standardized (category, type_name, is_in_town).
    """
    combined = f"{name} {desc} {cmt} {sym} {wpt_type}".lower()

    # 1. Water
    if any(s in sym.lower() for s in ("water", "spring", "fountain", "drinking")) or \
       any(k in combined for k in ("water source", "spring", "drinking water", "water tap", "spigot", "fountain", "creek access", "well")):
        return "water", "water", False

    # 2. Checkpoint / Race Control (CP1, Checkpoint, Control, Flag)
    if "checkpoint" in combined or "control" in combined or combined.startswith("cp") or " cp" in combined or any(k in combined for k in ("cp1", "cp2", "cp3", "cp4", "cp5")) or "flag" in sym.lower():
        return "town", "checkpoint", True

    # 3. Camping / Bivy
    if any(s in sym.lower() for s in ("camp", "campsite", "tent", "shelter")) or \
       any(k in combined for k in ("campground", "campsite", "bivy", "shelter", "wild camp", "tent site", "hut", "refuge")):
        return "campground", "campground", False

    # 3. Grocery / Supermarket
    if any(s in sym.lower() for s in ("grocery", "shopping", "supermarket", "store", "convenience")) or \
       any(k in combined for k in ("supermarket", "grocery", "general store", "mini market", "bazaar", "convenience store")):
        return "grocery", "store", True

    # 4. Food / Dining
    if any(s in sym.lower() for s in ("restaurant", "food", "bar", "cafe", "fast food")) or \
       any(k in combined for k in ("restaurant", "cafe", "bakery", "taverna", "diner", "coffee", "pizzeria", "bistro")):
        return "food", "restaurant", True

    # 5. Lodging / Hotel
    if any(s in sym.lower() for s in ("hotel", "motel", "lodging", "bed & breakfast")) or \
       any(k in combined for k in ("hotel", "motel", "hostel", "guesthouse", "auberge", "inn", "lodge", "cabins")):
        return "hotel", "lodging", True

    # 6. Bike shop
    if any(s in sym.lower() for s in ("bike", "bicycle", "wrench")) or \
       any(k in combined for k in ("bike shop", "bicycle store", "bike repair", "veloworks", "cycle repair")):
        return "bike_shop", "bike_shop", True

    # 7. Gas station
    if any(s in sym.lower() for s in ("gas", "fuel", "petrol")) or \
       any(k in combined for k in ("gas station", "petrol", "fuel station", "service station")):
        return "gas_station", "gas_station", True

    # 8. Mountain Pass / Summit
    if any(s in sym.lower() for s in ("summit", "pass", "mountain", "triangle")) or \
       any(k in combined for k in ("pass", "summit", "col", "saddle", "diaselo", "tizi", "ridge")):
        return "pass", "pass", False

    # 9. Hazard / Caution
    if any(s in sym.lower() for s in ("danger", "warning", "hazard", "caution", "skull")) or \
       any(k in combined for k in ("danger", "caution", "warning", "hazard", "hike-a-bike", "washout", "cliff")):
        return "caution", "danger", False

    # 10. Town / Resupply Hub
    if any(s in sym.lower() for s in ("town", "city", "village")) or \
       any(k in combined for k in ("town", "village", "city", "resupply hub")):
        return "town", "town", True

    return "other", "point", False


def extract_raw_gpx_waypoints(
    gpx_source: Union[str, Path, TextIO, bytes]
) -> List[CustomWaypoint]:
    """
    Parse GPX XML and extract all <wpt> elements preserving metadata, symbols, and notes.
    """
    xml_bytes = b""
    if isinstance(gpx_source, bytes):
        xml_bytes = gpx_source
    elif isinstance(gpx_source, str):
        # Check if source is a file path or XML string
        if os.path.exists(gpx_source):
            with open(gpx_source, "rb") as f:
                xml_bytes = f.read()
        else:
            xml_bytes = gpx_source.encode("utf-8")
    elif isinstance(gpx_source, Path):
        if not gpx_source.exists():
            raise FileNotFoundError(f"GPX file not found: {gpx_source}")
        xml_bytes = gpx_source.read_bytes()
    elif hasattr(gpx_source, "read"):
        raw = gpx_source.read()
        xml_bytes = raw if isinstance(raw, bytes) else raw.encode("utf-8")

    if not xml_bytes or not xml_bytes.strip():
        raise EmptyGPXError("GPX content is empty or 0 bytes.")

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        raise CorruptedGPXError(f"Malformed GPX XML: {e}")

    # Discover namespace if present
    ns = ""
    if root.tag.startswith("{") and "}" in root.tag:
        ns = root.tag.split("}")[0] + "}"

    waypoints: List[CustomWaypoint] = []

    for wpt_elem in root.findall(f"{ns}wpt"):
        lat_attr = wpt_elem.get("lat")
        lon_attr = wpt_elem.get("lon")
        if lat_attr is None or lon_attr is None:
            continue

        try:
            lat = float(lat_attr)
            lon = float(lon_attr)
        except ValueError:
            continue

        ele = None
        ele_elem = wpt_elem.find(f"{ns}ele")
        if ele_elem is not None and ele_elem.text:
            try:
                ele = float(ele_elem.text.strip())
            except ValueError:
                pass

        name = ""
        name_elem = wpt_elem.find(f"{ns}name")
        if name_elem is not None and name_elem.text:
            name = name_elem.text.strip()

        desc = ""
        desc_elem = wpt_elem.find(f"{ns}desc")
        if desc_elem is not None and desc_elem.text:
            desc = desc_elem.text.strip()

        cmt = ""
        cmt_elem = wpt_elem.find(f"{ns}cmt")
        if cmt_elem is not None and cmt_elem.text:
            cmt = cmt_elem.text.strip()

        sym = ""
        sym_elem = wpt_elem.find(f"{ns}sym")
        if sym_elem is not None and sym_elem.text:
            sym = sym_elem.text.strip()

        wpt_type = ""
        type_elem = wpt_elem.find(f"{ns}type")
        if type_elem is not None and type_elem.text:
            wpt_type = type_elem.text.strip()

        cat, normalized_type, in_town = classify_waypoint(
            name=name, desc=desc, cmt=cmt, sym=sym, wpt_type=wpt_type
        )

        waypoints.append(CustomWaypoint(
            name=name or "Waypoint",
            lat=lat,
            lon=lon,
            ele=ele,
            desc=desc,
            cmt=cmt,
            sym=sym,
            type=normalized_type or wpt_type,
            category=cat,
            is_in_town=in_town,
        ))

    return waypoints


def project_waypoints_to_track(
    waypoints: Sequence[CustomWaypoint],
    track: Union[RouteTrack, Sequence[Any]],
    max_distance_m: float = 5000.0,
    track_index: Optional[TrackIndex] = None
) -> List[CustomWaypoint]:
    """
    Project waypoints perpendicularly onto route track segments using TrackIndex
    and dist_point_to_segment_m.
    """
    if not waypoints:
        return []

    # Normalize track points
    if isinstance(track, RouteTrack):
        pts_5d = [p.to_list_5d() for p in track.points]
    elif track and isinstance(track[0], RoutePoint):
        pts_5d = [p.to_list_5d() for p in track]
    else:
        pts_5d = list(track)

    if not pts_5d:
        return []

    # Ensure each point has cumulative distance at index 3
    if len(pts_5d[0]) < 4:
        cum = 0.0
        normalized_pts = []
        for i, p in enumerate(pts_5d):
            if i > 0:
                prev = pts_5d[i - 1]
                cum += haversine_distance_m(float(prev[0]), float(prev[1]), float(p[0]), float(p[1])) / 1000.0
            ele = float(p[2]) if len(p) > 2 else 0.0
            normalized_pts.append([float(p[0]), float(p[1]), ele, cum, cum * 0.621371])
        pts_5d = normalized_pts

    num_points = len(pts_5d)
    if num_points == 1:
        p0 = pts_5d[0]
        projected: List[CustomWaypoint] = []
        seen_ids: Dict[str, int] = {}
        for wp in waypoints:
            d_m = haversine_distance_m(wp.lat, wp.lon, float(p0[0]), float(p0[1]))
            if d_m <= max_distance_m:
                base_id = slugify(wp.name, sep="_", default="wpt")
                if base_id in seen_ids:
                    seen_ids[base_id] += 1
                    final_id = f"{base_id}_{seen_ids[base_id]}"
                else:
                    seen_ids[base_id] = 0
                    final_id = base_id
                proj_wp = CustomWaypoint(
                    name=wp.name,
                    lat=wp.lat,
                    lon=wp.lon,
                    ele=wp.ele,
                    desc=wp.desc,
                    cmt=wp.cmt,
                    sym=wp.sym,
                    type=wp.type,
                    category=wp.category,
                    route_km=float(p0[3]),
                    dist_off_route_m=d_m,
                    is_in_town=wp.is_in_town,
                    id=final_id,
                    address=wp.address,
                    extra=dict(wp.extra),
                )
                projected.append(proj_wp)
        return projected

    # Calculate maximum segment length across track to dimension search radius
    max_seg_len_m = 0.0
    for i in range(num_points - 1):
        km_diff = abs(float(pts_5d[i + 1][3]) - float(pts_5d[i][3])) * 1000.0
        if km_diff > max_seg_len_m:
            max_seg_len_m = km_diff

    # Any segment with perpendicular distance <= max_distance_m has at least one
    # vertex within max_distance_m + (max_seg_len_m / 2.0). Add a safety margin.
    search_radius_m = max_distance_m + (max_seg_len_m / 2.0) + 10.0

    if track_index is None and num_points > 64:
        track_index = TrackIndex(pts_5d)

    projected: List[CustomWaypoint] = []
    seen_ids: Dict[str, int] = {}

    for wp in waypoints:
        if track_index is not None:
            nearby_matches = track_index.grid.query_radius(wp.lat, wp.lon, radius_m=search_radius_m)
            if not nearby_matches:
                continue
            cand_segments = set()
            for idx, _ in nearby_matches:
                if idx < num_points - 1:
                    cand_segments.add(idx)
                if idx > 0:
                    cand_segments.add(idx - 1)
            candidate_indices = sorted(cand_segments)
        else:
            candidate_indices = range(num_points - 1)

        best_dist = float("inf")
        best_km = 0.0

        for i in candidate_indices:
            p1 = pts_5d[i]
            p2 = pts_5d[i + 1]
            lat1, lon1 = float(p1[0]), float(p1[1])
            lat2, lon2 = float(p2[0]), float(p2[1])

            dist_m, t, _, _ = dist_point_to_segment_m(wp.lat, wp.lon, lat1, lon1, lat2, lon2)
            if dist_m < best_dist:
                best_dist = dist_m
                km1 = float(p1[3])
                km2 = float(p2[3])
                best_km = km1 + t * (km2 - km1)

        if best_dist > max_distance_m:
            continue

        base_id = slugify(wp.name, sep="_", default="wpt")
        if base_id in seen_ids:
            seen_ids[base_id] += 1
            final_id = f"{base_id}_{seen_ids[base_id]}"
        else:
            seen_ids[base_id] = 0
            final_id = base_id

        proj_wp = CustomWaypoint(
            name=wp.name,
            lat=wp.lat,
            lon=wp.lon,
            ele=wp.ele,
            desc=wp.desc,
            cmt=wp.cmt,
            sym=wp.sym,
            type=wp.type,
            category=wp.category,
            route_km=best_km,
            dist_off_route_m=best_dist,
            is_in_town=wp.is_in_town,
            id=final_id,
            address=wp.address,
            extra=dict(wp.extra),
        )
        projected.append(proj_wp)

    # Sort strictly ascending by route_km
    projected.sort(key=lambda w: (w.route_km if w.route_km is not None else 0.0, w.dist_off_route_m if w.dist_off_route_m is not None else 0.0))
    return projected


def extract_and_project_waypoints(
    gpx_source: Union[str, Path, TextIO, bytes],
    track: Union[RouteTrack, Sequence[Any]],
    max_distance_m: float = 5000.0
) -> List[CustomWaypoint]:
    """
    High-level orchestrator: parse GPX waypoints and project onto route track.
    """
    raw_waypoints = extract_raw_gpx_waypoints(gpx_source)
    return project_waypoints_to_track(raw_waypoints, track, max_distance_m=max_distance_m)
