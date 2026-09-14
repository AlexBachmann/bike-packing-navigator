import { Injectable } from '@angular/core';
import { TurnCue, TurnDirection, RoadSnapResult, OsmTurnDefinition } from '../models/ride-cockpit.model';

export const CHORD_LENGTH_METERS = 25.0;
export const LOOKAHEAD_WINDOW_METERS = 75.0;
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
   *  [20, 60): slight-right | [-60, -20): slight-left
   *  [60, 120): right       | [-120, -60): left
   *  >= 120: sharp-right    | <= -120: sharp-left
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
    return this.formatTurnTextWithRoad(direction, distanceMeters, unit);
  }

  /**
   * Formats human-readable turn banner text with optional road name and fork context
   */
  formatTurnTextWithRoad(
    direction: TurnDirection,
    distanceMeters: number,
    unit: 'miles' | 'km',
    roadName?: string,
    junctionType?: string
  ): string {
    const directionLabels: Record<TurnDirection, string> = {
      'slight-left': 'slight left',
      'left': 'left',
      'sharp-left': 'sharp left',
      'slight-right': 'slight right',
      'right': 'right',
      'sharp-right': 'sharp right'
    };

    const dirLabel = directionLabels[direction];
    const distFormatted = unit === 'miles'
      ? `${Math.round(distanceMeters * 1.09361)} yards`
      : `${Math.round(distanceMeters)} meters`;

    const prefix = junctionType === 'fork' ? 'Fork' : 'Turn';

    if (roadName && roadName.trim().length > 0) {
      return `${prefix} ${dirLabel} onto ${roadName.trim()} in ${distFormatted}`;
    }

    return `${prefix} ${dirLabel} in ${distFormatted}`;
  }

  /**
   * Computes upcoming turn cue ahead of the rider based exclusively on authentic
   * OpenStreetMap decision points where there is a genuine option between two or more ways.
   *
   * Only cues within 75 meters ahead of the rider are shown (not earlier).
   */
  computeTurnAheadFromJunctions(
    currentMile: number,
    turns: OsmTurnDefinition[],
    unit: 'miles' | 'km'
  ): TurnCue | null {
    if (!turns || turns.length === 0) {
      return null;
    }

    const currentMeters = currentMile * 1609.344;
    let nextTurn: OsmTurnDefinition | null = null;
    let minDistanceMeters = Infinity;

    for (const turn of turns) {
      const turnMeters = turn.mile * 1609.344;
      const dist = turnMeters - currentMeters;
      // Active window: pops up 75 meters before the turn (not earlier),
      // and remains active until 5 meters past the junction point
      if (dist >= -5 && dist <= LOOKAHEAD_WINDOW_METERS) {
        if (dist >= 0 && (minDistanceMeters < 0 || dist < minDistanceMeters)) {
          minDistanceMeters = dist;
          nextTurn = turn;
        } else if (dist < 0 && minDistanceMeters === Infinity) {
          minDistanceMeters = dist;
          nextTurn = turn;
        }
      }
    }

    if (!nextTurn) {
      return null;
    }

    const distanceMeters = Math.max(0, minDistanceMeters);
    const displayText = this.formatTurnTextWithRoad(
      nextTurn.direction,
      distanceMeters,
      unit,
      nextTurn.roadName,
      nextTurn.junctionType
    );

    return {
      direction: nextTurn.direction,
      distanceMeters: Math.round(distanceMeters),
      displayText,
      turnCoords: nextTurn.coordinates,
      turnMile: nextTurn.mile,
      deflectionDeg: nextTurn.deflectionDeg,
      roadName: nextTurn.roadName,
      junctionType: nextTurn.junctionType,
      branchCount: nextTurn.branchCount
    };
  }

  /**
   * Evaluates OpenStreetMap vector line features in the vicinity of turnCoords (within radiusMeters).
   * Returns true ONLY if 3 or more distinct direction branches radiate from the point,
   * confirming a genuine decision point with options between two or more ways.
   */
  hasMultipleWayOptions(
    turnCoords: [number, number],
    renderedFeatures: any[],
    radiusMeters: number = 25.0
  ): boolean {
    if (!renderedFeatures || !Array.isArray(renderedFeatures) || renderedFeatures.length === 0) {
      return false;
    }

    const [turnLat, turnLon] = turnCoords;
    const toRad = Math.PI / 180;
    const cosLat = Math.cos(turnLat * toRad);
    const kx = cosLat * 111320.0;
    const ky = 110540.0;

    const nearbyBearings: number[] = [];

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

          // Project orthogonal distance
          const xA = (lonA - turnLon) * kx;
          const yA = (latA - turnLat) * ky;
          const xB = (lonB - turnLon) * kx;
          const yB = (latB - turnLat) * ky;

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

          if (dist <= radiusMeters) {
            const b = this.calculateBearing(latA, lonA, latB, lonB);
            nearbyBearings.push(b);
            nearbyBearings.push((b + 180) % 360);
          }
        }
      }
    }

    // Cluster into distinct directional branches (> 30° apart)
    const branches: number[] = [];
    for (const b of nearbyBearings) {
      if (!branches.some(eb => Math.abs(((b - eb + 540) % 360) - 180) < 30)) {
        branches.push(b);
      }
    }

    return branches.length >= 3;
  }

  /**
   * Computes upcoming turn cue ahead of the rider's current mile within ~1 km window
   */
  computeTurnAhead(
    currentMile: number,
    trackPoints: [number, number, number, number, number][],
    unit: 'miles' | 'km',
    osmTurns?: OsmTurnDefinition[]
  ): TurnCue | null {
    if (osmTurns && osmTurns.length > 0) {
      return this.computeTurnAheadFromJunctions(currentMile, osmTurns, unit);
    }

    if (!trackPoints || trackPoints.length < 3) {
      return null;
    }

    // Identify current rider distance along route in meters
    const currentMeters = currentMile * 1609.344;
    const totalTrackMeters = trackPoints[trackPoints.length - 1][3] * 1000;

    if (currentMeters >= totalTrackMeters - 15) {
      return null;
    }

    // Sample along the forward 75m lookahead window
    const windowStart = currentMeters - 5;
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

    const alignedStart = Math.max(0, Math.ceil(windowStart / stepMeters) * stepMeters);
    for (let s = alignedStart; s <= windowEnd; s += stepMeters) {
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
   * Calculates the tangent bearing in degrees [0, 360) along the route at the given mile
   * by looking ahead along the track by lookaheadMeters (default: 25m).
   */
  getRouteTangentBearing(
    trackPoints: [number, number, number, number, number][],
    targetMile: number,
    lookaheadMeters = 25.0
  ): number {
    if (!trackPoints || trackPoints.length < 2) return 0;
    const currentMeters = Math.max(0, targetMile * 1609.344);
    const totalTrackMeters = trackPoints[trackPoints.length - 1][3] * 1000;

    const forwardMeters = Math.min(totalTrackMeters, currentMeters + lookaheadMeters);
    if (forwardMeters > currentMeters + 0.1) {
      const p1 = this.interpolatePointAtDistance(trackPoints, currentMeters);
      const p2 = this.interpolatePointAtDistance(trackPoints, forwardMeters);
      return this.calculateBearing(p1[0], p1[1], p2[0], p2[1]);
    } else {
      // Near or at the finish line, look backward by lookaheadMeters
      const backwardMeters = Math.max(0, currentMeters - lookaheadMeters);
      const p1 = this.interpolatePointAtDistance(trackPoints, backwardMeters);
      const p2 = this.interpolatePointAtDistance(trackPoints, currentMeters);
      return this.calculateBearing(p1[0], p1[1], p2[0], p2[1]);
    }
  }

  /**
   * Helper to linearly interpolate coordinate along route trackpoints at targetMile
   */
  interpolatePointAtMile(
    trackPoints: [number, number, number, number, number][],
    targetMile: number
  ): [number, number] {
    if (!trackPoints || trackPoints.length === 0) return [0, 0];
    if (targetMile <= trackPoints[0][4]) {
      return [trackPoints[0][0], trackPoints[0][1]];
    }

    const lastIdx = trackPoints.length - 1;
    if (targetMile >= trackPoints[lastIdx][4]) {
      return [trackPoints[lastIdx][0], trackPoints[lastIdx][1]];
    }

    let low = 0;
    let high = lastIdx;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (trackPoints[mid][4] <= targetMile) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idxA = Math.max(0, low - 1);
    const idxB = Math.min(lastIdx, idxA + 1);
    const span = trackPoints[idxB][4] - trackPoints[idxA][4];
    const t = span <= 1e-9 ? 0 : Math.max(0, Math.min(1, (targetMile - trackPoints[idxA][4]) / span));

    const lat = trackPoints[idxA][0] + t * (trackPoints[idxB][0] - trackPoints[idxA][0]);
    const lon = trackPoints[idxA][1] + t * (trackPoints[idxB][1] - trackPoints[idxA][1]);
    return [lat, lon];
  }

  /**
   * Helper to linearly interpolate coordinate along route trackpoints
   */
  interpolatePointAtDistance(
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
