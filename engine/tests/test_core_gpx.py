"""
engine/tests/test_core_gpx.py - Comprehensive unit tests for GPX parser, noise filter, and 3D densification.
"""

from datetime import datetime, timezone
from pathlib import Path
import pytest

from engine.core.gpx import _densify_points, parse_gpx, parse_gpx_track
from engine.core.models import (
    CorruptedGPXError,
    EmptyGPXError,
    EmptyTrackError,
    InvalidGPXError,
    RoutePoint,
    RouteTrack,
)


class TestGPXNamespaces:
    def test_gpx_11_default_namespace(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="BikepackNavigator" xmlns="http://www.topografix.com/GPX/1/1">
            <trk>
                <name>GPX 1.1 Test</name>
                <trkseg>
                    <trkpt lat="34.0" lon="-111.0"><ele>1000.0</ele></trkpt>
                    <trkpt lat="34.01" lon="-111.0"><ele>1050.0</ele></trkpt>
                </trkseg>
            </trk>
        </gpx>"""
        track = parse_gpx(xml)
        assert len(track) >= 2
        assert track.name == "GPX 1.1 Test"
        assert track.points[0].lat == 34.0
        assert track.points[0].ele == 1000.0

    def test_gpx_10_default_namespace(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.0" creator="Legacy" xmlns="http://www.topografix.com/GPX/1/0">
            <trk>
                <name>GPX 1.0 Test</name>
                <trkseg>
                    <trkpt lat="45.0" lon="6.0"><ele>1500.0</ele></trkpt>
                    <trkpt lat="45.01" lon="6.0"><ele>1550.0</ele></trkpt>
                </trkseg>
            </trk>
        </gpx>"""
        track = parse_gpx(xml)
        assert len(track) >= 2
        assert track.name == "GPX 1.0 Test"
        assert track.points[0].lat == 45.0
        assert track.points[0].ele == 1500.0

    def test_gpx_no_namespace(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1">
            <trk>
                <name>No Namespace</name>
                <trkseg>
                    <trkpt lat="50.0" lon="10.0"><ele>500.0</ele></trkpt>
                    <trkpt lat="50.01" lon="10.0"><ele>510.0</ele></trkpt>
                </trkseg>
            </trk>
        </gpx>"""
        track = parse_gpx(xml)
        assert len(track) >= 2
        assert track.points[0].lat == 50.0

    def test_gpx_prefixed_namespace(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <gpx:gpx version="1.1" xmlns:gpx="http://www.topografix.com/GPX/1/1">
            <gpx:trk>
                <gpx:name>Prefixed GPX</gpx:name>
                <gpx:trkseg>
                    <gpx:trkpt lat="28.0" lon="-15.0"><gpx:ele>200.0</gpx:ele></gpx:trkpt>
                    <gpx:trkpt lat="28.01" lon="-15.0"><gpx:ele>220.0</gpx:ele></gpx:trkpt>
                </gpx:trkseg>
            </gpx:trk>
        </gpx:gpx>"""
        track = parse_gpx(xml)
        assert len(track) >= 2
        assert track.points[0].lat == 28.0
        assert track.points[0].ele == 200.0


class TestGPXStructure:
    def test_trk_trkseg_trkpt(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
            <trkpt lat="35.01" lon="-112.0"><ele>1010.0</ele></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert len(track) == 2
        assert track.points[0].lat == 35.0
        assert track.points[1].lat == 35.01

    def test_multiple_trkseg_concatenation(self) -> None:
        xml = """<gpx version="1.1"><trk>
            <trkseg>
                <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
                <trkpt lat="35.01" lon="-112.0"><ele>1010.0</ele></trkpt>
            </trkseg>
            <trkseg>
                <trkpt lat="35.02" lon="-112.0"><ele>1020.0</ele></trkpt>
                <trkpt lat="35.03" lon="-112.0"><ele>1030.0</ele></trkpt>
            </trkseg>
        </trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert len(track) == 4
        assert [p.lat for p in track.points] == [35.0, 35.01, 35.02, 35.03]

    def test_multiple_trk_concatenation(self) -> None:
        xml = """<gpx version="1.1">
            <trk><trkseg><trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt></trkseg></trk>
            <trk><trkseg><trkpt lat="35.01" lon="-112.0"><ele>1010.0</ele></trkpt></trkseg></trk>
        </gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert len(track) == 2
        assert track.points[1].lat == 35.01

    def test_rte_fallback(self) -> None:
        xml = """<gpx version="1.1"><rte>
            <name>Route Fallback</name>
            <rtept lat="40.0" lon="-105.0"><ele>2000.0</ele></rtept>
            <rtept lat="40.01" lon="-105.0"><ele>2050.0</ele></rtept>
        </rte></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert len(track) == 2
        assert track.name == "Route Fallback"
        assert track.points[0].lat == 40.0

    def test_embedded_waypoints_extraction(self) -> None:
        xml = """<gpx version="1.1">
            <wpt lat="35.005" lon="-112.001">
                <ele>1005.0</ele>
                <name>Spring Creek</name>
                <desc>Reliable water source</desc>
                <type>water</type>
            </wpt>
            <trk><trkseg>
                <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
                <trkpt lat="35.01" lon="-112.0"><ele>1010.0</ele></trkpt>
            </trkseg></trk>
        </gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert len(track.waypoints) == 1
        wpt = track.waypoints[0]
        assert wpt.name == "Spring Creek"
        assert wpt.desc == "Reliable water source"
        assert wpt.type == "water"
        assert wpt.route_km is not None
        assert wpt.distance_to_trail_km is not None
        assert 0.05 < wpt.distance_to_trail_km < 0.2


class TestElevationHandling:
    def test_standard_elevation_parsing(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="36.0" lon="-116.0"><ele>-86.0</ele></trkpt>
            <trkpt lat="36.01" lon="-116.0"><ele>100.0</ele></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert track.points[0].ele == -86.0
        assert track.points[1].ele == 100.0

    def test_missing_elevation_interpolation(self) -> None:
        # Point 0: 1000m, Point 1: missing, Point 2: 1200m
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.00" lon="-112.0"><ele>1000.0</ele></trkpt>
            <trkpt lat="35.01" lon="-112.0"></trkpt>
            <trkpt lat="35.02" lon="-112.0"><ele>1200.0</ele></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert len(track) == 3
        assert track.points[0].ele == 1000.0
        # Intermediate point should be linearly interpolated near 1100m
        assert 1095.0 < track.points[1].ele < 1105.0
        assert track.points[2].ele == 1200.0

    def test_all_missing_elevation_default(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.00" lon="-112.0"></trkpt>
            <trkpt lat="35.01" lon="-112.0"></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0, default_elevation=250.0)
        assert track.points[0].ele == 250.0
        assert track.points[1].ele == 250.0


class TestTimestampHandling:
    def test_iso8601_utc_z(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><time>2026-09-16T10:00:00Z</time></trkpt>
            <trkpt lat="35.01" lon="-112.0"><time>2026-09-16T10:05:00Z</time></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert track.points[0].time == datetime(2026, 9, 16, 10, 0, 0, tzinfo=timezone.utc)
        assert track.points[1].time == datetime(2026, 9, 16, 10, 5, 0, tzinfo=timezone.utc)

    def test_iso8601_with_offset(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><time>2026-09-16T12:00:00+02:00</time></trkpt>
            <trkpt lat="35.01" lon="-112.0"><time>2026-09-16T12:05:00+02:00</time></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert track.points[0].time is not None
        assert track.points[0].time.hour == 12

    def test_missing_timestamp_allowed(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"></trkpt>
            <trkpt lat="35.01" lon="-112.0"></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0)
        assert track.points[0].time is None


class TestNoiseFiltering:
    def test_identical_duplicate_removal(self) -> None:
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
            <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
            <trkpt lat="35.01" lon="-112.0"><ele>1010.0</ele></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0, filter_noise=True)
        assert len(track) == 2
        assert track.points[0].lat == 35.0
        assert track.points[1].lat == 35.01

    def test_sub_meter_micro_step_filtering(self) -> None:
        # Distance between (35.0, -112.0) and (35.000001, -112.0) is ~0.11m (< 0.5m)
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
            <trkpt lat="35.000001" lon="-112.0"><ele>1000.1</ele></trkpt>
            <trkpt lat="35.01" lon="-112.0"><ele>1010.0</ele></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0, filter_noise=True)
        assert len(track) == 2

    def test_speed_spike_glitch_rejection(self) -> None:
        # Jump from point 0 to point 1 (100 km away in 1 second = 360,000 km/h) then returns to point 2
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><time>2026-09-16T10:00:00Z</time></trkpt>
            <trkpt lat="36.0" lon="-112.0"><time>2026-09-16T10:00:01Z</time></trkpt>
            <trkpt lat="35.001" lon="-112.0"><time>2026-09-16T10:00:02Z</time></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=0.0, filter_noise=True, max_speed_kmh=150.0)
        assert len(track) == 2
        assert track.points[0].lat == 35.0
        assert track.points[1].lat == 35.001


class TestDensification:
    def test_short_segments_undensified(self) -> None:
        # 10m segment with max_step_m = 100m -> no new points
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"></trkpt>
            <trkpt lat="35.0001" lon="-112.0"></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=100.0)
        assert len(track) == 2

    def test_long_segment_densified(self) -> None:
        # ~1110m segment (0.01 deg lat) with max_step_m = 100m -> subdivides into ~12 points
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele></trkpt>
            <trkpt lat="35.01" lon="-112.0"><ele>1120.0</ele></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=100.0)
        assert len(track) >= 11
        # Check monotonic elevation
        for i in range(1, len(track)):
            assert track.points[i].ele > track.points[i - 1].ele

    def test_densified_antimeridian_crossing(self) -> None:
        # Across 180° meridian: 179.99 to -179.99 (0.02 deg ~2.2 km)
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="0.0" lon="179.99"></trkpt>
            <trkpt lat="0.0" lon="-179.99"></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=500.0)
        assert len(track) >= 4
        # Total distance should be ~2.2 km, NOT ~40,000 km
        assert track.total_distance_km < 10.0


class TestDensifyTimestamps:
    """Tests for 3D densification timestamp interpolation across various gap configurations."""

    def test_densify_with_utc_timestamps(self) -> None:
        """Verify densification across a ~1.1km gap with UTC timezone-aware timestamps."""
        p1 = RoutePoint(35.0, -112.0, 1000.0, time=datetime(2026, 9, 16, 10, 0, 0, tzinfo=timezone.utc))
        p2 = RoutePoint(35.01, -112.0, 1100.0, time=datetime(2026, 9, 16, 10, 10, 0, tzinfo=timezone.utc))
        densified = _densify_points([p1, p2], max_step_m=100.0)

        assert len(densified) >= 11
        assert densified[0].time == p1.time
        assert densified[-1].time == p2.time
        for i in range(1, len(densified)):
            curr_t = densified[i].time
            prev_t = densified[i - 1].time
            assert curr_t is not None and prev_t is not None
            assert curr_t > prev_t
            assert curr_t.tzinfo is not None

    def test_densify_with_naive_timestamps(self) -> None:
        """Verify densification across a ~1.1km gap with offset-naive timestamps."""
        p1 = RoutePoint(35.0, -112.0, 1000.0, time=datetime(2026, 9, 16, 10, 0, 0))
        p2 = RoutePoint(35.01, -112.0, 1100.0, time=datetime(2026, 9, 16, 10, 10, 0))
        densified = _densify_points([p1, p2], max_step_m=100.0)

        assert len(densified) >= 11
        assert densified[0].time == p1.time
        assert densified[-1].time == p2.time
        for i in range(1, len(densified)):
            curr_t = densified[i].time
            prev_t = densified[i - 1].time
            assert curr_t is not None and prev_t is not None
            assert curr_t > prev_t
            assert curr_t.tzinfo is None

    def test_densify_mixed_aware_and_naive_timestamps(self) -> None:
        """Verify safe handling when start is naive and end is timezone-aware without TypeError."""
        p1 = RoutePoint(35.0, -112.0, 1000.0, time=datetime(2026, 9, 16, 10, 0, 0))
        p2 = RoutePoint(35.01, -112.0, 1100.0, time=datetime(2026, 9, 16, 10, 10, 0, tzinfo=timezone.utc))
        densified = _densify_points([p1, p2], max_step_m=100.0)

        assert len(densified) >= 11
        for p in densified:
            assert p.time is not None

    def test_densify_multiple_gaps_partial_timestamps(self) -> None:
        """
        Verify multi-gap track with mixed timestamp presence:
        - Gap 1: UTC -> UTC (interpolated timestamps)
        - Gap 2: UTC -> None (None timestamps)
        - Gap 3: None -> None (None timestamps)
        - Gap 4: None -> Naive (None timestamps)
        - Gap 5: Naive -> Naive (interpolated timestamps)
        """
        points = [
            # Gap 1: UTC to UTC
            RoutePoint(35.00, -112.0, 1000.0, time=datetime(2026, 9, 16, 10, 0, 0, tzinfo=timezone.utc)),
            RoutePoint(35.01, -112.0, 1050.0, time=datetime(2026, 9, 16, 10, 10, 0, tzinfo=timezone.utc)),
            # Gap 2: UTC to None
            RoutePoint(35.02, -112.0, 1100.0, time=None),
            # Gap 3: None to None
            RoutePoint(35.03, -112.0, 1150.0, time=None),
            # Gap 4: None to Naive
            RoutePoint(35.04, -112.0, 1200.0, time=datetime(2026, 9, 16, 11, 0, 0)),
            # Gap 5: Naive to Naive
            RoutePoint(35.05, -112.0, 1250.0, time=datetime(2026, 9, 16, 11, 10, 0)),
        ]

        densified = _densify_points(points, max_step_m=200.0)

        # Gap 1 intermediate points must have timestamps
        gap1_intermediates = [p for p in densified if 35.00 < p.lat < 35.01]
        assert len(gap1_intermediates) >= 4
        for p in gap1_intermediates:
            assert p.time is not None
            assert p.time.tzinfo is not None

        # Gap 2 intermediate points (UTC -> None) must have time=None
        gap2_intermediates = [p for p in densified if 35.01 < p.lat < 35.02]
        assert len(gap2_intermediates) >= 4
        for p in gap2_intermediates:
            assert p.time is None

        # Gap 3 intermediate points (None -> None) must have time=None
        gap3_intermediates = [p for p in densified if 35.02 < p.lat < 35.03]
        assert len(gap3_intermediates) >= 4
        for p in gap3_intermediates:
            assert p.time is None

        # Gap 4 intermediate points (None -> Naive) must have time=None
        gap4_intermediates = [p for p in densified if 35.03 < p.lat < 35.04]
        assert len(gap4_intermediates) >= 4
        for p in gap4_intermediates:
            assert p.time is None

        # Gap 5 intermediate points (Naive -> Naive) must have timestamps
        gap5_intermediates = [p for p in densified if 35.04 < p.lat < 35.05]
        assert len(gap5_intermediates) >= 4
        for p in gap5_intermediates:
            assert p.time is not None
            assert p.time.tzinfo is None

    def test_densify_equal_timestamps(self) -> None:
        """Verify densification when consecutive points have identical timestamps."""
        t0 = datetime(2026, 9, 16, 10, 0, 0, tzinfo=timezone.utc)
        p1 = RoutePoint(35.0, -112.0, 1000.0, time=t0)
        p2 = RoutePoint(35.01, -112.0, 1050.0, time=t0)
        densified = _densify_points([p1, p2], max_step_m=100.0)

        assert len(densified) >= 11
        for p in densified:
            assert p.time == t0

    def test_densify_xml_integration_with_trkpt_time(self) -> None:
        """Verify full parse_gpx integration when XML <trkpt> elements have <time> tags."""
        xml = """<gpx version="1.1"><trk><trkseg>
            <trkpt lat="35.0" lon="-112.0"><ele>1000.0</ele><time>2026-09-16T10:00:00Z</time></trkpt>
            <trkpt lat="35.01" lon="-112.0"><ele>1050.0</ele><time>2026-09-16T10:10:00Z</time></trkpt>
        </trkseg></trk></gpx>"""
        track = parse_gpx(xml, densify_step_m=100.0)

        assert len(track.points) >= 11
        assert track.points[0].time == datetime(2026, 9, 16, 10, 0, 0, tzinfo=timezone.utc)
        assert track.points[-1].time == datetime(2026, 9, 16, 10, 10, 0, tzinfo=timezone.utc)
        for i in range(1, len(track.points)):
            assert track.points[i].time is not None
            assert track.points[i].time > track.points[i - 1].time


class TestErrorHandling:
    def test_file_not_found(self) -> None:
        with pytest.raises(FileNotFoundError):
            parse_gpx(Path("/nonexistent/path/route.gpx"))

    def test_empty_file_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "empty.gpx"
        f.write_bytes(b"")
        with pytest.raises(EmptyGPXError):
            parse_gpx(f)

    def test_corrupt_xml_raises(self) -> None:
        with pytest.raises(CorruptedGPXError):
            parse_gpx("<gpx><trk><trkseg></gpx>")

    def test_non_gpx_root_raises(self) -> None:
        with pytest.raises(InvalidGPXError):
            parse_gpx("<kml><Document></Document></kml>")

    def test_zero_points_raises(self) -> None:
        with pytest.raises(EmptyTrackError):
            parse_gpx("<gpx version=\"1.1\"></gpx>")

    def test_only_waypoints_raises_empty_track(self) -> None:
        xml = """<gpx version="1.1">
            <wpt lat="35.0" lon="-112.0"><name>Camp</name></wpt>
        </gpx>"""
        with pytest.raises(EmptyTrackError, match="contains waypoints but no track"):
            parse_gpx(xml)


class TestRealRoutes:
    def test_parse_arizona_trail_300(self) -> None:
        path = Path("route/gpx/arizona-trail-race-300-2025.gpx")
        if not path.exists():
            pytest.skip("Real GPX file not found in workspace")

        track = parse_gpx_track(path, densify_step_m=100.0)
        assert isinstance(track, RouteTrack)
        # Expected distance ~490 km
        assert 480.0 < track.total_distance_km < 510.0
        assert track.min_ele_m > 400.0
        assert track.max_ele_m > 2400.0
        assert track.elevation_gain_m > 8000.0

    def test_parse_atlas_mountain_race(self) -> None:
        path = Path("route/gpx/atlas-mountain-race-2026.gpx")
        if not path.exists():
            pytest.skip("Real GPX file not found in workspace")

        track = parse_gpx_track(path, densify_step_m=200.0)
        assert len(track.waypoints) == 6
        wpt_names = [w.name for w in track.waypoints]
        assert any("shop" in name.lower() or "kalaat" in name.lower() for name in wpt_names)
