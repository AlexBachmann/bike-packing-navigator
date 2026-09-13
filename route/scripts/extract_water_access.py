#!/usr/bin/env python3
"""
extract_water_access.py - Detect river and lake access points along a route using
OpenStreetMap corridor data (Overpass API or OSM PBF extract).

Features:
- Identifies where the route approaches or crosses rivers, streams, lakes, and reservoirs.
- Enforces a strict 5 km segment limit (maximum 1 water waypoint per 5 km segment when
  following along a river or lake) to prevent waypoint flooding.
- Outputs standardized water waypoints compatible with places.json and Bikepack Navigator.

Usage:
  python3 extract_water_access.py --track <path_to_route_track_json> --output <path_to_water_json>
                                  [--osm-pbf <path_to_corridor_pbf>]
                                  [--corridor <path_to_corridor_geojson>]
                                  [--segment-km 5.0]
                                  [--max-dist-m 250.0]
"""

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate Great Circle distance in kilometers between two coordinates."""
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '_', text)
    return text.strip('_')

def project_onto_track(
    plat: float,
    plon: float,
    track_coords: List[Tuple[float, float]],
    track_kms: List[float]
) -> Tuple[float, float, float]:
    """Find closest track point and return (distance_km, route_km, route_mile)."""
    best_dist = 1e9
    best_idx = 0
    for i, (tlat, tlon) in enumerate(track_coords):
        d = haversine_km(plat, plon, tlat, tlon)
        if d < best_dist:
            best_dist = d
            best_idx = i

    r_km = track_kms[best_idx]
    r_mi = r_km * 0.621371
    return round(best_dist, 3), round(r_km, 1), round(r_mi, 1)

def query_overpass_water(
    bbox: Tuple[float, float, float, float],
    cache_file: Optional[Path] = None
) -> List[Dict[str, Any]]:
    """Query OpenStreetMap Overpass API for named rivers, streams, and lakes within bbox."""
    if cache_file and cache_file.exists():
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            print(f"[WATER ACCESS] Loaded {len(cached)} cached OSM water elements from {cache_file}")
            return cached
        except Exception as e:
            print(f"[WATER ACCESS WARNING] Cache read error: {e}", file=sys.stderr)

    min_lat, min_lon, max_lat, max_lon = bbox
    pad = 0.03
    s, w, n, e = min_lat - pad, min_lon - pad, max_lat + pad, max_lon + pad

    overpass_query = f"""
    [out:json][timeout:45];
    (
      way["waterway"~"^(river|stream|canal)$"]["name"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
      way["natural"="water"]["name"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
      relation["natural"="water"]["name"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
      node["natural"="spring"]["name"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
      node["amenity"="drinking_water"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
    );
    out geom;
    """

    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ]

    import urllib.request
    import urllib.parse

    req_data = urllib.parse.urlencode({"data": overpass_query}).encode("utf-8")

    for ep in endpoints:
        try:
            print(f"[WATER ACCESS] Querying Overpass API ({ep}) for river & lake features...")
            req = urllib.request.Request(
                ep,
                data=req_data,
                headers={"User-Agent": "BikepackNavigator/1.0 (OSM Water Access Extractor)"}
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                if resp.status == 200:
                    raw_text = resp.read().decode("utf-8")
                    data = json.loads(raw_text)
                    elements = data.get("elements", [])
                    print(f"[WATER ACCESS] Successfully fetched {len(elements)} water elements from Overpass.")
                    if cache_file:
                        cache_file.parent.mkdir(parents=True, exist_ok=True)
                        with open(cache_file, "w", encoding="utf-8") as f:
                            json.dump(elements, f, indent=2)
                    return elements
                else:
                    print(f"[WATER ACCESS WARNING] Overpass endpoint {ep} returned HTTP {resp.status}", file=sys.stderr)
        except Exception as err:
            print(f"[WATER ACCESS WARNING] Failed to query {ep}: {err}", file=sys.stderr)

    return []

def extract_water_from_pbf(pbf_path: str) -> List[Dict[str, Any]]:
    """Extract waterways and water bodies from an OSM PBF file using osmium."""
    try:
        import osmium
    except ImportError:
        print("[WATER ACCESS] osmium library not available for PBF scanning.", file=sys.stderr)
        return []

    print(f"[WATER ACCESS] Scanning OSM PBF: {pbf_path} for waterways and lakes...")
    elements = []

    class WaterScanner(osmium.SimpleHandler):
        def node(self, n):
            t = n.tags
            if t.get("natural") == "spring" or t.get("amenity") == "drinking_water":
                elements.append({
                    "type": "node",
                    "id": n.id,
                    "lat": n.location.lat,
                    "lon": n.location.lon,
                    "tags": dict(t)
                })

        def way(self, w):
            t = w.tags
            if ("waterway" in t or t.get("natural") == "water") and "name" in t:
                try:
                    coords = [{"lat": n.lat, "lon": n.lon} for n in w.nodes]
                    elements.append({
                        "type": "way",
                        "id": w.id,
                        "geometry": coords,
                        "tags": dict(t)
                    })
                except Exception:
                    pass

    scanner = WaterScanner()
    scanner.apply_file(pbf_path, locations=True)
    print(f"[WATER ACCESS] Found {len(elements)} water elements in PBF.")
    return elements

def throttle_water_access_points(
    candidates: List[Dict[str, Any]],
    segment_km: float = 5.0
) -> List[Dict[str, Any]]:
    """
    Ensures a maximum of 1 water waypoint per 5 km segment when following along a river or lake.
    Picks the access point closest to the trail within each 5 km segment.
    """
    if not candidates:
        return []

    # Group candidates by feature name (e.g., "Gila River", "Parker Canyon Lake")
    by_feature: Dict[str, List[Dict[str, Any]]] = {}
    for c in candidates:
        fname = c.get("feature_name", "Water Source").strip()
        if fname not in by_feature:
            by_feature[fname] = []
        by_feature[fname].append(c)

    selected: List[Dict[str, Any]] = []

    for fname, pts in by_feature.items():
        # Bucket by segment_km
        buckets: Dict[int, List[Dict[str, Any]]] = {}
        for p in pts:
            bucket_idx = int(math.floor(p["route_km"] / segment_km))
            if bucket_idx not in buckets:
                buckets[bucket_idx] = []
            buckets[bucket_idx].append(p)

        # In each 5km segment, pick the single access point closest to the trail
        feature_selected = []
        for b_idx in sorted(buckets.keys()):
            bucket_pts = buckets[b_idx]
            best_point = min(bucket_pts, key=lambda x: x["distance_to_trail_km"])
            feature_selected.append(best_point)

        # Enforce minimum distance between consecutive points of the same water body
        feature_selected.sort(key=lambda x: x["route_km"])
        filtered_feature = []
        last_km = -999.0
        for p in feature_selected:
            if (p["route_km"] - last_km) >= (segment_km * 0.75):
                filtered_feature.append(p)
                last_km = p["route_km"]

        selected.extend(filtered_feature)

    # Sort all final water access points along the route
    selected.sort(key=lambda x: x["route_mile"])
    return selected

def extract_water_access(
    track_path: str,
    output_path: str,
    osm_pbf: Optional[str] = None,
    corridor_geojson: Optional[str] = None,
    segment_km: float = 5.0,
    max_dist_m: float = 250.0,
    cache_path: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Find river and lake access points along route, throttled to 1 per 5km segment."""
    with open(track_path, "r", encoding="utf-8") as f:
        track_data = json.load(f)

    points = track_data.get("points", [])
    if not points:
        raise ValueError("No points found in route-track.json")

    track_coords = [(p[0], p[1]) for p in points]
    track_kms = [p[3] for p in points]
    total_km = track_kms[-1]

    # Calculate bounding box
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    bbox = (min(lats), min(lons), max(lats), max(lons))

    # 1. Fetch or parse OSM water elements
    elements = []
    if osm_pbf and os.path.exists(osm_pbf):
        elements = extract_water_from_pbf(osm_pbf)
    
    if not elements:
        cache_file = Path(cache_path) if cache_path else Path(track_path).parent / ".cache_overpass_water.json"
        elements = query_overpass_water(bbox, cache_file)

    if not elements:
        print("[WATER ACCESS] No OSM water features retrieved (offline or empty query).", file=sys.stderr)
        return []

    print(f"[WATER ACCESS] Analyzing {len(elements)} OSM water features against route track...")

    max_dist_km = max_dist_m / 1000.0
    candidates = []

    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("description")
        if not name:
            continue

        waterway_type = tags.get("waterway")
        natural_type = tags.get("natural")
        water_type = tags.get("water") or natural_type or waterway_type or "water"

        # Determine readable classification
        if waterway_type in ["river", "stream", "canal"]:
            classification = "River Access" if waterway_type == "river" else "Creek Access"
        elif natural_type == "water" or water_type in ["lake", "reservoir", "pond"]:
            classification = "Lake Access" if water_type == "lake" else "Reservoir Access"
        elif natural_type == "spring":
            classification = "Spring"
        elif tags.get("amenity") == "drinking_water":
            classification = "Drinking Water"
        else:
            classification = "Water Access"

        # Extract coordinates
        geom_pts = []
        if el.get("type") == "node":
            if "lat" in el and "lon" in el:
                geom_pts.append((el["lat"], el["lon"]))
        elif "geometry" in el:
            for pt in el["geometry"]:
                if "lat" in pt and "lon" in pt:
                    geom_pts.append((pt["lat"], pt["lon"]))

        # Check proximity to route
        best_pt_for_feature = None
        best_dist = 1e9

        for glat, glon in geom_pts:
            dist_km, r_km, r_mi = project_onto_track(glat, glon, track_coords, track_kms)
            if dist_km <= max_dist_km and dist_km < best_dist:
                best_dist = dist_km
                best_pt_for_feature = {
                    "feature_name": name,
                    "classification": classification,
                    "water_type": water_type,
                    "lat": glat,
                    "lon": glon,
                    "distance_to_trail_km": dist_km,
                    "route_km": r_km,
                    "route_mile": r_mi
                }

        if best_pt_for_feature:
            candidates.append(best_pt_for_feature)

    print(f"[WATER ACCESS] Found {len(candidates)} raw access candidates within {max_dist_m:.0f}m of trail.")

    # Apply the 5 km segment throttling constraint
    throttled = throttle_water_access_points(candidates, segment_km=segment_km)
    print(f"[WATER ACCESS] Throttled down to {len(throttled)} access points (max 1 per {segment_km:.1f}km segment).")

    # Format into standard places.json schema
    final_places = []
    for idx, pt in enumerate(throttled):
        wid = f"water_osm_{slugify(pt['feature_name'])}_{int(pt['route_km'])}km"
        fname = pt["feature_name"]
        cls_name = pt["classification"]

        dist_desc = f"{pt['distance_to_trail_km'] * 1000.0:.0f}m from trail" if pt['distance_to_trail_km'] > 0.01 else "Directly on trail"
        desc = f"{cls_name} ({fname}). {dist_desc}. Natural water source (filtration/treatment required)."

        final_places.append({
            "id": wid,
            "name": f"{fname} ({cls_name})",
            "category": "water",
            "type": "water",
            "town": "",
            "is_in_town": False,
            "location": {
                "lat": round(pt["lat"], 5),
                "lon": round(pt["lon"], 5)
            },
            "distance_to_trail_km": pt["distance_to_trail_km"],
            "route_km": pt["route_km"],
            "route_mile": pt["route_mile"],
            "address": f"{fname}",
            "google_maps_url": f"https://maps.google.com/?q={pt['lat']:.5f},{pt['lon']:.5f}",
            "business_status": "OPERATIONAL",
            "description": desc
        })

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(final_places, f, indent=2)

    print(f"[WATER ACCESS] Saved {len(final_places)} standardized water waypoints to {output_path}")
    return final_places

def main():
    parser = argparse.ArgumentParser(description="Extract river and lake access points from OSM corridor with 5km segment limit")
    parser.add_argument("--track", required=True, help="Path to route-track.json")
    parser.add_argument("--output", required=True, help="Path to output water waypoints JSON")
    parser.add_argument("--osm-pbf", required=False, help="Optional OSM corridor PBF extract")
    parser.add_argument("--corridor", required=False, help="Optional corridor.geojson")
    parser.add_argument("--segment-km", type=float, default=5.0, help="Maximum 1 waypoint per N km segment (default: 5.0)")
    parser.add_argument("--max-dist-m", type=float, default=250.0, help="Maximum distance in meters to trail (default: 250.0)")
    parser.add_argument("--cache", required=False, help="Optional path to Overpass cache file")
    args = parser.parse_args()

    extract_water_access(
        track_path=args.track,
        output_path=args.output,
        osm_pbf=args.osm_pbf,
        corridor_geojson=args.corridor,
        segment_km=args.segment_km,
        max_dist_m=args.max_dist_m,
        cache_path=args.cache
    )

if __name__ == "__main__":
    main()
