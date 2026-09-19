"""
engine.core.models - Core domain data models and exceptions for bikepacking routes.

Provides RoutePoint, RouteWaypoint, and RouteTrack data structures along with
standardized serialization methods and the Python Sequence protocol for
backward compatibility with 5D coordinate tuples [lat, lon, ele, cum_km, cum_mi].
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple, Union
from engine.utils.spatial import BoundingBox
from engine.utils.units import km_to_miles, meters_to_feet


# -----------------------------------------------------------------------------
# Domain Exceptions
# -----------------------------------------------------------------------------

class GPXError(Exception):
    """Base exception for all GPX parsing and validation errors."""
    pass


class EmptyGPXError(GPXError):
    """Raised when GPX source is 0 bytes or completely empty."""
    pass


class CorruptedGPXError(GPXError):
    """Raised when GPX XML syntax is malformed or unparseable."""
    pass


class InvalidGPXError(GPXError):
    """Raised when XML root element is not <gpx>."""
    pass


class EmptyTrackError(GPXError):
    """Raised when GPX contains no valid track or route coordinates."""
    pass


# -----------------------------------------------------------------------------
# Coordinate & Telemetry Models
# -----------------------------------------------------------------------------

@dataclass
class RoutePoint:
    """
    Represents a single geographic coordinate along a bikepacking route.

    Implements the Python Sequence protocol (__len__, __getitem__, __iter__)
    so legacy and downstream code can index pt[0]..pt[4] or unpack:
    lat, lon, ele, cum_km, cum_mi = pt
    """
    lat: float
    lon: float
    ele: float = 0.0
    cum_km: float = 0.0
    cum_mi: float = 0.0
    canonical_km: Optional[float] = None
    canonical_mi: Optional[float] = None
    time: Optional[datetime] = None
    grade: Optional[float] = None
    surface: Optional[str] = None
    tracktype: Optional[str] = None
    speed_kmh: Optional[float] = None
    heart_rate: Optional[int] = None
    cadence: Optional[int] = None
    power_w: Optional[float] = None
    temperature_c: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.lat = float(self.lat)
        self.lon = float(self.lon)
        self.ele = float(self.ele)
        self.cum_km = float(self.cum_km)
        self.cum_mi = float(self.cum_mi)
        if self.canonical_km is not None:
            self.canonical_km = float(self.canonical_km)
        if self.canonical_mi is not None:
            self.canonical_mi = float(self.canonical_mi)

        if not (-90.0 <= self.lat <= 90.0):
            raise ValueError(f"Latitude out of range [-90.0, 90.0]: {self.lat}")
        if not (-180.0 <= self.lon <= 180.0):
            raise ValueError(f"Longitude out of range [-180.0, 180.0]: {self.lon}")

    # Sequence protocol implementation (5D compatibility)
    def __len__(self) -> int:
        return 5

    def __getitem__(self, index: Union[int, slice]) -> Any:
        values = (self.lat, self.lon, self.ele, self.cum_km, self.cum_mi)
        if isinstance(index, slice):
            return values[index]
        if index in (0, -5):
            return self.lat
        elif index in (1, -4):
            return self.lon
        elif index in (2, -3):
            return self.ele
        elif index in (3, -2):
            return self.cum_km
        elif index in (4, -1):
            return self.cum_mi
        raise IndexError(f"RoutePoint index out of range (0..4): {index}")

    def __iter__(self) -> Iterator[float]:
        yield self.lat
        yield self.lon
        yield self.ele
        yield self.cum_km
        yield self.cum_mi

    @property
    def coords(self) -> Tuple[float, float]:
        """Return 2D (lat, lon) tuple."""
        return (self.lat, self.lon)

    def to_tuple_5d(self) -> Tuple[float, float, float, float, float]:
        """Return standard 5D tuple (lat, lon, ele, cum_km, cum_mi)."""
        return (self.lat, self.lon, self.ele, self.cum_km, self.cum_mi)

    def to_list_5d(self) -> List[float]:
        """
        Return rounded 5D list formatted for route-track.json:
        [lat (6 dec), lon (6 dec), ele (1 dec), cum_km (3 dec), cum_mi (3 dec)]
        """
        return [
            round(self.lat, 6),
            round(self.lon, 6),
            round(self.ele, 1),
            round(self.cum_km, 3),
            round(self.cum_mi, 3)
        ]

    def to_list_7d(self) -> List[float]:
        """
        Return rounded 7D list formatted for guidance-track.json:
        [lat (6 dec), lon (6 dec), ele (1 dec), cum_km (3 dec), cum_mi (3 dec), canonical_km (3 dec), canonical_mi (3 dec)]
        """
        c_km = self.canonical_km if self.canonical_km is not None else self.cum_km
        c_mi = self.canonical_mi if self.canonical_mi is not None else self.cum_mi
        return [
            round(self.lat, 6),
            round(self.lon, 6),
            round(self.ele, 1),
            round(self.cum_km, 3),
            round(self.cum_mi, 3),
            round(c_km, 3),
            round(c_mi, 3)
        ]

    def to_dict(self) -> Dict[str, Any]:
        """Return dictionary representation of the point."""
        res: Dict[str, Any] = {
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "ele": round(self.ele, 1),
            "cum_km": round(self.cum_km, 3),
            "cum_mi": round(self.cum_mi, 3)
        }
        if self.time is not None:
            res["time"] = self.time.isoformat()
        if self.grade is not None:
            res["grade"] = round(self.grade, 1)
        if self.surface is not None:
            res["surface"] = self.surface
        if self.tracktype is not None:
            res["tracktype"] = self.tracktype
        if self.speed_kmh is not None:
            res["speed_kmh"] = round(self.speed_kmh, 1)
        if self.extra:
            res["extra"] = self.extra
        return res

    @classmethod
    def from_sequence(
        cls,
        seq: Sequence[Any],
        time: Optional[datetime] = None,
        grade: Optional[float] = None,
        surface: Optional[str] = None,
        tracktype: Optional[str] = None
    ) -> "RoutePoint":
        """
        Construct RoutePoint from sequence [lat, lon, ele, cum_km, cum_mi].
        """
        if len(seq) < 2:
            raise ValueError(f"Sequence must contain at least lat and lon, got length {len(seq)}")
        lat = float(seq[0])
        lon = float(seq[1])
        ele = float(seq[2]) if len(seq) > 2 else 0.0
        km = float(seq[3]) if len(seq) > 3 else 0.0
        mi = float(seq[4]) if len(seq) > 4 else km_to_miles(km)
        return cls(
            lat=lat,
            lon=lon,
            ele=ele,
            cum_km=km,
            cum_mi=mi,
            time=time,
            grade=grade,
            surface=surface,
            tracktype=tracktype
        )


@dataclass
class RouteWaypoint:
    """
    Represents a standalone waypoint or POI extracted from a GPX file.
    """
    lat: float
    lon: float
    ele: Optional[float] = None
    name: str = ""
    desc: str = ""
    cmt: str = ""
    sym: str = ""
    type: str = ""
    time: Optional[datetime] = None
    route_km: Optional[float] = None
    route_mi: Optional[float] = None
    distance_to_trail_km: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.lat = float(self.lat)
        self.lon = float(self.lon)
        if self.ele is not None:
            self.ele = float(self.ele)
        if not (-90.0 <= self.lat <= 90.0):
            raise ValueError(f"Latitude out of range [-90.0, 90.0]: {self.lat}")
        if not (-180.0 <= self.lon <= 180.0):
            raise ValueError(f"Longitude out of range [-180.0, 180.0]: {self.lon}")

    def to_dict(self) -> Dict[str, Any]:
        """Convert waypoint to standard JSON-compatible dictionary."""
        return {
            "name": self.name,
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "ele": round(self.ele, 1) if self.ele is not None else None,
            "desc": self.desc,
            "cmt": self.cmt,
            "sym": self.sym,
            "type": self.type,
            "route_km": round(self.route_km, 3) if self.route_km is not None else None,
            "route_mi": round(self.route_mi, 3) if self.route_mi is not None else None,
            "distance_to_trail_km": round(self.distance_to_trail_km, 3) if self.distance_to_trail_km is not None else None,
            "extra": self.extra
        }


@dataclass
class RouteTrack:
    """
    Complete telemetry track representation for a route.
    """
    points: List[RoutePoint]
    bbox: BoundingBox
    total_distance_km: float
    total_distance_mi: float = 0.0
    elevation_gain_m: float = 0.0
    elevation_loss_m: float = 0.0
    min_ele_m: float = 0.0
    max_ele_m: float = 0.0
    name: str = ""
    description: str = ""
    waypoints: List[RouteWaypoint] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.total_distance_mi == 0.0 and self.total_distance_km > 0.0:
            self.total_distance_mi = km_to_miles(self.total_distance_km)

    @property
    def min_elevation_m(self) -> float:
        """Alias for min_ele_m."""
        return self.min_ele_m

    @property
    def max_elevation_m(self) -> float:
        """Alias for max_ele_m."""
        return self.max_ele_m

    @property
    def total_distance_miles(self) -> float:
        """Alias for total_distance_mi."""
        return self.total_distance_mi

    def __len__(self) -> int:
        return len(self.points)

    def __getitem__(self, idx: Any) -> Any:
        return self.points[idx]

    def to_route_track_json(self) -> Dict[str, Any]:
        """Generate standard route-track.json structure."""
        return {
            "total_km": round(self.total_distance_km, 1),
            "total_miles": round(self.total_distance_mi, 1),
            "bounds": self.bbox.to_leaflet(),
            "points": [p.to_list_5d() for p in self.points]
        }

    def to_stats_json(self) -> Dict[str, Any]:
        """Generate standard .stats.json telemetry dictionary."""
        first_pt = self.points[0] if self.points else RoutePoint(0.0, 0.0)
        last_pt = self.points[-1] if self.points else RoutePoint(0.0, 0.0)
        highest_pt = max(self.points, key=lambda p: p.ele) if self.points else first_pt
        lowest_pt = min(self.points, key=lambda p: p.ele) if self.points else first_pt

        return {
            "total_km": round(self.total_distance_km, 1),
            "total_miles": round(self.total_distance_mi, 1),
            "elevation_gain_m": round(self.elevation_gain_m),
            "elevation_gain_ft": round(meters_to_feet(self.elevation_gain_m)),
            "elevation_loss_m": round(self.elevation_loss_m),
            "elevation_loss_ft": round(meters_to_feet(self.elevation_loss_m)),
            "highest_elevation_m": round(self.max_ele_m),
            "highest_elevation_ft": round(meters_to_feet(self.max_ele_m)),
            "lowest_elevation_m": round(self.min_ele_m),
            "lowest_elevation_ft": round(meters_to_feet(self.min_ele_m)),
            "highest_coords": [round(highest_pt.lat, 5), round(highest_pt.lon, 5)],
            "lowest_coords": [round(lowest_pt.lat, 5), round(lowest_pt.lon, 5)],
            "start_coordinates": [round(first_pt.lat, 5), round(first_pt.lon, 5)],
            "end_coordinates": [round(last_pt.lat, 5), round(last_pt.lon, 5)],
            "bounds": self.bbox.to_leaflet(),
            "point_count": len(self.points)
        }

    @classmethod
    def from_route_track_json(cls, data: Dict[str, Any], name: str = "") -> "RouteTrack":
        """Reconstruct a RouteTrack instance from route-track.json dictionary."""
        pts_raw = data.get("points", [])
        points = [RoutePoint.from_sequence(p) for p in pts_raw]
        total_km = float(data.get("total_km", points[-1].cum_km if points else 0.0))
        total_mi = float(data.get("total_miles", points[-1].cum_mi if points else 0.0))

        if points:
            bbox = BoundingBox.from_points([(p.lat, p.lon) for p in points])
            eles = [p.ele for p in points]
            min_ele = min(eles)
            max_ele = max(eles)
        else:
            bbox = BoundingBox(0.0, 0.0, 0.0, 0.0)
            min_ele = 0.0
            max_ele = 0.0

        return cls(
            points=points,
            bbox=bbox,
            total_distance_km=total_km,
            total_distance_mi=total_mi,
            elevation_gain_m=0.0,
            elevation_loss_m=0.0,
            min_ele_m=min_ele,
            max_ele_m=max_ele,
            name=name
        )
