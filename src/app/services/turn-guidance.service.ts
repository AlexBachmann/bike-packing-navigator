import { Injectable } from '@angular/core';
import { TurnCue, TurnDirection, RoadSnapResult } from '../models/ride-cockpit.model';

export const CHORD_LENGTH_METERS = 25.0;
export const LOOKAHEAD_WINDOW_METERS = 1000.0;
export const MIN_TURN_DEFLECTION_DEG = 20.0;
export const ROAD_SNAP_MAX_DISTANCE_METERS = 20.0;
export const ROAD_SNAP_MAX_HEADING_DIFF_DEG = 45.0;

@Injectable({
  providedIn: 'root'
})
export class TurnGuidanceService {

  /**
   * Calculates initial forward azimuth / bearing in degrees [0, 360) from point 1 to point 2
   */
  calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = Math.PI / 180;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const deltaLambda = (lon2 - lon1) * toRad;
    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
  }

  /**
   * Calculates signed deflection angle between two bearings in degrees [-180, +180]
   * Positive = clockwise / right turn
   * Negative = counter-clockwise / left turn
   */
  calculateDeflectionAngle(incomingBearing: number, outgoingBearing: number): number {
    return ((outgoingBearing - incomingBearing + 540) % 360) - 180;
  }

  /**
   * Classifies turn direction based on deflection angle:
   * slight: [20°, 60°)
   * regular: [60°, 120°)
   * sharp: >= 120°
   */
  classifyDirection(deflectionDeg: number): TurnDirection | null {
    const absAngle = Math.abs(deflectionDeg);
    if (absAngle < MIN_TURN_DEFLECTION_DEG) {
      return null;
    }

    const isRight = deflectionDeg > 0;
    if (absAngle >= 120) {
      return isRight ? 'sharp-right' : 'sharp-left';
    } else if (absAngle >= 60) {
      return isRight ? 'right' : 'left';
    } else {
      return isRight ? 'slight-right' : 'slight-left';
    }
  }

  /**
   * Formats human-readable turn banner text according to user units
   */
  formatTurnText(direction: TurnDirection, distanceMeters: number, unit: 'miles' | 'km'): string {
    const directionLabels: Record<TurnDirection, string> = {
      'slight-left': 'slight left',
      'left': 'left',
      'sharp-left': 'sharp left',
      'slight-right': 'slight right',
      'right': 'right',
      'sharp-right': 'sharp right'
    };

    const dirLabel = directionLabels[direction];

    if (unit === 'miles') {
      const yards = Math.round(distanceMeters * 1.09361);
      return `Turn ${dirLabel} in ${yards} yards`;
    } else {
      const meters = Math.round(distanceMeters);
      return `Turn ${dirLabel} in ${meters} meters`;
    }
  }

  /**
   * Computes upcoming turn cue ahead of the rider's current mile within ~1 km window
   */
  computeTurnAhead(
    currentMile: number,
    trackPoints: [number, number, number, number, number][],
    unit: 'miles' | 'km'
  ): TurnCue | null {
    if (!trackPoints || trackPoints.length < 3) {
      return null;
    }

    // Identify current rider distance along route in meters
    const currentMeters = currentMile * 1609.344;
    const totalTrackMeters = trackPoints[trackPoints.length - 1][3] * 1000;

    if (currentMeters >= totalTrackMeters - 15) {
      return null;
    }

    // Sample along the forward 1 km window at regular 10m intervals
    const windowStart = currentMeters + 15; // ignore turns already behind or under wheels
    const windowEnd = Math.min(totalTrackMeters, currentMeters + LOOKAHEAD_WINDOW_METERS);

    if (windowStart >= windowEnd) {
      return null;
    }

    const stepMeters = 5.0;
    let candidateTurn: {
      apexMeters: number;
      peakDeflection: number;
      turnCoords: [number, number];
    } | null = null;

    let inTurnZone = false;
    let currentApexMeters = 0;
    let currentPeakDeflection = 0;
    let currentTurnCoords: [number, number] = [0, 0];

    const alignedStart = Math.ceil(windowStart / stepMeters) * stepMeters;
    for (let s = alignedStart; s <= windowEnd - CHORD_LENGTH_METERS; s += stepMeters) {
      const pPre = this.interpolatePointAtDistance(trackPoints, Math.max(0, s - CHORD_LENGTH_METERS));
      const pMid = this.interpolatePointAtDistance(trackPoints, s);
      const pPost = this.interpolatePointAtDistance(trackPoints, Math.min(totalTrackMeters, s + CHORD_LENGTH_METERS));

      const bIn = this.calculateBearing(pPre[0], pPre[1], pMid[0], pMid[1]);
      const bOut = this.calculateBearing(pMid[0], pMid[1], pPost[0], pPost[1]);
      const deflection = this.calculateDeflectionAngle(bIn, bOut);
      const absDeflection = Math.abs(deflection);

      if (absDeflection >= MIN_TURN_DEFLECTION_DEG) {
        if (!inTurnZone) {
          inTurnZone = true;
          currentApexMeters = s;
          currentPeakDeflection = deflection;
          currentTurnCoords = [pMid[0], pMid[1]];
        } else if (absDeflection > Math.abs(currentPeakDeflection)) {
          currentApexMeters = s;
          currentPeakDeflection = deflection;
          currentTurnCoords = [pMid[0], pMid[1]];
        }
      } else if (inTurnZone) {
        // Turn curve ended, capture the completed turn
        candidateTurn = {
          apexMeters: currentApexMeters,
          peakDeflection: currentPeakDeflection,
          turnCoords: currentTurnCoords
        };
        break;
      }
    }

    // If still in turn zone at end of window
    if (inTurnZone && !candidateTurn) {
      candidateTurn = {
        apexMeters: currentApexMeters,
        peakDeflection: currentPeakDeflection,
        turnCoords: currentTurnCoords
      };
    }

    if (!candidateTurn) {
      return null;
    }

    const direction = this.classifyDirection(candidateTurn.peakDeflection);
    if (!direction) {
      return null;
    }

    const distanceMeters = Math.max(0, candidateTurn.apexMeters - currentMeters);
    const displayText = this.formatTurnText(direction, distanceMeters, unit);

    return {
      direction,
      distanceMeters: Math.round(distanceMeters),
      displayText,
      turnCoords: candidateTurn.turnCoords,
      turnMile: candidateTurn.apexMeters / 1609.344,
      deflectionDeg: candidateTurn.peakDeflection
    };
  }

  /**
   * Snaps GPS coordinates to vector map road/trail features within 20m and 45° heading alignment.
   * Returns [lat, lon] tuple for contract compatibility.
   */
  snapToTrail(
    coords: [number, number],
    heading: number,
    renderedFeatures: any[]
  ): [number, number] {
    const result = this.snapToTrailDetailed(coords, heading, renderedFeatures);
    return result.coordinates;
  }

  /**
   * Detailed map matching implementation returning RoadSnapResult
   */
  snapToTrailDetailed(
    coords: [number, number],
    heading: number,
    renderedFeatures: any[]
  ): RoadSnapResult {
    const rawCoords: [number, number] = [coords[0], coords[1]];

    if (!renderedFeatures || !Array.isArray(renderedFeatures) || renderedFeatures.length === 0) {
      return {
        snapped: false,
        coordinates: rawCoords,
        rawCoordinates: rawCoords,
        distanceMeters: 0
      };
    }

    const [riderLat, riderLon] = coords;
    const toRad = Math.PI / 180;
    const cosLat = Math.cos(riderLat * toRad);
    const kx = cosLat * 111320.0;
    const ky = 110540.0;

    let bestDist = Infinity;
    let bestPoint: [number, number] = rawCoords;
    let bestHeadingDiff = Infinity;
    let matchedFeature: any = null;

    for (const feature of renderedFeatures) {
      if (!feature || !feature.geometry) continue;

      const geom = feature.geometry;
      let lineSegments: number[][][] = [];

      if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
        lineSegments = [geom.coordinates];
      } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
        lineSegments = geom.coordinates;
      }

      for (const line of lineSegments) {
        if (!line || line.length < 2) continue;

        for (let i = 0; i < line.length - 1; i++) {
          const ptA = line[i];     // GeoJSON: [lon, lat]
          const ptB = line[i + 1];

          const lonA = ptA[0];
          const latA = ptA[1];
          const lonB = ptB[0];
          const latB = ptB[1];

          // Calculate segment bearing
          const segBearing = this.calculateBearing(latA, lonA, latB, lonB);

          // Bidirectional heading difference
          const diffFwd = Math.abs(((segBearing - heading + 540) % 360) - 180);
          const diffRev = Math.abs(((segBearing + 180 - heading + 540) % 360) - 180);
          const minHeadingDiff = Math.min(diffFwd, diffRev);

          // Discard segments not aligned with rider heading within 45°
          if (minHeadingDiff > ROAD_SNAP_MAX_HEADING_DIFF_DEG) {
            continue;
          }

          // Project rider orthogonally onto segment AB
          const xA = (lonA - riderLon) * kx;
          const yA = (latA - riderLat) * ky;
          const xB = (lonB - riderLon) * kx;
          const yB = (latB - riderLat) * ky;

          const dx = xB - xA;
          const dy = yB - yA;
          const lenSq = dx * dx + dy * dy;

          let t = 0;
          if (lenSq > 0.0000001) {
            t = Math.max(0, Math.min(1, (-xA * dx - yA * dy) / lenSq));
          }

          const qx = xA + t * dx;
          const qy = yA + t * dy;
          const dist = Math.sqrt(qx * qx + qy * qy);

          if (dist <= ROAD_SNAP_MAX_DISTANCE_METERS && dist < bestDist) {
            bestDist = dist;
            bestHeadingDiff = minHeadingDiff;
            bestPoint = [latA + t * (latB - latA), lonA + t * (lonB - lonA)];
            matchedFeature = feature;
          }
        }
      }
    }

    if (bestDist <= ROAD_SNAP_MAX_DISTANCE_METERS) {
      return {
        snapped: true,
        coordinates: bestPoint,
        rawCoordinates: rawCoords,
        distanceMeters: Math.round(bestDist * 10) / 10,
        headingDifferenceDeg: Math.round(bestHeadingDiff * 10) / 10,
        featureProperties: matchedFeature?.properties,
        layerId: matchedFeature?.layer?.id
      };
    }

    // Clean off-trail fallback
    return {
      snapped: false,
      coordinates: rawCoords,
      rawCoordinates: rawCoords,
      distanceMeters: bestDist === Infinity ? 0 : Math.round(bestDist * 10) / 10,
      headingDifferenceDeg: bestHeadingDiff === Infinity ? undefined : Math.round(bestHeadingDiff * 10) / 10
    };
  }

  /**
   * Helper to linearly interpolate coordinate along route trackpoints
   */
  private interpolatePointAtDistance(
    trackPoints: [number, number, number, number, number][],
    targetMeters: number
  ): [number, number] {
    if (targetMeters <= trackPoints[0][3] * 1000) {
      return [trackPoints[0][0], trackPoints[0][1]];
    }

    const lastIdx = trackPoints.length - 1;
    if (targetMeters >= trackPoints[lastIdx][3] * 1000) {
      return [trackPoints[lastIdx][0], trackPoints[lastIdx][1]];
    }

    // Binary search for segment enclosing targetMeters
    let low = 0;
    let high = lastIdx;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const distMid = trackPoints[mid][3] * 1000;
      if (distMid < targetMeters) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idxA = Math.max(0, low - 1);
    const idxB = Math.min(lastIdx, idxA + 1);

    const distA = trackPoints[idxA][3] * 1000;
    const distB = trackPoints[idxB][3] * 1000;
    const delta = distB - distA;

    if (delta <= 0.00001) {
      return [trackPoints[idxA][0], trackPoints[idxA][1]];
    }

    const t = (targetMeters - distA) / delta;
    const lat = trackPoints[idxA][0] + t * (trackPoints[idxB][0] - trackPoints[idxA][0]);
    const lon = trackPoints[idxA][1] + t * (trackPoints[idxB][1] - trackPoints[idxA][1]);
    return [lat, lon];
  }
}
