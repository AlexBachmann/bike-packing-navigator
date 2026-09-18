import { TestBed } from '@angular/core/testing';
import {
  computeProximityAlerts,
  findNextLookahead,
  formatAlertText,
  normalizeCategory,
  chunkProximityDistance,
  PROXIMITY_DISTANCE_CHUNKS,
  ProximityAlertService,
  METERS_PER_MILE
} from './proximity-alert.service';
import { Place } from '../models/waypoint.model';

describe('ProximityAlertService & computeProximityAlerts', () => {
  let service: ProximityAlertService;

  const createPlace = (overrides: Partial<Place>): Place => ({
    id: 'p-1',
    name: 'Sample Place',
    category: 'water',
    type: 'spring',
    is_in_town: false,
    location: { lat: 39.5, lon: -105.1 },
    distance_to_trail_km: 0,
    route_km: 16.09344,
    route_mile: 10.0,
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProximityAlertService]
    });
    service = TestBed.inject(ProximityAlertService);
  });

  describe('normalizeCategory', () => {
    it('should normalize spaces, underscores, and category synonyms', () => {
      expect(normalizeCategory('gas station')).toBe('gas_station');
      expect(normalizeCategory('gas_station')).toBe('gas_station');
      expect(normalizeCategory('grocery store')).toBe('grocery');
      expect(normalizeCategory('grocery')).toBe('grocery');
      expect(normalizeCategory('recreation site')).toBe('campground');
      expect(normalizeCategory('rec site')).toBe('campground');
      expect(normalizeCategory('camping')).toBe('campground');
      expect(normalizeCategory('campground')).toBe('campground');
      expect(normalizeCategory('laundry')).toBe('laundromat');
      expect(normalizeCategory('laundromat')).toBe('laundromat');
      expect(normalizeCategory('bike shop')).toBe('bike_shop');
      expect(normalizeCategory('water')).toBe('water');
    });
  });

  describe('Tier 0: Position 0m to 50m Alert Suppression', () => {
    it('should suppress all proximity alerts when rider is at position 0m', () => {
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Trailhead Water', route_mile: 100 / METERS_PER_MILE }),
        createPlace({ id: 'c1', name: 'Start Camp', route_mile: 200 / METERS_PER_MILE })
      ];
      const alerts = computeProximityAlerts(0.0, places, 'km');
      expect(alerts.length).toBe(0);
    });

    it('should suppress all proximity alerts when rider is between 0m and 50m (e.g. 25m and 50m)', () => {
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Trailhead Water', route_mile: 100 / METERS_PER_MILE })
      ];
      expect(computeProximityAlerts(25 / METERS_PER_MILE, places, 'km').length).toBe(0);
      expect(computeProximityAlerts(50 / METERS_PER_MILE, places, 'km').length).toBe(0);
    });

    it('should enable proximity alerts once rider exceeds 50m (e.g. 51m)', () => {
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Trailhead Water', route_mile: 100 / METERS_PER_MILE })
      ];
      const alerts = computeProximityAlerts(51 / METERS_PER_MILE, places, 'km');
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe('w1');
    });
  });

  describe('Tier 1: Proximity Trigger Window & Distance Thresholds ([-25m, +1000m])', () => {
    it('should trigger alert at 1000 meters before waypoint with chunk 1k', () => {
      const riderMile = 10.0;
      const targetMile = riderMile + 1000 / METERS_PER_MILE;
      const places: Place[] = [createPlace({ id: 'w1', name: 'Spring A', route_mile: targetMile })];

      const alerts = computeProximityAlerts(riderMile, places, 'km');
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe('w1');
      expect(alerts[0].distanceMeters).toBeCloseTo(1000, 1);
      expect(alerts[0].chunk).toBe('1k');
      expect(alerts[0].displayText).toContain('in 1k');
    });

    it('should not trigger alert when rider is outside 1000 meters ahead (e.g. 1005m)', () => {
      const riderMile = 10.0;
      const targetMile = riderMile + 1005 / METERS_PER_MILE;
      const places: Place[] = [createPlace({ id: 'w1', route_mile: targetMile })];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(0);
    });

    it('should trigger alert when rider is directly at the waypoint (0m) with chunk here', () => {
      const riderMile = 10.0;
      const places: Place[] = [createPlace({ id: 'w1', name: 'Trailhead', route_mile: riderMile })];

      const alerts = computeProximityAlerts(riderMile, places, 'km');
      expect(alerts.length).toBe(1);
      expect(alerts[0].displayDistanceMeters).toBe(0);
      expect(alerts[0].chunk).toBe('here');
      expect(alerts[0].displayText).toBe('here');
    });

    it('should trigger alert when rider is 15 meters past waypoint and show here', () => {
      const riderMile = 10.0;
      const targetMile = riderMile - 15 / METERS_PER_MILE;
      const places: Place[] = [createPlace({ id: 'w1', name: 'Creek', route_mile: targetMile })];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(1);
      expect(alerts[0].distanceMeters).toBeCloseTo(-15, 1);
      expect(alerts[0].displayDistanceMeters).toBe(0);
      expect(alerts[0].chunk).toBe('here');
      expect(alerts[0].displayText).toBe('here');
    });

    it('should trigger alert at exact dismissal boundary (-25 meters)', () => {
      const riderMile = 10.0;
      const targetMile = riderMile - 25 / METERS_PER_MILE;
      const places: Place[] = [createPlace({ id: 'w1', route_mile: targetMile })];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe('w1');
    });

    it('should dismiss alert when rider is beyond 25 meters past (e.g. 26m past)', () => {
      const riderMile = 10.0;
      const targetMile = riderMile - 26 / METERS_PER_MILE;
      const places: Place[] = [createPlace({ id: 'w1', route_mile: targetMile })];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(0);
    });
  });

  describe('Tier 2: Concurrency & Category Deduplication', () => {
    it('should limit active alerts to a maximum of 2', () => {
      const riderMile = 10.0;
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Water 1', category: 'water', route_mile: riderMile + 100 / METERS_PER_MILE }),
        createPlace({ id: 'c1', name: 'Camp 1', category: 'campground', route_mile: riderMile + 200 / METERS_PER_MILE }),
        createPlace({ id: 't1', name: 'Town 1', category: 'town', route_mile: riderMile + 300 / METERS_PER_MILE }),
        createPlace({ id: 'g1', name: 'Store 1', category: 'grocery', route_mile: riderMile + 400 / METERS_PER_MILE })
      ];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(2);
    });

    it('should deduplicate multiple in-range waypoints of the same category, keeping only the closest', () => {
      const riderMile = 10.0;
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Water Close', category: 'water', route_mile: riderMile + 50 / METERS_PER_MILE }),
        createPlace({ id: 'w2', name: 'Water Med', category: 'water', route_mile: riderMile + 150 / METERS_PER_MILE }),
        createPlace({ id: 'w3', name: 'Water Far', category: 'water', route_mile: riderMile + 350 / METERS_PER_MILE })
      ];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe('w1');
      expect(alerts[0].name).toBe('Water Close');
    });

    it('should reserve second slot for a distinct category when multiple duplicates exist', () => {
      const riderMile = 10.0;
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Water A', category: 'water', route_mile: riderMile + 50 / METERS_PER_MILE }),
        createPlace({ id: 'w2', name: 'Water B', category: 'water', route_mile: riderMile + 100 / METERS_PER_MILE }),
        createPlace({ id: 't1', name: 'Town X', category: 'town', route_mile: riderMile + 200 / METERS_PER_MILE }),
        createPlace({ id: 't2', name: 'Town Y', category: 'town', route_mile: riderMile + 300 / METERS_PER_MILE })
      ];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(2);
      expect(alerts[0].id).toBe('w1');
      expect(alerts[1].id).toBe('t1');
    });
  });

  describe('Tier 3: Prioritization Rule (water & campground take priority)', () => {
    it('should prioritize water and campground over closer non-resupply categories', () => {
      const riderMile = 10.0;
      const places: Place[] = [
        createPlace({ id: 't1', name: 'Town', category: 'town', route_mile: riderMile + 50 / METERS_PER_MILE }),
        createPlace({ id: 'b1', name: 'Bike Shop', category: 'bike_shop', route_mile: riderMile + 80 / METERS_PER_MILE }),
        createPlace({ id: 'w1', name: 'Water Spring', category: 'water', route_mile: riderMile + 300 / METERS_PER_MILE }),
        createPlace({ id: 'c1', name: 'Campground', category: 'campground', route_mile: riderMile + 400 / METERS_PER_MILE })
      ];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(2);
      const alertIds = alerts.map((a) => a.id);
      expect(alertIds).toContain('w1');
      expect(alertIds).toContain('c1');
      expect(alertIds).not.toContain('t1');
      expect(alertIds).not.toContain('b1');
    });

    it('should fill remaining slot with closest standard category when only one Tier 1 item qualifies', () => {
      const riderMile = 10.0;
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Water Spring', category: 'water', route_mile: riderMile + 200 / METERS_PER_MILE }),
        createPlace({ id: 't1', name: 'Town Close', category: 'town', route_mile: riderMile + 50 / METERS_PER_MILE }),
        createPlace({ id: 't2', name: 'Town Far', category: 'town', route_mile: riderMile + 120 / METERS_PER_MILE }),
        createPlace({ id: 'b1', name: 'Bike Shop', category: 'bike_shop', route_mile: riderMile + 150 / METERS_PER_MILE })
      ];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(2);
      const ids = alerts.map((a) => a.id);
      expect(ids).toContain('w1');
      expect(ids).toContain('t1');
    });

    it('should select closest distinct categories when neither water nor campground are in range', () => {
      const riderMile = 10.0;
      const places: Place[] = [
        createPlace({ id: 'h1', name: 'Hotel', category: 'hotel', route_mile: riderMile + 80 / METERS_PER_MILE }),
        createPlace({ id: 't1', name: 'Town', category: 'town', route_mile: riderMile + 120 / METERS_PER_MILE }),
        createPlace({ id: 'b1', name: 'Bike Shop', category: 'bike_shop', route_mile: riderMile + 300 / METERS_PER_MILE })
      ];

      const alerts = computeProximityAlerts(riderMile, places, 'miles');
      expect(alerts.length).toBe(2);
      expect(alerts[0].id).toBe('h1');
      expect(alerts[1].id).toBe('t1');
    });
  });

  describe('Tier 4: Next-Instance Lookahead (> 1.0 mile filter)', () => {
    it('should disregard upcoming waypoints <= 1.0 mile ahead for lookahead', () => {
      const riderMile = 10.0;
      const currentCamp = createPlace({
        id: 'c1',
        name: 'Camp Current',
        category: 'campground',
        route_mile: riderMile + 100 / METERS_PER_MILE
      });
      const nearCamp = createPlace({
        id: 'c2',
        name: 'Camp Too Close',
        category: 'campground',
        route_mile: riderMile + 0.8
      });
      const farCamp = createPlace({
        id: 'c3',
        name: 'Camp Eligible',
        category: 'campground',
        route_mile: riderMile + 4.5
      });

      const lookahead = findNextLookahead(currentCamp, riderMile, [currentCamp, nearCamp, farCamp]);
      expect(lookahead).not.toBeNull();
      expect(lookahead?.place.id).toBe('c3');
      expect(lookahead?.distanceMiles).toBeCloseTo(4.5, 2);
    });

    it('should compute distance to closest next resupply stop for water alerts', () => {
      const riderMile = 10.0;
      const waterAlert = createPlace({
        id: 'w1',
        name: 'Spring Approach',
        category: 'water',
        route_mile: riderMile + 50 / METERS_PER_MILE
      });
      const nextGrocery = createPlace({
        id: 'g1',
        name: 'Mountain Market',
        category: 'grocery store',
        route_mile: riderMile + 2.5
      });
      const nextWater = createPlace({
        id: 'w2',
        name: 'Next Creek',
        category: 'water',
        route_mile: riderMile + 6.0
      });

      const lookahead = findNextLookahead(waterAlert, riderMile, [waterAlert, nextGrocery, nextWater]);
      expect(lookahead).not.toBeNull();
      // Grocery belongs to water resupply set and is closer than next water
      expect(lookahead?.place.id).toBe('g1');
      expect(lookahead?.distanceMiles).toBeCloseTo(2.5, 2);
    });

    it('should return null when no upcoming waypoint exists > 1.0 mile ahead', () => {
      const riderMile = 10.0;
      const currentTown = createPlace({
        id: 't1',
        name: 'Last Town',
        category: 'town',
        route_mile: riderMile + 50 / METERS_PER_MILE
      });
      const nearTown = createPlace({
        id: 't2',
        name: 'Nearby Locality',
        category: 'town',
        route_mile: riderMile + 0.5
      });

      const lookahead = findNextLookahead(currentTown, riderMile, [currentTown, nearTown]);
      expect(lookahead).toBeNull();
    });
  });

  describe('Tier 5: Unit Formatting & Integration', () => {
    it('should format metric text with chunked countdown (without name)', () => {
      const place = createPlace({ id: 'w1', name: 'Twin Springs', category: 'water' });
      const lookahead = {
        distanceMiles: 4.0,
        distanceKm: 6.437376,
        place: createPlace({ id: 'w2', name: 'Next Springs' })
      };

      const text = formatAlertText(place, 300, lookahead, 'km');
      expect(text).toBe('in 250m (next in 6.4 km)');
    });

    it('should format imperial text with chunked yards (without name)', () => {
      const place = createPlace({ id: 'c1', name: 'High Pass Camp', category: 'campground' });
      const lookahead = {
        distanceMiles: 8.2,
        distanceKm: 13.19662,
        place: createPlace({ id: 'c2', name: 'Valley Camp' })
      };

      // 250 meters * 1.09361 = 273 yards -> chunks to 250 yd
      const text = formatAlertText(place, 250, lookahead, 'miles');
      expect(text).toBe('in 250 yd (next in 8.2 mi)');
    });

    it('should omit parenthetical lookahead text when next instance is null (without name)', () => {
      const place = createPlace({ id: 'p1', name: 'Summit Vista', category: 'pass' });
      const text = formatAlertText(place, 150, null, 'km');
      expect(text).toBe('in 100m');
      expect(text).not.toContain('next in');
    });

    it('should format as here when within here threshold (with and without lookahead)', () => {
      const place = createPlace({ id: 'w1', name: 'Spring', category: 'water' });
      const lookahead = {
        distanceMiles: 4.0,
        distanceKm: 6.437376,
        place: createPlace({ id: 'w2', name: 'Next Springs' })
      };
      expect(formatAlertText(place, 5, lookahead, 'km')).toBe('here (next in 6.4 km)');
      expect(formatAlertText(place, 5, null, 'km')).toBe('here');
      expect(formatAlertText(place, -15, null, 'km')).toBe('here');
    });

    it('should gracefully return empty alerts for empty places list', () => {
      const alerts = computeProximityAlerts(15.0, [], 'miles');
      expect(alerts).toEqual([]);
    });

    it('should provide the same results via the injectable ProximityAlertService instance', () => {
      const places: Place[] = [
        createPlace({ id: 'w1', name: 'Spring', category: 'water', route_mile: 10.0 + 100 / METERS_PER_MILE })
      ];
      const direct = computeProximityAlerts(10.0, places, 'miles');
      const viaService = service.computeAlerts(10.0, places, 'miles');
      expect(viaService).toEqual(direct);
    });
  });

  describe('chunkProximityDistance [1k, 750m, 500m, 250m, 100m, 50m, 25m, here]', () => {
    it('quantizes metric distances into exact specification chunks', () => {
      expect(chunkProximityDistance(1000, 'km')).toBe('1k');
      expect(chunkProximityDistance(880, 'km')).toBe('1k');
      expect(chunkProximityDistance(870, 'km')).toBe('750m');
      expect(chunkProximityDistance(750, 'km')).toBe('750m');
      expect(chunkProximityDistance(630, 'km')).toBe('750m');
      expect(chunkProximityDistance(620, 'km')).toBe('500m');
      expect(chunkProximityDistance(500, 'km')).toBe('500m');
      expect(chunkProximityDistance(380, 'km')).toBe('500m');
      expect(chunkProximityDistance(370, 'km')).toBe('250m');
      expect(chunkProximityDistance(250, 'km')).toBe('250m');
      expect(chunkProximityDistance(180, 'km')).toBe('250m');
      expect(chunkProximityDistance(170, 'km')).toBe('100m');
      expect(chunkProximityDistance(100, 'km')).toBe('100m');
      expect(chunkProximityDistance(80, 'km')).toBe('100m');
      expect(chunkProximityDistance(70, 'km')).toBe('50m');
      expect(chunkProximityDistance(50, 'km')).toBe('50m');
      expect(chunkProximityDistance(40, 'km')).toBe('50m');
      expect(chunkProximityDistance(35, 'km')).toBe('25m');
      expect(chunkProximityDistance(25, 'km')).toBe('25m');
      expect(chunkProximityDistance(15, 'km')).toBe('25m');
      expect(chunkProximityDistance(12, 'km')).toBe('here');
      expect(chunkProximityDistance(5, 'km')).toBe('here');
      expect(chunkProximityDistance(0, 'km')).toBe('here');
      expect(chunkProximityDistance(-15, 'km')).toBe('here');
    });

    it('quantizes imperial distances into yard chunks and here', () => {
      expect(chunkProximityDistance(1000, 'miles')).toBe('1k yd');
      expect(chunkProximityDistance(500, 'miles')).toBe('500 yd');
      expect(chunkProximityDistance(25, 'miles')).toBe('25 yd');
      expect(chunkProximityDistance(5, 'miles')).toBe('here');
    });
  });
});
