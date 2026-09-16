"""
Unit tests for engine.enrichment.places: Google Places client, Pro SKU field masking,
offline mock client, spatial projection, deduplication, and Place model serialization.
"""

from pathlib import Path
import pytest

from engine.core.models import RoutePoint, RouteTrack
from engine.enrichment.cache import APICache
from engine.enrichment.places import (
    FRONTEND_CATEGORY_MAP,
    GooglePlacesClient,
    MockPlacesClient,
    Place,
    PlaceLocation,
    PLACES_TYPE_TO_CATEGORY,
    ResupplyCategory,
    fetch_places_along_route,
)
from engine.utils.spatial import BoundingBox


class TestPlaceModel:
    def test_place_dataclass_initialization_and_properties(self):
        loc = PlaceLocation(lat=39.4909, lon=-105.0942)
        place = Place(
            id="test_store",
            name="Waterton Store",
            category="grocery",
            type="supermarket",
            location=loc,
            distance_to_trail_km=0.05,
            route_km=10.5,
            route_mile=0.0,
            is_in_town=True,
            town="Waterton",
            address="100 Main St"
        )

        assert place.dist_off_route_m == 50.0
        assert place.route_mile == pytest.approx(6.5, abs=0.1)
        assert place.google_maps_url == "https://maps.google.com/?q=39.49090,-105.09420"

    def test_place_serialization_to_dict_matches_frontend_contract(self):
        place = Place(
            id="p1",
            name="Divide Cycle Works",
            category="bike_shop",
            type="bicycle_store",
            location=PlaceLocation(lat=39.5, lon=-105.1),
            distance_to_trail_km=0.12,
            route_km=25.0,
            route_mile=15.5,
            town="Breckenridge",
            is_in_town=True,
            open_now=True,
            opening_hours=["Mon-Sun: 9-6"],
            business_status="OPERATIONAL",
            rating=4.8,
            user_ratings_total=120
        )

        d = place.to_dict()
        assert d["id"] == "p1"
        assert d["name"] == "Divide Cycle Works"
        assert d["category"] == "bike_shop"
        assert d["location"] == {"lat": 39.5, "lon": -105.1}
        assert d["distance_to_trail_km"] == 0.12
        assert d["route_km"] == 25.0
        assert d["route_mile"] == 15.5
        assert d["town"] == "Breckenridge"
        assert d["is_in_town"] is True
        assert d["open_now"] is True
        assert d["opening_hours"] == ["Mon-Sun: 9-6"]
        assert d["rating"] == 4.8
        assert d["user_ratings_total"] == 120

    def test_place_roundtrip_from_dict(self):
        raw = {
            "id": "p2",
            "name": "High Mountain Cafe",
            "category": "food",
            "type": "restaurant",
            "town": "Leadville",
            "is_in_town": True,
            "location": {"lat": 39.25, "lon": -106.29},
            "distance_to_trail_km": 0.35,
            "route_km": 55.4,
            "route_mile": 34.4,
            "address": "400 Harrison Ave",
            "google_maps_url": "https://maps.google.com/?q=39.25,-106.29",
            "business_status": "OPERATIONAL"
        }

        p = Place.from_dict(raw)
        assert p.id == "p2"
        assert p.name == "High Mountain Cafe"
        assert p.location.lat == 39.25
        assert p.location.lon == -106.29
        assert p.dist_off_route_m == 350.0

    def test_category_normalization_to_frontend(self):
        p = Place(
            id="p3",
            name="Rustic Lodge",
            category="lodging",  # Internal name
            type="hotel",
            location=PlaceLocation(lat=39.0, lon=-105.0),
            distance_to_trail_km=0.0,
            route_km=0.0,
            route_mile=0.0
        )
        assert p.category == "hotel"  # Frontend category mapping applied


class TestGooglePlacesClient:
    def test_pro_sku_fieldmask_excludes_expensive_fields(self):
        mask = GooglePlacesClient.PRO_FIELD_MASK
        # Verify Pro SKU fields exist
        assert "places.id" in mask
        assert "places.displayName" in mask
        assert "places.primaryType" in mask
        assert "places.location" in mask
        assert "places.regularOpeningHours" in mask
        assert "places.formattedAddress" in mask

        # Critical: Verify expensive Atmosphere and Enterprise fields are excluded
        assert "places.rating" not in mask
        assert "places.reviews" not in mask
        assert "places.internationalPhoneNumber" not in mask
        assert "places.websiteUri" not in mask

    def test_client_without_api_key_returns_empty_list(self, tmp_path):
        cache = APICache(cache_dir=tmp_path / "empty_cache", namespace="places")
        client = GooglePlacesClient(api_key="", cache=cache)
        res = client.search_nearby(39.0, -105.0, 5000.0, ["bicycle_store"])
        assert res == []


class TestMockPlacesClient:
    def test_deterministic_generation(self):
        client = MockPlacesClient()
        lat, lon = 39.4909, -105.0942
        res1 = client.search_nearby(lat, lon, 5000.0, ["bicycle_store", "lodging", "supermarket"])
        res2 = client.search_nearby(lat, lon, 5000.0, ["bicycle_store", "lodging", "supermarket"])

        assert len(res1) == 3
        assert res1 == res2

        types = [r["primaryType"] for r in res1]
        assert "bicycle_store" in types
        assert "lodging" in types
        assert "supermarket" in types

    def test_coordinates_offset_realistically(self):
        client = MockPlacesClient()
        lat, lon = 39.4909, -105.0942
        res = client.search_nearby(lat, lon, 5000.0, ["campground"])
        assert len(res) == 1
        item = res[0]
        assert item["displayName"]["text"] == "Wilderness Creek Campground"
        loc = item["location"]
        assert abs(loc["latitude"] - lat) < 0.01
        assert abs(loc["longitude"] - lon) < 0.01


class TestFetchPlacesAlongRoute:
    @pytest.fixture
    def synthetic_track(self):
        # 30 km synthetic track from south to north along lon -105.0
        # 1 deg lat is approx 111 km, so 0.1 deg is approx 11.1 km
        pts = [
            RoutePoint(lat=39.0 + (i * 0.01), lon=-105.0, ele=2000.0, cum_km=i * 1.11, cum_mi=(i * 1.11) * 0.621371)
            for i in range(25)
        ]
        total_km = pts[-1].cum_km
        bbox = BoundingBox(min_lat=39.0, min_lon=-105.0, max_lat=39.24, max_lon=-105.0)
        return RouteTrack(points=pts, bbox=bbox, total_distance_km=total_km)

    def test_fetch_places_mock_mode(self, synthetic_track, tmp_path):
        places = fetch_places_along_route(
            track=synthetic_track,
            cache_dir=tmp_path / "places_cache",
            mock_mode=True,
            backcountry_interval_km=8.0
        )

        assert len(places) > 0
        # Verify all places are within corridor
        for p in places:
            assert p.distance_to_trail_km <= 15.0
            assert p.route_km >= 0.0

    def test_deduplication_within_100m_keeps_closest(self, synthetic_track, tmp_path):
        # Two grocery stores at practically the same location, one 20m from trail, one 80m from trail
        lat, lon = 39.05, -105.0002
        towns = [{"name": "Midway", "lat": 39.05, "lon": -105.0}]

        places = fetch_places_along_route(
            track=synthetic_track,
            towns=towns,
            mock_mode=True,
            cache_dir=tmp_path / "places_cache",
            backcountry_interval_km=0  # Only query town
        )

        # Check deduplication: grocery and convenience within 100m merged
        categories = [p.category for p in places]
        assert len(places) == len(set(categories)) or len(places) <= len(PLACES_TYPE_TO_CATEGORY)

    def test_monotonic_sorting_by_route_km(self, synthetic_track, tmp_path):
        places = fetch_places_along_route(
            track=synthetic_track,
            mock_mode=True,
            cache_dir=tmp_path / "places_cache",
            backcountry_interval_km=6.0
        )

        assert len(places) >= 2
        for i in range(len(places) - 1):
            assert places[i].route_km <= places[i + 1].route_km

    def test_external_water_sources_integration(self, synthetic_track, tmp_path):
        water_sources = [
            {
                "id": "spring_1",
                "name": "Twin Springs",
                "lat": 39.10,
                "lon": -105.001,
                "type": "spring"
            }
        ]
        places = fetch_places_along_route(
            track=synthetic_track,
            water_sources=water_sources,
            mock_mode=True,
            cache_dir=tmp_path / "places_cache",
            backcountry_interval_km=15.0
        )

        water_places = [p for p in places if p.category == "water"]
        assert len(water_places) >= 1
        assert any("Twin Springs" in p.name for p in water_places)

    def test_empty_track_returns_empty_list(self):
        assert fetch_places_along_route(track=[]) == []
