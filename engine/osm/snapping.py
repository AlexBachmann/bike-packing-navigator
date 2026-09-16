"""
engine.osm.snapping - OpenStreetMap road and trail snapping with 50m threshold and off-road fallback.

Features:
1. Strict 50m snapping threshold: road candidates > 50.0m are strictly rejected.
2. Deterministic off-road fallback: backcountry sections (> 50m from mapped roads) strictly
   preserve original GPX coordinates, elevation, and distance without artificial spikes.
3. Bikepacking preference weighting: tracks, paths, and cycleways are prioritized over motor highways.
4. Bidirectional bearing deflection penalty (> 60 deg deflection penalized).
5. Topological continuity: Viterbi dynamic programming penalizes switching between disconnected parallel ways.
6. Look-ahead switchback bridging: bridges corner-cutting GPX chords across serpentine hairpin turns.
7. Telemetry monotonicity: strict deduplication, micro-step filtering, and cumulative distance calculation.
8. SnappedGuidanceTrack implementing the Python Sequence Protocol and full RouteTrack compatibility.
"""

from dataclasses import dataclass, field
import math
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple, Union

from engine.core.models import RoutePoint, RouteTrack
from engine.osm.network import CLASS_PENALTIES, OsmRoadNetwork, WayCandidate
from engine.utils.geo import (
    deflection_angle,
    dist_point_to_segment_m,
    haversine_distance_m,
    initial_bearing,
)
from engine.utils.spatial import BoundingBox
from engine.utils.units import km_to_miles


@dataclass(frozen=True)
class SnappingConfig:
    """Configuration parameters for OSM road snapping and off-road fallback."""
    threshold_m: float = 50.0                           # Snapping threshold (meters)
    densify_step_m: float = 40.0                       # Pre-densification step (meters)
    min_step_m: float = 1.5                            # Deduplication micro-step (meters)
    max_deflection_deg: float = 60.0                   # Deflection angle where penalty starts (degrees)
    bearing_penalty_per_deg: float = 0.5               # Penalty per degree > max_deflection_deg
    disconnected_penalty_m: float = 35.0               # Penalty for switching disconnected ways
    connected_penalty_m: float = 3.0                   # Penalty for switching connected ways
    fallback_bias: float = 8.0                         # Bias added to fallback when roads exist
    lookahead_points: int = 12                         # Look-ahead window for curve bridging
    lookahead_max_dist_m: float = 1800.0               # Max distance for look-ahead bridging

    # Property aliases for backward compatibility
    @property
    def max_dist_m(self) -> float:
        return self.threshold_m

    @property
    def switch_disconnected_penalty(self) -> float:
        return self.disconnected_penalty_m

    @property
    def switch_connected_penalty(self) -> float:
        return self.connected_penalty_m

    @property
    def bearing_deflection_threshold_deg(self) -> float:
        return self.max_deflection_deg


@dataclass
class CandidateProjection:
    """
    Represents a projected candidate on an OSM road segment or off-road fallback.
    Provides dictionary access for complete backward compatibility.
    """
    way_idx: int                    # Index of OSM way (-1 for fallback)
    seg_idx: int                    # Index of segment within way (-1 for fallback)
    t: float                        # Parametric position [0.0, 1.0] along segment
    proj_lat: float                 # Projected latitude in WGS84
    proj_lon: float                 # Projected longitude in WGS84
    dist_m: float                   # Geodesic perpendicular distance to segment
    eff_dist: float                 # Effective scored distance including penalties
    highway_class: str              # OSM highway class ('track', 'path', etc.)
    is_fallback: bool               # True if raw GPX off-road fallback candidate
    bearing_deflection_deg: float = 0.0
    tags: Dict[str, Any] = field(default_factory=dict)

    @property
    def eff_dist_m(self) -> float:
        return self.eff_dist

    @property
    def way_id(self) -> int:
        return self.way_idx

    # Dictionary access for legacy test compatibility
    def __getitem__(self, key: str) -> Any:
        if key in ("way_idx", "way_id"):
            return self.way_idx
        elif key == "seg_idx":
            return self.seg_idx
        elif key == "t":
            return self.t
        elif key == "proj_lat":
            return self.proj_lat
        elif key == "proj_lon":
            return self.proj_lon
        elif key == "dist_m":
            return self.dist_m
        elif key in ("eff_dist", "eff_dist_m"):
            return self.eff_dist
        elif key in ("class", "highway", "highway_class"):
            return self.highway_class
        elif key == "is_fallback":
            return self.is_fallback
        elif key == "bearing_deflection_deg":
            return self.bearing_deflection_deg
        elif key == "tags":
            return self.tags
        elif key in self.tags:
            return self.tags[key]
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key: str) -> bool:
        return key in (
            "way_idx", "way_id", "seg_idx", "t", "proj_lat", "proj_lon",
            "dist_m", "eff_dist", "eff_dist_m", "class", "highway",
            "highway_class", "is_fallback", "bearing_deflection_deg", "tags"
        ) or (key in self.tags)


@dataclass
class SnappedGuidanceTrack:
    """
    Complete road-snapped guidance line with telemetry.
    Implements the Python Sequence Protocol over RoutePoints and dictionary access
    for full compatibility with guidance-track.json schema.
    """
    points: List[RoutePoint]
    total_km: float
    total_miles: float
    snapped_points_count: int
    fallback_points_count: int
    bbox: Optional[BoundingBox] = None
    matched_candidates: List[CandidateProjection] = field(default_factory=list)
    track_points_with_km: List[Tuple[float, float, float, float]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.points)

    def __getitem__(self, idx: Any) -> Any:
        if isinstance(idx, str):
            if idx == "points":
                return [p.to_list_5d() for p in self.points]
            elif idx == "total_km":
                return self.total_km
            elif idx == "total_miles":
                return self.total_miles
            elif idx == "snapped_points_count":
                return self.snapped_points_count
            elif idx == "fallback_points_count":
                return self.fallback_points_count
            elif idx == "matched_candidates":
                return self.matched_candidates
            elif idx == "track_points_with_km":
                return self.track_points_with_km
            raise KeyError(idx)
        return self.points[idx]

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except (KeyError, TypeError):
            return default

    def __contains__(self, key: str) -> bool:
        return key in (
            "points", "total_km", "total_miles", "snapped_points_count",
            "fallback_points_count", "matched_candidates", "track_points_with_km"
        )

    def __iter__(self) -> Iterator[RoutePoint]:
        return iter(self.points)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to standard guidance-track.json schema expected by Angular frontend."""
        return {
            "total_km": round(self.total_km, 1),
            "total_miles": round(self.total_miles, 1),
            "points": [p.to_list_5d() for p in self.points]
        }

    def to_route_track(self, name: str = "") -> RouteTrack:
        """Convert to domain RouteTrack instance."""
        bbox = self.bbox or (
            BoundingBox.from_points([(p.lat, p.lon) for p in self.points])
            if self.points else BoundingBox(0.0, 0.0, 0.0, 0.0)
        )
        return RouteTrack(
            points=self.points,
            bbox=bbox,
            total_distance_km=self.total_km,
            total_distance_mi=self.total_miles,
            name=name
        )


def calculate_bearing_deflection(
    route_bearing: float,
    seg_bearing: float
) -> float:
    """
    Compute minimum angular deflection between route direction and bidirectional segment axis.

    Returns:
        Deflection angle in degrees in the range [0.0, 90.0].
    """
    b_fwd = seg_bearing
    b_rev = (seg_bearing + 180.0) % 360.0
    d1 = abs(deflection_angle(route_bearing, b_fwd))
    d2 = abs(deflection_angle(route_bearing, b_rev))
    return min(d1, d2)


def score_candidate(
    dist_m: float,
    highway_class: str,
    deflection_deg: float = 0.0,
    access: Optional[str] = None,
    config: Optional[SnappingConfig] = None
) -> float:
    """
    Compute effective penalized distance score for a candidate projection.
    """
    cfg = config or SnappingConfig()
    base_penalty = CLASS_PENALTIES.get(highway_class, 2.0)

    # Access penalty for private / forbidden ways
    access_penalty = 0.0
    if access in ("private", "no"):
        access_penalty = 30.0

    # Motorway penalty
    if highway_class in ("motorway", "motorway_link"):
        base_penalty = max(base_penalty, 15.0)

    # Bearing deflection penalty
    bearing_penalty = 0.0
    if deflection_deg > cfg.max_deflection_deg:
        bearing_penalty = (deflection_deg - cfg.max_deflection_deg) * cfg.bearing_penalty_per_deg

    return dist_m + base_penalty + access_penalty + bearing_penalty


def find_candidates_for_point(
    network: Any,
    lat: float,
    lon: float,
    threshold_m: float = 50.0,
    route_bearing: Optional[float] = None,
    config: Optional[SnappingConfig] = None
) -> List[CandidateProjection]:
    """
    Find road segment candidate projections within threshold_m.
    Strictly excludes candidates > threshold_m.
    Always appends an off-road fallback candidate.
    """
    cfg = config or SnappingConfig(threshold_m=threshold_m)
    thresh = cfg.threshold_m

    # If network has built-in find_candidates_for_point
    raw_cands = network.find_candidates_for_point(
        lat=lat,
        lon=lon,
        threshold_m=thresh,
        route_bearing=route_bearing
    )

    results: List[CandidateProjection] = []
    has_road_cands = False

    for c in raw_cands:
        is_fb = bool(c.get("is_fallback") if isinstance(c, dict) else getattr(c, "is_fallback", False))
        if not is_fb:
            has_road_cands = True
            d_m = float(c["dist_m"] if isinstance(c, dict) else c.dist_m)
            # Re-verify strict 50m threshold
            if d_m > thresh:
                continue

            w_idx = int(c["way_idx"] if isinstance(c, dict) else c.way_idx)
            s_idx = int(c["seg_idx"] if isinstance(c, dict) else c.seg_idx)
            t_val = float(c["t"] if isinstance(c, dict) else c.t)
            p_lat = float(c["proj_lat"] if isinstance(c, dict) else c.proj_lat)
            p_lon = float(c["proj_lon"] if isinstance(c, dict) else c.proj_lon)
            hw_class = str(c.get("class") or c.get("highway") if isinstance(c, dict) else c.highway)
            defl = float(c.get("bearing_deflection_deg", 0.0) if isinstance(c, dict) else getattr(c, "bearing_deflection_deg", 0.0))
            eff_d = float(c["eff_dist"] if isinstance(c, dict) else c.eff_dist_m)

            results.append(CandidateProjection(
                way_idx=w_idx,
                seg_idx=s_idx,
                t=t_val,
                proj_lat=p_lat,
                proj_lon=p_lon,
                dist_m=d_m,
                eff_dist=eff_d,
                highway_class=hw_class,
                is_fallback=False,
                bearing_deflection_deg=defl
            ))

    # Sort road candidates by eff_dist
    results.sort(key=lambda x: x.eff_dist)

    # Fallback candidate
    if not results:
        # Pure backcountry: eff_dist = 0.0
        results.append(CandidateProjection(
            way_idx=-1,
            seg_idx=-1,
            t=0.0,
            proj_lat=lat,
            proj_lon=lon,
            dist_m=0.0,
            eff_dist=0.0,
            highway_class="fallback",
            is_fallback=True
        ))
    else:
        # Near-road alternative fallback
        results.append(CandidateProjection(
            way_idx=-1,
            seg_idx=-1,
            t=0.0,
            proj_lat=lat,
            proj_lon=lon,
            dist_m=0.0,
            eff_dist=thresh + cfg.fallback_bias,
            highway_class="fallback",
            is_fallback=True
        ))

    return results


def compute_transition_cost(
    c1: Union[CandidateProjection, Dict[str, Any]],
    c2: Union[CandidateProjection, Dict[str, Any]],
    gpx_dist_m: float,
    network: Any,
    p1: Optional[Sequence[float]] = None,
    p2: Optional[Sequence[float]] = None,
    config: Optional[SnappingConfig] = None
) -> float:
    """
    Compute Viterbi transition cost between candidate c1 and c2.
    Penalizes switching parallel disconnected ways, jumping off/on road, and backtracking.
    """
    cfg = config or SnappingConfig()

    fb1 = bool(c1["is_fallback"] if isinstance(c1, dict) else c1.is_fallback)
    fb2 = bool(c2["is_fallback"] if isinstance(c2, dict) else c2.is_fallback)

    # 1. Both are fallback points
    if fb1 and fb2:
        return 0.0

    lat1 = float(c1["proj_lat"] if isinstance(c1, dict) else c1.proj_lat)
    lon1 = float(c1["proj_lon"] if isinstance(c1, dict) else c1.proj_lon)
    lat2 = float(c2["proj_lat"] if isinstance(c2, dict) else c2.proj_lat)
    lon2 = float(c2["proj_lon"] if isinstance(c2, dict) else c2.proj_lon)
    direct_dist = haversine_distance_m(lat1, lon1, lat2, lon2)

    # 2. Transition between fallback and road
    if fb1 or fb2:
        return abs(direct_dist - gpx_dist_m) * 0.4 + 10.0

    w1 = int(c1["way_idx"] if isinstance(c1, dict) else c1.way_idx)
    w2 = int(c2["way_idx"] if isinstance(c2, dict) else c2.way_idx)

    # 3. Both are on the SAME way
    if w1 == w2:
        along_dist = direct_dist
        if w1 < len(network.ways):
            coords = network.ways[w1].coords
            s1 = float(c1["seg_idx"] if isinstance(c1, dict) else c1.seg_idx) + float(c1["t"] if isinstance(c1, dict) else c1.t)
            s2 = float(c2["seg_idx"] if isinstance(c2, dict) else c2.seg_idx) + float(c2["t"] if isinstance(c2, dict) else c2.t)

            start_c, end_c = (c1, c2) if s2 >= s1 else (c2, c1)
            s_start_idx = int(start_c["seg_idx"] if isinstance(start_c, dict) else start_c.seg_idx)
            s_end_idx = int(end_c["seg_idx"] if isinstance(end_c, dict) else end_c.seg_idx)

            along_dist = 0.0
            curr_lat = float(start_c["proj_lat"] if isinstance(start_c, dict) else start_c.proj_lat)
            curr_lon = float(start_c["proj_lon"] if isinstance(start_c, dict) else start_c.proj_lon)
            end_lat = float(end_c["proj_lat"] if isinstance(end_c, dict) else end_c.proj_lat)
            end_lon = float(end_c["proj_lon"] if isinstance(end_c, dict) else end_c.proj_lon)

            for seg in range(s_start_idx, s_end_idx):
                if seg + 1 < len(coords):
                    next_lat, next_lon = coords[seg + 1]
                    along_dist += haversine_distance_m(curr_lat, curr_lon, next_lat, next_lon)
                    curr_lat, curr_lon = next_lat, next_lon
            along_dist += haversine_distance_m(curr_lat, curr_lon, end_lat, end_lon)

        # Backtrack penalty check
        backtrack_penalty = 0.0
        if p1 is not None and p2 is not None and len(p1) >= 2 and len(p2) >= 2:
            vec_gpx_lat = p2[0] - p1[0]
            vec_gpx_lon = p2[1] - p1[1]
            vec_cand_lat = lat2 - lat1
            vec_cand_lon = lon2 - lon1
            dot = vec_gpx_lat * vec_cand_lat + vec_gpx_lon * vec_cand_lon
            if dot < 0.0 and direct_dist > 5.0:
                backtrack_penalty = 25.0 + 2.0 * direct_dist

        return abs(along_dist - gpx_dist_m) * 0.2 + backtrack_penalty

    # 4. Different ways: evaluate connection via shortest path
    trans_dist = direct_dist
    w_path = network.find_way_path(w1, w2, max_hops=4, max_distance_m=max(800.0, gpx_dist_m * 2.5))
    if w_path is not None:
        pts = network.extract_path_geometry(w_path, c1, c2, include_start=True)
        path_len = sum(
            haversine_distance_m(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1])
            for k in range(len(pts) - 1)
        )
        return abs(path_len - gpx_dist_m) * 0.2 + cfg.connected_penalty_m
    else:
        # Disconnected ways: apply fixed switching penalty plus progression discrepancy penalty
        return cfg.disconnected_penalty_m + abs(trans_dist - gpx_dist_m) * 0.5


def _viterbi_snapping(
    points: List[Tuple[float, float, float]],
    network: Any,
    config: SnappingConfig
) -> List[CandidateProjection]:
    """
    Viterbi dynamic programming solver finding the optimal candidate sequence.
    """
    n = len(points)
    if n == 0:
        return []
    if n == 1:
        cands = find_candidates_for_point(network, points[0][0], points[0][1], config=config)
        return [cands[0]]

    # Compute route bearings
    bearings: List[float] = []
    for i in range(n):
        if i < n - 1:
            bearings.append(initial_bearing(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]))
        else:
            bearings.append(initial_bearing(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]))

    # Step 0 candidates
    step_candidates: List[List[CandidateProjection]] = []
    for i in range(n):
        cands = find_candidates_for_point(
            network=network,
            lat=points[i][0],
            lon=points[i][1],
            threshold_m=config.threshold_m,
            route_bearing=bearings[i],
            config=config
        )
        step_candidates.append(cands)

    # Initialize Viterbi trellis: costs[cand_idx]
    viterbi_costs: List[float] = [c.eff_dist for c in step_candidates[0]]
    backpointers: List[List[int]] = []

    for i in range(1, n):
        curr_cands = step_candidates[i]
        prev_cands = step_candidates[i - 1]
        gpx_dist = haversine_distance_m(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])

        new_costs: List[float] = []
        new_backpointers: List[int] = []

        for c_curr in curr_cands:
            min_cost = float("inf")
            best_prev_idx = 0
            for prev_idx, c_prev in enumerate(prev_cands):
                trans_cost = compute_transition_cost(
                    c1=c_prev,
                    c2=c_curr,
                    gpx_dist_m=gpx_dist,
                    network=network,
                    p1=points[i - 1],
                    p2=points[i],
                    config=config
                )
                total_cost = viterbi_costs[prev_idx] + trans_cost + c_curr.eff_dist
                if total_cost < min_cost:
                    min_cost = total_cost
                    best_prev_idx = prev_idx

            new_costs.append(min_cost)
            new_backpointers.append(best_prev_idx)

        viterbi_costs = new_costs
        backpointers.append(new_backpointers)

    # Backtrack
    best_cand_idx = int(min(range(len(viterbi_costs)), key=lambda idx: viterbi_costs[idx]))
    chosen: List[CandidateProjection] = [step_candidates[-1][best_cand_idx]]

    for i in range(n - 2, -1, -1):
        best_cand_idx = backpointers[i][best_cand_idx]
        chosen.append(step_candidates[i][best_cand_idx])

    chosen.reverse()
    return chosen


def _parse_input_points(
    route: Union[RouteTrack, Sequence[Union[RoutePoint, Sequence[float]]], Dict[str, Any]]
) -> List[Tuple[float, float, float, float]]:
    """
    Extract (lat, lon, ele, cum_km) tuples from various route formats.
    """
    raw_points: List[Tuple[float, float, float, float]] = []
    if isinstance(route, RouteTrack):
        for p in route.points:
            raw_points.append((p.lat, p.lon, p.ele, p.cum_km))
    elif isinstance(route, dict):
        for p in route.get("points", []):
            lat = float(p[0])
            lon = float(p[1])
            ele = float(p[2]) if len(p) > 2 else 0.0
            km = float(p[3]) if len(p) > 3 else 0.0
            raw_points.append((lat, lon, ele, km))
    elif isinstance(route, (list, tuple)):
        for p in route:
            if isinstance(p, RoutePoint):
                raw_points.append((p.lat, p.lon, p.ele, p.cum_km))
            elif isinstance(p, (list, tuple)):
                lat = float(p[0])
                lon = float(p[1])
                ele = float(p[2]) if len(p) > 2 else 0.0
                km = float(p[3]) if len(p) > 3 else 0.0
                raw_points.append((lat, lon, ele, km))

    # If distances were not populated (e.g. all 0.0), compute monotonic cumulative km
    if len(raw_points) > 1 and all(p[3] == 0.0 for p in raw_points[1:]):
        cum = 0.0
        computed = [raw_points[0]]
        for i in range(1, len(raw_points)):
            step_km = haversine_distance_m(raw_points[i - 1][0], raw_points[i - 1][1], raw_points[i][0], raw_points[i][1]) / 1000.0
            cum += step_km
            p = raw_points[i]
            computed.append((p[0], p[1], p[2], round(cum, 4)))
        raw_points = computed

    return raw_points


def _predensify_track(
    points: List[Tuple[float, float, float, float]],
    max_step_m: float = 40.0
) -> List[Tuple[float, float, float, float]]:
    """
    Subdivide long segments in track points exceeding max_step_m.
    Interpolates coordinates, elevation, and cumulative distance.
    """
    if len(points) < 2:
        return list(points)

    densified: List[Tuple[float, float, float, float]] = [points[0]]
    for i in range(1, len(points)):
        p1 = points[i - 1]
        p2 = points[i]
        d = haversine_distance_m(p1[0], p1[1], p2[0], p2[1])
        if d > max_step_m:
            steps = int(math.ceil(d / max_step_m))
            for s in range(1, steps):
                frac = s / steps
                lat = p1[0] + frac * (p2[0] - p1[0])
                lon = p1[1] + frac * (p2[1] - p1[1])
                ele = p1[2] + frac * (p2[2] - p1[2])
                km = p1[3] + frac * (p2[3] - p1[3])
                densified.append((lat, lon, ele, km))
        densified.append(p2)
    return densified


def snap_track_to_osm(
    route: Union[RouteTrack, Sequence[Union[RoutePoint, Sequence[float]]], Dict[str, Any]],
    network_or_pmtiles: Union[Any, Path, str],
    config: Optional[SnappingConfig] = None,
    threshold_m: float = 50.0,
    max_dist_m: Optional[float] = None
) -> SnappedGuidanceTrack:
    """
    Master OSM road snapping pipeline.
    Snaps route coordinates to OSM road network centerlines within threshold_m,
    falling back cleanly to raw GPX points for backcountry (> threshold_m).
    """
    thresh = max_dist_m if max_dist_m is not None else threshold_m
    cfg = config or SnappingConfig(threshold_m=thresh)

    raw_points = _parse_input_points(route)
    if not raw_points:
        return SnappedGuidanceTrack(
            points=[],
            total_km=0.0,
            total_miles=0.0,
            snapped_points_count=0,
            fallback_points_count=0,
            bbox=BoundingBox(0.0, 0.0, 0.0, 0.0),
            matched_candidates=[],
            track_points_with_km=[]
        )

    if len(raw_points) == 1:
        p0 = raw_points[0]
        pt = RoutePoint(lat=p0[0], lon=p0[1], ele=p0[2], cum_km=p0[3], cum_mi=km_to_miles(p0[3]))
        return SnappedGuidanceTrack(
            points=[pt],
            total_km=0.0,
            total_miles=0.0,
            snapped_points_count=0,
            fallback_points_count=1,
            bbox=BoundingBox(p0[0], p0[1], p0[0], p0[1]),
            matched_candidates=[],
            track_points_with_km=[p0]
        )

    # Initialize or verify network
    if isinstance(network_or_pmtiles, (Path, str, list, tuple, set)):
        network = OsmRoadNetwork(cell_size_deg=0.005)
        network.load_from_pmtiles(pmtiles_path=network_or_pmtiles, track_points=raw_points, threshold_m=cfg.threshold_m)
    else:
        network = network_or_pmtiles

    # Pre-densify if segments exceed densify_step_m
    track_pts = _predensify_track(raw_points, max_step_m=cfg.densify_step_m)

    # Execute Viterbi optimal path search
    chosen_cands = _viterbi_snapping(track_pts, network, cfg)

    # Reconstruct guidance line with intermediate curve vertices
    raw_guidance_coords: List[Tuple[float, float, float, bool]] = []
    idx = 0
    num_pts = len(track_pts)

    while idx < num_pts:
        curr_c = chosen_cands[idx]
        curr_raw = track_pts[idx]

        if idx == 0:
            raw_guidance_coords.append((curr_c.proj_lat, curr_c.proj_lon, curr_raw[2], curr_c.is_fallback))
            idx += 1
            continue

        prev_c = chosen_cands[idx - 1]
        prev_raw = track_pts[idx - 1]

        # 1. Look-ahead switchback bridging check
        if curr_c.is_fallback and not prev_c.is_fallback:
            lookahead_idx = idx
            rejoined_idx: Optional[int] = None
            gpx_accum_dist = 0.0

            while lookahead_idx < min(num_pts, idx + cfg.lookahead_points):
                gpx_step = haversine_distance_m(
                    track_pts[lookahead_idx - 1][0], track_pts[lookahead_idx - 1][1],
                    track_pts[lookahead_idx][0], track_pts[lookahead_idx][1]
                )
                gpx_accum_dist += gpx_step
                if gpx_accum_dist > cfg.lookahead_max_dist_m:
                    break

                if not chosen_cands[lookahead_idx].is_fallback:
                    rejoined_idx = lookahead_idx
                    break
                lookahead_idx += 1

            if rejoined_idx is not None:
                next_road_cand = chosen_cands[rejoined_idx]
                w_start = prev_c.way_idx
                w_end = next_road_cand.way_idx

                # Check if road network connects these points
                path = network.find_way_path(w_start, w_end, max_hops=10, max_distance_m=cfg.lookahead_max_dist_m)
                if path:
                    road_geom = network.extract_path_geometry(
                        way_ids=path,
                        start_point=prev_c,
                        end_point=next_road_cand,
                        include_start=False
                    )
                    if road_geom:
                        p_len = sum(
                            haversine_distance_m(road_geom[m][0], road_geom[m][1], road_geom[m + 1][0], road_geom[m + 1][1])
                            for m in range(len(road_geom) - 1)
                        )
                        if p_len <= max(3.0 * gpx_accum_dist, gpx_accum_dist + 600.0):
                            ele_start = prev_raw[2]
                            ele_end = track_pts[rejoined_idx][2]
                            total_g_steps = len(road_geom)
                            for g_i, (g_lat, g_lon) in enumerate(road_geom, start=1):
                                g_ele = ele_start + (g_i / total_g_steps) * (ele_end - ele_start)
                                raw_guidance_coords.append((g_lat, g_lon, g_ele, False))
                            idx = rejoined_idx + 1
                            continue

        # 2. Standard on-road traversal: check curve vertices along connected ways
        if not curr_c.is_fallback and not prev_c.is_fallback:
            gpx_d = haversine_distance_m(prev_raw[0], prev_raw[1], curr_raw[0], curr_raw[1])
            w_path = network.find_way_path(prev_c.way_idx, curr_c.way_idx, max_hops=4, max_distance_m=max(800.0, gpx_d * 2.5))
            if w_path is not None:
                step_pts = network.extract_path_geometry(w_path, prev_c, curr_c, include_start=False)
                ele_start = prev_raw[2]
                ele_end = curr_raw[2]
                total_s = len(step_pts)
                for s_i, (s_lat, s_lon) in enumerate(step_pts, start=1):
                    s_ele = ele_start + (s_i / total_s) * (ele_end - ele_start)
                    raw_guidance_coords.append((s_lat, s_lon, s_ele, False))
                idx += 1
                continue

        raw_guidance_coords.append((curr_c.proj_lat, curr_c.proj_lon, curr_raw[2], curr_c.is_fallback))
        idx += 1

    # Telemetry deduplication and strictly monotonic cumulative distances
    final_points: List[RoutePoint] = []
    cum_km = 0.0
    snapped_count = 0
    fallback_count = 0

    for lat, lon, ele, is_fb in raw_guidance_coords:
        lat_r = round(lat, 6)
        lon_r = round(lon, 6)
        ele_r = round(ele, 1)

        if not final_points:
            pt = RoutePoint(lat=lat_r, lon=lon_r, ele=ele_r, cum_km=0.0, cum_mi=0.0)
            final_points.append(pt)
            if is_fb:
                fallback_count += 1
            else:
                snapped_count += 1
            continue

        last_pt = final_points[-1]
        step_m = haversine_distance_m(last_pt.lat, last_pt.lon, lat_r, lon_r)

        # Micro-step deduplication
        if step_m < cfg.min_step_m or (lat_r == last_pt.lat and lon_r == last_pt.lon):
            continue

        cum_km += step_m / 1000.0
        cum_mi = km_to_miles(cum_km)

        pt = RoutePoint(
            lat=lat_r,
            lon=lon_r,
            ele=ele_r,
            cum_km=round(cum_km, 3),
            cum_mi=round(cum_mi, 3)
        )
        final_points.append(pt)
        if is_fb:
            fallback_count += 1
        else:
            snapped_count += 1

    total_km = round(cum_km, 1)
    total_mi = round(km_to_miles(cum_km), 1)
    bbox = BoundingBox.from_points([(p.lat, p.lon) for p in final_points])

    return SnappedGuidanceTrack(
        points=final_points,
        total_km=total_km,
        total_miles=total_mi,
        snapped_points_count=snapped_count,
        fallback_points_count=fallback_count,
        bbox=bbox,
        matched_candidates=chosen_cands,
        track_points_with_km=track_pts
    )
