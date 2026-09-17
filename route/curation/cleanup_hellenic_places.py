#!/usr/bin/env python3
"""
cleanup_hellenic_places.py - Standardize category keys and enrich water access points in places.json.
"""

import json
import math
from collections import Counter
from pathlib import Path

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def main():
    places_path = Path("public/data/routes/hellenic-mountain-race-2026/places.json")
    track_path = Path("public/data/routes/hellenic-mountain-race-2026/route-track.json")

    with open(places_path, "r", encoding="utf-8") as f:
        places = json.load(f)

    with open(track_path, "r", encoding="utf-8") as f:
        tdata = json.load(f)
    track_pts = tdata["points"]

    def project_pt(plat, plon):
        best_d = 9999.0
        best_i = 0
        for i, pt in enumerate(track_pts):
            d = haversine_km(plat, plon, pt[0], pt[1])
            if d < best_d:
                best_d = d
                best_i = i
        r_km = track_pts[best_i][3]
        r_mi = r_km * 0.621371
        return round(best_d, 2), round(r_km, 1), round(r_mi, 1)

    river_points = [
        {
            "id": "hmr_water_voidomatis",
            "name": "Voidomatis River Water Access (Zagori)",
            "category": "water",
            "type": "water",
            "town": "Zagori / Vikos",
            "is_in_town": False,
            "location": {"lat": 39.9678, "lon": 20.6721},
            "description": "Renowned as one of the cleanest rivers in Europe. Perennial cold drinking water access (filtration recommended)."
        },
        {
            "id": "hmr_water_aoos_river",
            "name": "Aoos River Crossing Water Access",
            "category": "water",
            "type": "water",
            "town": "Konitsa",
            "is_in_town": False,
            "location": {"lat": 40.0365, "lon": 20.7451},
            "description": "Aoos River gorge water access near historic stone bridge. Reliable perennial source."
        },
        {
            "id": "hmr_water_megdovas",
            "name": "Megdovas (Tavropos) River Access",
            "category": "water",
            "type": "water",
            "town": "Viniani",
            "is_in_town": False,
            "location": {"lat": 38.9796, "lon": 21.6986},
            "description": "Perennial mountain river access at the Stenoma-Viniani bridge."
        },
        {
            "id": "hmr_water_acheloos",
            "name": "Acheloos River Mountain Valley Access",
            "category": "water",
            "type": "water",
            "town": "Agrafa",
            "is_in_town": False,
            "location": {"lat": 39.2697, "lon": 21.3396},
            "description": "Alpine riverbed water access in the remote Pindus-Agrafa corridor."
        },
        {
            "id": "hmr_water_krikellopotamos",
            "name": "Krikellopotamos River Canyon Access",
            "category": "water",
            "type": "water",
            "town": "Evrytania",
            "is_in_town": False,
            "location": {"lat": 38.7938, "lon": 21.7668},
            "description": "Crystal mountain stream flowing from the Kaliakouda massif."
        }
    ]

    for rw in river_points:
        lat = rw["location"]["lat"]
        lon = rw["location"]["lon"]
        d, km, mi = project_pt(lat, lon)
        rw["distance_to_trail_km"] = d
        rw["route_km"] = km
        rw["route_mile"] = mi
        rw["address"] = "Greece"
        rw["google_maps_url"] = f"https://maps.google.com/?q={lat:.5f},{lon:.5f}"
        rw["business_status"] = "OPERATIONAL"
        rw["province_state"] = "Greece"
        rw["country"] = "Greece"
        places.append(rw)

    places_by_id = {}
    for p in places:
        cat = p.get("category")
        if cat == "restaurant":
            p["category"] = "food"
        elif cat == "bike":
            p["category"] = "bike_shop"
        elif cat == "services":
            p["category"] = "gas_station"

        # Deduplicate generic checkpoint stub if full one exists
        if p.get("name") == "CP1" and any("Smolikas" in x.get("name", "") for x in places if x.get("id") != p.get("id")):
            continue
        if p.get("name") == "CP2" and any("Melissourgi" in x.get("name", "") for x in places if x.get("id") != p.get("id")):
            continue
        if p.get("name") == "CP3" and any("Elvetia" in x.get("name", "") for x in places if x.get("id") != p.get("id")):
            continue

        places_by_id[p["id"]] = p

    cleaned = list(places_by_id.values())
    cleaned.sort(key=lambda x: x["route_mile"])

    with open(places_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, indent=2, ensure_ascii=False)

    print(f"[PLACES CLEANUP] Saved {len(cleaned)} places to {places_path}")
    counts = Counter(p["category"] for p in cleaned)
    for c, cnt in counts.most_common():
        print(f"  {c:15s}: {cnt}")

if __name__ == "__main__":
    main()
