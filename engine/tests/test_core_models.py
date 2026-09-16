"""
engine/tests/test_core_models.py - Comprehensive unit tests for core GPX data models.
"""

from datetime import datetime, timezone
import pytest

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
from engine.utils.spatial import BoundingBox


class TestRoutePoint:
    def test_initialization_defaults(self) -> None:
        pt = RoutePoint(35.0, -112.0)
        assert pt.lat == 35.0
        assert pt.lon == -112.0
        assert pt.ele == 0.0
        assert pt.cum_km == 0.0
        assert pt.cum_mi == 0.0
        assert pt.time is None
        assert pt.grade is None
        assert pt.surface is None

    def test_lat_lon_validation_bounds(self) -> None:
        # Valid boundaries
        p1 = RoutePoint(-90.0, -180.0)
        p2 = RoutePoint(90.0, 180.0)
        assert p1.lat == -90.0
        assert p2.lon == 180.0

        # Invalid latitudes
        with pytest.raises(ValueError, match="Latitude out of range" ):
            RoutePoint(90.0001, 0.0)
        with pytest.raises(ValueError, match="Latitude out of range"):
            RoutePoint(-90.0001, 0.0)

        # Invalid longitudes
        with pytest.raises(ValueError, match="Longitude out of range"):
            RoutePoint(0.0, 180.0001)
        with pytest.raises(ValueError, match="Longitude out of range"):
            RoutePoint(0.0, -180.0001)

    def test_sequence_protocol_len(self) -> None:
        pt = RoutePoint(34.5, -111.5, 1200.5, 10.2, 6.34)
        assert len(pt) == 5

    def test_sequence_protocol_getitem(self) -> None:
        pt = RoutePoint(34.5, -111.5, 1200.5, 10.2, 6.34)
        assert pt[0] == 34.5
        assert pt[1] == -111.5
        assert pt[2] == 1200.5
        assert pt[3] == 10.2
        assert pt[4] == 6.34

    def test_sequence_protocol_negative_indexing(self) -> None:
        pt = RoutePoint(34.5, -111.5, 1200.5, 10.2, 6.34)
        assert pt[-5] == 34.5
        assert pt[-4] == -111.5
        assert pt[-3] == 1200.5
        assert pt[-2] == 10.2
        assert pt[-1] == 6.34

    def test_sequence_protocol_slices(self) -> None:
        pt = RoutePoint(34.5, -111.5, 1200.5, 10.2, 6.34)
        assert pt[0:2] == (34.5, -111.5)
        assert pt[2:] == (1200.5, 10.2, 6.34)

    def test_sequence_protocol_index_error(self) -> None:
        pt = RoutePoint(34.5, -111.5)
        with pytest.raises(IndexError):
            _ = pt[5]
        with pytest.raises(IndexError):
            _ = pt[-6]

    def test_sequence_unpacking(self) -> None:
        pt = RoutePoint(34.5, -111.5, 1200.5, 10.2, 6.34)
        lat, lon, ele, km, mi = pt
        assert (lat, lon, ele, km, mi) == (34.5, -111.5, 1200.5, 10.2, 6.34)

    def test_iteration(self) -> None:
        pt = RoutePoint(34.5, -111.5, 1200.5, 10.2, 6.34)
        items = list(iter(pt))
        assert items == [34.5, -111.5, 1200.5, 10.2, 6.34]

    def test_coords_property(self) -> None:
        pt = RoutePoint(34.5, -111.5)
        assert pt.coords == (34.5, -111.5)

    def test_to_tuple_and_list_5d(self) -> None:
        pt = RoutePoint(34.1234567, -111.9876543, 1500.26, 45.6789, 28.3835)
        assert pt.to_tuple_5d() == (34.1234567, -111.9876543, 1500.26, 45.6789, 28.3835)
        assert pt.to_list_5d() == [34.123457, -111.987654, 1500.3, 45.679, 28.384]

    def test_to_dict(self) -> None:
        t = datetime(2026, 9, 16, 10, 0, 0, tzinfo=timezone.utc)
        pt = RoutePoint(34.5, -111.5, 1200.0, 10.0, 6.214, time=t, grade=4.5, surface="gravel")
        d = pt.to_dict()
        assert d["lat"] == 34.5
        assert d["lon"] == -111.5
        assert d["ele"] == 1200.0
        assert d["grade"] == 4.5
        assert d["surface"] == "gravel"
        assert "2026-09-16T10:00:00" in d["time"]

    def test_from_sequence(self) -> None:
        p2 = RoutePoint.from_sequence([34.0, -111.0])
        assert p2.lat == 34.0
        assert p2.lon == -111.0
        assert p2.ele == 0.0

        p5 = RoutePoint.from_sequence([34.0, -111.0, 1500.0, 20.0, 12.4])
        assert p5.ele == 1500.0
        assert p5.cum_km == 20.0
        assert p5.cum_mi == 12.4

        with pytest.raises(ValueError, match="Sequence must contain at least lat and lon"):
            RoutePoint.from_sequence([34.0])


class TestRouteWaypoint:
    def test_waypoint_attributes(self) -> None:
        wpt = RouteWaypoint(
            lat=34.123,
            lon=-111.456,
            ele=1550.0,
            name="Spring C",
            desc="Good flowing water",
            cmt="Reliable",
            sym="Water",
            type="water"
        )
        assert wpt.name == "Spring C"
        assert wpt.ele == 1550.0
        assert wpt.type == "water"

    def test_waypoint_bounds_validation(self) -> None:
        with pytest.raises(ValueError):
            RouteWaypoint(lat=95.0, lon=0.0)
        with pytest.raises(ValueError):
            RouteWaypoint(lat=0.0, lon=-185.0)

    def test_waypoint_to_dict(self) -> None:
        wpt = RouteWaypoint(
            lat=34.1234567,
            lon=-111.4567891,
            ele=1500.2,
            name="Resupply",
            route_km=45.2,
            route_mi=28.1,
            distance_to_trail_km=0.05
        )
        d = wpt.to_dict()
        assert d["name"] == "Resupply"
        assert d["lat"] == 34.123457
        assert d["lon"] == -111.456789
        assert d["ele"] == 1500.2
        assert d["route_km"] == 45.2
        assert d["distance_to_trail_km"] == 0.05


class TestRouteTrack:
    def test_empty_points_track(self) -> None:
        track = RouteTrack(
            points=[],
            bbox=BoundingBox(0.0, 0.0, 0.0, 0.0),
            total_distance_km=0.0
        )
        assert len(track) == 0
        assert track.total_distance_mi == 0.0
        stats = track.to_stats_json()
        assert stats["point_count"] == 0

    def test_len_and_indexing(self) -> None:
        pts = [
            RoutePoint(34.0, -111.0, 1000.0, 0.0, 0.0),
            RoutePoint(34.1, -111.0, 1100.0, 11.1, 6.9),
        ]
        track = RouteTrack(
            points=pts,
            bbox=BoundingBox(min_lon=-111.0, min_lat=34.0, max_lon=-111.0, max_lat=34.1),
            total_distance_km=11.1
        )
        assert len(track) == 2
        assert track[0].lat == 34.0
        assert track[1].lat == 34.1

    def test_to_route_track_json_schema(self) -> None:
        pts = [
            RoutePoint(34.0, -111.0, 1000.0, 0.0, 0.0),
            RoutePoint(34.1, -111.0, 1100.0, 11.1234, 6.9123),
        ]
        track = RouteTrack(
            points=pts,
            bbox=BoundingBox(min_lon=-111.0, min_lat=34.0, max_lon=-111.0, max_lat=34.1),
            total_distance_km=11.1234,
            total_distance_mi=6.9123
        )
        data = track.to_route_track_json()
        assert data["total_km"] == 11.1
        assert data["total_miles"] == 6.9
        assert len(data["points"]) == 2
        assert data["points"][1] == [34.1, -111.0, 1100.0, 11.123, 6.912]
        assert data["bounds"] == [[34.0, -111.0], [34.1, -111.0]]

    def test_to_stats_json_schema(self) -> None:
        pts = [
            RoutePoint(34.0, -111.0, 1000.0, 0.0, 0.0),
            RoutePoint(34.5, -111.5, 2500.0, 50.0, 31.0),
            RoutePoint(35.0, -112.0, 1200.0, 100.0, 62.0),
        ]
        track = RouteTrack(
            points=pts,
            bbox=BoundingBox(34.0, -112.0, 35.0, -111.0),
            total_distance_km=100.0,
            total_distance_mi=62.0,
            elevation_gain_m=1500.0,
            elevation_loss_m=1300.0,
            min_ele_m=1000.0,
            max_ele_m=2500.0
        )
        stats = track.to_stats_json()
        assert stats["total_km"] == 100.0
        assert stats["total_miles"] == 62.0
        assert stats["elevation_gain_m"] == 1500
        assert stats["elevation_loss_m"] == 1300
        assert stats["highest_elevation_m"] == 2500
        assert stats["lowest_elevation_m"] == 1000
        assert stats["highest_coords"] == [34.5, -111.5]
        assert stats["start_coordinates"] == [34.0, -111.0]
        assert stats["end_coordinates"] == [35.0, -112.0]
        assert stats["point_count"] == 3

    def test_from_route_track_json_roundtrip(self) -> None:
        pts = [
            RoutePoint(34.0, -111.0, 1000.0, 0.0, 0.0),
            RoutePoint(34.5, -111.5, 2000.0, 50.0, 31.069),
        ]
        track1 = RouteTrack(
            points=pts,
            bbox=BoundingBox(34.0, -111.5, 34.5, -111.0),
            total_distance_km=50.0,
            total_distance_mi=31.1,
            min_ele_m=1000.0,
            max_ele_m=2000.0,
            name="Test Route"
        )
        data = track1.to_route_track_json()
        track2 = RouteTrack.from_route_track_json(data, name="Test Route")
        assert len(track2) == 2
        assert track2.points[0].lat == 34.0
        assert track2.points[1].lat == 34.5
        assert track2.name == "Test Route"
        assert track2.min_elevation_m == 1000.0
        assert track2.max_elevation_m == 2000.0


class TestExceptions:
    def test_exception_hierarchy(self) -> None:
        assert issubclass(EmptyGPXError, GPXError)
        assert issubclass(CorruptedGPXError, GPXError)
        assert issubclass(InvalidGPXError, GPXError)
        assert issubclass(EmptyTrackError, GPXError)
        assert issubclass(GPXError, Exception)
