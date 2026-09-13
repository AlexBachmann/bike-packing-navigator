#!/usr/bin/env python3
"""
populate_places.py - Route-Agnostic POI Extractor using Google Places API (New).

Guarantees $0.00 Out-of-Pocket Cost:
- Operates strictly in the 'Nearby Search (Pro)' SKU tier (5,000 FREE requests/month).
- Field Mask strictly limited to Pro tier fields:
  places.id,places.displayName,places.primaryType,places.types,places.formattedAddress,
  places.location,places.regularOpeningHours,places.googleMapsUri,places.businessStatus
- Persistent local caching (.cache_places_api_<route>.json) ensures 0 API cost on re-runs.

Usage:
  # Target by route ID:
  python3 populate_places.py --route colorado-trail
  python3 populate_places.py --route tour-divide-2025

  # Target with explicit paths:
  python3 populate_places.py --track path/to/route-track.json --output path/to/places.json [--cache path/to/cache.json] [--towns path/to/towns.json]
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path
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
    'laundry': 'laundry',
    'gas_station': 'services',
    'post_office': 'services',
    'pharmacy': 'services'
}

class PlacesCache:
    def __init__(self, cache_files: List[Path]):
        self.cache_files = cache_files
        self.cache: Dict[str, Any] = {}
        for cf in cache_files:
            if cf.exists():
                try:
                    with open(cf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self.cache.update(data)
                    print(f"[CACHE] Loaded {len(data)} cached entries from {cf.name}")
                except Exception as e:
                    print(f"[CACHE LOAD WARN] {e}", file=sys.stderr)

    def get(self, key: str) -> Optional[List[Dict[str, Any]]]:
        return self.cache.get(key)

    def set(self, key: str, data: List[Dict[str, Any]]):
        self.cache[key] = data

    def save(self):
        primary_cache = self.cache_files[0]
        try:
            primary_cache.parent.mkdir(parents=True, exist_ok=True)
            with open(primary_cache, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, indent=2, ensure_ascii=False)
            print(f"[CACHE] Saved {len(self.cache)} cached queries to {primary_cache.name}")
        except Exception as e:
            print(f"[CACHE SAVE WARN] {e}", file=sys.stderr)

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
        time.sleep(0.08) # Rate limiting protection
        resp = requests.post(url, headers=headers, json=body, timeout=12)
        if resp.status_code == 200:
            data = resp.json().get("places", [])
            cache.set(key, data)
            return data
        else:
            print(f"[PLACES API {resp.status_code}] {resp.text[:140]}", file=sys.stderr)
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

    # Coarse pass every 10 points
    for i in range(0, n, 10):
        lat, lon = track_coords[i]
        dlat = (lat - plat) * 111.0
        dlon = (lon - plon) * 111.0 * math.cos(math.radians(plat))
        d = dlat * dlat + dlon * dlon
        if d < min_d:
            min_d = d
            best_i = i

    # Fine pass
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

def main():
    parser = argparse.ArgumentParser(description="Extract POIs for any target route using Places API (New)")
    parser.add_argument("--route", required=False, help="Route slug ID (e.g. colorado-trail, tour-divide-2025)")
    parser.add_argument("--track", required=False, help="Path to route-track.json")
    parser.add_argument("--output", required=False, help="Path to output places.json")
    parser.add_argument("--cache", required=False, help="Path to cache file")
    parser.add_argument("--towns", required=False, help="Path to towns JSON")
    parser.add_argument("--api-key", default=os.environ.get("GOOGLE_PLACES_API_KEY") or os.environ.get("GOOGLE_MAPS_API_KEY"), help="Google Places API Key")
    parser.add_argument("--backcountry-interval-km", type=float, default=12.0, help="Sampling interval in km for backcountry")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]  # repository root

    if args.route:
        route_dir = project_root / "public" / "data" / "routes" / args.route
        track_path = route_dir / "route-track.json"
        output_path = route_dir / "places.json"
        towns_path = route_dir / "towns.json"
        cache_path = project_root / "route" / "places" / f".cache_places_api_{args.route}.json"
        fallback_cache = project_root / "route" / "places" / ".cache_places_api.json"
    else:
        if not args.track or not args.output:
            print("Error: Either --route or both --track and --output must be provided.", file=sys.stderr)
            sys.exit(1)
        track_path = Path(args.track)
        output_path = Path(args.output)
        towns_path = Path(args.towns) if args.towns else None
        cache_path = Path(args.cache) if args.cache else project_root / "route" / "places" / ".cache_places_api.json"
        fallback_cache = project_root / "route" / "places" / ".cache_places_api.json"

    if not track_path.exists():
        print(f"Error: Track file not found: {track_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[PLACES] Loading route track: {track_path}")
    with open(track_path, "r", encoding="utf-8") as f:
        track_data = json.load(f)

    points = track_data.get("points", [])
    if not points:
        print(f"Error: No points found in {track_path}", file=sys.stderr)
        sys.exit(1)

    track_coords = [(p[0], p[1]) for p in points]
    track_kms = [p[3] for p in points]
    total_km = track_kms[-1]

    cache_files = [cache_path]
    if fallback_cache.exists() and fallback_cache != cache_path:
        cache_files.append(fallback_cache)
    cache = PlacesCache(cache_files)

    places_by_id: Dict[str, Dict[str, Any]] = {}

    # 1. Process towns if present
    towns: List[Dict[str, Any]] = []
    if towns_path and towns_path.exists():
        with open(towns_path, "r", encoding="utf-8") as f:
            towns = json.load(f)
        print(f"[PLACES] Processing {len(towns)} defined towns...")

        for t in towns:
            t_loc = t.get("location") or {}
            tlat = t.get("lat") or t_loc.get("lat")
            tlon = t.get("lon") or t_loc.get("lon")
            tname = t.get("name", "Town")
            if tlat is None or tlon is None:
                continue

            dist_to_trail, r_km, r_mi = project_onto_track(tlat, tlon, track_coords, track_kms)
            tid = t.get("id") or f"town_{tname.lower().replace(' ', '_')}"

            places_by_id[tid] = {
                "id": tid,
                "name": tname,
                "category": "town",
                "type": "town",
                "town": tname,
                "is_in_town": True,
                "location": {"lat": tlat, "lon": tlon},
                "distance_to_trail_km": dist_to_trail,
                "route_km": r_km,
                "route_mile": r_mi,
                "province_state": t.get("province_state") or t.get("state", ""),
                "country": t.get("country", ""),
                "description": t.get("description", f"Town resupply hub: {tname}.")
            }

            # Search 5 categories in town center (radius ~4.5 km)
            s_radius = t.get("search_radius", 4500)
            town_query_groups = [
                ["laundromat", "gas_station", "pharmacy", "post_office"],
                ["bicycle_store"],
                ["supermarket", "grocery_store", "convenience_store", "campground"],
                ["lodging", "hotel", "motel", "hostel"],
                ["restaurant", "cafe", "bakery", "fast_food"]
            ]
            for group in town_query_groups:
                raw_places = fetch_places_nearby(tlat, tlon, s_radius, group, args.api_key or "", cache)
                for p in raw_places:
                    pid = p.get("id")
                    if not pid or pid in places_by_id:
                        continue
                    ploc = p.get("location", {})
                    plat = ploc.get("latitude")
                    plon = ploc.get("longitude")
                    if plat is None or plon is None:
                        continue

                    pdist_trail, pr_km, pr_mi = project_onto_track(plat, plon, track_coords, track_kms)
                    ptypes = p.get("types", [])
                    primary = p.get("primaryType", "")
                    cat = "services"
                    for ct in [primary] + ptypes:
                        if ct in CATEGORY_MAP:
                            cat = CATEGORY_MAP[ct]
                            break

                    places_by_id[pid] = {
                        "id": pid,
                        "name": p.get("displayName", {}).get("text", "Place"),
                        "category": cat,
                        "type": cat,
                        "town": tname,
                        "is_in_town": True,
                        "location": {"lat": plat, "lon": plon},
                        "distance_to_trail_km": pdist_trail,
                        "route_km": pr_km,
                        "route_mile": pr_mi,
                        "address": p.get("formattedAddress", ""),
                        "google_maps_url": p.get("googleMapsUri", ""),
                        "business_status": p.get("businessStatus", "OPERATIONAL")
                    }

    # 2. Backcountry sampling along the route track
    step_km = args.backcountry_interval_km
    curr_target_km = step_km * 0.5
    checkpoints = []

    while curr_target_km < total_km:
        pt = min(points, key=lambda p: abs(p[3] - curr_target_km))
        checkpoints.append(pt)
        curr_target_km += step_km

    print(f"[PLACES] Sampling {len(checkpoints)} backcountry checkpoints along {total_km:.1f} km route...")
    backcountry_types = ["campground", "lodging", "grocery_store", "store", "restaurant", "gas_station"]

    for idx, cp in enumerate(checkpoints):
        lat, lon, ele, km, mi = cp
        raw_places = fetch_places_nearby(lat, lon, 7000.0, backcountry_types, args.api_key or "", cache)
        for p in raw_places:
            pid = p.get("id")
            if not pid or pid in places_by_id:
                continue

            ploc = p.get("location", {})
            plat = ploc.get("latitude")
            plon = ploc.get("longitude")
            if plat is None or plon is None:
                continue

            dist_to_trail, r_km, r_mi = project_onto_track(plat, plon, track_coords, track_kms)

            # Filter backcountry places to <= 1.2 km from trail
            if dist_to_trail <= 1.2:
                ptypes = p.get("types", [])
                primary = p.get("primaryType", "")
                cat = "services"
                for ct in [primary] + ptypes:
                    if ct in CATEGORY_MAP:
                        cat = CATEGORY_MAP[ct]
                        break

                places_by_id[pid] = {
                    "id": pid,
                    "name": p.get("displayName", {}).get("text", "Waypoint"),
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

    # Sort results by route mile
    result_places = list(places_by_id.values())
    result_places.sort(key=lambda p: p["route_mile"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result_places, f, indent=2)

    print(f"[PLACES] Extracted {len(result_places)} places saved to {output_path}!")

if __name__ == "__main__":
    main()
