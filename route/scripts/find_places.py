#!/usr/bin/env python3
"""
Find POIs (bike shops, hotels, grocery stores, restaurants, etc.) around a GPS point
or along the Tour Divide route using the Google Maps Places API.

Usage:
  # Search around specific coordinates:
  python3 find_places.py --lat 51.1784 --lon -115.5708 --radius 5000

  # Search around a specific mile along the Tour Divide GPX track:
  python3 find_places.py --gpx ../tour-divide-2025.gpx --mile 150 --categories bike_shop,hotel,grocery

  # Search with mock data (no API key needed):
  python3 find_places.py --lat 51.1784 --lon -115.5708 --mock

  # Export results to GPX waypoints and JSON:
  python3 find_places.py --point 51.1784,-115.5708 --output-gpx banff_pois.gpx --output-json banff_pois.json
"""

import argparse
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

import requests

# ---------------------------------------------------------------------------
# Category & Search Definitions
# ---------------------------------------------------------------------------

CATEGORY_CONFIGS = {
    "bike_shop": {
        "label": "Bike Shop / Repair",
        "types": ["bicycle_store"],
        "keywords": ["bike shop", "bicycle repair"],
        "symbol": "Bike Trail",
    },
    "hotel": {
        "label": "Lodging / Hotel / Cabin",
        "types": ["lodging"],
        "keywords": ["motel", "hotel", "cabin", "hostel", "inn"],
        "symbol": "Lodging",
    },
    "campground": {
        "label": "Campground / RV Park",
        "types": ["campground", "rv_park"],
        "keywords": ["campground", "camping"],
        "symbol": "Campground",
    },
    "grocery": {
        "label": "Grocery / Supermarket",
        "types": ["supermarket", "grocery_or_supermarket", "convenience_store"],
        "keywords": ["grocery", "general store", "market"],
        "symbol": "Convenience Store",
    },
    "food": {
        "label": "Restaurant / Cafe / Bakery",
        "types": ["restaurant", "cafe", "bakery", "meal_takeaway"],
        "keywords": ["diner", "cafe", "restaurant"],
        "symbol": "Restaurant",
    },
    "gas_station": {
        "label": "Gas Station (Resupply)",
        "types": ["gas_station"],
        "keywords": ["gas station", "convenience store"],
        "symbol": "Gas Station",
    },
    "pharmacy": {
        "label": "Pharmacy / Drugstore",
        "types": ["pharmacy", "drugstore"],
        "keywords": ["pharmacy"],
        "symbol": "Pharmacy",
    },
    "post_office": {
        "label": "Post Office (Bounce Box)",
        "types": ["post_office"],
        "keywords": ["post office", "usps"],
        "symbol": "Post Office",
    },
    "laundry": {
        "label": "Laundromat / Laundry",
        "types": ["laundry"],
        "keywords": ["laundromat", "laundry", "coin laundry", "wash and fold"],
        "symbol": "Laundry",
    },
}

ALL_CATEGORIES = list(CATEGORY_CONFIGS.keys())


# ---------------------------------------------------------------------------
# Geodesic Utilities
# ---------------------------------------------------------------------------

def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two coordinates in km."""
    R = 6371.0088  # Mean Earth radius in kilometers
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    """Calculate initial compass bearing from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    initial_bearing = math.atan2(y, x)
    initial_bearing = math.degrees(initial_bearing)
    compass_bearing = (initial_bearing + 360.0) % 360.0

    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"]
    idx = int((compass_bearing + 22.5) // 45)
    return directions[idx]


# ---------------------------------------------------------------------------
# GPX Parser & Route Distance Tracker
# ---------------------------------------------------------------------------

class TrackPoint:
    def __init__(self, lat: float, lon: float, ele: float = 0.0, dist_km: float = 0.0, dist_mi: float = 0.0, index: int = 0):
        self.lat = lat
        self.lon = lon
        self.ele = ele
        self.dist_km = dist_km
        self.dist_mi = dist_mi
        self.index = index

    def __repr__(self) -> str:
        return f"TrackPoint(idx={self.index}, lat={self.lat:.5f}, lon={self.lon:.5f}, mi={self.dist_mi:.1f})"


def parse_gpx_route(gpx_path: str) -> List[TrackPoint]:
    """Parse GPX trackpoints and calculate cumulative distance from start."""
    if not os.path.exists(gpx_path):
        raise FileNotFoundError(f"GPX file not found: {gpx_path}")

    tree = ET.parse(gpx_path)
    root = tree.getroot()
    ns = {"gpx": "http://www.topografix.com/GPX/1/1"}

    raw_pts = root.findall(".//gpx:trkpt", ns)
    if not raw_pts:
        # Fallback if no namespace
        raw_pts = root.findall(".//trkpt")

    points: List[TrackPoint] = []
    total_dist_km = 0.0

    for i, pt in enumerate(raw_pts):
        lat = float(pt.attrib["lat"])
        lon = float(pt.attrib["lon"])
        ele_elem = pt.find("gpx:ele", ns) if ns else pt.find("ele")
        ele = float(ele_elem.text) if ele_elem is not None and ele_elem.text else 0.0

        if i > 0:
            step = haversine_distance_km(points[-1].lat, points[-1].lon, lat, lon)
            total_dist_km += step

        total_dist_mi = total_dist_km * 0.621371
        points.append(TrackPoint(lat=lat, lon=lon, ele=ele, dist_km=total_dist_km, dist_mi=total_dist_mi, index=i))

    return points


def parse_track_json(json_path: str) -> List[TrackPoint]:
    """Parse route-track.json trackpoints and return List[TrackPoint]."""
    if not os.path.exists(json_path):
        raise FileNotFoundError(f"Track file not found: {json_path}")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    pts = data.get("points", [])
    return [
        TrackPoint(lat=p[0], lon=p[1], ele=p[2], dist_km=p[3], dist_mi=p[4], index=i)
        for i, p in enumerate(pts)
    ]


def find_point_by_mile(points: List[TrackPoint], target_mile: float) -> TrackPoint:
    """Find closest trackpoint to target mile marker."""
    if target_mile <= 0:
        return points[0]
    if target_mile >= points[-1].dist_mi:
        return points[-1]
    return min(points, key=lambda p: abs(p.dist_mi - target_mile))


def find_point_by_km(points: List[TrackPoint], target_km: float) -> TrackPoint:
    """Find closest trackpoint to target kilometer marker."""
    if target_km <= 0:
        return points[0]
    if target_km >= points[-1].dist_km:
        return points[-1]
    return min(points, key=lambda p: abs(p.dist_km - target_km))


# ---------------------------------------------------------------------------
# Google Places API Client
# ---------------------------------------------------------------------------

class GooglePlacesClient:
    NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
    GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session = requests.Session()

    def reverse_geocode(self, lat: float, lon: float) -> Optional[str]:
        """Resolve a GPS coordinate into a human-readable town/locality name."""
        try:
            params = {
                "latlng": f"{lat},{lon}",
                "key": self.api_key,
                "result_type": "locality|administrative_area_level_2|administrative_area_level_1",
            }
            resp = self.session.get(self.GEOCODE_URL, params=params, timeout=10)
            data = resp.json()
            if data.get("status") == "OK" and data.get("results"):
                return data["results"][0].get("formatted_address")
        except Exception:
            pass
        return None

    def search_nearby(
        self,
        lat: float,
        lon: float,
        radius_meters: int,
        place_type: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Query Google Places Nearby Search."""
        params: Dict[str, Any] = {
            "location": f"{lat},{lon}",
            "radius": radius_meters,
            "key": self.api_key,
        }
        if place_type:
            params["type"] = place_type
        if keyword:
            params["keyword"] = keyword

        results = []
        try:
            resp = self.session.get(self.NEARBY_URL, params=params, timeout=15)
            data = resp.json()
            status = data.get("status")

            if status == "OK":
                results = data.get("results", [])
            elif status == "ZERO_RESULTS":
                results = []
            elif status in ("REQUEST_DENIED", "OVER_QUERY_LIMIT"):
                error_msg = data.get("error_message", status)
                print(f"[ERROR] Google Places API Error ({status}): {error_msg}", file=sys.stderr)
            else:
                if data.get("error_message"):
                    print(f"[WARN] API notice ({status}): {data.get('error_message')}", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR] Failed to query Google Places: {e}", file=sys.stderr)

        return results

    def fetch_details(self, place_id: str) -> Dict[str, Any]:
        """Fetch detailed information for a specific place (phone, website, hours)."""
        params = {
            "place_id": place_id,
            "fields": "formatted_phone_number,international_phone_number,opening_hours,website,url,business_status",
            "key": self.api_key,
        }
        try:
            resp = self.session.get(self.DETAILS_URL, params=params, timeout=10)
            data = resp.json()
            if data.get("status") == "OK":
                return data.get("result", {})
        except Exception:
            pass
        return {}


# ---------------------------------------------------------------------------
# Mock Client for Offline / Keyless Testing
# ---------------------------------------------------------------------------

class MockPlacesClient:
    """Mock client returning realistic POIs for testing without an API key."""

    def reverse_geocode(self, lat: float, lon: float) -> str:
        return f"Approx Location ({lat:.4f}, {lon:.4f})"

    def search_nearby(
        self,
        lat: float,
        lon: float,
        radius_meters: int,
        place_type: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        mock_places = []
        if place_type == "bicycle_store" or (keyword and "bike" in keyword):
            mock_places.append({
                "place_id": "mock_bike_1",
                "name": "Divide Trail Cycle & Repair",
                "types": ["bicycle_store", "point_of_interest", "store"],
                "vicinity": "104 Main St",
                "rating": 4.9,
                "user_ratings_total": 42,
                "geometry": {"location": {"lat": lat + 0.003, "lng": lon + 0.002}},
                "opening_hours": {"open_now": True},
            })
        if place_type in ("lodging", "campground") or (keyword and ("hotel" in keyword or "cabin" in keyword)):
            mock_places.append({
                "place_id": "mock_hotel_1",
                "name": "Continental Divide Lodge & Cabins",
                "types": ["lodging", "point_of_interest"],
                "vicinity": "250 Forest Service Rd",
                "rating": 4.6,
                "user_ratings_total": 88,
                "geometry": {"location": {"lat": lat - 0.005, "lng": lon - 0.004}},
                "opening_hours": {"open_now": True},
            })
        if place_type in ("supermarket", "convenience_store", "grocery_or_supermarket") or (keyword and "grocery" in keyword):
            mock_places.append({
                "place_id": "mock_grocery_1",
                "name": "Mountain Town Mercantile & Grocery",
                "types": ["supermarket", "grocery_or_supermarket", "store"],
                "vicinity": "50 North Ave",
                "rating": 4.7,
                "user_ratings_total": 120,
                "geometry": {"location": {"lat": lat + 0.001, "lng": lon - 0.002}},
                "opening_hours": {"open_now": True},
            })
        if place_type == "gas_station":
            mock_places.append({
                "place_id": "mock_gas_1",
                "name": "Exxon / Town Pump & 24hr C-Store",
                "types": ["gas_station", "convenience_store", "store"],
                "vicinity": "Highway 93",
                "rating": 4.2,
                "user_ratings_total": 35,
                "geometry": {"location": {"lat": lat + 0.008, "lng": lon + 0.007}},
                "opening_hours": {"open_now": True},
            })
        if place_type in ("restaurant", "cafe"):
            mock_places.append({
                "place_id": "mock_food_1",
                "name": "Cowboy Cafe & Bakery",
                "types": ["restaurant", "cafe", "food"],
                "vicinity": "112 Main St",
                "rating": 4.8,
                "user_ratings_total": 215,
                "geometry": {"location": {"lat": lat - 0.002, "lng": lon + 0.001}},
                "opening_hours": {"open_now": False},
            })
        if place_type in ("laundry", "laundromat") or (keyword and ("laundry" in keyword or "laundromat" in keyword)):
            mock_places.append({
                "place_id": "mock_laundry_1",
                "name": "Trailside Suds Laundromat & Showers",
                "types": ["laundry", "point_of_interest"],
                "vicinity": "118 Elm St",
                "rating": 4.6,
                "user_ratings_total": 34,
                "geometry": {"location": {"lat": lat - 0.001, "lng": lon - 0.003}},
                "opening_hours": {"open_now": True},
            })
        if place_type in ("pharmacy", "drugstore") or (keyword and "pharmacy" in keyword):
            mock_places.append({
                "place_id": "mock_pharmacy_1",
                "name": "Main Street Pharmacy & Health",
                "types": ["pharmacy", "health", "point_of_interest", "store"],
                "vicinity": "205 Main St",
                "rating": 4.7,
                "user_ratings_total": 45,
                "geometry": {"location": {"lat": lat + 0.002, "lng": lon + 0.003}},
                "opening_hours": {"open_now": True},
            })
        if place_type == "post_office" or (keyword and ("post office" in keyword or "usps" in keyword)):
            mock_places.append({
                "place_id": "mock_post_1",
                "name": "United States Post Office",
                "types": ["post_office", "finance", "point_of_interest"],
                "vicinity": "310 1st Ave",
                "rating": 4.3,
                "user_ratings_total": 29,
                "geometry": {"location": {"lat": lat - 0.003, "lng": lon - 0.001}},
                "opening_hours": {"open_now": True},
            })
        return mock_places

    def fetch_details(self, place_id: str) -> Dict[str, Any]:
        return {
            "formatted_phone_number": "+1 (555) 019-2834",
            "website": "https://example.com/resupply",
            "business_status": "OPERATIONAL",
        }


# ---------------------------------------------------------------------------
# Search Orchestration & Deduplication
# ---------------------------------------------------------------------------

def search_places_around_point(
    client: Any,
    center_lat: float,
    center_lon: float,
    radius_meters: int,
    categories: List[str],
    custom_keyword: Optional[str] = None,
    fetch_details: bool = False,
) -> List[Dict[str, Any]]:
    """Query places across requested categories, deduplicate, and enrich."""
    seen_places: Dict[str, Dict[str, Any]] = {}

    for cat_key in categories:
        conf = CATEGORY_CONFIGS.get(cat_key)
        if not conf:
            continue

        raw_results: List[Dict[str, Any]] = []

        # 1. Search by primary types
        for p_type in conf["types"]:
            res = client.search_nearby(center_lat, center_lon, radius_meters, place_type=p_type)
            raw_results.extend(res)

        # 2. Search by keywords for broader matches
        for kw in conf["keywords"]:
            res = client.search_nearby(center_lat, center_lon, radius_meters, keyword=kw)
            raw_results.extend(res)

        # Merge into seen_places
        for r in raw_results:
            pid = r.get("place_id")
            if not pid:
                continue

            if pid not in seen_places:
                p_lat = r["geometry"]["location"]["lat"]
                p_lon = r["geometry"]["location"]["lng"]
                dist_km = haversine_distance_km(center_lat, center_lon, p_lat, p_lon)
                dist_mi = dist_km * 0.621371
                bearing = calculate_bearing(center_lat, center_lon, p_lat, p_lon)

                seen_places[pid] = {
                    "place_id": pid,
                    "name": r.get("name"),
                    "lat": p_lat,
                    "lon": p_lon,
                    "distance_km": round(dist_km, 2),
                    "distance_miles": round(dist_mi, 2),
                    "bearing": bearing,
                    "address": r.get("vicinity") or r.get("formatted_address") or "N/A",
                    "rating": r.get("rating"),
                    "user_ratings_total": r.get("user_ratings_total", 0),
                    "open_now": r.get("opening_hours", {}).get("open_now") if "opening_hours" in r else None,
                    "types": r.get("types", []),
                    "categories": [conf["label"]],
                    "symbol": conf["symbol"],
                }
            else:
                if conf["label"] not in seen_places[pid]["categories"]:
                    seen_places[pid]["categories"].append(conf["label"])

    # Custom keyword search if specified
    if custom_keyword:
        res = client.search_nearby(center_lat, center_lon, radius_meters, keyword=custom_keyword)
        for r in res:
            pid = r.get("place_id")
            if not pid:
                continue
            if pid not in seen_places:
                p_lat = r["geometry"]["location"]["lat"]
                p_lon = r["geometry"]["location"]["lng"]
                dist_km = haversine_distance_km(center_lat, center_lon, p_lat, p_lon)
                seen_places[pid] = {
                    "place_id": pid,
                    "name": r.get("name"),
                    "lat": p_lat,
                    "lon": p_lon,
                    "distance_km": round(dist_km, 2),
                    "distance_miles": round(dist_km * 0.621371, 2),
                    "bearing": calculate_bearing(center_lat, center_lon, p_lat, p_lon),
                    "address": r.get("vicinity") or r.get("formatted_address") or "N/A",
                    "rating": r.get("rating"),
                    "user_ratings_total": r.get("user_ratings_total", 0),
                    "open_now": r.get("opening_hours", {}).get("open_now") if "opening_hours" in r else None,
                    "types": r.get("types", []),
                    "categories": [f"Keyword: '{custom_keyword}'"],
                    "symbol": "Waypoint",
                }

    # Sort results by distance
    results_list = list(seen_places.values())
    results_list.sort(key=lambda x: x["distance_km"])

    if fetch_details:
        print(f"Fetching additional details for {len(results_list)} place(s)...")
        for item in results_list:
            details = client.fetch_details(item["place_id"])
            item["phone"] = details.get("formatted_phone_number")
            item["website"] = details.get("website")
            item["maps_url"] = details.get("url")

    return results_list


# ---------------------------------------------------------------------------
# Output Formatters: CLI, JSON, GPX
# ---------------------------------------------------------------------------

def print_cli_table(
    results: List[Dict[str, Any]],
    center_lat: float,
    center_lon: float,
    location_name: Optional[str] = None,
    gpx_info: Optional[str] = None,
):
    """Print formatted console output."""
    print("=" * 95)
    print("TOUR DIVIDE POI SEARCH RESULTS")
    print(f"Search Point: {center_lat:.6f}, {center_lon:.6f}")
    if location_name:
        print(f"Location    : {location_name}")
    if gpx_info:
        print(f"Route Marker: {gpx_info}")
    print(f"Found       : {len(results)} POI(s)")
    print("=" * 95)

    if not results:
        print("No places found within the specified radius and categories.")
        print("-" * 95)
        return

    # Header
    print(f"{'Distance':<11} | {'Category':<22} | {'Name':<28} | {'Rating':<8} | {'Address / Notes'}")
    print("-" * 95)

    for item in results:
        dist_str = f"{item['distance_miles']} mi ({item['bearing']})"
        cat_str = item["categories"][0] if item["categories"] else "Other"
        if len(cat_str) > 22:
            cat_str = cat_str[:19] + "..."
        name_str = item["name"] if len(item["name"]) <= 28 else item["name"][:25] + "..."
        rating_str = f"★ {item['rating']}" if item.get("rating") else "N/A"
        addr = item.get("address", "")
        if item.get("phone"):
            addr += f" | {item['phone']}"
        if item.get("open_now") is True:
            addr += " [OPEN]"
        elif item.get("open_now") is False:
            addr += " [CLOSED]"

        print(f"{dist_str:<11} | {cat_str:<22} | {name_str:<28} | {rating_str:<8} | {addr}")

    print("=" * 95)


def export_gpx_waypoints(results: List[Dict[str, Any]], output_file: str):
    """Export POIs to a GPX waypoints file compatible with Garmin / Wahoo / RideWithGPS."""
    gpx_root = ET.Element("gpx", {
        "version": "1.1",
        "creator": "Tour Divide 2027 POI Finder",
        "xmlns": "http://www.topografix.com/GPX/1/1",
    })

    for item in results:
        wpt = ET.SubElement(gpx_root, "wpt", {
            "lat": str(item["lat"]),
            "lon": str(item["lon"]),
        })
        name_elem = ET.SubElement(wpt, "name")
        name_elem.text = item["name"]

        desc_parts = []
        desc_parts.append(f"Category: {', '.join(item['categories'])}")
        desc_parts.append(f"Address: {item.get('address', 'N/A')}")
        if item.get("rating"):
            desc_parts.append(f"Rating: {item['rating']} ({item.get('user_ratings_total', 0)} reviews)")
        if item.get("phone"):
            desc_parts.append(f"Phone: {item['phone']}")
        if item.get("website"):
            desc_parts.append(f"Web: {item['website']}")

        desc_elem = ET.SubElement(wpt, "desc")
        desc_elem.text = " | ".join(desc_parts)

        sym_elem = ET.SubElement(wpt, "sym")
        sym_elem.text = item.get("symbol", "Waypoint")

        type_elem = ET.SubElement(wpt, "type")
        type_elem.text = item["categories"][0] if item["categories"] else "Resupply"

    tree = ET.ElementTree(gpx_root)
    ET.indent(tree, space="  ", level=0)
    tree.write(output_file, encoding="utf-8", xml_declaration=True)
    print(f"[GPX] Exported {len(results)} waypoints to {output_file}")


def export_json(results: List[Dict[str, Any]], output_file: str):
    """Export POIs to a structured JSON file."""
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"[JSON] Exported {len(results)} items to {output_file}")


# ---------------------------------------------------------------------------
# CLI Argument Parser & Entrypoint
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search POIs (bike shops, lodging, grocery, gas) around a GPS coordinate or along Tour Divide GPX.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # 1. Search Banff start (lat, lon):
  python3 find_places.py --lat 51.161267 --lon -115.56016 --radius 5000

  # 2. Search at mile 150 on the Tour Divide route:
  python3 find_places.py --gpx ../tour-divide-2025.gpx --mile 150 --categories bike_shop,grocery,hotel

  # 3. Test output with mock data (no API key required):
  python3 find_places.py --point 51.161267,-115.56016 --mock

  # 4. Search and export to GPX waypoints:
  python3 find_places.py --gpx ../tour-divide-2025.gpx --mile 500 --output-gpx butte_resupply.gpx
        """,
    )

    coord_group = parser.add_argument_group("Target Location (Coordinate or Route)")
    coord_group.add_argument("--route", type=str, help="Target route slug ID (e.g. colorado-trail, tour-divide-2025)")
    coord_group.add_argument("--lat", type=float, help="Latitude of the search center")
    coord_group.add_argument("--lon", type=float, help="Longitude of the search center")
    coord_group.add_argument("--point", type=str, help="GPS coordinate in 'lat,lon' format (e.g. 51.161267,-115.56016)")
    coord_group.add_argument("--track", type=str, help="Path to route-track.json file")
    coord_group.add_argument("--gpx", type=str, help="Path to GPX route file")
    coord_group.add_argument("--mile", type=float, help="Search around a specific mile along the route")
    coord_group.add_argument("--km", type=float, help="Search around a specific kilometer along the route")
    coord_group.add_argument("--index", type=int, help="Search around a specific trackpoint index in the route file")

    query_group = parser.add_argument_group("Search Configuration")
    query_group.add_argument(
        "--radius",
        type=int,
        default=8000,
        help="Search radius in meters (default: 8000m / ~5 miles)",
    )
    query_group.add_argument(
        "--categories",
        type=str,
        default="bike_shop,hotel,grocery,gas_station,laundry",
        help=f"Comma-separated list of categories. Available: {','.join(ALL_CATEGORIES)}, or 'all'",
    )
    query_group.add_argument("--keyword", type=str, help="Additional custom search keyword (e.g. 'safeway', 'outdoor store')")
    query_group.add_argument("--details", action="store_true", help="Fetch phone, website, and opening hours for each place")

    export_group = parser.add_argument_group("Export Options")
    export_group.add_argument("--output-json", type=str, help="Path to write JSON results file")
    export_group.add_argument("--output-gpx", type=str, help="Path to write GPX waypoints file")

    auth_group = parser.add_argument_group("Google Cloud API Configuration")
    auth_group.add_argument(
        "--api-key",
        type=str,
        default=(
            os.getenv("GOOGLE_CLOUD_API_KEY")
            or os.getenv("GOOGLE_PLACES_API_KEY")
            or os.getenv("GOOGLE_MAPS_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
        ),
        help="Google API Key (reads GOOGLE_CLOUD_API_KEY, GOOGLE_PLACES_API_KEY, or GOOGLE_MAPS_API_KEY env var)",
    )
    auth_group.add_argument(
        "--mock",
        action="store_true",
        help="Use simulated mock data without contacting Google Maps API",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    center_lat: Optional[float] = None
    center_lon: Optional[float] = None
    route_info_str: Optional[str] = None
    route_name: str = args.route or "Route"

    # Resolve track points if route/gpx/track options are provided
    points: Optional[List[TrackPoint]] = None
    track_source: Optional[str] = None
    is_json_track = False

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))

    if args.track:
        track_source = args.track
        is_json_track = True
    elif args.gpx:
        track_source = args.gpx
        is_json_track = False
    elif args.route:
        r_track = os.path.join(project_root, "public", "data", "routes", args.route, "route-track.json")
        r_gpx = os.path.join(project_root, "route", f"{args.route}.gpx")
        r_the_gpx = os.path.join(project_root, "route", f"the-{args.route}.gpx")
        if os.path.exists(r_track):
            track_source = r_track
            is_json_track = True
        elif os.path.exists(r_gpx):
            track_source = r_gpx
            is_json_track = False
        elif os.path.exists(r_the_gpx):
            track_source = r_the_gpx
            is_json_track = False
    elif args.mile is not None or args.km is not None or args.index is not None:
        # Fallback default GPX if mile/km requested without explicit route
        default_gpx = os.path.join(project_root, "route", "tour-divide-2025.gpx")
        if os.path.exists(default_gpx):
            track_source = default_gpx
            is_json_track = False

    if track_source:
        if not os.path.exists(track_source):
            alt_path = os.path.join(script_dir, track_source)
            if os.path.exists(alt_path):
                track_source = alt_path

        if os.path.exists(track_source):
            print(f"Loading route track: {track_source} ...")
            if is_json_track or track_source.endswith(".json"):
                points = parse_track_json(track_source)
            else:
                points = parse_gpx_route(track_source)
            print(f"Loaded {len(points)} track points (Total: {points[-1].dist_mi:.1f} mi / {points[-1].dist_km:.1f} km)")

    # 1. Parse coordinate inputs
    if args.point:
        try:
            parts = [float(p.strip()) for p in args.point.split(",")]
            center_lat, center_lon = parts[0], parts[1]
        except Exception:
            parser.error("Invalid --point format. Expected 'lat,lon' (e.g. 51.161267,-115.56016)")
    elif args.lat is not None and args.lon is not None:
        center_lat = args.lat
        center_lon = args.lon
    elif (args.mile is not None or args.km is not None or args.index is not None) and points:
        if args.mile is not None:
            pt = find_point_by_mile(points, args.mile)
            center_lat, center_lon = pt.lat, pt.lon
            route_info_str = f"{route_name} Mile {args.mile:.1f} (nearest trackpoint #{pt.index}, actual mi: {pt.dist_mi:.1f}, ele: {pt.ele:.0f}m)"
        elif args.km is not None:
            pt = find_point_by_km(points, args.km)
            center_lat, center_lon = pt.lat, pt.lon
            route_info_str = f"{route_name} Km {args.km:.1f} (nearest trackpoint #{pt.index}, actual km: {pt.dist_km:.1f}, ele: {pt.ele:.0f}m)"
        elif args.index is not None:
            idx = max(0, min(args.index, len(points) - 1))
            pt = points[idx]
            center_lat, center_lon = pt.lat, pt.lon
            route_info_str = f"{route_name} Trackpoint #{idx} (Mile {pt.dist_mi:.1f}, ele: {pt.ele:.0f}m)"
    elif points:
        pt = points[0]
        center_lat, center_lon = pt.lat, pt.lon
        route_info_str = f"{route_name} Start (Trackpoint #0, Mile 0.0, ele: {pt.ele:.0f}m)"
        print(f"No coordinate or marker provided. Defaulting to {route_name} Start ({center_lat:.4f}, {center_lon:.4f})...")
    else:
        # Default to route start (Banff, AB) if no arguments are passed
        print("No coordinate or route marker provided. Defaulting to Tour Divide Start (Banff, AB)...")
        center_lat = 51.161267
        center_lon = -115.56016
        route_info_str = "Tour Divide Grand Depart (Banff, AB - Mile 0.0)"

    # 2. Parse categories
    if args.categories.lower() == "all":
        selected_categories = ALL_CATEGORIES
    else:
        selected_categories = [c.strip() for c in args.categories.split(",") if c.strip()]

    # 3. Initialize API client or Mock client
    client: Any = None
    if args.mock:
        print("[MOCK MODE] Running with simulated POI data (no API key required).")
        client = MockPlacesClient()
    else:
        if not args.api_key:
            print("\n" + "!" * 80, file=sys.stderr)
            print("[ERROR] Google Maps API key not found!", file=sys.stderr)
            print("Please provide an API key using --api-key or set the GOOGLE_CLOUD_API_KEY environment variable:", file=sys.stderr)
            print("   export GOOGLE_CLOUD_API_KEY='your-api-key-here'", file=sys.stderr)
            print("\nRequired Google Cloud APIs to enable on your project:", file=sys.stderr)
            print("   1. Places API (or Places API (New))", file=sys.stderr)
            print("   2. Geocoding API (recommended for town/locality resolution)", file=sys.stderr)
            print("\nTip: Run with '--mock' to test the script with sample data before setting up the key.", file=sys.stderr)
            print("!" * 80 + "\n", file=sys.stderr)
            sys.exit(1)
        client = GooglePlacesClient(api_key=args.api_key)

    # 4. Reverse geocode location for context
    location_name = client.reverse_geocode(center_lat, center_lon)

    # 5. Search for places
    print(f"Searching for categories: {', '.join(selected_categories)} within {args.radius}m ...")
    results = search_places_around_point(
        client=client,
        center_lat=center_lat,
        center_lon=center_lon,
        radius_meters=args.radius,
        categories=selected_categories,
        custom_keyword=args.keyword,
        fetch_details=args.details,
    )

    # 6. Display results
    print_cli_table(
        results=results,
        center_lat=center_lat,
        center_lon=center_lon,
        location_name=location_name,
        gpx_info=route_info_str,
    )

    # 7. Exports
    if args.output_json:
        export_json(results, args.output_json)
    if args.output_gpx:
        export_gpx_waypoints(results, args.output_gpx)


if __name__ == "__main__":
    main()
