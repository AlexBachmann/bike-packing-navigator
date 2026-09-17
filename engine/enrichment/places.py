"""
engine.enrichment.places - Google Places API (New v1) client, persistent caching,
deterministic offline mock, and track corridor POI extraction for Bikepack Navigator.
"""

from dataclasses import dataclass, field
from enum import Enum
import hashlib
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import requests
except ImportError:
    requests = None

from engine.core.models import RoutePoint, RouteTrack
from engine.enrichment.cache import APICache
from engine.utils.geo import haversine_distance_m
from engine.utils.spatial import TrackIndex
from engine.utils.text import slugify
from engine.utils.units import km_to_miles

logger = logging.getLogger(__name__)


class ResupplyCategory(str, Enum):
    """Canonical resupply categories."""
    GROCERY = "grocery"
    CONVENIENCE = "convenience"
    BIKE_SHOP = "bike_shop"
    LODGING = "lodging"
    CAMPGROUND = "campground"
    RESTAURANT = "restaurant"
    GAS_STATION = "gas_station"
    PHARMACY = "pharmacy"
    LAUNDROMAT = "laundromat"
    WATER = "water"
    TOWN = "town"
    OTHER = "other"


# Mapping from Google Places types to canonical ResupplyCategory & frontend category string
PLACES_TYPE_TO_CATEGORY: Dict[str, Tuple[ResupplyCategory, str]] = {
    # Groceries / Markets -> frontend: grocery
    "supermarket": (ResupplyCategory.GROCERY, "grocery"),
    "grocery_store": (ResupplyCategory.GROCERY, "grocery"),
    "grocery_or_supermarket": (ResupplyCategory.GROCERY, "grocery"),
    "general_store": (ResupplyCategory.GROCERY, "grocery"),
    "convenience_store": (ResupplyCategory.CONVENIENCE, "grocery"),
    "food_store": (ResupplyCategory.GROCERY, "grocery"),
    "market": (ResupplyCategory.GROCERY, "grocery"),
    # Bike shops -> frontend: bike_shop
    "bicycle_store": (ResupplyCategory.BIKE_SHOP, "bike_shop"),
    "bicycle_repair_service": (ResupplyCategory.BIKE_SHOP, "bike_shop"),
    "bike_shop": (ResupplyCategory.BIKE_SHOP, "bike_shop"),
    # Lodging / Hotels -> frontend: hotel
    "lodging": (ResupplyCategory.LODGING, "hotel"),
    "hotel": (ResupplyCategory.LODGING, "hotel"),
    "motel": (ResupplyCategory.LODGING, "hotel"),
    "hostel": (ResupplyCategory.LODGING, "hotel"),
    "bed_and_breakfast": (ResupplyCategory.LODGING, "hotel"),
    "guest_house": (ResupplyCategory.LODGING, "hotel"),
    "resort_hotel": (ResupplyCategory.LODGING, "hotel"),
    "cabin": (ResupplyCategory.LODGING, "hotel"),
    # Camping -> frontend: campground
    "campground": (ResupplyCategory.CAMPGROUND, "campground"),
    "camping_cabin": (ResupplyCategory.CAMPGROUND, "campground"),
    "rv_park": (ResupplyCategory.CAMPGROUND, "campground"),
    # Food / Dining -> frontend: food
    "restaurant": (ResupplyCategory.RESTAURANT, "food"),
    "cafe": (ResupplyCategory.RESTAURANT, "food"),
    "bakery": (ResupplyCategory.RESTAURANT, "food"),
    "meal_takeaway": (ResupplyCategory.RESTAURANT, "food"),
    "fast_food_restaurant": (ResupplyCategory.RESTAURANT, "food"),
    "bar": (ResupplyCategory.RESTAURANT, "food"),
    # Gas station -> frontend: gas_station
    "gas_station": (ResupplyCategory.GAS_STATION, "gas_station"),
    # Pharmacy -> frontend: pharmacy
    "pharmacy": (ResupplyCategory.PHARMACY, "pharmacy"),
    "drugstore": (ResupplyCategory.PHARMACY, "pharmacy"),
    # Laundry -> frontend: laundromat
    "laundromat": (ResupplyCategory.LAUNDROMAT, "laundromat"),
    "laundry": (ResupplyCategory.LAUNDROMAT, "laundromat"),
    # Water -> frontend: water
    "drinking_water": (ResupplyCategory.WATER, "water"),
    "water_point": (ResupplyCategory.WATER, "water"),
    "spring": (ResupplyCategory.WATER, "water"),
    # Town -> frontend: town
    "town": (ResupplyCategory.TOWN, "town"),
    "locality": (ResupplyCategory.TOWN, "town"),
}

FRONTEND_CATEGORY_MAP: Dict[str, str] = {
    "grocery": "grocery",
    "convenience": "grocery",
    "bike_shop": "bike_shop",
    "lodging": "hotel",
    "campground": "campground",
    "restaurant": "food",
    "food": "food",
    "gas_station": "gas_station",
    "pharmacy": "pharmacy",
    "laundromat": "laundromat",
    "laundry": "laundromat",
    "water": "water",
    "town": "town",
    "pass": "pass",
    "other": "other",
}


@dataclass(frozen=True)
class PlaceLocation:
    """Geographic coordinate representation matching PlaceLocation interface."""
    lat: float
    lon: float

    def to_dict(self) -> Dict[str, float]:
        return {"lat": round(self.lat, 6), "lon": round(self.lon, 6)}


@dataclass
class Place:
    """
    Standardized Point of Interest / Resupply model for Bikepack Navigator.
    Conforms 100% to Angular src/app/models/waypoint.model.ts interface Place.
    """
    id: str
    name: str
    category: str
    type: str
    location: PlaceLocation
    distance_to_trail_km: float
    route_km: float
    route_mile: float
    is_in_town: bool = False
    town: str = ""
    address: str = ""
    open_now: Optional[bool] = None
    opening_hours: Optional[List[str]] = None
    google_maps_url: str = ""
    business_status: str = "OPERATIONAL"
    province_state: str = ""
    country: str = ""
    description: str = ""
    rating: Optional[float] = None
    user_ratings_total: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.distance_to_trail_km = round(float(self.distance_to_trail_km), 3)
        self.route_km = round(float(self.route_km), 3)
        if self.route_mile == 0.0 and self.route_km > 0.0:
            self.route_mile = round(km_to_miles(self.route_km), 3)
        else:
            self.route_mile = round(float(self.route_mile), 3)

        if isinstance(self.location, dict):
            self.location = PlaceLocation(
                lat=float(self.location.get("lat", 0.0)),
                lon=float(self.location.get("lon", 0.0)),
            )

        # Normalize category to frontend string
        cat_lower = self.category.lower() if isinstance(self.category, str) else str(self.category)
        self.category = FRONTEND_CATEGORY_MAP.get(cat_lower, cat_lower)

        if not self.google_maps_url and self.location:
            self.google_maps_url = f"https://maps.google.com/?q={self.location.lat:.5f},{self.location.lon:.5f}"

    @property
    def dist_off_route_m(self) -> float:
        """Lateral offset distance in meters."""
        return round(self.distance_to_trail_km * 1000.0, 1)

    def to_dict(self) -> Dict[str, Any]:
        """Convert Place to JSON dict matching frontend Place interface."""
        res: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "type": self.type,
            "town": self.town or "",
            "is_in_town": self.is_in_town,
            "location": self.location.to_dict(),
            "distance_to_trail_km": round(self.distance_to_trail_km, 2),
            "route_km": round(self.route_km, 1),
            "route_mile": round(self.route_mile, 1),
        }
        if self.address:
            res["address"] = self.address
        if self.open_now is not None:
            res["open_now"] = self.open_now
        if self.opening_hours:
            res["opening_hours"] = list(self.opening_hours)
        if self.google_maps_url:
            res["google_maps_url"] = self.google_maps_url
        if self.business_status:
            res["business_status"] = self.business_status
        if self.province_state:
            res["province_state"] = self.province_state
        if self.country:
            res["country"] = self.country
        if self.description:
            res["description"] = self.description
        if self.rating is not None:
            res["rating"] = round(self.rating, 1)
        if self.user_ratings_total is not None:
            res["user_ratings_total"] = self.user_ratings_total
        return res

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Place":
        """Deserialize Place from dictionary."""
        loc_data = d.get("location", {})
        loc = PlaceLocation(
            lat=float(loc_data.get("lat", 0.0)),
            lon=float(loc_data.get("lon", 0.0)),
        )
        return cls(
            id=str(d.get("id", "")),
            name=str(d.get("name", "Waypoint")),
            category=str(d.get("category", "other")),
            type=str(d.get("type", "other")),
            location=loc,
            distance_to_trail_km=float(d.get("distance_to_trail_km", 0.0)),
            route_km=float(d.get("route_km", 0.0)),
            route_mile=float(d.get("route_mile", 0.0)),
            is_in_town=bool(d.get("is_in_town", False)),
            town=str(d.get("town", "")),
            address=str(d.get("address", "")),
            open_now=d.get("open_now"),
            opening_hours=d.get("opening_hours"),
            google_maps_url=str(d.get("google_maps_url", "")),
            business_status=str(d.get("business_status", "OPERATIONAL")),
            province_state=str(d.get("province_state", "")),
            country=str(d.get("country", "")),
            description=str(d.get("description", "")),
            rating=float(d["rating"]) if d.get("rating") is not None else None,
            user_ratings_total=int(d["user_ratings_total"]) if d.get("user_ratings_total") is not None else None,
            extra=dict(d.get("extra", {})),
        )


class GooglePlacesClient:
    """
    Client for Google Places API (New v1) searchNearby with Pro SKU FieldMask.
    
    Guarantees $0.00 out-of-pocket usage by strictly omitting Atmosphere/Enterprise fields.
    """
    NEW_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
    PRO_FIELD_MASK = (
        "places.id,places.displayName,places.primaryType,places.types,"
        "places.formattedAddress,places.location,places.regularOpeningHours,"
        "places.googleMapsUri,places.businessStatus"
    )

    def __init__(
        self,
        api_key: Optional[str] = None,
        cache: Optional[APICache] = None,
        rate_limit_delay_sec: float = 0.08
    ):
        if api_key is not None:
            self.api_key = api_key
        else:
            self.api_key = os.environ.get("GOOGLE_PLACES_API_KEY") or os.environ.get("GOOGLE_CLOUD_API_KEY") or ""
        self.cache = cache
        self.rate_limit_delay = rate_limit_delay_sec
        self.session = requests.Session() if requests else None

    def search_nearby(
        self,
        lat: float,
        lon: float,
        radius_m: float,
        included_types: Sequence[str],
        max_results: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Query Places API (New) searchNearby with Pro FieldMask.
        """
        # 1. Check persistent cache
        cache_key = ""
        if self.cache:
            cache_key = self.cache.build_key("searchNearby", {
                "lat": lat, "lon": lon, "radius": radius_m, "types": list(included_types)
            })
            cached = self.cache.get(cache_key)
            if cached is not None:
                return cached

        if not self.api_key:
            logger.info("No Google Places API key provided; skipping network request.")
            return []

        if not self.session:
            logger.warning("Requests library not available for Google Places API.")
            return []

        # Sanitize included_types for Google Places API (New) Table A compliance
        sanitized_types: List[str] = []
        for t in included_types:
            if t == "laundromat":
                if "laundry" not in sanitized_types:
                    sanitized_types.append("laundry")
            elif t in ("drinking_water", "water_point", "spring", "town", "locality"):
                continue
            elif t not in sanitized_types:
                sanitized_types.append(t)

        if not sanitized_types:
            return []

        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": self.PRO_FIELD_MASK,
        }
        body = {
            "includedTypes": sanitized_types,
            "maxResultCount": max_results,
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": float(lat), "longitude": float(lon)},
                    "radius": float(radius_m)
                }
            }
        }

        # Rate limiting pause
        time.sleep(self.rate_limit_delay)

        try:
            resp = self.session.post(self.NEW_NEARBY_URL, headers=headers, json=body, timeout=15)
            if resp.status_code == 200:
                data = resp.json().get("places", [])
                if self.cache and cache_key:
                    self.cache.set(cache_key, data)
                return data
            elif resp.status_code in (429, 503):
                logger.warning(f"Google Places rate limited ({resp.status_code}), retrying...")
                time.sleep(1.0)
                retry_resp = self.session.post(self.NEW_NEARBY_URL, headers=headers, json=body, timeout=15)
                if retry_resp.status_code == 200:
                    data = retry_resp.json().get("places", [])
                    if self.cache and cache_key:
                        self.cache.set(cache_key, data)
                    return data
            logger.error(f"Google Places API error ({resp.status_code}): {resp.text[:150]}")
            return []
        except Exception as err:
            logger.error(f"Google Places network error: {err}")
            return []


class MockPlacesClient:
    """
    Deterministic offline mock client generating realistic POIs along tracks
    for dry-run workflows, testing, and keyless operation.
    """

    def __init__(self, cache: Optional[APICache] = None):
        self.cache = cache

    def search_nearby(
        self,
        lat: float,
        lon: float,
        radius_m: float,
        included_types: Sequence[str],
        max_results: int = 20
    ) -> List[Dict[str, Any]]:
        """Generate realistic synthetic places based on coordinates and requested types."""
        coord_str = f"{lat:.4f},{lon:.4f}"
        seed_val = int(hashlib.md5(coord_str.encode()).hexdigest()[:8], 16)
        results: List[Dict[str, Any]] = []

        type_templates = {
            "bicycle_store": ("Trailhead Cycle & Repair", "bicycle_store", 0.0015, 0.0012, "120 Main St"),
            "bicycle_repair_service": ("Divide Veloworks", "bicycle_store", 0.0018, 0.0014, "124 Main St"),
            "lodging": ("Backcountry Mountain Lodge", "lodging", -0.0020, -0.0018, "400 Pine Rd"),
            "hotel": ("Pioneer Hotel & Cabins", "lodging", -0.0025, -0.0022, "450 Pine Rd"),
            "motel": ("Trailside Motel", "lodging", -0.0018, -0.0015, "320 Highway 9"),
            "supermarket": ("Pass Outpost General Store", "supermarket", 0.0008, -0.0010, "15 Forest Service Rd"),
            "grocery_store": ("Valley Market & Deli", "grocery_store", 0.0006, -0.0008, "18 Forest Service Rd"),
            "convenience_store": ("Town Express C-Store", "convenience_store", 0.0010, -0.0005, "10 Forest Service Rd"),
            "campground": ("Wilderness Creek Campground", "campground", 0.0010, 0.0025, "Creek Valley Road"),
            "restaurant": ("Summit Cafe & Bakery", "restaurant", -0.0012, 0.0009, "101 Main St"),
            "cafe": ("Morning Grit Espresso", "restaurant", -0.0010, 0.0006, "105 Main St"),
            "gas_station": ("Highway Junction Gas & Mart", "gas_station", 0.0022, -0.0018, "200 State Route 4"),
            "pharmacy": ("Civic Center Pharmacy", "pharmacy", -0.0005, 0.0011, "210 Main St"),
            "laundromat": ("Suds & Showers Laundromat", "laundromat", -0.0008, -0.0012, "85 Depot St"),
            "laundry": ("Suds & Showers Laundromat", "laundromat", -0.0008, -0.0012, "85 Depot St"),
            "drinking_water": ("Town Park Potable Spigot", "drinking_water", 0.0002, 0.0004, "Town Memorial Park"),
        }

        for p_type in included_types:
            if p_type in type_templates:
                name, primary_type, dlat, dlon, addr = type_templates[p_type]
                plat = round(lat + dlat, 6)
                plon = round(lon + dlon, 6)
                pid = f"mock_{primary_type}_{seed_val % 10000}"

                results.append({
                    "id": pid,
                    "displayName": {"text": name},
                    "primaryType": primary_type,
                    "types": [primary_type, "point_of_interest", "establishment"],
                    "formattedAddress": addr,
                    "location": {"latitude": plat, "longitude": plon},
                    "businessStatus": "OPERATIONAL",
                    "googleMapsUri": f"https://maps.google.com/?q={plat},{plon}",
                    "regularOpeningHours": {
                        "openNow": True,
                        "weekdayDescriptions": ["Monday - Sunday: 7:00 AM – 8:00 PM"]
                    }
                })

        return results[:max_results]


def fetch_places_along_route(
    track: Union[RouteTrack, Sequence[Any]],
    api_key: Optional[str] = None,
    cache_dir: Optional[Union[Path, str]] = None,
    search_radius_m: float = 10000.0,
    max_off_route_m: float = 15000.0,
    max_backcountry_off_route_m: float = 2500.0,
    backcountry_interval_km: float = 25.0,
    categories: Optional[Sequence[Union[ResupplyCategory, str]]] = None,
    towns: Optional[Sequence[Dict[str, Any]]] = None,
    water_sources: Optional[Sequence[Dict[str, Any]]] = None,
    mock_mode: bool = False,
) -> List[Place]:
    """
    Project onto track using TrackIndex, filter places by lateral offset,
    deduplicate places within 100m retaining the closest to trail, and return
    monotonically ordered Place models.
    """
    # 1. Normalize track points
    if isinstance(track, RouteTrack):
        pts_5d = [p.to_list_5d() for p in track.points]
    elif track and isinstance(track[0], RoutePoint):
        pts_5d = [p.to_list_5d() for p in track]
    else:
        pts_5d = list(track)

    if not pts_5d:
        return []

    track_index = TrackIndex(pts_5d)
    cache = APICache(cache_dir=cache_dir, namespace="places")

    # Determine client (mock or live)
    is_mock = mock_mode or bool(os.environ.get("PLACES_MOCK")) or not api_key
    client = MockPlacesClient(cache=cache) if is_mock else GooglePlacesClient(api_key=api_key, cache=cache)

    # Categories to query
    types_to_query = [
        "supermarket", "grocery_store", "convenience_store",
        "bicycle_store", "lodging", "campground", "restaurant",
        "gas_station", "pharmacy", "laundry"
    ]

    raw_places: List[Dict[str, Any]] = []

    # 2. Query search points: towns + backcountry interval checkpoints
    search_centers: List[Tuple[float, float, bool, str]] = []  # (lat, lon, is_town, town_name)

    if towns:
        for t in towns:
            t_lat = t.get("lat") or (t.get("location", {}).get("lat"))
            t_lon = t.get("lon") or (t.get("location", {}).get("lon"))
            t_name = t.get("name", "")
            if t_lat is not None and t_lon is not None:
                search_centers.append((float(t_lat), float(t_lon), True, t_name))

    # Add backcountry search centers every backcountry_interval_km
    total_km = pts_5d[-1][3] if len(pts_5d[-1]) > 3 else 0.0
    if total_km > 0 and backcountry_interval_km > 0:
        step = backcountry_interval_km
        curr_km = step / 2.0
        while curr_km < total_km:
            # Find nearest track point
            pt = min(pts_5d, key=lambda p: abs(p[3] - curr_km))
            search_centers.append((pt[0], pt[1], False, ""))
            curr_km += step
    elif not search_centers:
        # Fallback to midpoint and ends
        first = pts_5d[0]
        mid = pts_5d[len(pts_5d) // 2]
        last = pts_5d[-1]
        search_centers.extend([
            (first[0], first[1], False, ""),
            (mid[0], mid[1], False, ""),
            (last[0], last[1], False, "")
        ])

    for lat, lon, is_town, town_name in search_centers:
        results = client.search_nearby(
            lat=lat,
            lon=lon,
            radius_m=search_radius_m,
            included_types=types_to_query,
            max_results=20
        )
        for r in results:
            r["_is_town"] = is_town
            r["_town_name"] = town_name
            raw_places.append(r)

    # 3. Project places onto route track
    candidate_places: List[Place] = []
    seen_ids = set()

    for rp in raw_places:
        pid = rp.get("id") or rp.get("place_id") or ""
        if pid and pid in seen_ids:
            continue

        loc = rp.get("location", {})
        plat = loc.get("latitude") if "latitude" in loc else loc.get("lat")
        plon = loc.get("longitude") if "longitude" in loc else loc.get("lon")

        if plat is None or plon is None:
            continue

        plat = float(plat)
        plon = float(plon)

        # Track projection
        dist_km, r_km, r_mi = track_index.project_point(plat, plon, max_dist_km=max_off_route_m / 1000.0)
        dist_m = dist_km * 1000.0

        is_town = bool(rp.get("_is_town", False))
        town_name = str(rp.get("_town_name", ""))

        # Lateral corridor clamping
        if is_town and dist_m > max_off_route_m:
            continue
        if not is_town and dist_m > max_backcountry_off_route_m:
            continue

        p_name = ""
        disp_name = rp.get("displayName")
        if isinstance(disp_name, dict):
            p_name = disp_name.get("text", "")
        elif isinstance(disp_name, str):
            p_name = disp_name
        if not p_name:
            p_name = rp.get("name", "Waypoint")

        p_type = rp.get("primaryType") or (rp.get("types", ["other"])[0] if rp.get("types") else "other")
        _, frontend_cat = PLACES_TYPE_TO_CATEGORY.get(p_type, (ResupplyCategory.OTHER, FRONTEND_CATEGORY_MAP.get(p_type, "other")))

        opening_hours = None
        reg_hours = rp.get("regularOpeningHours")
        if isinstance(reg_hours, dict):
            opening_hours = reg_hours.get("weekdayDescriptions")
        open_now = reg_hours.get("openNow") if isinstance(reg_hours, dict) else None

        place = Place(
            id=pid or slugify(p_name, sep="_"),
            name=p_name,
            category=frontend_cat,
            type=p_type,
            location=PlaceLocation(lat=plat, lon=plon),
            distance_to_trail_km=round(dist_km, 3),
            route_km=round(r_km, 3),
            route_mile=round(r_mi, 3),
            is_in_town=is_town,
            town=town_name,
            address=rp.get("formattedAddress", ""),
            open_now=open_now,
            opening_hours=opening_hours,
            google_maps_url=rp.get("googleMapsUri", f"https://maps.google.com/?q={plat:.5f},{plon:.5f}"),
            business_status=rp.get("businessStatus", "OPERATIONAL"),
            province_state=rp.get("province_state", ""),
            country=rp.get("country", ""),
            description=rp.get("description", ""),
        )

        candidate_places.append(place)
        if pid:
            seen_ids.add(pid)

    # Ingest external water sources if provided
    if water_sources:
        for ws in water_sources:
            w_loc = ws.get("location", {})
            wlat = w_loc.get("lat") or ws.get("lat")
            wlon = w_loc.get("lon") or ws.get("lon")
            if wlat is not None and wlon is not None:
                dist_km, r_km, r_mi = track_index.project_point(float(wlat), float(wlon), max_dist_km=max_off_route_m / 1000.0)
                wp = Place(
                    id=ws.get("id", f"water_{int(r_km)}km"),
                    name=ws.get("name", "Water Source"),
                    category="water",
                    type=ws.get("type", "water"),
                    location=PlaceLocation(lat=float(wlat), lon=float(wlon)),
                    distance_to_trail_km=round(dist_km, 3),
                    route_km=round(r_km, 3),
                    route_mile=round(r_mi, 3),
                    is_in_town=bool(ws.get("is_in_town", False)),
                    town=ws.get("town", ""),
                    address=ws.get("address", ""),
                    description=ws.get("description", ""),
                )
                candidate_places.append(wp)

    # 4. Deduplication (< 100m proximity)
    # Sort candidate places by route_km
    candidate_places.sort(key=lambda p: p.route_km)
    deduped_places: List[Place] = []

    for p in candidate_places:
        if not deduped_places:
            deduped_places.append(p)
            continue

        prev = deduped_places[-1]
        dist_between_m = haversine_distance_m(p.location.lat, p.location.lon, prev.location.lat, prev.location.lon)

        if dist_between_m < 100.0 and (p.category == prev.category or {p.category, prev.category} <= {"grocery", "convenience"}):
            # Keep the one closer to the trail
            if p.distance_to_trail_km < prev.distance_to_trail_km:
                # Merge any missing address or opening hours
                if not p.address and prev.address:
                    p.address = prev.address
                if not p.opening_hours and prev.opening_hours:
                    p.opening_hours = prev.opening_hours
                deduped_places[-1] = p
        else:
            deduped_places.append(p)

    unique_places = deduped_places
    unique_places.sort(key=lambda p: (p.route_mile, p.route_km))
    return unique_places
