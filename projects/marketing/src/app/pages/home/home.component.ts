import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

export interface ShowcaseView {
  id: string;
  name: string;
  tag: string;
  title: string;
  description: string;
  hasVideo: boolean;
  videoWebm?: string;
  videoMp4?: string;
  desktopImg: string;
  mobileImg: string;
  telemetryPills: { label: string; value: string; color: string }[];
}

export interface FeaturePillarItem {
  id: string;
  title: string;
  pillarNumber: number;
  badge: string;
  badgeColor: string;
  formula: string;
  description: string;
  deepDiveSpecs: string[];
  route: string;
  iconSvg: string;
}

export interface ComparisonRow {
  feature: string;
  navigator: string;
  navigatorCheck: boolean;
  strava: string;
  komoot: string;
  ridewithgps: string;
  garmin: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit {
  private seoService = inject(SeoService);
  readonly pwaUrl = '/bike-packing-navigator/';

  // Showcase state
  readonly activeShowcaseIndex = signal(0);
  readonly showcaseDevice = signal<'desktop' | 'mobile'>('desktop');

  readonly showcaseViews: ShowcaseView[] = [
    {
      id: 'cockpit',
      name: 'Live Ride Cockpit',
      tag: '60fps Telemetry HUD',
      title: 'Glanceable Heads-Up Cockpit with Proximity Intelligence',
      description:
        'Continuous speed, gradient-colored climb profiles, turn cues, and 4-tier water proximity countdown alerts. Tested at 24 km/h across Tour Divide Mile 150 near Fernie, BC.',
      hasVideo: true,
      videoWebm: 'assets/videos/cockpit-loop.webm',
      videoMp4: 'assets/videos/cockpit-loop.mp4',
      desktopImg: 'assets/images/screenshot-cockpit-desktop.webp',
      mobileImg: 'assets/images/screenshot-cockpit-mobile.webp',
      telemetryPills: [
        { label: 'Mile', value: '150.0', color: 'text-emerald-400' },
        { label: 'Speed', value: '24.5 km/h', color: 'text-cyan-400' },
        { label: 'Grade', value: '+3.8%', color: 'text-amber-400' },
        { label: 'Lookahead Water', value: 'in 500m (next 18km)', color: 'text-emerald-400' },
      ],
    },
    {
      id: 'elevation',
      name: 'Elevation & Climb Weather',
      tag: 'Copernicus 30m DEM',
      title: 'Slope Gradient Spectrum & Summit Thunderstorm Pins',
      description:
        'Microsegmented 50m grade bands (<4% rolling green, 4-8% yellow, 8-12% orange, >12% crimson hike-a-bike) with real-time cursor scrubbing and projected summit storm windows.',
      hasVideo: true,
      videoWebm: 'assets/videos/elevation-loop.webm',
      videoMp4: 'assets/videos/elevation-loop.mp4',
      desktopImg: 'assets/images/screenshot-elevation-desktop.webp',
      mobileImg: 'assets/images/screenshot-elevation-mobile.webp',
      telemetryPills: [
        { label: 'Summit Pass', value: '2,140m Elev', color: 'text-amber-400' },
        { label: 'Climb Gradient', value: '9.2% Avg', color: 'text-orange-400' },
        { label: 'Hike-a-Bike Zone', value: '1.8 km (>14%)', color: 'text-rose-400' },
        { label: 'Summit Storm Risk', value: '15:00 Window', color: 'text-rose-400' },
      ],
    },
    {
      id: 'resupply',
      name: 'Resupply & Nutrition',
      tag: 'BMR & Grocery Math',
      title: 'Metabolic Caloric Planner & Department-Grouped Shopping Lists',
      description:
        'Calculates active energy expenditure at 24% gross mechanical efficiency plus clinical Mifflin-St Jeor BMR. Simulates multi-day sleep blocks and generates aisle-by-aisle grocery checklists.',
      hasVideo: false,
      desktopImg: 'assets/images/screenshot-resupply-desktop.webp',
      mobileImg: 'assets/images/screenshot-resupply-mobile.webp',
      telemetryPills: [
        { label: 'Daily Burn', value: '5,840 kcal', color: 'text-amber-400' },
        { label: 'Riding Efficiency', value: '24% Gross', color: 'text-emerald-400' },
        { label: 'Recipes Loaded', value: '18 Field-Tested', color: 'text-cyan-400' },
        { label: 'Carrying Schedule', value: '3.2 Days to Town', color: 'text-emerald-400' },
      ],
    },
    {
      id: 'map',
      name: 'Vector Map & Offline Cache',
      tag: 'PMTiles + MapLibre GL',
      title: 'Complete 18km Route Corridor Offline Vector Cartography',
      description:
        'Compact single-file PMTiles archives stored locally in IndexedDB. Multi-section route stitching across provinces/states, 60fps dead-reckoning during GPS canyon dropouts, and switchback filtering.',
      hasVideo: true,
      videoWebm: 'assets/videos/map-loop.webm',
      videoMp4: 'assets/videos/map-loop.mp4',
      desktopImg: 'assets/images/screenshot-map-desktop.webp',
      mobileImg: 'assets/images/screenshot-map-mobile.webp',
      telemetryPills: [
        { label: 'Tile Archive', value: 'PMTiles Hilbert', color: 'text-emerald-400' },
        { label: 'Corridor Buffer', value: '18 km Width', color: 'text-cyan-400' },
        { label: 'Dead-Reckoning', value: '60fps Loop', color: 'text-emerald-400' },
        { label: 'Offline Storage', value: 'IndexedDB', color: 'text-amber-400' },
      ],
    },
    {
      id: 'waypoints',
      name: 'Waypoint & Water Filters',
      tag: '4-Tier Verification',
      title: 'Curated Water Reliability & Spatial Deduplication',
      description:
        'Deduplicates overlapping water features within 200m, applies 5km density throttling to prevent cockpit clutter, and alerts riders when the next verified water point is >30km away.',
      hasVideo: false,
      desktopImg: 'assets/images/screenshot-waypoints-desktop.webp',
      mobileImg: 'assets/images/screenshot-waypoints-mobile.webp',
      telemetryPills: [
        { label: 'Water Tiers', value: '4 Classifications', color: 'text-cyan-400' },
        { label: 'Dedup Radius', value: '200m Spatial', color: 'text-emerald-400' },
        { label: 'Dry Gap Warning', value: '>30 km Alert', color: 'text-rose-400' },
        { label: 'Lookahead Gate', value: '>1.0 mi Filter', color: 'text-amber-400' },
      ],
    },
  ];

  readonly pillars: FeaturePillarItem[] = [
    {
      id: 'eta-modeling',
      pillarNumber: 1,
      title: 'Physics-Based Dynamic ETA Modeling',
      badge: '12-Iter Newton-Raphson',
      badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
      formula: '½ ρ CdA v³ + m g (sin θ + Crr cos θ) v - η P = 0',
      description:
        'Calculates real travel velocity over 50m microsegments using Newtonian power equilibrium, surface rolling resistance (Crr), loaded rig weight, aerodynamic drag, and exponential rider fatigue.',
      deepDiveSpecs: [
        'Newton-Raphson 12-iteration solver converged to < 10⁻⁵ precision',
        'Crr table: Asphalt 0.0055, Hardpack 0.0100, Gravel 0.0160, Mud 0.0600',
        'Firmness multipliers from OSM tracktype grade1 (1.0x) to grade5 (2.3x)',
        'Automatic hike-a-bike transition speed formula on steep alpine gradients',
      ],
      route: '/features/eta-modeling',
      iconSvg: 'M13 10V3L4 14h7v7l9-11h-7z',
    },
    {
      id: 'weather-hazards',
      pillarNumber: 2,
      title: 'Predictive Trail Weather & Hazard Intelligence',
      badge: 'Trajectory Weather Matching',
      badgeColor: 'border-cyan-500/30 text-cyan-400 bg-cyan-950/40',
      formula: 'V_headwind = V_wind · cos((θ_wind - θ_travel + 540) % 360 - 180)',
      description:
        'Matches chronological rider arrival times (T_now + ETA) to localized Open-Meteo atmospheric forecasts. Decomposes wind vectors into relative headwind/tailwind resistance and alerts for mountain storms.',
      deepDiveSpecs: [
        'Trajectory ETA matching: samples weather at exact future arrival miles',
        '5-tier hazard priority: Thunderstorms > Heavy Mud > Headwinds > Tailwinds > Benign',
        'OSM clay soil + rainfall mud detection warns of derailleur-snapping peanut-butter clay',
        'Mountain pass lapse rate: 6.5°C drop and wind acceleration per 1,000m ascent',
      ],
      route: '/features/weather-hazards',
      iconSvg:
        'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z',
    },
    {
      id: 'resupply-nutrition',
      pillarNumber: 3,
      title: 'Resupply & Nutrition Intelligence',
      badge: '24% Gross Mechanical Efficiency',
      badgeColor: 'border-amber-500/30 text-amber-400 bg-amber-950/40',
      formula: 'kcal_active = (Watts × Duration_sec) / (0.24 × 4184)',
      description:
        'Eliminates remote bonking by modeling active mechanical energy at 24% gross human efficiency alongside clinical Mifflin-St Jeor BMR, multi-day sleep schedules, and grocery lists.',
      deepDiveSpecs: [
        'Clinical Mifflin-St Jeor BMR calculated from weight, height, age, and sex offset',
        'Multi-day simulator accounts for 21:00 nightfall camp triggers and sleep blocks',
        '18 backcountry field recipes catalog with carbohydrate, fat, and protein ratios',
        'Automated department-grouped grocery shopping list (Produce, Bakery, Canned, Snacks)',
      ],
      route: '/features/resupply-nutrition',
      iconSvg:
        'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    },
    {
      id: 'waypoint-water',
      pillarNumber: 4,
      title: 'Enriched Waypoint & Water Intelligence',
      badge: '4-Tier Water Classification',
      badgeColor: 'border-blue-500/30 text-blue-400 bg-blue-950/40',
      formula: 'Lookahead_water = min_distance(upcoming > 1.0 mi in [water, camp, store])',
      description:
        'Protects against dehydration in arid stretches (Great Divide Basin, Arizona desert) through rigorous 4-tier water classification, 200m spatial deduplication, and proximity countdown HUD alerts.',
      deepDiveSpecs: [
        'Tier 1: Potable Municipal, Tier 2: Natural Springs, Tier 3: Streams, Tier 4: Lakes/Tanks',
        '200m spatial deduplication strictly preserves highest quality source',
        '5km density throttling with 3.75km anti-crowding boundary prevents cockpit clutter',
        '>30 km dry carry warning banner triggers heavy hydration planning',
      ],
      route: '/features/waypoint-water',
      iconSvg:
        'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
    },
    {
      id: 'climb-analytics',
      pillarNumber: 5,
      title: 'Climb & Pass Analytics',
      badge: 'Copernicus 30m Global DEM',
      badgeColor: 'border-orange-500/30 text-orange-400 bg-orange-950/40',
      formula: 'Grade = (ΔElevation / ΔDistance) × 100% via 50m Microsegments',
      description:
        'Replaces noisy barometric sensors with Copernicus GLO-30 DEM. Renders slope gradient color spectrums, dynamic SVG mini-profiles with crest shoulders, and summit lightning window pins.',
      deepDiveSpecs: [
        'Color spectrum: <4% green, 4-8% yellow, 8-12% orange, >12% crimson, <-4% cyan',
        'Dynamic width scaling: gentle climbs expand to 150px, steep climbs contract to 70px',
        'Live rider location dot on climb slope with remaining vertical ascent counter',
        'Pass summit storm pin alerts riders to crest high mountain passes before noon storms',
      ],
      route: '/features/climb-analytics',
      iconSvg: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    },
    {
      id: 'offline-mapping',
      pillarNumber: 6,
      title: 'Offline Vector Cartography & Navigation',
      badge: 'PMTiles + MapLibre GL 60fps',
      badgeColor: 'border-teal-500/30 text-teal-400 bg-teal-950/40',
      formula: 'Virtual Hilbert Indexing in IndexedDB + 60fps Dead Reckoning',
      description:
        'Zero raster tiles. Delivers compact single-file PMTiles vector archives cached in IndexedDB. Features composite multi-section route stitching, 60fps dead-reckoning, and switchback filtering.',
      deepDiveSpecs: [
        'PMTiles Hilbert-indexed vector archives cached permanently in browser IndexedDB',
        'Composite route stitching joins multi-state tile packages without seam artifacts',
        '60fps dead-reckoning advances rider position during canyon GPS dropouts',
        'Switchback elimination: cues trigger only when ≥3 direction branches diverge',
      ],
      route: '/features/offline-mapping',
      iconSvg:
        'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
    },
    {
      id: 'open-source',
      pillarNumber: 7,
      title: 'Open-Source Philosophy & Community Trust',
      badge: '100% Free MIT · 0 Telemetry',
      badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
      formula: 'Privacy = 100% Client-Side (0 Servers, 0 Accounts, 0 Trackers)',
      description:
        'Built for endurance athletes, not venture capitalists. 100% Free and Open Source under MIT License. All data lives in local browser storage with zero telemetry and zero backend tracking.',
      deepDiveSpecs: [
        'MIT License guarantees freedom to use, modify, and build custom route packages',
        'Zero accounts, zero passwords, zero email harvesting, and zero subscription paywalls',
        'Full data sovereignty: complete GPX and JSON route export/import directly on device',
        'Offline-first PWA works autonomously on phone bike mounts in remote wilderness',
      ],
      route: '/features/open-source',
      iconSvg:
        'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    },
  ];

  readonly comparisonRows: ComparisonRow[] = [
    {
      feature: 'Physics-Based Wattage & Mass ETAs',
      navigator: '✅ Newton-Raphson 12-iter solver',
      navigatorCheck: true,
      strava: '❌ Flat average speed only',
      komoot: '❌ Flat average speed only',
      ridewithgps: '❌ Flat average speed only',
      garmin: '⚠️ Limited virtual partner',
    },
    {
      feature: 'Chronological Trajectory Trail Weather',
      navigator: '✅ Hourly forecast at arrival time',
      navigatorCheck: true,
      strava: '❌ Current weather only',
      komoot: '⚠️ Basic forecast (Paywalled)',
      ridewithgps: '❌ None',
      garmin: '⚠️ Requires cellular phone link',
    },
    {
      feature: 'Unpaved Road Mud Hazard Alerts',
      navigator: '✅ OSM clay soil + rain analysis',
      navigatorCheck: true,
      strava: '❌ None',
      komoot: '❌ None',
      ridewithgps: '❌ None',
      garmin: '❌ None',
    },
    {
      feature: '4-Tier Water & >30km Carry Warnings',
      navigator: '✅ 4 tiers + lookahead gating',
      navigatorCheck: true,
      strava: '❌ None',
      komoot: '⚠️ Generic unverified POIs',
      ridewithgps: '⚠️ Manual user cues only',
      garmin: '⚠️ Basic waypoint dots',
    },
    {
      feature: 'Metabolic BMR & Grocery Lists',
      navigator: '✅ Mifflin-St Jeor + 18 recipes',
      navigatorCheck: true,
      strava: '❌ None',
      komoot: '❌ None',
      ridewithgps: '❌ None',
      garmin: '❌ None',
    },
    {
      feature: 'Full Vector Offline Maps',
      navigator: '✅ PMTiles in IndexedDB (Free)',
      navigatorCheck: true,
      strava: '⚠️ Subscription required',
      komoot: '⚠️ Regional paywalls ($30+)',
      ridewithgps: '⚠️ Premium required',
      garmin: '✅ Onboard maps ($400+ unit)',
    },
    {
      feature: 'Pricing & Licensing',
      navigator: '✅ 100% Free & Open Source (MIT)',
      navigatorCheck: true,
      strava: '❌ $80/year subscription',
      komoot: '❌ $30–$60 map packs',
      ridewithgps: '❌ $80/year subscription',
      garmin: '❌ $400–$700 dedicated hardware',
    },
    {
      feature: 'User Privacy & Telemetry',
      navigator: '✅ Zero Tracking / Zero Accounts',
      navigatorCheck: true,
      strava: '❌ Mandatory account & tracking',
      komoot: '❌ Mandatory account & tracking',
      ridewithgps: '❌ Mandatory account & tracking',
      garmin: '⚠️ Cloud sync required',
    },
  ];

  ngOnInit(): void {
    this.seoService.setMeta({
      title: 'The Autonomous Backcountry Copilot',
      description:
        "When you're 40 miles past cell service, hope is not a navigation strategy. Physics-based ETAs, trajectory weather hazards, 4-tier water intelligence, and 100% offline vector mapping under MIT license.",
      urlPath: '',
      keywords:
        'bikepacking, Tour Divide, Colorado Trail, bikepacking navigation, GPX routing, cycling physics, offline maps, PMTiles, trail weather, resupply planner',
    });
  }

  selectShowcaseTab(index: number): void {
    this.activeShowcaseIndex.set(index);
  }

  setShowcaseDevice(mode: 'desktop' | 'mobile'): void {
    this.showcaseDevice.set(mode);
  }
}
