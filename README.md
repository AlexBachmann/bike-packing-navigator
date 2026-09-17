# 🚴 Bike Packing Navigator

> **Live Trail Companion for Endurance Bikepackers**  
> *Offline-first GPS navigation, physics-based ETAs, time-matched weather hazards, and precision resupply nutrition.*

[![Angular](https://img.shields.io/badge/Angular-21.2-dd0031.svg?style=flat-square&logo=angular)](https://angular.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-38bdf8.svg?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-648%20passing-brightgreen.svg?style=flat-square)](https://vitest.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-blueviolet.svg?style=flat-square)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

---

## 🌟 Use the App Now (No Setup Required!)

You do **not** need to clone the repository or configure development tools to use Bike Packing Navigator. The application is hosted as a high-performance Progressive Web App directly on GitHub Pages:

### 🚀 **[Launch Bike Packing Navigator](https://alexbachmann.github.io/bike-packing-navigator/)**

- **Runs in Any Modern Browser**: Works immediately on your smartphone (iPhone / Android) or laptop.
- **Continuously Updated**: Automatically loads the latest features, route enhancements, and offline capabilities with every release.
- **Zero Cost & Zero Registration**: No accounts, no subscriptions, no tracking, and no paywalls.

---

## 🎯 Key USPs (Why Bike Packing Navigator?)

When you are 80 miles into the backcountry without cell service, generic cycling apps fall short. Bike Packing Navigator was engineered specifically for self-supported endurance athletes:

### 1. 100% Free & Fully Offline
- **Zero Cellular Connection Needed**: Pre-cache full route packages, vector waypoints, elevation profiles, and map tiles directly to your device.
- **No Subscriptions or Paywalls**: Complete access to all features, routing data, and physics models for free.

### 2. Physics-Based Arrival Time Predictions (ETAs)
- Instead of using a naive flat average speed (e.g. 15 km/h), the app models your progress segment-by-segment using empirical cycling physics:
  - **Total Rig Weight**: Calculates the gravitational resistance of your rider body mass + bike weight + luggage/gear payload.
  - **Rider Power (Watts)**: Simulates speed based on your sustainable endurance wattage.
  - **Aerodynamic Drag ($C_d A$)**: Tailored for loaded bikepacking setups with handlebar rolls, frame bags, and panniers.
  - **Surface Rolling Resistance ($C_{rr}$)**: Dynamically adjusts resistance for paved asphalt, smooth gravel, washboard dirt, and rocky backcountry singletrack.
  - **Hike-a-Bike Detection**: Detects steep grades where loaded riding is physically impossible and automatically transitions to realistic walking/pushing speeds.

### 3. Chronologically Time-Matched Weather Intelligence
- While traditional apps show weather for *right now*, Bike Packing Navigator queries [Open-Meteo](https://open-meteo.com/) hourly forecasts and matches each trail milestone with your **projected arrival time at that specific location**.
- Know what the temperature, wind direction, and precipitation will be when you summit a 12,000 ft pass *tomorrow afternoon*, not when you leave camp in the morning.

### 4. Backcountry Weather Hazard Alerts
- ⚡ **Severe Thunderstorm Warnings**: Predicts lightning risk on high-elevation passes and exposed ridges during peak afternoon convective hours.
- 💨 **Directional Headwind Alerts**: Compares route bearing against forecast wind vectors, warning you when a 30 km/h wall of wind will oppose your travel.
- ⚠️ **Peanut Butter Mud Warnings**: Cross-references forecast precipitation with OpenStreetMap unpaved dirt surface classifications to warn you before entering infamous clay and mud traps that lock wheels and snap derailleurs.

### 5. Nutrition & Caloric Burn Calculations
- Accurately models active caloric burn from wattage output combined with your clinical Basal Metabolic Rate (BMR).
- Calculates the total caloric requirement for the exact duration and terrain between you and your next resupply town.

### 6. Meal Planning & Smart Shopping Lists
- Built-in backcountry recipes (ramen bombs, instant potatoes with bacon, nut-butter wraps, oatmeal power bowls) plus the ability to create your own custom meals.
- Automatically generates a consolidated, aisle-by-aisle grocery shopping list scaled to your calculated caloric deficit for the upcoming section.

---

## 📱 Why Install It on Your Phone as a PWA?

Bike Packing Navigator is designed as a **Progressive Web App (PWA)**. While it runs smoothly in a desktop browser, installing it directly onto your smartphone's home screen provides crucial trail advantages:

1. **Screen Keep-Awake (Handlebar Mode)**:
   - Uses the modern Screen Wake Lock API to prevent your phone display from turning off or sleeping while mounted on your bike cockpit, keeping live navigation, mile markers, and elevation cues always in view.
2. **Permanent Offline Storage**:
   - Standard browser tabs on iOS Safari are subject to a 7-day cache eviction policy if unvisited. When installed as a standalone PWA on your home screen, iOS and Android grant persistent storage quotas, preserving your downloaded map tiles, route data, and offline caches indefinitely.
3. **Immersive Fullscreen UI**:
   - Removes browser address bars, navigation tabs, and system chrome for an unobstructed, tactile native app experience.

### How to Install:
- **iPhone / iPad (Safari)**: Tap the **Share** button (box with arrow) ➔ Scroll down and tap **Add to Home Screen** ➔ Tap **Add**.
- **Android (Chrome)**: Tap the **Three Dots (⋮)** menu ➔ Tap **Install App** (or **Add to Home screen**).

---

## 🧠 How the App Works Under the Hood

```
   ┌─────────────────────────────────────────────────────────────┐
   │                   Raw Open Data Ingestion                   │
   └───────┬──────────────────────┬──────────────────────┬───────┘
           │                      │                      │
           ▼                      ▼                      ▼
  OpenStreetMap (OSM)      Copernicus DEM (GLO-30)   Wikipedia / Trail
  - Highway classification - AWS Open Data 30m DEM   - Pass history
  - Surface & track types  - Elevation contours      - Regional parks
  - Backcountry POIs       - Hillshade rendering     - Mountain peaks
           │                      │                      │
           └──────────────────────┼──────────────────────┘
                                  ▼
           ┌──────────────────────────────────────────────┐
           │        Python GIS Preprocessing Pipeline     │
           │  (Corridor buffer, climb segmentation, POIs) │
           └──────────────────────┬───────────────────────┘
                                  ▼
           ┌──────────────────────────────────────────────┐
           │       Pure Static App Shell & Datasets       │
           │ (JSON telemetry, Zero-backend, Client-side)  │
           └──────────────────────┬───────────────────────┘
                                  ▼
           ┌──────────────────────────────────────────────┐
           │     Client-Side Angular Runtime Engine       │
           │  - EtaPhysicsService (Watts, Rig Mass, Crr)  │
           │  - WeatherService (Open-Meteo + ETA match)   │
           │  - ResupplyPhysicsService (BMR + Nutrients)  │
           │  - Service Worker (Map tile & shell caching) │
           └──────────────────────────────────────────────┘
```

### 1. OpenStreetMap (OSM) Trail & Surface Data
- Using specialized GIS pipelines (`extract_osm_corridor.py`, `generate_route_surfaces.py`), the app constructs an 18 km corridor buffer along the route polyline.
- It parses OSM highway tags (`track`, `path`, `service`, `unclassified`, `tertiary`) and surface attributes (`asphalt`, `compacted`, `gravel`, `dirt`, `ground`, `sand`) to generate contiguous surface intervals used by the physics and mud-detection engines.
- It identifies backcountry points of interest: natural water springs, public campgrounds, shelters, grocery stores, bakeries, bike shops, and laundromats.

### 2. Copernicus 30m DEM (AWS Open Data)
- Elevation profiles are not interpolated from noisy barometric GPX tracks. Instead, the pipeline fetches Copernicus GLO-30 (30-meter resolution) Digital Elevation Models hosted on AWS Open Data (`download_terrain_dem.py`).
- This produces smooth elevation curves, precise grade calculations (50m micro-segments), mountain pass summit elevations, hillshade rasters, and vector contours.

### 3. Open-Meteo Weather Model
- Hyper-local hourly atmospheric data is requested on demand from [Open-Meteo](https://open-meteo.com/).
- The client-side `WeatherService` samples forecast points along the route corridor, computing the rider's arrival time at each point and cross-referencing temperature, wind direction, rain probability, and WMO convective thunderstorm codes.

### 4. Wikipedia Geographic Enrichment
- Generic climb names (e.g. *"Climb at Mile 45.2"*) are enriched via Wikipedia and OSM geographic databases.
- The app links mountain passes with their verified geographic identity, surrounding protected wilderness areas (e.g. *Spray Valley Provincial Park*, *White River National Forest*), prominent landmarks (*Goat Pond*, *Marshall Pass Summit*), and cultural guidebook notes.

### 5. Pure Static Architecture
- All route telemetry, places, climbs, and milestones are packaged as optimized, static JSON files.
- There is **no backend server, no database, and no login system**. Everything runs 100% client-side in the user's browser, maximizing privacy, offline reliability, and battery life.

---

## 🥗 Nutritional & Caloric Calculation Mechanics

Endurance bikepackers burning 5,000–8,000 kcal per day need precise resupply math to prevent "bonking" or carrying excessive food weight.

### The Physics Formulas:
1. **Active Cycling Energy Expenditure**:
   $$\text{kcal}_{\text{active}} = \frac{\text{Watts} \times \text{Duration (seconds)}}{\eta_{\text{mech}} \times 4184}$$
   *Where $\eta_{\text{mech}} = 0.24$ (the physiological gross mechanical efficiency of human muscle).*

2. **Basal Metabolic Rate (BMR)**:
   Calculated using the clinically validated Mifflin-St Jeor equation based on rider body mass:
   $$\text{BMR}_{\text{day}} = 10 \times \text{weight}_{\text{kg}} + 6.25 \times \text{height}_{\text{cm}} - 5 \times \text{age} + \text{sex\_offset}$$

3. **Forward Day Schedule Simulation**:
   The `ResupplyPhysicsService` simulates your days based on:
   - **Riding %**: Fraction of daylight moving vs resting.
   - **Target Sleep**: Hours of sleep desired per night (e.g. 6 hours).
   - **Camp Routine**: Morning breakdown and evening camp setup overhead.
   - Calculates the exact hours and days required to reach the next town.

4. **Meal Planning to Consolidated Shopping List**:
   - You select recipes for breakfast, daytime trail snacks, dinners, and recovery.
   - You can add your own custom recipes with custom calorie, carb, protein, fat, and sodium values.
   - The app aggregates all individual meal components into a unified grocery shopping list (e.g., *"Instant Mashed Potatoes: 4 packets"*, *"Tortillas: 1 pack"*, *"Peanut Butter: 1 jar"*), showing whether your shopping cart meets or exceeds your projected caloric deficit.

---

## 💻 Developer Guide: Local Installation & Setup

If you want to contribute, customize the app, or ingest new routes:

### Option A: Running with Docker Compose (Recommended)

Docker runs the Angular development server and packages all GIS tools (GDAL, Osmium, Python 3, Shapely) in a self-contained container:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/AlexBachmann/bike-packing-navigator.git
   cd bike-packing-navigator
   ```

2. **Start the Docker container**:
   ```bash
   docker compose up -d
   ```

3. **Open the app**:
   Navigate to `http://localhost:4200/` in your browser.

4. **Run tests**:
   ```bash
   docker compose exec -T app npm test
   ```

5. **Build for GitHub Pages**:
   ```bash
   docker compose exec -T app npm run build:gh-pages
   ```

---

### Option B: Running Locally with Node.js & npm

1. **Prerequisites**:
   - [Node.js](https://nodejs.org/) v22 or later
   - npm v10 or later
   - Optional: Python 3.10+ with `shapely`, `pyproj`, `requests`, and `osmium` (only needed for route preprocessing scripts)

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm start
   ```
   Open `http://localhost:4200/`.

4. **Run unit & E2E tests**:
   ```bash
   npm test
   ```

5. **Build for production**:
   ```bash
   npm run build
   ```

---

## 🗺️ Route Ingestion & Ingestion Pipeline

To ingest and enrich any new GPX bikepacking route, use the built-in ingestion skill:

```bash
docker compose exec -T app python3 -m engine.cli.main ingest \
  --gpx "route/<your-route>.gpx" \
  --id "<route-id>" \
  --name "<Full Route Name>" \
  --short-name "<Short Name>" \
  --badge "<BADGE>" \
  --start-location "<Start City, ST>" \
  --end-location "<End City, ST>" \
  --description "<Engaging route description>"
```

The pipeline automatically:
1. Calculates distances and elevations from Copernicus DEM.
2. Extracts an 18 km corridor buffer.
3. Classifies road and trail surface types.
4. Identifies mountain passes and segments climbs.
5. Populates backcountry water and town resupply points.
6. Enriches iconic passes with Wikipedia and OSM intelligence.
7. Registers the route in the application's central route manifest.

---

## 🔮 Future Roadmap

- [x] **Tour Divide 2025** (Banff, AB to Antelope Wells, NM - 2,700+ miles)
- [x] **The Colorado Trail** (Denver to Durango - 535 miles)
- [ ] **Arizona Trail (AZT)** (Utah border to Mexico border - 800 miles)
- [ ] **Western Wildlands Route** (Canada to Mexico via interior West)
- [ ] **European Divides** (Hope 1000, French Divide, Torino-Nice Rally)
- [ ] **Live GPS Beacon Sharing** (Peer-to-peer location sharing with trail companions)
- [ ] **Offline Satellite Basemap Caching**

---

## 📄 License

This project is licensed under the **MIT License** — free for personal, non-commercial, and open-source use.

Happy riding, keep the rubber side down, and see you on the trail! 🚵‍♂️🏕️
