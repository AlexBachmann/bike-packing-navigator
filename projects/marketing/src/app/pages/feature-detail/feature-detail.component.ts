import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { SeoService } from '../../services/seo.service';

export interface EquationItem {
  name: string;
  formula: string;
  notes: string;
}

export interface FeaturePillarDetail {
  slug: string;
  title: string;
  pillarNumber: number;
  tagline: string;
  headerHook: string;
  badge: string;
  badgeColor: string;
  summary: string;
  hasVideo: boolean;
  videoWebm?: string;
  videoMp4?: string;
  desktopImg: string;
  mobileImg: string;
  imgAlt: string;
  diagramType:
    | 'power-balance'
    | 'wind-vectors'
    | 'metabolic-bars'
    | 'water-hierarchy'
    | 'climb-profile'
    | 'vector-pmtiles'
    | 'privacy-sovereignty';
  equations: EquationItem[];
  architectureSections: { title: string; body: string }[];
  keyCapabilities: string[];
  technicalHighlights: string[];
  prevSlug: string;
  prevTitle: string;
  nextSlug: string;
  nextTitle: string;
}

const FEATURE_DATA: Record<string, FeaturePillarDetail> = {
  'eta-modeling': {
    slug: 'eta-modeling',
    pillarNumber: 1,
    title: 'Physics-Based Dynamic ETA Modeling',
    tagline: 'Predicting real-world mountain velocity with Newtonian power balance.',
    headerHook: 'Ditch Naive Average Speeds. Navigate with Real-World Cycling Physics.',
    badge: '12-Iteration Newton-Raphson Solver',
    badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
    summary:
      'Traditional GPS cycling units assume flat asphalt and constant speeds. In remote mountains, loaded bikepacking rigs fluctuate between 3 km/h on steep scree and 45 km/h on descents. Bikepack Navigator computes duration over 50-meter microsegments using empirical physics, rolling resistance coefficients, and hike-a-bike transitions.',
    hasVideo: true,
    videoWebm: 'assets/videos/cockpit-loop.webm',
    videoMp4: 'assets/videos/cockpit-loop.mp4',
    desktopImg: 'assets/images/screenshot-cockpit-desktop.webp',
    mobileImg: 'assets/images/screenshot-cockpit-mobile.webp',
    imgAlt: 'Live Ride Cockpit on Tour Divide Mile 150 Fernie BC',
    diagramType: 'power-balance',
    equations: [
      {
        name: 'Newton-Raphson Cubic Power Equilibrium',
        formula: '½ ρ CdA v³ + m g (sin θ + Crr cos θ) v - η P = 0',
        notes:
          'Solved iteratively in 12 Newton-Raphson steps to < 10⁻⁵ m/s precision. Calibrated for high-altitude air density (ρ = 1.08 kg/m³ at 2,000m), drivetrain efficiency (η = 0.96), bikepacking frontal drag (CdA = 0.48 m²), and loaded rig mass m.',
      },
      {
        name: 'OSM Surface Rolling Resistance (Crr)',
        formula: 'Crr = Crr_base × Tracktype_Multiplier + Singletrack_Penalty',
        notes:
          'Asphalt (0.0055), Hardpack gravel (0.0100), Loose gravel (0.0160), Dirt (0.0220), Rock/Scree (0.0380), Sand/Mud (0.0600). Multipliers range from grade1 (1.00x) to grade5 (2.30x). Singletrack path adds +0.005.',
      },
      {
        name: 'Hike-a-Bike Velocity Transition',
        formula: 'v_hike = v_base · [1 / (1 + 5.0 · grade)] · firmness · (85.0 / max(40, m))^0.25',
        notes:
          'When gradient exceeds sustained wattage limits, riders transition to foot travel. At 20% slope, hiking velocity drops by 50%. Heavy rigs suffer exponential pushing penalties.',
      },
      {
        name: 'Descent Roughness Ceiling',
        formula: 'v_terminal = min(√( |B| / A ), Surface_Speed_Cap)',
        notes:
          'Terminal downhill velocity is strictly clamped by surface roughness: Paved 60 km/h, Hardpack 42 km/h, Gravel 32 km/h, Rough singletrack 22 km/h.',
      },
    ],
    architectureSections: [
      {
        title: '50-Meter Microsegmentation',
        body: 'Routes are decomposed into discrete 50-meter chunks (STEP_METERS = 50). Each segment inherits exact slope grade from Copernicus 30m DEM, surface tags from OpenStreetMap, and localized wind vectors from hourly atmospheric models.',
      },
      {
        title: '3-Tier Pacing State Machine',
        body: 'The engine supports speed and power modes. In power mode, steady endurance wattage surges up to +25% on steep pitches for up to 15 minutes before enforcing a 15-minute cooloff period, preventing unrealistic anaerobic sustained pacing.',
      },
      {
        title: 'Asynchronous Chunking for Ultra-Routes',
        body: 'The 4,312 km Tour Divide comprises over 86,000 microsegments. Simulation executes in non-blocking 10,000-step chunks yielding to the browser event loop, allowing instant UI response and O(log N) binary search queries.',
      },
    ],
    keyCapabilities: [
      'Accurate time-in-saddle forecasts accounting for 40kg loaded rig weight',
      'Automatic transition to hike-a-bike on brutal grades > 14%',
      'Downhill speed braking limits based on rough scree and loose gravel',
      'Non-blocking simulation processing 4,300+ km in under 200 milliseconds',
    ],
    technicalHighlights: [
      'Newton-Raphson derivative f’(v) = 1.5 ρ CdA v² + m g (sin θ + Crr cos θ)',
      'High-altitude alpine air density calibrated for Rocky Mountain passes',
      'Logarithmic binary search over cached cumulative time arrays',
    ],
    prevSlug: 'open-source',
    prevTitle: '7. Open-Source Philosophy',
    nextSlug: 'weather-hazards',
    nextTitle: '2. Trail Weather & Hazards',
  },
  'weather-hazards': {
    slug: 'weather-hazards',
    pillarNumber: 2,
    title: 'Predictive Trail Weather & Hazard Intelligence',
    tagline: 'Forecasting weather along your forward trajectory, not where you stand today.',
    headerHook: 'Know the Weather Tomorrow at the Summit, Not Just Today in Town.',
    badge: 'Chronological Trajectory Vector Projection',
    badgeColor: 'border-cyan-500/30 text-cyan-400 bg-cyan-950/40',
    summary:
      'Standard weather widgets display conditions right now at your current GPS fix. Bikepack Navigator projects future atmospheric conditions at the exact time of arrival along your forward trail trajectory, decomposing wind vectors and detecting severe mountain storm windows.',
    hasVideo: true,
    videoWebm: 'assets/videos/elevation-loop.webm',
    videoMp4: 'assets/videos/elevation-loop.mp4',
    desktopImg: 'assets/images/screenshot-elevation-desktop.webp',
    mobileImg: 'assets/images/screenshot-elevation-mobile.webp',
    imgAlt: 'Elevation Profile with Climb Weather on Tour Divide',
    diagramType: 'wind-vectors',
    equations: [
      {
        name: 'Trajectory Time Matching',
        formula: 'T_arrival = T_now + ETA_seconds(Mile_target)',
        notes:
          'Arrival timestamp computed from the cycling physics engine. Atmospheric variables are sampled from 48-hour hourly forecast curves at T_arrival.',
      },
      {
        name: 'Relative Headwind & Tailwind Decomposition',
        formula: 'V_headwind = V_wind · cos((θ_wind - θ_travel + 540) % 360 - 180)',
        notes:
          'Meteorological wind bearing is resolved against spherical track bearing. When headwind exceeds 20 km/h, aerodynamic drag alerts warn of pacing penalties.',
      },
      {
        name: 'Crosswind Steering Shear',
        formula: 'V_crosswind = |V_wind · sin((θ_wind - θ_travel + 540) % 360 - 180)|',
        notes:
          'Evaluates crosswind gusts capable of destabilizing loaded bikepacking rigs with deep-section rims or bulky frame packs.',
      },
      {
        name: 'High-Altitude Pass Lapse Rate',
        formula: 'T_summit = T_base - 0.0065 · (Elev_summit - Elev_base)',
        notes:
          'Models the standard 6.5°C per 1,000m adiabatic temperature lapse rate on alpine passes, highlighting freezing precipitation risk.',
      },
    ],
    architectureSections: [
      {
        title: '5-Tier Hazard Alert Hierarchy',
        body: 'The forward 2-hour travel window is continuously evaluated: Tier 1 Severe Thunderstorms (WMO 95/96/99) take top priority, followed by Tier 2 Peanut-Butter Mud, Tier 3 Opposing Headwinds (≥20 km/h), Tier 4 Assisting Tailwinds, and Tier 5 Benign conditions.',
      },
      {
        title: 'Soil-Specific Mud Hazard Modeling',
        body: 'Cross-references precipitation rates (≥0.8 mm/h) with OpenStreetMap soil classifications. Identifies bentonite clay, unpaved tracks, and grade4/5 soil that turn into drivetrain-snapping mud.',
      },
      {
        title: 'Summit Lightning Windows',
        body: 'Mountain passes are scanned at 1km intervals from base to crest. Highlights convective thunderstorm windows to help riders decide whether to push over the pass before noon or camp safely below tree line.',
      },
    ],
    keyCapabilities: [
      'Chronological trajectory matching instead of static current weather',
      'Wind vector decomposition relative to your precise trail heading',
      'Peanut-butter mud detection to protect derailleur hangers from failure',
      'Summit lightning storm warnings for high Rocky Mountain passes',
    ],
    technicalHighlights: [
      'Spherical forward azimuth calculation for microsegment bearings',
      '48-hour hourly weather curves cached in IndexedDB for offline access',
      'Dynamic WMO code classification into severe convective triggers',
    ],
    prevSlug: 'eta-modeling',
    prevTitle: '1. Physics ETA Modeling',
    nextSlug: 'resupply-nutrition',
    nextTitle: '3. Resupply & Nutrition',
  },
  'resupply-nutrition': {
    slug: 'resupply-nutrition',
    pillarNumber: 3,
    title: 'Resupply & Nutrition Intelligence',
    tagline: 'Clinical metabolic modeling and backcountry carrying calculations.',
    headerHook: 'Survive the Gaps. Eliminate Bonking with Precision Metabolic Resupply.',
    badge: 'Clinical BMR + Mechanical Efficiency',
    badgeColor: 'border-amber-500/30 text-amber-400 bg-amber-950/40',
    summary:
      'Endurance bikepackers burning 5,000–8,000 kcal/day face catastrophic failure if they bonk in remote passes or haul unnecessary deadweight. Bikepack Navigator models real metabolic work at 24% human gross efficiency alongside clinical Mifflin-St Jeor BMR and generates aisle-by-aisle grocery checklists.',
    hasVideo: false,
    desktopImg: 'assets/images/screenshot-resupply-desktop.webp',
    mobileImg: 'assets/images/screenshot-resupply-mobile.webp',
    imgAlt: 'Resupply Planner and Nutrition Calculator',
    diagramType: 'metabolic-bars',
    equations: [
      {
        name: 'Active Mechanical Energy Expenditure',
        formula: 'kcal_active = (Watts × Duration_sec) / (η_mech × 4184)',
        notes:
          'Based on clinical cycling physiology with human gross mechanical efficiency η_mech = 0.24 (24%). 1 kilocalorie equals 4,184 Joules.',
      },
      {
        name: 'Clinical Mifflin-St Jeor BMR',
        formula: 'BMR_day = 10 · weight_kg + 6.25 · height_cm - 5 · age_years + sexOffset',
        notes:
          'Calculates basal metabolic rate where sexOffset is +5 for males and -161 for females. Inactive camp time models 1.0x BMR during sleep and 1.25x during camp tasks.',
      },
      {
        name: 'Hydration Requirements',
        formula: 'Hydration = 650 ml/h (on-bike) + 125 ml/h (awake off-bike)',
        notes:
          'Ensures baseline fluid intake across fluctuating high-altitude desert and alpine temperatures.',
      },
      {
        name: 'Electrolyte Intake Targets',
        formula: 'Na+: 600 mg/h | K+: 200 mg/h | Mg2+: 40 mg/h (riding)',
        notes:
          'Maintains physiological neuromuscular function and prevents debilitating leg cramps under multi-day loaded strain.',
      },
    ],
    architectureSections: [
      {
        title: 'Multi-Day Schedule Simulation',
        body: 'Simulates elapsed transit days to the next resupply town based on active riding hours (default 60% of waking day), a 6-hour sleep block, and 1-hour camp setup. Travel past 21:00 automatically schedules overnight camp sleep blocks.',
      },
      {
        title: '18 Field-Tested Backcountry Recipes',
        body: 'Built-in library of high-calorie, packable meals including Trail Pad Thai (ramen + tuna + peanut butter, 660 kcal), Double Burgers (620 kcal), Avocado Wraps, Pringles (840 kcal), and Chocolate Milk (optimal 4:1 carb-to-protein recovery ratio).',
      },
      {
        title: 'Department-Grouped Grocery Aggregator',
        body: 'Consolidates ingredients across all scheduled meals into a categorized shopping list (Produce, Bakery, Canned/Protein, Snacks/Candy, Beverages, Dairy) with interactive checkboxes for fast town supermarket resupply.',
      },
    ],
    keyCapabilities: [
      'Accurate daily caloric targets based on elevation climbing and rig weight',
      'Aisle-grouped supermarket shopping list for exhausted brain navigation',
      'Consumable weight tracking to monitor pack weight as food is eaten',
      'Custom recipe creator modal with macronutrient and ingredient controls',
    ],
    technicalHighlights: [
      'Clinical Mifflin-St Jeor formula validated against sports nutrition literature',
      '24% gross mechanical efficiency conversion from mechanical bicycle work',
      'Zero cloud dependency: all nutrition data stored locally in browser storage',
    ],
    prevSlug: 'weather-hazards',
    prevTitle: '2. Trail Weather & Hazards',
    nextSlug: 'waypoint-water',
    nextTitle: '4. Water Intelligence',
  },
  'waypoint-water': {
    slug: 'waypoint-water',
    pillarNumber: 4,
    title: 'Enriched Waypoint & Water Intelligence',
    tagline: '4-tier water reliability categorization and heads-up proximity countdown alerts.',
    headerHook: 'Reliable Water in Arid Basins. Zero Guesswork.',
    badge: '4-Tier Water Reliability & 1-Mile Lookahead',
    badgeColor: 'border-blue-500/30 text-blue-400 bg-blue-950/40',
    summary:
      'In arid expanses like the Great Divide Basin or southern Arizona, running out of water is life-threatening. Bikepack Navigator classifies sources by reliability, alerts to dry gaps over 30km, deduplicates overlapping waypoints within 200m, and provides glanceable heads-up countdown alerts.',
    hasVideo: false,
    desktopImg: 'assets/images/screenshot-waypoints-desktop.webp',
    mobileImg: 'assets/images/screenshot-waypoints-mobile.webp',
    imgAlt: 'Enriched Water and Waypoint Intelligence Filters',
    diagramType: 'water-hierarchy',
    equations: [
      {
        name: '4-Tier Water Classification Hierarchy',
        formula: 'Tier 1 (Potable Tap) > Tier 2 (Spring) > Tier 3 (Stream) > Tier 4 (Reservoir)',
        notes:
          'Tier 1: Municipal taps (no treatment, reliable). Tier 2: Natural springs (treatment, reliable). Tier 3: Flowing streams (treatment required). Tier 4: Standing stock tanks (emergency/seasonal only).',
      },
      {
        name: 'Spatial Deduplication Filter',
        formula: 'Distance(POI_A, POI_B) < 200m ⇒ Merge into Max_Quality(Tier)',
        notes:
          'Overlapping water features within 200m are consolidated, retaining the highest quality verified source and discarding muddy ditches adjacent to municipal taps.',
      },
      {
        name: 'Density Throttling & Crowding Gate',
        formula: 'Max 1 POI per 5km Segment with 3.75km Anti-Crowding Buffer',
        notes:
          'Prevents cockpit map clutter while guaranteeing that sparse desert basin water sources are 100% preserved.',
      },
      {
        name: 'Cockpit Proximity Lookahead Gate',
        formula: 'Lookahead_water = min_distance(upcoming > 1.0 mi in [water, camp, store])',
        notes:
          'Filters out waypoints ≤ 1.0 mile ahead to prevent redundant alerts, computing route distance to the next upcoming resupply stop.',
      },
    ],
    architectureSections: [
      {
        title: 'Dry Carry Gap Analysis (>30km)',
        body: 'The route progression is scanned ahead of the rider. If the distance between verified water waypoints exceeds 30 kilometers, an amber dry carry warning is displayed, prompting the rider to fill all hydration bladders.',
      },
      {
        title: 'Heads-Up Proximity Countdown Alerts',
        body: 'Alerts appear in the top-left cockpit when approaching within 1,000 meters and dismiss 25 meters past the waypoint. Distance counts down in glanceable chunks: 1k, 750m, 500m, 250m, 100m, 50m, 25m, here.',
      },
      {
        title: 'Strict Provenance Verification Gate',
        body: 'Every water waypoint requires verified origin attributes (OSM node ID, agency record, or field survey). Synthetic or interpolated coordinates are strictly prohibited by the data ingestion pipeline.',
      },
    ],
    keyCapabilities: [
      '4-tier water classification for immediate treatment decisions',
      'Dry carry warnings when next water is over 30 kilometers away',
      'Cockpit proximity alerts prioritizing water and campsites over commercial stops',
      'Dual metric/imperial unit adaptation with automatic rounding',
    ],
    technicalHighlights: [
      '200m spatial deduplication along the route line referencing track progression',
      'Concurrency limit of 2 simultaneous HUD alerts with strict type deduplication',
      'Lookahead gating to nearest upcoming stop among water, camp, gas, or town',
    ],
    prevSlug: 'resupply-nutrition',
    prevTitle: '3. Resupply & Nutrition',
    nextSlug: 'climb-analytics',
    nextTitle: '5. Climb & Pass Analytics',
  },
  'climb-analytics': {
    slug: 'climb-analytics',
    pillarNumber: 5,
    title: 'Climb & Pass Analytics',
    tagline: 'High-resolution Copernicus 30m DEM profiles and summit weather windows.',
    headerHook: 'Master the Mountain Passes. High-Resolution Elevation Analytics.',
    badge: 'Copernicus 30m Global DEM',
    badgeColor: 'border-orange-500/30 text-orange-400 bg-orange-950/40',
    summary:
      'Barometric altimeters drift with changing storm pressure, introducing hundreds of meters of elevation error. Bikepack Navigator calculates elevation from the Copernicus GLO-30 Digital Elevation Model, rendering slope gradient color spectra, dynamic SVG mini-profiles, and summit storm pins.',
    hasVideo: true,
    videoWebm: 'assets/videos/elevation-loop.webm',
    videoMp4: 'assets/videos/elevation-loop.mp4',
    desktopImg: 'assets/images/screenshot-elevation-desktop.webp',
    mobileImg: 'assets/images/screenshot-elevation-mobile.webp',
    imgAlt: 'Elevation Profile and Climb Analytics with Gradient Bands',
    diagramType: 'climb-profile',
    equations: [
      {
        name: 'Slope Gradient Calculation',
        formula: 'Grade = (ΔElevation / ΔDistance) × 100% over 50m intervals',
        notes:
          'Continuous 50m microsegments remove sensor noise and provide smooth, realistic gradient calculations.',
      },
      {
        name: 'Slope Gradient Color Spectrum',
        formula: '<4% Emerald | 4-8% Amber | 8-12% Orange | >12% Crimson | <-4% Cyan',
        notes:
          'Standardized color legend across full profiles, climb cards, and cockpit mini-widgets for glanceable grade comprehension.',
      },
      {
        name: 'Dynamic SVG Geometry Scaling',
        formula: 'Width = clamp(150px - (grade - 3%) × 10px, 70px, 150px)',
        notes:
          'Gentle rolling climbs expand to 150px width; steep mountain walls contract to 70px so the visual slope rises sharply.',
      },
      {
        name: 'Crest Shoulder Geometry',
        formula: 'Crest_Buffer = 10% - 15% post-summit distance',
        notes:
          'Adds a post-summit buffer to visually crown mountain passes and confirm that the rider has crested the summit.',
      },
    ],
    architectureSections: [
      {
        title: 'Copernicus GLO-30 DEM Integration',
        body: 'Replaces noisy barometric tracks with 30-meter satellite digital elevation models. Eliminates altimeter recalibration errors and barometric weather drift when major storm fronts move through.',
      },
      {
        title: 'Summit Lightning Hazard Pins',
        body: 'Marks the exact kilometer along the pass where afternoon convective thunderstorms are projected, allowing riders to time their ascent before alpine lightning windows open.',
      },
      {
        title: 'Hike-a-Bike Breakdown',
        body: 'Displays estimated hike-a-bike distance (km/mi) and time alongside total estimated climb duration, calculating the physical cost of pushing a 40kg rig up steep scree.',
      },
    ],
    keyCapabilities: [
      'Interactive elevation profile scrubbing with cursor tracking and mile markers',
      'Pass summit ETA calculation to plan daylight arrival on alpine crests',
      'Slope gradient color bands (<4% green, 4-8% yellow, 8-12% orange, >12% red)',
      'Window filter modes: next 10, next 25, next 50, next 100 miles, and full route',
    ],
    technicalHighlights: [
      'Dynamic SVG mini-profile rendering optimized for low CPU usage on mobile',
      'Elimination of spurious GPS elevation spikes via Savitzky-Golay smoothing',
      'Live rider location dot tracking current position on climb slopes',
    ],
    prevSlug: 'waypoint-water',
    prevTitle: '4. Water Intelligence',
    nextSlug: 'offline-mapping',
    nextTitle: '6. Offline Vector Maps',
  },
  'offline-mapping': {
    slug: 'offline-mapping',
    pillarNumber: 6,
    title: 'Offline Vector Mapping & Navigation',
    tagline: 'Fast, smooth, battery-efficient vector cartography completely offline.',
    headerHook: 'True Offline Freedom. Complete Vector Mapping in Your Pocket.',
    badge: 'PMTiles + MapLibre GL 60fps',
    badgeColor: 'border-teal-500/30 text-teal-400 bg-teal-950/40',
    summary:
      'Raster tiles require downloading millions of fragile image files that fail to load in backcountry canyons. Bikepack Navigator uses PMTiles Hilbert-indexed single-file vector archives stored in browser IndexedDB for fluid 60fps cartography without cell reception.',
    hasVideo: true,
    videoWebm: 'assets/videos/map-loop.webm',
    videoMp4: 'assets/videos/map-loop.mp4',
    desktopImg: 'assets/images/screenshot-map-desktop.webp',
    mobileImg: 'assets/images/screenshot-map-mobile.webp',
    imgAlt: 'Offline Vector Mapping with PMTiles and MapLibre GL',
    diagramType: 'vector-pmtiles',
    equations: [
      {
        name: 'Hilbert Curve Space-Filling Indexing',
        formula: 'Tile_Index = hilbert_2d(x, y, zoom) via PMTiles Range Requests',
        notes:
          'Enables byte-range lookups directly within a single archive file stored in IndexedDB with zero server round-trips.',
      },
      {
        name: '60fps Dead-Reckoning Extrapolation',
        formula: 'Pos(t) = Pos_last + v_last · Δt along Track_Polyline',
        notes:
          'When GPS fixes drop out in mountain canyons, a continuous requestAnimationFrame loop advances the rider smoothly. Decays gracefully after 4 seconds.',
      },
      {
        name: 'Switchback Turn Filter',
        formula: 'Turn_Cue = (Branches(Node) ≥ 3) ∧ (|ΔHeading| ≥ 45°)',
        notes:
          'Suppresses false turn alerts on hairpin switchbacks by requiring at least 3 radiating branches from an OpenStreetMap decision node.',
      },
      {
        name: 'Jitter Suppression Window',
        formula: 'Suppress = (ΔDistance < 0) ∧ (|ΔDistance| < 80m)',
        notes:
          'Filters backward jumps caused by GPS multi-path signal bounce in steep mountain canyons.',
      },
    ],
    architectureSections: [
      {
        title: 'Single-File PMTiles Vector Archives',
        body: 'Replaces millions of loose PNG/PBF raster tiles with compact single-file archives. An entire 4,300km trail corridor (18km width) downloads cleanly and lives in IndexedDB with zero quota corruption.',
      },
      {
        title: 'Composite Multi-Section Route Stitching',
        body: 'Huge ultra-distance trails spanning multiple states (e.g. Canada, Montana, Wyoming, Colorado, New Mexico) are split into regional archives and stitched seamlessly by CompositePMTiles without border seams.',
      },
      {
        title: 'Handlebar Screen Wake Lock',
        body: 'Utilizes the Screen Wake Lock API to prevent mobile displays from turning off while mounted to handlebars, keeping telemetry visible during fast descents.',
      },
    ],
    keyCapabilities: [
      '100% offline vector cartography with contour lines and trail markings',
      '60fps dead-reckoning cockpit during mountain canyon GPS blackouts',
      'Switchback filtering eliminating annoying false turn alerts on trail curves',
      'One-click route corridor downloader with IndexedDB storage management',
    ],
    technicalHighlights: [
      'MapLibre GL JS engine running custom pmtiles:// protocol via Service Worker',
      'Zero dependency on Google Maps, Mapbox, or proprietary subscription servers',
      'High-contrast outdoor topo vector styling optimized for sunlight readability',
    ],
    prevSlug: 'climb-analytics',
    prevTitle: '5. Climb & Pass Analytics',
    nextSlug: 'open-source',
    nextTitle: '7. Open-Source Philosophy',
  },
  'open-source': {
    slug: 'open-source',
    pillarNumber: 7,
    title: 'Open-Source Philosophy & Community Trust',
    tagline: '100% Free, MIT Licensed, with Zero Telemetry and Offline-First Privacy.',
    headerHook: 'Built for Athletes, Not Venture Capital. 100% Free and Private.',
    badge: '100% Free & Open Source (MIT)',
    badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
    summary:
      'All calculations, route data, maps, and nutrition plans execute strictly on the client. No accounts, no passwords, no subscription paywalls, and zero tracking pixels. Your location, routes, and physiological metrics belong entirely to you.',
    hasVideo: false,
    desktopImg: 'assets/images/og-preview.jpg',
    mobileImg: 'assets/images/og-preview.jpg',
    imgAlt: 'Open-Source Philosophy and Data Sovereignty',
    diagramType: 'privacy-sovereignty',
    equations: [
      {
        name: 'Client-Side Data Sovereignty',
        formula: 'Backend_Servers = 0 | User_Accounts = 0 | Tracking_Pixels = 0',
        notes:
          'All settings, custom recipes, downloaded maps, and GPX files remain in browser local storage and IndexedDB. Nothing is transmitted to external telemetry servers.',
      },
      {
        name: 'MIT Open-Source License',
        formula: 'Permission is hereby granted, free of charge, to any person...',
        notes:
          'Guarantees freedom to use, modify, audit, fork, and distribute the application for personal, athletic, or event organization purposes.',
      },
      {
        name: 'Offline-First Service Worker Architecture',
        formula: 'Cache_First(Static_Shell) + IndexedDB(Vector_Tiles)',
        notes:
          'Ensures the application loads and functions reliably with zero cellular reception anywhere on earth.',
      },
      {
        name: 'Open GIS Ingestion Pipeline',
        formula: 'python3 -m engine.cli.main ingest <route.gpx> --dem --water --corridor 18',
        notes:
          'Enables any cyclist to ingest GPX files, calculate DEM contours, extract OSM POIs, and register custom routes.',
      },
    ],
    architectureSections: [
      {
        title: 'Zero Accounts, Zero Subscriptions',
        body: 'No email harvesting, no credit cards, no login gates. Start the app and immediately navigate. You will never encounter a paywall mid-expedition.',
      },
      {
        title: 'Zero Telemetry & Location Privacy',
        body: 'The app never records or uploads your GPS track logs. Optional anonymous telemetry strips all exact coordinates, respects Do-Not-Track (DNT), and can be toggled off completely in Settings.',
      },
      {
        title: 'Community Route Contributions',
        body: 'Built-in open Python GIS pipeline allows cyclists, race directors, and route creators to generate DEM contours, extract OSM water waypoints, and publish custom routes under MIT.',
      },
    ],
    keyCapabilities: [
      '100% Free under the permissive MIT license for everyone',
      'No annual recurring subscriptions ($60–$100 saved per year)',
      'Direct GPX and JSON route package export and import on device',
      'Community-driven development with public GitHub repository',
    ],
    technicalHighlights: [
      'Client-side static site generation (SSG) with zero backend vulnerability surface',
      'Auditable source code with comprehensive automated unit test coverage',
      'Decoupled architecture: zero proprietary vendor lock-in',
    ],
    prevSlug: 'offline-mapping',
    prevTitle: '6. Offline Vector Maps',
    nextSlug: 'eta-modeling',
    nextTitle: '1. Physics ETA Modeling',
  },
};

@Component({
  selector: 'app-feature-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './feature-detail.component.html',
})
export class FeatureDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private seoService = inject(SeoService);

  readonly pwaUrl = '/bike-packing-navigator/';
  detail: FeaturePillarDetail | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug') || this.route.snapshot.data['slug'] || 'eta-modeling';
      this.loadDetail(slug);
    });
  }

  private loadDetail(slug: string): void {
    this.detail = FEATURE_DATA[slug] || FEATURE_DATA['eta-modeling'];
    if (this.detail) {
      this.seoService.setMeta({
        title: `${this.detail.title}`,
        description: `${this.detail.tagline} ${this.detail.summary.slice(0, 140)}...`,
        urlPath: `features/${this.detail.slug}`,
        imageUrl: `https://alexbachmann.github.io/bike-packing-navigator/welcome/${this.detail.desktopImg}`,
      });
    }
  }
}
