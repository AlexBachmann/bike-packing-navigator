"""
engine.tests.test_water_audit - Test suite for water curation quality gate and provenance auditing.
"""

import pytest
from engine.enrichment.water import WaterWaypoint, audit_water_sources
from engine.utils.spatial import TrackIndex


def test_audit_water_sources_valid():
    """Verify that entries with valid coordinates and authentic provenance pass audit."""
    valid_sources = [
        {
            "id": "td_beaverhead_spigot",
            "name": "USFS Beaverhead Work Center Spigot",
            "category": "water",
            "type": "drinking_water",
            "location": {"lat": 33.423588, "lon": -108.111457},
            "provenance": {
                "source": "osm",
                "id": 1091155176,
                "url": "https://www.openstreetmap.org/way/1091155176",
                "verified": True,
            },
            "reliability": "reliable",
            "treatment_required": False,
            "source_type": "spigot",
        },
        {
            "id": "td_sweetwater_river",
            "name": "Sweetwater River Crossing",
            "category": "water",
            "type": "water",
            "location": {"lat": 42.392995, "lon": -108.626636},
            "provenance": {
                "source": "osm",
                "id": 14471391,
                "verified": True,
            },
            "reliability": "reliable",
            "treatment_required": True,
            "source_type": "stream",
        },
        {
            "id": "td_pie_town_toaster",
            "name": "Pie Town Toaster House Water Spigot",
            "category": "water",
            "type": "drinking_water",
            "location": {"lat": 34.29909, "lon": -108.13862},
            "provenance": {
                "source": "survey",
                "url": "https://maps.google.com/?q=34.29909,-108.13862",
                "notes": "19 S Pie Town Rd, Pie Town, NM",
                "verified": True,
            },
            "reliability": "reliable",
            "treatment_required": False,
            "source_type": "spigot",
        },
    ]

    passed, errors = audit_water_sources(valid_sources)
    assert passed is True
    assert len(errors) == 0


def test_audit_water_sources_missing_provenance():
    """Verify that unverified or guessed entries fail the audit gate."""
    unverified_sources = [
        {
            "id": "td_guessed_spigot",
            "name": "Interpolated Guess Spigot",
            "category": "water",
            "type": "spigot",
            "location": {"lat": 33.5552, "lon": -108.3284},
            # Missing provenance
        }
    ]

    passed, errors = audit_water_sources(unverified_sources)
    assert passed is False
    assert len(errors) >= 1
    assert "Missing required 'provenance' object" in errors[0]


def test_audit_water_sources_unverified_flag():
    """Verify that provenance with verified=False fails audit."""
    sources = [
        {
            "id": "td_unverified_well",
            "name": "Unverified Well",
            "category": "water",
            "type": "well",
            "location": {"lat": 42.27, "lon": -108.10},
            "provenance": {
                "source": "osm",
                "id": 12345,
                "verified": False,
            }
        }
    ]

    passed, errors = audit_water_sources(sources)
    assert passed is False
    assert any("verified: false" in e for e in errors)


def test_audit_water_sources_invalid_coordinates():
    """Verify that invalid coordinates trigger audit failures."""
    bad_coords = [
        {
            "id": "td_bad_lat",
            "name": "Bad Lat Spring",
            "category": "water",
            "type": "spring",
            "location": {"lat": 999.0, "lon": -108.0},
            "provenance": {"source": "osm", "id": 1, "verified": True},
        },
        {
            "id": "td_missing_coords",
            "name": "No Coords Spring",
            "category": "water",
            "type": "spring",
            "provenance": {"source": "osm", "id": 2, "verified": True},
        }
    ]

    passed, errors = audit_water_sources(bad_coords)
    assert passed is False
    assert len(errors) >= 2


def test_audit_water_sources_distance_check():
    """Verify that waypoints too far from trail trigger distance audit error."""
    track_pts = [[33.42, -108.11, 2000.0, 0.0, 0.0], [33.43, -108.11, 2000.0, 1.0, 0.62]]
    track_index = TrackIndex(track_pts)

    sources = [
        {
            "id": "td_distant_point",
            "name": "Way Off Trail Water",
            "category": "water",
            "type": "spring",
            # ~50km away
            "location": {"lat": 33.90, "lon": -108.11},
            "provenance": {"source": "osm", "id": 999, "verified": True},
        }
    ]

    passed, errors = audit_water_sources(sources, track_index=track_index, max_distance_m=5000.0)
    assert passed is False
    assert any("exceeds maximum allowable detour" in e for e in errors)


def test_waterwaypoint_provenance_preservation():
    """Verify WaterWaypoint stores provenance and serializes to dict and places dict."""
    wp = WaterWaypoint(
        id="water_beaverhead",
        name="Beaverhead Work Center Spigot",
        type="drinking_water",
        coordinates=(33.423588, -108.111457),
        osm_id=1091155176,
        provenance={
            "source": "osm",
            "id": 1091155176,
            "url": "https://www.openstreetmap.org/way/1091155176",
            "verified": True,
        },
        treatment_required=False,
    )

    d = wp.to_dict()
    assert "provenance" in d
    assert d["provenance"]["id"] == 1091155176

    pd = wp.to_places_dict()
    assert "provenance" in pd
    assert pd["provenance"]["source"] == "osm"
    assert pd["provenance"]["verified"] is True
