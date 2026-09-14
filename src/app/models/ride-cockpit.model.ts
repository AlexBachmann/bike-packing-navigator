/**
 * Ride Navigation Cockpit Data Models
 */

export type TurnDirection =
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right';

export interface OsmTurnDefinition {
  mile: number;
  km: number;
  coordinates: [number, number]; // [lat, lon]
  direction: TurnDirection;
  deflectionDeg: number;
  roadName?: string;
  junctionType?: 'fork' | 'intersection' | 't-junction' | 'crossroad' | string;
  branchCount?: number;
}

export interface TurnCue {
  direction: TurnDirection;
  distanceMeters: number;
  displayText: string;
  turnCoords?: [number, number];
  turnMile?: number;
  deflectionDeg?: number;
  roadName?: string;
  junctionType?: string;
  branchCount?: number;
}

export interface RoadSnapResult {
  snapped: boolean;
  coordinates: [number, number]; // [lat, lon]
  rawCoordinates: [number, number];
  distanceMeters: number;
  headingDifferenceDeg?: number;
  featureProperties?: Record<string, any>;
  layerId?: string;
}

export interface SimulatorState {
  running: boolean;
  speedKph: number;
  simulatedMile: number;
  simulatedCoords: [number, number] | null;
  simulatedHeading: number;
  simulatedSpeedKph: number;
}

export interface ClimbStatus {
  active: boolean;
  climbName?: string;
  remainingDistanceKm?: number;
  remainingDistanceMiles?: number;
  currentGradePercent?: number;
  elevationGainRemainingM?: number;
  progressRatio?: number;
}
