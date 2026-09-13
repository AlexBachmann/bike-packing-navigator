#!/usr/bin/env python3
"""
populate_places.py - Extract POIs along a route using Google Places API (New).

Cost-Optimized Architecture ($0.00 Out-of-Pocket):
- Operates strictly in the 'Nearby Search (Pro)' SKU tier (5,000 FREE calls/month).
- Field Mask strictly limited to Pro tier fields:
  places.id,places.displayName,places.primaryType,places.types,places.formattedAddress,
  places.location,places.regularOpeningHours,places.googleMapsUri,places.businessStatus
- Persistent disk cache ensures re-runs consume 0 API requests.

Usage:
  python3 populate_places.py --track <path_to_route_track_json> --output <path_to_places_json> [--cache <path_to_cache>] [--api-key <key>] [--towns <path_to_towns>]
"""

import argparse
import json
import math
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple
import requests

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

CATEGORY_MAP = {
    'campground': 'campground',
    'rv_park': 'campground',
    'lodging': 'hotel',
    'hotel': 'hotel',
    'motel': 'hotel',
    'hostel': 'hotel',
    'cabin': 'hotel',
    'supermarket': 'grocery',
    'grocery_store': 'grocery',
    'convenience_store': 'grocery',
    'store': 'grocery',
    'general_store': 'grocery',
    'restaurant': 'restaurant',
    'cafe': 'restaurant',
    'bakery': 'restaurant',
    'fast_food': 'restaurant',
    'bar': 'restaurant',
    'bicycle_store': 'bike',
    'bicycle_repair_service': 'bike',
    'bike_shop': 'bike',
    'laundromat': 'laundry',
    'gas_station': 'services',
    'post_office': 'services',
    'pharmacy': 'services'
}

class PlacesCache:
    def __init__(self, cache_file: str):
        self.cache_file = cache_file
        self.cache: Dict[str, Any] = {}
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    self.cache = json.load(f)
                print(f"[PLACES] Loaded {len(self.cache)} cached queries from {cache_file}")
            except Exception as e:
                print(f"[PLACES] Cache load warning: {e}", file=sys.stderr)

    def get(self, key: str) -> Optional[List[Dict[str, Any]]]:
        return self.cache.get(key)

    def set(self, key: str, data: List[Dict[str, Any]]):
        self.cache[key] = data

    def save(self):
        try:
            os.makedirs(os.path.dirname(os.path.abspath(self.cache_file)), exist_ok=True)
            with open(self.cache_file, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, indent=2, ensure_ascii=False)
            print(f"[PLACES] Saved {len(self.cache)} cached queries to {self.cache_file}")
        except Exception as e:
            print(f"[PLACES] Cache save warning: {e}", file=sys.stderr)

def fetch_places_nearby(
    lat: float,
    lon: float,
    radius_m: float,
    types: List[str],
    api_key: str,
    cache: PlacesCache
) -> List[Dict[str, Any]]:
    key = f"{lat:.5f},{lon:.5f}_{radius_m}_{'_'.join(sorted(types))}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    if not api_key:
        return []

    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.primaryType,places.types,"
            "places.formattedAddress,places.location,places.regularOpeningHours,"
            "places.googleMapsUri,places.businessStatus"
        )
    }

    body = {
        "includedTypes": types,
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lon},
                "radius": radius_m
            }
        }
    }

    try:
        time.sleep(0.08) # Respect rate limits
        resp = requests.post(url, headers=headers, json=body, timeout=12)
        if resp.status_code == 200:
            data = resp.json().get("places", [])
            cache.set(key, data)
            return data
        else:
            print(f"[PLACES API WARN] {resp.status_code}: {resp.text[:120]}", file=sys.stderr)
            return []
    except Exception as err:
        print(f"[PLACES API ERR] {err}", file=sys.stderr)
        return []

def project_onto_track(
    plat: float,
    plon: float,
    track_coords: List[Tuple[float, float]],
    track_kms: List[float]
) -> Tuple[float, float, float]:
    min_d = 999999.0
    best_i = 0
    n = len(track_coords)

    # Step 1: Coarse grid search every 10 points
    for i in range(0, n, 10):
        lat, lon = track_coords[i]
        dlat = (lat - plat) * 111.0
        dlon = (lon - plon) * 111.0 * math.cos(math.radians(plat))
        d = dlat * dlat + dlon * dlon
        if d < min_d:
            min_d = d
            best_i = i

    # Step 2: Fine pass in window
    start = max(0, best_i - 15)
    end = min(n, best_i + 16)
    best_dist_km = 999999.0
    best_exact_i = best_i

    for i in range(start, end):
        tlat, tlon = track_coords[i]
        dist_km = haversine_km(plat, plon, tlat, tlon)
        if dist_km < best_dist_km:
            best_dist_km = dist_km
            best_exact_i = i

    r_km = track_kms[best_exact_i]
    r_mi = r_km * 0.621371
    return round(best_dist_km, 2), round(r_km, 1), round(r_mi, 1)

def run_extraction(
    track_path: str,
    output_path: str,
    cache_path: str,
    api_key: Optional[str] = None,
    towns_path: Optional[str] = None
):
    with open(track_path, "r", encoding="utf-8") as f:
        track_data = json.load(f)

    points = track_data.get("points", [])
    if not points:
        raise ValueError("No points found in route-track.json")

    track_coords = [(p[0], p[1]) for p in points]
    track_kms = [p[3] for p in points]
    total_km = track_kms[-1]

    cache = PlacesCache(cache_path)
    places_by_id: Dict[str, Dict[str, Any]] = {}

    # 1. Backcountry sampling checkpoints every 12 km
    sample_interval_km = 12.0
    curr_target_km = 6.0
    checkpoints = []

    while curr_target_km < total_km:
        pt = min(points, key=lambda p: abs(p[3] - curr_target_km))
        checkpoints.append(pt)
        curr_target_km += sample_interval_km

    print(f"[PLACES] Sampling {len(checkpoints)} backcountry checkpoints along route...")

    backcountry_types = ["campground", "lodging", "grocery_store", "store", "restaurant", "gas_station"]

    for idx, cp in enumerate(checkpoints):
        lat, lon, ele, km, mi = cp
        raw_places = fetch_places_nearby(lat, lon, 7000.0, backcountry_types, api_key or "", cache)
        for p in raw_places:
            pid = p.get("id")
            if not pid or pid in places_by_id:
                continue

            loc = p.get("location", {})
            plat = loc.get("latitude")
            plon = loc.get("longitude")
            if plat is None or plon is None:
                continue

            dist_to_trail, r_km, r_mi = project_onto_track(plat, plon, track_coords, track_kms)

            # Filter backcountry places to <= 1.2 km from trail
            if dist_to_trail <= 1.2:
                ptypes = p.get("types", [])
                primary = p.get("primaryType", "")
                cat = "services"
                for t in [primary] + ptypes:
                    if t in CATEGORY_MAP:
                        cat = CATEGORY_MAP[t]
                        break

                display_name = p.get("displayName", {}).get("text", "Waypoint")
                places_by_id[pid] = {
                    "id": pid,
                    "name": display_name,
                    "category": cat,
                    "type": cat,
                    "town": "",
                    "is_in_town": False,
                    "location": {"lat": plat, "lon": plon},
                    "distance_to_trail_km": dist_to_trail,
                    "route_km": r_km,
                    "route_mile": r_mi,
                    "address": p.get("formattedAddress", ""),
                    "google_maps_url": p.get("googleMapsUri", ""),
                    "business_status": p.get("businessStatus", "OPERATIONAL")
                }

    # Save cache
    cache.save()

    # Convert to sorted list
    result_places = list(places_by_id.values())
    result_places.sort(key=lambda p: p["route_mile"])

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result_places, f, indent=2)

    print(f"[PLACES] Extracted {len(result_places)} places saved to {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Extract POIs using Google Places API (New) Pro tier")
    parser.add_argument("--track", required=True, help="Path to input route-track.json")
    parser.add_argument("--output", required=True, help="Path to output places.json")
    parser.add_argument("--cache", default="route/places/.cache_places_api.json", help="Path to persistent cache file")
    parser.add_argument("--api-key", default=os.environ.get("GOOGLE_PLACES_API_KEY") or os.environ.get("GOOGLE_MAPS_API_KEY"), help="Google Places API Key")
    parser.add_argument("--towns", required=False, help="Optional towns JSON filepath")
    args = parser.parse_args()

    run_extraction(args.track, args.output, args.cache, args.api_key, args.towns)

if __name__ == "__main__":
    main()
