"""
engine/tests/test_osm_turns.py - Comprehensive unit test suite for OSM turn cues & angles.
"""

import math
from pathlib import Path
import pytest

from engine.core.models import RoutePoint, RouteTrack
from engine.osm.turns import (
    CueTrigger,
    JunctionAnalysis,
    JunctionType,
    OsmNetworkIndex,
    OsmSegment,
    TurnCue,
    TurnType,
    classify_turn_type,
    extract_turn_cues,
    generate_instruction,
    save_turns_json,
)
from engine.utils.spatial import BoundingBox


class TestTurnClassification:
    """Verifies exact angular classification intervals for all 8 directions."""

    @pytest.mark.parametrize("angle,expected", [
        (0.0, TurnType.STRAIGHT),
        (10.0, TurnType.STRAIGHT),
        (-12.0, TurnType.STRAIGHT),
        (15.0, TurnType.STRAIGHT),
        (-15.0, TurnType.STRAIGHT),
        (15.1, TurnType.SLIGHT_RIGHT),
        (30.0, TurnType.SLIGHT_RIGHT),
        (45.0, TurnType.SLIGHT_RIGHT),
        (45.1, TurnType.RIGHT),
        (90.0, TurnType.RIGHT),
        (120.0, TurnType.RIGHT),
        (120.1, TurnType.SHARP_RIGHT),
        (150.0, TurnType.SHARP_RIGHT),
        (165.0, TurnType.SHARP_RIGHT),
        (165.1, TurnType.U_TURN),
        (180.0, TurnType.U_TURN),
        (-15.1, TurnType.SLIGHT_LEFT),
        (-30.0, TurnType.SLIGHT_LEFT),
        (-45.0, TurnType.SLIGHT_LEFT),
        (-45.1, TurnType.LEFT),
        (-90.0, TurnType.LEFT),
        (-120.0, TurnType.LEFT),
        (-120.1, TurnType.SHARP_LEFT),
        (-150.0, TurnType.SHARP_LEFT),
        (-165.0, TurnType.SHARP_LEFT),
        (-165.1, TurnType.U_TURN),
        (-180.0, TurnType.U_TURN),
    ])
    def test_angle_intervals(self, angle: float, expected: TurnType):
        assert classify_turn_type(angle) == expected

    def test_angle_wrapping(self):
        # 270 degrees clockwise == -90 degrees (left turn)
        assert classify_turn_type(270.0) == TurnType.LEFT
        # 355 degrees == -5 degrees (straight)
        assert classify_turn_type(355.0) == TurnType.STRAIGHT

    def test_direction_modifier_kebab_case(self):
        assert TurnType.SLIGHT_RIGHT.direction_modifier == "slight-right"
        assert TurnType.SHARP_LEFT.direction_modifier == "sharp-left"
        assert TurnType.U_TURN.direction_modifier == "u-turn"
        assert TurnType.STRAIGHT.direction_modifier == "straight"


class TestTurnCueDataclass:
    """Verifies TurnCue serialization and round-trip conversion."""

    def test_cue_creation_and_mile_calculation(self):
        cue = TurnCue(
            km=10.0,
            instruction="Turn right onto Forest Road",
            turn_type=TurnType.RIGHT,
            street_name="Forest Road",
            coordinates=(42.0, -106.0),
            deflection_deg=90.0,
            branch_count=3,
        )
        assert cue.mile == pytest.approx(6.214, abs=0.01)
        assert cue.direction_modifier == "right"

    def test_frontend_osm_turn_json(self):
        cue = TurnCue(
            km=1.60934,
            instruction="Fork slight right onto Singletrack",
            turn_type=TurnType.SLIGHT_RIGHT,
            street_name="Singletrack",
            coordinates=(42.123456, -106.654321),
            deflection_deg=35.0,
            junction_type="fork",
            branch_count=3,
        )
        data = cue.to_osm_turn_json()
        assert data["mile"] == 1.0
        assert data["km"] == 1.609
        assert data["direction"] == "slight-right"
        assert data["deflectionDeg"] == 35.0
        assert data["roadName"] == "Singletrack"
        assert data["junctionType"] == "fork"
        assert data["branchCount"] == 3
        assert data["instruction"] == "Fork slight right onto Singletrack"

    def test_round_trip_serialization(self):
        cue = TurnCue(
            km=5.0,
            instruction="Turn left onto Trail",
            turn_type=TurnType.LEFT,
            street_name="Trail",
            coordinates=(40.0, -105.0),
            deflection_deg=-90.0,
        )
        d = cue.to_dict()
        cue2 = TurnCue.from_dict(d)
        assert cue2.km == cue.km
        assert cue2.turn_type == cue.turn_type
        assert cue2.street_name == cue.street_name
        assert cue2.coordinates == cue.coordinates


class TestSwitchbackFilter:
    """Verifies rejection of solitary mountain hairpin switchbacks."""

    def test_hairpin_switchback_rejected_on_continuous_road(self):
        """
        A 140° hairpin bend on a single continuous road (same way_id=100)
        with no side roads must be suppressed.
        """
        net = OsmNetworkIndex()
        # Single continuous way forming a hairpin curve
        net.add_segment(OsmSegment(42.000, 72.000, 42.002, 72.000, name="Pass Road", way_id=100))
        net.add_segment(OsmSegment(42.002, 72.000, 42.001, 72.002, name="Pass Road", way_id=100))

        analysis = net.analyze_junction(42.002, 72.000, radius_m=35.0)
        assert analysis.is_switchback is True
        assert analysis.is_decision_point is False

        track_points = [
            [42.000, 72.000, 1000.0, 0.0, 0.0],
            [42.002, 72.000, 1050.0, 0.22, 0.14],
            [42.001, 72.002, 1100.0, 0.45, 0.28],
        ]
        cues = extract_turn_cues(track_points, network=net)
        assert len(cues) == 0  # Suppressed!

    def test_hairpin_turn_retained_if_junction_present(self):
        """
        If a side trail branches off at the hairpin curve, it is an authentic junction.
        """
        net = OsmNetworkIndex()
        net.add_segment(OsmSegment(42.000, 72.000, 42.002, 72.000, name="Pass Road", way_id=100))
        net.add_segment(OsmSegment(42.002, 72.000, 42.001, 72.002, name="Pass Road", way_id=100))
        # Side trail branching off to the north
        net.add_segment(OsmSegment(42.002, 72.000, 42.005, 72.000, name="Summit Trail", highway="path", way_id=200))

        analysis = net.analyze_junction(42.002, 72.000, radius_m=35.0)
        assert analysis.is_switchback is False
        assert analysis.is_decision_point is True
        assert analysis.branch_count >= 3

        track_points = [
            [42.000, 72.000, 1000.0, 0.0, 0.0],
            [42.002, 72.000, 1050.0, 0.22, 0.14],
            [42.001, 72.002, 1100.0, 0.45, 0.28],
        ]
        cues = extract_turn_cues(track_points, network=net)
        assert len(cues) == 1
        assert cues[0].turn_type in (TurnType.SHARP_RIGHT, TurnType.RIGHT)


class TestCueGenerationTriggers:
    """Verifies all cue generation triggers."""

    def test_t_junction_geometric_turn(self):
        net = OsmNetworkIndex()
        # North-south main road
        net.add_segment(OsmSegment(42.000, 72.000, 42.002, 72.000, name="Valley Rd", way_id=1))
        net.add_segment(OsmSegment(42.002, 72.000, 42.004, 72.000, name="Valley Rd", way_id=1))
        # Eastbound branch
        net.add_segment(OsmSegment(42.002, 72.000, 42.002, 72.003, name="Ridge Trail", highway="track", way_id=2))

        track_points = [
            [42.000, 72.000, 100.0, 0.0, 0.0],
            [42.002, 72.000, 100.0, 0.22, 0.14],
            [42.002, 72.003, 100.0, 0.47, 0.29],
        ]
        cues = extract_turn_cues(track_points, network=net)
        assert len(cues) == 1
        assert cues[0].turn_type == TurnType.RIGHT
        assert cues[0].street_name == "Ridge Trail"
        assert "Ridge Trail" in cues[0].instruction

    def test_name_transition_on_straight_path(self):
        """Straight continuation where road name changes generates a transition cue."""
        net = OsmNetworkIndex()
        net.add_segment(OsmSegment(42.000, 72.000, 42.002, 72.000, name="Old County Road", way_id=1))
        net.add_segment(OsmSegment(42.002, 72.000, 42.004, 72.000, name="Continental Divide Trail", way_id=2))

        track_points = [
            [42.000, 72.000, 100.0, 0.0, 0.0],
            [42.002, 72.000, 100.0, 0.22, 0.14],
            [42.004, 72.000, 100.0, 0.44, 0.28],
        ]
        cues = extract_turn_cues(track_points, network=net)
        assert len(cues) == 1
        assert cues[0].trigger == CueTrigger.NAME_TRANSITION
        assert "Continental Divide Trail" in cues[0].instruction

    def test_surface_transition_pavement_ends(self):
        """Surface changes from asphalt to unpaved track generates surface transition cue."""
        net = OsmNetworkIndex()
        net.add_segment(OsmSegment(42.000, 72.000, 42.002, 72.000, name="Forest Rd", surface="asphalt", way_id=1))
        net.add_segment(OsmSegment(42.002, 72.000, 42.004, 72.000, name="Forest Rd", surface="gravel", way_id=2))

        track_points = [
            [42.000, 72.000, 100.0, 0.0, 0.0],
            [42.002, 72.000, 100.0, 0.22, 0.14],
            [42.004, 72.000, 100.0, 0.44, 0.28],
        ]
        cues = extract_turn_cues(track_points, network=net)
        assert len(cues) == 1
        assert cues[0].trigger == CueTrigger.SURFACE_TRANSITION
        assert "Pavement ends" in cues[0].instruction


class TestDeduplicationAndDegenerateInputs:
    """Verifies edge cases and deduplication."""

    def test_empty_track(self):
        assert extract_turn_cues([]) == []

    def test_short_track(self):
        assert extract_turn_cues([[42.0, 72.0, 100.0, 0.0, 0.0]]) == []

    def test_duplicate_consecutive_points(self):
        track_points = [
            [42.000, 72.000, 100.0, 0.0, 0.0],
            [42.000, 72.000, 100.0, 0.0, 0.0],
            [42.002, 72.000, 100.0, 0.22, 0.14],
            [42.002, 72.002, 100.0, 0.38, 0.24],
        ]
        cues = extract_turn_cues(track_points)
        assert isinstance(cues, list)

    def test_deduplication_within_50m(self):
        # Two turns within 30m of each other
        track_points = [
            [42.000, 72.000, 100.0, 0.0, 0.0],
            [42.001, 72.000, 100.0, 0.11, 0.07],  # turn 1
            [42.0012, 72.0002, 100.0, 0.13, 0.08],  # turn 2 ~25m away
            [42.002, 72.001, 100.0, 0.22, 0.14],
        ]
        cues = extract_turn_cues(track_points, min_spacing_m=50.0)
        assert len(cues) <= 1

    def test_save_turns_json(self, tmp_path):
        cue = TurnCue(
            km=1.0,
            instruction="Turn right",
            turn_type=TurnType.RIGHT,
            street_name="Trail",
            coordinates=(42.0, 72.0)
        )
        out_file = tmp_path / "turns.json"
        save_turns_json([cue], out_file)
        assert out_file.exists()
