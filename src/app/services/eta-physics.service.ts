import { Injectable, inject, signal, effect } from '@angular/core';
import { SettingsService } from './settings.service';
import { CyclingPhysicsEngine } from './physics/cycling-physics.engine';
import { TerrainProfileService, TrackPointTuple } from './physics/terrain-profile.service';
import { PacingSimulationService } from './physics/pacing-simulation.service';
import {
  RouteSegment,
  SimulationMode,
  SurfaceInterval,
  ClimbPhysicsStats,
  SimulationContext
} from './physics/physics.model';

export type { SimulationMode, RouteSegment, SurfaceInterval, ClimbPhysicsStats, SimulationContext };

@Injectable({
  providedIn: 'root'
})
export class EtaPhysicsService {
  private readonly settings = inject(SettingsService);
  private readonly physics = inject(CyclingPhysicsEngine);
  private readonly terrain = inject(TerrainProfileService);
  private readonly pacing = inject(PacingSimulationService);

  // Surface intervals loaded from /data/route-surfaces.json
  readonly surfaceIntervals = this.terrain.surfaceIntervals;
  // Route track points loaded from /data/route-track.json: [lat, lon, ele, km, mi]
  readonly trackPoints = this.terrain.trackPoints;

  // Asynchronous recalculation signals
  readonly isCalculating = signal<boolean>(false);
  readonly cacheVersion = signal<number>(0);

  // Dynamic route distance based on loaded track points
  readonly totalDistanceKm = this.terrain.totalDistanceKm;

  // Simulation cache
  private cacheKey: string = '';
  private cachedSegments: RouteSegment[] = [];
  private cachedStartKm: number = 0;
  private activeCancelToken: { cancelled: boolean } | null = null;
  private debounceTimer: any = null;

  constructor() {
    effect(() => {
      // Track all settings that affect physics calculation
      const power = this.settings.riderPowerWatts();
      const paceMode = this.settings.paceMode();
      const surgePct = this.settings.climbSurgePercent();
      const surgeDur = this.settings.climbSurgeDurationMinutes();
      const hikeThresh = this.settings.hikeBikeThresholdKmh();
      const hikeBase = this.settings.hikeBikeBaseSpeedKmh();
      const mass = this.settings.totalSystemMassKg();
      const ptsLen = this.trackPoints().length;
      const surfLen = this.surfaceIntervals().length;

      // Only schedule background recalculation if data is available and power mode active
      if (ptsLen > 0 && surfLen > 0 && paceMode === 'power') {
        this.scheduleRecalculation(0, this.totalDistanceKm(), 40);
      }
    });
  }

  getCachedStartKm(): number {
    return this.cachedStartKm;
  }

  setSurfaceIntervals(intervals: SurfaceInterval[]): void {
    this.terrain.setSurfaceIntervals(intervals);
    this.invalidateCache();
    if (this.trackPoints().length > 0) {
      this.scheduleRecalculation(0, this.totalDistanceKm(), 10);
    }
  }

  setTrackPoints(points: TrackPointTuple[]): void {
    this.terrain.setTrackPoints(points);
    this.invalidateCache();
    if (this.surfaceIntervals().length > 0) {
      this.scheduleRecalculation(0, this.totalDistanceKm(), 10);
    }
  }

  invalidateCache(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.activeCancelToken) {
      this.activeCancelToken.cancelled = true;
      this.activeCancelToken = null;
    }
    this.cacheKey = '';
    this.cachedSegments = [];
    this.cachedStartKm = 0;
  }

  /**
   * Determine rolling resistance coefficient (Crr) based on OSM surface, tracktype, and highway class.
   */
  getCrr(surface: string, tracktype: string, roadClass: string): number {
    return this.terrain.getCrr(surface, tracktype, roadClass);
  }

  /**
   * Solves cycling speed (km/h) from mechanical power delivered to pedals using Newton-Raphson.
   */
  solveRidingSpeed(
    powerWatts: number,
    grade: number,
    crr: number,
    massKg: number,
    cda?: number,
    rho?: number,
    eta?: number
  ): number {
    return this.physics.solveRidingSpeed(powerWatts, grade, crr, massKg, cda, rho, eta);
  }

  /**
   * Computes power in watts required to maintain target speed (km/h) on a given grade and surface.
   */
  powerNeededForSpeed(
    targetKmh: number,
    grade: number,
    crr: number,
    massKg: number,
    cda?: number,
    rho?: number,
    eta?: number
  ): number {
    return this.physics.powerNeededForSpeed(targetKmh, grade, crr, massKg, cda, rho, eta);
  }

  /**
   * Computes hike-a-bike speed in km/h based on grade, tracktype, total rig mass, and base hike speed.
   */
  calculateHikeSpeed(
    grade: number,
    tracktype: string,
    massKg: number,
    baseHikeKmh: number
  ): number {
    return this.physics.calculateHikeSpeed(grade, tracktype, massKg, baseHikeKmh);
  }

  /**
   * Find road classification, surface, and tracktype at a specific kilometer along the route.
   */
  getSurfaceAtKm(km: number): { roadClass: string; surface: string; tracktype: string } {
    return this.terrain.getSurfaceAtKm(km);
  }

  /**
   * Linearly interpolates elevation in meters at a given kilometer from trackPoints.
   */
  getElevationAtKm(km: number): number {
    return this.terrain.getElevationAtKm(km);
  }

  /**
   * Fast cursor-based elevation interpolation for sequentially advancing segments.
   */
  getElevationWithCursor(
    pts: TrackPointTuple[],
    km: number,
    startIdx: number
  ): { ele: number; nextIdx: number } {
    return this.terrain.getElevationWithCursor(pts, km, startIdx);
  }

  /**
   * Fast cursor-based surface lookup for sequentially advancing segments.
   */
  getSurfaceWithCursor(
    intervals: SurfaceInterval[],
    km: number,
    startIdx: number
  ): { roadClass: string; surface: string; tracktype: string; nextIdx: number } {
    return this.terrain.getSurfaceWithCursor(intervals, km, startIdx);
  }

  /**
   * Forward simulation engine that calculates 50m segments from startKm up to maxDistanceKm.
   * Utilizes a running cache to avoid redundant simulations.
   */
  simulateSegments(startKm: number, maxDistanceKm: number): RouteSegment[] {
    const power = this.settings.riderPowerWatts();
    const paceMode = this.settings.paceMode();
    const surgePct = this.settings.climbSurgePercent();
    const surgeDurMin = this.settings.climbSurgeDurationMinutes();
    const hikeThreshKmh = this.settings.hikeBikeThresholdKmh();
    const hikeBaseKmh = this.settings.hikeBikeBaseSpeedKmh();
    const massKg = this.settings.totalSystemMassKg();
    const flatSpeedKmh = this.settings.avgSpeedMph() * 1.609344;

    const currentKey = `${startKm.toFixed(2)}_${paceMode}_${power}_${surgePct}_${surgeDurMin}_${hikeThreshKmh}_${hikeBaseKmh}_${massKg.toFixed(1)}_${flatSpeedKmh.toFixed(1)}`;

    // Check if running cache already covers the requested distance
    if (this.cacheKey === currentKey && this.cachedSegments.length > 0) {
      const lastSeg = this.cachedSegments[this.cachedSegments.length - 1];
      if (lastSeg.cumulativeDistanceKm >= maxDistanceKm - 0.1) {
        return this.cachedSegments;
      }
    }

    const segments = this.pacing.simulateSegments(startKm, maxDistanceKm);
    this.cacheKey = currentKey;
    this.cachedStartKm = startKm;
    this.cachedSegments = segments;
    return segments;
  }

  /**
   * Schedules an asynchronous background recalculation of the segment cache.
   */
  scheduleRecalculation(startKm: number = 0, distanceKm?: number, debounceMs: number = 40): void {
    const targetDistanceKm = distanceKm !== undefined ? distanceKm : (this.totalDistanceKm() || 4320);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.activeCancelToken) {
      this.activeCancelToken.cancelled = true;
      this.activeCancelToken = null;
    }

    const cancelToken = { cancelled: false };
    this.activeCancelToken = cancelToken;
    this.isCalculating.set(true);

    this.debounceTimer = setTimeout(async () => {
      try {
        await this.runSimulationAsync(startKm, targetDistanceKm, cancelToken);
      } finally {
        if (!cancelToken.cancelled) {
          this.isCalculating.set(false);
        }
      }
    }, debounceMs);
  }

  /**
   * Asynchronously calculates route segments in chunks, yielding control to the browser event loop.
   */
  async runSimulationAsync(
    startKm: number,
    maxDistanceKm: number,
    cancelToken: { cancelled: boolean },
    chunkSize: number = 10000
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (cancelToken.cancelled) return;

    const power = this.settings.riderPowerWatts();
    const paceMode = this.settings.paceMode();
    const surgePct = this.settings.climbSurgePercent();
    const surgeDurMin = this.settings.climbSurgeDurationMinutes();
    const hikeThreshKmh = this.settings.hikeBikeThresholdKmh();
    const hikeBaseKmh = this.settings.hikeBikeBaseSpeedKmh();
    const massKg = this.settings.totalSystemMassKg();
    const flatSpeedKmh = this.settings.avgSpeedMph() * 1.609344;

    const currentKey = `${startKm.toFixed(2)}_${paceMode}_${power}_${surgePct}_${surgeDurMin}_${hikeThreshKmh}_${hikeBaseKmh}_${massKg.toFixed(1)}_${flatSpeedKmh.toFixed(1)}`;

    const segments = await this.pacing.runSimulationAsync(startKm, maxDistanceKm, cancelToken, chunkSize);
    if (cancelToken.cancelled) return;

    this.cacheKey = currentKey;
    this.cachedStartKm = startKm;
    this.cachedSegments = segments;
    this.cacheVersion.update((v) => v + 1);
  }

  /**
   * Ensures the segment cache covers the requested distance from startKm.
   */
  ensureCacheCovered(startKm: number, neededDistanceKm: number): void {
    const segments = this.cachedSegments;
    const startsBefore = segments.length > 0 && segments[0].startKm <= startKm + 0.1;
    const coversEnd = segments.length > 0 && segments[segments.length - 1].endKm >= startKm + neededDistanceKm - 0.1;
    if (startsBefore && coversEnd) {
      return;
    }

    if (segments.length === 0) {
      this.simulateSegments(0, Math.max(startKm + neededDistanceKm + 10, 100));
    }
  }

  /**
   * Calculates estimated travel duration in seconds between startMile and targetMile.
   */
  calculateEtaSeconds(startMile: number, targetMile: number): number {
    const distanceMiles = Math.max(0, targetMile - startMile);
    if (distanceMiles <= 0.001) return 0;

    const paceMode = this.settings.paceMode();
    if (paceMode === 'speed') {
      const speed = Math.max(1.0, this.settings.avgSpeedMph());
      return (distanceMiles / speed) * 3600;
    }

    const startKm = startMile * 1.609344;
    const targetKm = targetMile * 1.609344;

    const segments = this.cachedSegments;
    if (segments.length > 0) {
      const startsBefore = segments[0].startKm <= startKm + 0.1;
      const coversEnd = segments[segments.length - 1].endKm >= targetKm - 0.1;
      if (startsBefore && coversEnd) {
        const tStart = this.pacing.queryCumulativeSeconds(segments, startKm);
        const tEnd = this.pacing.queryCumulativeSeconds(segments, targetKm);
        const diff = Math.max(0, tEnd - tStart);
        if (diff > 0) return diff;
      }
    }

    const synSegments = this.simulateSegments(0, Math.max(targetKm + 10.0, 100.0));
    const tStart = this.pacing.queryCumulativeSeconds(synSegments, startKm);
    const tEnd = this.pacing.queryCumulativeSeconds(synSegments, targetKm);
    const delta = Math.max(0, tEnd - tStart);
    if (delta <= 0) {
      const fallbackSpeed = Math.max(1.0, this.settings.avgSpeedMph());
      return (distanceMiles / fallbackSpeed) * 3600;
    }
    return delta;
  }

  /**
   * Binary search over simulated segments to retrieve cumulative duration in seconds at routeKm.
   */
  queryCumulativeSeconds(segments: RouteSegment[], routeKm: number): number {
    return this.pacing.queryCumulativeSeconds(segments, routeKm);
  }

  /**
   * Retrieves physics and time breakdown for a climb interval [startMile, endMile].
   */
  getClimbPhysicsStats(startMile: number, endMile: number): ClimbPhysicsStats {
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

    const paceMode = this.settings.paceMode();
    if (paceMode === 'speed') {
      const speed = Math.max(1.0, this.settings.avgSpeedMph());
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

    let segments = this.cachedSegments;
    const startsBefore = segments.length > 0 && segments[0].startKm <= startKm + 0.1;
    const coversEnd = segments.length > 0 && segments[segments.length - 1].endKm >= endKm - 0.1;
    if (!startsBefore || !coversEnd) {
      segments = this.simulateSegments(0, Math.max(endKm + 10.0, 100.0));
    }

    if (!segments.length) {
      const speed = Math.max(1.0, this.settings.avgSpeedMph());
      const estimatedSeconds = Math.round((distanceMiles / speed) * 3600);
      return {
        estimatedSeconds,
        hikeBikeDistanceKm: 0,
        hikeBikeDistanceMiles: 0,
        hikeBikeDistanceMeters: 0,
        hikeBikeSeconds: 0
      };
    }

    return this.pacing.getClimbPhysicsStats(startMile, endMile, segments, paceMode, this.settings.avgSpeedMph());
  }
}
