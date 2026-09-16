"""
engine/tests/test_terrain_climbs.py - Unit tests for climb detection, Fiets difficulty scoring,
UCI categorization, rolling-window maximum grade, and surface enrichment.
"""

import pytest

from engine.terrain.climbs import (
    Climb,
    ClimbCategory,
    annotate_climb_surfaces,
    calculate_fiets_index,
    classify_climb_category,
    compute_rolling_max_grade,
    detect_climbs,
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
