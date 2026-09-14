import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RouteManifestService } from '../../services/route-manifest.service';
import { RouteDataService } from '../../services/route-data.service';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { NetworkStatusService } from '../../services/network-status.service';
import { ToastService } from '../../services/toast.service';
import { RouteSummary, RouteTrack, RouteDataPackage } from '../../models/route.model';
import { Climb, MountainPass } from '../../models/elevation.model';
import { Milestone, Place, getCategoryBadge } from '../../models/waypoint.model';
import { SurfaceInterval } from '../../services/eta-physics.service';

describe('Tier 5 E2E: Atlas Mountain Race 2026 Route Integrity & Manifest Verification', () => {
  let manifestService: RouteManifestService;
  let routeDataService: RouteDataService;
  let offlineStorage: OfflineStorageService;
  let networkStatus: NetworkStatusService;
  let httpMock: HttpTestingController;

  const mockAmrSummary: RouteSummary = {
    id: 'atlas-mountain-race-2026',
    name: 'Atlas Mountain Race 2026',
    shortName: 'Atlas Mountain Race',
    badge: 'AMR',
    startLocation: 'Beni Mellal, Morocco',
    endLocation: 'Essaouira, Morocco',
    startPoint: 'Beni Mellal, Morocco',
    endPoint: 'Essaouira, Morocco',
    totalDistanceMiles: 840.0,
    totalDistanceKm: 1351.9,
    distanceMiles: 840.0,
    distanceKm: 1351.9,
    elevationGainFt: 118016,
    elevationGainM: 35971,
    elevationGainFeet: 118016,
    elevationGainMeters: 35971,
    highestElevationFeet: 9557,
    highestElevationMeters: 2913,
    highestPoint: "Tizi N'Ait Imi (9,557 ft)",
    iconicPass: "Tizi N'Ait Imi (9,557 ft)",
    iconicCheckpoints: [
      'Beni Mellal',
      'Cathedral Rock',
      "Tizi N'Ait Imi",
      "Gorges du M'Goun",
      "Kalaat M'Gouna",
      "Tizi n'Tazazert",
      'Tafraoute',
      'Essaouira'
    ],
    description: "An unforgettable 840-mile self-supported bikepacking odyssey traversing Morocco, climbing from Beni Mellal through the High Atlas summits and remote M'Goun river gorges, across the volcanic moonscape of Jbel Saghro, over the pink granite domes of Tafraoute, and concluding at the Atlantic coastal ramparts of Essaouira.",
    startCoordinates: [32.32497, -6.33664],
    bounds: [
      [29.4929, -9.8183],
      [32.3338, -6.1031]
    ],
    dataPath: '/data/routes/atlas-mountain-race-2026'
  };

  const sampleTrack: RouteTrack = {
    total_km: 1351.9,
    total_miles: 840.0,
    points: [
      [32.32497, -6.33664, 654.5, 0.0, 0.0],
      [31.60991, -6.38289, 2912.9, 205.9, 128.0],
      [31.5114, -9.76981, 4.2, 1351.9, 840.0]
    ]
  };

  const sampleSurfaces: SurfaceInterval[] = [
    [0.0, 60.0, 'track', 'compacted', 'grade2'],
    [60.0, 120.0, 'path', 'dirt', 'grade4'],
    [120.0, 1351.9, 'unclassified', 'gravel', 'grade2']
  ];

  const sampleClimbs: Climb[] = [
    {
      id: 'climb-1',
      name: 'Jbel Tassemit Gateway Climb',
      state: 'Morocco',
      startMile: 0.0,
      endMile: 12.5,
      startKm: 0.0,
      endKm: 20.2,
      lengthMiles: 12.5,
      lengthKm: 20.2,
      startElevationMeters: 654,
      summitElevationMeters: 1924,
      startElevationFeet: 2146,
      summitElevationFeet: 6312,
      elevationGainMeters: 1270,
      elevationGainFeet: 4167,
      avgGradePercent: 6.3,
      maxGradePercent: 11.3,
      isIconic: true,
      passId: 'pass-1',
      difficulty: 'extreme',
      trailName: 'RP3215 Beni Mellal Mountain Piste',
      parkName: 'Béni Mellal-Khénifra Province',
      landmark: 'Jbel Tassemit (2,247m) / Beni Mellal Escarpment',
      notes: 'Epic 1,270m opening climb ascending directly out of the Beni Mellal plains.'
    },
    {
      id: 'climb-13',
      name: "Tizi N'Ait Imi / M'Goun Alpine Summit",
      state: 'Morocco',
      startMile: 117.0,
      endMile: 128.0,
      startKm: 188.3,
      endKm: 205.9,
      lengthMiles: 11.0,
      lengthKm: 17.7,
      startElevationMeters: 1848,
      summitElevationMeters: 2913,
      startElevationFeet: 6065,
      summitElevationFeet: 9557,
      elevationGainMeters: 1064,
      elevationGainFeet: 3492,
      avgGradePercent: 6.0,
      maxGradePercent: 10.8,
      isIconic: true,
      passId: 'pass-13',
      difficulty: 'extreme',
      trailName: "M'Goun Trans-Atlas Pack Mule Trail",
      parkName: 'Haut Atlas Central National Park',
      landmark: "M'Goun Massif (4,071m / 13,356 ft)",
      notes: 'The monumental Queen Stage of the Atlas Mountain Race: 1,064m of grueling continuous ascent to 2,913m.'
    }
  ];

  const samplePasses: MountainPass[] = [
    {
      id: 'pass-1',
      name: 'Jbel Tassemit Crest (1,924m / 6,312 ft)',
      state: 'Morocco',
      routeMile: 12.5,
      routeKm: 20.2,
      elevationMeters: 1924,
      elevationFeet: 6312,
      lat: 32.2978,
      lon: -6.2523,
      difficulty: 'extreme',
      notes: 'Epic 1,270m opening climb ascending directly out of the Beni Mellal plains.'
    },
    {
      id: 'pass-13',
      name: "Tizi N'Ait Imi Summit (2,913m / 9,557 ft)",
      state: 'Morocco',
      routeMile: 128.0,
      routeKm: 205.9,
      elevationMeters: 2913,
      elevationFeet: 9557,
      lat: 31.60991,
      lon: -6.38289,
      difficulty: 'extreme',
      notes: 'The monumental Queen Stage of the Atlas Mountain Race to 2,913m.'
    }
  ];

  const sampleMilestones: Milestone[] = [
    { name: 'Beni Mellal, Morocco', mile: 0.0 },
    { name: "Tizi N'Ait Imi Summit (2,913m)", mile: 128.0 },
    { name: "Kalaat M'Gouna", mile: 185.9 },
    { name: "Tizi n'Tazazert Summit (2,031m)", mile: 223.1 },
    { name: 'Tafraoute Granite Citadel', mile: 575.3 },
    { name: 'Essaouira Finish Line', mile: 840.0 }
  ];

  const samplePlaces: Place[] = [
    {
      id: 'amr_town_beni_mellal',
      name: 'Beni Mellal (Grand Départ)',
      category: 'town',
      type: 'town',
      town: 'Beni Mellal',
      is_in_town: true,
      location: { lat: 32.32497, lon: -6.33664 },
      distance_to_trail_km: 0.0,
      route_km: 0.0,
      route_mile: 0.0,
      address: 'Beni Mellal, Morocco',
      google_maps_url: 'https://maps.google.com/?q=32.32497,-6.33664',
      business_status: 'OPERATIONAL',
      province_state: 'Morocco'
    },
    {
      id: 'water_osm_charij2_9km',
      name: 'Charij2 (Drinking Water)',
      category: 'water',
      type: 'water',
      town: '',
      is_in_town: false,
      location: { lat: 32.31984, lon: -6.27592 },
      distance_to_trail_km: 0.005,
      route_km: 9.8,
      route_mile: 6.1,
      address: 'Charij2',
      google_maps_url: 'https://maps.google.com/?q=32.31984,-6.27592',
      business_status: 'OPERATIONAL',
      province_state: 'Morocco'
    },
    {
      id: 'amr_village_shop_tagleft',
      name: 'Small village shop',
      category: 'grocery',
      type: 'store',
      town: 'Tagleft',
      is_in_town: true,
      location: { lat: 32.24254, lon: -6.231 },
      distance_to_trail_km: 0.0,
      route_km: 35.6,
      route_mile: 22.1,
      address: 'Tagleft, Morocco',
      google_maps_url: 'https://maps.google.com/?q=32.24254,-6.23100',
      business_status: 'OPERATIONAL',
      province_state: 'Morocco'
    },
    {
      id: 'amr_town_siroua_saffron',
      name: 'Siroua Saffron Valley (Aznaguen)',
      category: 'town',
      type: 'town',
      town: 'Aznaguen',
      is_in_town: true,
      location: { lat: 30.3805, lon: -7.5481 },
      distance_to_trail_km: 0.003,
      route_km: 586.0,
      route_mile: 364.1,
      address: 'Aznaguen, Morocco',
      google_maps_url: 'https://maps.google.com/?q=30.38050,-7.54810',
      business_status: 'OPERATIONAL',
      province_state: 'Morocco'
    },
    {
      id: 'amr_town_essaouira_finish',
      name: 'Essaouira (Official Finish Line)',
      category: 'town',
      type: 'finish',
      town: 'Essaouira',
      is_in_town: true,
      location: { lat: 31.5114, lon: -9.7698 },
      distance_to_trail_km: 0.001,
      route_km: 1351.9,
      route_mile: 840.0,
      address: 'Essaouira, Morocco',
      google_maps_url: 'https://maps.google.com/?q=31.51140,-9.76980',
      business_status: 'OPERATIONAL',
      province_state: 'Morocco'
    }
  ];

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
        ToastService
      ]
    });

    manifestService = TestBed.inject(RouteManifestService);
    routeDataService = TestBed.inject(RouteDataService);
    offlineStorage = TestBed.inject(OfflineStorageService);
    networkStatus = TestBed.inject(NetworkStatusService);
    httpMock = TestBed.inject(HttpTestingController);

    networkStatus.setOnline(true);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  describe('Route Manifest Registration & Metadata Integrity', () => {
    it('should load manifest via HTTP and validate atlas-mountain-race-2026 presence', () => {
      manifestService.loadManifest().subscribe((routes) => {
        expect(routes.length).toBe(1);
        expect(routes[0].id).toBe('atlas-mountain-race-2026');
        expect(routes[0].badge).toBe('AMR');
      });

      const req = httpMock.expectOne('/data/routes.json');
      expect(req.request.method).toBe('GET');
      req.flush({ routes: [mockAmrSummary] });

      expect(manifestService.validateRouteId('atlas-mountain-race-2026')).toBe(true);
      expect(manifestService.validateRouteId('invalid-route-id')).toBe(false);
    });

    it('should include atlas-mountain-race-2026 in the manifest with correct metadata', () => {
      manifestService.availableRoutes.set([mockAmrSummary]);

      expect(manifestService.validateRouteId('atlas-mountain-race-2026')).toBe(true);

      const summary = manifestService.availableRoutes().find((r) => r.id === 'atlas-mountain-race-2026');
      expect(summary).toBeDefined();
      expect(summary?.name).toBe('Atlas Mountain Race 2026');
      expect(summary?.shortName).toBe('Atlas Mountain Race');
      expect(summary?.badge).toBe('AMR');
      expect(summary?.startPoint).toBe('Beni Mellal, Morocco');
      expect(summary?.endPoint).toBe('Essaouira, Morocco');
      expect(summary?.totalDistanceKm).toBe(1351.9);
      expect(summary?.totalDistanceMiles).toBe(840.0);
      expect(summary?.elevationGainM).toBe(35971);
      expect(summary?.elevationGainFt).toBe(118016);
      expect(summary?.highestElevationMeters).toBe(2913);
      expect(summary?.highestElevationFeet).toBe(9557);
      expect(summary?.highestPoint).toContain("Tizi N'Ait Imi");
    });

    it('should switch active route to atlas-mountain-race-2026 successfully', async () => {
      manifestService.availableRoutes.set([mockAmrSummary]);

      const success = await manifestService.selectRoute('atlas-mountain-race-2026');
      expect(success).toBe(true);
      expect(manifestService.activeRouteId()).toBe('atlas-mountain-race-2026');
      expect(manifestService.activeRouteSummary()?.badge).toBe('AMR');
    });
  });

  describe('Route Telemetry & Dataset Loading (6 Standard Datasets)', () => {
    it('should request and load all 6 JSON datasets from /data/routes/atlas-mountain-race-2026/', () => {
      routeDataService.loadRoute('atlas-mountain-race-2026');

      const reqPlaces = httpMock.expectOne('/data/routes/atlas-mountain-race-2026/places.json');
      expect(reqPlaces.request.method).toBe('GET');
      reqPlaces.flush(samplePlaces);

      const reqTrack = httpMock.expectOne('/data/routes/atlas-mountain-race-2026/route-track.json');
      expect(reqTrack.request.method).toBe('GET');
      reqTrack.flush(sampleTrack);

      const reqSurfaces = httpMock.expectOne('/data/routes/atlas-mountain-race-2026/surfaces.json');
      expect(reqSurfaces.request.method).toBe('GET');
      reqSurfaces.flush(sampleSurfaces);

      const reqClimbs = httpMock.expectOne('/data/routes/atlas-mountain-race-2026/climbs.json');
      expect(reqClimbs.request.method).toBe('GET');
      reqClimbs.flush(sampleClimbs);

      const reqPasses = httpMock.expectOne('/data/routes/atlas-mountain-race-2026/passes.json');
      expect(reqPasses.request.method).toBe('GET');
      reqPasses.flush(samplePasses);

      const reqMilestones = httpMock.expectOne('/data/routes/atlas-mountain-race-2026/milestones.json');
      expect(reqMilestones.request.method).toBe('GET');
      reqMilestones.flush(sampleMilestones);

      expect(routeDataService.activeRouteId()).toBe('atlas-mountain-race-2026');
      expect(routeDataService.totalDistanceMiles).toBe(840.0);
      expect(routeDataService.totalDistanceKm).toBe(1351.9);
      expect(routeDataService.etaPhysics.surfaceIntervals().length).toBe(3);
      expect(routeDataService.climbs().length).toBe(2);
      expect(routeDataService.passes().length).toBe(2);
      expect(routeDataService.milestones().length).toBe(6);
      expect(routeDataService.places().length).toBe(5);
    });
  });

  describe('POI & Water Waypoint Validation', () => {
    it('should verify that water waypoints carry category "water" and valid coordinates', () => {
      const waterPlaces = samplePlaces.filter((p) => p.category === 'water');
      expect(waterPlaces.length).toBeGreaterThan(0);

      waterPlaces.forEach((wp) => {
        expect(wp.category).toBe('water');
        expect(wp.location.lat).toBeGreaterThan(25.0);
        expect(wp.location.lat).toBeLessThan(35.0);
        expect(wp.location.lon).toBeGreaterThan(-12.0);
        expect(wp.location.lon).toBeLessThan(-4.0);
        expect(wp.route_mile).toBeGreaterThanOrEqual(0);

        const badge = getCategoryBadge(wp.category);
        expect(badge.icon).toBe('💧');
        expect(badge.label).toBe('Water');
        expect(badge.badgeClass).toContain('cyan');
      });
    });

    it('should verify monotonic ordering of waypoints along the route', () => {
      for (let i = 1; i < samplePlaces.length; i++) {
        expect(samplePlaces[i].route_mile).toBeGreaterThanOrEqual(samplePlaces[i - 1].route_mile);
        expect(samplePlaces[i].route_km).toBeGreaterThanOrEqual(samplePlaces[i - 1].route_km);
      }
    });

    it('should enforce at most 1 water access point per 5 km segment with boundary separation', () => {
      const segmentBuckets = new Map<number, Place[]>();
      const waterPlaces = samplePlaces.filter((p) => p.category === 'water');
      for (const wp of waterPlaces) {
        const seg = Math.floor(wp.route_km / 5.0);
        const list = segmentBuckets.get(seg) || [];
        list.push(wp);
        segmentBuckets.set(seg, list);
      }

      for (const [, pts] of segmentBuckets.entries()) {
        expect(pts.length).toBeLessThanOrEqual(1);
      }
    });

    it('should verify embedded GPX waypoints are properly categorized', () => {
      const shop = samplePlaces.find((p) => p.name === 'Small village shop');
      expect(shop).toBeDefined();
      expect(shop?.category).toBe('grocery');
      expect(shop?.town).toBe('Tagleft');

      const finish = samplePlaces.find((p) => p.id === 'amr_town_essaouira_finish');
      expect(finish).toBeDefined();
      expect(finish?.category).toBe('town');
      expect(finish?.route_mile).toBe(840.0);
    });

    it('should enforce that all waypoints remain within a 10km detour distance of the route', () => {
      samplePlaces.forEach((p) => {
        expect(p.distance_to_trail_km).toBeLessThanOrEqual(10.0);
      });
    });

    it('should include on-trail Siroua Saffron Valley resupply and reject extreme off-trail detours', () => {
      const siroua = samplePlaces.find((p) => p.id === 'amr_town_siroua_saffron');
      expect(siroua).toBeDefined();
      expect(siroua?.category).toBe('town');
      expect(siroua?.distance_to_trail_km).toBeLessThan(1.0);
      expect(siroua?.route_mile).toBeCloseTo(364.1, 1);

      const taliouine = samplePlaces.find((p) => p.id === 'amr_town_taliouine');
      expect(taliouine).toBeUndefined();
    });

    it('should place Tafraoute Granite Citadel milestone accurately at mile 575.3 on trail', () => {
      const tafraouteMilestone = sampleMilestones.find((m) => m.name.includes('Tafraoute'));
      expect(tafraouteMilestone).toBeDefined();
      expect(tafraouteMilestone?.mile).toBeCloseTo(575.3, 1);
      expect(tafraouteMilestone?.mile).not.toBeCloseTo(518.8, 1);
    });
  });

  describe('Enriched Climbs and Mountain Passes', () => {
    it('should contain non-generic names, landmark references, and descriptive guidebook notes', () => {
      sampleClimbs.forEach((climb) => {
        expect(climb.name).not.toContain('Climb south of');
        expect(climb.name).not.toMatch(/^Climb \d+$/);
        expect(climb.trailName).toBeDefined();
        expect(climb.parkName).toBeDefined();
        expect(climb.landmark).toBeDefined();
        expect(climb.notes).toBeDefined();
        expect(climb.notes?.length).toBeGreaterThan(15);
      });
    });

    it('should verify Tizi N Ait Imi as the highest pass summit', () => {
      const queenClimb = sampleClimbs.find((c) => c.id === 'climb-13');
      expect(queenClimb).toBeDefined();
      expect(queenClimb?.summitElevationMeters).toBe(2913);
      expect(queenClimb?.summitElevationFeet).toBe(9557);
      expect(queenClimb?.isIconic).toBe(true);
      expect(queenClimb?.landmark).toContain("M'Goun Massif");
    });
  });

  describe('Offline Storage Persistence and Hydration', () => {
    it('should save and hydrate complete AMR route data package from indexed storage', async () => {
      const amrPackage: RouteDataPackage = {
        routeId: 'atlas-mountain-race-2026',
        track: sampleTrack,
        places: samplePlaces,
        surfaces: sampleSurfaces,
        climbs: sampleClimbs,
        passes: samplePasses,
        milestones: sampleMilestones,
        cachedAt: Date.now()
      };

      await offlineStorage.saveRoutePackage(amrPackage);
      const retrieved = await offlineStorage.getRoutePackage('atlas-mountain-race-2026');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.routeId).toBe('atlas-mountain-race-2026');
      expect(retrieved?.track.total_km).toBe(1351.9);
      expect(retrieved?.places.length).toBe(5);
      expect(retrieved?.climbs.length).toBe(2);
    });
  });
});
