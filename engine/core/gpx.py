"""
engine.core.gpx - GPX parsing, validation, noise filtering, and 3D densification.

Supports:
- GPX 1.0, 1.1, prefixed namespaces, and un-namespaced vendor schemas.
- <trkpt>, <rtept>, and <wpt> extraction in a single unified pass.
- Linear interpolation of missing elevation along cumulative distance.
- Noise filtering: consecutive duplicates (< 0.5m), speed spikes (> 150 km/h), acute geometric rebounds.
- 3D densification with antimeridian-safe coordinate interpolation and elevation/time interpolation.
"""

from datetime import datetime, timedelta, timezone
import io
import math
from pathlib import Path
from typing import Any, List, Optional, Sequence, TextIO, Tuple, Union
import xml.etree.ElementTree as ET

from engine.core.models import (
    CorruptedGPXError,
    EmptyGPXError,
    EmptyTrackError,
    GPXError,
    InvalidGPXError,
    RoutePoint,
    RouteTrack,
    RouteWaypoint,
)


class GPXParseError(GPXError):
    """Raised when GPX source cannot be parsed (e.g. is a directory)."""
    pass
from engine.core.track import (
    build_track_points,
    calculate_elevation_gain_loss,
    compute_track_bounding_box,
    project_point_to_track_segment,
)
from engine.utils.geo import (
    deflection_angle,
    haversine_distance,
    haversine_distance_m,
    initial_bearing,
)
from engine.utils.units import km_to_miles


def _find_text(elem: ET.Element, local_name: str) -> Optional[str]:
    """Find child element text ignoring XML namespace."""
    found = elem.find(f".//{{*}}{local_name}")
    if found is not None and found.text:
        return found.text.strip()
    for child in elem:
        tag_name = child.tag.split("}")[-1]
        if tag_name == local_name and child.text:
            return child.text.strip()
    return None


def _parse_iso_time(time_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO-8601 timestamp string into datetime."""
    if not time_str:
        return None
    try:
        # Standardize Z to +00:00 for Python's fromisoformat
        normalized = time_str.strip().replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except (ValueError, TypeError):
        return None


def _time_delta_seconds(t1: Optional[datetime], t2: Optional[datetime]) -> Optional[float]:
    """
    Compute (t2 - t1).total_seconds() safely handling None, timezone-aware, and naive datetimes.
    Returns None if either timestamp is None or if subtraction fails.
    """
    if t1 is None or t2 is None:
        return None
    if t1.tzinfo is not None and t2.tzinfo is None:
        t2 = t2.replace(tzinfo=t1.tzinfo)
    elif t1.tzinfo is None and t2.tzinfo is not None:
        t1 = t1.replace(tzinfo=t2.tzinfo)
    try:
        return (t2 - t1).total_seconds()
    except Exception:
        return None



def _interpolate_elevations(
    points: List[RoutePoint],
    default_elevation: float = 0.0
) -> None:
    """
    Linearly interpolate missing elevations (ele is None) along cumulative distance.
    Mutates points in place.
    """
    n = len(points)
    if n == 0:
        return

    known_indices = [i for i, p in enumerate(points) if p.ele is not None and not math.isnan(p.ele)]

    if not known_indices:
        # All elevations missing: set to default
        for p in points:
            p.ele = float(default_elevation)
        return

    first_known_idx = known_indices[0]
    first_known_ele = points[first_known_idx].ele
    for i in range(0, first_known_idx):
        points[i].ele = float(first_known_ele)

    last_known_idx = known_indices[-1]
    last_known_ele = points[last_known_idx].ele
    for i in range(last_known_idx + 1, n):
        points[i].ele = float(last_known_ele)

    # Compute distances between known anchors
    for k in range(len(known_indices) - 1):
        idx_a = known_indices[k]
        idx_b = known_indices[k + 1]
        if idx_b - idx_a <= 1:
            continue

        cum_dists = [0.0]
        for m in range(idx_a, idx_b):
            d = haversine_distance(points[m].lat, points[m].lon, points[m + 1].lat, points[m + 1].lon)
            cum_dists.append(cum_dists[-1] + d)

        total_d = cum_dists[-1]
        ele_a = points[idx_a].ele
        ele_b = points[idx_b].ele

        for m_offset, m in enumerate(range(idx_a + 1, idx_b), start=1):
            if total_d > 1e-9:
                ratio = cum_dists[m_offset] / total_d
                points[m].ele = ele_a + ratio * (ele_b - ele_a)
            else:
                points[m].ele = ele_a


def _filter_noise(
    points: List[RoutePoint],
    max_speed_kmh: Optional[float] = 150.0,
    filter_geometry_spikes: bool = True
) -> List[RoutePoint]:
    """
    Filter consecutive duplicates, speed spikes, and acute rebound spikes.
    """
    if len(points) < 2:
        return points

    # 1. Remove consecutive duplicates (< 0.5m)
    deduped: List[RoutePoint] = [points[0]]
    for i in range(1, len(points)):
        prev = deduped[-1]
        curr = points[i]
        d_m = haversine_distance_m(prev.lat, prev.lon, curr.lat, curr.lon)
        if d_m >= 0.5:
            deduped.append(curr)

    if len(deduped) < 3:
        return deduped

    # 2. Filter speed spikes when timestamps are available
    if max_speed_kmh is not None and max_speed_kmh > 0.0:
        has_timestamps = any(p.time is not None for p in deduped)
        if has_timestamps:
            speed_filtered: List[RoutePoint] = [deduped[0]]
            i = 1
            while i < len(deduped):
                curr = deduped[i]
                prev = speed_filtered[-1]
                if prev.time is not None and curr.time is not None:
                    dt = _time_delta_seconds(prev.time, curr.time)
                    if dt is not None and dt > 0.0:
                        dist_km = haversine_distance(prev.lat, prev.lon, curr.lat, curr.lon)
                        speed = (dist_km / dt) * 3600.0
                        if speed > max_speed_kmh and dist_km > 0.1:
                            # Potential spike: inspect if next point returns closer to prev
                            if i + 1 < len(deduped):
                                next_pt = deduped[i + 1]
                                next_dist = haversine_distance(prev.lat, prev.lon, next_pt.lat, next_pt.lon)
                                if next_dist < dist_km:
                                    # Skip current spike point
                                    i += 1
                                    continue
                speed_filtered.append(curr)
                i += 1
            deduped = speed_filtered

    if len(deduped) < 3 or not filter_geometry_spikes:
        return deduped

    # 3. Geometric rebound spike filter (3-point sliding window)
    geom_filtered: List[RoutePoint] = [deduped[0]]
    i = 1
    while i < len(deduped) - 1:
        prev = geom_filtered[-1]
        curr = deduped[i]
        next_pt = deduped[i + 1]

        d1 = haversine_distance_m(prev.lat, prev.lon, curr.lat, curr.lon)
        d2 = haversine_distance_m(curr.lat, curr.lon, next_pt.lat, next_pt.lon)
        d0 = haversine_distance_m(prev.lat, prev.lon, next_pt.lat, next_pt.lon)

        if d1 > 2000.0 and d2 > 2000.0 and (d1 + d2) / max(d0, 1.0) > 5.0:
            b1 = initial_bearing(prev.lat, prev.lon, curr.lat, curr.lon)
            b2 = initial_bearing(curr.lat, curr.lon, next_pt.lat, next_pt.lon)
            angle = abs(deflection_angle(b1, b2))
            if angle > 140.0:
                # Discard acute spike
                i += 1
                continue

        geom_filtered.append(curr)
        i += 1

    geom_filtered.append(deduped[-1])
    return geom_filtered


def _densify_points(
    points: List[RoutePoint],
    max_step_m: float = 100.0
) -> List[RoutePoint]:
    """
    Subdivide segments exceeding max_step_m with antimeridian-safe coordinates,
    elevation, and timestamp linear interpolation.
    """
    if len(points) < 2 or max_step_m <= 0.0:
        return points

    densified: List[RoutePoint] = [points[0]]
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i + 1]
        dist_m = haversine_distance_m(p1.lat, p1.lon, p2.lat, p2.lon)

        if dist_m > max_step_m:
            num_steps = int(math.ceil(dist_m / max_step_m))
            dlon = ((p2.lon - p1.lon + 180.0) % 360.0) - 180.0
            dlat = p2.lat - p1.lat
            dele = (p2.ele - p1.ele) if (p1.ele is not None and p2.ele is not None) else 0.0

            t1 = p1.time
            t2 = p2.time
            total_dt = _time_delta_seconds(t1, t2)
            has_time = total_dt is not None
            if has_time and t1 is not None and t2 is not None:
                if t1.tzinfo is None and t2.tzinfo is not None:
                    t1 = t1.replace(tzinfo=t2.tzinfo)

            for step in range(1, num_steps):
                t = step / num_steps
                proj_lat = p1.lat + t * dlat
                proj_lon = ((p1.lon + t * dlon + 180.0) % 360.0) - 180.0
                proj_ele = (p1.ele + t * dele) if p1.ele is not None else 0.0
                proj_time = (t1 + timedelta(seconds=t * total_dt)) if has_time else None

                densified.append(RoutePoint(
                    lat=round(proj_lat, 6),
                    lon=round(proj_lon, 6),
                    ele=round(proj_ele, 1),
                    time=proj_time
                ))

        densified.append(p2)
    return densified


def parse_gpx(
    source: Union[str, Path, bytes, TextIO],
    densify_step_m: float = 100.0,
    filter_noise: bool = True,
    max_speed_kmh: Optional[float] = 150.0,
    default_elevation: float = 0.0
) -> RouteTrack:
    """
    Parse a GPX file or data stream into a validated RouteTrack.

    Handles XML namespaces, missing elevation interpolation, noise filtering,
    and 3D densification.
    """
    content: bytes

    if isinstance(source, str) and not source.strip():
        raise EmptyGPXError("GPX source is empty")

    if isinstance(source, (str, Path)):
        try:
            if Path(source).is_dir():
                raise GPXParseError(f"GPX path is a directory: {source}")
        except (OSError, ValueError):
            pass

    if isinstance(source, Path) or (isinstance(source, str) and not source.strip().startswith("<")):
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"GPX file not found: {path}")
        if path.stat().st_size == 0:
            raise EmptyGPXError(f"GPX file is empty (0 bytes): {path}")
        content = path.read_bytes()
    elif isinstance(source, str):
        stripped = source.strip()
        if not stripped:
            raise EmptyGPXError("GPX string is empty")
        content = stripped.encode("utf-8")
    elif isinstance(source, bytes):
        if len(source.strip()) == 0:
            raise EmptyGPXError("GPX byte content is empty")
        content = source
    elif hasattr(source, "read"):
        raw = source.read()
        if isinstance(raw, str):
            if not raw.strip():
                raise EmptyGPXError("GPX stream is empty")
            content = raw.encode("utf-8")
        else:
            if not raw:
                raise EmptyGPXError("GPX stream is empty")
            content = raw
    else:
        raise ValueError(f"Unsupported source type: {type(source)}")

    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise CorruptedGPXError(f"Malformed GPX XML: {e}") from e

    root_tag = root.tag.split("}")[-1].lower()
    if root_tag != "gpx":
        raise InvalidGPXError(f"Root XML element is not <gpx>, got <{root.tag}>")

    # Extract metadata name & description
    meta_elem = root.find(".//{*}metadata")
    track_name = ""
    track_desc = ""
    if meta_elem is not None:
        track_name = _find_text(meta_elem, "name") or ""
        track_desc = _find_text(meta_elem, "desc") or ""

    trk_elem = root.find(".//{*}trk")
    if trk_elem is not None:
        if not track_name:
            track_name = _find_text(trk_elem, "name") or ""
        if not track_desc:
            track_desc = _find_text(trk_elem, "desc") or ""

    rte_elem = root.find(".//{*}rte")
    if rte_elem is not None:
        if not track_name:
            track_name = _find_text(rte_elem, "name") or ""
        if not track_desc:
            track_desc = _find_text(rte_elem, "desc") or ""

    # 1. Extract track points (<trkpt>) across all tracks/segments
    raw_pt_elements = root.findall(".//{*}trkpt")

    # 2. Fallback to route points (<rtept>) if no track points
    if not raw_pt_elements:
        raw_pt_elements = root.findall(".//{*}rtept")

    # 3. Extract standalone waypoints (<wpt>)
    wpt_elements = root.findall(".//{*}wpt")
    waypoints: List[RouteWaypoint] = []
    for elem in wpt_elements:
        try:
            w_lat = float(elem.attrib["lat"])
            w_lon = float(elem.attrib["lon"])
        except (KeyError, ValueError):
            continue

        w_ele_text = _find_text(elem, "ele")
        w_ele = float(w_ele_text) if w_ele_text else None
        w_name = _find_text(elem, "name") or ""
        w_desc = _find_text(elem, "desc") or ""
        w_cmt = _find_text(elem, "cmt") or ""
        w_sym = _find_text(elem, "sym") or ""
        w_type = _find_text(elem, "type") or ""
        w_time = _parse_iso_time(_find_text(elem, "time"))

        waypoints.append(RouteWaypoint(
            lat=w_lat,
            lon=w_lon,
            ele=w_ele,
            name=w_name,
            desc=w_desc,
            cmt=w_cmt,
            sym=w_sym,
            type=w_type,
            time=w_time
        ))

    if not raw_pt_elements:
        if waypoints:
            raise EmptyTrackError("GPX file contains waypoints but no track or route coordinates")
        raise EmptyTrackError("GPX file contains no coordinates")

    # Parse raw points
    parsed_points: List[RoutePoint] = []
    for elem in raw_pt_elements:
        try:
            p_lat = float(elem.attrib["lat"])
            p_lon = float(elem.attrib["lon"])
        except (KeyError, ValueError):
            continue

        ele_text = _find_text(elem, "ele")
        ele_val = None
        if ele_text:
            try:
                parsed_val = float(ele_text)
                if not math.isnan(parsed_val) and not math.isinf(parsed_val):
                    ele_val = parsed_val
            except ValueError:
                pass

        time_val = _parse_iso_time(_find_text(elem, "time"))

        parsed_points.append(RoutePoint(
            lat=p_lat,
            lon=p_lon,
            ele=ele_val if ele_val is not None else 0.0,
            time=time_val
        ))
        if ele_val is None:
            parsed_points[-1].ele = None  # type: ignore

    if not parsed_points:
        raise EmptyTrackError("GPX file contains no valid coordinates")

    # 4. Interpolate missing elevations
    _interpolate_elevations(parsed_points, default_elevation=default_elevation)

    # 5. Filter noise (consecutive duplicates, speed spikes, geometry rebounds)
    if filter_noise:
        parsed_points = _filter_noise(parsed_points, max_speed_kmh=max_speed_kmh)

    # 6. 3D Densification
    if densify_step_m > 0.0:
        parsed_points = _densify_points(parsed_points, max_step_m=densify_step_m)

    # 7. Compute cumulative distance and build finalized RoutePoints
    final_points = build_track_points(parsed_points)

    total_km = final_points[-1].cum_km
    total_mi = final_points[-1].cum_mi

    # 8. Compute telemetry
    eles = [p.ele for p in final_points]
    gain_m, loss_m = calculate_elevation_gain_loss(eles)
    bbox = compute_track_bounding_box(final_points)
    min_ele = min(eles)
    max_ele = max(eles)

    # 9. Project waypoints onto track for mileage and offset calculation
    if waypoints and len(final_points) >= 1:
        for wpt in waypoints:
            proj = project_point_to_track_segment(final_points, wpt.lat, wpt.lon)
            wpt.route_km = proj.cumulative_km
            wpt.route_mi = proj.cumulative_miles
            wpt.distance_to_trail_km = round(proj.distance_m / 1000.0, 3)

    return RouteTrack(
        points=final_points,
        bbox=bbox,
        total_distance_km=round(total_km, 1),
        total_distance_mi=round(total_mi, 1),
        elevation_gain_m=round(gain_m),
        elevation_loss_m=round(loss_m),
        min_ele_m=round(min_ele, 1),
        max_ele_m=round(max_ele, 1),
        name=track_name,
        description=track_desc,
        waypoints=waypoints
    )


def parse_gpx_track(
    gpx_path: Union[str, Path],
    densify_step_m: float = 100.0,
    filter_noise: bool = True
) -> RouteTrack:
    """
    Standard entrypoint matching PROJECT.md interface contract for parse_gpx_track.
    """
    return parse_gpx(gpx_path, densify_step_m=densify_step_m, filter_noise=filter_noise)
