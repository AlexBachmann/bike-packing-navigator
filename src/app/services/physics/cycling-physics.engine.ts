import { Injectable } from '@angular/core';

export const G = 9.80665;
export const ETA = 0.96;       // 96% drivetrain efficiency
export const RHO = 1.08;       // Air density at ~2,000m alpine bikepacking elevation (kg/m^3)
export const CDA = 0.48;       // Frontal drag area for loaded bikepacking setup (m^2)
export const STEP_METERS = 50; // 50m microsegment step

@Injectable({
  providedIn: 'root'
})
export class CyclingPhysicsEngine {
  readonly G = G;
  readonly ETA = ETA;
  readonly RHO = RHO;
  readonly CDA = CDA;
  readonly STEP_METERS = STEP_METERS;

  /**
   * Maximum safe downhill speed limits based on surface roughness.
   */
  getMaxSafeDescentSpeed(grade: number, crr: number): number {
    if (crr <= 0.008) return 60.0; // Paved / asphalt
    if (crr <= 0.015) return 42.0; // Smooth gravel / hardpack
    if (crr <= 0.025) return 32.0; // Mixed gravel
    return 22.0;                   // Rough dirt / rocks / singletrack
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
}
