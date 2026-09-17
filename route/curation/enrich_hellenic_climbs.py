#!/usr/bin/env python3
"""
enrich_hellenic_climbs.py - Enrich climbs.json and passes.json for Hellenic Mountain Race
with authentic geographic summit names, Greek mountain ranges, national parks, and notes.
"""

import json
from pathlib import Path

def enrich_climbs():
    climbs_path = Path("public/data/routes/hellenic-mountain-race-2026/climbs.json")
    passes_path = Path("public/data/routes/hellenic-mountain-race-2026/passes.json")

    with open(climbs_path, "r", encoding="utf-8") as f:
        climbs = json.load(f)

    with open(passes_path, "r", encoding="utf-8") as f:
        passes = json.load(f)

    passes_by_id = {p["id"]: p for p in passes}

    # Named geographic milestones mapping by mile threshold
    climb_map = [
        {
            "match_mile": 13.9,
            "name": "Mount Voras / Kaimaktsalan Summit Ascent",
            "pass_name": "Kaimaktsalan Summit (2,507m / 8,226 ft)",
            "trailName": "Border Ridge Singletrack (Greece / North Macedonia)",
            "parkName": "Mount Voras Natura 2000 Protected Area",
            "landmark": "Mount Voras / Kaimaktsalan Peak (2,524m)",
            "isIconic": True,
            "notes": "Monster 1,474m opening climb out of Agios Athanasios to the highest summit of the entire race on the North Macedonia border. Severe weather exposure and technical ridgeline descent."
        },
        {
            "match_mile": 54.7,
            "name": "Vernon Range / Lake Vegoritida Crest",
            "pass_name": "Vernon Mountain Pass (1,612m)",
            "trailName": "Western Macedonia Forest Tracks",
            "parkName": "Lake Vegoritida & Mount Vernon Biosphere",
            "landmark": "Vernon (Vitsi) Massif",
            "isIconic": False,
            "notes": "Sustained 981m gravel climb traversing pine forests above Lake Vegoritida with expansive panoramas across northern Macedonia."
        },
        {
            "match_mile": 109.3,
            "name": "Grammos Foothills Ascent",
            "pass_name": "Grammos Ridgeline Saddle (1,514m)",
            "trailName": "Northern Pindus Trail",
            "parkName": "Mount Grammos Protected Reserve",
            "landmark": "Grammos Alpine Ridge",
            "isIconic": False,
            "notes": "Remote backcountry doubletrack winding into the Grammos range near the Albanian frontier."
        },
        {
            "match_mile": 132.7,
            "name": "Smolikas West Approach",
            "pass_name": "Samarina Saddle (1,570m)",
            "trailName": "Samarina Mountain Trail",
            "parkName": "Pindus National Park (Valia Calda)",
            "landmark": "Mount Smolikas (2,637m)",
            "isIconic": False,
            "notes": "Ascent into the high Vlach mountain village of Samarina, preparing riders for the grueling alpine push to CP1."
        },
        {
            "match_mile": 143.0,
            "name": "Mount Smolikas Summit Ridge (CP1)",
            "pass_name": "Mount Smolikas Crest & CP1 (2,159m / 7,083 ft)",
            "trailName": "Smolikas Alpine Singletrack (E4 Path)",
            "parkName": "Pindus National Park (Valia Calda)",
            "landmark": "Mount Smolikas Summit (2,637m - 2nd Highest in Greece)",
            "isIconic": True,
            "notes": "Brutal 1,155m ascent at a punishing 14.8% average grade, culminating in a 9km hike-a-bike over high alpine shale to CP1 Smolikas, followed by legendary singletrack with berms and drops."
        },
        {
            "match_mile": 186.1,
            "name": "Vikos Gorge Rim / Astraka Crest",
            "pass_name": "Vikos Gorge Overlook Crest (1,562m)",
            "trailName": "Zagori Stone Staircase & Gorge Trail",
            "parkName": "Vikos-Aoos National Park (UNESCO Geopark)",
            "landmark": "Vikos Canyon (1,000m sheer vertical gorge)",
            "isIconic": True,
            "notes": "Famous steep hike up out of Voidomatis riverbed to the dizzying rim of Vikos Gorge, the deepest canyon in the world by proportion."
        },
        {
            "match_mile": 204.1,
            "name": "Central Zagori Stone Bridge Climb",
            "pass_name": "Kipoi Ridge (1,222m)",
            "trailName": "Ancient Zagori Mule Trails (Skala Vitsas)",
            "parkName": "Zagori Cultural Heritage Reserve",
            "landmark": "Kalogeriko & Kokkori Arched Stone Bridges",
            "isIconic": False,
            "notes": "Challenging climb traversing historic Ottoman-era stone arch bridges and steep cobbled donkey paths linking the stone villages."
        },
        {
            "match_mile": 271.2,
            "name": "Katara Pass / Pindus Alpine Crest",
            "pass_name": "Katara Pass Summit (1,790m / 5,873 ft)",
            "trailName": "Pindus High Alpine Ridgeline",
            "parkName": "Northern Pindus National Park",
            "landmark": "Katara Summit & Metsovo Valley",
            "isIconic": False,
            "notes": "Long 852m climb over the notorious Katara Pass ('the Curse'), historically feared by travelers for blizzards, leading towards Metsovo resupply."
        },
        {
            "match_mile": 308.6,
            "name": "Tzoumerka Massif High Pass (CP2)",
            "pass_name": "Melissourgi High Pass (1,881m / 6,171 ft)",
            "trailName": "Tzoumerka Wilderness Transverse",
            "parkName": "Tzoumerka, Peristeri & Arachthos Gorge National Park",
            "landmark": "Mount Kakarditsa (2,429m) & Strogoula Peak",
            "isIconic": True,
            "notes": "Spectacular 888m alpine climb across rugged limestone needles past CP2 Melissourgi refuge, navigating washed-out logging tracks high above the Arachthos Gorge."
        },
        {
            "match_mile": 367.4,
            "name": "Agrafa Wilderness Ridge Ascent",
            "pass_name": "Agrafa Frontier Ridge (1,467m)",
            "trailName": "Agrafa Mountain Mule Tracks",
            "parkName": "Agrafa Wilderness Heritage Area",
            "landmark": "Agrafa Peaks ('The Unwritten Lands')",
            "isIconic": False,
            "notes": "Gaining 750m into Europe's most isolated mountain territory, celebrated for centuries of untamed autonomy and impenetrable terrain."
        },
        {
            "match_mile": 422.8,
            "name": "Viniani Gorge to Megdovas Crest",
            "pass_name": "Stenoma-Viniani Crest (1,190m)",
            "trailName": "Megdovas River Canyon Track",
            "parkName": "Evrytania Mountain Reserve",
            "landmark": "Stenoma-Viniani Historic Stone Bridge",
            "isIconic": False,
            "notes": "Demanding 835m haul with a notorious steep hike-a-bike section directly from the riverbed stone bridge up to the mountain rim."
        },
        {
            "match_mile": 446.0,
            "name": "Mount Tymfristos / Velouchi Ski Ascent",
            "pass_name": "Velouchi Ski Resort Pass (1,860m / 6,102 ft)",
            "trailName": "Tymfristos High Alpine Track",
            "parkName": "Evrytania Alpine Forest Reserve",
            "landmark": "Mount Tymfristos / Velouchi Peak (2,315m)",
            "isIconic": True,
            "notes": "Monumental 1,155m ascent climbing high into the scree and meadows of Mount Tymfristos before dropping into Karpenisi for CP3."
        },
        {
            "match_mile": 483.8,
            "name": "Diaselo Kaliakoudas Pass",
            "pass_name": "Diaselo Kaliakoudas Pass (1,743m / 5,719 ft)",
            "trailName": "Kaliakouda - Chelidona High Route",
            "parkName": "Kaliakouda Alpine Wilderness",
            "landmark": "Mount Kaliakouda (2,101m)",
            "isIconic": True,
            "notes": "The legendary gravel mountain pass of central Greece, ascending 687m on loose switchbacks between Mount Kaliakouda and Chelidona with vertiginous drop-offs."
        },
        {
            "match_mile": 559.1,
            "name": "Nafpaktia Coastal Mountain Ascent",
            "pass_name": "Corinthian Gulf Overlook (985m)",
            "trailName": "Nafpaktia Ridgeline Track",
            "parkName": "Southern Pindus Coastal Biosphere",
            "landmark": "Gulf of Corinth & Rio-Antirrio Strait",
            "isIconic": False,
            "notes": "Final 821m mountain obstacle climbing through chestnut forests of Nafpaktia before plunging into the coastal fortress town of Nafpaktos."
        }
    ]

    for entry in climb_map:
        target_mile = entry["match_mile"]
        best_c = min(climbs, key=lambda c: abs(c["endMile"] - target_mile))
        if abs(best_c["endMile"] - target_mile) < 2.5:
            best_c["name"] = entry["name"]
            best_c["trailName"] = entry["trailName"]
            best_c["parkName"] = entry["parkName"]
            best_c["landmark"] = entry["landmark"]
            best_c["notes"] = entry["notes"]
            best_c["isIconic"] = entry["isIconic"]

            pid = best_c.get("passId")
            if pid and pid in passes_by_id:
                passes_by_id[pid]["name"] = entry["pass_name"]
                passes_by_id[pid]["notes"] = entry["notes"]

    # Save enriched datasets
    with open(climbs_path, "w", encoding="utf-8") as f:
        json.dump(climbs, f, indent=2)
    print(f"[CLIMBS ENRICHMENT] Updated {climbs_path}")

    with open(passes_path, "w", encoding="utf-8") as f:
        json.dump(passes, f, indent=2)
    print(f"[PASSES ENRICHMENT] Updated {passes_path}")

if __name__ == "__main__":
    enrich_climbs()
