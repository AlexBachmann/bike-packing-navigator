import { Injectable, signal, computed, Signal, OnDestroy, inject, ApplicationRef } from '@angular/core';
import { RouteDataService } from './route-data.service';
import { DeadReckoningService } from './dead-reckoning.service';
import { calculateBearing } from '../models/weather.model';
import { SimulatorState } from '../models/ride-cockpit.model';

export type { SimulatorState } from '../models/ride-cockpit.model';

const KM_PER_MILE = 1.609344;
const DEFAULT_SPEED_KPH = 15;
const DEFAULT_TICK_INTERVAL_MS = 1000;

@Injectable({
  providedIn: 'root'
})
export class GpsSimulatorService implements OnDestroy {
  private readonly routeDataService = inject(RouteDataService, { optional: true });
  private readonly deadReckoning = inject(DeadReckoningService, { optional: true });
  private readonly appRef = inject(ApplicationRef, { optional: true });

  private points: [number, number, number, number, number, ...number[]][] = [];
  private lastIndex = 0;
  private intervalId: any = null;
  private lastTimestamp = 0;

  private readonly _state = signal<SimulatorState>({
    running: false,
    speedKph: DEFAULT_SPEED_KPH,
    simulatedMile: 0,
    simulatedCoords: null,
    simulatedHeading: 0,
    simulatedSpeedKph: 0
  });

  readonly state: Signal<SimulatorState> = this._state.asReadonly();
  readonly running = computed(() => this._state().running);
  readonly speedKph = computed(() => this._state().speedKph);
  readonly simulatedMile = computed(() => this._state().simulatedMile);
  readonly simulatedCoords = computed(() => this._state().simulatedCoords);
  readonly simulatedHeading = computed(() => this._state().simulatedHeading);
  readonly simulatedSpeedKph = computed(() => this._state().simulatedSpeedKph);

  ngOnDestroy(): void {
    this.stop();
  }

  /**
   * Set or replace trackpoints used for simulation
   */
  private getCanonicalTotalMiles(): number | undefined {
    const rawPoints = typeof this.routeDataService?.trackPoints === 'function'
      ? this.routeDataService.trackPoints()
      : (this.routeDataService as any)?.trackPoints;
    if (rawPoints && rawPoints.length > 0) {
      return rawPoints[rawPoints.length - 1][4];
    }
    const totalSignal = this.routeDataService?.totalMilesSignal;
    const total = typeof totalSignal === 'function' ? totalSignal() : totalSignal;
    return typeof total === 'number' && total > 0 ? total : undefined;
  }

  private toTrackMile(canonicalMile: number): number {
    const pts = this.points;
    if (!pts || pts.length < 2) return canonicalMile;
    const trackTotalMiles = pts[pts.length - 1][4];
    const canonicalTotalMiles = this.getCanonicalTotalMiles();
    if (
      typeof canonicalTotalMiles === 'number' &&
      canonicalTotalMiles > 0 &&
      trackTotalMiles > 0 &&
      Math.abs(trackTotalMiles - canonicalTotalMiles) > 0.1
    ) {
      return (canonicalMile / canonicalTotalMiles) * trackTotalMiles;
    }
    return canonicalMile;
  }

  setTrackPoints(trackPoints: [number, number, number, number, number][]): void {
    this.points = trackPoints || [];
    this.lastIndex = 0;
    if (this.points.length > 0 && !this._state().running) {
      const currentSimMile = this._state().simulatedMile;
      const canonicalTotal = this.getCanonicalTotalMiles() || this.points[this.points.length - 1][4];
      const clampedMile = Math.max(this.points[0][4], Math.min(canonicalTotal, currentSimMile));
      const position = this.interpolate(clampedMile);
      this._state.update((s) => ({
        ...s,
        simulatedMile: clampedMile,
        simulatedCoords: position.coords,
        simulatedHeading: position.heading
      }));
    }
  }

  /**
   * Starts simulation at specified speed along trackpoints.
   * If trackpoints are omitted, falls back to existing points or RouteDataService.
   */
  start(
    speedKph?: number,
    trackPoints?: [number, number, number, number, number][],
    tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS
  ): void {
    if (trackPoints && trackPoints.length > 0) {
      this.setTrackPoints(trackPoints);
    } else if (this.points.length === 0 && this.routeDataService) {
      const guidance = typeof this.routeDataService.guidanceTrackPoints === 'function' ? this.routeDataService.guidanceTrackPoints() : [];
      const rPoints = guidance && guidance.length >= 2 ? guidance : this.routeDataService.trackPoints();
      if (rPoints && rPoints.length > 0) {
        this.setTrackPoints(rPoints);
      }
    }

    if (this.points.length < 2) {
      return;
    }

    const currentSpeed = typeof speedKph === 'number'
      ? (isNaN(speedKph) ? 0 : speedKph)
      : this._state().speedKph;
    const canonicalTotal = this.getCanonicalTotalMiles() || this.points[this.points.length - 1][4];
    const minMile = this.points[0][4];

    // If at or past route end when moving forward, loop or restart from 0
    let startMile = this._state().simulatedMile;
    if (currentSpeed >= 0 && startMile >= canonicalTotal) {
      startMile = minMile;
      this.lastIndex = 0;
    } else if (currentSpeed < 0 && startMile <= minMile) {
      startMile = minMile;
      this.lastIndex = 0;
    }

    // Stop any existing timer
    this.clearTimer();

    const position = this.interpolate(startMile);
    const motionHeading = currentSpeed < 0
      ? ((position.heading + 180) % 360)
      : position.heading;

    this._state.set({
      running: true,
      speedKph: currentSpeed,
      simulatedMile: startMile,
      simulatedCoords: position.coords,
      simulatedHeading: motionHeading,
      simulatedSpeedKph: currentSpeed
    });

    if (this.deadReckoning && position.coords) {
      if (typeof this.deadReckoning.reset === 'function') {
        this.deadReckoning.reset(startMile, position.coords, motionHeading);
      }
      this.deadReckoning.updateGpsFix({
        latitude: position.coords[0],
        longitude: position.coords[1],
        timestamp: Date.now(),
        projectedMile: startMile,
        heading: motionHeading
      }, currentSpeed);
    }

    this.lastTimestamp = Date.now();
    this.intervalId = setInterval(() => {
      const now = Date.now();
      const deltaSec = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      this.tick(deltaSec);
    }, tickIntervalMs);
  }

  /**
   * Stops active simulation, resetting instantaneous speed to 0.
   */
  stop(): void {
    this.clearTimer();
    const current = this._state();
    this._state.update((s) => ({
      ...s,
      running: false,
      simulatedSpeedKph: 0
    }));
    if (this.deadReckoning) {
      if (typeof this.deadReckoning.reset === 'function') {
        this.deadReckoning.reset(current.simulatedMile, current.simulatedCoords, current.simulatedHeading);
      } else {
        this.deadReckoning.stop();
      }
    }
    this.notifyApp();
  }

  /**
   * Updates target simulation speed in km/h.
   */
  setSpeed(speedKph: number): void {
    const validSpeed = isNaN(speedKph) ? 0 : speedKph;
    this._state.update((s) => ({
      ...s,
      speedKph: validSpeed,
      simulatedSpeedKph: s.running ? validSpeed : 0
    }));
  }

  /**
   * Seeks to a specific route mile, updating coordinates and forward heading.
   */
  seek(mile: number): void {
    if (this.points.length === 0 && this.routeDataService) {
      const guidance = typeof this.routeDataService.guidanceTrackPoints === 'function' ? this.routeDataService.guidanceTrackPoints() : [];
      const rPoints = guidance && guidance.length >= 2 ? guidance : this.routeDataService.trackPoints();
      if (rPoints && rPoints.length > 0) {
        this.points = rPoints;
        this.lastIndex = 0;
      }
    }

    if (this.points.length === 0) {
      this._state.update((s) => ({ ...s, simulatedMile: Math.max(0, mile) }));
      return;
    }

    const canonicalTotal = this.getCanonicalTotalMiles() || this.points[this.points.length - 1][4];
    const clampedMile = Math.max(this.points[0][4], Math.min(canonicalTotal, mile));
    const position = this.interpolate(clampedMile);

    if (clampedMile >= canonicalTotal) {
      this.stop();
      this._state.set({
        running: false,
        speedKph: this._state().speedKph,
        simulatedMile: canonicalTotal,
        simulatedCoords: position.coords,
        simulatedHeading: position.heading,
        simulatedSpeedKph: 0
      });
      return;
    }

    this._state.update((s) => ({
      ...s,
      simulatedMile: clampedMile,
      simulatedCoords: position.coords,
      simulatedHeading: position.heading
    }));

    if (this.deadReckoning && position.coords) {
      if (this._state().running) {
        this.deadReckoning.updateGpsFix({
          latitude: position.coords[0],
          longitude: position.coords[1],
          timestamp: Date.now(),
          projectedMile: clampedMile,
          heading: position.heading
        }, this._state().speedKph);
      } else {
        if (typeof this.deadReckoning.reset === 'function') {
          this.deadReckoning.reset(clampedMile, position.coords, position.heading);
        } else {
          this.deadReckoning.stop();
        }
      }
    }
  }

  /**
   * Steps simulation forward by deltaSeconds.
   */
  tick(deltaSeconds: number = 1.0): void {
    if (!this._state().running || this.points.length < 2) {
      return;
    }

    const speed = this._state().speedKph;
    const deltaMiles = (speed * deltaSeconds) / (3600 * KM_PER_MILE);
    const targetMile = this._state().simulatedMile + deltaMiles;
    const canonicalTotal = this.getCanonicalTotalMiles() || this.points[this.points.length - 1][4];
    const minMile = this.points[0][4];

    // Forward termination at end of route
    if (speed >= 0 && targetMile >= canonicalTotal) {
      this.stop();
      const lastPoint = this.points[this.points.length - 1];
      const prevPoint = this.points[this.points.length - 2];
      const finalHeading = calculateBearing(prevPoint[0], prevPoint[1], lastPoint[0], lastPoint[1]);

      this._state.set({
        running: false,
        speedKph: speed,
        simulatedMile: canonicalTotal,
        simulatedCoords: [lastPoint[0], lastPoint[1]],
        simulatedHeading: finalHeading,
        simulatedSpeedKph: 0
      });
      if (this.deadReckoning) {
        this.deadReckoning.updateGpsFix({
          latitude: lastPoint[0],
          longitude: lastPoint[1],
          timestamp: Date.now(),
          projectedMile: canonicalTotal,
          heading: finalHeading
        }, 0);
        this.deadReckoning.stop();
      }
      this.notifyApp();
      return;
    }

    // Backward termination at start of route (position 0)
    if (speed < 0 && targetMile <= minMile) {
      this.stop();
      const firstPoint = this.points[0];
      const nextPoint = this.points[1];
      const startHeading = calculateBearing(firstPoint[0], firstPoint[1], nextPoint[0], nextPoint[1]);

      this._state.set({
        running: false,
        speedKph: speed,
        simulatedMile: minMile,
        simulatedCoords: [firstPoint[0], firstPoint[1]],
        simulatedHeading: startHeading,
        simulatedSpeedKph: 0
      });
      if (this.deadReckoning) {
        this.deadReckoning.updateGpsFix({
          latitude: firstPoint[0],
          longitude: firstPoint[1],
          timestamp: Date.now(),
          projectedMile: minMile,
          heading: startHeading
        }, 0);
        this.deadReckoning.stop();
      }
      this.notifyApp();
      return;
    }

    const position = this.interpolate(targetMile);
    const motionHeading = speed < 0
      ? ((position.heading + 180) % 360)
      : position.heading;

    this._state.set({
      running: true,
      speedKph: speed,
      simulatedMile: targetMile,
      simulatedCoords: position.coords,
      simulatedHeading: motionHeading,
      simulatedSpeedKph: speed
    });

    if (this.deadReckoning && position.coords) {
      this.deadReckoning.updateGpsFix({
        latitude: position.coords[0],
        longitude: position.coords[1],
        timestamp: Date.now(),
        projectedMile: targetMile,
        heading: motionHeading
      }, speed);
    }
    this.notifyApp();
  }

  private notifyApp(): void {
    try {
      if (this.appRef && !this.appRef.destroyed) {
        this.appRef.tick();
      }
    } catch {
      // Ignore if tick is already in progress or destroyed
    }
  }

  /**
   * Resets simulation back to start.
   */
  reset(): void {
    this.stop();
    this.lastIndex = 0;
    const startMile = this.points.length > 0 ? this.points[0][4] : 0;
    const position = this.points.length > 0 ? this.interpolate(startMile) : { coords: null, heading: 0 };

    this._state.set({
      running: false,
      speedKph: this._state().speedKph,
      simulatedMile: startMile,
      simulatedCoords: position.coords,
      simulatedHeading: position.heading,
      simulatedSpeedKph: 0
    });
    if (this.deadReckoning) {
      if (typeof this.deadReckoning.reset === 'function') {
        this.deadReckoning.reset(startMile, position.coords, position.heading);
      } else {
        this.deadReckoning.stop();
      }
    }
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private interpolate(mile: number): { coords: [number, number]; heading: number } {
    const pts = this.points;
    if (pts.length < 2) {
      const single = pts.length === 1 ? ([pts[0][0], pts[0][1]] as [number, number]) : null;
      return { coords: single!, heading: 0 };
    }

    const is7D = pts[0].length >= 7;
    const effectiveMile = is7D ? mile : this.toTrackMile(mile);
    const getMile = (idx: number) => is7D ? pts[idx][6] : pts[idx][4];
    const last = pts.length - 1;

    if (effectiveMile <= getMile(0)) {
      return {
        coords: [pts[0][0], pts[0][1]],
        heading: calculateBearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
      };
    }
    if (effectiveMile >= getMile(last)) {
      return {
        coords: [pts[last][0], pts[last][1]],
        heading: calculateBearing(pts[last - 1][0], pts[last - 1][1], pts[last][0], pts[last][1])
      };
    }

    // Locate segment
    let i = this.lastIndex;
    if (i < 0 || i >= last || getMile(i) > effectiveMile || getMile(i + 1) < effectiveMile) {
      // Binary search fallback
      let low = 0;
      let high = last - 1;
      i = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (getMile(mid) <= effectiveMile) {
          i = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
    }
    this.lastIndex = i;

    const p1 = pts[i];
    const p2 = pts[i + 1];
    const span = getMile(i + 1) - getMile(i);
    const t = span <= 1e-9 ? 0 : Math.max(0, Math.min(1, (effectiveMile - getMile(i)) / span));

    const lat = p1[0] + t * (p2[0] - p1[0]);
    const lon = p1[1] + t * (p2[1] - p1[1]);

    // Bearing along the segment
    let heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
    if (p1[0] === p2[0] && p1[1] === p2[1] && i + 2 < pts.length) {
      heading = calculateBearing(p2[0], p2[1], pts[i + 2][0], pts[i + 2][1]);
    }

    return {
      coords: [lat, lon],
      heading
    };
  }
}
