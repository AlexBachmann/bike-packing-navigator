"""
Unit tests for engine.enrichment.milestones: navigation milestones, town discovery,
resupply interval calculations, elevation metrics, and max dry stretch analysis.
"""

import pytest

from engine.core.models import RoutePoint, RouteTrack
from engine.enrichment.milestones import (
    MilestoneType,
    ResupplyInterval,
    RouteMilestone,
    ServiceType,
    calculate_max_dry_stretch,
    compute_resupply_intervals,
    generate_route_milestones,
)
from engine.utils.spatial import BoundingBox


class TestRouteMilestoneModel:
    def test_route_milestone_dataclass_initialization(self):
        ms = RouteMilestone(
            km=45.28,
            name="Buffalo Creek, CO",
            type="town",
            services=["food", "water", "bike_shop"],
            elevation_m=2388.4,
            coordinates=(39.3875, -105.2711),
            state="CO",
            description="Pike National Forest mountain bike outpost."
        )

        assert ms.km == 45.28
        assert ms.mile == pytest.approx(28.1, abs=0.1)
        assert ms.elevation == 2388
        assert ms.elevation_m == 2388.4
        assert ms.state == "CO"

        d = ms.to_dict()
        assert d["name"] == "Buffalo Creek, CO"
        assert d["km"] == 45.3
        assert d["mile"] == 28.1
        assert d["elevation"] == 2388
        assert d["services"] == ["food", "water", "bike_shop"]
        assert d["coordinates"] == [39.3875, -105.2711]

    def test_to_milestone_json_backward_compatibility(self):
        ms = RouteMilestone(
            km=0.0,
            name="Waterton Canyon Trailhead, CO",
            type="start",
            elevation_m=1675.0,
            state="CO"
        )
        mj = ms.to_milestone_json()
        assert mj["name"] == "Waterton Canyon Trailhead, CO"
        assert mj["mile"] == 0.0
        assert mj["km"] == 0.0
        assert mj["elevation"] == 1675
        assert mj["state"] == "CO"
        assert mj["type"] == "start"


class TestResupplyIntervalModel:
    def test_resupply_interval_dataclass_conversions(self):
        interval = ResupplyInterval(
            from_milestone="Waterton Canyon",
            to_milestone="Buffalo Creek",
            start_km=0.0,
            end_km=45.3,
            distance_km=45.3,
            elevation_gain_m=1200.0,
            elevation_loss_m=486.0,
            max_dry_stretch_km=27.2,
            water_points_count=2,
            services=["food", "water"]
        )

        assert interval.distance_mi == pytest.approx(28.1, abs=0.1)
        assert interval.elevation_gain_ft == pytest.approx(3937, abs=5)
        assert interval.elevation_loss_ft == pytest.approx(1594, abs=5)
        assert interval.max_dry_stretch_mi == pytest.approx(16.9, abs=0.1)

        d = interval.to_dict()
        # Verify snake_case domain keys
        assert d["from_milestone"] == "Waterton Canyon"
        assert d["distance_km"] == 45.3
        assert d["elevation_gain_m"] == 1200
        assert d["max_dry_stretch_km"] == 27.2
        # Verify camelCase frontend keys
        assert d["fromMilestone"] == "Waterton Canyon"
        assert d["distanceKm"] == 45.3
        assert d["elevationGainM"] == 1200
        assert d["maxDryStretchKm"] == 27.2


class TestMaxDryStretchCalculation:
    def test_max_dry_stretch_with_water_points(self):
        # 100km interval with water at km 30.0 and km 75.0
        # Gaps: 0->30 (30km), 30->75 (45km), 75->100 (25km)
        water_pts = [30.0, 75.0]
        max_dry = calculate_max_dry_stretch(0.0, 100.0, water_pts)
        assert max_dry == 45.0

    def test_max_dry_stretch_without_water(self):
        # 100km interval with 0 water points
        max_dry = calculate_max_dry_stretch(0.0, 100.0, [])
        assert max_dry == 100.0

    def test_max_dry_stretch_with_water_waypoint_objects(self):
        class DummyWater:
            def __init__(self, km, rel="reliable"):
                self.km = km
                self.reliability = rel

        water_objs = [DummyWater(20.0), DummyWater(40.0), DummyWater(85.0)]
        max_dry = calculate_max_dry_stretch(0.0, 100.0, water_objs)
        # Gaps: 0->20 (20), 20->40 (20), 40->85 (45), 85->100 (15)
        assert max_dry == 45.0


class TestGenerateRouteMilestones:
    @pytest.fixture
    def track_100km(self):
        # 100 km synthetic track from south to north along lon -105.0
        pts = []
        for i in range(101):
            km = float(i)
            lat = 39.0 + (km / 111.0)
            ele = 2000.0 + (500.0 * (i / 100.0))  # 500m steady climb
            pts.append(RoutePoint(lat=lat, lon=-105.0, ele=ele, cum_km=km, cum_mi=km * 0.621371))

        bbox = BoundingBox(min_lat=39.0, min_lon=-105.0, max_lat=pts[-1].lat, max_lon=-105.0)
        return RouteTrack(points=pts, bbox=bbox, total_distance_km=100.0)

    def test_start_and_finish_always_present(self, track_100km):
        ms = generate_route_milestones(
            track=track_100km,
            start_name="Denver Trailhead",
            end_name="Breckenridge Terminus"
        )

        assert len(ms) >= 2
        assert ms[0].km == 0.0
        assert ms[0].type == "start"
        assert ms[0].name == "Denver Trailhead"

        assert ms[-1].km == 100.0
        assert ms[-1].type == "finish"
        assert ms[-1].name == "Breckenridge Terminus"

    def test_town_ingestion_and_projection(self, track_100km):
        towns = [
            {"name": "Midway Town", "lat": 39.4, "lon": -105.0, "services": ["food", "hotel"]}
        ]
        ms = generate_route_milestones(track=track_100km, towns=towns)

        town_ms = [m for m in ms if m.name == "Midway Town"]
        assert len(town_ms) == 1
        assert town_ms[0].type == "town"
        assert town_ms[0].km > 0.0 and town_ms[0].km < 100.0
        assert town_ms[0].services == ["food", "hotel"]

    def test_town_deduplication(self, track_100km):
        # Two towns within 2 km of each other along route
        towns = [
            {"name": "Twin A", "km": 40.0, "services": ["food"]},
            {"name": "Twin B", "km": 41.5, "services": ["food", "lodging"]}
        ]
        ms = generate_route_milestones(track=track_100km, towns=towns, min_spacing_km=5.0)
        twin_ms = [m for m in ms if "Twin" in m.name]
        assert len(twin_ms) == 1

    def test_distance_to_next_km_accuracy(self, track_100km):
        towns = [{"name": "Town 35", "km": 35.0}, {"name": "Town 70", "km": 70.0}]
        ms = generate_route_milestones(track=track_100km, towns=towns)

        for i in range(len(ms) - 1):
            expected_dist = round(ms[i + 1].km - ms[i].km, 1)
            assert ms[i].distance_to_next_km == expected_dist
        assert ms[-1].distance_to_next_km == 0.0

    def test_interval_checkpoints_for_remote_route(self):
        # 160 km route with 0 intermediate towns
        pts = [
            RoutePoint(lat=39.0 + (i * 0.01), lon=-105.0, ele=1500.0, cum_km=i * 2.0, cum_mi=(i * 2.0) * 0.621371)
            for i in range(81)
        ]
        track = RouteTrack(
            points=pts,
            bbox=BoundingBox(39.0, -105.0, 39.8, -105.0),
            total_distance_km=160.0
        )

        ms = generate_route_milestones(track=track, interval_km=45.0)
        # Expect Start, Checkpoint Km 45, Checkpoint Km 90, Checkpoint Km 135, Finish
        checkpoint_names = [m.name for m in ms if m.type == "checkpoint"]
        assert len(checkpoint_names) >= 2

    def test_empty_track_raises_error(self):
        with pytest.raises(ValueError):
            generate_route_milestones(track=[])


class TestComputeResupplyIntervals:
    def test_elevation_gain_between_towns(self):
        # Track with 20 km climb (+600m), then 20 km descent (-400m)
        pts = []
        for i in range(21):
            km = float(i)
            pts.append(RoutePoint(lat=39.0 + (km * 0.01), lon=-105.0, ele=2000.0 + (i * 30.0), cum_km=km))
        for i in range(1, 21):
            km = 20.0 + float(i)
            pts.append(RoutePoint(lat=39.0 + (km * 0.01), lon=-105.0, ele=2600.0 - (i * 20.0), cum_km=km))

        track = RouteTrack(points=pts, bbox=BoundingBox(39.0, -105.0, 39.4, -105.0), total_distance_km=40.0)

        milestones = [
            RouteMilestone(km=0.0, name="Valley Start", type="start", elevation_m=2000.0),
            RouteMilestone(km=40.0, name="Pass Finish", type="finish", elevation_m=2200.0)
        ]

        intervals = compute_resupply_intervals(milestones, track, water_waypoints=[20.0])
        assert len(intervals) == 1
        intv = intervals[0]
        assert intv.distance_km == 40.0
        assert intv.elevation_gain_m == pytest.approx(600.0, abs=1.0)
        assert intv.elevation_loss_m == pytest.approx(400.0, abs=1.0)
        assert intv.water_points_count == 1
        assert intv.max_dry_stretch_km == 20.0
