#!/usr/bin/env python3
"""
extract_gpx_waypoints.py - Extract embedded GPX waypoints (<wpt>), project them onto
a route track, and output structured Place objects and town checkpoints.

Usage:
  python3 extract_gpx_waypoints.py \
    --gpx <path_to_gpx> \
    --track <path_to_route_track_json> \
    --output-places <path_to_places_json> \
    --output-towns <path_to_towns_json>
"""

import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Tuple

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

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
    start = max(0, best_i - 20)
    end = min(n, best_i + 21)
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

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '_', text)
    return text.strip('_')

def classify_waypoint(name: str, cmt: str, desc: str, wpt_type: str) -> Tuple[str, str, str, str, bool]:
    """
    Returns: (display_name, category, type_name, enhanced_desc, is_in_town)
    """
    n_lower = name.lower()
    c_lower = cmt.lower()
    t_lower = wpt_type.lower()
    d_lower = desc.lower()

    # 1. Official Checkpoints
    if "cp1" in n_lower or "cp1" in c_lower:
        return "CP1: Mount Smolikas Refuge", "town", "checkpoint", desc or "Official Checkpoint 1 at Mount Smolikas mountain refuge.", False
    if "cp2" in n_lower or "cp2" in c_lower:
        return "CP2: Melissourgi Refuge", "town", "checkpoint", desc or "Official Checkpoint 2 at Melissourgi mountain refuge in the Tzoumerka range.", False
    if "cp3" in n_lower or "cp3" in c_lower:
        return "CP3: Karpenisi (Hotel Elvetia)", "town", "checkpoint", desc or "Official Checkpoint 3 at Hotel Elvetia in Karpenisi.", True

    # 2. Finish Line
    if "finish" in n_lower or "finish" in c_lower or ("nafpaktos" in n_lower and "finish" in n_lower):
        return "Nafpaktos: Finish Line", "town", "finish", desc or "Official Finish Line at the Venetian harbor in Nafpaktos on the Corinthian Gulf.", True

    # 3. Major Towns & Resupply Hubs
    if "kastoria" in n_lower or ("large town" in n_lower and "shops" in n_lower):
        return "Kastoria: Major Town Resupply", "town", "town", desc or "Lakeside city with supermarkets, bike shops, restaurants, pharmacies & hotels.", True
    if "metsovo" in n_lower:
        return "Metsovo: Full Resupply Hub", "town", "town", desc or "Famous mountain town with supermarkets, bakeries, pharmacies, hotels & restaurants.", True
    if "karpenissi" in n_lower and "big town" in n_lower:
        return "Karpenisi: Major Resupply Hub", "town", "town", desc or "Capital of Evrytania with supermarkets, bike repairs, pharmacies, restaurants & hotels.", True
    if "raptopoulo" in n_lower:
        return "Raptopoulo: Resupply Hub (Agrafa)", "grocery", "store", desc or "Vital resupply in the remote Agrafa mountains: shops, bakery & tavernas.", True
    if "konitsa" in n_lower or ("shops, restaurants and hotels" in n_lower and "proper" in n_lower):
        return "Konitsa Area Resupply", "grocery", "store", desc or "Shops, restaurants, and hotels for proper resupply.", True

    # 4. Water Points
    if "water" in n_lower or "water" in c_lower or "drinking" in n_lower:
        return name if name != "Drinking water" else "Mountain Drinking Water Spring", "water", "water", desc or "Potable mountain drinking water fountain / spring.", False

    # 5. Lodging / Hotels
    if "hotel" in n_lower or "lodging" in c_lower or "shelter" in t_lower:
        return name, "hotel", "hotel", desc or "Mountain hotel & lodging for riders.", False

    # 6. Camping / Bivy
    if "camping" in c_lower or "campsite" in t_lower or "bivy" in n_lower:
        return name, "campground", "campground", desc or "Sheltered backcountry bivy and campsite.", False

    # 7. Grocery / Resupply Store / Petrol Station
    if "convenience_store" in c_lower or "store" in t_lower or "shop" in n_lower:
        if "petrol" in n_lower or "station" in n_lower:
            return name, "gas_station", "gas_station", desc or "Petrol station with convenience store food & drink resupply.", False
        return name, "grocery", "store", desc or "Village store food resupply.", False

    # 8. Food / Restaurant / Cafe
    if "food" in c_lower or "coffee" in c_lower or "restaurant" in n_lower or "cafe" in n_lower:
        return name, "food", "restaurant" if "restaurant" in n_lower else "cafe", desc or "Local food, hot meals, and coffee.", False

    # 9. Scenic Passes, Bridges & Viewpoints
    if "bridge" in n_lower or "gefyra" in n_lower:
        return name, "pass", "bridge", desc or "Historic stone bridge crossing mountain river gorge.", False
    if "kaimaktsalan" in n_lower:
        return "Kaimaktsalan / Mount Voras Summit", "pass", "summit", desc or "Highest summit on route (2,507m / 8,226ft) on the North Macedonia border.", False
    if "kaliakoudas" in n_lower or "diaselo" in n_lower:
        return "Diaselo Kaliakoudas Pass (1,750m)", "pass", "pass", desc or "Iconic high gravel mountain pass crossing between Mount Kaliakouda and Chelidona.", False
    if "ski resort" in n_lower or "velouchi" in n_lower:
        return "Velouchi Ski Resort Overlook", "pass", "pass", desc or "High mountain ascent towards Mount Tymfristos / Karpenisi ski center.", False
    if "vikos" in n_lower:
        return "Vikos Gorge Overlook", "pass", "viewpoint", desc or "Breathtaking view down into the world-famous Vikos Gorge canyon.", False
    if "pass" in n_lower or "overlook" in t_lower or "viewpoint" in c_lower:
        return name, "pass", "pass", desc or "Scenic mountain pass overlook.", False

    # 10. Hazard / Caution Warnings
    if "caution" in c_lower or "danger" in t_lower or "hike" in n_lower or "trail" in n_lower or "road" in n_lower:
        return name, "caution", "danger", desc or f"Trail alert: {name}", False

    return name, "town", "point", desc or name, False

def parse_waypoints(gpx_path: Path, track_coords: List[Tuple[float, float]], track_kms: List[float]) -> List[Dict[str, Any]]:
    tree = ET.parse(gpx_path)
    root = tree.getroot()
    ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
    raw_wpts = root.findall(".//gpx:wpt", ns) or root.findall(".//wpt")

    places = []
    seen_ids = set()

    for i, w in enumerate(raw_wpts):
        name = (w.findtext("{http://www.topografix.com/GPX/1/1}name") or w.findtext("name") or f"Waypoint {i+1}").strip()
        cmt = (w.findtext("{http://www.topografix.com/GPX/1/1}cmt") or w.findtext("cmt") or "").strip()
        desc = (w.findtext("{http://www.topografix.com/GPX/1/1}desc") or w.findtext("desc") or "").strip()
        wpt_type = (w.findtext("{http://www.topografix.com/GPX/1/1}type") or w.findtext("type") or "").strip()
        lat = float(w.attrib["lat"])
        lon = float(w.attrib["lon"])

        dist_to_trail, r_km, r_mi = project_onto_track(lat, lon, track_coords, track_kms)
        display_name, category, type_name, final_desc, is_in_town = classify_waypoint(name, cmt, desc, wpt_type)

        base_slug = f"hmr_{slugify(display_name[:28])}"
        pid = base_slug
        suffix = 1
        while pid in seen_ids:
            pid = f"{base_slug}_{suffix}"
            suffix += 1
        seen_ids.add(pid)

        places.append({
            "id": pid,
            "name": display_name,
            "category": category,
            "type": type_name,
            "town": "Hellenic Route",
            "is_in_town": is_in_town,
            "location": {"lat": round(lat, 5), "lon": round(lon, 5)},
            "distance_to_trail_km": dist_to_trail,
            "route_km": r_km,
            "route_mile": r_mi,
            "address": "Greece",
            "google_maps_url": f"https://maps.google.com/?q={lat:.5f},{lon:.5f}",
            "business_status": "OPERATIONAL",
            "province_state": "GR",
            "country": "Greece",
            "description": final_desc
        })

    # Sort strictly by route mile
    places.sort(key=lambda p: p["route_mile"])
    return places

def extract_towns(places: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Select key town / checkpoint hubs
    town_candidates = []
    # Always include Start
    town_candidates.append({
        "id": "town_agios_athanasios",
        "name": "Agios Athanasios",
        "route_mile": 0.0,
        "route_km": 0.0,
        "elevation": 1211,
        "location": {"lat": 40.83975, "lon": 21.76728},
        "province_state": "Central Macedonia",
        "country": "Greece",
        "description": "Start of the Hellenic Mountain Race in mountain village near Mount Voras.",
        "search_radius": 3500
    })

    key_town_keywords = ["kastoria", "smolikas", "konitsa", "metsovo", "melissourgi", "raptopoulo", "karpenisi", "nafpaktos"]
    for p in places:
        n_lower = p["name"].lower()
        if (any(k in n_lower for k in key_town_keywords) or p["type"] in ("checkpoint", "finish")) and "hike" not in n_lower:
            name_clean = p["name"].split(":")[0].strip() if ":" in p["name"] else p["name"]
            town_candidates.append({
                "id": f"town_{slugify(p['name'])}",
                "name": name_clean,
                "route_mile": p["route_mile"],
                "route_km": p["route_km"],
                "elevation": round(p.get("elevation", 0)),
                "location": p["location"],
                "province_state": "Greece",
                "country": "Greece",
                "description": p["description"],
                "search_radius": 5000 if "karpenisi" in n_lower or "kastoria" in n_lower or "nafpaktos" in n_lower else 3000
            })

    # Deduplicate by route mile proximity (< 5 miles)
    deduped = []
    for t in sorted(town_candidates, key=lambda x: x["route_mile"]):
        if not deduped or abs(t["route_mile"] - deduped[-1]["route_mile"]) > 4.0:
            deduped.append(t)
    return deduped

def main():
    parser = argparse.ArgumentParser(description="Extract and project embedded GPX waypoints")
    parser.add_argument("--gpx", required=True, help="Path to input GPX")
    parser.add_argument("--track", required=True, help="Path to route-track.json")
    parser.add_argument("--output-places", required=True, help="Path to output gpx_waypoints.json")
    parser.add_argument("--output-towns", required=True, help="Path to output towns.json")
    args = parser.parse_args()

    with open(args.track, "r", encoding="utf-8") as f:
        tdata = json.load(f)
    pts = tdata["points"]
    track_coords = [(p[0], p[1]) for p in pts]
    track_kms = [p[3] for p in pts]

    places = parse_waypoints(Path(args.gpx), track_coords, track_kms)
    towns = extract_towns(places)

    out_p = Path(args.output_places)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    with open(out_p, "w", encoding="utf-8") as f:
        json.dump(places, f, indent=2, ensure_ascii=False)
    print(f"[GPX WAYPOINTS] Extracted and projected {len(places)} waypoints to {out_p}")

    out_t = Path(args.output_towns)
    out_t.parent.mkdir(parents=True, exist_ok=True)
    with open(out_t, "w", encoding="utf-8") as f:
        json.dump(towns, f, indent=2, ensure_ascii=False)
    print(f"[GPX WAYPOINTS] Generated {len(towns)} town hubs to {out_t}")

if __name__ == "__main__":
    main()
