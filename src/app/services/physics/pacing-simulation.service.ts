import { Injectable, inject } from '@angular/core';
import { SettingsService } from '../settings.service';
import { CyclingPhysicsEngine, STEP_METERS } from './cycling-physics.engine';
import { TerrainProfileService, TrackPointTuple } from './terrain-profile.service';
import {
  RouteSegment,
  SimulationMode,
  SurfaceInterval,
  ClimbPhysicsStats,
  SimulationContext
} from './physics.model';

interface SimulationStepState {
  eleCursor: number;
  surfCursor: number;
  prevEle: number;
  climbSurgeElapsedSec: number;
  inCooloff: boolean;
  cooloffElapsedSec: number;
  cumulativeDistanceKm: number;
  cumulativeSeconds: number;
}

@Injectable({
  providedIn: 'root'
})
export class PacingSimulationService {
  private readonly settings = inject(SettingsService);
  private readonly physics = inject(CyclingPhysicsEngine);
  private readonly terrain = inject(TerrainProfileService);

  getSimulationContext(override?: Partial<SimulationContext>): SimulationContext {
    return {
      powerWatts: override?.powerWatts ?? this.settings.riderPowerWatts(),
      paceMode: override?.paceMode ?? this.settings.paceMode(),
      climbSurgePercent: override?.climbSurgePercent ?? this.settings.climbSurgePercent(),
      climbSurgeDurationMinutes: override?.climbSurgeDurationMinutes ?? this.settings.climbSurgeDurationMinutes(),
      hikeBikeThresholdKmh: override?.hikeBikeThresholdKmh ?? this.settings.hikeBikeThresholdKmh(),
      hikeBikeBaseSpeedKmh: override?.hikeBikeBaseSpeedKmh ?? this.settings.hikeBikeBaseSpeedKmh(),
      totalSystemMassKg: override?.totalSystemMassKg ?? this.settings.totalSystemMassKg(),
      flatSpeedKmh: override?.flatSpeedKmh ?? this.settings.avgSpeedMph() * 1.609344
    };
  }

  simulateSegments(
    startKm: number,
    maxDistanceKm: number,
    customContext?: Partial<SimulationContext>
  ): RouteSegment[] {
    const pts = this.terrain.trackPoints();
    if (!pts.length) {
      return [];
    }

    const intervals = this.terrain.surfaceIntervals();
    const ctx = this.getSimulationContext(customContext);
    const stepKm = STEP_METERS / 1000;
    const maxRouteKm = pts[pts.length - 1][3];
    const distanceToSimulate = Math.max(stepKm, Math.min(maxDistanceKm, Math.max(0, maxRouteKm - startKm)));
    const totalSteps = Math.max(1, Math.ceil(distanceToSimulate / stepKm));

    const state = this.createInitialState(pts, startKm);
    const segments: RouteSegment[] = [];

    const maxSurgePower = Math.round(ctx.powerWatts * (1 + ctx.climbSurgePercent / 100));
    const maxSurgeDurationSec = ctx.climbSurgeDurationMinutes * 60;
    const cooloffLimitSec = 15 * 60;

    for (let i = 0; i < totalSteps; i++) {
      segments.push(
        this.simulateStep(
          i,
          startKm,
          stepKm,
          state,
          ctx,
          pts,
          intervals,
          maxSurgePower,
          maxSurgeDurationSec,
          cooloffLimitSec
        )
      );
    }

    return segments;
  }

  async runSimulationAsync(
    startKm: number,
    maxDistanceKm: number,
    cancelToken: { cancelled: boolean },
    chunkSize: number = 10000,
    customContext?: Partial<SimulationContext>
  ): Promise<RouteSegment[]> {
    const pts = this.terrain.trackPoints();
    if (!pts.length) {
      return [];
    }

    const intervals = this.terrain.surfaceIntervals();
    const ctx = this.getSimulationContext(customContext);
    const stepKm = STEP_METERS / 1000;
    const maxRouteKm = pts[pts.length - 1][3];
    const distanceToSimulate = Math.max(stepKm, Math.min(maxDistanceKm, maxRouteKm - startKm));
    const totalSteps = Math.max(1, Math.ceil(distanceToSimulate / stepKm));

    const state = this.createInitialState(pts, startKm);
    const segments: RouteSegment[] = [];

    const maxSurgePower = Math.round(ctx.powerWatts * (1 + ctx.climbSurgePercent / 100));
    const maxSurgeDurationSec = ctx.climbSurgeDurationMinutes * 60;
    const cooloffLimitSec = 15 * 60;

    for (let i = 0; i < totalSteps; i++) {
      if (i > 0 && i % chunkSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelToken.cancelled) return [];
      }

      segments.push(
        this.simulateStep(
          i,
          startKm,
          stepKm,
          state,
          ctx,
          pts,
          intervals,
          maxSurgePower,
          maxSurgeDurationSec,
          cooloffLimitSec
        )
      );
    }

    return segments;
  }

  private createInitialState(pts: TrackPointTuple[], startKm: number): SimulationStepState {
    return {
      eleCursor: 0,
      surfCursor: 0,
      prevEle: pts.length ? this.terrain.getElevationAtKm(startKm) : 1400,
      climbSurgeElapsedSec: 0,
      inCooloff: false,
      cooloffElapsedSec: 0,
      cumulativeDistanceKm: 0,
      cumulativeSeconds: 0
    };
  }

  private simulateStep(
    i: number,
    startKm: number,
    stepKm: number,
    state: SimulationStepState,
    ctx: SimulationContext,
    pts: TrackPointTuple[],
    intervals: SurfaceInterval[],
    maxSurgePower: number,
    maxSurgeDurationSec: number,
    cooloffLimitSec: number
  ): RouteSegment {
    const segStartKm = startKm + i * stepKm;
    const segEndKm = segStartKm + stepKm;

    const { ele: endEle, nextIdx: nextEleIdx } = this.terrain.getElevationWithCursor(pts, segEndKm, state.eleCursor);
    state.eleCursor = nextEleIdx;
    const startEle = state.prevEle;
    state.prevEle = endEle;

    const eleDelta = endEle - startEle;
    const grade = eleDelta / STEP_METERS;

    const { roadClass, surface, tracktype, nextIdx: nextSurfIdx } = this.terrain.getSurfaceWithCursor(
      intervals,
      segStartKm,
      state.surfCursor
    );
    state.surfCursor = nextSurfIdx;
    const crr = this.terrain.getCrr(surface, tracktype, roadClass);

    let mode: SimulationMode = 'riding';
    let speedKmh = ctx.flatSpeedKmh;
    let effectivePowerWatts = ctx.powerWatts;

    if (ctx.paceMode === 'speed') {
      speedKmh = Math.max(1.0, ctx.flatSpeedKmh);
      mode = 'riding';
      effectivePowerWatts = ctx.powerWatts;
    } else {
      // Power Mode Physics & State Machine
      if (state.inCooloff && grade <= 0.001) {
        state.inCooloff = false;
        state.cooloffElapsedSec = 0;
        state.climbSurgeElapsedSec = 0;
      }

      if (state.inCooloff) {
        mode = 'hike_a_bike';
        effectivePowerWatts = 0;
        speedKmh = this.physics.calculateHikeSpeed(grade, tracktype, ctx.totalSystemMassKg, ctx.hikeBikeBaseSpeedKmh);
        const duration = STEP_METERS / (speedKmh / 3.6);
        state.cooloffElapsedSec += duration;

        if (state.cooloffElapsedSec >= cooloffLimitSec) {
          state.inCooloff = false;
          state.cooloffElapsedSec = 0;
          state.climbSurgeElapsedSec = 0;
        }
      } else {
        const normalSpeed = this.physics.solveRidingSpeed(ctx.powerWatts, grade, crr, ctx.totalSystemMassKg);

        if (normalSpeed >= ctx.hikeBikeThresholdKmh) {
          mode = 'riding';
          effectivePowerWatts = ctx.powerWatts;
          speedKmh = normalSpeed;

          if (grade <= 0.02 && state.climbSurgeElapsedSec > 0) {
            const segDur = STEP_METERS / (speedKmh / 3.6);
            state.climbSurgeElapsedSec = Math.max(0, state.climbSurgeElapsedSec - segDur * 0.5);
          }
        } else {
          const neededPower = this.physics.powerNeededForSpeed(ctx.hikeBikeThresholdKmh, grade, crr, ctx.totalSystemMassKg);

          if (neededPower <= maxSurgePower && state.climbSurgeElapsedSec < maxSurgeDurationSec) {
            mode = 'climb_surge';
            effectivePowerWatts = Math.min(maxSurgePower, neededPower);
            speedKmh = ctx.hikeBikeThresholdKmh;

            const segDur = STEP_METERS / (speedKmh / 3.6);
            state.climbSurgeElapsedSec += segDur;

            if (state.climbSurgeElapsedSec >= maxSurgeDurationSec) {
              state.inCooloff = true;
              state.cooloffElapsedSec = 0;
            }
          } else {
            mode = 'hike_a_bike';
            effectivePowerWatts = 0;
            speedKmh = this.physics.calculateHikeSpeed(grade, tracktype, ctx.totalSystemMassKg, ctx.hikeBikeBaseSpeedKmh);

            if (state.climbSurgeElapsedSec >= maxSurgeDurationSec) {
              state.inCooloff = true;
              state.cooloffElapsedSec = 0;
            }
          }
        }
      }
    }

    const durationSeconds = STEP_METERS / Math.max(0.1, speedKmh / 3.6);
    state.cumulativeDistanceKm += stepKm;
    state.cumulativeSeconds += durationSeconds;

    return {
      index: i,
      startKm: segStartKm,
      endKm: segEndKm,
      lengthMeters: STEP_METERS,
      startElevationM: startEle,
      endElevationM: endEle,
      grade: Math.round(grade * 1000) / 1000,
      roadClass,
      surface,
      tracktype,
      crr,
      mode,
      effectivePowerWatts,
      speedKmh: Math.round(speedKmh * 10) / 10,
      durationSeconds: Math.round(durationSeconds * 10) / 10,
      climbSurgeElapsedSec: Math.round(state.climbSurgeElapsedSec),
      inCooloff: state.inCooloff,
      cooloffElapsedSec: Math.round(state.cooloffElapsedSec),
      cumulativeDistanceKm: Math.round(state.cumulativeDistanceKm * 100) / 100,
      cumulativeSeconds: Math.round(state.cumulativeSeconds)
    };
  }

  /**
   * Binary search over simulated segments to retrieve cumulative duration in seconds at routeKm.
   */
  queryCumulativeSeconds(segments: RouteSegment[], routeKm: number): number {
    if (!segments.length) return 0;
    if (routeKm <= 0) return 0;

    let low = 0;
    let high = segments.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const seg = segments[mid];
      if (seg.endKm >= routeKm) {
        if (mid === 0 || segments[mid - 1].endKm < routeKm) {
          const prevDist = mid === 0 ? seg.startKm : segments[mid - 1].endKm;
          const prevSec = mid === 0 ? 0 : segments[mid - 1].cumulativeSeconds;
          const segDist = seg.endKm - prevDist;
          const ratio = segDist > 0 ? (routeKm - prevDist) / segDist : 1;
          return prevSec + ratio * seg.durationSeconds;
        }
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return segments[segments.length - 1].cumulativeSeconds;
  }

  /**
   * Calculates ETA seconds between startMile and targetMile given simulated segments.
   */
  calculateEtaSeconds(
    startMile: number,
    targetMile: number,
    segments: RouteSegment[],
    paceMode: 'speed' | 'power' = this.settings.paceMode(),
    avgSpeedMph: number = this.settings.avgSpeedMph()
  ): number {
    const distanceMiles = Math.max(0, targetMile - startMile);
    if (distanceMiles <= 0.001) return 0;

    if (paceMode === 'speed') {
      const speed = Math.max(1.0, avgSpeedMph);
      return (distanceMiles / speed) * 3600;
    }

    const startKm = startMile * 1.609344;
    const targetKm = targetMile * 1.609344;

    if (segments.length > 0) {
      const startsBefore = segments[0].startKm <= startKm + 0.1;
      const coversEnd = segments[segments.length - 1].endKm >= targetKm - 0.1;
      if (startsBefore && coversEnd) {
        const tStart = this.queryCumulativeSeconds(segments, startKm);
        const tEnd = this.queryCumulativeSeconds(segments, targetKm);
        const diff = Math.max(0, tEnd - tStart);
        if (diff > 0) return diff;
      }
    }

    return (distanceMiles / Math.max(1.0, avgSpeedMph)) * 3600;
  }

  /**
   * Retrieves physics and time breakdown for a climb interval [startMile, endMile].
   */
  getClimbPhysicsStats(
    startMile: number,
    endMile: number,
    segments: RouteSegment[],
    paceMode: 'speed' | 'power' = this.settings.paceMode(),
    avgSpeedMph: number = this.settings.avgSpeedMph()
  ): ClimbPhysicsStats {
    const distanceMiles = Math.max(0, endMile - startMile);
    if (distanceMiles <= 0.001) {
      return {
        estimatedSeconds: 0,
        hikeBikeDistanceKm: 0,
        hikeBikeDistanceMiles: 0,
        hikeBikeDistanceMeters: 0,
        hikeBikeSeconds: 0
      };
    }

    if (paceMode === 'speed') {
      const speed = Math.max(1.0, avgSpeedMph);
      const estimatedSeconds = Math.round((distanceMiles / speed) * 3600);
      return {
        estimatedSeconds,
        hikeBikeDistanceKm: 0,
        hikeBikeDistanceMiles: 0,
        hikeBikeDistanceMeters: 0,
        hikeBikeSeconds: 0
      };
    }

    const startKm = startMile * 1.609344;
    const endKm = endMile * 1.609344;

    if (!segments.length) {
      const speed = Math.max(1.0, avgSpeedMph);
      const estimatedSeconds = Math.round((distanceMiles / speed) * 3600);
      return {
        estimatedSeconds,
        hikeBikeDistanceKm: 0,
        hikeBikeDistanceMiles: 0,
        hikeBikeDistanceMeters: 0,
        hikeBikeSeconds: 0
      };
    }

    // Binary search to find first segment overlapping startKm
    let low = 0;
    let high = segments.length - 1;
    let startIdx = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (segments[mid].endKm >= startKm) {
        startIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    let estimatedSeconds = 0;
    let hikeBikeDistanceMeters = 0;
    let hikeBikeSeconds = 0;

    for (let i = startIdx; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startKm >= endKm) break;

      const segEffectiveStart = Math.max(startKm, seg.startKm);
      const segEffectiveEnd = Math.min(endKm, seg.endKm);
      const segLenKm = seg.lengthMeters / 1000;
      const frac = segLenKm > 0.0001 ? Math.max(0, Math.min(1, (segEffectiveEnd - segEffectiveStart) / segLenKm)) : 1;

      const dur = seg.durationSeconds * frac;
      estimatedSeconds += dur;

      if (seg.mode === 'hike_a_bike') {
        hikeBikeDistanceMeters += seg.lengthMeters * frac;
        hikeBikeSeconds += dur;
      }
    }

    const hikeBikeDistanceKm = Math.round((hikeBikeDistanceMeters / 1000) * 10) / 10;
    const hikeBikeDistanceMiles = Math.round((hikeBikeDistanceKm / 1.60934) * 10) / 10;

    return {
      estimatedSeconds: Math.round(estimatedSeconds),
      hikeBikeDistanceKm,
      hikeBikeDistanceMiles,
      hikeBikeDistanceMeters: Math.round(hikeBikeDistanceMeters),
      hikeBikeSeconds: Math.round(hikeBikeSeconds)
    };
  }
}
