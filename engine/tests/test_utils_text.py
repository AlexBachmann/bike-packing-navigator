"""
engine/tests/test_utils_text.py - Unit tests for slugification, sanitation, and string formatting.
"""

import pytest
from engine.utils.text import (
    slugify,
    sanitize_name,
    sanitize_identifier,
    sanitize_id,
    format_distance,
    format_distance_km,
    format_elevation,
)


@pytest.mark.unit
class TestTextUtils:
    """Tests for text sanitization, slugification, and formatting."""

    def test_slugify_basic_and_accents(self):
        assert slugify("Arizona Trail Race 300") == "arizona-trail-race-300"
        assert slugify("Béni Mellal to Essaouira") == "beni-mellal-to-essaouira"
        assert slugify("Terekti Pass / M-039 (Road)") == "terekti-pass-m-039-road"

    def test_slugify_special_characters(self):
        assert slugify("   ---Tour...Divide___2025---   ") == "tour-divide-2025"
        assert slugify("  ---Test...Route___Name---  ") == "test-route-name"

    def test_slugify_with_separator(self):
        assert slugify("Spring Water Access", sep="_") == "spring_water_access"

    def test_slugify_german_eszett(self):
        assert slugify("Straße") == "strasse"
        assert slugify("Großglockner") == "grossglockner"
        assert slugify("WEISSENSTEIN-ẞ") == "weissenstein-ss"

    def test_slugify_non_latin_unicode_scripts(self):
        assert slugify("Бишкек") == "бишкек"
        assert slugify("Москва") == "москва"
        assert slugify("Тёо-Ашуу") == "тео-ашуу"
        assert slugify("北京") == "北京"
        assert slugify("Όλυμπος") == "ολυμπος"
        assert slugify("Route Бишкек 2026") == "route-бишкек-2026"

    def test_slugify_fallback_default(self):
        assert slugify("??? !@#$%^&*()", default="fallback") == "fallback"
        assert slugify("??? !@#$%^&*()") == ""
        assert slugify("", default="unnamed-route") == "unnamed-route"
        assert slugify("") == ""

    def test_sanitize_name(self):
        assert sanitize_name("  Coronado   National   Memorial  ") == "Coronado National Memorial"
        assert sanitize_name("Water Spigot\t\n") == "Water Spigot"
        assert sanitize_name("") == ""

    def test_sanitize_identifier(self):
        assert sanitize_identifier("Checkpoint Alpha 1!") == "checkpoint_alpha_1"
        assert sanitize_id("Route 66") == "route_66"

    def test_sanitize_identifier_unicode_and_default(self):
        assert sanitize_identifier("Бишкек Checkpoint 1") == "бишкек_checkpoint_1"
        assert sanitize_identifier("Großglockner Pass") == "grossglockner_pass"
        assert sanitize_identifier("???", default="fallback_token") == "fallback_token"
        assert sanitize_identifier("") == ""

    def test_format_distance(self):
        assert format_distance(100.0, imperial=False) == "100.0 km"
        assert format_distance(100.0, imperial=True) == "62.1 mi"

    def test_format_distance_km(self):
        assert format_distance_km(12.345) == "12.3 km"
        assert format_distance_km(0.46) == "0.5 km"

    def test_format_elevation(self):
        assert format_elevation(1450.0, imperial=False) == "1,450 m"
        assert format_elevation(1450.0, imperial=True) == "4,757 ft"
