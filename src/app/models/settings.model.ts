export type WeightUnit = 'kg' | 'lbs';
export type DistanceUnit = 'miles' | 'km';
export type PaceMode = 'power' | 'speed';
export type MapStyle = 'dark' | 'topo';
export type MapRendererMode = 'auto' | 'raster';
export type NavigationTab = 'ride' | 'waypoints' | 'profile' | 'map' | 'resupply' | 'settings';

/**
 * Gracefully normalizes legacy navigation tab preferences (migrates 'jump' to 'resupply').
 */
export function migrateNavigationTab(tab: string | null | undefined): NavigationTab {
  if (tab === 'ride') {
    return 'ride';
  }
  if (tab === 'jump' || tab === 'resupply') {
    return 'resupply';
  }
  if (tab === 'waypoints' || tab === 'profile' || tab === 'map' || tab === 'settings') {
    return tab;
  }
  return 'waypoints';
}


export interface UserSettings {
  riderWeight: number | null;          // Weight in selected weight unit
  bikeWeight: number | null;           // Bike dry weight (without water, without food)
  waterCapacityLiters: number | null;  // Carrying capacity in liters
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  avgSpeedMph: number;
  riderPowerWatts: number;             // Current pedaling power in watts
  paceMode?: PaceMode;                 // Default 'power', can be switched to 'speed'
  climbSurgePercent?: number;          // Climb surge % for steep climbs (default 10%)
  climbSurgeDurationMinutes?: number;  // Max climb surge duration in minutes (default 10 min)
  hikeBikeThresholdKmh?: number;       // Speed threshold to switch to hike-a-bike (default 6 km/h)
  hikeBikeBaseSpeedKmh?: number;       // Flat hike-a-bike base speed (default 4 km/h)
  mapStyle?: MapStyle;                 // Persisted map layer style ('dark' | 'topo')
  mapZoomLevel?: number;               // Persisted map zoom level
  activeTab?: NavigationTab;           // Persisted navigation tab
  selectedRouteKey?: string | null;    // Persisted selected route ID (null = welcome screen)
  currentLocationMile?: number;        // Persisted rider location (in miles along active route)
  routeLocations?: Record<string, number>; // Persisted location per route ID
  keepScreenAwake?: boolean;           // Persisted screen wake lock toggle (default true)
  anonymousTelemetryEnabled?: boolean; // Anonymous telemetry toggle (default true)
  mapRenderer?: MapRendererMode;       // Persisted map renderer toggle ('auto' | 'raster')
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  riderWeight: null,
  bikeWeight: null,
  waterCapacityLiters: null,
  weightUnit: 'kg',
  distanceUnit: 'miles',
  avgSpeedMph: 10.5,
  riderPowerWatts: 150,
  paceMode: 'power',
  climbSurgePercent: 10,
  climbSurgeDurationMinutes: 10,
  hikeBikeThresholdKmh: 6.0,
  hikeBikeBaseSpeedKmh: 4.0,
  mapStyle: 'dark',
  mapZoomLevel: 8,
  activeTab: 'waypoints',
  selectedRouteKey: null,
  currentLocationMile: 0,
  routeLocations: {},
  keepScreenAwake: true,
  anonymousTelemetryEnabled: true,
  mapRenderer: 'auto'
};

