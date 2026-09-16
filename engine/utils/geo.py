"""
engine.utils.geo - Geodesic calculations and geometric transformations.

Provides pure-Python implementations for great-circle distance (Haversine),
initial forward azimuth / bearing, angular deflection, 2D and geodesic
point-to-segment projections, and track densification.
"""

from typing import List, Sequence, Tuple
import math

from engine.utils.units import (
    EARTH_RADIUS_KM,
    METERS_PER_DEGREE_LAT,
)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points in kilometers.

    Uses the IUGG mean Earth radius (6371.0088 km).
    Guarantees domain safety against floating-point inaccuracies (|a| <= 1.0).

    Args:
        lat1: Latitude of point 1 in decimal degrees.
        lon1: Longitude of point 1 in decimal degrees.
        lat2: Latitude of point 2 in decimal degrees.
        lon2: Longitude of point 2 in decimal degrees.

    Returns:
        Distance in kilometers.
    """
    if lat1 == lat2 and lon1 == lon2:
        return 0.0

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    if math.isnan(a):
        return float("nan")
    a = max(0.0, min(1.0, a))
    return EARTH_RADIUS_KM * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points in meters.

    Args:
        lat1: Latitude of point 1 in decimal degrees.
        lon1: Longitude of point 1 in decimal degrees.
        lat2: Latitude of point 2 in decimal degrees.
        lon2: Longitude of point 2 in decimal degrees.

    Returns:
        Distance in meters.
    """
    return haversine_distance(lat1, lon1, lat2, lon2) * 1000.0


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate initial forward azimuth / bearing from point 1 to point 2 in degrees.

    Args:
        lat1: Start point latitude.
        lon1: Start point longitude.
        lat2: End point latitude.
        lon2: End point longitude.

    Returns:
        Forward azimuth in decimal degrees in the range [0.0, 360.0).
    """
    if lat1 == lat2 and lon1 == lon2:
        return 0.0

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    initial_rad = math.atan2(y, x)
    return (math.degrees(initial_rad) + 360.0) % 360.0


def deflection_angle(incoming_bearing: float, outgoing_bearing: float) -> float:
    """
    Calculate the signed angular deflection between incoming and outgoing bearings.

    Args:
        incoming_bearing: Bearing heading into the waypoint in degrees [0, 360).
        outgoing_bearing: Bearing heading out of the waypoint in degrees [0, 360).

    Returns:
        Signed deflection in degrees [-180.0, +180.0].
        Positive values indicate a right turn (clockwise).
        Negative values indicate a left turn (counter-clockwise).
    """
    return ((outgoing_bearing - incoming_bearing + 540.0) % 360.0) - 180.0


def bearing_to_compass(bearing_deg: float, points: int = 8) -> str:
    """
    Convert a bearing in degrees to a compass direction string.

    Args:
        bearing_deg: Bearing in degrees [0, 360).
        points: 8 (default) or 16 points of the compass.

    Returns:
        Compass direction string, e.g. "N", "NE", "E", "SW", "NNE".
    """
    if points == 16:
        labels = [
            "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
        ]
        step = 22.5
    else:
        labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        step = 45.0

    idx = int(((bearing_deg + step / 2.0) % 360.0) // step)
    return labels[idx % len(labels)]


def dist_point_to_segment_2d(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> Tuple[float, float, float, float]:
    """
    Calculate 2D Cartesian distance and projection from point P to segment AB.

    Args:
        px, py: Coordinates of point P.
        ax, ay: Coordinates of segment start A.
        bx, by: Coordinates of segment end B.

    Returns:
        (distance, t, qx, qy)
        - distance: Perpendicular distance from P to the clamped projection on AB.
        - t: Parametric position along AB clamped to [0.0, 1.0].
        - qx, qy: Coordinates of projected point Q on segment AB.
    """
    dx = bx - ax
    dy = by - ay
    l2 = dx * dx + dy * dy

    if l2 <= 1e-9:
        d = math.hypot(px - ax, py - ay)
        return d, 0.0, ax, ay

    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    qx = ax + t * dx
    qy = ay + t * dy
    d = math.hypot(px - qx, py - qy)
    return d, t, qx, qy


def dist_point_to_segment_m(
    plat: float, plon: float, alat: float, alon: float, blat: float, blon: float
) -> Tuple[float, float, float, float]:
    """
    Calculate geodesic distance in meters and projection of point P onto segment AB.

    Projects to local equirectangular Cartesian space, computes parametric t,
    and returns geodesic distance and interpolated WGS84 coordinates.
    Normalizes longitudinal differences across the 180° antimeridian.

    Args:
        plat, plon: WGS84 coordinates of target point P.
        alat, alon: WGS84 coordinates of segment start A.
        blat, blon: WGS84 coordinates of segment end B.

    Returns:
        (distance_m, t, proj_lat, proj_lon)
        - distance_m: Distance in meters from P to nearest point on segment AB.
        - t: Parametric fraction along segment AB clamped to [0.0, 1.0].
        - proj_lat, proj_lon: WGS84 coordinates of the projected point.
    """
    mid_lat = (alat + blat) / 2.0
    cos_lat = math.cos(math.radians(mid_lat))

    # Segment vector in local meters, normalized across antimeridian
    dlon_b = ((blon - alon + 180.0) % 360.0) - 180.0
    dx_b = dlon_b * METERS_PER_DEGREE_LAT * cos_lat
    dy_b = (blat - alat) * METERS_PER_DEGREE_LAT
    l2 = dx_b * dx_b + dy_b * dy_b

    if l2 <= 1e-9:
        d = haversine_distance_m(plat, plon, alat, alon)
        return d, 0.0, alat, alon

    # Point vector from segment start in local meters, normalized across antimeridian
    dlon_p = ((plon - alon + 180.0) % 360.0) - 180.0
    dx_p = dlon_p * METERS_PER_DEGREE_LAT * cos_lat
    dy_p = (plat - alat) * METERS_PER_DEGREE_LAT

    t = max(0.0, min(1.0, (dx_p * dx_b + dy_p * dy_b) / l2))

    if t <= 0.0:
        return haversine_distance_m(plat, plon, alat, alon), 0.0, alat, alon
    elif t >= 1.0:
        return haversine_distance_m(plat, plon, blat, blon), 1.0, blat, blon
    else:
        proj_lat = alat + t * (blat - alat)
        proj_lon = ((alon + t * dlon_b + 180.0) % 360.0) - 180.0
        d = haversine_distance_m(plat, plon, proj_lat, proj_lon)
        return d, t, proj_lat, proj_lon


def densify_polyline(
    coords: Sequence[Tuple[float, float]], max_step_m: float = 100.0
) -> List[Tuple[float, float]]:
    """
    Densify a polyline so no consecutive coordinates exceed max_step_m.

    Interpolates coordinates along great-circle segments, correctly wrapping
    longitudes across the 180° antimeridian.

    Args:
        coords: Sequence of (lat, lon) coordinates.
        max_step_m: Maximum allowable distance between points in meters (must be > 0).

    Returns:
        Densified list of (lat, lon) coordinates.

    Raises:
        ValueError: If max_step_m is less than or equal to zero.
    """
    if max_step_m <= 0.0:
        raise ValueError("max_step_m must be strictly positive")

    if len(coords) < 2:
        return list(coords)

    densified: List[Tuple[float, float]] = [coords[0]]
    for i in range(len(coords) - 1):
        lat1, lon1 = coords[i]
        lat2, lon2 = coords[i + 1]
        dist_m = haversine_distance_m(lat1, lon1, lat2, lon2)

        if dist_m > max_step_m:
            num_steps = int(math.ceil(dist_m / max_step_m))
            dlon = ((lon2 - lon1 + 180.0) % 360.0) - 180.0
            dlat = lat2 - lat1
            for step in range(1, num_steps):
                t = step / num_steps
                proj_lat = lat1 + t * dlat
                proj_lon = ((lon1 + t * dlon + 180.0) % 360.0) - 180.0
                densified.append((proj_lat, proj_lon))

        densified.append((lat2, lon2))
    return densified


interpolate_track = densify_polyline
