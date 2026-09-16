"""
Unit tests for engine.enrichment.water: 4-tier hierarchical water priority scoring,
tag classification, 200m spatial deduplication, 5km segment throttling, and dry gap analysis.
"""

import pytest

from engine.core.models import RoutePoint, RouteTrack
from engine.enrichment.water import (
    WaterReliability,
    WaterTier,
    WaterWaypoint,
    analyze_water_gaps,
    classify_osm_water_feature,
    deduplicate_water_waypoints,
    extract_water_access,
    parse_corridor_water_features,
    throttle_water_segments,
    water_priority_score,
)
from engine.utils.spatial import BoundingBox


class TestWaterWaypointDataclass:
    def test_initialization_and_properties(self):
        wp = WaterWaypoint(
            id="water_test_1",
            name="Cascade Spring",
            type="water",
            km=14.2345,
            mile=0.0,
            elevation_m=2450.4,
            dist_off_route_m=25.6,
            coordinates=(39.12345, -105.98765),
            reliability="reliable",
            treatment_required=True,
            source_type="spring",
            tier=2
        )

        assert wp.km == 14.235
        assert wp.mile == pytest.approx(8.845, abs=0.01)
        assert wp.elevation_m == 2450.4
        assert wp.distance_to_trail_km == 0.026
        assert wp.dist_off_route_m == 25.6

    def test_to_dict_domain_schema(self):
        wp = WaterWaypoint(
            id="w1",
            name="Town Fountain",
            km=5.0,
            dist_off_route_m=10.0,
            coordinates=(39.5, -105.2),
            reliability="reliable",
            treatment_required=False,
            source_type="amenity",
            tier=1
        )
        d = wp.to_dict()
        assert d["id"] == "w1"
        assert d["name"] == "Town Fountain"
        assert d["treatment_required"] is False
        assert d["tier"] == 1
        assert d["coordinates"] == [39.5, -105.2]

    def test_to_places_dict_compatibility(self):
        wp = WaterWaypoint(
            id="w_places",
            name="Silver Spring",
            km=12.5,
            dist_off_route_m=15.0,
            coordinates=(39.4, -105.3),
            reliability="reliable",
            treatment_required=True,
            source_type="spring",
            tier=2
        )
        pd = wp.to_places_dict()
        assert pd["category"] == "water"
        assert pd["type"] == "water"
        assert pd["is_in_town"] is False
        assert pd["location"] == {"lat": 39.4, "lon": -105.3}
        assert pd["distance_to_trail_km"] == 0.015
        assert pd["route_km"] == 12.5
        assert pd["reliability"] == "reliable"
        assert pd["treatment_required"] is True
        assert "filtration/treatment required" in pd["description"]


class TestWaterPriorityScoring:
    def test_tier_1_beats_tiers_2_3_4(self):
        t1 = WaterWaypoint(id="t1", name="Town Spigot", tier=1, reliability="reliable", dist_off_route_m=100.0)
        t2 = WaterWaypoint(id="t2", name="Mountain Spring", tier=2, reliability="reliable", dist_off_route_m=5.0)
        t3 = WaterWaypoint(id="t3", name="River Crossing", tier=3, reliability="treatment_required", dist_off_route_m=0.0)
        t4 = WaterWaypoint(id="t4", name="Reservoir Shore", tier=4, reliability="treatment_required", dist_off_route_m=2.0)

        assert water_priority_score(t1) < water_priority_score(t2)
        assert water_priority_score(t1) < water_priority_score(t3)
        assert water_priority_score(t1) < water_priority_score(t4)

    def test_tier_2_beats_tiers_3_4(self):
        t2 = WaterWaypoint(id="t2", name="Natural Spring", tier=2, reliability="reliable", dist_off_route_m=10.0)
        t3 = WaterWaypoint(id="t3", name="Creek Access", tier=3, reliability="treatment_required", dist_off_route_m=0.0)
        t4 = WaterWaypoint(id="t4", name="Lake Access", tier=4, reliability="treatment_required", dist_off_route_m=0.0)

        assert water_priority_score(t2) < water_priority_score(t3)
        assert water_priority_score(t2) < water_priority_score(t4)

    def test_tier_3_beats_tier_4(self):
        t3 = WaterWaypoint(id="t3", name="Stream", tier=3, reliability="treatment_required", dist_off_route_m=5.0)
        t4 = WaterWaypoint(id="t4", name="Muddy Pond", tier=4, reliability="emergency_only", dist_off_route_m=0.0)

        assert water_priority_score(t3) < water_priority_score(t4)

    def test_reliability_tie_breaking_within_tier(self):
        w_rel = WaterWaypoint(id="w1", name="Perennial Spring", tier=2, reliability="reliable", dist_off_route_m=20.0)
        w_seas = WaterWaypoint(id="w2", name="Seasonal Spring", tier=2, reliability="seasonal", dist_off_route_m=5.0)

        # Reliable beats seasonal even if seasonal is closer to trail
        assert water_priority_score(w_rel) < water_priority_score(w_seas)

    def test_distance_tie_breaking_within_tier_and_reliability(self):
        w_close = WaterWaypoint(id="w1", name="Trailside Tap", tier=1, reliability="reliable", dist_off_route_m=5.0)
        w_far = WaterWaypoint(id="w2", name="Distant Tap", tier=1, reliability="reliable", dist_off_route_m=80.0)

        assert water_priority_score(w_close) < water_priority_score(w_far)


class TestReliabilityAndTreatmentClassification:
    def test_amenity_drinking_water_potable_and_reliable(self):
        tags = {"amenity": "drinking_water", "name": "Park Fountain"}
        tier, stype, rel, treat, label = classify_osm_water_feature(tags)
        assert tier == WaterTier.POTABLE_AMENITY
        assert stype == "amenity"
        assert rel == WaterReliability.RELIABLE
        assert treat is False
        assert label == "Drinking Water"

    def test_drinking_water_yes_promotes_spring_to_tier_1(self):
        tags = {"natural": "spring", "drinking_water": "yes", "name": "Potable Mineral Spring"}
        tier, stype, rel, treat, label = classify_osm_water_feature(tags)
        assert tier == WaterTier.POTABLE_AMENITY
        assert treat is False

    def test_natural_spring_untreated_reliable(self):
        tags = {"natural": "spring", "name": "Big Spring"}
        tier, stype, rel, treat, label = classify_osm_water_feature(tags)
        assert tier == WaterTier.NATURAL_SPRING
        assert stype == "spring"
        assert rel == WaterReliability.RELIABLE
        assert treat is True

    def test_intermittent_and_seasonal_springs(self):
        tags1 = {"natural": "spring", "intermittent": "yes", "name": "Gulch Spring"}
        tier1, _, rel1, treat1, _ = classify_osm_water_feature(tags1)
        assert tier1 == WaterTier.NATURAL_SPRING
        assert rel1 == WaterReliability.SEASONAL
        assert treat1 is True

        tags2 = {"natural": "spring", "seasonal": "spring", "name": "Snowmelt Spring"}
        _, _, rel2, _, _ = classify_osm_water_feature(tags2)
        assert rel2 == WaterReliability.SEASONAL

    def test_surface_streams_require_treatment(self):
        tags = {"waterway": "stream", "name": "Rock Creek"}
        tier, stype, rel, treat, label = classify_osm_water_feature(tags)
        assert tier == WaterTier.STREAM_RIVER
        assert stype == "stream"
        assert rel == WaterReliability.TREATMENT_REQUIRED
        assert treat is True
        assert label == "Creek Access"

    def test_stagnant_pond_and_ditches_emergency_only(self):
        tags = {"water": "pond", "natural": "water", "name": "Cattle Pond"}
        tier, stype, rel, treat, label = classify_osm_water_feature(tags)
        assert tier == WaterTier.LAKE_RESERVOIR
        assert rel == WaterReliability.EMERGENCY_ONLY
        assert treat is True


class TestWaterSpatialDeduplication200m:
    def test_deduplicates_within_200m(self):
        w1 = WaterWaypoint(id="w1", name="Creek 1", km=10.00, tier=3, dist_off_route_m=5.0)
        w2 = WaterWaypoint(id="w2", name="Creek 2", km=10.15, tier=3, dist_off_route_m=10.0)

        deduped = deduplicate_water_waypoints([w1, w2], threshold_m=200.0)
        assert len(deduped) == 1
        assert deduped[0].id == "w1"

    def test_higher_priority_replaces_lower_priority_in_dedup(self):
        # Stream at km 10.0 (Tier 3), followed by Potable Fountain at km 10.10 (Tier 1)
        stream = WaterWaypoint(id="w1", name="Boulder Creek", km=10.00, tier=3, reliability="treatment_required", dist_off_route_m=0.0)
        fountain = WaterWaypoint(id="w2", name="Park Fountain", km=10.10, tier=1, reliability="reliable", dist_off_route_m=15.0)

        deduped = deduplicate_water_waypoints([stream, fountain], threshold_m=200.0)
        assert len(deduped) == 1
        # Tier 1 replaces Tier 3!
        assert deduped[0].id == "w2"
        assert deduped[0].name == "Park Fountain"

    def test_preserves_candidates_beyond_200m(self):
        w1 = WaterWaypoint(id="w1", name="Spring A", km=10.00, tier=2)
        w2 = WaterWaypoint(id="w2", name="Spring B", km=10.25, tier=2)

        deduped = deduplicate_water_waypoints([w1, w2], threshold_m=200.0)
        assert len(deduped) == 2

    def test_empty_candidates_returns_empty(self):
        assert deduplicate_water_waypoints([]) == []


class TestWaterSegmentThrottling5km:
    def test_throttles_multiple_sources_to_one_per_5km(self):
        # 5 streams in the same 5km bucket [km 5.0 to 10.0]
        sources = [
            WaterWaypoint(id="w1", name="Stream 1", km=5.2, tier=3, dist_off_route_m=20.0),
            WaterWaypoint(id="w2", name="Stream 2", km=6.1, tier=3, dist_off_route_m=10.0),
            WaterWaypoint(id="w3", name="Spring 3", km=7.0, tier=2, dist_off_route_m=15.0), # Highest priority (Tier 2)
            WaterWaypoint(id="w4", name="Stream 4", km=8.4, tier=3, dist_off_route_m=5.0),
            WaterWaypoint(id="w5", name="Stream 5", km=9.5, tier=3, dist_off_route_m=25.0),
        ]

        throttled = throttle_water_segments(sources, segment_km=5.0, min_spacing_km=3.75)
        assert len(throttled) == 1
        assert throttled[0].id == "w3"  # Selected Tier 2 spring

    def test_anti_crowding_boundary_filter(self):
        # Bucket 1 [0..5km]: winner at km 4.8
        # Bucket 2 [5..10km]: winner at km 5.2
        # Distance = 0.4 km < 3.75 km min spacing
        w1 = WaterWaypoint(id="w1", name="Spring 1", km=4.8, tier=2, dist_off_route_m=10.0)
        w2 = WaterWaypoint(id="w2", name="Stream 2", km=5.2, tier=3, dist_off_route_m=5.0)

        throttled = throttle_water_segments([w1, w2], segment_km=5.0, min_spacing_km=3.75)
        assert len(throttled) == 1
        assert throttled[0].id == "w1"  # Retained higher priority w1

    def test_anti_crowding_replaces_with_higher_priority(self):
        # Boundary conflict where the second point has higher priority
        w1 = WaterWaypoint(id="w1", name="Stream 1", km=4.9, tier=3, dist_off_route_m=10.0)
        w2 = WaterWaypoint(id="w2", name="Town Fountain 2", km=5.1, tier=1, dist_off_route_m=5.0)

        throttled = throttle_water_segments([w1, w2], segment_km=5.0, min_spacing_km=3.75)
        assert len(throttled) == 1
        assert throttled[0].id == "w2"  # Tier 1 replaced Tier 3

    def test_arid_zone_sparse_sources_preserved(self):
        # Remote sources separated by > 10 km: none should be throttled
        sources = [
            WaterWaypoint(id="w1", name="Freeman Road Cache", km=15.0, tier=1),
            WaterWaypoint(id="w2", name="Ripsey Spring", km=32.0, tier=2),
            WaterWaypoint(id="w3", name="Gila River Access", km=55.0, tier=3),
        ]
        throttled = throttle_water_segments(sources, segment_km=5.0)
        assert len(throttled) == 3


class TestOSMCorridorParsing:
    def test_parse_overpass_elements_node_and_way(self):
        overpass_data = {
            "elements": [
                {
                    "type": "node",
                    "id": 12345,
                    "lat": 39.5,
                    "lon": -105.2,
                    "tags": {"amenity": "drinking_water", "name": "Trailhead Tap"}
                },
                {
                    "type": "way",
                    "id": 67890,
                    "geometry": [
                        {"lat": 39.51, "lon": -105.21},
                        {"lat": 39.52, "lon": -105.22}
                    ],
                    "tags": {"waterway": "stream", "name": "Bear Creek"}
                }
            ]
        }
        features = parse_corridor_water_features(overpass_data)
        assert len(features) == 2
        assert features[0]["osm_id"] == 12345
        assert features[0]["coords"] == [(39.5, -105.2)]
        assert len(features[1]["coords"]) == 2

    def test_parse_geojson_feature_collection(self):
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "id": 999,
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-105.5, 39.8]  # lon, lat
                    },
                    "properties": {
                        "natural": "spring",
                        "name": "Eagle Spring"
                    }
                }
            ]
        }
        features = parse_corridor_water_features(geojson)
        assert len(features) == 1
        assert features[0]["osm_id"] == 999
        # Correctly converted to lat, lon
        assert features[0]["coords"] == [(39.8, -105.5)]


class TestExtractWaterAccessPipeline:
    @pytest.fixture
    def track(self):
        pts = [
            RoutePoint(lat=39.0 + (i * 0.01), lon=-105.0, ele=2000.0, cum_km=i * 1.11, cum_mi=(i * 1.11) * 0.621371)
            for i in range(30)
        ]
        total_km = pts[-1].cum_km
        bbox = BoundingBox(min_lat=39.0, min_lon=-105.0, max_lat=39.29, max_lon=-105.0)
        return RouteTrack(points=pts, bbox=bbox, total_distance_km=total_km)

    def test_end_to_end_synthetic_corridor_extraction(self, track):
        corridor = {
            "elements": [
                {
                    "type": "node",
                    "id": 101,
                    "lat": 39.05,
                    "lon": -105.0005,  # ~40m off trail at km ~5.5
                    "tags": {"natural": "spring", "name": "Pine Spring"}
                },
                {
                    "type": "node",
                    "id": 102,
                    "lat": 39.15,
                    "lon": -105.0002,  # ~16m off trail at km ~16.6
                    "tags": {"amenity": "drinking_water", "name": "Ranger Station Tap"}
                }
            ]
        }

        wps = extract_water_access(corridor, track, max_distance_m=500.0)
        assert len(wps) == 2
        assert wps[0].name.startswith("Pine Spring")
        assert wps[1].name.startswith("Ranger Station Tap")
        assert wps[0].km < wps[1].km

    def test_respects_max_dist_threshold(self, track):
        distant_corridor = {
            "elements": [
                {
                    "type": "node",
                    "id": 201,
                    "lat": 39.10,
                    "lon": -105.05,  # ~4.3 km away from trail
                    "tags": {"natural": "spring", "name": "Distant Spring"}
                }
            ]
        }
        wps = extract_water_access(distant_corridor, track, max_distance_m=500.0)
        assert len(wps) == 0


class TestWaterGapAnalysis:
    def test_detects_arid_gap_exceeding_threshold(self):
        wps = [
            WaterWaypoint(id="w1", name="Start Springs", km=10.0),
            WaterWaypoint(id="w2", name="End Creek", km=55.0),  # 45km gap
        ]
        gaps = analyze_water_gaps(wps, total_km=70.0, alert_threshold_km=30.0)
        assert len(gaps) >= 1
        assert gaps[0]["gap_km"] == 45.0
        assert "45.0 km without reliable water" in gaps[0]["warning"]

    def test_no_alerts_when_water_is_frequent(self):
        wps = [
            WaterWaypoint(id="w1", name="Water 1", km=10.0),
            WaterWaypoint(id="w2", name="Water 2", km=25.0),
            WaterWaypoint(id="w3", name="Water 3", km=40.0),
        ]
        gaps = analyze_water_gaps(wps, total_km=50.0, alert_threshold_km=30.0)
        assert len(gaps) == 0
