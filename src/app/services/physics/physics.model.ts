export type SimulationMode = 'riding' | 'climb_surge' | 'hike_a_bike';

export interface RouteSegment {
  index: number;
  startKm: number;
  endKm: number;
  lengthMeters: number;
  startElevationM: number;
  endElevationM: number;
  grade: number;                  // e.g. 0.08 for 8%
  roadClass: string;
  surface: string;
  tracktype: string;
  crr: number;
  mode: SimulationMode;
  effectivePowerWatts: number;
  speedKmh: number;
  durationSeconds: number;
  climbSurgeElapsedSec: number;
  inCooloff: boolean;
  cooloffElapsedSec: number;
  cumulativeDistanceKm: number;
  cumulativeSeconds: number;
}

// [startKm, endKm, roadClass, surface, tracktype]
export type SurfaceInterval = [number, number, string, string, string];

export interface ClimbPhysicsStats {
  estimatedSeconds: number;
  hikeBikeDistanceKm: number;
  hikeBikeDistanceMiles: number;
  hikeBikeDistanceMeters: number;
  hikeBikeSeconds: number;
}

export interface SimulationContext {
  powerWatts: number;
  paceMode: 'speed' | 'power';
  climbSurgePercent: number;
  climbSurgeDurationMinutes: number;
  hikeBikeThresholdKmh: number;
  hikeBikeBaseSpeedKmh: number;
  totalSystemMassKg: number;
  flatSpeedKmh: number;
}
