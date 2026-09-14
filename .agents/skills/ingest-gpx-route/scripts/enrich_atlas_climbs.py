#!/usr/bin/env python3
"""
enrich_atlas_climbs.py - Enrich climbs.json and passes.json for Atlas Mountain Race 2026
with authentic geographic summit names, Moroccan mountain ranges, geoparks, and guidebook notes.
"""

import json
from pathlib import Path

CLIMB_ENRICHMENTS = [
    {
        "id": "climb-1",
        "name": "Jbel Tassemit Gateway Climb",
        "pass_name": "Jbel Tassemit Crest (1,924m / 6,312 ft)",
        "trailName": "RP3215 Beni Mellal Mountain Piste",
        "parkName": "Béni Mellal-Khénifra Province",
        "landmark": "Jbel Tassemit (2,247m) / Beni Mellal Escarpment",
        "isIconic": True,
        "notes": "Epic 1,270m opening climb ascending directly out of the Beni Mellal plains onto the high limestone plateau of the Middle Atlas foothills."
    },
    {
        "id": "climb-2",
        "name": "Ouaouizeght Plateau Pass",
        "pass_name": "Ouaouizeght Ridge (1,910m)",
        "trailName": "Plateau Limestone Track",
        "parkName": "Béni Mellal-Khénifra Province",
        "landmark": "Ouaouizeght Basin Overlook",
        "isIconic": False,
        "notes": "Short rocky rolling ascent crossing the crest before the fast descent towards the Tagleft valleys."
    },
    {
        "id": "climb-3",
        "name": "Oued el Abid Canyon Ascent",
        "pass_name": "Oued el Abid Overlook (1,103m)",
        "trailName": "Oued el Abid River Piste",
        "parkName": "Bin el Ouidane Valley",
        "landmark": "Oued el Abid River Gorge",
        "isIconic": False,
        "notes": "Gravel climb carving out of the river canyon bed through olive groves and red clay hills."
    },
    {
        "id": "climb-4",
        "name": "Tagleft Valley Ridge",
        "pass_name": "Tagleft Pass (1,259m)",
        "trailName": "Middle Atlas Foothill Track",
        "parkName": "Azilal Province",
        "landmark": "Tagleft Village Terraces",
        "isIconic": False,
        "notes": "Steady gradient through traditional Berber terraced farms leading past the small village resupply outpost."
    },
    {
        "id": "climb-5",
        "name": "Ait Mazigh Foothills",
        "pass_name": "Ait Mazigh Saddle (1,352m)",
        "trailName": "RP3107 Mountain Road",
        "parkName": "Azilal Province",
        "landmark": "Ait Mazigh Ridge",
        "isIconic": False,
        "notes": "Punchy climb on mixed broken pavement and compacted gravel into the high forested hills."
    },
    {
        "id": "climb-6",
        "name": "Tilouguite Mountain Ridge",
        "pass_name": "Tilouguite Summit (1,824m)",
        "trailName": "Tilouguite Forest Piste",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "Tilouguite Crest & Assif Ahansal",
        "isIconic": False,
        "notes": "Sustained 545m ascent threading through holm oak forests towards the remote Ahansal river canyon."
    },
    {
        "id": "climb-7",
        "name": "Assif Ahansal Gorge Ascent",
        "pass_name": "Ahansal Gorge Saddle (1,319m)",
        "trailName": "Ahansal River Piste",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "Assif Ahansal River Canyon",
        "isIconic": False,
        "notes": "Rocky climb tracking above the turquoise waters of the Ahansal river gorge surrounded by vertical limestone walls."
    },
    {
        "id": "climb-8",
        "name": "Rocher de Mastfrane / Cathedral Rock Ascent",
        "pass_name": "Cathedral Rock Pass (1,848m / 6,063 ft)",
        "trailName": "Cathedral Rock Alpine Track",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "Rocher de Mastfrane (The Cathedral 1,872m)",
        "isIconic": True,
        "notes": "Brutal 695m climb at a steep 7.8% average grade skirting beneath the awe-inspiring monolithic cliff face of Cathedral Rock."
    },
    {
        "id": "climb-9",
        "name": "Zawyat Ahansal Canyon Approach",
        "pass_name": "Zawyat Ahansal Gate (2,050m)",
        "trailName": "High Ahansal Mule Trail",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "Taghia Cirque / Ahansal Valley",
        "isIconic": False,
        "notes": "Steep rocky switchbacks rising into the historic religious and climbing sanctuary of Zawyat Ahansal."
    },
    {
        "id": "climb-10",
        "name": "Taghia Gorge Upper Ridge",
        "pass_name": "Taghia Rim Pass (2,304m)",
        "trailName": "Central High Atlas Piste",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "Taghia Limestone Walls",
        "isIconic": False,
        "notes": "High altitude climb into sub-alpine terrain with expansive vistas over the dramatic canyon country of Taghia."
    },
    {
        "id": "climb-11",
        "name": "Tizi n'Ilissi Pass",
        "pass_name": "Tizi n'Ilissi (2,609m / 8,560 ft)",
        "trailName": "Central High Atlas Alpine Route",
        "parkName": "Haut Atlas Central National Park (Proposed)",
        "landmark": "Jbel Azourki (3,677m)",
        "isIconic": True,
        "notes": "Challenging 373m high-altitude pass topping out above 2,600m beneath the snowy summit crags of Jbel Azourki."
    },
    {
        "id": "climb-12",
        "name": "Tizi n'Tirghist / Ait Bouguemez Crest",
        "pass_name": "Tizi n'Tirghist (2,767m / 9,078 ft)",
        "trailName": "Ait Bouguemez Mountain Highway",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "Happy Valley (Ait Bouguemez) Overlook",
        "isIconic": False,
        "notes": "Punishing climb over 2,750m before plunging down legendary switchbacks into the lush, fertile 'Happy Valley' of Ait Bouguemez."
    },
    {
        "id": "climb-13",
        "name": "Tizi N'Ait Imi / M'Goun Alpine Summit",
        "pass_name": "Tizi N'Ait Imi Summit (2,913m / 9,557 ft)",
        "trailName": "M'Goun Trans-Atlas Pack Mule Trail",
        "parkName": "Haut Atlas Central National Park",
        "landmark": "M'Goun Massif (4,071m / 13,356 ft)",
        "isIconic": True,
        "notes": "The monumental Queen Stage of the Atlas Mountain Race: 1,064m of grueling continuous ascent out of Tabant to the highest summit pass of the race at 2,913m, followed by a technical descent into the M'Goun river gorge."
    },
    {
        "id": "climb-14",
        "name": "M'Goun Gorge Riverbed Exit Ridge",
        "pass_name": "Ighil N'Oumgoun Pass (1,956m)",
        "trailName": "Chemin Gorges du M'Goun",
        "parkName": "M'Goun UNESCO Global Geopark",
        "landmark": "M'Goun Canyon Gorge Exit",
        "isIconic": False,
        "notes": "Climbing out of the freezing M'Goun river canyon back onto gravel track after miles of mandatory river hiking and wade sections."
    },
    {
        "id": "climb-15",
        "name": "Valley of the Roses Overlook",
        "pass_name": "Boutaghrar Crest (1,958m)",
        "trailName": "Dades Valley Secondary Piste",
        "parkName": "Dades Valley Region",
        "landmark": "Boutaghrar Kasbahs & Rose Valleys",
        "isIconic": False,
        "notes": "Stiff 374m ascent at 6.7% grade overlooking ancient adobe mud kasbahs and fragrant Damask rose fields leading to Kalaat M'Gouna."
    },
    {
        "id": "climb-16",
        "name": "Jbel Saghro Northern Slopes",
        "pass_name": "Ikniouen Plateau Gate (1,600m)",
        "trailName": "Jbel Saghro North Approach",
        "parkName": "Jbel Saghro Protected Geopark",
        "landmark": "Jbel Saghro Volcanic Massif",
        "isIconic": False,
        "notes": "Initial ascent entering the arid, moon-like volcanic landscape of the Saghro range through dry washes."
    },
    {
        "id": "climb-17",
        "name": "Ikniouen Pass",
        "pass_name": "Ikniouen Saddle (1,626m)",
        "trailName": "Ikniouen Mining Piste",
        "parkName": "Jbel Saghro Protected Geopark",
        "landmark": "Ikniouen Mining Village",
        "isIconic": False,
        "notes": "Rolling climb through mineral-rich hills before the main push towards Tizi n'Tazazert."
    },
    {
        "id": "climb-18",
        "name": "Tizi n'Tazazert Moonscape Pass",
        "pass_name": "Tizi n'Tazazert Summit (2,031m / 6,663 ft)",
        "trailName": "Ancient Saghro Caravan Piste",
        "parkName": "Jbel Saghro Protected Geopark",
        "landmark": "Bab n'Ali Twin Basalt Needles",
        "isIconic": True,
        "notes": "Famous rocky gravel climb through dark basalt towers and volcanic monoliths of Jbel Saghro, offering surreal panoramic views towards the Sahara."
    },
    {
        "id": "climb-19",
        "name": "Afra Basin Ascent",
        "pass_name": "Afra Ridge (1,089m)",
        "trailName": "Draa Desert Piste",
        "parkName": "Drâa-Tafilalet Province",
        "landmark": "Afra Palm Oasis",
        "isIconic": False,
        "notes": "Crossing arid desert plateaus south of Jbel Saghro into the historic date palm oasis basin of Afra."
    },
    {
        "id": "climb-20",
        "name": "Draa Valley Escarpment",
        "pass_name": "Tansifte Pass (1,411m)",
        "trailName": "Draa Canyon Rim Track",
        "parkName": "Drâa-Tafilalet Province",
        "landmark": "Jbel Kissane Table Mountain",
        "isIconic": False,
        "notes": "Steady 442m climb ascending the sandstone plateau flanking the Draa river valley with views of flat-topped Jbel Kissane."
    },
    {
        "id": "climb-21",
        "name": "Jbel Kissane High Ridge",
        "pass_name": "Jbel Kissane Crest (1,656m)",
        "trailName": "Tansifte Ridge Track",
        "parkName": "Drâa-Tafilalet Province",
        "landmark": "Kissane Massif",
        "isIconic": False,
        "notes": "Steep 6.5% push over broken shale and red rock rising towards the high saddle separating the Draa and Siroua watersheds."
    },
    {
        "id": "climb-22",
        "name": "Siroua Volcanic Foothills",
        "pass_name": "Jbel Siroua Crest (1,978m / 6,488 ft)",
        "trailName": "Siroua Saffron Piste",
        "parkName": "Jbel Siroua Massif Reserve",
        "landmark": "Jbel Siroua Extinct Volcano (3,304m)",
        "isIconic": False,
        "notes": "Short high-altitude climb across the windswept volcanic plateau connecting Taznakht and the Siroua region."
    },
    {
        "id": "climb-23",
        "name": "Aguinane Oasis Canyon Gate",
        "pass_name": "Aguinane Canyon Crest (1,088m)",
        "trailName": "Assif n'Aguinane Oasis Piste",
        "parkName": "Anti-Atlas Canyon Region",
        "landmark": "Aguinane Canyon & Date Palm Oasis",
        "isIconic": False,
        "notes": "Punchy climb winding through dramatic canyon switchbacks into the lush hidden date-palm oasis of Aguinane."
    },
    {
        "id": "climb-24",
        "name": "Anti-Atlas High Plateau Ascent",
        "pass_name": "Anti-Atlas Eastern Crest (1,523m)",
        "trailName": "High Anti-Atlas Mountain Road",
        "parkName": "Anti-Atlas Biosphere Reserve",
        "landmark": "Igherm Copper Mountains & Southern Valleys",
        "isIconic": False,
        "notes": "Long, gradual 493m climb winding across the desolate, pink-hued quartzite plateaus of the eastern Anti-Atlas toward Tichgach."
    },
    {
        "id": "climb-25",
        "name": "Jbel Imzi High Pass",
        "pass_name": "Jbel Imzi Summit (1,756m)",
        "trailName": "Igherm-Tichgach Ridge Piste",
        "parkName": "Anti-Atlas Biosphere Reserve",
        "landmark": "Jbel Imzi Quartzite Ridge",
        "isIconic": False,
        "notes": "Stiff climb over loose gravel reaching a windy 1,756m crest with panoramic vistas across the desolate desert mountains."
    },
    {
        "id": "climb-26",
        "name": "Tichgach Ridge Crest",
        "pass_name": "Tichgach Crest (1,768m)",
        "trailName": "Anti-Atlas Western Piste",
        "parkName": "Anti-Atlas Biosphere Reserve",
        "landmark": "Tichgach Highland Plateau",
        "isIconic": False,
        "notes": "Rolling high-altitude plateau traverse with panoramic views of endless desert mountain ridges leading toward Tichgach."
    },
    {
        "id": "climb-27",
        "name": "Oued Akka Valley Ascent",
        "pass_name": "Oued Akka Ridge Pass (1,303m)",
        "trailName": "Eastern Anti-Atlas Track",
        "parkName": "Anti-Atlas Biosphere Reserve",
        "landmark": "Oued Akka River Canyon",
        "isIconic": False,
        "notes": "Gradual gravel ascent rising out of the Oued Akka river valley towards the eastern rim of the Anti-Atlas range."
    },
    {
        "id": "climb-28",
        "name": "Aït Mansour Mountain Approach",
        "pass_name": "Aït Mansour Saddle (1,532m)",
        "trailName": "Aït Mansour Crest Track",
        "parkName": "Anti-Atlas Biosphere Reserve",
        "landmark": "Eastern Anti-Atlas Escarpment",
        "isIconic": False,
        "notes": "Rocky climb ascending along the high limestone ridge overlooking the distant Aït Mansour canyon system."
    },
    {
        "id": "climb-29",
        "name": "Tizi n'Tarakatine / Aït Mansour Pass",
        "pass_name": "Tizi n'Tarakatine Summit (1,812m / 5,945 ft)",
        "trailName": "Ancient Granite Mule Pass",
        "parkName": "Anti-Atlas Biosphere Reserve",
        "landmark": "Jbel Tarakatine Summit Ridge",
        "isIconic": True,
        "notes": "Dramatic 347m climb at 6.2% grade crossing the high alpine pass before the breathtaking descent into the palm-filled Gorges d'Aït Mansour."
    },
    {
        "id": "climb-30",
        "name": "Aït Mansour to Painted Rocks Ascent",
        "pass_name": "Aguerd Oudad Crest (1,683m)",
        "trailName": "Chapeau de Napoléon Piste",
        "parkName": "Anti-Atlas UNESCO Biosphere Reserve",
        "landmark": "Les Roches Bleues (Painted Rocks) & Chapeau de Napoléon",
        "isIconic": False,
        "notes": "Major 594m climb rising out of the lush palm oasis of Gorges d'Aït Mansour and threading between the colossal blue-painted monoliths of Aguerd Oudad."
    },
    {
        "id": "climb-31",
        "name": "Ameln Valley Exit & Tioulit Pass Approach",
        "pass_name": "Tioulit Pass (1,305m)",
        "trailName": "RP1011 Mountain Highway",
        "parkName": "Souss-Massa Province",
        "landmark": "Ameln Valley & Jbel el Kest Quartzite Wall",
        "isIconic": False,
        "notes": "Challenging 433m ascent through spectacular canyon topography climbing out of the Ameln Valley past cliff-clinging stone villages."
    },
    {
        "id": "climb-32",
        "name": "Tioulit Upper Crest",
        "pass_name": "Tioulit Ridge (1,249m)",
        "trailName": "Western Anti-Atlas Piste",
        "parkName": "Souss-Massa Province",
        "landmark": "Ait Baha Canyon Rim",
        "isIconic": False,
        "notes": "Short punchy climb along the gorge rim with tight hairpin bends overlooking terraced almond groves."
    },
    {
        "id": "climb-33",
        "name": "Kasbah Tizourgane Approach",
        "pass_name": "Tizourgane Saddle (1,105m)",
        "trailName": "Kasbah Historical Way",
        "parkName": "Souss-Massa Province",
        "landmark": "Kasbah Tizourgane 13th-Century Fortress",
        "isIconic": False,
        "notes": "Scenic climb winding up towards the iconic 13th-century walled mountaintop citadel of Kasbah Tizourgane."
    },
    {
        "id": "climb-34",
        "name": "Kasbah Tizourgane High Wall",
        "pass_name": "Tizourgane Crest (1,120m)",
        "trailName": "Ida Ougnidif Ridge Track",
        "parkName": "Souss-Massa Province",
        "landmark": "Tizourgane Fortified Citadel",
        "isIconic": False,
        "notes": "Sustained 387m gravel climb with dramatic views back towards the fortified kasbah crowning its conical hill."
    },
    {
        "id": "climb-35",
        "name": "Ait Baha Escarpment Climb",
        "pass_name": "Ait Baha Overlook (539m)",
        "trailName": "Ait Baha Descent Road",
        "parkName": "Souss-Massa Province",
        "landmark": "Ait Baha Reservoir & Kasbahs",
        "isIconic": False,
        "notes": "Climbing the steep escarpment above the Ait Baha reservoir before descending towards the expansive agricultural Sous plains."
    },
    {
        "id": "climb-36",
        "name": "Sous Plain Foothill Ridge",
        "pass_name": "Sous Basin Crest (658m)",
        "trailName": "Sous Valley Northern Track",
        "parkName": "Souss-Massa Province",
        "landmark": "Sous River Basin",
        "isIconic": False,
        "notes": "Rolling gravel ridge climb crossing between the arid Anti-Atlas foothills and the fertile Sous valley."
    },
    {
        "id": "climb-37",
        "name": "Taroudant Basin Approach",
        "pass_name": "Aoulouz Foothill Saddle (530m)",
        "trailName": "Lower Souss Piste",
        "parkName": "Souss-Massa Province",
        "landmark": "Sous River Plains",
        "isIconic": False,
        "notes": "Gentle climb transitioning from the desert foothills into the lush citrus and argan groves of the Sous basin."
    },
    {
        "id": "climb-38",
        "name": "Argana Gorge Wall",
        "pass_name": "Argana Ridge (585m)",
        "trailName": "Western Atlas Foothill Track",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Argana Canyon",
        "isIconic": False,
        "notes": "Fierce 9.2% wall climbing up from the riverbed into ancient UNESCO-protected argan forest groves."
    },
    {
        "id": "climb-39",
        "name": "Amskroud Mountain Gate",
        "pass_name": "Amskroud Saddle (633m)",
        "trailName": "Western High Atlas Piste",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Amskroud Pass",
        "isIconic": False,
        "notes": "Rocky climb heading north out of Amskroud into the rugged coastal mountains of the Western High Atlas."
    },
    {
        "id": "climb-40",
        "name": "Argana Canyon Ascent",
        "pass_name": "Argana Summit (889m)",
        "trailName": "Old Marrakech Caravan Piste",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Argana Valley Vistas",
        "isIconic": False,
        "notes": "Stiff 310m climb at 8.4% average grade navigating loose switchbacks on old pack mule trails."
    },
    {
        "id": "climb-41",
        "name": "Tamzargout Ridge",
        "pass_name": "Tamzargout Pass (836m)",
        "trailName": "Western Atlas Crest Piste",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Tamzargout Terraces",
        "isIconic": False,
        "notes": "Punchy 7.3% climb along a sharp mountain spine with ocean breezes beginning to temper the desert heat."
    },
    {
        "id": "climb-42",
        "name": "Paradise Valley Gorge Entry",
        "pass_name": "Paradise Valley Gate (540m)",
        "trailName": "Asif Tamraght Canyon Trail",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Paradise Valley Palm Oasis & Emerald Pools",
        "isIconic": False,
        "notes": "Steep 8.2% climb into the famous palm-filled river gorge of Paradise Valley with limestone plunge pools below."
    },
    {
        "id": "climb-43",
        "name": "Tamraght River Gorge Ascent",
        "pass_name": "Tamraght Saddle (329m)",
        "trailName": "Honey Route River Piste",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Assif Tamraght",
        "isIconic": False,
        "notes": "Short punchy climb rising out of the riverbed towards the mountain honey producing villages."
    },
    {
        "id": "climb-44",
        "name": "Imouzzer Lower Ramp",
        "pass_name": "Imouzzer Gate (628m)",
        "trailName": "Route du Miel (Honey Road)",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Tinkert River Canyon",
        "isIconic": False,
        "notes": "Challenging 8.0% gradient climbing through wild thyme, lavender, and argan forest towards Imouzzer Ida Outanane."
    },
    {
        "id": "climb-45",
        "name": "Imouzzer Ida Outanane Waterfall Crest",
        "pass_name": "Imouzzer Summit Pass (1,201m / 3,940 ft)",
        "trailName": "Imouzzer Mountain Highway",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Imouzzer Bridal Veil Waterfalls",
        "isIconic": True,
        "notes": "Monster 608m climb at a relentless 8.2% grade up to the highland Berber capital of Imouzzer Ida Outanane, celebrated for its cascading limestone waterfalls and mountain honey."
    },
    {
        "id": "climb-46",
        "name": "Tafferguent Highland Ridge",
        "pass_name": "Tafferguent Crest (703m)",
        "trailName": "RR113 Coastal Mountain Road",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Western Atlas Highland Terraces",
        "isIconic": False,
        "notes": "Brisk 6.5% climb traversing the high spine between Imouzzer and the Atlantic coastal descent."
    },
    {
        "id": "climb-47",
        "name": "Taghazout Hinterland Ridge",
        "pass_name": "Taghazout Overlook (496m)",
        "trailName": "Atlantic Coastal Ridge Piste",
        "parkName": "Arganeraie UNESCO Biosphere Reserve",
        "landmark": "Atlantic Ocean Panorama",
        "isIconic": False,
        "notes": "First clear view of the crashing Atlantic surf from the mountain ridges above world-renowned surf breaks."
    },
    {
        "id": "climb-48",
        "name": "Imsouane Coastal Cliffs",
        "pass_name": "Imsouane Bay Crest (325m)",
        "trailName": "Atlantic Escarpment Track",
        "parkName": "Marrakech-Safi Coastal Reserve",
        "landmark": "Imsouane Bay & Lighthouse",
        "isIconic": False,
        "notes": "Gentle coastal climb tracing dramatic limestone sea cliffs with endless views of Atlantic rollers."
    },
    {
        "id": "climb-49",
        "name": "Tafedna Valley Entry",
        "pass_name": "Tafedna Saddle (165m)",
        "trailName": "Coastal Argan Piste",
        "parkName": "Marrakech-Safi Coastal Reserve",
        "landmark": "Tafedna Fishing Cove",
        "isIconic": False,
        "notes": "Short punchy climb leading down into the secluded fishing hamlet and argan valley of Tafedna."
    },
    {
        "id": "climb-50",
        "name": "Cap Tafelney Ascent",
        "pass_name": "Cap Tafelney Crest (259m)",
        "trailName": "Coastal Dune & Rock Piste",
        "parkName": "Marrakech-Safi Coastal Reserve",
        "landmark": "Cap Tafelney Promontory",
        "isIconic": False,
        "notes": "Climbing the sandy coastal bluff above Cap Tafelney against prevailing Atlantic trade winds."
    },
    {
        "id": "climb-51",
        "name": "Smimou Sand Plateau",
        "pass_name": "Smimou Dunes (300m)",
        "trailName": "Atlantic Dune Track",
        "parkName": "Marrakech-Safi Coastal Reserve",
        "landmark": "Smimou Argan Groves",
        "isIconic": False,
        "notes": "Rolling sand and gravel track traversing ancient coastal argan forests inhabited by tree-climbing goats."
    },
    {
        "id": "climb-52",
        "name": "Sidi Kaouki Final Coastal Escarpment",
        "pass_name": "Sidi Kaouki Ridge (369m / 1,211 ft)",
        "trailName": "Essaouira Coastal Approach Trail",
        "parkName": "Marrakech-Safi Coastal Reserve",
        "landmark": "Sidi Kaouki Marabout & Atlantic Dunes",
        "isIconic": True,
        "notes": "The final climb of the Atlas Mountain Race! Sustained 342m ascent over coastal limestone and sand dunes before the glorious flat seaside charge into the 18th-century ramparts of Essaouira."
    }
]

def enrich_climbs_and_passes():
    climbs_file = Path("public/data/routes/atlas-mountain-race-2026/climbs.json")
    passes_file = Path("public/data/routes/atlas-mountain-race-2026/passes.json")
    track_file = Path("public/data/routes/atlas-mountain-race-2026/route-track.json")

    with open(climbs_file, "r", encoding="utf-8") as f:
        climbs = json.load(f)

    with open(passes_file, "r", encoding="utf-8") as f:
        passes = json.load(f)

    with open(track_file, "r", encoding="utf-8") as f:
        track = json.load(f)["points"]

    enrich_by_id = {e["id"]: e for e in CLIMB_ENRICHMENTS}
    passes_by_id = {p["id"]: p for p in passes}

    for idx, c in enumerate(climbs):
        cid = c["id"]
        en = enrich_by_id.get(cid)
        if en:
            c["name"] = en["name"]
            c["state"] = "Morocco"
            c["trailName"] = en["trailName"]
            c["parkName"] = en["parkName"]
            c["landmark"] = en["landmark"]
            c["isIconic"] = en["isIconic"]
            c["notes"] = en["notes"]

            # Corresponding pass
            pid = c.get("passId") or f"pass-{idx+1}"
            c["passId"] = pid
            if pid in passes_by_id:
                p = passes_by_id[pid]
                p["name"] = en["pass_name"]
                p["state"] = "Morocco"
                p["notes"] = en["notes"]

    # Save enriched files
    with open(climbs_file, "w", encoding="utf-8") as f:
        json.dump(climbs, f, indent=2, ensure_ascii=False)
    print(f"[ENRICH] Successfully enriched {len(climbs)} climbs in {climbs_file}")

    with open(passes_file, "w", encoding="utf-8") as f:
        json.dump(passes, f, indent=2, ensure_ascii=False)
    print(f"[ENRICH] Successfully enriched {len(passes)} passes in {passes_file}")

if __name__ == "__main__":
    enrich_climbs_and_passes()
