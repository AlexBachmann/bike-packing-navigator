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
      tag: 'High-Contrast 60fps HUD',
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
      tag: 'Topographic Elevation',
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
      tag: 'Metabolic Resupply & Nutrition',
      title: 'Metabolic Caloric Planner & Department-Grouped Shopping Lists',
      description:
        'Calculates active energy expenditure from pedal wattage and vertical climbing alongside baseline resting burn. Simulates multi-day sleep schedules and generates aisle-by-aisle grocery checklists.',
      hasVideo: false,
      desktopImg: 'assets/images/screenshot-resupply-desktop.webp',
      mobileImg: 'assets/images/screenshot-resupply-mobile.webp',
      telemetryPills: [
        { label: 'Daily Burn', value: '5,840 kcal', color: 'text-amber-400' },
        { label: 'Fueling Target', value: '60g Carbs/Hour', color: 'text-emerald-400' },
        { label: 'Recipes Loaded', value: '18 Field-Tested', color: 'text-cyan-400' },
        { label: 'Carrying Schedule', value: '3.2 Days to Town', color: 'text-emerald-400' },
      ],
    },
    {
      id: 'map',
      name: 'Vector Map & Offline Cache',
      tag: 'Offline Vector Cartography',
      title: 'Complete 18km Route Corridor Offline Vector Cartography',
      description:
        'Compact single-file route corridor packages stored locally on your device. Seamless multi-region route stitching, 60fps dead-reckoning during GPS canyon dropouts, and intelligent switchback filtering.',
      hasVideo: true,
      videoWebm: 'assets/videos/map-loop.webm',
      videoMp4: 'assets/videos/map-loop.mp4',
      desktopImg: 'assets/images/screenshot-map-desktop.webp',
      mobileImg: 'assets/images/screenshot-map-mobile.webp',
      telemetryPills: [
        { label: 'Corridor Cache', value: 'Single-File Package', color: 'text-emerald-400' },
        { label: 'Corridor Buffer', value: '18 km Width', color: 'text-cyan-400' },
        { label: 'Canyon Tracking', value: '60fps Dead-Reckon', color: 'text-emerald-400' },
        { label: 'Offline Storage', value: '100% Local Device', color: 'text-amber-400' },
      ],
    },
    {
      id: 'waypoints',
      name: 'Waypoint & Water Filters',
      tag: '4-Tier Water Verification',
      title: 'Curated Water Reliability & Spatial Deduplication',
      description:
        'Deduplicates overlapping water features within 200m, applies density buffering to eliminate screen clutter, and triggers immediate alarms when entering dry stretches longer than 30 kilometers.',
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
      badge: 'Loaded Cycling Physics',
      badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/40',
      formula:
        'Know your exact arrival time at remote towns before the single grocery store closes at 7 PM.',
      description:
        'Calculates real travel velocity over 50m microsegments using Newtonian power equilibrium, surface rolling resistance, loaded rig weight, aerodynamic drag, and exponential rider fatigue.',
      deepDiveSpecs: [
        'Mountain power balance accounts for 40kg bike, gear, and water weight',
        'Rolling resistance calibrated for chunky gravel, loose scree, and deep sand',
        'Automatic transition to hike-a-bike pacing on steep alpine pitches >14%',
        'Fatigue modeling factors multi-day exhaustion and headwinds into ETA',
      ],
      route: '/features/eta-modeling',
      iconSvg: 'M13 10V3L4 14h7v7l9-11h-7z',
    },
    {
      id: 'weather-hazards',
      pillarNumber: 2,
      title: 'Predictive Trail Weather & Hazard Intelligence',
      badge: 'Forward-Trajectory Forecasts',
      badgeColor: 'border-cyan-500/30 text-cyan-400 bg-cyan-950/40',
      formula:
        'Get warned of opposing 30 km/h headwinds and derailleur-snapping bentonite mud before you ride into them.',
      description:
        'Matches your projected arrival time at upcoming trail miles to localized hourly atmospheric forecasts. Decomposes wind into true headwind resistance and warns of afternoon alpine storm windows.',
      deepDiveSpecs: [
        'Forward-trajectory matching forecasts conditions where you will be tomorrow, not where you stand today',
        '5-tier hazard hierarchy: Severe Thunderstorms > Heavy Mud > Headwinds > Crosswinds > Clear',
        'Unpaved clay warnings alert to impassable bentonite peanut-butter mud during rain',
        'High-pass temperature modeling guides critical bivvy vs push-through decisions',
      ],
      route: '/features/weather-hazards',
      iconSvg:
        'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z',
    },
    {
      id: 'resupply-nutrition',
      pillarNumber: 3,
      title: 'Resupply & Nutrition Intelligence',
      badge: 'Power-Based Calorie Engine',
      badgeColor: 'border-amber-500/30 text-amber-400 bg-amber-950/40',
      formula:
        'Eliminate backcountry bonking with calorie targets tuned to your loaded rig weight and climbing meters.',
      description:
        'Eliminates remote bonking by translating mechanical pedaling work and elevation gain into real calorie burn, active hydration requirements, and aisle-by-aisle grocery checklists.',
      deepDiveSpecs: [
        'Power-based active burn calculation converts mechanical wattage directly into calories needed',
        'Department-organized grocery lists (Produce, Bakery, Canned, Snacks) for 5-minute town resupply',
        'Consumable weight tracking helps you avoid hauling redundant food over high passes',
        'Field-tested backcountry recipe catalog with optimized carb, protein, and sodium ratios',
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
      formula:
        'Clear 4-tier water reliability and automatic alarms when dry stretches exceed 30 kilometers.',
      description:
        'Protects against life-threatening dehydration in arid expanses like the Great Divide Basin through 4-tier reliability classification, spatial deduplication, and proximity countdown alerts.',
      deepDiveSpecs: [
        'Tier 1: Potable Tap, Tier 2: Artesian Spring, Tier 3: Filtered Creek, Tier 4: Emergency Tank',
        '30 km dry stretch alarm prompts carrying 4-6L of water before entering arid basins',
        'Glanceable heads-up countdown alerts (1k, 500m, 250m, 50m, HERE) in top cockpit corner',
        'Spatial deduplication merges duplicate markers so rough descents remain decluttered',
      ],
      route: '/features/waypoint-water',
      iconSvg:
        'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
    },
    {
      id: 'climb-analytics',
      pillarNumber: 5,
      title: 'Climb & Pass Analytics',
      badge: 'Satellite Elevation Contours',
      badgeColor: 'border-orange-500/30 text-orange-400 bg-orange-950/40',
      formula:
        'Time high-altitude summits to crest 12,000 ft passes before dangerous afternoon lightning storms build.',
      description:
        'Replaces drifting barometric sensors with satellite digital elevation contours. Displays slope gradient color spectrums, real-time vertical ascent metrics, and summit storm arrival windows.',
      deepDiveSpecs: [
        'Color-coded gradient bands: <4% rolling green, 4-8% yellow, 8-12% orange, >12% crimson hike-a-bike',
        'Daylight pass arrival calculations help you crest exposed passes before afternoon lightning',
        'Hike-a-bike fatigue modeling accounts for walking loaded rigs on brutal gradients',
        'Glanceable vertical climbing meters, current grade %, and distance to pass crest',
      ],
      route: '/features/climb-analytics',
      iconSvg: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    },
    {
      id: 'offline-mapping',
      pillarNumber: 6,
      title: 'Offline Vector Cartography & Navigation',
      badge: '100% Offline 60fps Vector',
      badgeColor: 'border-teal-500/30 text-teal-400 bg-teal-950/40',
      formula:
        'Fluid 60fps topo navigation that runs for weeks with zero cellular reception and minimal battery drain.',
      description:
        'Zero fragile image tiles. Delivers compact single-file vector packages saved to your device in seconds. Features full 18km trail corridor contours, 60fps dead-reckoning, and off-course alerts.',
      deepDiveSpecs: [
        'Entire 4,300 km trail corridor downloads in seconds and takes minimal device storage',
        'Smooth 60fps vector navigation with high-contrast topographic styling for bright sunlight',
        'Canyon dead-reckoning keeps route guidance moving during deep mountain GPS blackouts',
        'Off-course vibration and sound alarms trigger immediately if you take a wrong fork at night',
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
      formula:
        '100% free under MIT with zero subscriptions, zero accounts, and zero telemetry tracking.',
      description:
        'Built for endurance athletes, not venture capitalists. 100% Free and Open Source under MIT License. All data lives on your device with zero telemetry and zero corporate paywalls.',
      deepDiveSpecs: [
        'Permissive MIT License guarantees the platform remains permanently free and open to everyone',
        'Zero accounts, zero passwords, zero credit cards, and zero $80/year subscription paywalls',
        'Complete data sovereignty: zero GPS tracks, health stats, or coordinates ever leave your phone',
        'Community-driven: inspect all calculations, contribute verified water points, or add custom GPX routes',
      ],
      route: '/features/open-source',
      iconSvg:
        'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    },
  ];

  readonly comparisonRows: ComparisonRow[] = [
    {
      feature: 'Physics-Based Wattage & Mass ETAs',
      navigator: '✅ Loaded bike physics & fatigue model',
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
      navigator: '✅ Rain + bentonite clay detection',
      navigatorCheck: true,
      strava: '❌ None',
      komoot: '❌ None',
      ridewithgps: '❌ None',
      garmin: '❌ None',
    },
    {
      feature: '4-Tier Water & >30km Carry Warnings',
      navigator: '✅ 4 tiers + 30km dry alarm',
      navigatorCheck: true,
      strava: '❌ None',
      komoot: '⚠️ Generic unverified POIs',
      ridewithgps: '⚠️ Manual user cues only',
      garmin: '⚠️ Basic waypoint dots',
    },
    {
      feature: 'Metabolic Resupply & Grocery Lists',
      navigator: '✅ Power-based calories + 18 recipes',
      navigatorCheck: true,
      strava: '❌ None',
      komoot: '❌ None',
      ridewithgps: '❌ None',
      garmin: '❌ None',
    },
    {
      feature: 'Full Vector Offline Maps',
      navigator: '✅ Single-file offline corridor (Free)',
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
        "When you're 40 miles past cell service, hope is not a navigation strategy. Physics-based arrival times, trajectory weather hazards, 4-tier water intelligence, and 100% offline vector mapping under MIT license.",
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
