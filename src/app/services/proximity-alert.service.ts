import { Injectable } from '@angular/core';
import { Place, PlaceCategory, getCategoryBadge } from '../models/waypoint.model';

export const PROXIMITY_TRIGGER_METERS = 500;
export const PROXIMITY_DISMISSAL_METERS = -25;
export const LOOKAHEAD_MIN_DISTANCE_MILES = 1.0;
export const METERS_PER_MILE = 1609.344;
export const START_PROXIMITY_SUPPRESSION_METERS = 50;

export const WATER_RESUPPLY_CATEGORIES = new Set<string>([
  'water',
  'campground',
  'gas_station',
  'town',
  'grocery'
]);

export interface ProximityAlert {
  id: string;
  name: string;
  category: PlaceCategory | string;
  type: string;
  distanceMeters: number; // Signed distance: positive = ahead, negative = past
  displayDistanceMeters: number; // Clamped: Math.max(0, Math.round(distanceMeters))
  lookaheadDistanceMiles: number | null;
  lookaheadDistanceKm: number | null;
  nextPlace: Place | null;
  displayText: string;
  icon: string;
  badgeClass: string;
}

/**
 * Normalizes category strings (handling snake_case, spaces, recreation sites, etc.)
 */
export function normalizeCategory(cat: string): string {
  const lower = (cat || '').toLowerCase().trim().replace(/[-_]/g, ' ');
  if (lower === 'gas station') return 'gas_station';
  if (lower === 'grocery store' || lower === 'grocery') return 'grocery';
  if (lower === 'laundry' || lower === 'laundromat') return 'laundromat';
  if (lower === 'campground' || lower === 'recreation site' || lower === 'rec site' || lower === 'camping') return 'campground';
  if (lower === 'bike shop') return 'bike_shop';
  return lower.replace(/\s+/g, '_');
}

/**
 * Finds the next upcoming waypoint instance along the route (> 1.0 mile ahead).
 * - Standard types: search identical category.
 * - Water: search closest among [water, campground, gas_station, town, grocery].
 * Returns null if no matching instance exists > 1.0 mile ahead.
 */
export function findNextLookahead(
  currentPlace: Place,
  riderMile: number,
  allPlaces: Place[]
): { distanceMiles: number; distanceKm: number; place: Place } | null {
  if (!allPlaces || allPlaces.length === 0) return null;

  const normCat = normalizeCategory(currentPlace.category);
  const isWater = normCat === 'water';

  let closestNext: Place | null = null;
  let minDeltaMiles = Infinity;

  for (const p of allPlaces) {
    if (p.id === currentPlace.id) continue;

    const deltaMiles = p.route_mile - riderMile;
    // Disregard upcoming waypoints <= 1.0 mile ahead (and those behind rider)
    if (deltaMiles <= LOOKAHEAD_MIN_DISTANCE_MILES + 1e-9) {
      continue;
    }

    const pCat = normalizeCategory(p.category);
    const matches = isWater ? WATER_RESUPPLY_CATEGORIES.has(pCat) : pCat === normCat;

    if (matches && deltaMiles < minDeltaMiles) {
      minDeltaMiles = deltaMiles;
      closestNext = p;
    }
  }

  if (!closestNext || minDeltaMiles === Infinity) {
    return null;
  }

  return {
    distanceMiles: minDeltaMiles,
    distanceKm: minDeltaMiles * 1.609344,
    place: closestNext
  };
}

/**
 * Formats user-facing alert text:
 * Metric: `in [X] m (next in [Y] km)`
 * Imperial: `in [X] yd (next in [Y] mi)`
 * The waypoint name is omitted to conserve space in the HUD card.
 * Clamps negative imminent distance to 0.
 * Omits parenthetical lookahead when lookahead is null.
 */
export function formatAlertText(
  place: Place,
  distanceMeters: number,
  lookahead: { distanceMiles: number; distanceKm: number; place: Place } | null,
  unit: 'miles' | 'km'
): string {
  const distClamped = Math.max(0, Math.round(distanceMeters));

  let imminentStr: string;
  let nextStr = '';

  if (unit === 'km') {
    imminentStr = `${distClamped} m`;
    if (lookahead) {
      const km = lookahead.distanceKm;
      const kmFormatted = km < 10 ? km.toFixed(1) : Math.round(km).toString();
      nextStr = ` (next in ${kmFormatted} km)`;
    }
  } else {
    const yards = Math.round(distClamped * 1.09361);
    imminentStr = `${yards} yd`;
    if (lookahead) {
      const mi = lookahead.distanceMiles;
      const miFormatted = mi < 10 ? mi.toFixed(1) : Math.round(mi).toString();
      nextStr = ` (next in ${miFormatted} mi)`;
    }
  }

  return `in ${imminentStr}${nextStr}`;
}

/**
 * Computes active proximity alerts for the Rider Cockpit HUD.
 * Rules:
 * 1. Suppress all alerts when rider position is between 0 and 50m.
 * 2. Trigger window: [-25m, +500m] relative to rider.
 * 3. Deduplication: at most 1 waypoint per category (closest to rider).
 * 4. Prioritization: 'water' and 'campground' take precedence when >2 qualify.
 * 5. Concurrency limit: maximum 2 active alerts.
 * 6. Lookahead: distance to next resupply/instance (> 1.0 mi ahead).
 */
export function computeProximityAlerts(
  riderMile: number,
  places: Place[],
  unit: 'miles' | 'km'
): ProximityAlert[] {
  if (!places || places.length === 0) return [];

  // Suppress proximity alerts when rider is between position 0 and 50m
  const riderDistanceMeters = riderMile * METERS_PER_MILE;
  if (riderDistanceMeters <= START_PROXIMITY_SUPPRESSION_METERS + 1e-6) {
    return [];
  }

  // Step 1: Filter waypoints in window [-25m, 500m]
  const qualifying: { place: Place; distanceMeters: number; normCat: string }[] = [];
  for (const p of places) {
    const deltaMiles = p.route_mile - riderMile;
    const distanceMeters = deltaMiles * METERS_PER_MILE;
    if (distanceMeters >= PROXIMITY_DISMISSAL_METERS - 1e-6 && distanceMeters <= PROXIMITY_TRIGGER_METERS + 1e-6) {
      qualifying.push({
        place: p,
        distanceMeters,
        normCat: normalizeCategory(p.category)
      });
    }
  }

  if (qualifying.length === 0) return [];

  // Step 2: Deduplicate by category - keep only the closest per category
  const byCategory = new Map<string, { place: Place; distanceMeters: number; normCat: string }>();
  for (const item of qualifying) {
    const existing = byCategory.get(item.normCat);
    if (!existing || Math.abs(item.distanceMeters) < Math.abs(existing.distanceMeters)) {
      byCategory.set(item.normCat, item);
    }
  }

  const deduplicated = Array.from(byCategory.values());

  // Step 3: Prioritize water and campground (Tier 1) over others (Tier 2)
  const isTier1 = (cat: string) => cat === 'water' || cat === 'campground';
  const tier1 = deduplicated.filter(i => isTier1(i.normCat)).sort((a, b) => Math.abs(a.distanceMeters) - Math.abs(b.distanceMeters));
  const tier2 = deduplicated.filter(i => !isTier1(i.normCat)).sort((a, b) => Math.abs(a.distanceMeters) - Math.abs(b.distanceMeters));

  const selected: { place: Place; distanceMeters: number; normCat: string }[] = [];
  for (const item of tier1) {
    if (selected.length < 2) selected.push(item);
  }
  for (const item of tier2) {
    if (selected.length < 2) selected.push(item);
  }

  // Sort final selected alerts by closeness for clean HUD display
  selected.sort((a, b) => Math.abs(a.distanceMeters) - Math.abs(b.distanceMeters));

  // Step 4: Compute next-instance lookahead distance and format text
  return selected.map(item => {
    const nextResult = findNextLookahead(item.place, riderMile, places);
    const displayText = formatAlertText(item.place, item.distanceMeters, nextResult, unit);
    const badge = getCategoryBadge(item.place.category);

    return {
      id: item.place.id,
      name: item.place.name,
      category: item.place.category,
      type: item.place.type,
      distanceMeters: item.distanceMeters,
      displayDistanceMeters: Math.max(0, Math.round(item.distanceMeters)),
      lookaheadDistanceMiles: nextResult ? nextResult.distanceMiles : null,
      lookaheadDistanceKm: nextResult ? nextResult.distanceKm : null,
      nextPlace: nextResult ? nextResult.place : null,
      displayText,
      icon: badge.icon,
      badgeClass: badge.badgeClass
    };
  });
}

@Injectable({
  providedIn: 'root'
})
export class ProximityAlertService {
  computeAlerts(riderMile: number, places: Place[], unit: 'miles' | 'km'): ProximityAlert[] {
    return computeProximityAlerts(riderMile, places, unit);
  }
}
