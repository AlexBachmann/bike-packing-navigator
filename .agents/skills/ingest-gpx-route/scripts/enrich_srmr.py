#!/usr/bin/env python3
"""
enrich_srmr.py - Comprehensive route enricher for Silk Road Mountain Race 2026.
Projects GPX waypoints, merges OSM water access points, creates towns.json and milestones.json,
and provides rich guidebook metadata for Kyrgyz mountain passes and climbs.
"""

import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Any, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROUTE_DIR = PROJECT_ROOT / "public" / "data" / "routes" / "silk-road-mountain-race-2026"
GPX_PATH = PROJECT_ROOT / "route" / "gpx" / "silk-road-mountain-race-2026.gpx"

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def project_onto_track(plat: float, plon: float, track_coords: List[Tuple[float, float]], track_kms: List[float]) -> Tuple[float, float, float]:
    min_d = 1e9
    best_i = 0
    n = len(track_coords)
    for i in range(0, n, 10):
        lat, lon = track_coords[i]
        d = (lat - plat)**2 + ((lon - plon) * math.cos(math.radians(plat)))**2
        if d < min_d:
            min_d = d
            best_i = i

    start = max(0, best_i - 15)
    end = min(n, best_i + 16)
    best_dist = 1e9
    best_exact = best_i
    for i in range(start, end):
        tlat, tlon = track_coords[i]
        d = haversine_km(plat, plon, tlat, tlon)
        if d < best_dist:
            best_dist = d
            best_exact = i

    r_km = track_kms[best_exact]
    r_mi = r_km * 0.621371
    return round(best_dist, 2), round(r_km, 1), round(r_mi, 1)

def main():
    print("[ENRICH] Loading route track...")
    with open(ROUTE_DIR / "route-track.json", "r", encoding="utf-8") as f:
        track_data = json.load(f)
    points = track_data["points"]
    track_coords = [(p[0], p[1]) for p in points]
    track_kms = [p[3] for p in points]
    total_km = track_kms[-1]
    total_miles = round(total_km * 0.621371, 1)

    # 1. Parse official GPX waypoints
    print("[ENRICH] Parsing official GPX waypoints...")
    tree = ET.parse(GPX_PATH)
    root = tree.getroot()
    wpts = root.findall(".//{http://www.topografix.com/GPX/1/1}wpt") or root.findall(".//wpt")

    places: List[Dict[str, Any]] = []

    # Start point: Talas
    places.append({
        "id": "srmr_talas_start",
        "name": "Talas (Grand Depart)",
        "category": "town",
        "type": "town",
        "town": "Talas",
        "is_in_town": True,
        "location": {"lat": 42.52111, "lon": 72.25016},
        "distance_to_trail_km": 0.0,
        "route_km": 0.0,
        "route_mile": 0.0,
        "address": "Talas, Talas Region, Kyrgyzstan",
        "google_maps_url": "https://maps.google.com/?q=42.52111,72.25016",
        "business_status": "OPERATIONAL",
        "province_state": "KG",
        "country": "Kyrgyzstan",
        "description": "Grand Depart of the Silk Road Mountain Race 2026. Full resupply with markets, hotels, ATMs, and bike mechanics before heading into the mountains."
    })

    major_towns = {"Toktogul", "Baetov", "Naryn", "Kochkor", "Tamga"}

    for idx, w in enumerate(wpts):
        lat = float(w.attrib["lat"])
        lon = float(w.attrib["lon"])
        name = (w.findtext("{http://www.topografix.com/GPX/1/1}name") or w.findtext("name") or "").strip()
        desc = (w.findtext("{http://www.topografix.com/GPX/1/1}desc") or w.findtext("desc") or "").strip()
        wtype = (w.findtext("{http://www.topografix.com/GPX/1/1}type") or w.findtext("type") or "").strip()
        cmt = (w.findtext("{http://www.topografix.com/GPX/1/1}cmt") or w.findtext("cmt") or "").strip()

        dist_trail, r_km, r_mi = project_onto_track(lat, lon, track_coords, track_kms)

        # Categorize
        if name in major_towns:
            cat = "town"
            ptype = "town"
            is_in_town = True
        elif cmt == "convenience_store" or wtype == "store":
            cat = "grocery"
            ptype = "store"
            is_in_town = True
        elif cmt == "lodging" or wtype == "shelter":
            cat = "hotel"
            ptype = "guesthouse" if "guesthouse" in desc.lower() else "shelter"
            is_in_town = False
        elif wtype == "overlook" or cmt == "viewpoint":
            cat = "pass"
            ptype = "viewpoint"
            is_in_town = False
        elif wtype == "checkpoint" or cmt == "control":
            cat = "services"
            ptype = "checkpoint"
            is_in_town = False
        elif wtype == "danger" or cmt == "caution":
            cat = "services"
            ptype = "danger" if "checkpoint" not in name.lower() else "checkpoint"
            is_in_town = False
        else:
            cat = "services"
            ptype = wtype or "waypoint"
            is_in_town = False

        slug = name.lower().replace(" ", "_").replace(":", "").replace("-", "_").replace("'", "")
        slug = "".join([c for c in slug if c.isalnum() or c == "_"])
        wid = f"srmr_{slug}_{int(r_km)}km"

        places.append({
            "id": wid,
            "name": name,
            "category": cat,
            "type": ptype,
            "town": name if cat == "town" else "",
            "is_in_town": is_in_town,
            "location": {"lat": lat, "lon": lon},
            "distance_to_trail_km": dist_trail,
            "route_km": r_km,
            "route_mile": r_mi,
            "address": f"{name}, Kyrgyzstan",
            "google_maps_url": f"https://maps.google.com/?q={lat},{lon}",
            "business_status": "OPERATIONAL",
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": desc or f"Silk Road Mountain Race official waypoint: {name}."
        })

    # Finish point: Cholpon-Ata
    places.append({
        "id": "srmr_cholpon_ata_finish",
        "name": "Cholpon-Ata (Finish Line)",
        "category": "town",
        "type": "town",
        "town": "Cholpon-Ata",
        "is_in_town": True,
        "location": {"lat": 42.6379, "lon": 77.09134},
        "distance_to_trail_km": 0.0,
        "route_km": total_km,
        "route_mile": total_miles,
        "address": "Cholpon-Ata, Issyk-Kul Region, Kyrgyzstan",
        "google_maps_url": "https://maps.google.com/?q=42.6379,77.09134",
        "business_status": "OPERATIONAL",
        "province_state": "KG",
        "country": "Kyrgyzstan",
        "description": "Official Finish Line of the Silk Road Mountain Race on the shores of Lake Issyk-Kul. Celebration resort, beaches, hotels, and banquets."
    })

    # 2. Merge Water Access Points
    water_access_path = ROUTE_DIR / "water_access.json"
    if water_access_path.exists():
        with open(water_access_path, "r", encoding="utf-8") as f:
            water_pts = json.load(f)
        print(f"[ENRICH] Merging {len(water_pts)} OSM water access waypoints...")
        for wp in water_pts:
            places.append(wp)

    # Sort all places strictly by route_mile
    places.sort(key=lambda p: (p["route_mile"], p["distance_to_trail_km"]))
    print(f"[ENRICH] Saving {len(places)} total waypoints to places.json...")
    with open(ROUTE_DIR / "places.json", "w", encoding="utf-8") as f:
        json.dump(places, f, indent=2, ensure_ascii=False)

    # 3. Create towns.json
    towns = [
        {
            "id": "town_talas",
            "name": "Talas",
            "route_mile": 0.0,
            "route_km": 0.0,
            "elevation": 1242,
            "location": {"lat": 42.52111, "lon": 72.25016},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Grand Depart of the Silk Road Mountain Race 2026. Full resupply hub with shops, hotels, and ATMs."
        },
        {
            "id": "town_toktogul",
            "name": "Toktogul",
            "route_mile": 88.1,
            "route_km": 141.8,
            "elevation": 950,
            "location": {"lat": 41.8848, "lon": 72.9287},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Major resupply center on the Toktogul Reservoir. Supermarkets, restaurants, guesthouses, and pharmacies."
        },
        {
            "id": "town_torkent",
            "name": "Torkent",
            "route_mile": 106.6,
            "route_km": 171.6,
            "elevation": 1050,
            "location": {"lat": 41.8434, "lon": 73.1470},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Town along the main road with several resupply grocery shops."
        },
        {
            "id": "town_kyzl_oi",
            "name": "Kyzl-Oi",
            "route_mile": 203.9,
            "route_km": 328.2,
            "elevation": 1500,
            "location": {"lat": 41.9500, "lon": 74.1624},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Idyllic red-rock mountain canyon village with welcoming CBT community guesthouses and a local shop."
        },
        {
            "id": "town_song_kul",
            "name": "Song-Köl (CP1)",
            "route_mile": 349.6,
            "route_km": 562.6,
            "elevation": 3016,
            "location": {"lat": 41.7582, "lon": 75.1226},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Race Checkpoint 1 on the high alpine plateau of Lake Song-Köl. Traditional Kyrgyz yurt camps and warm hospitality."
        },
        {
            "id": "town_baetov",
            "name": "Baetov",
            "route_mile": 406.0,
            "route_km": 653.4,
            "elevation": 1580,
            "location": {"lat": 41.2677, "lon": 74.9485},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Vital resupply hub before the remote southern loops. Multiple shops, small hotel, and guesthouses."
        },
        {
            "id": "town_naryn",
            "name": "Naryn",
            "route_mile": 728.2,
            "route_km": 1171.9,
            "elevation": 2020,
            "location": {"lat": 41.4234, "lon": 76.0165},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Largest city along the route along the Naryn River. Supermarkets, bike repairs, hotels, restaurants, and medical services."
        },
        {
            "id": "town_tamga",
            "name": "Tamga",
            "route_mile": 883.4,
            "route_km": 1421.7,
            "elevation": 1685,
            "location": {"lat": 42.1512, "lon": 77.5478},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Lakeside settlement on the southern shore of Lake Issyk-Kul with shops and guesthouses."
        },
        {
            "id": "town_kochkor",
            "name": "Kochkor",
            "route_mile": 1035.9,
            "route_km": 1667.1,
            "elevation": 1800,
            "location": {"lat": 42.2148, "lon": 75.7536},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Major resupply center before the massive Kegeti Pass. Extensive markets, bakeries, cafes, and guesthouses."
        },
        {
            "id": "town_kegeti",
            "name": "Kegeti",
            "route_mile": 1113.1,
            "route_km": 1791.4,
            "elevation": 1250,
            "location": {"lat": 42.6913, "lon": 75.1779},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Village resupply after descending the breathtaking Kegeti Pass."
        },
        {
            "id": "town_cholpon_ata",
            "name": "Cholpon-Ata",
            "route_mile": total_miles,
            "route_km": total_km,
            "elevation": 1611,
            "location": {"lat": 42.6379, "lon": 77.09134},
            "province_state": "KG",
            "country": "Kyrgyzstan",
            "description": "Finish line resort city on Lake Issyk-Kul. Full tourist amenities and celebration venue."
        }
    ]

    with open(ROUTE_DIR / "towns.json", "w", encoding="utf-8") as f:
        json.dump(towns, f, indent=2, ensure_ascii=False)
    print(f"[ENRICH] Wrote {len(towns)} towns to towns.json.")

    # 4. Generate Milestones
    milestones = []
    milestones.append({
        "name": "Talas, KG (Grand Depart)",
        "mile": 0.0,
        "km": 0.0,
        "elevation": 1242,
        "state": "KG"
    })
    key_checkpoints = [
        ("Terekti Pass Summit", 31.4, 50.5, 3370),
        ("Toktogul Resupply", 88.1, 141.8, 950),
        ("Torkent", 106.6, 171.6, 1050),
        ("Toluk Mountain Village", 155.6, 250.5, 2200),
        ("Kyzl-Oi Canyon Guesthouses", 203.9, 328.2, 1500),
        ("Kojomkul", 219.2, 352.8, 1420),
        ("Kyzyl-Bel Pass", 272.8, 439.1, 3453),
        ("Song-Köl Lake (CP1)", 349.6, 562.6, 3016),
        ("Baetov Resupply", 406.0, 653.4, 1580),
        ("Kosh-Dobo Village", 456.4, 734.5, 1950),
        ("MELS Pass Crest", 495.6, 797.6, 3270),
        ("Military Checkpoint (Border Zone Entry)", 547.1, 880.4, 3420),
        ("The Blue Caravan Resupply", 580.7, 934.5, 3510),
        ("The Old Soviet Road High Crest", 650.1, 1046.3, 3668),
        ("Military Checkpoint (Border Zone Exit)", 678.6, 1092.0, 3100),
        ("Naryn City Resupply", 728.2, 1171.9, 2020),
        ("Eki-Naryn Gorge Guesthouse", 755.7, 1216.2, 2250),
        ("Arabel High Alpine Pass", 846.1, 1361.7, 3840),
        ("Barskoon Pass Summit", 855.7, 1377.1, 3819),
        ("Tamga (Issyk-Kul South Shore)", 883.4, 1421.7, 1685),
        ("Tosor Pass Summit", 914.5, 1471.8, 3897),
        ("Ukok Pass (Course Summit)", 1013.4, 1630.9, 3926),
        ("Kok-Ulok Yurt Camp", 1021.6, 1644.1, 3100),
        ("Kochkor Resupply", 1035.9, 1667.1, 1800),
        ("Kegeti Pass Summit", 1086.5, 1748.6, 3783),
        ("Kegeti Valley", 1113.1, 1791.4, 1250),
        ("The Secret Oasis", 1173.7, 1888.9, 1450),
        ("Kalmak-Ashuu", 1189.0, 1913.5, 1520),
        ("Kaindy CBT Guesthouses", 1193.2, 1920.2, 1600),
        ("Kok-Ayrik Pass Summit", 1242.5, 1999.6, 3844),
        ("Chong Sary-Oy", 1263.8, 2034.0, 1620),
        ("Cholpon-Ata (Finish Line)", total_miles, total_km, 1611)
    ]

    for name, mi, km, ele in key_checkpoints:
        milestones.append({
            "name": name,
            "mile": round(mi, 1),
            "km": round(km, 1),
            "elevation": round(ele),
            "state": "KG"
        })

    milestones.sort(key=lambda m: m["mile"])
    with open(ROUTE_DIR / "milestones.json", "w", encoding="utf-8") as f:
        json.dump(milestones, f, indent=2, ensure_ascii=False)
    print(f"[ENRICH] Wrote {len(milestones)} milestones to milestones.json.")

    # 5. Enrich Passes and Climbs
    print("[ENRICH] Enriching mountain passes and climbs...")
    with open(ROUTE_DIR / "passes.json", "r", encoding="utf-8") as f:
        passes = json.load(f)
    with open(ROUTE_DIR / "climbs.json", "r", encoding="utf-8") as f:
        climbs = json.load(f)

    NAMED_PASS_MAP = {
        "pass-1": {
            "name": "Terekti Pass Summit (11,057 ft)",
            "climbName": "Terekti Pass Ascent",
            "trailName": "Talas Valley Track",
            "parkName": "Talas Range / Tian Shan",
            "landmark": "Terekti Summit & Talas Crest",
            "notes": "First major alpine test of the Silk Road Mountain Race, ascending over 2,100 meters directly out of Talas onto exposed high-altitude ridgelines."
        },
        "pass-4": {
            "name": "Torkent Valley Ridge (5,295 ft)",
            "climbName": "Torkent Valley Ridge",
            "trailName": "Toktogul Mountain Road",
            "parkName": "Jalil Valley Range",
            "landmark": "Toktogul Reservoir Overlook",
            "notes": "Gradual unpaved climb leaving the Toktogul Basin, winding into rugged dry mountain canyons."
        },
        "pass-8": {
            "name": "Toluk Gorge Crest (7,717 ft)",
            "climbName": "Toluk Gorge Ascent",
            "trailName": "Toluk Mountain Track",
            "parkName": "Suusamyr Range Foothills",
            "landmark": "Toluk River Canyon",
            "notes": "Steep 10-mile climb through dramatic gorge country leading toward the isolated village of Toluk."
        },
        "pass-10": {
            "name": "Suusamyr Gateway Crest (10,572 ft)",
            "climbName": "Suusamyr Gateway Ascent",
            "trailName": "Suusamyr High Road",
            "parkName": "Suusamyr Valley",
            "landmark": "Suusamyr High Plateau",
            "notes": "Brutal 1,184m ascent climbing at over 7.3% average grade onto the expansive alpine grasslands of Suusamyr."
        },
        "pass-12": {
            "name": "Jalpak-Bel Pass Summit (11,329 ft)",
            "climbName": "Jalpak-Bel Pass Ascent",
            "trailName": "Jalpak-Bel Alpine Track",
            "parkName": "Jumgal Range",
            "landmark": "Kyzyl-Bel / Jalpak-Bel Crest",
            "notes": "Sustained 16-mile mountain grind topping out above 3,450 meters before descending into the Jumgal Valley."
        },
        "pass-15": {
            "name": "Song-Köl Ridge Crest (10,576 ft)",
            "climbName": "Song-Köl Wall (33 Parrots)",
            "trailName": "Song-Köl Lake Access Trail",
            "parkName": "Song-Köl State Nature Reserve",
            "landmark": "Lake Song-Köl & Yurt Encampments",
            "notes": "Fierce 11.6% wall ascending to the high alpine rim of Lake Song-Köl, opening up 360-degree views of nomadic horse pastures and the sacred lake."
        },
        "pass-23": {
            "name": "MELS Pass Summit (10,728 ft)",
            "climbName": "MELS Pass Ascent",
            "trailName": "Baetov-Torugart Historic Route",
            "parkName": "At-Bashi Mountain Range",
            "landmark": "MELS Pass Crest",
            "notes": "Named for Marx, Engels, Lenin, and Stalin, this historic Soviet route climbs on loose gravel switchbacks to 3,270m."
        },
        "pass-25": {
            "name": "Ak-Beyit Border Pass (11,720 ft)",
            "climbName": "Ak-Beyit Border Crest",
            "trailName": "Torugart Highway Corridor",
            "parkName": "Torugart Border Range",
            "landmark": "Chatyr-Kul Basin",
            "notes": "High border zone pass exceeding 3,570 meters with barren, moon-like tundra landscapes near the Chinese frontier."
        },
        "pass-28": {
            "name": "The Old Soviet Road High Crest (12,034 ft)",
            "climbName": "The Old Soviet Road Wall",
            "trailName": "Abandoned Soviet Military Border Road",
            "parkName": "Kokshaal-Too Wilderness Range",
            "landmark": "Soviet Military Border Fences",
            "notes": "Extreme 21.6% hike-a-bike pitch along the decommissioned Soviet border road strewn with rusted wire and forgotten outposts at 3,668m."
        },
        "pass-34": {
            "name": "Arabel Pass Summit (12,598 ft)",
            "climbName": "Arabel High Alpine Ascent",
            "trailName": "Burkhan - Arabel Valley Track",
            "parkName": "Tian Shan High Plateau",
            "landmark": "Arabel Glacial Plateau",
            "notes": "High, exposed alpine pass crossing between Burkhan and Arabel valleys. Renowned for unpredictable sub-zero blizzards even in midsummer."
        },
        "pass-35": {
            "name": "Tosor Pass Summit (12,786 ft)",
            "climbName": "Tosor Pass Ascent",
            "trailName": "Tosor Mountain Road",
            "parkName": "Teskey Alatoo Range",
            "landmark": "Tosor Glacier / Lake Issyk-Kul Vista",
            "notes": "Epic 22-mile ascent gaining 2,289 vertical meters from the Arabel plateau over the Teskey Alatoo range before plunging to Issyk-Kul."
        },
        "pass-38": {
            "name": "Ukok Pass Summit (12,879 ft)",
            "climbName": "Ukok Pass - Highest Summit on Course",
            "trailName": "Ukok High Alpine Pass Track",
            "parkName": "Son-Kul / Kochkor High Range",
            "landmark": "Ukok Lake / Peak Ukok (3,926m)",
            "notes": "The undisputed crux and highest elevation on the entire race course (3,926 meters). Extreme hike-a-bike through boulder fields and freezing scree."
        },
        "pass-39": {
            "name": "Kegeti Pass Summit (12,412 ft)",
            "climbName": "Kegeti Pass Ascent",
            "trailName": "Kegeti Historic Highway",
            "parkName": "Kyrgyz Alatoo Range",
            "landmark": "Kegeti Waterfall & Glacier",
            "notes": "Cleared in 2025 for the first time in 30 years. A colossal 33.5-mile ascent gaining 1,819m across the spine of the Kyrgyz Alatoo range."
        },
        "pass-41": {
            "name": "Chon-Kemin Ridge Summit (8,050 ft)",
            "climbName": "Chon-Kemin Ridge Ascent",
            "trailName": "Chon-Kemin National Park Track",
            "parkName": "Chon-Kemin State Nature Park",
            "landmark": "Chon-Kemin Pine Valley",
            "notes": "Scenic forested mountain ascent above the Chon-Kemin River with rushing alpine streams and lush spruce slopes."
        },
        "pass-46": {
            "name": "Kok-Ayrik Pass Summit (12,613 ft)",
            "climbName": "Kok-Ayrik Pass - Final Challenge",
            "trailName": "Kok-Ayrik Old Military Road",
            "parkName": "Kungey Alatoo Range",
            "landmark": "Lake Issyk-Kul North Shore Panorama",
            "notes": "The final colossal obstacle: a badly damaged high road with extensive washouts and boulder hiking, rewarding riders with an unforgettable view down to Lake Issyk-Kul."
        }
    }

    for p in passes:
        pid = p["id"]
        if pid in NAMED_PASS_MAP:
            info = NAMED_PASS_MAP[pid]
            p["name"] = info["name"]
            p["notes"] = info["notes"]
            p["landmark"] = info["landmark"]
            p["state"] = "KG"
        else:
            p["name"] = f"Summit Pass at Mile {p['routeMile']:.1f} ({p['elevationFeet']:,} ft)"
            p["state"] = "KG"

    for c in climbs:
        pid = c.get("passId")
        if pid and pid in NAMED_PASS_MAP:
            info = NAMED_PASS_MAP[pid]
            c["name"] = info["climbName"]
            c["notes"] = info["notes"]
            c["trailName"] = info["trailName"]
            c["parkName"] = info["parkName"]
            c["landmark"] = info["landmark"]
            c["isIconic"] = True
            c["state"] = "KG"
            c["surface"] = "Alpine Scree & Gravel" if c["summitElevationMeters"] > 3500 else "Mountain Track"
            c["roadClass"] = "Historic Mountain Road / Track"
        else:
            c["name"] = f"Climb to Summit at Mile {c['endMile']:.1f}"
            c["state"] = "KG"
            c["trailName"] = "Kyrgyz Mountain Track"
            c["parkName"] = "Tian Shan Mountains"
            c["landmark"] = f"Summit Crest ({c['summitElevationFeet']:,} ft)"
            c["surface"] = "Unpaved Gravel & Dirt"
            c["roadClass"] = "Backcountry Track"
            c["notes"] = f"Continuous ascent gaining {c['elevationGainMeters']}m ({c['elevationGainFeet']} ft) over {c['lengthMiles']} miles at {c['avgGradePercent']}% average gradient."

    with open(ROUTE_DIR / "passes.json", "w", encoding="utf-8") as f:
        json.dump(passes, f, indent=2, ensure_ascii=False)
    with open(ROUTE_DIR / "climbs.json", "w", encoding="utf-8") as f:
        json.dump(climbs, f, indent=2, ensure_ascii=False)
    print(f"[ENRICH] Enriched {len(passes)} passes and {len(climbs)} climbs.")

if __name__ == "__main__":
    main()
