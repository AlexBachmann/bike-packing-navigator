#!/usr/bin/env python3
"""
extract_atlas_waypoints.py - Extract embedded GPX waypoints and combine with OSM water access
and town resupply waypoints into public/data/routes/atlas-mountain-race-2026/places.json and milestones.json.
"""

import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Tuple, Dict, Any

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam / 2.0)**2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def project_onto_track(plat: float, plon: float, track: List[List[float]]) -> Tuple[float, float, float]:
    best_dist = 999999.0
    best_km = 0.0
    best_mi = 0.0
    for p in track:
        d = haversine_km(plat, plon, p[0], p[1])
        if d < best_dist:
            best_dist = d
            best_km = p[3]
            best_mi = p[4]
    return round(best_dist, 3), round(best_km, 1), round(best_mi, 1)

def build_places_and_milestones():
    track_path = Path("public/data/routes/atlas-mountain-race-2026/route-track.json")
    gpx_path = Path("route/gpx/atlas-mountain-race-2026.gpx")
    water_path = Path("public/data/routes/atlas-mountain-race-2026/water_access.json")
    output_places = Path("public/data/routes/atlas-mountain-race-2026/places.json")
    output_milestones = Path("public/data/routes/atlas-mountain-race-2026/milestones.json")

    with open(track_path, "r", encoding="utf-8") as f:
        track = json.load(f)["points"]

    places: List[Dict[str, Any]] = []
    seen_ids = set()

    # 1. Embedded GPX waypoints
    tree = ET.parse(gpx_path)
    root = tree.getroot()
    ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
    wpts = root.findall(".//gpx:wpt", ns) or root.findall(".//wpt")

    gpx_metadata = {
        "Small village shop": {
            "id": "amr_village_shop_tagleft",
            "category": "grocery",
            "type": "store",
            "town": "Tagleft",
            "desc": "Village shop with basic snacks, canned goods, biscuits, and bottled water resupply."
        },
        "More guesthouses in town": {
            "id": "amr_tabant_guesthouses",
            "category": "hotel",
            "type": "hotel",
            "town": "Tabant",
            "desc": "Mountain guesthouses and Berber auberges in the Ait Bouguemez valley."
        },
        "Shops and restaurants. Centre of Tabant": {
            "id": "amr_tabant_centre",
            "category": "town",
            "type": "town",
            "town": "Tabant",
            "desc": "Main village and administrative centre of the Ait Bouguemez (Happy) Valley with shops, bakeries, cafes, and tagine restaurants."
        },
        "End of M'goun Gorge trail": {
            "id": "amr_mgoun_gorge_trail_end",
            "category": "caution",
            "type": "checkpoint",
            "town": "",
            "desc": "From here on out you're back on a gravel road and out of the river. End of the remote M'Goun river canyon."
        },
        "Road under construction. Precise route may change before the start.": {
            "id": "amr_road_construction_alert",
            "category": "caution",
            "type": "danger",
            "town": "",
            "desc": "Trail alert: Road under construction. Precise route may change before the start. Watch for loose rock and heavy machinery."
        },
        "Kalaat M'Gouna": {
            "id": "amr_kalaat_mgouna_resupply",
            "category": "town",
            "type": "town",
            "town": "Kalaat M'Gouna",
            "desc": "Major resupply town in the Valley of the Roses with supermarkets, pharmacies, ATMs, restaurants, and hotels. Last real resupply before 100KM of rocky desert crossing to Afra!"
        }
    }

    for w in wpts:
        name = (w.findtext("{http://www.topografix.com/GPX/1/1}name") or w.findtext("name") or "").strip()
        lat = float(w.attrib["lat"])
        lon = float(w.attrib["lon"])
        dist_trail, r_km, r_mi = project_onto_track(lat, lon, track)

        meta = gpx_metadata.get(name, {
            "id": f"amr_{name.lower().replace(' ', '_')[:20]}",
            "category": "town",
            "type": "point",
            "town": "",
            "desc": name
        })

        pid = meta["id"]
        seen_ids.add(pid)
        places.append({
            "id": pid,
            "name": name,
            "category": meta["category"],
            "type": meta["type"],
            "town": meta["town"],
            "is_in_town": True if meta["town"] else False,
            "location": {"lat": round(lat, 5), "lon": round(lon, 5)},
            "distance_to_trail_km": dist_trail,
            "route_km": r_km,
            "route_mile": r_mi,
            "address": f"{meta['town']}, Morocco" if meta['town'] else "Morocco",
            "google_maps_url": f"https://maps.google.com/?q={lat:.5f},{lon:.5f}",
            "business_status": "OPERATIONAL",
            "province_state": "Morocco",
            "country": "Morocco",
            "description": meta["desc"]
        })

    # 2. OSM Corridor Water Access points (throttled to at most 1 per 5 km segment)
    if water_path.exists():
        with open(water_path, "r", encoding="utf-8") as f:
            water_pts = json.load(f)

        # 2a. Deduplicate candidates at identical/near locations (< 200m)
        unique_water = []
        for wp in water_pts:
            is_dup = False
            for u in unique_water:
                if abs(wp["route_km"] - u["route_km"]) < 0.2 and abs(wp["distance_to_trail_km"] - u["distance_to_trail_km"]) < 0.01:
                    is_dup = True
                    break
            if not is_dup:
                unique_water.append(wp)

        # 2b. Priority: Drinking Water (0) > Spring (1) > River/Creek access (2)
        def wp_priority(p):
            pname = p.get("name", "")
            if "Drinking Water" in pname:
                return (0, p.get("distance_to_trail_km", 999.0))
            elif "Spring" in pname:
                return (1, p.get("distance_to_trail_km", 999.0))
            return (2, p.get("distance_to_trail_km", 999.0))

        # 2c. Bucket by 5km segment
        water_buckets = {}
        for wp in unique_water:
            seg_idx = int(math.floor(wp["route_km"] / 5.0))
            if seg_idx not in water_buckets:
                water_buckets[seg_idx] = []
            water_buckets[seg_idx].append(wp)

        throttled_water = []
        for s_idx in sorted(water_buckets.keys()):
            best_wp = min(water_buckets[s_idx], key=wp_priority)
            throttled_water.append(best_wp)

        # 2d. Spacing enforcement (at least 3.75 km between consecutive points)
        throttled_water.sort(key=lambda x: x["route_km"])
        spaced_water = []
        last_km = -999.0
        for wp in throttled_water:
            if (wp["route_km"] - last_km) >= (5.0 * 0.75):
                spaced_water.append(wp)
                last_km = wp["route_km"]
            else:
                if wp_priority(wp) < wp_priority(spaced_water[-1]):
                    spaced_water[-1] = wp
                    last_km = wp["route_km"]

        # Write clean throttled water points back to water_access.json
        with open(water_path, "w", encoding="utf-8") as f:
            json.dump(spaced_water, f, indent=2, ensure_ascii=False)

        for wp in spaced_water:
            wid = wp["id"]
            if wid not in seen_ids:
                seen_ids.add(wid)
                wlat = wp["location"]["lat"]
                wlon = wp["location"]["lon"]
                dist_trail, r_km, r_mi = project_onto_track(wlat, wlon, track)
                wp["distance_to_trail_km"] = dist_trail
                wp["route_km"] = r_km
                wp["route_mile"] = r_mi
                wp["province_state"] = "Morocco"
                wp["country"] = "Morocco"
                places.append(wp)

    # 3. Authentic Regional Town Resupply Checkpoints
    town_resupply = [
        {
            "id": "amr_town_beni_mellal",
            "name": "Beni Mellal (Grand Départ)",
            "category": "town",
            "type": "town",
            "town": "Beni Mellal",
            "lat": 32.32497,
            "lon": -6.33664,
            "desc": "Official Start of the Atlas Mountain Race 2026. Major city with hotels, bike mechanics, pharmacies, and supermarkets."
        },
        {
            "id": "amr_town_tilouguite",
            "name": "Tilouguite Town Resupply",
            "category": "town",
            "type": "town",
            "town": "Tilouguite",
            "lat": 32.0292,
            "lon": -6.2058,
            "desc": "Berber mountain outpost before the Ahansal river canyon. Village stores and cafes."
        },
        {
            "id": "amr_town_zawyat_ahansal",
            "name": "Zawyat Ahansal Resupply Hub",
            "category": "town",
            "type": "town",
            "town": "Zawyat Ahansal",
            "lat": 31.8909,
            "lon": -6.1789,
            "desc": "Historic climbing and trekking hub near Taghia gorge. Guesthouses, food, and drinking water."
        },
        {
            "id": "amr_town_boutaghrar",
            "name": "Boutaghrar Valley Guesthouse",
            "category": "hotel",
            "type": "hotel",
            "town": "Boutaghrar",
            "lat": 31.3320,
            "lon": -6.1280,
            "desc": "Traditional adobe Kasbah guesthouse in the Valley of the Roses."
        },
        {
            "id": "amr_town_ikniouen",
            "name": "Ikniouen Mountain Village Resupply",
            "category": "town",
            "type": "town",
            "town": "Ikniouen",
            "lat": 30.9450,
            "lon": -6.2602,
            "desc": "Vital Saghro mountain village resupply. Small grocery shops and water before Tizi n'Tazazert."
        },
        {
            "id": "amr_town_afra",
            "name": "Afra Desert Oasis Resupply",
            "category": "town",
            "type": "town",
            "town": "Afra",
            "lat": 30.7066,
            "lon": -6.2052,
            "desc": "Crucial desert resupply oasis following the 100km waterless crossing from Kalaat M'Gouna."
        },
        {
            "id": "amr_town_agdz",
            "name": "Agdz Resupply Hub",
            "category": "town",
            "type": "town",
            "town": "Agdz",
            "lat": 30.6970,
            "lon": -6.4470,
            "desc": "Gateway town of the Draa Valley with pharmacies, grocery stores, cafes, and hotels."
        },
        {
            "id": "amr_town_tansifte",
            "name": "Tansifte Village Store",
            "category": "grocery",
            "type": "store",
            "town": "Tansifte",
            "lat": 30.6412,
            "lon": -6.9371,
            "desc": "Village grocery store and fresh bread along the Draa river escarpment."
        },
        {
            "id": "amr_town_taznakht",
            "name": "Taznakht Carpet Capital & Resupply",
            "category": "town",
            "type": "town",
            "town": "Taznakht",
            "lat": 30.5750,
            "lon": -7.2050,
            "desc": "Full resupply crossroads town with supermarkets, restaurants, ATMs, and hotels."
        },
        {
            "id": "amr_town_siroua_saffron",
            "name": "Siroua Saffron Valley (Aznaguen)",
            "category": "town",
            "type": "town",
            "town": "Aznaguen",
            "lat": 30.3805,
            "lon": -7.5481,
            "desc": "Berber mountain village outpost in the Jbel Siroua saffron region. Small shops, cafes, and drinking water before descending to Aguinane."
        },
        {
            "id": "amr_town_aguinane",
            "name": "Aguinane Oasis Cafe & Grocery",
            "category": "food",
            "type": "cafe",
            "town": "Aguinane",
            "lat": 30.1069,
            "lon": -7.5520,
            "desc": "Spectacular hidden oasis canyon with spring water, fresh dates, and Berber hospitality."
        },
        {
            "id": "amr_town_igherm",
            "name": "Igherm Anti-Atlas Resupply Hub",
            "category": "town",
            "type": "town",
            "town": "Igherm",
            "lat": 30.0679,
            "lon": -7.9457,
            "desc": "High Anti-Atlas crossroads hub with grocery shops, cafes, pharmacy, and mechanical help."
        },
        {
            "id": "amr_town_tafraoute",
            "name": "Tafraoute Granite Citadel Hub",
            "category": "town",
            "type": "town",
            "town": "Tafraoute",
            "lat": 29.7200,
            "lon": -8.9750,
            "desc": "Famous pink granite basin town with hotels, bike repairs, supermarkets, bakeries, and outdoor camping."
        },
        {
            "id": "amr_town_tizourgane",
            "name": "Kasbah Tizourgane Historic Lodging",
            "category": "hotel",
            "type": "hotel",
            "town": "Ida Ougnidif",
            "lat": 29.7976,
            "lon": -9.2115,
            "desc": "13th-century fortified hilltop kasbah offering authentic lodging and traditional meals."
        },
        {
            "id": "amr_town_ait_baha",
            "name": "Ait Baha Town Resupply",
            "category": "town",
            "type": "town",
            "town": "Ait Baha",
            "lat": 30.0680,
            "lon": -9.1550,
            "desc": "Foothill market town with supermarkets, cafes, and bakeries before the descent towards the Sous plain."
        },
        {
            "id": "amr_town_amskroud",
            "name": "Amskroud Food & Fuel Stop",
            "category": "gas_station",
            "type": "gas_station",
            "town": "Amskroud",
            "lat": 30.5250,
            "lon": -9.3600,
            "desc": "Convenience store and petrol station resupply at the base of the Western High Atlas climb."
        },
        {
            "id": "amr_town_imouzzer",
            "name": "Imouzzer Ida Outanane Town Resupply",
            "category": "town",
            "type": "town",
            "town": "Imouzzer Ida Outanane",
            "lat": 30.6670,
            "lon": -9.4820,
            "desc": "Famous mountain honey town above waterfalls with cafes, restaurants, and food stores."
        },
        {
            "id": "amr_town_tafedna",
            "name": "Tafedna Coastal Campground & Resupply",
            "category": "campground",
            "type": "campground",
            "town": "Tafedna",
            "lat": 31.0500,
            "lon": -9.7900,
            "desc": "Sheltered coastal fishing cove with beach camping, seafood cafes, and fresh water."
        },
        {
            "id": "amr_town_sidi_kaouki",
            "name": "Sidi Kaouki Beach Cafe & Camp",
            "category": "campground",
            "type": "campground",
            "town": "Sidi Kaouki",
            "lat": 31.3500,
            "lon": -9.7950,
            "desc": "Wild Atlantic surf beach with oceanfront campgrounds, cafes, and tagines."
        },
        {
            "id": "amr_town_essaouira_finish",
            "name": "Essaouira (Official Finish Line)",
            "category": "town",
            "type": "finish",
            "town": "Essaouira",
            "lat": 31.5114,
            "lon": -9.7698,
            "desc": "The official finish line of the Atlas Mountain Race 2026 at the historic 18th-century sea ramparts of Essaouira on the Atlantic coast."
        }
    ]

    for t in town_resupply:
        tid = t["id"]
        if tid not in seen_ids:
            seen_ids.add(tid)
            dist_trail, r_km, r_mi = project_onto_track(t["lat"], t["lon"], track)
            places.append({
                "id": tid,
                "name": t["name"],
                "category": t["category"],
                "type": t["type"],
                "town": t["town"],
                "is_in_town": True,
                "location": {"lat": round(t["lat"], 5), "lon": round(t["lon"], 5)},
                "distance_to_trail_km": dist_trail,
                "route_km": r_km,
                "route_mile": r_mi,
                "address": f"{t['town']}, Morocco",
                "google_maps_url": f"https://maps.google.com/?q={t['lat']:.5f},{t['lon']:.5f}",
                "business_status": "OPERATIONAL",
                "province_state": "Morocco",
                "country": "Morocco",
                "description": t["desc"]
            })

    # Strict ascending sort by route_mile, then route_km
    places.sort(key=lambda p: (p["route_mile"], p["route_km"]))

    output_places.parent.mkdir(parents=True, exist_ok=True)
    with open(output_places, "w", encoding="utf-8") as f:
        json.dump(places, f, indent=2, ensure_ascii=False)
    print(f"[PLACES] Saved {len(places)} strictly ordered waypoints to {output_places}")

    # 4. Generate Milestones
    milestone_targets = [
        ("Beni Mellal, Morocco", 0.0),
        ("Tagleft, Morocco", 22.1),
        ("Tilouguite / Cathedral Rock", 62.1),
        ("Zawyat Ahansal", 82.2),
        ("Tabant / Happy Valley", 116.6),
        ("Tizi N'Ait Imi Summit (2,913m)", 128.0),
        ("Gorges du M'Goun Trail End", 154.9),
        ("Kalaat M'Gouna", 185.9),
        ("Ikniouen (Jbel Saghro)", 217.5),
        ("Tizi n'Tazazert Summit (2,031m)", 223.1),
        ("Afra Oasis", 248.5),
        ("Tansifte (Draa Valley)", 310.7),
        ("Taznakht Carpet Capital", 335.2),
        ("Siroua Saffron Valley (Aznaguen)", 364.1),
        ("Aguinane Oasis", 398.4),
        ("Igherm Anti-Atlas Hub", 435.0),
        ("Azaghar N'Irs Plateau", 447.4),
        ("Tichgach", 497.1),
        ("Tizi n'Tarakatine Summit (1,812m)", 523.8),
        ("Gorges d'Aït Mansour", 548.7),
        ("Aguerd Oudad (Painted Rocks)", 563.9),
        ("Tafraoute Granite Citadel", 575.3),
        ("Kasbah Tizourgane", 610.0),
        ("Ait Baha Valley", 636.9),
        ("Amskroud Souss Basin", 696.8),
        ("Imouzzer Ida Outanane", 734.1),
        ("Tafferguent Highland Ridge", 745.6),
        ("Tafedna Coastal Cove", 797.9),
        ("Sidi Kaouki Dunes", 826.4),
        ("Essaouira Finish Line", 840.0)
    ]

    milestones = []
    for mname, target_mi in milestone_targets:
        pt = min(track, key=lambda p: abs(p[4] - target_mi))
        milestones.append({
            "name": mname,
            "mile": round(pt[4], 1),
            "km": round(pt[3], 1),
            "elevation": round(pt[2]),
            "state": "Morocco"
        })

    # Strictly sort milestones by mile
    milestones.sort(key=lambda m: m["mile"])

    with open(output_milestones, "w", encoding="utf-8") as f:
        json.dump(milestones, f, indent=2, ensure_ascii=False)
    print(f"[MILESTONES] Saved {len(milestones)} milestones to {output_milestones}")

if __name__ == "__main__":
    build_places_and_milestones()
