import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteManifestService } from '../../services/route-manifest.service';
import { RouteDataService } from '../../services/route-data.service';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { NetworkStatusService } from '../../services/network-status.service';
import { EtaPhysicsService, SurfaceInterval } from '../../services/eta-physics.service';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { RouteSummary, RouteTrack, RouteDataPackage } from '../../models/route.model';
import { Climb, MountainPass } from '../../models/elevation.model';
import { Milestone, Place, getCategoryBadge } from '../../models/waypoint.model';

describe('Tier 5 E2E: Arizona Trail Race 300 (2025) Route Integrity & Manifest Verification', () => {
  let manifestService: RouteManifestService;
  let routeDataService: RouteDataService;
  let offlineStorage: OfflineStorageService;
  let networkStatus: NetworkStatusService;
  let etaPhysics: EtaPhysicsService;
  let httpMock: HttpTestingController;

  const mockAztSummary: RouteSummary = {
    id: 'arizona-trail-300',
    name: 'Arizona Trail Race 300 (2025)',
    shortName: 'Arizona Trail 300',
    badge: 'AZT',
    startLocation: 'Coronado National Memorial, AZ',
    endLocation: 'Picketpost Trailhead (Superior), AZ',
    totalDistanceMiles: 305.0,
    totalDistanceKm: 490.8,
    elevationGainFt: 40866,
    elevationGainM: 12456,
    highestElevationFeet: 8234,
    highestElevationMeters: 2510,
    highestPoint: 'Mount Lemmon / Dan Saddle (8,234 ft)',
    iconicPass: 'Mount Lemmon / Dan Saddle (8,234 ft)',
    iconicCheckpoints: [
      'Coronado National Memorial',
      'Canelo Pass',
      'Patagonia',
      'Kentucky Camp',
      'Colossal Cave',
      'Redington Pass',
      'Mount Lemmon (Dan Saddle)',
      'Oracle',
      'Freeman Road Cache',
      'Ripsey Ridge',
      'Gila River (Kelvin)',
      'Picketpost Trailhead'
    ],
    description: "The premier 300-mile self-supported bikepacking race across southern Arizona's rugged Sky Islands.",
    startCoordinates: [31.33874, -110.3379],
    bounds: [
      [31.3387, -111.1763],
      [33.272, -110.3319]
    ],
    dataPath: '/data/routes/arizona-trail-300'
  };

  const sampleSurfaces: SurfaceInterval[] = [
    [0.0, 14.7, 'path', 'ground', 'grade4'],
    [14.7, 37.6, 'track', 'gravel', 'grade2'],
    [37.6, 64.5, 'path', 'dirt', 'grade4'],
    [64.5, 81.8, 'unclassified', 'gravel', 'grade2'],
    [81.8, 83.5, 'residential', 'asphalt', 'grade1'],
    [83.5, 110.0, 'track', 'gravel', 'grade3'],
    [110.0, 140.7, 'path', 'ground', 'grade3'],
    [140.7, 165.0, 'track', 'compacted', 'grade2'],
    [165.0, 201.8, 'path', 'dirt', 'grade4'],
    [201.8, 226.5, 'unclassified', 'gravel', 'grade2'],
    [226.5, 246.0, 'track', 'gravel', 'grade3'],
    [246.0, 270.5, 'track', 'unpaved', 'grade3'],
    [270.5, 296.6, 'path', 'ground', 'grade4'],
    [296.6, 314.0, 'path', 'dirt', 'grade4'],
    [314.0, 330.2, 'track', 'compacted', 'grade2'],
    [330.2, 384.3, 'path', 'dirt', 'grade4'],
    [384.3, 419.7, 'path', 'ground', 'grade4'],
    [419.7, 428.6, 'path', 'dirt', 'grade4'],
    [428.6, 455.8, 'track', 'gravel', 'grade2'],
    [455.8, 490.8, 'path', 'ground', 'grade4']
  ];

  const sampleClimbs: Climb[] = [
    {
      id: 'climb-1',
      name: 'Montezuma Canyon Saddle',
      state: 'AZ',
      startMile: 0.0,
      endMile: 2.4,
      startKm: 0.0,
      endKm: 3.9,
      lengthMiles: 2.4,
      lengthKm: 3.9,
      startElevationMeters: 1635,
      summitElevationMeters: 1762,
      startElevationFeet: 5364,
      summitElevationFeet: 5782,
      elevationGainMeters: 127,
      elevationGainFeet: 418,
      avgGradePercent: 3.3,
      maxGradePercent: 5.9,
      isIconic: false,
      passId: 'pass-1',
      difficulty: 'moderate',
      notes: 'Ascends gently from the US-Mexico border through Montezuma Canyon.',
      trailName: 'AZT Passage 1 - Huachuca Mountains',
      parkName: 'Coronado National Memorial',
      landmark: 'Montezuma Peak / Coronado Peak'
    },
    {
      id: 'climb-21',
      name: 'Mount Lemmon & Dan Saddle Ascent',
      state: 'AZ',
      startMile: 168.0,
      endMile: 184.3,
      startKm: 270.4,
      endKm: 296.6,
      lengthMiles: 16.3,
      lengthKm: 26.2,
      startElevationMeters: 1319,
      summitElevationMeters: 2510,
      startElevationFeet: 4327,
      summitElevationFeet: 8234,
      elevationGainMeters: 1191,
      elevationGainFeet: 3912,
      avgGradePercent: 4.5,
      maxGradePercent: 8.1,
      isIconic: true,
      passId: 'pass-21',
      difficulty: 'extreme',
      notes: 'The monumental alpine climb of the AZT 300, gaining nearly 4,000 feet to Dan Saddle.',
      trailName: 'AZT Passage 11 - Santa Catalina Mountains',
      parkName: 'Coronado National Forest',
      landmark: 'Mount Lemmon / Dan Saddle (8,234 ft)'
    },
    {
      id: 'climb-27',
      name: 'Ripsey Ridge Summit & Crest',
      state: 'AZ',
      startMile: 258.5,
      endMile: 260.8,
      startKm: 416.0,
      endKm: 419.8,
      lengthMiles: 2.3,
      lengthKm: 3.7,
      startElevationMeters: 860,
      summitElevationMeters: 1084,
      startElevationFeet: 2822,
      summitElevationFeet: 3556,
      elevationGainMeters: 224,
      elevationGainFeet: 735,
      avgGradePercent: 6.1,
      maxGradePercent: 11.0,
      isIconic: true,
      passId: 'pass-27',
      difficulty: 'difficult',
      notes: 'The crown jewel of Sonoran Desert singletrack: 23 switchbacks with 360-degree desert panoramas.',
      trailName: 'AZT Passage 15 - Tortilla Mountains / Ripsey',
      parkName: 'Bureau of Land Management',
      landmark: 'Ripsey Ridge / Gila River Basin'
    }
  ];

  const samplePasses: MountainPass[] = [
    {
      id: 'pass-1',
      name: 'Montezuma Canyon Saddle (5,782 ft)',
      state: 'AZ',
      routeMile: 2.4,
      routeKm: 3.9,
      elevationMeters: 1762,
      elevationFeet: 5782,
      lat: 31.37194,
      lon: -110.33227,
      difficulty: 'moderate',
      notes: 'Border monument saddle opening the southern gateway of the Arizona Trail.'
    },
    {
      id: 'pass-21',
      name: 'Mount Lemmon / Dan Saddle (8,234 ft)',
      state: 'AZ',
      routeMile: 184.3,
      routeKm: 296.6,
      elevationMeters: 2510,
      elevationFeet: 8234,
      lat: 32.41541,
      lon: -110.73146,
      difficulty: 'extreme',
      notes: 'The highest elevation point of the Arizona Trail Race 300.'
    },
    {
      id: 'pass-27',
      name: 'Ripsey Ridge Summit (3,556 ft)',
      state: 'AZ',
      routeMile: 260.8,
      routeKm: 419.8,
      elevationMeters: 1084,
      elevationFeet: 3556,
      lat: 32.9642,
      lon: -110.9845,
      difficulty: 'difficult',
      notes: 'Iconic panoramic ridgeline summit overlooking the Gila River basin.'
    }
  ];

  const sampleMilestones: Milestone[] = [
    { name: 'Coronado National Memorial, AZ', mile: 0.0 },
    { name: 'Parker Canyon Lake, AZ', mile: 20.1 },
    { name: 'Canelo Pass Trailhead, AZ', mile: 24.8 },
    { name: 'Patagonia, AZ', mile: 49.8 },
    { name: 'Kentucky Camp, AZ', mile: 76.3 },
    { name: 'Colossal Cave Mountain Park, AZ', mile: 115.9 },
    { name: 'Redington Pass Summit, AZ', mile: 152.9 },
    { name: 'Mount Lemmon (Dan Saddle), AZ', mile: 184.3 },
    { name: 'Oracle (Tiger Mine Trailhead), AZ', mile: 211.9 },
    { name: 'Freeman Road Water Cache, AZ', mile: 238.8 },
    { name: 'Ripsey Ridge Summit, AZ', mile: 260.8 },
    { name: 'Kelvin / Gila River Crossing, AZ', mile: 270.8 },
    { name: 'Picketpost Trailhead (Superior), AZ', mile: 305.0 }
  ];

  const samplePlaces: Place[] = [
    {
      id: 'azt-poi-1',
      name: 'Montezuma Pass Trailhead & Rest Area',
      category: 'campground',
      type: 'campground',
      town: 'Coronado National Memorial',
      is_in_town: false,
      location: { lat: 31.3719, lon: -110.3323 },
      distance_to_trail_km: 0.0,
      route_km: 3.9,
      route_mile: 2.4
    },
    {
      id: 'azt-poi-2',
      name: 'Patagonia Bike Repair & Supply',
      category: 'bike_shop',
      type: 'bike_shop',
      town: 'Patagonia',
      is_in_town: true,
      location: { lat: 31.5432, lon: -110.7512 },
      distance_to_trail_km: 6.41,
      route_km: 80.2,
      route_mile: 49.8
    },
    {
      id: 'town_patagonia',
      name: 'Patagonia',
      category: 'town',
      type: 'town',
      town: 'Patagonia',
      is_in_town: true,
      location: { lat: 31.5432, lon: -110.7512 },
      distance_to_trail_km: 6.18,
      route_km: 80.2,
      route_mile: 49.8
    },
    {
      id: 'azt-poi-3',
      name: 'Historic Kentucky Camp Caretaker & Water',
      category: 'water',
      type: 'water',
      town: 'Greaterville',
      is_in_town: false,
      location: { lat: 31.7412, lon: -110.7421 },
      distance_to_trail_km: 0.01,
      route_km: 122.8,
      route_mile: 76.3
    },
    {
      id: 'azt-poi-4',
      name: 'Mount Lemmon General Store',
      category: 'grocery',
      type: 'grocery',
      town: 'Summerhaven',
      is_in_town: true,
      location: { lat: 32.4431, lon: -110.7612 },
      distance_to_trail_km: 0.1,
      route_km: 303.3,
      route_mile: 188.5
    },
    {
      id: 'azt-poi-5',
      name: 'Picketpost Trailhead & Campground',
      category: 'campground',
      type: 'campground',
      town: 'Superior',
      is_in_town: false,
      location: { lat: 33.272, lon: -111.1763 },
      distance_to_trail_km: 0.0,
      route_km: 490.8,
      route_mile: 305.0
    }
  ];

  const sampleTrack: RouteTrack = {
    total_km: 490.8,
    total_miles: 305.0,
    points: [
      [31.33874, -110.3379, 1634.7, 0.0, 0.0],
      [31.37194, -110.33227, 1762.0, 3.9, 2.4],
      [31.5432, -110.7512, 1296.0, 80.2, 49.8],
      [32.41541, -110.73146, 2510.0, 296.6, 184.3],
      [32.9642, -110.9845, 1084.0, 419.8, 260.8],
      [33.27197, -111.17626, 729.0, 490.8, 305.0]
    ]
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RouteManifestService,
        RouteDataService,
        OfflineStorageService,
        NetworkStatusService,
        EtaPhysicsService,
        SettingsService,
        ToastService
      ]
    });

    manifestService = TestBed.inject(RouteManifestService);
    routeDataService = TestBed.inject(RouteDataService);
    offlineStorage = TestBed.inject(OfflineStorageService);
    networkStatus = TestBed.inject(NetworkStatusService);
    etaPhysics = TestBed.inject(EtaPhysicsService);
    httpMock = TestBed.inject(HttpTestingController);

    networkStatus.setOnline(true);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  describe('1. Route Manifest Registration Contract', () => {
    it('1.1 should load manifest with arizona-trail-300 and validate route ID', () => {
      manifestService.loadManifest().subscribe((routes) => {
        expect(routes.length).toBe(1);
        expect(routes[0].id).toBe('arizona-trail-300');
        expect(routes[0].badge).toBe('AZT');
      });

      const req = httpMock.expectOne('/data/routes.json');
      req.flush({ routes: [mockAztSummary] });

      expect(manifestService.validateRouteId('arizona-trail-300')).toBe(true);
      expect(manifestService.validateRouteId('nonexistent-route')).toBe(false);
    });

    it('1.2 should select arizona-trail-300 and set active summary', async () => {
      manifestService.availableRoutes.set([mockAztSummary]);
      const success = await manifestService.selectRoute('arizona-trail-300');

      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('arizona-trail-300');
      const summary = manifestService.activeRouteSummary();
      expect(summary).not.toBeNull();
      expect(summary?.name).toBe('Arizona Trail Race 300 (2025)');
      expect(summary?.totalDistanceMiles).toBe(305.0);
      expect(summary?.elevationGainFt).toBe(40866);
      expect(summary?.highestElevationFeet).toBe(8234);
    });

    it('1.3 should enforce valid bounding coordinates covering southern Arizona', () => {
      const [sw, ne] = mockAztSummary.bounds;
      expect(sw[0]).toBeLessThan(ne[0]);
      expect(sw[1]).toBeLessThan(ne[1]);
      expect(sw[0]).toBe(31.3387);
      expect(ne[0]).toBe(33.272);
      expect(sw[1]).toBe(-111.1763);
      expect(ne[1]).toBe(-110.3319);
    });
  });

  describe('2. Standardized Static Route Datasets Contract', () => {
    it('2.1 surfaces: should verify contiguous intervals from 0 to 490.8 km', () => {
      let currentKm = 0.0;
      for (const [startKm, endKm, roadClass, surface, tracktype] of sampleSurfaces) {
        expect(startKm).toBeCloseTo(currentKm, 1);
        expect(endKm).toBeGreaterThan(startKm);
        expect(typeof roadClass).toBe('string');
        expect(typeof surface).toBe('string');
        expect(typeof tracktype).toBe('string');
        currentKm = endKm;
      }
      expect(currentKm).toBeCloseTo(490.8, 1);
    });

    it('2.2 climbs: should verify authentic guidebook attributes and iconic climbs', () => {
      for (const climb of sampleClimbs) {
        expect(climb.id).toBeTruthy();
        expect(climb.name).toBeTruthy();
        expect(climb.startMile).toBeLessThan(climb.endMile);
        expect(climb.elevationGainMeters).toBeGreaterThan(0);
        expect(climb.notes).toBeTruthy();
        expect(climb.trailName).toBeTruthy();
        expect(climb.parkName).toBeTruthy();
        expect(climb.landmark).toBeTruthy();
      }

      const iconic = sampleClimbs.filter((c) => c.isIconic);
      expect(iconic.length).toBe(2);
      expect(iconic.map((c) => c.name)).toContain('Mount Lemmon & Dan Saddle Ascent');
      expect(iconic.map((c) => c.name)).toContain('Ripsey Ridge Summit & Crest');
    });

    it('2.3 passes: should verify named checkpoints and difficulty classification', () => {
      for (const pass of samplePasses) {
        expect(pass.id).toBeTruthy();
        expect(pass.name).toBeTruthy();
        expect(pass.state).toBe('AZ');
        expect(pass.elevationFeet).toBeGreaterThan(3000);
        expect(['moderate', 'difficult', 'extreme']).toContain(pass.difficulty);
      }
    });

    it('2.4 milestones: should be monotonically ordered from start (0.0) to finish (305.0)', () => {
      let prevMile = -1;
      const names = new Set<string>();

      for (const m of sampleMilestones) {
        expect(m.name).toBeTruthy();
        expect(names.has(m.name)).toBe(false);
        names.add(m.name);
        expect(m.mile).toBeGreaterThanOrEqual(prevMile);
        prevMile = m.mile;
      }

      expect(sampleMilestones[0].mile).toBe(0.0);
      expect(sampleMilestones[sampleMilestones.length - 1].mile).toBe(305.0);
    });

    it('2.5 places: should include resupply POIs sorted by trail mile', () => {
      let prevMile = -1;
      for (const p of samplePlaces) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(['campground', 'bike_shop', 'water', 'grocery', 'town']).toContain(p.category);
        expect(p.location.lat).toBeGreaterThan(31.0);
        expect(p.location.lon).toBeLessThan(-110.0);
        expect(p.distance_to_trail_km).toBeLessThanOrEqual(10.0);
        expect(p.route_mile).toBeGreaterThanOrEqual(prevMile);
        prevMile = p.route_mile;
      }
    });
  });

  describe('3. Application Services & Physics Integration', () => {
    it('3.1 should load full AZT package into RouteDataService and EtaPhysicsService', () => {
      routeDataService.loadRoute('arizona-trail-300');

      httpMock.expectOne('/data/routes/arizona-trail-300/places.json').flush(samplePlaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/route-track.json').flush(sampleTrack);
      httpMock.expectOne('/data/routes/arizona-trail-300/surfaces.json').flush(sampleSurfaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/climbs.json').flush(sampleClimbs);
      httpMock.expectOne('/data/routes/arizona-trail-300/passes.json').flush(samplePasses);
      httpMock.expectOne('/data/routes/arizona-trail-300/milestones.json').flush(sampleMilestones);

      expect(routeDataService.activeRouteId()).toBe('arizona-trail-300');
      expect(routeDataService.totalDistanceMiles).toBe(305.0);
      expect(routeDataService.places().length).toBe(6);
      expect(routeDataService.climbs().length).toBe(3);
      expect(routeDataService.passes().length).toBe(3);
      expect(routeDataService.milestones().length).toBe(13);

      expect(etaPhysics.surfaceIntervals().length).toBe(20);
      expect(etaPhysics.trackPoints().length).toBe(6);

      // Verify surface lookup on AZT segments
      const startSurf = etaPhysics.getSurfaceAtKm(5.0);
      expect(startSurf.roadClass).toBe('path');
      expect(startSurf.surface).toBe('ground');

      const patagoniaSurf = etaPhysics.getSurfaceAtKm(82.5);
      expect(patagoniaSurf.roadClass).toBe('residential');
      expect(patagoniaSurf.surface).toBe('asphalt');
    });

    it('3.2 should compute valid rolling resistance Crr and riding speeds for AZT terrain', () => {
      const asphaltCrr = etaPhysics.getCrr('asphalt', 'grade1', 'residential');
      const singletrackCrr = etaPhysics.getCrr('ground', 'grade4', 'path');

      expect(asphaltCrr).toBeCloseTo(0.0055, 4);
      expect(singletrackCrr).toBeGreaterThan(asphaltCrr * 4);

      // Newton-Raphson speed solver for 200W flat
      const speedFlat = etaPhysics.solveRidingSpeed(200, 0, singletrackCrr, 85);
      expect(speedFlat).toBeGreaterThan(12);
      expect(speedFlat).toBeLessThan(25);

      // Steep climb on Mount Lemmon (+8% grade, 250W)
      const speedClimb = etaPhysics.solveRidingSpeed(250, 0.08, singletrackCrr, 85);
      expect(speedClimb).toBeGreaterThan(5);
      expect(speedClimb).toBeLessThan(12);
    });

    it('3.3 should persist and retrieve AZT package in OfflineStorageService', async () => {
      const pkg: RouteDataPackage = {
        routeId: 'arizona-trail-300',
        track: sampleTrack,
        places: samplePlaces,
        surfaces: sampleSurfaces,
        climbs: sampleClimbs,
        passes: samplePasses,
        milestones: sampleMilestones,
        cachedAt: Date.now()
      };

      await offlineStorage.saveRoutePackage(pkg);

      const isCached = await offlineStorage.isRouteCached('arizona-trail-300');
      expect(isCached).toBe(true);

      const retrieved = await offlineStorage.getRoutePackage('arizona-trail-300');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.routeId).toBe('arizona-trail-300');
      expect(retrieved?.track.points.length).toBe(6);
      expect(retrieved?.climbs.length).toBe(3);
      expect(retrieved?.passes.length).toBe(3);
      expect(retrieved?.milestones.length).toBe(13);
      expect(retrieved?.places.length).toBe(6);
    });

    it('3.4 should calculate waypoints ahead including water sources under default categories with cyan water badge', () => {
      routeDataService.loadRoute('arizona-trail-300');

      httpMock.expectOne('/data/routes/arizona-trail-300/places.json').flush(samplePlaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/route-track.json').flush(sampleTrack);
      httpMock.expectOne('/data/routes/arizona-trail-300/surfaces.json').flush(sampleSurfaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/climbs.json').flush(sampleClimbs);
      httpMock.expectOne('/data/routes/arizona-trail-300/passes.json').flush(samplePasses);
      httpMock.expectOne('/data/routes/arizona-trail-300/milestones.json').flush(sampleMilestones);

      const defaultFilters = new Set([
        'town', 'grocery', 'food', 'campground', 'hotel', 'bike_shop', 'gas_station', 'pharmacy', 'laundromat'
      ]);

      const waypoints = routeDataService.calculateWaypointsAhead(0, 10, defaultFilters, 50);
      const waterWp = waypoints.find((w) => w.category === 'water');
      expect(waterWp).toBeDefined();
      expect(waterWp?.name).toContain('Kentucky Camp');

      const badge = getCategoryBadge('water');
      expect(badge.icon).toBe('💧');
      expect(badge.label).toBe('Water');
      expect(badge.badgeClass).toContain('text-cyan-400');
    });

    it('3.5 should filter waypoints by town returning town checkpoints along route', () => {
      routeDataService.loadRoute('arizona-trail-300');

      httpMock.expectOne('/data/routes/arizona-trail-300/places.json').flush(samplePlaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/route-track.json').flush(sampleTrack);
      httpMock.expectOne('/data/routes/arizona-trail-300/surfaces.json').flush(sampleSurfaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/climbs.json').flush(sampleClimbs);
      httpMock.expectOne('/data/routes/arizona-trail-300/passes.json').flush(samplePasses);
      httpMock.expectOne('/data/routes/arizona-trail-300/milestones.json').flush(sampleMilestones);

      const townWaypoints = routeDataService.calculateWaypointsAhead(0, 10, new Set(['town']), 50);
      expect(townWaypoints.length).toBe(1);
      expect(townWaypoints[0].name).toBe('Patagonia');
      expect(townWaypoints[0].category).toBe('town');
    });

    it('3.6 should cleanly switch between Tour Divide, Arizona Trail 300, and Colorado Trail without state leakage', () => {
      // 1. Load Tour Divide 2025
      routeDataService.loadRoute('tour-divide-2025');
      httpMock.expectOne('/data/routes/tour-divide-2025/places.json').flush([]);
      httpMock.expectOne('/data/routes/tour-divide-2025/route-track.json').flush({ total_km: 4311.8, total_miles: 2679.2, points: [[51.16, -115.56, 1400, 0, 0]] });
      httpMock.expectOne('/data/routes/tour-divide-2025/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/tour-divide-2025/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/tour-divide-2025/passes.json').flush([]);
      httpMock.expectOne('/data/routes/tour-divide-2025/milestones.json').flush([]);

      expect(routeDataService.activeRouteId()).toBe('tour-divide-2025');
      expect(routeDataService.totalDistanceMiles).toBe(2679.2);

      // 2. Switch to Arizona Trail 300
      routeDataService.loadRoute('arizona-trail-300');
      httpMock.expectOne('/data/routes/arizona-trail-300/places.json').flush(samplePlaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/route-track.json').flush(sampleTrack);
      httpMock.expectOne('/data/routes/arizona-trail-300/surfaces.json').flush(sampleSurfaces);
      httpMock.expectOne('/data/routes/arizona-trail-300/climbs.json').flush(sampleClimbs);
      httpMock.expectOne('/data/routes/arizona-trail-300/passes.json').flush(samplePasses);
      httpMock.expectOne('/data/routes/arizona-trail-300/milestones.json').flush(sampleMilestones);

      expect(routeDataService.activeRouteId()).toBe('arizona-trail-300');
      expect(routeDataService.totalDistanceMiles).toBe(305.0);
      expect(routeDataService.places().length).toBe(6);
      expect(routeDataService.climbs().length).toBe(3);

      // 3. Switch to Colorado Trail
      routeDataService.loadRoute('colorado-trail');
      httpMock.expectOne('/data/routes/colorado-trail/places.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/route-track.json').flush({ total_km: 828.4, total_miles: 514.7, points: [[39.49, -105.09, 1675, 0, 0]] });
      httpMock.expectOne('/data/routes/colorado-trail/surfaces.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/climbs.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/passes.json').flush([]);
      httpMock.expectOne('/data/routes/colorado-trail/milestones.json').flush([]);

      expect(routeDataService.activeRouteId()).toBe('colorado-trail');
      expect(routeDataService.totalDistanceMiles).toBe(514.7);
      expect(routeDataService.places().length).toBe(0);
      expect(routeDataService.climbs().length).toBe(0);

      // 4. Unload route
      routeDataService.unloadRoute();
      expect(routeDataService.activeRouteId()).toBeNull();
      expect(routeDataService.totalDistanceMiles).toBe(0);
      expect(routeDataService.trackPoints().length).toBe(0);
    });
  });
});
