import { Place, Milestone } from './waypoint.model';
import { Climb, MountainPass } from './elevation.model';
import { SurfaceInterval } from '../services/eta-physics.service';

export interface RouteSummary {
  id: string; // e.g. 'tour-divide-2025', 'colorado-trail'
  name: string; // 'Tour Divide 2025', 'Colorado Trail'
  shortName: string; // 'TD', 'CT'
  badge?: string; // 'TD', 'CT'
  startLocation: string; // 'Banff, AB', 'Denver (Waterton Canyon), CO'
  endLocation: string; // 'Antelope Wells, NM', 'Durango, CO'
  startPoint?: string;
  endPoint?: string;
  totalDistanceMiles: number;
  totalDistanceKm: number;
  distanceMiles?: number;
  distanceKm?: number;
  elevationGainFt: number;
  elevationGainM: number;
  elevationGainFeet?: number;
  elevationGainMeters?: number;
  highestElevationFeet?: number;
  highestElevationMeters?: number;
  highestPoint?: string;
  iconicPass?: string;
  iconicCheckpoints: string[];
  description: string;
  startCoordinates: [number, number]; // [lat, lng]
  bounds: [[number, number], [number, number]]; // [[south, west], [north, east]]
  dataPath?: string;
}

export interface RouteManifest {
  version?: number | string;
  defaultRouteId?: string | null;
  routes: RouteSummary[];
}

export interface RouteTrack {
  total_km: number;
  total_miles: number;
  points: [number, number, number, number, number][]; // [lat, lon, ele, km, mi]
}

export interface RouteDataPackage {
  routeId: string;
  track: RouteTrack;
  places: Place[];
  surfaces: SurfaceInterval[];
  climbs: Climb[];
  passes: MountainPass[];
  milestones: Milestone[];
  cachedAt: number;
}

