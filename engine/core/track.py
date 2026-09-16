"""
engine.core.track - Route telemetry, elevation smoothing, and spatial track operations.

Provides:
- TrackTelemetry and ProjectionResult dataclasses.
- build_track_points: transforms raw coordinates into dense RoutePoints with cumulative distance.
- smooth_elevations: moving average and zero-phase EMA low-pass filter.
- calculate_elevation_gain_loss: 3-state Peak-Valley Reversal Hysteresis Filter.
- compute_track_telemetry: full route telemetry summary.
- calculate_point_grades / calculate_segment_grade: windowed slope and gradient calculations.
- compute_track_bounding_box: Leaflet/GeoJSON bounding box calculator.
- slice_track_by_km: sub-track segment extraction with boundary interpolation.
- find_nearest_track_point / project_point_to_track_segment: discrete vertex and continuous segment projection.
- sample_elevation_profile: equidistant profile sampling for visualization.
"""

from dataclasses import dataclass
from datetime import timedelta
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.core.models import RoutePoint
from engine.utils.geo import (
    haversine_distance,
    haversine_distance_m,
    dist_point_to_segment_m,
)
from engine.utils.spatial import BoundingBox, TrackIndex
from engine.utils.units import (
    calculate_grade,
    km_to_miles,
    meters_to_feet,
)


@dataclass(frozen=True)
class TrackTelemetry:
    """Summary telemetry statistics for a route track."""
    total_km: float
    total_miles: float
    elevation_gain_m: int
    elevation_gain_ft: int
    elevation_loss_m: int
    elevation_loss_ft: int
    highest_elevation_m: int
    highest_elevation_ft: int
    lowest_elevation_m: int
    lowest_elevation_ft: int
    highest_coords: Tuple[float, float]
    lowest_coords: Tuple[float, float]
    start_coordinates: Tuple[float, float]
    end_coordinates: Tuple[float, float]
    bounds: List[List[float]]  # Leaflet [[south, west], [north, east]]
    point_count: int

    def to_dict(self) -> Dict[str, Any]:
        """Convert telemetry to standard stats dictionary for manifest registration."""
        return {
            "total_km": round(self.total_km, 1),
            "total_miles": round(self.total_miles, 1),
            "elevation_gain_m": self.elevation_gain_m,
            "elevation_gain_ft": self.elevation_gain_ft,
            "elevation_loss_m": self.elevation_loss_m,
            "elevation_loss_ft": self.elevation_loss_ft,
            "highest_elevation_m": self.highest_elevation_m,
            "highest_elevation_ft": self.highest_elevation_ft,
            "lowest_elevation_m": self.lowest_elevation_m,
            "lowest_elevation_ft": self.lowest_elevation_ft,
            "highest_coords": [round(self.highest_coords[0], 5), round(self.highest_coords[1], 5)],
            "lowest_coords": [round(self.lowest_coords[0], 5), round(self.lowest_coords[1], 5)],
            "start_coordinates": [round(self.start_coordinates[0], 5), round(self.start_coordinates[1], 5)],
            "end_coordinates": [round(self.end_coordinates[0], 5), round(self.end_coordinates[1], 5)],
            "bounds": self.bounds,
            "point_count": self.point_count,
        }


@dataclass(frozen=True)
class ProjectionResult:
    """Result of projecting an arbitrary coordinate onto a route track."""
    distance_m: float           # Lateral distance from point to trail in meters
    projected_lat: float        # Snapped latitude on trail
    projected_lon: float        # Snapped longitude on trail
    cumulative_km: float        # Route kilometer at projection point
    cumulative_miles: float     # Route miles at projection point
    segment_index: int          # Index of track segment [i, i+1]


def build_track_points(
    raw_coords: Sequence[Any]
) -> List[RoutePoint]:
    """
    Transform raw (lat, lon, ele) coordinates into dense RoutePoints with cumulative distances.

    Calculates great-circle distance between consecutive points using
    engine.utils.geo.haversine_distance and converts to statute miles via
    engine.utils.units.km_to_miles.

    Args:
        raw_coords: Sequence of [lat, lon, ele], (lat, lon, ele), or RoutePoint.

    Returns:
        List of RoutePoint with cumulative km and miles.

    Raises:
        ValueError: If raw_coords is empty.
    """
    if not raw_coords:
        raise ValueError("raw_coords sequence must not be empty")

    points: List[RoutePoint] = []
    cum_km = 0.0

    first = raw_coords[0]
    lat0 = float(first[0] if isinstance(first, (list, tuple, RoutePoint)) else first.lat)
    lon0 = float(first[1] if isinstance(first, (list, tuple, RoutePoint)) else first.lon)
    ele0 = float(first[2] if len(first) > 2 else getattr(first, "ele", 0.0))
    time0 = getattr(first, "time", None)

    points.append(RoutePoint(
        lat=round(lat0, 6),
        lon=round(lon0, 6),
        ele=round(ele0, 1),
        cum_km=0.0,
        cum_mi=0.0,
        time=time0
    ))

    for i in range(1, len(raw_coords)):
        item = raw_coords[i]
        lat = float(item[0] if isinstance(item, (list, tuple, RoutePoint)) else item.lat)
        lon = float(item[1] if isinstance(item, (list, tuple, RoutePoint)) else item.lon)
        ele = float(item[2] if len(item) > 2 else getattr(item, "ele", 0.0))
        time = getattr(item, "time", None)

        prev_pt = points[-1]
        seg_dist_km = haversine_distance(prev_pt.lat, prev_pt.lon, lat, lon)
        cum_km += seg_dist_km
        cum_mi = km_to_miles(cum_km)

        points.append(RoutePoint(
            lat=round(lat, 6),
            lon=round(lon, 6),
            ele=round(ele, 1),
            cum_km=round(cum_km, 3),
            cum_mi=round(cum_mi, 3),
            time=time
        ))

    return points


def smooth_elevations(
    elevations: Sequence[float],
    window_size: int = 5,
    method: str = "centered_moving_average"
) -> List[float]:
    """
    Apply low-pass filter to smooth elevation data and reduce high-frequency GPS noise.

    Supported methods:
        - "centered_moving_average" (or "ma"): Zero-phase centered rolling average.
        - "exponential_moving_average" (or "ema"): Bi-directional (forward-backward) EMA.

    Args:
        elevations: Sequence of elevation values in meters.
        window_size: Size of smoothing window in points (must be >= 1).
        method: Smoothing method name.

    Returns:
        List of smoothed elevation values with identical length to input.
    """
    if window_size < 1:
        raise ValueError(f"window_size must be >= 1, got {window_size}")

    n = len(elevations)
    if n < 2 or window_size == 1:
        return [float(e) for e in elevations]

    norm_method = method.lower().strip()
    if norm_method in ("centered_moving_average", "ma", "moving_average"):
        smoothed: List[float] = []
        half = window_size // 2
        for i in range(n):
            st = max(0, i - half)
            en = min(n, i + half + 1)
            window_slice = elevations[st:en]
            smoothed.append(sum(window_slice) / len(window_slice))
        return smoothed
    elif norm_method in ("exponential_moving_average", "ema"):
        # Zero-phase bidirectional EMA
        alpha = 2.0 / (window_size + 1.0)
        # Forward pass
        forward = [float(elevations[0])]
        for i in range(1, n):
            forward.append(alpha * float(elevations[i]) + (1.0 - alpha) * forward[-1])
        # Backward pass
        backward = [0.0] * n
        backward[-1] = forward[-1]
        for i in range(n - 2, -1, -1):
            backward[i] = alpha * forward[i] + (1.0 - alpha) * backward[i + 1]
        return backward
    else:
        raise ValueError(f"Unknown smoothing method: {method}")


def calculate_elevation_gain_loss(
    elevations: Sequence[float],
    threshold_m: float = 3.0,
    smooth_window: int = 0
) -> Tuple[float, float]:
    """
    Compute cumulative elevation gain and loss using a Peak-Valley Reversal Hysteresis Filter.

    Eliminates high-frequency GPS elevation flutter (< threshold_m) while preserving
    genuine climbing and descending terrain. Satisfies the net elevation conservation
    invariant for relief changes exceeding threshold_m.

    Args:
        elevations: Sequence of elevation values in meters.
        threshold_m: Minimum vertical reversal threshold in meters (default 3.0m).
                     Changes smaller than this threshold do not trigger direction reversals.
        smooth_window: Optional moving average pre-filter window size. 0 disables pre-filtering.

    Returns:
        (gain_m, loss_m): Total elevation gain and total elevation loss in meters.
    """
    if len(elevations) < 2:
        return (0.0, 0.0)

    if smooth_window > 0:
        elevations = smooth_elevations(elevations, window_size=smooth_window)

    cur_min = cur_max = float(elevations[0])
    trend = 0  # 0: undetermined, +1: ascending, -1: descending
    total_gain = 0.0
    total_loss = 0.0

    for e in (float(x) for x in elevations[1:]):
        if trend == 0:
            if e > cur_min + threshold_m:
                trend = 1
                cur_max = e
            elif e < cur_max - threshold_m:
                trend = -1
                cur_min = e
            else:
                cur_min = min(cur_min, e)
                cur_max = max(cur_max, e)
        elif trend == 1:
            if e > cur_max:
                cur_max = e
            elif e < cur_max - threshold_m:
                # Direction reversal: ascent ended at cur_max
                total_gain += (cur_max - cur_min)
                trend = -1
                cur_min = e
        elif trend == -1:
            if e < cur_min:
                cur_min = e
            elif e > cur_min + threshold_m:
                # Direction reversal: descent ended at cur_min
                total_loss += (cur_max - cur_min)
                trend = 1
                cur_max = e

    # Flush final pending leg
    if trend == 1:
        total_gain += (cur_max - cur_min)
    elif trend == -1:
        total_loss += (cur_max - cur_min)

    return (round(total_gain, 1), round(total_loss, 1))


def compute_track_telemetry(
    points: Sequence[Any],
    threshold_m: float = 3.0,
    smooth_window: int = 0
) -> TrackTelemetry:
    """
    Compute full route telemetry statistics for a dense track.

    Args:
        points: Sequence of [lat, lon, ele, cum_km, cum_mi] points.
        threshold_m: Hysteresis threshold for elevation gain/loss in meters.
        smooth_window: Optional moving average pre-filter window size.

    Returns:
        TrackTelemetry instance with complete telemetry statistics.

    Raises:
        ValueError: If points sequence is empty.
    """
    if not points:
        raise ValueError("points sequence must not be empty")

    first_pt = points[0]
    last_pt = points[-1]

    total_km = float(last_pt[3]) if len(last_pt) > 3 else 0.0
    total_miles = float(last_pt[4]) if len(last_pt) > 4 else km_to_miles(total_km)

    elevations = [float(p[2] if len(p) > 2 else 0.0) for p in points]
    gain_m, loss_m = calculate_elevation_gain_loss(
        elevations,
        threshold_m=threshold_m,
        smooth_window=smooth_window
    )

    highest_pt = max(points, key=lambda p: float(p[2] if len(p) > 2 else 0.0))
    lowest_pt = min(points, key=lambda p: float(p[2] if len(p) > 2 else 0.0))

    highest_ele_m = round(float(highest_pt[2] if len(highest_pt) > 2 else 0.0))
    lowest_ele_m = round(float(lowest_pt[2] if len(lowest_pt) > 2 else 0.0))

    bbox = compute_track_bounding_box(points)

    return TrackTelemetry(
        total_km=round(total_km, 1),
        total_miles=round(total_miles, 1),
        elevation_gain_m=round(gain_m),
        elevation_gain_ft=round(meters_to_feet(gain_m)),
        elevation_loss_m=round(loss_m),
        elevation_loss_ft=round(meters_to_feet(loss_m)),
        highest_elevation_m=highest_ele_m,
        highest_elevation_ft=round(meters_to_feet(highest_ele_m)),
        lowest_elevation_m=lowest_ele_m,
        lowest_elevation_ft=round(meters_to_feet(lowest_ele_m)),
        highest_coords=(float(highest_pt[0]), float(highest_pt[1])),
        lowest_coords=(float(lowest_pt[0]), float(lowest_pt[1])),
        start_coordinates=(float(first_pt[0]), float(first_pt[1])),
        end_coordinates=(float(last_pt[0]), float(last_pt[1])),
        bounds=bbox.to_leaflet(),
        point_count=len(points)
    )


def calculate_point_grades(
    points: Sequence[Any],
    window_m: float = 50.0
) -> List[float]:
    """
    Calculate local elevation grade percentage for each point along the track.

    Uses a centered spatial window of approximately window_m meters.
    Grade is clamped to [-50.0, +50.0]%.

    Args:
        points: Sequence of [lat, lon, ele, cum_km, cum_mi] points.
        window_m: Spatial distance window in meters for grade calculation.

    Returns:
        List of grade percentages matching points length.
    """
    n = len(points)
    if n == 0:
        return []
    if n == 1:
        return [0.0]

    half_window_km = (window_m / 2.0) / 1000.0
    grades: List[float] = []

    for i in range(n):
        cur_km = float(points[i][3])
        target_start_km = max(0.0, cur_km - half_window_km)
        target_end_km = cur_km + half_window_km

        # Find window start
        st = i
        while st > 0 and float(points[st][3]) > target_start_km:
            st -= 1

        # Find window end
        en = i
        while en < n - 1 and float(points[en][3]) < target_end_km:
            en += 1

        if st == en:
            if en < n - 1:
                en += 1
            elif st > 0:
                st -= 1

        dist_m = (float(points[en][3]) - float(points[st][3])) * 1000.0
        rise_m = float(points[en][2]) - float(points[st][2])

        if dist_m > 1e-3:
            raw_grade = (rise_m / dist_m) * 100.0
            clamped = max(-50.0, min(50.0, raw_grade))
            grades.append(round(clamped, 1))
        else:
            grades.append(0.0)

    return grades


def calculate_segment_grade(
    start_ele_m: float,
    end_ele_m: float,
    length_m: float
) -> float:
    """Calculate average grade percentage for a track segment."""
    rise_m = end_ele_m - start_ele_m
    return calculate_grade(rise_m, length_m)


def compute_track_bounding_box(
    points: Sequence[Any]
) -> BoundingBox:
    """Compute geographic BoundingBox enclosing all points of the track."""
    if not points:
        raise ValueError("points sequence must not be empty")
    coords = [(float(p[0]), float(p[1])) for p in points]
    return BoundingBox.from_points(coords)


def slice_track_by_km(
    points: Sequence[Any],
    start_km: float,
    end_km: float,
    reset_distance: bool = False
) -> List[RoutePoint]:
    """
    Extract a sub-track segment between start_km and end_km with boundary interpolation.

    If start_km or end_km fall between discrete points, new interpolated boundary points
    are synthesized so the sliced track begins and ends exactly at the specified kilometers.

    Args:
        points: Dense track points [lat, lon, ele, cum_km, cum_mi].
        start_km: Starting kilometer of the slice (must be >= 0.0).
        end_km: Ending kilometer of the slice (must be > start_km).
        reset_distance: If True, shifts cumulative kilometers and miles so the slice starts at 0.0.

    Returns:
        Sliced list of RoutePoint.

    Raises:
        ValueError: If start_km >= end_km, start_km < 0, or points is empty.
    """
    if not points:
        raise ValueError("points sequence must not be empty")
    if start_km < 0.0:
        raise ValueError(f"start_km must be >= 0.0, got {start_km}")
    if start_km >= end_km:
        raise ValueError(f"start_km ({start_km}) must be strictly less than end_km ({end_km})")

    total_track_km = float(points[-1][3])
    if start_km >= total_track_km:
        raise ValueError(f"start_km ({start_km}) exceeds total track distance ({total_track_km})")

    end_km = min(end_km, total_track_km)

    def interpolate_at_km(p1: Any, p2: Any, target_km: float) -> RoutePoint:
        km1 = float(p1[3])
        km2 = float(p2[3])
        if abs(km2 - km1) < 1e-9:
            t = 0.0
        else:
            t = (target_km - km1) / (km2 - km1)
            t = max(0.0, min(1.0, t))

        lat1, lon1, ele1 = float(p1[0]), float(p1[1]), float(p1[2])
        lat2, lon2, ele2 = float(p2[0]), float(p2[1]), float(p2[2])

        dlon = ((lon2 - lon1 + 180.0) % 360.0) - 180.0
        proj_lat = lat1 + t * (lat2 - lat1)
        proj_lon = ((lon1 + t * dlon + 180.0) % 360.0) - 180.0
        proj_ele = ele1 + t * (ele2 - ele1)

        t1 = getattr(p1, "time", None)
        t2 = getattr(p2, "time", None)
        proj_time = None
        if t1 is not None and t2 is not None:
            dt = (t2 - t1).total_seconds()
            proj_time = t1 + timedelta(seconds=t * dt)

        return RoutePoint(
            lat=round(proj_lat, 6),
            lon=round(proj_lon, 6),
            ele=round(proj_ele, 1),
            cum_km=round(target_km, 3),
            cum_mi=round(km_to_miles(target_km), 3),
            time=proj_time
        )

    result_points: List[RoutePoint] = []
    n = len(points)

    # 1. Synthesize or locate start point
    start_added = False
    for i in range(n):
        p_km = float(points[i][3])
        if abs(p_km - start_km) < 1e-6:
            p = points[i]
            result_points.append(RoutePoint(
                lat=round(float(p[0]), 6),
                lon=round(float(p[1]), 6),
                ele=round(float(p[2]), 1),
                cum_km=round(start_km, 3),
                cum_mi=round(km_to_miles(start_km), 3),
                time=getattr(p, "time", None)
            ))
            start_added = True
            break
        elif p_km > start_km:
            if i > 0:
                result_points.append(interpolate_at_km(points[i - 1], points[i], start_km))
            else:
                p = points[0]
                result_points.append(RoutePoint(
                    lat=round(float(p[0]), 6),
                    lon=round(float(p[1]), 6),
                    ele=round(float(p[2]), 1),
                    cum_km=round(start_km, 3),
                    cum_mi=round(km_to_miles(start_km), 3),
                    time=getattr(p, "time", None)
                ))
            start_added = True
            break

    # 2. Add interior points strictly between start_km and end_km
    for i in range(n):
        p_km = float(points[i][3])
        if start_km + 1e-6 < p_km < end_km - 1e-6:
            p = points[i]
            result_points.append(RoutePoint(
                lat=round(float(p[0]), 6),
                lon=round(float(p[1]), 6),
                ele=round(float(p[2]), 1),
                cum_km=round(p_km, 3),
                cum_mi=round(km_to_miles(p_km), 3),
                time=getattr(p, "time", None)
            ))

    # 3. Synthesize or locate end point
    end_added = False
    for i in range(n):
        p_km = float(points[i][3])
        if abs(p_km - end_km) < 1e-6:
            p = points[i]
            result_points.append(RoutePoint(
                lat=round(float(p[0]), 6),
                lon=round(float(p[1]), 6),
                ele=round(float(p[2]), 1),
                cum_km=round(end_km, 3),
                cum_mi=round(km_to_miles(end_km), 3),
                time=getattr(p, "time", None)
            ))
            end_added = True
            break
        elif p_km > end_km:
            if i > 0:
                result_points.append(interpolate_at_km(points[i - 1], points[i], end_km))
            end_added = True
            break

    if not end_added and abs(end_km - total_track_km) < 1e-6:
        p = points[-1]
        result_points.append(RoutePoint(
            lat=round(float(p[0]), 6),
            lon=round(float(p[1]), 6),
            ele=round(float(p[2]), 1),
            cum_km=round(end_km, 3),
            cum_mi=round(km_to_miles(end_km), 3),
            time=getattr(p, "time", None)
        ))

    if reset_distance and result_points:
        base_km = result_points[0].cum_km
        shifted: List[RoutePoint] = []
        for p in result_points:
            new_km = round(max(0.0, p.cum_km - base_km), 3)
            new_mi = round(km_to_miles(new_km), 3)
            shifted.append(RoutePoint(
                lat=p.lat,
                lon=p.lon,
                ele=p.ele,
                cum_km=new_km,
                cum_mi=new_mi,
                time=p.time,
                grade=p.grade,
                surface=p.surface,
                tracktype=p.tracktype
            ))
        return shifted

    return result_points


def find_nearest_track_point(
    points: Sequence[Any],
    lat: float,
    lon: float,
    track_index: Optional[TrackIndex] = None
) -> Tuple[int, float, float]:
    """
    Find the closest track point vertex to coordinate (lat, lon).

    Returns:
        (nearest_point_index, distance_m, cumulative_km)
    """
    if not points:
        raise ValueError("points sequence must not be empty")

    if track_index is not None:
        matches = track_index.grid.query_radius(lat, lon, radius_m=5000.0)
        if matches:
            idx, dist_m = matches[0]
            cum_km = float(points[idx][3]) if len(points[idx]) > 3 else 0.0
            return idx, dist_m, cum_km

    best_idx = 0
    best_dist = float("inf")
    for i, p in enumerate(points):
        plat, plon = float(p[0]), float(p[1])
        d = haversine_distance_m(lat, lon, plat, plon)
        if d < best_dist:
            best_dist = d
            best_idx = i

    cum_km = float(points[best_idx][3]) if len(points[best_idx]) > 3 else 0.0
    return best_idx, best_dist, cum_km


def project_point_to_track_segment(
    points: Sequence[Any],
    lat: float,
    lon: float,
    search_radius_m: float = 1000.0,
    track_index: Optional[TrackIndex] = None
) -> ProjectionResult:
    """
    Project coordinate (lat, lon) onto the continuous track polyline segments.

    Finds the nearest perpendicular projection onto any segment P_i -> P_{i+1}
    using engine.utils.geo.dist_point_to_segment_m.
    """
    if len(points) < 2:
        if len(points) == 1:
            p = points[0]
            plat, plon = float(p[0]), float(p[1])
            d = haversine_distance_m(lat, lon, plat, plon)
            km = float(p[3]) if len(p) > 3 else 0.0
            return ProjectionResult(
                distance_m=d,
                projected_lat=plat,
                projected_lon=plon,
                cumulative_km=km,
                cumulative_miles=km_to_miles(km),
                segment_index=0
            )
        raise ValueError("points sequence must not be empty")

    # Determine candidate segment indices
    candidate_indices = range(len(points) - 1)
    if track_index is not None:
        nearby_matches = track_index.grid.query_radius(lat, lon, radius_m=search_radius_m)
        if nearby_matches:
            seg_set = set()
            for idx, _ in nearby_matches:
                if idx < len(points) - 1:
                    seg_set.add(idx)
                if idx > 0:
                    seg_set.add(idx - 1)
            candidate_indices = sorted(seg_set)

    best_dist = float("inf")
    best_proj_lat = float(points[0][0])
    best_proj_lon = float(points[0][1])
    best_km = float(points[0][3]) if len(points[0]) > 3 else 0.0
    best_seg_idx = 0

    for i in candidate_indices:
        p1 = points[i]
        p2 = points[i + 1]
        lat1, lon1 = float(p1[0]), float(p1[1])
        lat2, lon2 = float(p2[0]), float(p2[1])

        dist_m, t, proj_lat, proj_lon = dist_point_to_segment_m(lat, lon, lat1, lon1, lat2, lon2)
        if dist_m < best_dist:
            best_dist = dist_m
            best_proj_lat = proj_lat
            best_proj_lon = proj_lon
            best_seg_idx = i

            km1 = float(p1[3]) if len(p1) > 3 else 0.0
            km2 = float(p2[3]) if len(p2) > 3 else km1
            best_km = km1 + t * (km2 - km1)

    return ProjectionResult(
        distance_m=best_dist,
        projected_lat=best_proj_lat,
        projected_lon=best_proj_lon,
        cumulative_km=round(best_km, 3),
        cumulative_miles=round(km_to_miles(best_km), 3),
        segment_index=best_seg_idx
    )


def sample_elevation_profile(
    points: Sequence[Any],
    num_samples: int = 100
) -> List[Tuple[float, float]]:
    """
    Sample elevation at evenly spaced distance intervals along the route.

    Interpolates elevation linearly between track points.

    Args:
        points: Dense track points [lat, lon, ele, cum_km, cum_mi].
        num_samples: Number of equidistant samples to generate (must be >= 2).

    Returns:
        List of (km, ele_m) tuples evenly spaced from km 0.0 to total_km.
    """
    if num_samples < 2:
        raise ValueError(f"num_samples must be at least 2, got {num_samples}")
    if not points:
        raise ValueError("points sequence must not be empty")

    total_km = float(points[-1][3]) if len(points[-1]) > 3 else 0.0
    step_km = total_km / (num_samples - 1) if total_km > 0.0 else 0.0

    profile: List[Tuple[float, float]] = []
    pt_idx = 0
    n = len(points)

    for i in range(num_samples):
        target_km = i * step_km if i < num_samples - 1 else total_km

        while pt_idx < n - 1 and float(points[pt_idx + 1][3]) < target_km:
            pt_idx += 1

        if pt_idx >= n - 1:
            ele = float(points[-1][2])
        else:
            p1 = points[pt_idx]
            p2 = points[pt_idx + 1]
            km1 = float(p1[3])
            km2 = float(p2[3])
            ele1 = float(p1[2])
            ele2 = float(p2[2])

            if abs(km2 - km1) < 1e-9:
                ele = ele1
            else:
                t = (target_km - km1) / (km2 - km1)
                t = max(0.0, min(1.0, t))
                ele = ele1 + t * (ele2 - ele1)

        profile.append((round(target_km, 3), round(ele, 1)))

    return profile
