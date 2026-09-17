"""
engine/tests/test_terrain_climbs.py - Unit tests for climb detection, Fiets difficulty scoring,
UCI categorization, rolling-window maximum grade, and surface enrichment.
"""

import pytest

from engine.terrain.climbs import (
    Climb,
    ClimbCategory,
    annotate_climb_surfaces,
    apply_curated_climbs,
    calculate_fiets_index,
    classify_climb_category,
    compute_rolling_max_grade,
    detect_climbs,
    enrich_climbs_geographic_identity,
    extract_dominant_trail_name,
    extract_osm_boundaries,
    extract_osm_peaks,
    find_nearby_landmark,
    generate_evocative_climb_name,
    generate_tactical_climb_notes,
    is_curated_climb_list,
    is_point_in_boundary,
    load_curated_climbs,
)


@pytest.mark.unit
class TestFietsIndex:
    """Tests for the Fiets difficulty index formula."""

    def test_fiets_basic_formula(self):
        # 1000m gain over 10,000m (10 km at 10%), summit at 900m (no altitude bonus)
        # Fiets = (1000^2) / (10000 * 10) + 0 = 10.0
        score = calculate_fiets_index(elevation_gain_m=1000.0, length_m=10000.0, summit_elevation_m=900.0)
        assert score == 10.0

    def test_fiets_altitude_bonus(self):
        # Same climb, but summit at 3000m
        # Bonus = (3000 - 1000) / 1000 = 2.0 -> Total = 12.0
        score = calculate_fiets_index(elevation_gain_m=1000.0, length_m=10000.0, summit_elevation_m=3000.0)
        assert score == 12.0

    def test_fiets_flat_or_negative_returns_zero(self):
        assert calculate_fiets_index(0.0, 5000.0) == 0.0
        assert calculate_fiets_index(-50.0, 5000.0) == 0.0
        assert calculate_fiets_index(100.0, 0.0) == 0.0

    def test_fiets_quadratic_steepness_weighting(self):
        # 5 km at 10% (gain 500m) vs 10 km at 5% (gain 500m)
        # 5 km: (500^2) / (5000 * 10) = 5.0
        # 10 km: (500^2) / (10000 * 10) = 2.5
        score_steep = calculate_fiets_index(500.0, 5000.0)
        score_shallow = calculate_fiets_index(500.0, 10000.0)
        assert score_steep == 2.0 * score_shallow


@pytest.mark.unit
class TestClimbCategorization:
    """Tests for UCI Cat 1-4 and Hors Catégorie (HC) classification."""

    def test_category_thresholds(self):
        assert classify_climb_category(7.5) == "HC"
        assert classify_climb_category(6.5) == "HC"
        assert classify_climb_category(5.5) == "Cat 1"
        assert classify_climb_category(5.0) == "Cat 1"
        assert classify_climb_category(4.0) == "Cat 2"
        assert classify_climb_category(3.5) == "Cat 2"
        assert classify_climb_category(2.5) == "Cat 3"
        assert classify_climb_category(2.0) == "Cat 3"
        assert classify_climb_category(1.0) == "Cat 4"
        assert classify_climb_category(0.5) == "Cat 4"
        assert classify_climb_category(0.2) == "Uncategorized"

    def test_boundary_values(self):
        assert classify_climb_category(4.99) == "Cat 2"
        assert classify_climb_category(5.00) == "Cat 1"
        assert classify_climb_category(6.49) == "Cat 1"
        assert classify_climb_category(6.50) == "HC"

    def test_category_difficulty_mapping(self):
        assert ClimbCategory.HC.difficulty == "extreme"
        assert ClimbCategory.CAT_1.difficulty == "extreme"
        assert ClimbCategory.CAT_2.difficulty == "difficult"
        assert ClimbCategory.CAT_3.difficulty == "moderate"
        assert ClimbCategory.CAT_4.difficulty == "moderate"


@pytest.mark.unit
class TestRollingMaxGrade:
    """Tests for rolling distance window maximum grade computation."""

    def test_uniform_grade_track(self):
        # 2 km track at uniform 8% grade
        pts = [
            (38.0, -106.0, 1000.0 + i * 8.0, i * 0.1, i * 0.062)
            for i in range(21)
        ]
        max_g = compute_rolling_max_grade(pts, 0, len(pts) - 1, window_m=100.0)
        assert max_g == pytest.approx(8.0, abs=0.5)

    def test_steep_kicker_in_middle(self):
        # Generally 5% climb, but between point 5 and 7 (200m) gains 36m (18% kicker)
        pts = [
            (38.0, -106.0, 1000.0, 0.0, 0.0),
            (38.0, -106.0, 1005.0, 0.1, 0.06),
            (38.0, -106.0, 1010.0, 0.2, 0.12),
            (38.0, -106.0, 1015.0, 0.3, 0.18),
            (38.0, -106.0, 1020.0, 0.4, 0.24),
            (38.0, -106.0, 1025.0, 0.5, 0.31),
            (38.0, -106.0, 1043.0, 0.6, 0.37),  # +18m over 100m -> 18%
            (38.0, -106.0, 1061.0, 0.7, 0.43),  # +18m over 100m -> 18%
            (38.0, -106.0, 1066.0, 0.8, 0.50),
            (38.0, -106.0, 1071.0, 0.9, 0.56),
            (38.0, -106.0, 1076.0, 1.0, 0.62),
        ]
        max_g = compute_rolling_max_grade(pts, 0, len(pts) - 1, window_m=100.0)
        assert max_g == pytest.approx(18.0, abs=0.5)


@pytest.mark.unit
class TestClimbDetection:
    """Tests for continuous climb detection state machine."""

    def test_sustained_single_climb(self):
        # 5 km climb gaining 350m (7.0% grade)
        pts = [
            (38.0, -106.0, 1000.0 + i * 7.0, i * 0.1, i * 0.062)
            for i in range(51)
        ]
        climbs = detect_climbs(pts, min_len_km=0.5, min_gain_m=50.0, min_grade=3.0)
        assert len(climbs) == 1
        c = climbs[0]
        assert c.length_km == pytest.approx(5.0, abs=0.1)
        assert c.elevation_gain_m == pytest.approx(350.0, abs=5.0)
        assert c.avg_grade == pytest.approx(7.0, abs=0.2)
        assert c.category in ("Cat 2", "Cat 3")

    def test_rejection_below_minimum_length(self):
        # 400m climb gaining 60m (15% grade) -> rejected because length < 0.5 km
        pts = [
            (38.0, -106.0, 1000.0, 0.0, 0.0),
            (38.0, -106.0, 1030.0, 0.2, 0.12),
            (38.0, -106.0, 1060.0, 0.4, 0.24),
            (38.0, -106.0, 1040.0, 0.6, 0.37),  # descending
        ]
        climbs = detect_climbs(pts, min_len_km=0.5, min_gain_m=50.0, min_grade=3.0)
        assert len(climbs) == 0

    def test_rejection_below_minimum_gain(self):
        # 1 km climb gaining 25m (2.5% grade) -> rejected because gain < 50m
        pts = [
            (38.0, -106.0, 1000.0 + i * 2.5, i * 0.1, i * 0.062)
            for i in range(11)
        ]
        climbs = detect_climbs(pts, min_len_km=0.5, min_gain_m=50.0, min_grade=3.0)
        assert len(climbs) == 0

    def test_rejection_below_minimum_grade(self):
        # 3 km climb gaining 60m (2.0% grade) -> rejected because grade < 3.0%
        pts = [
            (38.0, -106.0, 1000.0 + i * 2.0, i * 0.1, i * 0.062)
            for i in range(31)
        ]
        climbs = detect_climbs(pts, min_len_km=0.5, min_gain_m=50.0, min_grade=3.0)
        assert len(climbs) == 0

    def test_canonical_user_rule_short_steep_climb(self):
        # 600m climb gaining 36m (6.0% grade) -> qualifies because length >= 0.5km and grade >= 5.0%
        pts = [
            (38.0, -106.0, 1000.0 + i * 6.0, i * 0.1, i * 0.062)
            for i in range(7)
        ]
        climbs = detect_climbs(pts)
        assert len(climbs) == 1
        assert climbs[0].length_km == pytest.approx(0.6, abs=0.05)
        assert climbs[0].avg_grade == pytest.approx(6.0, abs=0.2)

    def test_multi_climb_segmentation(self):
        # Climb 1: 0.0 to 4.0 km (+240m)
        # Valley: 4.0 to 10.0 km (-240m then flat)
        # Climb 2: 10.0 to 14.0 km (+240m)
        pts = []
        # Climb 1
        for i in range(41):
            pts.append((38.0, -106.0, 1000.0 + i * 6.0, i * 0.1, i * 0.062))
        # Valley descent
        for i in range(1, 41):
            km = 4.0 + i * 0.1
            pts.append((38.0, -106.0, 1240.0 - i * 5.0, km, km * 0.62))
        # Valley flat
        for i in range(1, 21):
            km = 8.0 + i * 0.1
            pts.append((38.0, -106.0, 1040.0, km, km * 0.62))
        # Climb 2
        for i in range(1, 41):
            km = 10.0 + i * 0.1
            pts.append((38.0, -106.0, 1040.0 + i * 6.0, km, km * 0.62))

        climbs = detect_climbs(pts, min_len_km=0.5, min_gain_m=50.0, min_grade=3.0)
        assert len(climbs) == 2
        assert climbs[0].start_km == pytest.approx(0.0, abs=0.2)
        assert climbs[1].start_km >= 9.5


@pytest.mark.unit
class TestClimbSerialization:
    """Tests for dual dictionary serialization."""

    def test_to_dict_domain_and_frontend_keys(self):
        c = Climb(
            id="georgia-pass",
            name="Georgia Pass",
            start_km=50.0,
            end_km=65.0,
            length_km=15.0,
            elevation_gain_m=800.0,
            avg_grade=5.3,
            max_grade=12.5,
            category="HC",
            start_ele_m=2800.0,
            summit_ele_m=3600.0,
            difficulty="extreme",
            state="CO",
            is_iconic=True,
        )
        d = c.to_dict()

        # Domain keys
        assert d["id"] == "georgia-pass"
        assert d["length_km"] == 15.0
        assert d["elevation_gain_m"] == 800.0
        assert d["category"] == "HC"

        # Frontend keys (camelCase)
        assert d["startKm"] == 50.0
        assert d["endKm"] == 65.0
        assert d["elevationGainMeters"] == 800
        assert d["summitElevationMeters"] == 3600
        assert d["isIconic"] is True
        assert d["state"] == "CO"
        assert "roadClass" in d
        assert "surface" in d


@pytest.mark.unit
class TestOsmSpatialHarvesting:
    """Tests for OpenStreetMap spatial harvesting, peaks, boundaries, and trail names."""

    def test_extract_osm_peaks_overpass(self):
        corridor = {
            "elements": [
                {
                    "type": "node",
                    "id": 12345,
                    "lat": 39.46,
                    "lon": -105.93,
                    "tags": {"natural": "peak", "name": "Mount Guyot", "ele": "4077"}
                },
                {
                    "type": "node",
                    "id": 67890,
                    "lat": 39.40,
                    "lon": -105.90,
                    "tags": {"natural": "tree"}  # ignored
                }
            ]
        }
        peaks = extract_osm_peaks(corridor)
        assert len(peaks) == 1
        assert peaks[0]["name"] == "Mount Guyot"
        assert peaks[0]["ele"] == 4077.0
        assert peaks[0]["lat"] == 39.46

    def test_extract_osm_peaks_geojson(self):
        corridor = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-121.76, 46.85]},
                    "properties": {"natural": "volcano", "name": "Mount Rainier", "ele": "4392"}
                }
            ]
        }
        peaks = extract_osm_peaks(corridor)
        assert len(peaks) == 1
        assert peaks[0]["name"] == "Mount Rainier"
        assert peaks[0]["ele"] == 4392.0
        assert peaks[0]["lat"] == 46.85
        assert peaks[0]["lon"] == -121.76

    def test_extract_osm_boundaries_and_containment(self):
        # A simple square boundary around (39.0 to 40.0 lat, -106.0 to -105.0 lon)
        # GeoJSON ring is [lon, lat]
        corridor = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [-106.0, 39.0],
                            [-105.0, 39.0],
                            [-105.0, 40.0],
                            [-106.0, 40.0],
                            [-106.0, 39.0],
                        ]]
                    },
                    "properties": {
                        "boundary": "national_park",
                        "name": "Rocky Mountain National Park"
                    }
                }
            ]
        }
        boundaries = extract_osm_boundaries(corridor)
        assert len(boundaries) == 1
        b = boundaries[0]
        assert b["name"] == "Rocky Mountain National Park"

        # Point inside
        assert is_point_in_boundary(39.5, -105.5, b) is True
        # Point outside
        assert is_point_in_boundary(41.0, -105.5, b) is False
        assert is_point_in_boundary(39.5, -107.0, b) is False

    def test_extract_dominant_trail_name(self):
        class MockWay:
            def __init__(self, name):
                self.name = name
                self.tags = {"name": name}

        class MockCandidate:
            def __init__(self, way_id):
                self.way_id = way_id

        class MockRoadNetwork:
            def __init__(self):
                self.ways = {
                    1: MockWay("Colorado Trail"),
                    2: MockWay("Colorado Trail"),
                    3: MockWay("Forest Road 10"),
                }

            def find_nearest_way(self, lat, lon, threshold_m=100.0):
                return MockCandidate(1)

        climb = Climb(
            id="climb-1",
            name="Climb 1",
            start_km=10.0,
            end_km=15.0,
            length_km=5.0,
            elevation_gain_m=300.0,
            avg_grade=6.0,
            max_grade=10.0,
            start_coords=(39.1, -105.5),
            summit_coords=(39.2, -105.4),
        )

        track_pts = [
            (39.10, -105.50, 2500.0, 10.0, 6.2),
            (39.15, -105.45, 2650.0, 12.5, 7.7),
            (39.20, -105.40, 2800.0, 15.0, 9.3),
        ]

        net = MockRoadNetwork()
        trail = extract_dominant_trail_name(climb, track_pts, net)
        assert trail == "Colorado Trail"

    def test_find_nearby_landmark(self):
        climb = Climb(
            id="climb-1",
            name="Climb 1",
            start_km=10.0,
            end_km=15.0,
            length_km=5.0,
            elevation_gain_m=500.0,
            avg_grade=10.0,
            max_grade=15.0,
            summit_coords=(39.46, -105.93),
        )

        peaks = [
            # ~200m away, 4,077m
            {"name": "Mount Guyot", "lat": 39.461, "lon": -105.931, "ele": 4077.0},
            # ~500m away, 3,800m
            {"name": "Guyot Minor", "lat": 39.458, "lon": -105.928, "ele": 3800.0},
            # 10km away -> ignored
            {"name": "Distant Peak", "lat": 39.56, "lon": -105.93, "ele": 4300.0},
        ]

        landmark = find_nearby_landmark(climb, peaks, max_dist_m=3500.0)
        # Should pick Mount Guyot as highest within 3.5km
        assert landmark == "Mount Guyot (4077m)"

    def test_evocative_climb_naming(self):
        # 1. Iconic / massive climb with landmark
        c1 = Climb(
            id="c1",
            name="Climb 1 (Mile 14.2)",
            start_km=10.0,
            end_km=20.0,
            length_km=10.0,
            elevation_gain_m=950.0,
            avg_grade=9.5,
            max_grade=16.0,
            category="HC",
            landmark="Mount Massive (4398m)",
        )
        assert generate_evocative_climb_name(c1) == "Mount Massive Ascent"

        # 2. Moderate climb with trail name
        c2 = Climb(
            id="c2",
            name="Climb 2 (Mile 30.0)",
            start_km=40.0,
            end_km=45.0,
            length_km=5.0,
            elevation_gain_m=250.0,
            avg_grade=5.0,
            max_grade=8.0,
            category="Cat 3",
            trail_name="Boreas Pass Road",
        )
        assert generate_evocative_climb_name(c2) == "Boreas Pass Road Climb"

        # 3. Park name fallback
        c3 = Climb(
            id="c3",
            name="Climb 3 (Mile 50.0)",
            start_km=70.0,
            end_km=75.0,
            length_km=5.0,
            elevation_gain_m=300.0,
            avg_grade=6.0,
            max_grade=9.0,
            park_name="White River National Forest",
        )
        assert generate_evocative_climb_name(c3) == "White River National Forest Crest Ascent"

        # 4. Preserves authentic existing / curated name
        c4 = Climb(
            id="c4",
            name="Custom Curated Summit",
            start_km=0.0,
            end_km=5.0,
            length_km=5.0,
            elevation_gain_m=300.0,
            avg_grade=6.0,
            max_grade=9.0,
            landmark="Mount Example",
        )
        assert generate_evocative_climb_name(c4) == "Custom Curated Summit"

    def test_tactical_climb_notes(self):
        c = Climb(
            id="c1",
            name="Mount Massive Ascent",
            start_km=10.0,
            end_km=25.0,
            length_km=15.0,
            elevation_gain_m=1300.0,
            avg_grade=8.7,
            max_grade=19.2,
            category="HC",
            road_class="Singletrack Trail",
            surface="Loose Rock / Shale",
            landmark="Mount Massive (4398m)",
            park_name="San Isabel National Forest",
        )
        notes = generate_tactical_climb_notes(c)
        assert "Monster HC ascent" in notes
        assert "1300m" in notes
        assert "8.7%" in notes
        assert "Loose Rock / Shale" in notes
        assert "Mount Massive (4398m)" in notes
        assert "San Isabel National Forest" in notes

    def test_iconic_classification(self):
        # HC is iconic
        c_hc = Climb(id="c1", name="C1", start_km=0, end_km=10, length_km=10, elevation_gain_m=850, avg_grade=8.5, max_grade=14, category="HC")
        # Cat 1 is iconic
        c_cat1 = Climb(id="c2", name="C2", start_km=0, end_km=8, length_km=8, elevation_gain_m=600, avg_grade=7.5, max_grade=12, category="Cat 1")
        # Cat 3 with 300m gain is NOT iconic by default
        c_cat3 = Climb(id="c3", name="C3", start_km=0, end_km=5, length_km=5, elevation_gain_m=300, avg_grade=6.0, max_grade=9, category="Cat 3")

        climbs = enrich_climbs_geographic_identity([c_hc, c_cat1, c_cat3], track_or_points=[])
        assert climbs[0].is_iconic is True
        assert climbs[1].is_iconic is True
        assert climbs[2].is_iconic is False


@pytest.mark.unit
class TestCuratedClimbs:
    """Tests for curated climbs loading, detection, and override application."""

    def test_is_curated_climb_list_detection(self):
        generic_climbs = [
            Climb(id="c1", name="Climb 1 (Mile 10.2)", start_km=10, end_km=15, length_km=5, elevation_gain_m=200, avg_grade=4, max_grade=7),
            Climb(id="c2", name="Climb 2 (Mile 25.0)", start_km=40, end_km=45, length_km=5, elevation_gain_m=200, avg_grade=4, max_grade=7),
        ]
        assert is_curated_climb_list(generic_climbs) is False

        curated_climbs = [
            Climb(id="c1", name="Boreas Pass Ascent", start_km=10, end_km=15, length_km=5, elevation_gain_m=200, avg_grade=4, max_grade=7),
        ]
        assert is_curated_climb_list(curated_climbs) is True

    def test_apply_curated_climbs_overrides(self):
        detected = [
            Climb(
                id="climb-1",
                name="Climb 1 (Mile 10.0)",
                start_km=16.0,
                end_km=24.0,
                length_km=8.0,
                elevation_gain_m=500.0,
                avg_grade=6.25,
                max_grade=11.0,
                category="Cat 2",
            )
        ]

        curated = [
            Climb(
                id="climb-1",
                name="Georgia Pass West Approach",
                start_km=16.0,
                end_km=24.0,
                length_km=8.0,
                elevation_gain_m=500.0,
                avg_grade=6.25,
                max_grade=11.0,
                trail_name="Jefferson Creek Road",
                park_name="Pike National Forest",
                landmark="Georgia Pass Summit",
                notes="Classic steady gravel climb to the Continental Divide.",
                is_iconic=True,
            )
        ]

        apply_curated_climbs(detected, curated)

        c = detected[0]
        assert c.name == "Georgia Pass West Approach"
        assert c.trail_name == "Jefferson Creek Road"
        assert c.park_name == "Pike National Forest"
        assert c.landmark == "Georgia Pass Summit"
        assert c.notes == "Classic steady gravel climb to the Continental Divide."
        assert c.is_iconic is True

    def test_detect_climbs_integrated_osm_harvesting(self):
        pts = [
            (39.0 + i * 0.01, -106.0, 1000.0 + i * 15.0, i * 0.2, i * 0.12)
            for i in range(51)
        ]

        # Mock GeoJSON with a peak and boundary
        corridor = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-106.0, 39.50]  # Summit coordinate
                    },
                    "properties": {
                        "natural": "peak",
                        "name": "Mount Silverthorne",
                        "ele": "4020"
                    }
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [-106.5, 38.8],
                            [-105.5, 38.8],
                            [-105.5, 39.8],
                            [-106.5, 39.8],
                            [-106.5, 38.8],
                        ]]
                    },
                    "properties": {
                        "boundary": "national_park",
                        "name": "White River National Forest"
                    }
                }
            ]
        }

        climbs = detect_climbs(pts, corridor_data=corridor, min_len_km=0.5, min_gain_m=50.0, min_grade=3.0)
        assert len(climbs) >= 1
        top_climb = climbs[0]
        assert top_climb.landmark == "Mount Silverthorne (4020m)"
        assert top_climb.park_name == "White River National Forest"
        assert "Mount Silverthorne" in top_climb.name
        assert "Mount Silverthorne" in top_climb.notes

