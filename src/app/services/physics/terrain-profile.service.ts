import { Injectable, signal, computed } from '@angular/core';
import { SurfaceInterval } from './physics.model';

export type TrackPointTuple = [number, number, number, number, number];

@Injectable({
  providedIn: 'root'
})
export class TerrainProfileService {
  // Surface intervals loaded from /data/route-surfaces.json
  readonly surfaceIntervals = signal<SurfaceInterval[]>([]);
  // Route track points loaded from /data/route-track.json: [lat, lon, ele, km, mi]
  readonly trackPoints = signal<TrackPointTuple[]>([]);

  // Dynamic route distance based on loaded track points
  readonly totalDistanceKm = computed(() => {
    const pts = this.trackPoints();
    if (pts.length > 0) {
      return Math.ceil(pts[pts.length - 1][3]);
    }
    return 0;
  });

  setSurfaceIntervals(intervals: SurfaceInterval[]): void {
    this.surfaceIntervals.set(intervals);
  }

  setTrackPoints(points: TrackPointTuple[]): void {
    this.trackPoints.set(points);
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
   * Calculate grade (rise / run) between two elevation points over a segment length in meters.
   */
  calculateGrade(startEleM: number, endEleM: number, lengthMeters: number): number {
    return lengthMeters > 0 ? (endEleM - startEleM) / lengthMeters : 0;
  }

  /**
   * Find road classification, surface, and tracktype at a specific kilometer along the route.
   */
  getSurfaceAtKm(
    km: number,
    customIntervals?: SurfaceInterval[]
  ): { roadClass: string; surface: string; tracktype: string } {
    const intervals = customIntervals ?? this.surfaceIntervals();
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
  getElevationAtKm(km: number, customPts?: TrackPointTuple[]): number {
    const pts = customPts ?? this.trackPoints();
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
    pts: TrackPointTuple[],
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
}
