export type PlaceCategory =
  | 'town'
  | 'grocery'
  | 'food'
  | 'hotel'
  | 'campground'
  | 'bike_shop'
  | 'gas_station'
  | 'pharmacy'
  | 'pass'
  | 'water'
  | 'laundromat'
  | 'laundry';

export interface PlaceLocation {
  lat: number;
  lon: number;
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory | string;
  type: string;
  town?: string;
  is_in_town: boolean;
  location: PlaceLocation;
  distance_to_trail_km: number;
  route_km: number;
  route_mile: number;
  address?: string;
  open_now?: boolean;
  opening_hours?: string[];
  google_maps_url?: string;
  business_status?: string;
  province_state?: string;
}

export interface WaypointViewModel extends Place {
  distanceAheadKm: number;
  distanceAheadMiles: number;
  estimatedHours: number;
  estimatedTimeFormatted: string;
}

export interface ProjectionResult {
  distanceKm: number;
  distanceMiles: number;
  projectedRouteKm: number;
  projectedRouteMile: number;
  isOffRoute: boolean; // True if > 10 km
  nearestPointOnTrail: { lat: number; lon: number; ele: number };
  nearestMile: number;
}

export interface GpsState {
  enabled: boolean;
  loading: boolean;
  lastUpdated: Date | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  error: string | null;
  projection: ProjectionResult | null;
}

const NON_WASCHSALON_TERMS = [
  'cleaning', 'cleaners', 'cleaner', 'janitorial', 'maid', 'restoration',
  'rental', 'bar', 'restaurant', 'floor', 'dude', 'servpro',
  'dry cleaner', 'executive'
];

/**
 * Validates whether a laundry place is an actual self-service laundromat (Waschsalon)
 * with washers/dryers for riders, excluding commercial linen, carpet cleaners, maid services, etc.
 */
export function isSelfServiceWaschsalon(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes('commercial') && !lower.includes('coin')) return false;
  if (NON_WASCHSALON_TERMS.some((term) => lower.includes(term)) && !lower.includes('coin')) return false;
  return true;
}

export interface CategoryItem {
  key: PlaceCategory;
  label: string;
  icon: string;
  badgeClass: string;
}

export const AVAILABLE_CATEGORIES: CategoryItem[] = [
  { key: 'town', label: 'Towns', icon: '🏘️', badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { key: 'grocery', label: 'Grocery', icon: '🛒', badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { key: 'food', label: 'Dining', icon: '🍽️', badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { key: 'campground', label: 'Camping', icon: '⛺', badgeClass: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  { key: 'hotel', label: 'Lodging', icon: '🏨', badgeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { key: 'bike_shop', label: 'Bike Shops', icon: '🚲', badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { key: 'gas_station', label: 'Gas / Store', icon: '⛽', badgeClass: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { key: 'pharmacy', label: 'Pharmacy', icon: '💊', badgeClass: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { key: 'laundromat', label: 'Laundry', icon: '🧺', badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
];

export function getCategoryBadge(category: string): { icon: string; label: string; badgeClass: string } {
  const key = category === 'laundry' ? 'laundromat' : category;
  const found = AVAILABLE_CATEGORIES.find((c) => c.key === key);
  if (found) return found;
  if (category === 'water') {
    return { icon: '💧', label: 'Water', badgeClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
  }
  return { icon: '📍', label: category, badgeClass: 'bg-slate-700/50 text-slate-300 border-slate-600' };
}

export interface Milestone {
  name: string;
  mile: number;
}

export const MAJOR_MILESTONES: Milestone[] = [
  { name: 'Banff, AB', mile: 0.0 },
  { name: 'Elkford, BC', mile: 99.3 },
  { name: 'Fernie, BC', mile: 154.5 },
  { name: 'Eureka, MT', mile: 215.0 },
  { name: 'Whitefish, MT', mile: 285.0 },
  { name: 'Seeley Lake, MT', mile: 460.0 },
  { name: 'Ovando, MT', mile: 530.2 },
  { name: 'Helena, MT', mile: 550.0 },
  { name: 'Butte, MT', mile: 670.0 },
  { name: 'Lima, MT', mile: 880.0 },
  { name: 'Flagg Ranch, WY', mile: 1060.0 },
  { name: 'Pinedale, WY', mile: 1220.0 },
  { name: 'Wamsutter, WY', mile: 1393.6 },
  { name: 'Rawlins, WY', mile: 1475.0 },
  { name: 'Steamboat Springs, CO', mile: 1680.0 },
  { name: 'Breckenridge, CO', mile: 1820.0 },
  { name: 'Salida, CO', mile: 1940.0 },
  { name: 'Del Norte, CO', mile: 2060.0 },
  { name: 'Cuba, NM', mile: 2360.0 },
  { name: 'Pie Town, NM', mile: 2500.0 },
  { name: 'Silver City, NM', mile: 2595.0 },
  { name: 'Antelope Wells, NM', mile: 2679.2 }
];


