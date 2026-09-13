import { ClimbWeatherForecast } from './weather.model';

export interface MountainPass {
  id: string;
  name: string;
  state: string;
  routeMile: number;
  routeKm: number;
  elevationMeters: number;
  elevationFeet: number;
  lat: number;
  lon: number;
  difficulty: 'moderate' | 'difficult' | 'extreme';
  notes: string;
}

export type ProfileWindowMode = 'next10' | 'next25' | 'next50' | 'next100' | 'full';

export interface ElevationScrubData {
  routeMile: number;
  routeKm: number;
  elevationMeters: number;
  elevationFeet: number;
  gradePercent: number;
  distanceAheadMiles: number;
  distanceAheadKm: number;
}

export interface Climb {
  id: string;
  name: string;
  state: string;
  startMile: number;
  endMile: number;
  startKm: number;
  endKm: number;
  lengthMiles: number;
  lengthKm: number;
  startElevationMeters: number;
  summitElevationMeters: number;
  startElevationFeet: number;
  summitElevationFeet: number;
  elevationGainMeters: number;
  elevationGainFeet: number;
  avgGradePercent: number;
  maxGradePercent: number;
  isIconic: boolean;
  passId?: string;
  difficulty?: 'moderate' | 'difficult' | 'extreme';
  notes?: string;
  trailName?: string;
  parkName?: string;
  landmark?: string;
  roadClass?: string;
  surface?: string;
  firmness?: string;
  tracktype?: string;
}


export interface ClimbGradientStop {
  offset: string;
  color: string;
}

export interface ClimbMiniProfile {
  linePathD: string;
  areaPathD: string;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  summitPoint: { x: number; y: number };
  riderDot: { x: number; y: number } | null;
  thunderstormHazardPoint?: { x: number; y: number } | null;
  gradientStops: ClimbGradientStop[];
  width: number;
}

export type ClimbFilterMode = 'window' | 'upcoming' | 'all';

export interface UpcomingClimb extends Climb {
  status: 'passed' | 'climbing' | 'upcoming';
  distanceToStartMiles: number;
  distanceToStartKm: number;
  distanceToSummitMiles: number;
  distanceToSummitKm: number;
  distanceAgoMiles: number;
  distanceAgoKm: number;
  climbRemainingMeters: number;
  climbRemainingFeet: number;
  climbCompletedPercent: number;
  estimatedSeconds: number;
  estimatedTimeFormatted: string;
  hikeBikeDistanceKm: number;
  hikeBikeDistanceMiles: number;
  hikeBikeDistanceMeters: number;
  hikeBikeSeconds: number;
  hikeBikeTimeFormatted: string;
  miniProfile?: ClimbMiniProfile;
  climbWeather?: ClimbWeatherForecast | null;
}

