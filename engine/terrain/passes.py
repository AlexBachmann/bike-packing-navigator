"""
engine.terrain.passes - Mountain pass identification, topographic saddle analysis,
OSM saddle node matching, route high-point detection, and climb linking.
"""

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.terrain.climbs import Climb
from engine.utils.geo import dist_point_to_segment_m, haversine_distance_m
from engine.utils.text import slugify
from engine.utils.units import km_to_miles, meters_to_feet


# -----------------------------------------------------------------------------
# Dataclass Model
# -----------------------------------------------------------------------------

@dataclass
class MountainPass:
    """
    Domain representation of a mountain pass, saddle, col, or iconic elevation checkpoint.
    """
    name: str
    km: float
    elevation_m: float
    elevation_ft: float
    coordinates: Tuple[float, float]             # (lat, lon)
    osm_id: Optional[int] = None
    id: str = ""                                 # slug e.g. "kenosha-pass"
    state: str = ""
    difficulty: str = "moderate"                 # "moderate", "difficult", "extreme"
    notes: str = ""
    is_high_point: bool = False
    is_iconic: bool = False
    climb_id: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.km = round(float(self.km), 3)
        self.elevation_m = round(float(self.elevation_m), 1)
        self.elevation_ft = round(float(self.elevation_ft), 1)
        if not self.id:
            self.id = slugify(self.name) or f"pass-{int(round(self.km))}"

    @property
    def mile(self) -> float:
        return km_to_miles(self.km)

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
            "km": round(self.km, 3),
            "route_km": round(self.km, 3),
            "elevation_m": round(self.elevation_m, 1),
            "elevation_ft": round(self.elevation_ft, 1),
            "coordinates": [round(self.coordinates[0], 5), round(self.coordinates[1], 5)],
            "osm_id": self.osm_id,
            "is_high_point": self.is_high_point,
            "is_iconic": self.is_iconic,
            "climb_id": self.climb_id,

            # Frontend camelCase keys
            "state": self.state,
            "routeMile": round(self.mile, 1),
            "routeKm": round(self.km, 1),
            "elevationMeters": round(self.elevation_m),
            "elevationFeet": round(self.elevation_ft),
            "lat": round(self.coordinates[0], 5),
            "lon": round(self.coordinates[1], 5),
            "difficulty": self.difficulty,
            "notes": self.notes or f"Mountain pass and elevation checkpoint at {round(self.elevation_m)}m."
        }


# -----------------------------------------------------------------------------
# Curated Pass Helpers
# -----------------------------------------------------------------------------

def load_curated_passes(passes_file: Union[str, Path]) -> List[MountainPass]:
    """
    Load MountainPass domain objects from an existing curated JSON file.
    """
    path = Path(passes_file)
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    passes: List[MountainPass] = []
    for item in data:
        coords = item.get("coordinates")
        if not coords:
            coords = [item.get("lat", 0.0), item.get("lon", 0.0)]
        ele_m = item.get("elevation_m", item.get("elevationMeters", 0.0))
        ele_ft = item.get("elevation_ft", item.get("elevationFeet", meters_to_feet(ele_m)))
        km_val = item.get("km", item.get("routeKm", 0.0))
        p = MountainPass(
            id=item.get("id", ""),
            name=item.get("name", ""),
            km=km_val,
            elevation_m=ele_m,
            elevation_ft=ele_ft,
            coordinates=(float(coords[0]), float(coords[1])),
            state=item.get("state", ""),
            difficulty=item.get("difficulty", "moderate"),
            notes=item.get("notes", ""),
            is_high_point=bool(item.get("is_high_point", False)),
            is_iconic=bool(item.get("is_iconic", False)),
            climb_id=item.get("climb_id"),
        )
        passes.append(p)
    return passes


def is_curated_pass_list(passes: Sequence[Any]) -> bool:
    """
    Check whether a list of passes contains human-curated landmarks.
    Returns True if any pass has authentic, non-generic naming or custom notes.
    """
    if not passes:
        return False
    for p in passes:
        name = getattr(p, "name", "") if hasattr(p, "name") else p.get("name", "")
        notes = getattr(p, "notes", "") if hasattr(p, "notes") else p.get("notes", "")
        # A curated pass has an authentic named identity, not auto-generated "Summit (Mile X.X)"
        if name and not name.startswith("Summit (Mile ") and not name.startswith("Route High Point (Mile "):
            return True
        if notes and not notes.startswith("Mountain pass verified by OpenStreetMap") and not notes.startswith("Topographic summit gaining"):
            return True
    return False


# -----------------------------------------------------------------------------
# OSM Pass Node Extraction & Spatial Matching
# -----------------------------------------------------------------------------

def extract_osm_pass_nodes(
    corridor_data: Union[Dict[str, Any], List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """
    Extract candidate pass nodes (natural=saddle, mountain_pass=yes, natural=col)
    from Overpass JSON elements or GeoJSON features.
    """
    nodes: List[Dict[str, Any]] = []

    # Handle Overpass JSON elements
    if isinstance(corridor_data, dict) and "elements" in corridor_data:
        for elem in corridor_data["elements"]:
            if elem.get("type") == "node" and "tags" in elem:
                tags = elem["tags"]
                is_pass = (
                    tags.get("natural") in ("saddle", "col") or
                    tags.get("mountain_pass") in ("yes", "true", "1") or
                    tags.get("historic") == "mountain_pass"
                )
                if is_pass:
                    name = tags.get("name") or tags.get("name:en") or "Unnamed Pass"
                    ele = None
                    if "ele" in tags:
                        try:
                            ele = float(tags["ele"])
                        except Exception:
                            ele = None
                    nodes.append({
                        "osm_id": elem.get("id"),
                        "name": name,
                        "lat": float(elem["lat"]),
                        "lon": float(elem["lon"]),
                        "ele": ele,
                        "tags": tags,
                    })

    # Handle GeoJSON FeatureCollection
    elif isinstance(corridor_data, dict) and "features" in corridor_data:
        for feat in corridor_data["features"]:
            geom = feat.get("geometry") or {}
            props = feat.get("properties") or {}
            if geom.get("type") == "Point" and geom.get("coordinates"):
                lon, lat = geom["coordinates"][:2]
                is_pass = (
                    props.get("natural") in ("saddle", "col") or
                    props.get("mountain_pass") in ("yes", "true", "1") or
                    props.get("historic") == "mountain_pass"
                )
                if is_pass:
                    name = props.get("name") or props.get("name:en") or "Unnamed Pass"
                    ele = None
                    if "ele" in props:
                        try:
                            ele = float(props["ele"])
                        except Exception:
                            ele = None
                    nodes.append({
                        "osm_id": props.get("osm_id") or feat.get("id"),
                        "name": name,
                        "lat": float(lat),
                        "lon": float(lon),
                        "ele": ele,
                        "tags": props,
                    })

    return nodes


def match_pass_nodes_to_track(
    pass_nodes: List[Dict[str, Any]],
    track_points: Sequence[Any],
    max_distance_m: float = 500.0,
    default_state: str = ""
) -> List[MountainPass]:
    """
    Project candidate pass nodes onto the route track and retain those within max_distance_m (500m).
    """
    if not pass_nodes or len(track_points) < 2:
        return []

    matched_passes: List[MountainPass] = []

    for node in pass_nodes:
        n_lat = node["lat"]
        n_lon = node["lon"]

        min_dist_m = float("inf")
        best_km = 0.0
        best_ele_m = 0.0

        for i in range(len(track_points) - 1):
            p1 = track_points[i]
            p2 = track_points[i + 1]
            dist_m, frac, proj_lat, proj_lon = dist_point_to_segment_m(
                n_lat, n_lon,
                float(p1[0]), float(p1[1]),
                float(p2[0]), float(p2[1])
            )

            if dist_m < min_dist_m:
                min_dist_m = dist_m
                km1 = float(p1[3])
                km2 = float(p2[3])
                best_km = km1 + (km2 - km1) * frac
                ele1 = float(p1[2])
                ele2 = float(p2[2])
                best_ele_m = ele1 + (ele2 - ele1) * frac

        if min_dist_m <= max_distance_m:
            node_ele = node.get("ele")
            ele_m = float(node_ele) if node_ele is not None else best_ele_m
            ele_ft = meters_to_feet(ele_m)

            pass_obj = MountainPass(
                id=slugify(node["name"]),
                name=node["name"],
                km=best_km,
                elevation_m=ele_m,
                elevation_ft=ele_ft,
                coordinates=(n_lat, n_lon),
                osm_id=node.get("osm_id"),
                state=default_state,
                difficulty="moderate" if ele_m < 2500.0 else ("difficult" if ele_m < 3500.0 else "extreme"),
                notes=f"Mountain pass verified by OpenStreetMap at {round(ele_m)}m.",
            )
            matched_passes.append(pass_obj)

    return matched_passes


# -----------------------------------------------------------------------------
# Topographic Saddle & High Point Analysis
# -----------------------------------------------------------------------------

def detect_saddles_and_high_points(
    track_points: Sequence[Any],
    min_prominence_m: float = 150.0,
    search_window_km: float = 10.0,
    min_spacing_km: float = 15.0,
    default_state: str = ""
) -> List[MountainPass]:
    """
    Identify topographic saddles and landmark summits from 1D elevation profile
    having at least min_prominence_m (default 150m) ascent and descent within search_window_km (10km).
    Clusters and deduplicates candidate summits within min_spacing_km (15km) to prevent label pileup.
    Also detects and flags the route's global maximum elevation coordinate.
    """
    if len(track_points) < 3:
        return []

    n = len(track_points)

    # Global high point tracking
    global_max_ele = -float("inf")
    global_max_idx = 0

    for i, pt in enumerate(track_points):
        ele = float(pt[2])
        if ele > global_max_ele:
            global_max_ele = ele
            global_max_idx = i

    # Topographic saddle detection with prominence
    raw_saddles: List[Tuple[float, MountainPass]] = []

    for i in range(1, n - 1):
        curr_ele = float(track_points[i][2])
        curr_km = float(track_points[i][3])

        # Must be a local maximum
        prev_ele = float(track_points[i - 1][2])
        next_ele = float(track_points[i + 1][2])
        if curr_ele <= prev_ele or curr_ele < next_ele:
            continue

        # Look backward up to search_window_km for minimum elevation
        min_ele_before = curr_ele
        for j in range(i - 1, -1, -1):
            if curr_km - float(track_points[j][3]) > search_window_km:
                break
            min_ele_before = min(min_ele_before, float(track_points[j][2]))

        # Look forward up to search_window_km for minimum elevation
        min_ele_after = curr_ele
        for j in range(i + 1, n):
            if float(track_points[j][3]) - curr_km > search_window_km:
                break
            min_ele_after = min(min_ele_after, float(track_points[j][2]))

        prominence_before = curr_ele - min_ele_before
        prominence_after = curr_ele - min_ele_after
        prominence = min(prominence_before, prominence_after)

        if prominence >= min_prominence_m:
            pt = track_points[i]
            s_name = f"Summit (Mile {round(km_to_miles(curr_km), 1)})"
            saddle = MountainPass(
                id=f"summit-mile-{round(km_to_miles(curr_km), 1)}".replace(".", "-"),
                name=s_name,
                km=curr_km,
                elevation_m=curr_ele,
                elevation_ft=meters_to_feet(curr_ele),
                coordinates=(float(pt[0]), float(pt[1])),
                state=default_state,
                difficulty="moderate" if curr_ele < 2500.0 else ("difficult" if curr_ele < 3500.0 else "extreme"),
                notes=f"Topographic summit gaining {round(prominence_before)}m with {round(prominence_after)}m descent.",
            )
            raw_saddles.append((prominence, saddle))

    # Cluster and deduplicate saddles within min_spacing_km
    raw_saddles.sort(key=lambda item: item[1].km)
    saddles: List[MountainPass] = []
    if raw_saddles:
        clusters: List[List[Tuple[float, MountainPass]]] = []
        for item in raw_saddles:
            if not clusters:
                clusters.append([item])
            else:
                if item[1].km - clusters[-1][-1][1].km < min_spacing_km:
                    clusters[-1].append(item)
                else:
                    clusters.append([item])
        for cluster in clusters:
            best = max(cluster, key=lambda x: (x[0], x[1].elevation_m))[1]
            saddles.append(best)

    # Flag global route high point
    high_pt = track_points[global_max_idx]
    high_km = float(high_pt[3])
    high_pass = MountainPass(
        id="route-high-point",
        name=f"Route High Point (Mile {round(km_to_miles(high_km), 1)})",
        km=high_km,
        elevation_m=global_max_ele,
        elevation_ft=meters_to_feet(global_max_ele),
        coordinates=(float(high_pt[0]), float(high_pt[1])),
        state=default_state,
        difficulty="extreme",
        notes=f"Highest point on the entire route at {round(global_max_ele)}m ({round(meters_to_feet(global_max_ele))}ft).",
        is_high_point=True,
        is_iconic=True,
    )

    matched_existing = False
    for s in saddles:
        if abs(s.km - high_km) < max(1.0, min_spacing_km / 2):
            s.is_high_point = True
            s.is_iconic = True
            if s.name.startswith("Summit (Mile "):
                s.name = f"Route High Point (Mile {round(km_to_miles(s.km), 1)})"
            matched_existing = True
            break

    if not matched_existing:
        saddles.append(high_pass)

    saddles.sort(key=lambda p: p.km)
    return saddles


# -----------------------------------------------------------------------------
# Unified Pipeline API
# -----------------------------------------------------------------------------

def extract_mountain_passes(
    track_or_points: Any,
    road_network: Optional[Any] = None,
    corridor_geojson: Optional[Any] = None,
    prominence_m: float = 150.0,
    climbs: Optional[List[Climb]] = None,
    max_distance_m: float = 500.0,
    min_spacing_km: float = 15.0,
    default_state: str = "",
    curated_passes: Optional[List[MountainPass]] = None,
) -> List[MountainPass]:
    """
    Unified pass identification pipeline:
    1. If curated_passes are provided (or loaded from human-curated datasets), preserves
       them as authoritative and links them bidirectionally to detected climbs.
    2. Extracts OSM pass nodes from corridor GeoJSON / road network and projects onto track (<= 500m).
    3. Identifies landmark topographic saddles (>= prominence_m, default 150m, spaced >= min_spacing_km)
       and flags the global route high point.
    4. Merges spatial duplicates, preferring named OSM passes over generic summits within min_spacing_km.
    5. Bidirectionally links pass summits to corresponding climbs (pass_id <-> climb_id) and
       enriches generic summit names using authentic climb names when available.
    """
    pts = track_or_points.points if hasattr(track_or_points, "points") else track_or_points
    if not pts or len(pts) < 2:
        return []

    # 1. Curated pass override: preserve authentic hand-crafted passes
    if curated_passes:
        if climbs:
            for c in climbs:
                for p in curated_passes:
                    if abs(p.km - c.end_km) <= 1.5:
                        c.pass_id = p.id
                        p.climb_id = c.id
                        if p.is_iconic:
                            c.is_iconic = True
                        if c.is_iconic:
                            p.is_iconic = True
                        break
        return curated_passes

    # 2. Match OSM pass nodes
    osm_nodes: List[Dict[str, Any]] = []
    if corridor_geojson:
        osm_nodes = extract_osm_pass_nodes(corridor_geojson)

    matched_osm_passes = match_pass_nodes_to_track(
        osm_nodes, pts, max_distance_m=max_distance_m, default_state=default_state
    )

    # 3. Detect topographic saddles and high point with strict prominence and spacing
    topo_passes = detect_saddles_and_high_points(
        pts,
        min_prominence_m=prominence_m,
        min_spacing_km=min_spacing_km,
        default_state=default_state
    )

    # 4. Merge: prefer named OSM pass over generic saddle within min_spacing_km
    final_passes: List[MountainPass] = list(matched_osm_passes)

    for tp in topo_passes:
        nearby_osm = [op for op in matched_osm_passes if abs(op.km - tp.km) <= min_spacing_km]
        if not nearby_osm:
            final_passes.append(tp)
        elif tp.is_high_point:
            closest_osm = min(nearby_osm, key=lambda op: abs(op.km - tp.km))
            closest_osm.is_high_point = True
            closest_osm.is_iconic = True
            if not closest_osm.name.endswith("(Route High Point)"):
                closest_osm.name = f"{closest_osm.name} (Route High Point)"

    final_passes.sort(key=lambda p: p.km)

    # 5. Bidirectional linking with climbs & evocative naming
    if climbs:
        for c in climbs:
            for p in final_passes:
                if abs(p.km - c.end_km) <= 1.5:
                    c.pass_id = p.id
                    p.climb_id = c.id
                    if p.is_iconic:
                        c.is_iconic = True
                    if c.is_iconic:
                        p.is_iconic = True
                    # Evocatively enrich generic summit name if climb has an authentic name
                    if not c.name.startswith("Climb "):
                        if p.name.startswith("Summit (Mile "):
                            p.name = f"{c.name} Summit"
                        elif p.name.startswith("Route High Point (Mile "):
                            p.name = f"{c.name} Summit (Route High Point)"
                    break

    return final_passes

