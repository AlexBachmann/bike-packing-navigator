"""
engine.utils.spatial - Spatial indexing, bounding boxes, and track matching.

Provides:
- BoundingBox dataclass with conversions to GeoJSON, Leaflet, and Overpass formats.
- Generic 2D SpatialHashGrid for fast radius and neighbor queries.
- TrackIndex for O(1) route point projection and distance measurement.
- Helper functions calculate_bbox, point_in_bbox, and expand_bbox.
"""

from dataclasses import dataclass
from typing import Any, Dict, Generic, Iterable, List, Optional, Sequence, Tuple, TypeVar
import math

from engine.utils.geo import haversine_distance, haversine_distance_m
from engine.utils.units import METERS_PER_DEGREE_LAT

T = TypeVar("T")


@dataclass(frozen=True)
class BoundingBox:
    """
    Represents an axis-aligned geographic bounding box.

    Attributes:
        min_lon: Western boundary in decimal degrees.
        min_lat: Southern boundary in decimal degrees.
        max_lon: Eastern boundary in decimal degrees.
        max_lat: Northern boundary in decimal degrees.
    """
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def __post_init__(self) -> None:
        if self.min_lon > self.max_lon:
            raise ValueError(f"min_lon ({self.min_lon}) cannot exceed max_lon ({self.max_lon})")
        if self.min_lat > self.max_lat:
            raise ValueError(f"min_lat ({self.min_lat}) cannot exceed max_lat ({self.max_lat})")

    @classmethod
    def from_points(cls, points: Sequence[Sequence[float]]) -> "BoundingBox":
        """
        Construct bounding box enclosing a sequence of points [lat, lon, ...].

        Args:
            points: Sequence of point tuples/lists where index 0 is lat and 1 is lon.

        Returns:
            BoundingBox instance.
        """
        if not points:
            raise ValueError("Cannot create BoundingBox from empty points sequence")
        lats = [p[0] for p in points]
        lons = [p[1] for p in points]
        return cls(
            min_lon=min(lons),
            min_lat=min(lats),
            max_lon=max(lons),
            max_lat=max(lats),
        )

    def to_geojson(self) -> Tuple[float, float, float, float]:
        """Returns standard GeoJSON / GIS bbox: (min_lon, min_lat, max_lon, max_lat)."""
        return self.min_lon, self.min_lat, self.max_lon, self.max_lat

    def to_leaflet(self) -> List[List[float]]:
        """Returns Leaflet / MapLibre LatLngBounds: [[south, west], [north, east]]."""
        return [[self.min_lat, self.min_lon], [self.max_lat, self.max_lon]]

    def to_overpass(self) -> Tuple[float, float, float, float]:
        """Returns Overpass QL bbox: (south, west, north, east)."""
        return self.min_lat, self.min_lon, self.max_lat, self.max_lon

    def expand_by_meters(self, margin_m: float) -> "BoundingBox":
        """
        Expand bounding box outward by a margin in meters with latitude correction.

        Args:
            margin_m: Buffer margin in meters.

        Returns:
            Expanded BoundingBox.
        """
        if margin_m <= 0.0:
            return self

        mid_lat = (self.min_lat + self.max_lat) / 2.0
        cos_lat = max(0.001, math.cos(math.radians(mid_lat)))

        lat_deg = margin_m / METERS_PER_DEGREE_LAT
        lon_deg = min(360.0, lat_deg / cos_lat)

        return BoundingBox(
            min_lon=max(-180.0, self.min_lon - lon_deg),
            min_lat=max(-90.0, self.min_lat - lat_deg),
            max_lon=min(180.0, self.max_lon + lon_deg),
            max_lat=min(90.0, self.max_lat + lat_deg),
        )

    def contains_point(self, lat: float, lon: float) -> bool:
        """Check if point (lat, lon) falls inside the bounding box."""
        return self.min_lat <= lat <= self.max_lat and self.min_lon <= lon <= self.max_lon


def calculate_bbox(points: Iterable[Sequence[float]]) -> Tuple[float, float, float, float]:
    """
    Calculate bounding box (min_lat, min_lon, max_lat, max_lon) enclosing points.

    Args:
        points: Iterable of coordinate sequences where p[0] is lat and p[1] is lon.

    Returns:
        (min_lat, min_lon, max_lat, max_lon) in decimal degrees.

    Raises:
        ValueError: If points sequence is empty.
    """
    pts = list(points)
    if not pts:
        raise ValueError("Cannot calculate bounding box from empty points collection")
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    return min(lats), min(lons), max(lats), max(lons)


def point_in_bbox(lat: float, lon: float, bbox: Tuple[float, float, float, float]) -> bool:
    """
    Check if point (lat, lon) falls within bbox (min_lat, min_lon, max_lat, max_lon).

    Returns:
        True if point is inside or on boundary of bbox.
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def expand_bbox(
    bbox: Tuple[float, float, float, float], buffer_m: float
) -> Tuple[float, float, float, float]:
    """
    Expand bbox (min_lat, min_lon, max_lat, max_lon) by buffer_m meters.

    Returns:
        Expanded (min_lat, min_lon, max_lat, max_lon).
    """
    if buffer_m <= 0.0:
        return bbox

    min_lat, min_lon, max_lat, max_lon = bbox
    mid_lat = (min_lat + max_lat) / 2.0
    cos_lat = max(0.001, math.cos(math.radians(mid_lat)))

    delta_lat = buffer_m / METERS_PER_DEGREE_LAT
    delta_lon = min(360.0, delta_lat / cos_lat)

    return (
        max(-90.0, min_lat - delta_lat),
        max(-180.0, min_lon - delta_lon),
        min(90.0, max_lat + delta_lat),
        min(180.0, max_lon + delta_lon),
    )


class SpatialHashGrid(Generic[T]):
    """
    2D spatial hash grid index for fast coordinate lookups.

    Supports wrapping across the antimeridian (longitude ±180°) and
    polar query optimization by decoupling longitudinal and latitudinal
    search step sizes.
    """

    def __init__(self, cell_size_deg: float = 0.02):
        """
        Initialize spatial hash grid.

        Args:
            cell_size_deg: Angular size of each grid cell in degrees.
        """
        if cell_size_deg <= 0.0:
            raise ValueError(f"cell_size_deg must be strictly positive, got {cell_size_deg}")
        self.cell_size = cell_size_deg
        self.total_cells_x = max(1, int(math.ceil(360.0 / self.cell_size)))
        self.min_gy = math.floor(-90.0 / self.cell_size)
        self.max_gy = math.floor(90.0 / self.cell_size)
        self.grid: Dict[Tuple[int, int], List[Tuple[float, float, T]]] = {}

    def insert(self, lat: float, lon: float, item: T) -> None:
        """Insert an item at geographic coordinate (lat, lon)."""
        gx = math.floor(lon / self.cell_size) % self.total_cells_x
        gy = math.floor(lat / self.cell_size)
        cell = (gx, gy)
        if cell not in self.grid:
            self.grid[cell] = []
        self.grid[cell].append((lat, lon, item))

    def query_radius(
        self, lat: float, lon: float, radius_m: float
    ) -> List[Tuple[T, float]]:
        """
        Query all items within radius_m meters of (lat, lon).

        Optimized to decouple latitude steps (unscaled by cos_lat) from
        longitude steps, preventing exponential computational slowdown
        at high polar latitudes. Wraps longitude modulo 360° to reliably
        search across the antimeridian.

        Returns:
            List of (item, distance_m) sorted by distance.
        """
        if radius_m < 0.0:
            return []

        cos_lat = max(0.0001, math.cos(math.radians(lat)))
        cell_m = self.cell_size * METERS_PER_DEGREE_LAT
        step_y = max(1, int(math.ceil(radius_m / cell_m)))

        # If the search radius reaches or crosses either geographic pole,
        # the search circle encloses the pole and must span all 360 degrees of longitude.
        delta_lat_deg = radius_m / METERS_PER_DEGREE_LAT
        if lat + delta_lat_deg >= 90.0 or lat - delta_lat_deg <= -90.0:
            step_x = self.total_cells_x
        else:
            step_x = min(
                self.total_cells_x,
                max(1, int(math.ceil(radius_m / (cell_m * cos_lat))))
            )

        gx = math.floor(lon / self.cell_size) % self.total_cells_x
        gy = math.floor(lat / self.cell_size)

        if 2 * step_x + 1 >= self.total_cells_x:
            x_indices: Iterable[int] = range(self.total_cells_x)
        else:
            x_indices = [((gx + dx) % self.total_cells_x) for dx in range(-step_x, step_x + 1)]

        results: List[Tuple[T, float]] = []
        for dy in range(-step_y, step_y + 1):
            cy = gy + dy
            if cy < self.min_gy or cy > self.max_gy:
                continue
            for cx in x_indices:
                cell = self.grid.get((cx, cy))
                if not cell:
                    continue
                for ilat, ilon, item in cell:
                    d_m = haversine_distance_m(lat, lon, ilat, ilon)
                    if d_m <= radius_m:
                        results.append((item, d_m))

        results.sort(key=lambda r: r[1])
        return results


class TrackIndex:
    """
    Spatial index over a dense route track allowing fast projection
    and distance measurements for POIs, water waypoints, and milestones.
    """

    def __init__(
        self,
        track_points: Sequence[Sequence[float]],
        cell_size_deg: float = 0.04
    ):
        """
        Args:
            track_points: Dense list of [lat, lon, ele, cum_km, cum_mi].
            cell_size_deg: Spatial cell size in degrees (~4km default).
        """
        if not track_points:
            raise ValueError("track_points sequence must not be empty")
        self.track = track_points
        self.grid = SpatialHashGrid[int](cell_size_deg=cell_size_deg)
        for idx, pt in enumerate(track_points):
            self.grid.insert(pt[0], pt[1], idx)

    def project_point(
        self, lat: float, lon: float, max_dist_km: float = 5.0
    ) -> Tuple[float, float, float]:
        """
        Project point (lat, lon) onto the route track.

        Returns:
            (distance_km, cumulative_km, cumulative_miles)
            distance_km is lateral distance from point to trail.
        """
        matches = self.grid.query_radius(lat, lon, max_dist_km * 1000.0)
        if not matches:
            # Fall back to exhaustive search if beyond max_dist_km
            best_d = float("inf")
            best_idx = 0
            for idx, pt in enumerate(self.track):
                d = haversine_distance(lat, lon, pt[0], pt[1])
                if d < best_d:
                    best_d = d
                    best_idx = idx
            target = self.track[best_idx]
            return round(best_d, 3), round(target[3], 1), round(target[4], 1)

        best_idx, best_dist_m = matches[0]
        target = self.track[best_idx]
        return round(best_dist_m / 1000.0, 3), round(target[3], 1), round(target[4], 1)
