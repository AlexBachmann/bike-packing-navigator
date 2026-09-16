"""
Unit tests for engine.enrichment.waypoints: GPX XML waypoint extraction,
orthogonal segment projection, symbol classification, and Place model export.
"""

from io import BytesIO
import pytest

from engine.core.models import CorruptedGPXError, EmptyGPXError, RoutePoint, RouteTrack
from engine.enrichment.waypoints import (
    CustomWaypoint,
    classify_waypoint,
    extract_and_project_waypoints,
    extract_raw_gpx_waypoints,
    project_waypoints_to_track,
)
from engine.utils.spatial import BoundingBox


SAMPLE_NAMESPACED_GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bikepack Navigator" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="39.4909" lon="-105.0942">
    <ele>1675.0</ele>
    <name>Waterton Canyon Trailhead</name>
    <desc>Northern terminus of the Colorado Trail with potable water and restrooms.</desc>
    <sym>Trailhead</sym>
    <type>start</type>
  </wpt>
  <wpt lat="39.3875" lon="-105.2711">
    <ele>2388.0</ele>
    <name>Buffalo Creek General Store</name>
    <desc>Groceries, sandwiches, and cold drinks.</desc>
    <sym>Convenience Store</sym>
    <type>store</type>
  </wpt>
  <wpt lat="39.3000" lon="-105.3500">
    <ele>2450.0</ele>
    <name>Lost Creek Spring</name>
    <desc>Perennial mountain spring 20m from trail.</desc>
    <sym>Water Source</sym>
    <type>spring</type>
  </wpt>
</gpx>
"""

SAMPLE_UNNAMESPACED_GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0">
  <wpt lat="39.1234" lon="-105.5678">
    <ele>2800.0</ele>
    <name>Pine Valley Campground</name>
    <cmt>Paved tent sites and fire rings.</cmt>
    <sym>Campground</sym>
  </wpt>
</gpx>
"""


class TestCustomWaypointModel:
    def test_custom_waypoint_dataclass_initialization(self):
        wp = CustomWaypoint(
            name="Tiger Mine Road Cache",
            lat=32.65,
            lon=-110.85,
            ele=1100.0,
            desc="Metal water box maintained by trail angels.",
            sym="Water",
            category="water",
            route_km=320.5,
            dist_off_route_m=45.0
        )

        assert wp.name == "Tiger Mine Road Cache"
        assert wp.id == "tiger_mine_road_cache"
        assert wp.route_mile == pytest.approx(199.1, abs=0.1)
        assert wp.distance_to_trail_km == 0.045
        assert wp.dist_off_route_m == 45.0

    def test_to_place_dict_conformance(self):
        wp = CustomWaypoint(
            name="Tiger Mine Road Cache",
            lat=32.65,
            lon=-110.85,
            ele=1100.0,
            desc="Metal water box maintained by trail angels.",
            sym="Water",
            category="water",
            route_km=320.5,
            dist_off_route_m=45.0
        )
        pd = wp.to_place_dict()
        assert pd["name"] == "Tiger Mine Road Cache"
        assert pd["category"] == "water"
        assert pd["location"] == {"lat": 32.65, "lon": -110.85}
        assert pd["route_km"] == 320.5
        assert pd["distance_to_trail_km"] == 0.045
        assert pd["elevation"] == 1100
        assert pd["description"] == "Metal water box maintained by trail angels."


class TestGPXParsing:
    def test_extract_namespaced_gpx_11(self):
        wps = extract_raw_gpx_waypoints(SAMPLE_NAMESPACED_GPX)
        assert len(wps) == 3

        w1 = wps[0]
        assert w1.name == "Waterton Canyon Trailhead"
        assert w1.lat == 39.4909
        assert w1.lon == -105.0942
        assert w1.ele == 1675.0
        assert "Northern terminus" in w1.desc

        w2 = wps[1]
        assert w2.name == "Buffalo Creek General Store"
        assert w2.category == "grocery"

        w3 = wps[2]
        assert w3.name == "Lost Creek Spring"
        assert w3.category == "water"

    def test_extract_unnamespaced_gpx(self):
        wps = extract_raw_gpx_waypoints(SAMPLE_UNNAMESPACED_GPX)
        assert len(wps) == 1
        w = wps[0]
        assert w.name == "Pine Valley Campground"
        assert w.category == "campground"
        assert w.ele == 2800.0

    def test_extract_from_bytes(self):
        raw_bytes = SAMPLE_UNNAMESPACED_GPX.encode("utf-8")
        wps = extract_raw_gpx_waypoints(raw_bytes)
        assert len(wps) == 1

    def test_extract_optional_tags(self):
        minimal_xml = """<gpx><wpt lat="39.0" lon="-105.0"></wpt></gpx>"""
        wps = extract_raw_gpx_waypoints(minimal_xml)
        assert len(wps) == 1
        assert wps[0].name == "Waypoint"
        assert wps[0].ele is None
        assert wps[0].desc == ""

    def test_corrupted_gpx_raises_error(self):
        with pytest.raises(CorruptedGPXError):
            extract_raw_gpx_waypoints("<gpx><wpt lat='39.0'>unclosed</gpx>")

    def test_empty_gpx_raises_error(self):
        with pytest.raises(EmptyGPXError):
            extract_raw_gpx_waypoints("")
        with pytest.raises(EmptyGPXError):
            extract_raw_gpx_waypoints(b"   ")


class TestWaypointClassification:
    def test_classify_water_symbols(self):
        cat, wtype, in_town = classify_waypoint("Spring #4", sym="Water Source")
        assert cat == "water"
        assert wtype == "water"
        assert in_town is False

        cat2, _, _ = classify_waypoint("Desert Spigot", desc="Reliable potable water tap")
        assert cat2 == "water"

    def test_classify_camp_symbols(self):
        cat, wtype, _ = classify_waypoint("Dispersed Site", sym="Tent", desc="Primitive wild camp")
        assert cat == "campground"
        assert wtype == "campground"

    def test_classify_grocery_and_food(self):
        cat_g, _, in_town = classify_waypoint("Village Mercado", sym="Shopping")
        assert cat_g == "grocery"
        assert in_town is True

        cat_f, _, _ = classify_waypoint("Bakery & Espresso", desc="Fresh pastry and hot soup")
        assert cat_f == "food"

    def test_classify_bike_shop(self):
        cat, wtype, _ = classify_waypoint("Trail Repair Works", sym="Wrench")
        assert cat == "bike_shop"

    def test_classify_race_checkpoints(self):
        cat, wtype, in_town = classify_waypoint("CP1: Mount Smolikas Refuge", sym="Flag")
        assert cat == "town"
        assert wtype == "checkpoint"
        assert in_town is True

    def test_classify_hazard_alerts(self):
        cat, wtype, _ = classify_waypoint("Caution: Extreme Scree Field", sym="Skull")
        assert cat == "caution"
        assert wtype == "danger"


class TestWaypointProjection:
    @pytest.fixture
    def straight_track(self):
        # 10 km straight track from south to north along lon -105.000
        # 1 deg lat is approx 111.139 km, so 0.01 deg is approx 1.111 km
        pts = [
            RoutePoint(lat=39.0 + (i * 0.01), lon=-105.0, ele=2000.0, cum_km=i * 1.111, cum_mi=(i * 1.111) * 0.621371)
            for i in range(10)
        ]
        return RouteTrack(
            points=pts,
            bbox=BoundingBox(39.0, -105.0, 39.09, -105.0),
            total_distance_km=9.999
        )

    def test_projection_and_distance_calculation(self, straight_track):
        # Waypoint placed at lat 39.05, lon -105.0006 (~51m west of trail)
        wps = [
            CustomWaypoint(name="Trailside Well", lat=39.05, lon=-105.0006)
        ]

        projected = project_waypoints_to_track(wps, straight_track, max_distance_m=500.0)
        assert len(projected) == 1
        p = projected[0]
        assert p.route_km == pytest.approx(5.55, abs=0.1)
        assert p.dist_off_route_m == pytest.approx(51.0, abs=5.0)
        assert p.distance_to_trail_km == pytest.approx(0.051, abs=0.01)

    def test_max_dist_m_filtering(self, straight_track):
        # Waypoint placed 15 km away from trail
        wps = [
            CustomWaypoint(name="Distant Lookout", lat=39.05, lon=-105.15)
        ]
        projected = project_waypoints_to_track(wps, straight_track, max_distance_m=1000.0)
        assert len(projected) == 0

    def test_monotonic_route_km_sorting(self, straight_track):
        wps = [
            CustomWaypoint(name="WP Far", lat=39.08, lon=-105.0),
            CustomWaypoint(name="WP Near", lat=39.02, lon=-105.0),
            CustomWaypoint(name="WP Mid", lat=39.05, lon=-105.0),
        ]
        projected = project_waypoints_to_track(wps, straight_track)
        assert len(projected) == 3
        assert projected[0].name == "WP Near"
        assert projected[1].name == "WP Mid"
        assert projected[2].name == "WP Far"
        assert projected[0].route_km < projected[1].route_km < projected[2].route_km

    def test_slug_uniqueness_on_duplicate_names(self, straight_track):
        wps = [
            CustomWaypoint(name="Spring", lat=39.02, lon=-105.0),
            CustomWaypoint(name="Spring", lat=39.06, lon=-105.0),
        ]
        projected = project_waypoints_to_track(wps, straight_track)
        assert len(projected) == 2
        assert projected[0].id == "spring"
        assert projected[1].id == "spring_1"

    def test_extract_and_project_waypoints_convenience(self, straight_track):
        gpx = """<gpx version="1.1"><wpt lat="39.03" lon="-105.0"><name>Camp</name></wpt></gpx>"""
        projected = extract_and_project_waypoints(gpx, straight_track)
        assert len(projected) == 1
        assert projected[0].name == "Camp"
        assert projected[0].route_km > 0.0

    def test_perpendicular_projection_midway_between_spaced_vertices(self):
        """
        Verify that a waypoint placed midway between two track vertices spaced 1.1km apart
        measures orthogonal perpendicular distance to the segment rather than the hypotenuse
        to the nearest vertex, and is retained within a 500m corridor.
        """
        pts = [
            RoutePoint(lat=39.00, lon=-105.0, ele=2000.0, cum_km=0.0, cum_mi=0.0),
            RoutePoint(lat=39.01, lon=-105.0, ele=2000.0, cum_km=1.111, cum_mi=0.69)
        ]
        track = RouteTrack(points=pts, bbox=BoundingBox(39.0, -105.0, 39.01, -105.0), total_distance_km=1.111)
        wp = CustomWaypoint(name="Midpoint Spring", lat=39.005, lon=-105.001)

        # Perpendicular distance is ~86.4m, route_km is ~0.556km
        # Hypothetical nearest vertex hypotenuse is ~563m
        projected = project_waypoints_to_track([wp], track, max_distance_m=500.0)

        assert len(projected) == 1
        p = projected[0]
        assert p.name == "Midpoint Spring"
        assert p.dist_off_route_m == pytest.approx(86.4, abs=1.0)
        assert p.route_km == pytest.approx(0.556, abs=0.01)
        assert p.distance_to_trail_km == pytest.approx(0.086, abs=0.01)
        assert p.route_mile == pytest.approx(0.35, abs=0.1)

    def test_perpendicular_projection_indexed_track(self):
        """
        Verify that TrackIndex accelerated candidate segment querying accurately
        projects midway waypoints on multi-vertex tracks.
        """
        from engine.utils.spatial import TrackIndex

        pts = [
            RoutePoint(lat=39.0 + (i * 0.001), lon=-105.0, ele=2000.0, cum_km=round(i * 0.111, 3), cum_mi=round(i * 0.069, 3))
            for i in range(100)
        ]
        track = RouteTrack(points=pts, bbox=BoundingBox(39.0, -105.0, 39.099, -105.0), total_distance_km=10.989)
        t_index = TrackIndex([p.to_list_5d() for p in pts])

        # Waypoint midway between vertex 10 (lat 39.010, km 1.110) and vertex 11 (lat 39.011, km 1.221)
        wp = CustomWaypoint(name="Midway Spring", lat=39.0105, lon=-105.001)

        projected = project_waypoints_to_track([wp], track, max_distance_m=500.0, track_index=t_index)
        assert len(projected) == 1
        p = projected[0]
        assert p.dist_off_route_m == pytest.approx(86.4, abs=1.0)
        assert p.route_km == pytest.approx(1.166, abs=0.01)

    def test_perpendicular_projection_dropped_when_exceeding_threshold(self):
        """
        Verify that a waypoint whose perpendicular distance exceeds max_distance_m is filtered out.
        """
        pts = [
            RoutePoint(lat=39.00, lon=-105.0, ele=2000.0, cum_km=0.0, cum_mi=0.0),
            RoutePoint(lat=39.01, lon=-105.0, ele=2000.0, cum_km=1.111, cum_mi=0.69)
        ]
        track = RouteTrack(points=pts, bbox=BoundingBox(39.0, -105.0, 39.01, -105.0), total_distance_km=1.111)
        # Offset ~864m off-route
        wp = CustomWaypoint(name="Distant Spring", lat=39.005, lon=-105.01)

        projected = project_waypoints_to_track([wp], track, max_distance_m=500.0)
        assert len(projected) == 0

