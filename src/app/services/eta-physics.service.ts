import { Injectable, inject, signal, effect, computed } from '@angular/core';
import { SettingsService } from './settings.service';

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

@Injectable({
  providedIn: 'root'
})
export class EtaPhysicsService {
  private readonly settings = inject(SettingsService);

  // Surface intervals loaded from /data/route-surfaces.json
  readonly surfaceIntervals = signal<SurfaceInterval[]>([]);
  // Route track points loaded from /data/route-track.json: [lat, lon, ele, km, mi]
  readonly trackPoints = signal<[number, number, number, number, number][]>([]);

  // Asynchronous recalculation signals
  readonly isCalculating = signal<boolean>(false);
  readonly cacheVersion = signal<number>(0);

  // Dynamic route distance based on loaded track points
  readonly totalDistanceKm = computed(() => {
    const pts = this.trackPoints();
    if (pts.length > 0) {
      return Math.ceil(pts[pts.length - 1][3]);
    }
    return 0;
  });

  // Simulation cache
  private cacheKey: string = '';
  private cachedSegments: RouteSegment[] = [];
  private cachedStartKm: number = 0;
  private activeCancelToken: { cancelled: boolean } | null = null;
  private debounceTimer: any = null;

  // Physics constants
  private readonly G = 9.80665;
  private readonly ETA = 0.96;       // 96% drivetrain efficiency
  private readonly RHO = 1.08;       // Air density at ~2,000m Tour Divide elevation (kg/m^3)
  private readonly CDA = 0.48;       // Frontal drag area for loaded bikepacking setup (m^2)
  private readonly STEP_METERS = 50; // 50m segments (0.05 km)

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
    this.surfaceIntervals.set(intervals);
    this.invalidateCache();
    if (this.trackPoints().length > 0) {
      this.scheduleRecalculation(0, this.totalDistanceKm(), 10);
    }
  }

  setTrackPoints(points: [number, number, number, number, number][]): void {
    this.trackPoints.set(points);
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
    let baseCrr = 0.016; // default unpaved gravel

    const s = (surface || '').toLowerCase();
    if (s === 'asphalt' || s === 'paved' || s === 'concrete') {
      baseCrr = 0.0055;
    } else if (s === 'compacted' || s === 'fine_gravel') {
      baseCrr = 0.0100;
    } else if (s === 'gravel' || s === 'unpaved') {
      baseCrr = 0.0160;
    } else if (s === 'dirt' || s === 'ground' || s === 'earth') {
      baseCrr = 0.0220;
    } else if (s === 'rock' || s === 'scree') {
      baseCrr = 0.0380;
    } else if (s === 'sand') {
      baseCrr = 0.0600;
    }

    // Tracktype firmness multiplier
    const tt = (tracktype || '').toLowerCase();
    let ttMult = 1.15; // default grade2
    if (tt === 'grade1') ttMult = 1.00;
    else if (tt === 'grade2') ttMult = 1.15;
    else if (tt === 'grade3') ttMult = 1.40;
    else if (tt === 'grade4') ttMult = 1.80;
    else if (tt === 'grade5') ttMult = 2.30;

    let crr = baseCrr * ttMult;

    // Singletrack penalty (roots, rocks, turns)
    const hw = (roadClass || '').toLowerCase();
    if (hw === 'path' || hw === 'footway' || hw === 'bridleway') {
      crr += 0.005;
    }

    return Math.round(crr * 10000) / 10000;
  }

  /**
   * Solves cycling speed (km/h) from mechanical power delivered to pedals using Newton-Raphson.
   * Equation: 0.5 * rho * cda * v^3 + m * g * (sin(theta) + Crr * cos(theta)) * v - eta * P = 0
   */
  solveRidingSpeed(
    powerWatts: number,
    grade: number,
    crr: number,
    massKg: number,
    cda: number = this.CDA,
    rho: number = this.RHO,
    eta: number = this.ETA
  ): number {
    const theta = Math.atan(grade);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const A = 0.5 * rho * cda;
    const B = massKg * this.G * (sinTheta + crr * cosTheta);
    const pWheel = Math.max(0, powerWatts * eta);

    // Initial guess for Newton-Raphson:
    // If B < 0 (downhill gravity exceeds rolling resistance), start above terminal speed
    // to ensure we are on the positive slope branch (f'(v) > 0)
    let v: number;
    if (B < 0) {
      const vTerm = Math.sqrt(Math.abs(B) / A);
      if (pWheel <= 0) {
        return Math.min(this.getMaxSafeDescentSpeed(grade, crr), vTerm * 3.6);
      }
      v = vTerm + 1.0;
    } else {
      v = Math.max(1.0, pWheel / (B + 1.0));
    }

    // Newton-Raphson solver for v (m/s)
    for (let iter = 0; iter < 12; iter++) {
      const f = A * (v ** 3) + B * v - pWheel;
      const fPrime = 3 * A * (v ** 2) + B;
      if (Math.abs(fPrime) < 1e-9) break;

      const vNext = v - f / fPrime;
      if (Math.abs(vNext - v) < 1e-5) {
        v = vNext;
        break;
      }
      v = Math.max(0.1, vNext);
    }

    let speedKmh = Math.max(0.1, v) * 3.6;

    // Safety cap on descents
    if (grade < 0) {
      speedKmh = Math.min(this.getMaxSafeDescentSpeed(grade, crr), speedKmh);
    }

    return Math.round(speedKmh * 100) / 100;
  }

  /**
   * Computes power in watts required to maintain target speed (km/h) on a given grade and surface.
   */
  powerNeededForSpeed(
    targetKmh: number,
    grade: number,
    crr: number,
    massKg: number,
    cda: number = this.CDA,
    rho: number = this.RHO,
    eta: number = this.ETA
  ): number {
    const v = Math.max(0.1, targetKmh / 3.6);
    const theta = Math.atan(grade);
    const A = 0.5 * rho * cda;
    const B = massKg * this.G * (Math.sin(theta) + crr * Math.cos(theta));
    const pWheel = A * (v ** 3) + B * v;
    const pRider = pWheel / eta;
    return Math.max(0, Math.round(pRider * 10) / 10);
  }

  /**
   * Computes hike-a-bike speed in km/h based on grade, tracktype, total rig mass, and base hike speed.
   * Model: v = v_base * (1 / (1 + 5.0 * grade)) * firmness * weightFactor.
   * At 20% grade, speed drops to exactly 50% of base speed.
   */
  calculateHikeSpeed(
    grade: number,
    tracktype: string,
    massKg: number,
    baseHikeKmh: number
  ): number {
    const positiveGrade = Math.max(0, grade);
    const gradeFactor = 1.0 / (1.0 + 5.0 * positiveGrade);

    const tt = (tracktype || '').toLowerCase();
    let firmnessFactor = 0.95;
    if (tt === 'grade1') firmnessFactor = 1.00;
    else if (tt === 'grade2') firmnessFactor = 0.95;
    else if (tt === 'grade3') firmnessFactor = 0.85;
    else if (tt === 'grade4') firmnessFactor = 0.75;
    else if (tt === 'grade5') firmnessFactor = 0.65;

    // Rig weight damping relative to baseline 85kg
    const weightFactor = Math.max(0.75, Math.min(1.20, (85.0 / Math.max(40, massKg)) ** 0.25));

    const speed = baseHikeKmh * gradeFactor * firmnessFactor * weightFactor;
    return Math.max(0.8, Math.round(speed * 100) / 100);
  }

  /**
   * Maximum safe downhill speed limits based on surface roughness.
   */
  private getMaxSafeDescentSpeed(grade: number, crr: number): number {
    if (crr <= 0.008) return 60.0; // Paved / asphalt
    if (crr <= 0.015) return 42.0; // Smooth gravel / hardpack
    if (crr <= 0.025) return 32.0; // Mixed gravel
    return 22.0;                   // Rough dirt / rocks / singletrack
  }

  /**
   * Find road classification, surface, and tracktype at a specific kilometer along the route.
   */
  getSurfaceAtKm(km: number): { roadClass: string; surface: string; tracktype: string } {
    const intervals = this.surfaceIntervals();
    if (!intervals.length) {
      return { roadClass: 'unclassified', surface: 'gravel', tracktype: 'grade2' };
    }

    // Binary search over intervals [startKm, endKm, hw, surf, tt]
    let low = 0;
    let high = intervals.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const [start, end, hw, surf, tt] = intervals[mid];
      if (km >= start && km <= end) {
        return { roadClass: hw, surface: surf, tracktype: tt };
      }
      if (km < start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Fallback to closest interval
    const clamped = Math.max(0, Math.min(intervals.length - 1, low));
    return {
      roadClass: intervals[clamped][2],
      surface: intervals[clamped][3],
      tracktype: intervals[clamped][4]
    };
  }

  /**
   * Linearly interpolates elevation in meters at a given kilometer from trackPoints.
   */
  getElevationAtKm(km: number): number {
    const pts = this.trackPoints();
    if (!pts.length) return 1400; // default elevation

    let low = 0;
    let high = pts.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const ptKm = pts[mid][3];
      if (Math.abs(ptKm - km) < 0.001) {
        return pts[mid][2];
      }
      if (ptKm < km) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx = Math.max(0, Math.min(pts.length - 2, high));
    const p1 = pts[idx];
    const p2 = pts[idx + 1];
    const dKm = p2[3] - p1[3];
    if (dKm <= 0.0001) return p1[2];

    const ratio = Math.max(0, Math.min(1, (km - p1[3]) / dKm));
    return p1[2] + ratio * (p2[2] - p1[2]);
  }

  /**
   * Fast cursor-based elevation interpolation for sequentially advancing segments.
   */
  getElevationWithCursor(
    pts: [number, number, number, number, number][],
    km: number,
    startIdx: number
  ): { ele: number; nextIdx: number } {
    if (!pts.length) return { ele: 1400, nextIdx: 0 };

    let idx = Math.max(0, Math.min(pts.length - 1, startIdx));
    while (idx > 0 && pts[idx][3] > km) {
      idx--;
    }
    while (idx < pts.length - 1 && pts[idx + 1][3] <= km) {
      idx++;
    }

    if (idx >= pts.length - 1) {
      return { ele: pts[pts.length - 1][2], nextIdx: idx };
    }

    const p1 = pts[idx];
    const p2 = pts[idx + 1];
    const dKm = p2[3] - p1[3];
    if (dKm <= 0.0001) return { ele: p1[2], nextIdx: idx };

    const ratio = Math.max(0, Math.min(1, (km - p1[3]) / dKm));
    const ele = p1[2] + ratio * (p2[2] - p1[2]);
    return { ele, nextIdx: idx };
  }

  /**
   * Fast cursor-based surface lookup for sequentially advancing segments.
   */
  getSurfaceWithCursor(
    intervals: SurfaceInterval[],
    km: number,
    startIdx: number
  ): { roadClass: string; surface: string; tracktype: string; nextIdx: number } {
    if (!intervals.length) {
      return { roadClass: 'unclassified', surface: 'gravel', tracktype: 'grade2', nextIdx: 0 };
    }

    let idx = Math.max(0, Math.min(intervals.length - 1, startIdx));
    while (idx > 0 && km < intervals[idx][0]) {
      idx--;
    }
    while (idx < intervals.length - 1 && km > intervals[idx][1]) {
      idx++;
    }

    const cur = intervals[idx];
    return {
      roadClass: cur[2],
      surface: cur[3],
      tracktype: cur[4],
      nextIdx: idx
    };
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

    const stepKm = this.STEP_METERS / 1000; // 0.05 km
    const pts = this.trackPoints();
    if (!pts.length) {
      return [];
    }
    const intervals = this.surfaceIntervals();
    const maxRouteKm = pts[pts.length - 1][3];
    const distanceToSimulate = Math.max(stepKm, Math.min(maxDistanceKm, Math.max(0, maxRouteKm - startKm)));
    const totalSteps = Math.max(1, Math.ceil(distanceToSimulate / stepKm));
    const segments: RouteSegment[] = [];

    let eleCursor = 0;
    let surfCursor = 0;
    let prevEle = pts.length ? this.getElevationAtKm(startKm) : 1400;

    let climbSurgeElapsedSec = 0;
    let inCooloff = false;
    let cooloffElapsedSec = 0;
    let cumulativeDistanceKm = 0;
    let cumulativeSeconds = 0;

    const maxSurgePower = Math.round(power * (1 + surgePct / 100));
    const maxSurgeDurationSec = surgeDurMin * 60;
    const cooloffLimitSec = 15 * 60; // 15 minutes cooloff

    for (let i = 0; i < totalSteps; i++) {
      const segStartKm = startKm + i * stepKm;
      const segEndKm = segStartKm + stepKm;

      const { ele: endEle, nextIdx: nextEleIdx } = this.getElevationWithCursor(pts, segEndKm, eleCursor);
      eleCursor = nextEleIdx;
      const startEle = prevEle;
      prevEle = endEle;

      const eleDelta = endEle - startEle;
      const grade = eleDelta / this.STEP_METERS;

      const { roadClass, surface, tracktype, nextIdx: nextSurfIdx } = this.getSurfaceWithCursor(intervals, segStartKm, surfCursor);
      surfCursor = nextSurfIdx;
      const crr = this.getCrr(surface, tracktype, roadClass);

      let mode: SimulationMode = 'riding';
      let speedKmh = flatSpeedKmh;
      let effectivePowerWatts = power;

      if (paceMode === 'speed') {
        speedKmh = Math.max(1.0, flatSpeedKmh);
        mode = 'riding';
        effectivePowerWatts = power;
      } else {
        // Power Mode Physics & State Machine
        if (inCooloff && grade <= 0.001) {
          inCooloff = false;
          cooloffElapsedSec = 0;
          climbSurgeElapsedSec = 0;
        }

        if (inCooloff) {
          mode = 'hike_a_bike';
          effectivePowerWatts = 0;
          speedKmh = this.calculateHikeSpeed(grade, tracktype, massKg, hikeBaseKmh);
          const duration = this.STEP_METERS / (speedKmh / 3.6);
          cooloffElapsedSec += duration;

          if (cooloffElapsedSec >= cooloffLimitSec) {
            inCooloff = false;
            cooloffElapsedSec = 0;
            climbSurgeElapsedSec = 0;
          }
        } else {
          const normalSpeed = this.solveRidingSpeed(power, grade, crr, massKg);

          if (normalSpeed >= hikeThreshKmh) {
            mode = 'riding';
            effectivePowerWatts = power;
            speedKmh = normalSpeed;

            if (grade <= 0.02 && climbSurgeElapsedSec > 0) {
              const segDur = this.STEP_METERS / (speedKmh / 3.6);
              climbSurgeElapsedSec = Math.max(0, climbSurgeElapsedSec - segDur * 0.5);
            }
          } else {
            const neededPower = this.powerNeededForSpeed(hikeThreshKmh, grade, crr, massKg);

            if (neededPower <= maxSurgePower && climbSurgeElapsedSec < maxSurgeDurationSec) {
              mode = 'climb_surge';
              effectivePowerWatts = Math.min(maxSurgePower, neededPower);
              speedKmh = hikeThreshKmh;

              const segDur = this.STEP_METERS / (speedKmh / 3.6);
              climbSurgeElapsedSec += segDur;

              if (climbSurgeElapsedSec >= maxSurgeDurationSec) {
                inCooloff = true;
                cooloffElapsedSec = 0;
              }
            } else {
              mode = 'hike_a_bike';
              effectivePowerWatts = 0;
              speedKmh = this.calculateHikeSpeed(grade, tracktype, massKg, hikeBaseKmh);

              if (climbSurgeElapsedSec >= maxSurgeDurationSec) {
                inCooloff = true;
                cooloffElapsedSec = 0;
              }
            }
          }
        }
      }

      const durationSeconds = this.STEP_METERS / Math.max(0.1, speedKmh / 3.6);
      cumulativeDistanceKm += stepKm;
      cumulativeSeconds += durationSeconds;

      segments.push({
        index: i,
        startKm: segStartKm,
        endKm: segEndKm,
        lengthMeters: this.STEP_METERS,
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
        climbSurgeElapsedSec: Math.round(climbSurgeElapsedSec),
        inCooloff,
        cooloffElapsedSec: Math.round(cooloffElapsedSec),
        cumulativeDistanceKm: Math.round(cumulativeDistanceKm * 100) / 100,
        cumulativeSeconds: Math.round(cumulativeSeconds)
      });
    }

    this.cacheKey = currentKey;
    this.cachedStartKm = startKm;
    this.cachedSegments = segments;
    return segments;
  }

  /**
   * Schedules an asynchronous background recalculation of the segment cache.
   * Debounced to ensure rapid UI interactions (e.g. clicking +/- multiple times in header)
   * update the number instantaneously without freezing the UI thread.
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
   * Asynchronously calculates route segments in chunks, yielding control to the browser event loop
   * between chunks so that the UI thread never freezes.
   */
  async runSimulationAsync(
    startKm: number,
    maxDistanceKm: number,
    cancelToken: { cancelled: boolean },
    chunkSize: number = 10000
  ): Promise<void> {
    // Immediate yield so the DOM paints the updated power value on screen before computation starts
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

    const stepKm = this.STEP_METERS / 1000; // 0.05 km
    const pts = this.trackPoints();
    if (!pts.length) {
      return;
    }
    const intervals = this.surfaceIntervals();
    const maxRouteKm = pts[pts.length - 1][3];
    const distanceToSimulate = Math.max(stepKm, Math.min(maxDistanceKm, maxRouteKm - startKm));
    const totalSteps = Math.max(1, Math.ceil(distanceToSimulate / stepKm));
    const segments: RouteSegment[] = [];

    let eleCursor = 0;
    let surfCursor = 0;
    let prevEle = pts.length ? this.getElevationAtKm(startKm) : 1400;

    let climbSurgeElapsedSec = 0;
    let inCooloff = false;
    let cooloffElapsedSec = 0;
    let cumulativeDistanceKm = 0;
    let cumulativeSeconds = 0;

    const maxSurgePower = Math.round(power * (1 + surgePct / 100));
    const maxSurgeDurationSec = surgeDurMin * 60;
    const cooloffLimitSec = 15 * 60; // 15 minutes cooloff

    for (let i = 0; i < totalSteps; i++) {
      if (i > 0 && i % chunkSize === 0) {
        // Yield to browser event loop
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelToken.cancelled) return;
      }

      const segStartKm = startKm + i * stepKm;
      const segEndKm = segStartKm + stepKm;

      const { ele: endEle, nextIdx: nextEleIdx } = this.getElevationWithCursor(pts, segEndKm, eleCursor);
      eleCursor = nextEleIdx;
      const startEle = prevEle;
      prevEle = endEle;

      const eleDelta = endEle - startEle;
      const grade = eleDelta / this.STEP_METERS;

      const { roadClass, surface, tracktype, nextIdx: nextSurfIdx } = this.getSurfaceWithCursor(intervals, segStartKm, surfCursor);
      surfCursor = nextSurfIdx;
      const crr = this.getCrr(surface, tracktype, roadClass);

      let mode: SimulationMode = 'riding';
      let speedKmh = flatSpeedKmh;
      let effectivePowerWatts = power;

      if (paceMode === 'speed') {
        speedKmh = Math.max(1.0, flatSpeedKmh);
        mode = 'riding';
        effectivePowerWatts = power;
      } else {
        if (inCooloff && grade <= 0.001) {
          inCooloff = false;
          cooloffElapsedSec = 0;
          climbSurgeElapsedSec = 0;
        }

        if (inCooloff) {
          mode = 'hike_a_bike';
          effectivePowerWatts = 0;
          speedKmh = this.calculateHikeSpeed(grade, tracktype, massKg, hikeBaseKmh);
          const duration = this.STEP_METERS / (speedKmh / 3.6);
          cooloffElapsedSec += duration;

          if (cooloffElapsedSec >= cooloffLimitSec) {
            inCooloff = false;
            cooloffElapsedSec = 0;
            climbSurgeElapsedSec = 0;
          }
        } else {
          const normalSpeed = this.solveRidingSpeed(power, grade, crr, massKg);

          if (normalSpeed >= hikeThreshKmh) {
            mode = 'riding';
            effectivePowerWatts = power;
            speedKmh = normalSpeed;

            if (grade <= 0.02 && climbSurgeElapsedSec > 0) {
              const segDur = this.STEP_METERS / (speedKmh / 3.6);
              climbSurgeElapsedSec = Math.max(0, climbSurgeElapsedSec - segDur * 0.5);
            }
          } else {
            const neededPower = this.powerNeededForSpeed(hikeThreshKmh, grade, crr, massKg);

            if (neededPower <= maxSurgePower && climbSurgeElapsedSec < maxSurgeDurationSec) {
              mode = 'climb_surge';
              effectivePowerWatts = Math.min(maxSurgePower, neededPower);
              speedKmh = hikeThreshKmh;

              const segDur = this.STEP_METERS / (speedKmh / 3.6);
              climbSurgeElapsedSec += segDur;

              if (climbSurgeElapsedSec >= maxSurgeDurationSec) {
                inCooloff = true;
                cooloffElapsedSec = 0;
              }
            } else {
              mode = 'hike_a_bike';
              effectivePowerWatts = 0;
              speedKmh = this.calculateHikeSpeed(grade, tracktype, massKg, hikeBaseKmh);

              if (climbSurgeElapsedSec >= maxSurgeDurationSec) {
                inCooloff = true;
                cooloffElapsedSec = 0;
              }
            }
          }
        }
      }

      const durationSeconds = this.STEP_METERS / Math.max(0.1, speedKmh / 3.6);
      cumulativeDistanceKm += stepKm;
      cumulativeSeconds += durationSeconds;

      segments.push({
        index: i,
        startKm: segStartKm,
        endKm: segEndKm,
        lengthMeters: this.STEP_METERS,
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
        climbSurgeElapsedSec: Math.round(climbSurgeElapsedSec),
        inCooloff,
        cooloffElapsedSec: Math.round(cooloffElapsedSec),
        cumulativeDistanceKm: Math.round(cumulativeDistanceKm * 100) / 100,
        cumulativeSeconds: Math.round(cumulativeSeconds)
      });
    }

    if (cancelToken.cancelled) return;

    this.cacheKey = currentKey;
    this.cachedStartKm = startKm;
    this.cachedSegments = segments;
    this.cacheVersion.update((v) => v + 1);
  }

  /**
   * Ensures the segment cache covers the requested distance from startKm.
   * If not already covered, simulates synchronously if cache was empty.
   * Pure and safe to call without writing to signals.
   */
  ensureCacheCovered(startKm: number, neededDistanceKm: number): void {
    const segments = this.cachedSegments;
    const startsBefore = segments.length > 0 && segments[0].startKm <= startKm + 0.1;
    const coversEnd = segments.length > 0 && segments[segments.length - 1].endKm >= startKm + neededDistanceKm - 0.1;
    if (startsBefore && coversEnd) {
      return; // Cache already covers this corridor
    }

    if (segments.length === 0) {
      // Cold start: simulate once to populate cache
      this.simulateSegments(0, Math.max(startKm + neededDistanceKm + 10, 100));
    }
  }

  /**
   * Calculates estimated travel duration in seconds between startMile and targetMile.
   * In Power mode, queries pre-calculated segment cache via binary search (sub-millisecond).
   * In Speed mode, returns distance / speed.
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

    // Fast path: Query cached segments if available and covering this corridor
    const segments = this.cachedSegments;
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

    // Fallback: If cache is empty or doesn't cover yet (e.g. cold start / unit tests),
    // compute segments synchronously to populate cache without side effects.
    const synSegments = this.simulateSegments(0, Math.max(targetKm + 10.0, 100.0));
    const tStart = this.queryCumulativeSeconds(synSegments, startKm);
    const tEnd = this.queryCumulativeSeconds(synSegments, targetKm);
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
   * Retrieves physics and time breakdown for a climb interval [startMile, endMile].
   * Computes total estimated duration, hike-a-bike distance, and hike-a-bike time.
   */
  getClimbPhysicsStats(startMile: number, endMile: number): {
    estimatedSeconds: number;
    hikeBikeDistanceKm: number;
    hikeBikeDistanceMiles: number;
    hikeBikeDistanceMeters: number;
    hikeBikeSeconds: number;
  } {
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
