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
    tagline: 'Predicting real-world mountain velocity with loaded bike physics and fatigue modeling.',
    headerHook: 'Ditch Naive Average Speeds. Navigate with Real-World Cycling Physics.',
    badge: 'Loaded Cycling Physics & Fatigue Engine',
    badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
    summary:
      'Traditional GPS cycling units assume flat asphalt and constant speeds, projecting 20 km/h on mountain passes where loaded bikepacking rigs drop to 4 km/h. Bikepack Navigator computes duration over 50-meter microsegments using true grade physics, rolling resistance coefficients for chunky gravel and sand, loaded gear mass, and hike-a-bike transitions.',
    hasVideo: true,
    videoWebm: 'assets/videos/cockpit-loop.webm',
    videoMp4: 'assets/videos/cockpit-loop.mp4',
    desktopImg: 'assets/images/screenshot-cockpit-desktop.webp',
    mobileImg: 'assets/images/screenshot-cockpit-mobile.webp',
    imgAlt: 'Live Ride Cockpit on Tour Divide Mile 150 Fernie BC',
    diagramType: 'power-balance',
    equations: [
      {
        name: 'Mountain Power Equilibrium',
        formula: 'True Speed: Solves loaded bike physics against gravity, rolling drag, and wind resistance',
        notes:
          'Calculates realistic speed for a 40–50 lb loaded bikepacking rig climbing mountain grades. Accounts for high-altitude thin air, drivetrain efficiency, and gear drag.',
      },
      {
        name: 'Trail Surface Rolling Drag',
        formula: 'Surface Penalty: Loose gravel adds 60% drag; peanut-butter mud adds 500% over pavement',
        notes:
          'Asphalt, hardpack fire roads, chunky railway ballast, deep sand, and sticky mud each apply real-world speed penalties derived from OpenStreetMap trail classifications.',
      },
      {
        name: 'Hike-a-Bike Fatigue Transition',
        formula: 'Walking Threshold: Grades > 14% drop loaded travel speed to 2.5 km/h on foot',
        notes:
          'When mountain scree becomes too steep to turn the pedals, the model transitions from cycling to foot pushing, factoring in the double-energy cost of pushing heavy gear.',
      },
      {
        name: 'Town Store Closing Deadline Engine',
        formula: 'Closing Countdown: ETA Arrival at Mile Target vs Local Grocery Closure Time (e.g. 19:00)',
        notes:
          'Calculates whether an exhausted rider will reach the sole rural grocery store in town before it closes, preventing emergency hungry bivvies on store porches.',
      },
    ],
    architectureSections: [
      {
        title: '50-Meter Microsegmentation',
        body: 'Routes are decomposed into discrete 50-meter trail slices. Each segment evaluates exact grade from satellite elevation contours, ground surface roughness from OpenStreetMap, and localized trajectory wind vectors.',
      },
      {
        title: 'Pacing & Anaerobic Fatigue Limiting',
        body: 'The model allows short wattage surges on steep gravel ramps but caps sustainable output, enforcing realistic recovery periods so multi-day forecasts never assume impossible anaerobic pacing.',
      },
      {
        title: 'Instant Corridor Recalculation',
        body: 'Even on the 4,312 km Tour Divide with over 86,000 trail segments, route simulations process in milliseconds directly in your browser, updating your store arrival deadline on the fly.',
      },
    ],
    keyCapabilities: [
      'Accurate time-in-saddle forecasts accounting for 40kg loaded rig weight',
      'Automatic transition to hike-a-bike on brutal grades > 14%',
      'Store closing deadlines: know if you will make town before grocery stores shut at 7 PM',
      'Side-by-side contrast revealing catastrophic 3-hour errors in naive flat-average computers',
    ],
    technicalHighlights: [
      'Loaded physics equilibrium balancing gravity, rolling resistance, and aerodynamics',
      'High-altitude alpine air density calibrated for Rocky Mountain passes',
      'Sub-second route simulation processing 4,300+ km directly in browser',
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
    badge: 'Forward-Trajectory Storm & Wind Intelligence',
    badgeColor: 'border-cyan-500/30 text-cyan-400 bg-cyan-950/40',
    summary:
      'Standard weather apps display conditions right now where you are standing. Bikepack Navigator projects future atmospheric conditions along your exact forward trail trajectory when you will actually be there, decomposing headwind resistance, alerting to impassable bentonite mud, and tracking afternoon pass lightning windows.',
    hasVideo: true,
    videoWebm: 'assets/videos/elevation-loop.webm',
    videoMp4: 'assets/videos/elevation-loop.mp4',
    desktopImg: 'assets/images/screenshot-elevation-desktop.webp',
    mobileImg: 'assets/images/screenshot-elevation-mobile.webp',
    imgAlt: 'Elevation Profile with Climb Weather on Tour Divide',
    diagramType: 'wind-vectors',
    equations: [
      {
        name: 'Forward-Trajectory Matching',
        formula: 'Forecast Target: Weather(Mile_Target, Timestamp = Now + ETA_Arrival)',
        notes:
          'Standard apps show current valley weather. Bikepack Navigator forecasts what summit conditions will be when you actually arrive tomorrow afternoon.',
      },
      {
        name: 'Directional Wind Resistance',
        formula: 'True Headwind Drag: Resolves compass wind vectors against exact trail travel heading',
        notes:
          'Translates 30 km/h crosswinds and headwinds into actual aerodynamic drag penalties, helping athletes pace before hitting energy-sapping headwinds in open basins.',
      },
      {
        name: 'Bentonite Peanut-Butter Mud Alert',
        formula: 'Mud Hazard: Rain (≥ 0.8 mm/h) + Unpaved Bentonite/Clay Soil = Impassable Trail',
        notes:
          'Warns riders before entering unpaved clay corridors where rain creates cement-like peanut-butter mud that clogs tire clearance and snaps rear derailleurs.',
      },
      {
        name: 'High-Pass Nighttime Temperature & Bivvy Modeling',
        formula: 'Summit Cooling: Temperature drops 6.5°C per 1,000m ascent + valley cold pooling',
        notes:
          'Calculates overnight low temperatures on exposed ridges vs sheltered valley basins, guiding critical gear and bivvy vs push-through decisions.',
      },
    ],
    architectureSections: [
      {
        title: '5-Tier Hazard Alert Hierarchy',
        body: 'Continuously scans the upcoming trail: Tier 1 Severe Thunderstorms takes top priority, followed by Tier 2 Peanut-Butter Mud, Tier 3 Opposing Headwinds (≥20 km/h), Tier 4 Crosswind Gusts, and Tier 5 Benign conditions.',
      },
      {
        title: 'Bentonite Clay & Dirt Soil Intelligence',
        body: 'Cross-references rainfall accumulation with soil and surface classifications. Unpaved clay roads that become unrideable within 30 minutes of rain trigger immediate reroute or bivvy warnings.',
      },
      {
        title: 'Summit Convective Storm Windows',
        body: 'High mountain passes above 10,000 ft are scanned for afternoon convective storm timing, warning riders to summit before 13:00 to avoid lightning exposure above treeline.',
      },
    ],
    keyCapabilities: [
      'Chronological trajectory matching instead of static current weather',
      'Directional wind resistance indicators relative to your trail heading',
      'Bentonite peanut-butter mud detection to protect derailleur hangers from snapping',
      'Summit lightning storm warnings and nighttime valley temperature bivvy guidance',
    ],
    technicalHighlights: [
      'Directional track azimuth resolution for accurate headwind and crosswind calculations',
      '48-hour hourly weather curves cached locally for offline trail access',
      'Severe convective thunderstorm classification and storm window countdowns',
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
    tagline: 'Power-based calorie burn modeling and backcountry carrying optimization.',
    headerHook: 'Survive the Gaps. Eliminate Bonking with Precision Metabolic Resupply.',
    badge: 'Power-Based Nutrition & 5-Minute Grocery Lists',
    badgeColor: 'border-amber-500/30 text-amber-400 bg-amber-950/40',
    summary:
      'Endurance bikepackers burning 5,000–8,000 kcal/day face catastrophic failure if they bonk in remote passes or haul unnecessary deadweight. Bikepack Navigator models real metabolic work directly from mechanical pedaling power and elevation climbing, organizing groceries by supermarket department for lightning-fast resupply.',
    hasVideo: false,
    desktopImg: 'assets/images/screenshot-resupply-desktop.webp',
    mobileImg: 'assets/images/screenshot-resupply-mobile.webp',
    imgAlt: 'Resupply Planner and Nutrition Calculator',
    diagramType: 'metabolic-bars',
    equations: [
      {
        name: 'Power-Based Caloric Expenditure',
        formula: 'Active Burn: Watts × Riding Hours × 3.6 kcal/Wh + Elevation Climbing Energy',
        notes:
          'Computes energy expenditure directly from mechanical bike work and vertical ascent, eliminating guesswork on how much fuel is burned pushing 45 lb rigs up mountains.',
      },
      {
        name: 'Resting Baseline & Camp Metabolism',
        formula: 'Daily Baseline: Basal metabolic rate + 25% active camp chores & gear setup',
        notes:
          'Accounts for calorie burn while setting up camp, filtering water in sub-zero temps, and shivering during cold bivvy nights.',
      },
      {
        name: 'Aisle-by-Aisle Supermarket Checklist',
        formula: 'Department Resupply: Produce > Bakery > Canned/Protein > Snacks > Dairy',
        notes:
          'Groups ingredients for multi-day meal plans by grocery aisle so exhausted, sleep-deprived athletes can execute a full 3-day resupply in under 5 minutes.',
      },
      {
        name: 'Consumable Pack Weight Optimization',
        formula: 'Carry Schedule: 1.0–1.2 kg food per rider-day; avoid hauling excess dead weight over passes',
        notes:
          'Hauling 2 excess kilograms of food over a 2,000m pass demands needless extra watts. Consumable tracking calculates exact food needs between town resupply points.',
      },
    ],
    architectureSections: [
      {
        title: 'Multi-Day Schedule Simulation',
        body: 'Simulates transit days to the next resupply town based on active riding hours, camp setup, and sleep blocks. Rides continuing past 21:00 automatically schedule bivvy rest breaks.',
      },
      {
        title: '18 Field-Tested Backcountry Recipes',
        body: 'Built-in catalog of lightweight, calorie-dense trail meals including Trail Pad Thai (ramen + tuna + peanut butter, 660 kcal), Avocado Burritos, and Chocolate Milk recovery.',
      },
      {
        title: '5-Minute Town Resupply Engine',
        body: 'Consolidates all ingredients into a checklist organized by supermarket department, ensuring athletes never wander confused through grocery aisles while running out of store hours.',
      },
    ],
    keyCapabilities: [
      'Accurate daily caloric targets based on elevation climbing and loaded rig weight',
      'Aisle-grouped supermarket shopping list for exhausted brain navigation in under 5 minutes',
      'Consumable weight tracking to avoid hauling redundant food over high mountain passes',
      'Field-tested recipe catalog with carbohydrate, protein, and sodium replenishment',
    ],
    technicalHighlights: [
      'Power-based energy conversion validated against endurance sports physiology',
      'Consumable weight decay calculations updating bike climbing physics in real time',
      'Zero cloud dependency: all meal plans and grocery lists stored locally on device',
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
    tagline: '4-tier water reliability classification, 30km dry gap alarms, and heads-up countdown alerts.',
    headerHook: 'Reliable Water in Arid Basins. Zero Guesswork.',
    badge: '4-Tier Water Reliability & 30km Dry Alarms',
    badgeColor: 'border-blue-500/30 text-blue-400 bg-blue-950/40',
    summary:
      'In arid expanses like the Great Divide Basin or southern Arizona, running out of water is life-threatening. Bikepack Navigator classifies sources by reliability, alerts to dry gaps over 30km, deduplicates overlapping waypoints, and provides glanceable heads-up countdown alerts on the map.',
    hasVideo: false,
    desktopImg: 'assets/images/screenshot-waypoints-desktop.webp',
    mobileImg: 'assets/images/screenshot-waypoints-mobile.webp',
    imgAlt: 'Enriched Water and Waypoint Intelligence Filters',
    diagramType: 'water-hierarchy',
    equations: [
      {
        name: '4-Tier Water Reliability Framework',
        formula: 'Tier 1 (Municipal Tap) > Tier 2 (Artesian Spring) > Tier 3 (Flowing Creek) > Tier 4 (Stock Tank)',
        notes:
          'Tier 1: Town taps (no filter). Tier 2: Flowing natural springs (fast filter). Tier 3: Streams/rivers (mandatory filter/boil). Tier 4: Cattle stock tanks (emergency pre-filter + chemical treatment).',
      },
      {
        name: '30 km Dry Stretch Alarm',
        formula: 'Dry Gap Alert: Distance to Next Verified Water > 30 km ➔ Carry 4–6 Liters Capacity',
        notes:
          'Scans ahead along the route line and sounds an alert before riders leave towns or water hubs, preventing athletes from entering arid basins with empty bottles.',
      },
      {
        name: 'Spatial Deduplication & Screen Decluttering',
        formula: 'Declutter Radius: Multiple waypoints within 200m merge into the highest-tier verified source',
        notes:
          'Consolidates redundant pins (e.g. campground spigot vs park tap) so riders traveling at 35 km/h on rough gravel are not blinded by overlapping icons.',
      },
      {
        name: 'Glanceable Heads-Up Distance Countdown',
        formula: 'Heads-Up Proximity: 1,000m ➔ 500m ➔ 250m ➔ 50m ➔ HERE (dismisses 25m past)',
        notes:
          'Compact alert in the cockpit HUD counts down remaining distance to the next water source, showing the next upcoming resupply distance in parentheses.',
      },
    ],
    architectureSections: [
      {
        title: 'Great Basin Dry Gap Protection',
        body: 'Warns riders before entering notorious dry zones like Wyoming’s Great Divide Basin (130+ miles of alkaline desert) where missing a cattle tank or spring means severe dehydration.',
      },
      {
        title: 'Glanceable Top-Left HUD Notifications',
        body: 'Displays upcoming water waypoints in the cockpit HUD within 1,000 meters. Features high-contrast typography readable in direct midday desert sunlight.',
      },
      {
        title: 'Strict Provenance & Water Access Point Data',
        body: 'Integrates authentic trail water points (natural springs, river crossings, spigots) with verified community reports. Discards unverified seasonal trickles.',
      },
    ],
    keyCapabilities: [
      '4-tier water classification with explicit treatment steps for each source',
      'Dry stretch alarms triggered whenever upcoming water gap exceeds 30 kilometers',
      'Cockpit proximity countdowns (1000m down to 50m) for instant awareness while riding',
      'Tour Divide authentic water points: Smith-Dorrien Creek, Kananaskis River, and Elk River',
    ],
    technicalHighlights: [
      '200m spatial route line deduplication preserving highest-quality water source',
      'Dual concurrency limit with water prioritization over commercial stops',
      'Lookahead distance filtering excluding nearby stops under 1 mile',
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
    tagline: 'High-resolution satellite elevation profiles, grade color bands, and summit storm windows.',
    headerHook: 'Master the Mountain Passes. High-Resolution Elevation Analytics.',
    badge: 'Satellite Elevation Contours & Summit Windows',
    badgeColor: 'border-orange-500/30 text-orange-400 bg-orange-950/40',
    summary:
      'Barometric altimeters drift with changing storm pressure, introducing hundreds of meters of elevation error when cold fronts hit. Bikepack Navigator calculates elevation from satellite digital elevation contours, rendering slope gradient color bands, hike-a-bike fatigue modeling, and summit storm arrival windows.',
    hasVideo: true,
    videoWebm: 'assets/videos/elevation-loop.webm',
    videoMp4: 'assets/videos/elevation-loop.mp4',
    desktopImg: 'assets/images/screenshot-elevation-desktop.webp',
    mobileImg: 'assets/images/screenshot-elevation-mobile.webp',
    imgAlt: 'Elevation Profile and Climb Analytics with Gradient Bands',
    diagramType: 'climb-profile',
    equations: [
      {
        name: 'Grade-Colored Elevation Spectrum',
        formula: 'Grade Bands: <4% Rolling Green | 4–8% Amber | 8–12% Steep Orange | >12% Crimson Hike-a-Bike',
        notes:
          'Color-coded elevation profile immediately reveals whether an upcoming 1,000m climb is rideable spin or brutal pushing, allowing pacing adjustments before exhaustion sets in.',
      },
      {
        name: 'Daylight Summit Storm Window',
        formula: 'Summit Deadline: ETA Crest Time vs Afternoon Alpine Convective Storm Window (13:00–16:00)',
        notes:
          'Calculates whether an athlete can reach exposed alpine summits (like 12,000 ft Indiana Pass) before afternoon lightning storms build above treeline.',
      },
      {
        name: 'Hike-a-Bike Energy & Speed Modeling',
        formula: 'Pushing Penalty: Walking a 45 lb rig on 15% scree drops speed to 2.5 km/h and doubles caloric burn',
        notes:
          'Replaces naive cycling speeds on steep mountain passes with realistic foot speeds, preventing catastrophic multi-hour ETA underestimations.',
      },
      {
        name: 'Glanceable Vertical Ascent Metrics',
        formula: 'Ascent Dashboard: Remaining Vertical Meters, Vertical Ascent Speed (VAM), and Distance to Pass Crest',
        notes:
          'Displays clear, glanceable elevation numbers designed for fast reading while rattling over washboard roads on mountain descents.',
      },
    ],
    architectureSections: [
      {
        title: 'Satellite Elevation Contours',
        body: 'Replaces drifting barometric tracks with high-resolution satellite digital elevation models. Eliminates false altitude readings when major barometric storm fronts roll in.',
      },
      {
        title: 'Summit Lightning Hazard Detection',
        body: 'Calculates the exact arrival hour at the pass crest. Warns riders to push through early in the morning or bivvy below treeline if afternoon storms are forecast.',
      },
      {
        title: 'Hike-a-Bike Grade Realism',
        body: 'Calculates realistic pushing speed on steep alpine scree, factoring in heavy bikepacking rig mass and steep gradient friction.',
      },
    ],
    keyCapabilities: [
      'Interactive elevation profile scrubbing with cursor tracking and mile markers',
      'Daylight pass summit arrival calculations to avoid afternoon alpine lightning storms',
      'Slope gradient color bands (<4% green, 4-8% yellow, 8-12% orange, >12% crimson)',
      'Hike-a-bike speed and energy modeling on grades steeper than 14%',
    ],
    technicalHighlights: [
      'High-resolution satellite elevation model immune to barometric weather drift',
      'Clean elevation profiles filtered to eliminate false GPS elevation spikes',
      'Live rider location tracking on climb profile with remaining ascent meters',
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
    tagline: 'Fast, smooth, battery-efficient vector cartography running 100% offline.',
    headerHook: 'True Offline Freedom. Complete Vector Mapping in Your Pocket.',
    badge: '100% Offline 60fps Vector Cartography',
    badgeColor: 'border-teal-500/30 text-teal-400 bg-teal-950/40',
    summary:
      'Raster maps require downloading tens of thousands of image tiles that fail to load in backcountry canyons and drain your phone battery. Bikepack Navigator uses compact single-file vector packages stored locally on your device for fluid 60fps navigation with zero cell service.',
    hasVideo: true,
    videoWebm: 'assets/videos/map-loop.webm',
    videoMp4: 'assets/videos/map-loop.mp4',
    desktopImg: 'assets/images/screenshot-map-desktop.webp',
    mobileImg: 'assets/images/screenshot-map-mobile.webp',
    imgAlt: 'Offline Vector Mapping with PMTiles and MapLibre GL',
    diagramType: 'vector-pmtiles',
    equations: [
      {
        name: 'Single-File Corridor Archive',
        formula: 'Offline Corridor: Full 4,300 km trail corridor (18 km buffer) packaged into one compact download',
        notes:
          'Downloads in seconds and takes minimal phone storage space (megabytes, not gigabytes), leaving ample battery and storage for multi-week wilderness traverses.',
      },
      {
        name: 'Canyon 60fps Dead-Reckoning',
        formula: 'Tunnel & Canyon Continuity: 60fps Dead-Reckoning along track polyline during GPS satellite dropouts',
        notes:
          'When steep granite canyon walls block satellite line-of-sight, the cockpit smoothly advances rider position along the route line without jumpy stutters.',
      },
      {
        name: 'Off-Course Audio & Vibration Alarms',
        formula: 'Off-Route Alert: Trigger sound/haptic alarm within 50m of taking a wrong logging road fork',
        notes:
          'Alerts riders immediately if they miss a turn at 2 AM in pitch darkness or heavy rain, saving hours of exhausting backtracking up wrong mountain valleys.',
      },
      {
        name: 'Switchback False Turn Suppression',
        formula: 'Intelligent Filtering: Cues trigger only at true trail intersections, ignoring winding switchbacks',
        notes:
          'Prevents annoying non-stop turn alerts on winding mountain switchbacks while ensuring vital logging road forks are never missed.',
      },
    ],
    architectureSections: [
      {
        title: 'Zero-Server Battery Longevity',
        body: 'Vector tiles render smoothly directly on the device GPU without continuous network polling, keeping phones running cool and extending battery life over multi-day wilderness segments.',
      },
      {
        title: 'Seamless Multi-Region Route Stitching',
        body: 'Even massive continental routes spanning multiple states and provinces (Canada to Mexico) stitch seamlessly into one unbroken trail corridor with zero map border seams.',
      },
      {
        title: 'Handlebar Screen Sunlight Readability',
        body: 'High-contrast outdoor topo vector styling with bold trail contours and crisp typography designed for readability in blazing midday mountain sunlight.',
      },
    ],
    keyCapabilities: [
      '100% offline vector cartography with elevation contours and trail markings',
      'Off-course vibration and sound alarms for wrong logging road forks in pitch darkness',
      '60fps dead-reckoning keeping cockpit navigation fluid during deep canyon GPS blackouts',
      'One-click package download: full 4,300 km route saved in seconds taking minimal storage',
    ],
    technicalHighlights: [
      'Single-file vector corridor format with zero dependency on proprietary map servers',
      'Zero raster tile bloat: megabytes instead of gigabytes of storage',
      'High-contrast outdoor topo styling optimized for bright sunlight on bike mounts',
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
    tagline: '100% Free, MIT Licensed, with Zero Telemetry and Complete Offline Privacy.',
    headerHook: 'Built for Athletes, Not Venture Capital. 100% Free and Private.',
    badge: '100% Free MIT · Zero Telemetry',
    badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
    summary:
      'All calculations, route data, maps, and nutrition plans execute strictly on your device. No accounts, no passwords, no subscription paywalls, and zero tracking pixels. Your location, routes, and physiological metrics belong entirely to you.',
    hasVideo: false,
    desktopImg: 'assets/images/og-preview.jpg',
    mobileImg: 'assets/images/og-preview.jpg',
    imgAlt: 'Open-Source Philosophy and Data Sovereignty',
    diagramType: 'privacy-sovereignty',
    equations: [
      {
        name: 'Athlete Independence & Free MIT License',
        formula: 'Forever Free: 100% Free under MIT License with zero subscriptions, paywalls, or lock-in',
        notes:
          'No $80/year recurring charges, no locked GPX exports, and no locked regional map packs. Owned and maintained by endurance cyclists for the community.',
      },
      {
        name: 'Zero-Telemetry Client Sovereignty',
        formula: 'Absolute Privacy: 0 Servers | 0 User Accounts | 0 Tracking Pixels | 0 Telemetry Logs',
        notes:
          'Your GPS coordinates, heart rate metrics, and private route plans never leave your device. Complete sovereignty 40 miles past cell service or at home.',
      },
      {
        name: 'True Offline-First Independence',
        formula: 'Offline Autonomy: Operates 100% offline on bike handlebars with zero network connectivity',
        notes:
          'Launches directly in any browser and installs as an offline progressive web app with zero dependencies on remote servers.',
      },
      {
        name: 'Community Route Contribution & Ingestion',
        formula: 'Open Ingestion: Ingest custom GPX routes, inspect calculations, and contribute verified water points',
        notes:
          'Cycle racers and event organizers can ingest GPX routes with elevation contours, water waypoints, and resupply hubs for any route in the world.',
      },
    ],
    architectureSections: [
      {
        title: 'Zero Accounts, Zero Subscriptions',
        body: 'No email harvesting, no credit cards, no login gates. Launch the app and immediately navigate. You will never encounter a paywall mid-expedition on the trail.',
      },
      {
        title: 'Absolute Location & Route Privacy',
        body: 'The app never records or uploads your GPS track logs to the cloud. All GPX files, offline map packages, and custom recipes live strictly on your device.',
      },
      {
        title: 'Community Route Contributions',
        body: 'Endurance cyclists and race organizers can audit every line of code, verify physics calculations, contribute water sources, and publish custom routes.',
      },
    ],
    keyCapabilities: [
      '100% Free under the permissive MIT license with zero subscription fees',
      'Zero telemetry: no accounts, passwords, or personal location tracking',
      'Direct GPX route export and import on your device with zero cloud lock-in',
      'Community-driven platform welcoming verified water sources and route additions',
    ],
    technicalHighlights: [
      '100% client-side architecture with zero backend attack surface',
      'Auditable open-source calculations for physics, nutrition, and weather',
      'Zero vendor lock-in: standard open formats for GPX, vector tiles, and GeoJSON',
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
