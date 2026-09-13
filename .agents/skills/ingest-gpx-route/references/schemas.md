# Route Dataset Schemas & Manifest Architecture

Each route in Bikepack Navigator is defined as a self-contained static data package located at:
`public/data/routes/<route-id>/`

The Angular runtime (`RouteDataService`) loads these 6 static files in parallel when online, and caches the entire package in IndexedDB for complete offline capability.

---

## 1. `route-track.json`
Represents the densely sampled GPS track coordinates with cumulative distance.

```json
{
  "total_km": 828.3,
  "total_miles": 514.7,
  "points": [
    [39.490925, -105.094238, 1675.0, 0.0, 0.0],
    [39.491268, -105.094460, 1675.0, 0.043, 0.026]
  ]
}
```
**Point Tuple Format:**
`[latitude, longitude, elevation_meters, cumulative_km, cumulative_miles]`

---

## 2. `surfaces.json`
Defines contiguous surface and road classification intervals for rolling resistance and ETA physics calculation.

```json
[
  [0.0, 10.5, "track", "compacted", "grade2"],
  [10.5, 72.2, "path", "dirt", "grade4"],
  [72.2, 165.0, "unclassified", "gravel", "grade2"]
]
```
**Interval Tuple Format:**
`[start_km, end_km, highway_class, surface_type, tracktype_grade]`

---

## 3. `climbs.json`
Categorized climbs along the route with gradient and difficulty stats, geographic trail/park badges, and rich guidebook narratives for the elevation profile viewer.

```json
[
  {
    "id": "climb-6",
    "name": "Goat Pond Overlook",
    "state": "AB",
    "startMile": 12.8,
    "endMile": 13.5,
    "startKm": 20.6,
    "endKm": 21.8,
    "lengthMiles": 0.7,
    "lengthKm": 1.2,
    "startElevationMeters": 1652,
    "summitElevationMeters": 1715,
    "startElevationFeet": 5420,
    "summitElevationFeet": 5627,
    "elevationGainMeters": 63,
    "elevationGainFeet": 207,
    "avgGradePercent": 5.3,
    "maxGradePercent": 11.0,
    "isIconic": false,
    "passId": "pass-6",
    "difficulty": "difficult",
    "trailName": "High Rockies Trail (TCT)",
    "parkName": "Spray Valley Provincial Park",
    "landmark": "Mt. Lawrence Grassi / Goat Pond",
    "notes": "Ascends the forested bench of the Mount Lawrence Grassi massif along the High Rockies Trail in Spray Valley Provincial Park. The summit at 1,715 m (5,627 ft) opens up panoramic vistas across Goat Pond and the turquoise Spray Lakes reservoir before descending toward the winter dog sled trails.",
    "roadClass": "Singletrack Trail",
    "surface": "Gravel",
    "firmness": "Grade 2: Solid Unpaved (Compacted Gravel)",
    "tracktype": "grade2"
  }
]
```

**Key Geographic Intelligence Attributes:**
- `name`: Evocative, authentic climb summit/ridge/pass name (e.g. `Goat Pond Overlook`, `Kenosha Pass Ascent`) instead of generic `"Climb to Summit at Mile X"`.
- `trailName` *(optional)*: Verified trail name or designation from OSM (e.g. `High Rockies Trail (TCT)`, `Colorado Trail`). Displayed with `🌲` badge in the UI.
- `parkName` *(optional)*: Public land, provincial park, national park, or national forest jurisdiction (e.g. `Spray Valley Provincial Park`, `Pike National Forest`). Displayed with `🏞️` badge in the UI.
- `landmark` *(optional)*: Prominent mountain peak, massif, or water feature (e.g. `Mt. Lawrence Grassi / Goat Pond`). Displayed with `⛰️` badge in the UI.
- `notes` *(optional)*: Concise 1–2 sentence guidebook context describing the ascent, surroundings, surface difficulty, and summit views. Displayed in an emerald-accented guidebook callout box.

---

## 4. `passes.json`
Named mountain passes and major crest summits.

```json
[
  {
    "id": "pass-1",
    "name": "Kenosha Pass",
    "state": "CO",
    "routeMile": 113.2,
    "routeKm": 182.2,
    "elevationMeters": 3177,
    "elevationFeet": 10423,
    "lat": 39.39103,
    "lon": -105.73184,
    "difficulty": "moderate",
    "notes": "Scenic pass separating Platte and South Park drainages."
  }
]
```

---

## 5. `milestones.json`
Checkpoints and town jump targets for the milestone switcher.

```json
[
  {
    "name": "Denver (Waterton Canyon), CO",
    "mile": 0.0,
    "km": 0.0,
    "elevation": 1675,
    "state": "CO"
  },
  {
    "name": "Breckenridge, CO",
    "mile": 108.5,
    "km": 174.6,
    "elevation": 2926,
    "state": "CO"
  }
]
```

---

## 6. `places.json`
POIs and resupply resources along the route.

```json
[
  {
    "id": "town_denver",
    "name": "Waterton Canyon Trailhead",
    "category": "town",
    "type": "town",
    "town": "Waterton Canyon",
    "is_in_town": true,
    "location": {
      "lat": 39.4909,
      "lon": -105.0942
    },
    "distance_to_trail_km": 0.0,
    "route_km": 0.0,
    "route_mile": 0.0,
    "address": "Waterton Canyon, Littleton, CO",
    "google_maps_url": "https://maps.google.com/?...",
    "business_status": "OPERATIONAL"
  }
]
```
**Valid Categories:**
`town`, `campground`, `hotel`, `grocery`, `restaurant`, `bike`, `water`, `laundry`, `services`

---

## 7. Route Manifest: `public/data/routes.json`

```json
{
  "version": 1,
  "routes": [
    {
      "id": "colorado-trail",
      "name": "The Colorado Trail",
      "shortName": "Colorado Trail",
      "badge": "CT",
      "startLocation": "Denver, CO",
      "endLocation": "Durango, CO",
      "startPoint": "Denver, CO",
      "endPoint": "Durango, CO",
      "totalDistanceMiles": 514.7,
      "totalDistanceKm": 828.4,
      "distanceMiles": 514.7,
      "distanceKm": 828.4,
      "elevationGainFt": 83143,
      "elevationGainM": 25342,
      "elevationGainFeet": 83143,
      "elevationGainMeters": 25342,
      "highestElevationFeet": 13258,
      "highestElevationMeters": 4041,
      "highestPoint": "Coney Summit (13,258 ft)",
      "iconicPass": "Coney Summit (13,258 ft)",
      "iconicCheckpoints": [
        "Waterton Canyon Trailhead",
        "Georgia Pass",
        "Breckenridge",
        "Durango Trailhead"
      ],
      "description": "A breathtaking 515-mile high-altitude backcountry singletrack trail traversing the Colorado Rockies.",
      "startCoordinates": [39.4909, -105.0942],
      "bounds": [
        [37.3314, -108.0387],
        [39.5516, -105.0942]
      ],
      "dataPath": "/data/routes/colorado-trail"
    }
  ]
}
```
