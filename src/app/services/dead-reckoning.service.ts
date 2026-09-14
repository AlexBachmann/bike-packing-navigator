import { Injectable, signal, computed, OnDestroy, inject } from '@angular/core';
import { haversineMeters } from '../app';
import { calculateBearing } from '../models/weather.model';
import { RouteDataService } from './route-data.service';
import { TurnGuidanceService } from './turn-guidance.service';

export interface GpsFixRecord {
  latitude: number;
  longitude: number;
  timestamp: number;
  projectedMile?: number | null;
  heading?: number | null;
  accuracyMeters?: number | null;
}

export const MAX_EXTRAPOLATION_SECONDS = 4.0;
export const MIN_MOVING_SPEED_KPH = 1.0;
export const MIN_DISPLACEMENT_METERS = 1.0;

@Injectable({
  providedIn: 'root'
})
export class DeadReckoningService implements OnDestroy {
  private readonly routeService = inject(RouteDataService, { optional: true });
  private readonly turnGuidance = inject(TurnGuidanceService, { optional: true });

  private previousFix: GpsFixRecord | null = null;
  private currentFix: GpsFixRecord | null = null;
  private baseTimestamp = 0;
  private animFrameId: number | null = null;
  private isRunning = false;

  // Reactive Signals
  readonly isTracking = signal<boolean>(false);
  readonly speedKph = signal<number>(0);
  readonly interpolatedMile = signal<number>(0);
  readonly interpolatedCoords = signal<[number, number] | null>(null);
  readonly interpolatedHeading = signal<number>(0);

  readonly isMoving = computed(() => this.speedKph() >= MIN_MOVING_SPEED_KPH);

  ngOnDestroy(): void {
    this.stop();
  }

  /**
   * Registers a new GPS location fix from geolocation or simulator.
   * Calculates the exact speed from the last two GPS positions and starts/updates continuous dead reckoning.
   */
  updateGpsFix(fix: GpsFixRecord, fallbackSpeedKph?: number | null): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.baseTimestamp = now;

    const prev = this.currentFix;
    this.previousFix = prev;
    this.currentFix = fix;

    let calculatedSpeedKph = 0;

    if (typeof fallbackSpeedKph === 'number' && fallbackSpeedKph >= MIN_MOVING_SPEED_KPH) {
      calculatedSpeedKph = fallbackSpeedKph;
    } else if (prev) {
      const distMeters = haversineMeters(prev.latitude, prev.longitude, fix.latitude, fix.longitude);
      const deltaSec = Math.max(0.001, (fix.timestamp - prev.timestamp) / 1000);

      if (distMeters >= MIN_DISPLACEMENT_METERS && deltaSec > 0.05) {
        calculatedSpeedKph = (distMeters / deltaSec) * 3.6;
      } else {
        calculatedSpeedKph = 0;
      }
    }

    if (calculatedSpeedKph < MIN_MOVING_SPEED_KPH) {
      calculatedSpeedKph = 0;
    }

    this.speedKph.set(calculatedSpeedKph);

    // Ensure monotonic progress when moving forward:
    // If we are already smoothly moving forward and an incoming discrete fix has projectedMile
    // that is slightly behind the current 60fps interpolatedMile (due to setInterval timer jitter),
    // do NOT jerk the rider backward. Keep the progress strictly monotonic.
    const currentInterp = this.interpolatedMile();
    const isMovingForward = calculatedSpeedKph >= MIN_MOVING_SPEED_KPH;

    let initialMile = fix.projectedMile ?? currentInterp;
    if (isMovingForward && fix.projectedMile !== undefined && fix.projectedMile !== null && currentInterp > 0) {
      initialMile = Math.max(currentInterp, fix.projectedMile);
    }
    this.interpolatedMile.set(initialMile);

    // Save updated fix with reconciled projectedMile
    this.currentFix = {
      ...fix,
      projectedMile: initialMile
    };

    const pts = this.routeService?.trackPoints() || [];
    if (initialMile !== undefined && initialMile !== null && pts.length >= 2 && this.turnGuidance) {
      const coords = this.turnGuidance.interpolatePointAtMile(pts, initialMile);
      this.interpolatedCoords.set([coords[0], coords[1]]);
    } else {
      this.interpolatedCoords.set([fix.latitude, fix.longitude]);
    }

    if (typeof fix.heading === 'number' && !isNaN(fix.heading)) {
      this.interpolatedHeading.set(((fix.heading % 360) + 360) % 360);
    }

    if (!this.isRunning) {
      this.startLoop();
    }
  }

  /**
   * Starts the continuous 60fps interpolation animation frame loop.
   */
  private startLoop(): void {
    if (typeof window === 'undefined') return;
    this.isRunning = true;
    this.isTracking.set(true);

    const tick = () => {
      if (!this.isRunning) return;
      this.interpolatePosition();
      this.animFrameId = window.requestAnimationFrame(tick);
    };

    this.animFrameId = window.requestAnimationFrame(tick);
  }

  /**
   * Computes the dead-reckoned progress since the last GPS fix.
   */
  private interpolatePosition(): void {
    if (!this.currentFix) return;

    const speed = this.speedKph();
    if (speed < MIN_MOVING_SPEED_KPH) {
      // Standing still - keep exact fix coordinates
      this.interpolatedCoords.set([this.currentFix.latitude, this.currentFix.longitude]);
      if (this.currentFix.projectedMile !== undefined && this.currentFix.projectedMile !== null) {
        this.interpolatedMile.set(this.currentFix.projectedMile);
      }
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSec = Math.max(0, (now - this.baseTimestamp) / 1000);

    // If no new GPS fix arrives within MAX_EXTRAPOLATION_SECONDS, gradually decelerate
    let effectiveSpeed = speed;
    if (elapsedSec > MAX_EXTRAPOLATION_SECONDS) {
      const decayFactor = Math.max(0, 1 - (elapsedSec - MAX_EXTRAPOLATION_SECONDS) / 2.0);
      effectiveSpeed = speed * decayFactor;
      if (decayFactor <= 0) {
        return; // Halted until next GPS fix arrives
      }
    }

    const distanceTraveledMeters = (effectiveSpeed / 3.6) * elapsedSec;
    const distanceTraveledMiles = distanceTraveledMeters / 1609.344;

    const baseMile = this.currentFix.projectedMile;
    const pts = this.routeService?.trackPoints() || [];

    if (baseMile !== undefined && baseMile !== null && pts.length >= 2) {
      // Advance distance along the route track
      const targetMile = baseMile + distanceTraveledMiles;
      const totalTrackMiles = pts[pts.length - 1][4];
      const clampedMile = Math.min(totalTrackMiles, targetMile);

      this.interpolatedMile.set(clampedMile);

      if (this.turnGuidance) {
        const coords = this.turnGuidance.interpolatePointAtMile(pts, clampedMile);
        this.interpolatedCoords.set([coords[0], coords[1]]);
        const heading = this.turnGuidance.getRouteTangentBearing(pts, clampedMile, 25.0);
        this.interpolatedHeading.set(heading);
      }
    } else {
      // Off-route dead reckoning along heading vector
      const heading = this.currentFix.heading ?? this.interpolatedHeading();
      const rad = heading * (Math.PI / 180);
      const lat = this.currentFix.latitude;
      const lon = this.currentFix.longitude;
      const cosLat = Math.cos(lat * (Math.PI / 180));

      const deltaLat = (distanceTraveledMeters * Math.cos(rad)) / 111132;
      const deltaLon = (distanceTraveledMeters * Math.sin(rad)) / (111132 * cosLat);

      this.interpolatedCoords.set([lat + deltaLat, lon + deltaLon]);
    }
  }

  /**
   * Halts dead-reckoning loop and resets all tracking state.
   */
  stop(): void {
    this.isRunning = false;
    this.isTracking.set(false);
    if (this.animFrameId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.previousFix = null;
    this.currentFix = null;
    this.speedKph.set(0);
  }
}
