import { Injectable, inject } from '@angular/core';
import { ProjectionResult } from '../../models/waypoint.model';
import { RouteLoaderService } from './route-loader.service';

@Injectable({
  providedIn: 'root'
})
export class RouteProjectionService {
  private readonly loader = inject(RouteLoaderService);

  /**
   * Orthogonally projects a coordinate (lat, lon) onto the active route track,
   * preferring the road-snapped guidance track when available, falling back to raw GPX track.
   */
  projectOntoRoute(lat: number, lon: number): ProjectionResult | null {
    const guidance = typeof this.loader.guidanceTrackPoints === 'function' ? this.loader.guidanceTrackPoints() : [];
    const points = guidance && guidance.length >= 2 ? guidance : this.loader.trackPoints();
    return this.projectOntoPoints(lat, lon, points);
  }

  /**
   * Orthogonally projects a coordinate (lat, lon) onto the closest segment of given points.
   * Calculates perpendicular distance and estimated return mile.
   * Marks isOffRoute = true if perpendicular distance exceeds 10 km.
   */
  projectOntoPoints(
    lat: number,
    lon: number,
    points: [number, number, number, number, number][]
  ): ProjectionResult | null {
    if (!points || points.length < 2) return null;

    const R = 6371.0; // Mean Earth radius in km
    const rad = Math.PI / 180;
    const cosLat = Math.cos(lat * rad);

    let bestDist = Infinity;
    let bestKm = 0;
    let bestMile = 0;
    let bestPoint = { lat: points[0][0], lon: points[0][1], ele: points[0][2] };

    // Pass 1: Quick bounding box search within +-0.25 deg lat (~28 km)
    let candidateChecked = false;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      if (Math.abs(p1[0] - lat) > 0.25 && Math.abs(p2[0] - lat) > 0.25) {
        continue;
      }
      candidateChecked = true;

      const x1 = (p1[1] - lon) * rad * R * cosLat;
      const y1 = (p1[0] - lat) * rad * R;
      const x2 = (p2[1] - lon) * rad * R * cosLat;
      const y2 = (p2[0] - lat) * rad * R;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq > 0.000000001) {
        t = Math.max(0, Math.min(1, (-x1 * dx - y1 * dy) / lenSq));
      }

      const qx = x1 + t * dx;
      const qy = y1 + t * dy;
      const d = Math.sqrt(qx * qx + qy * qy);

      if (d < bestDist) {
        bestDist = d;
        bestKm = p1[3] + t * (p2[3] - p1[3]);
        bestMile = p1[4] + t * (p2[4] - p1[4]);
        bestPoint = {
          lat: p1[0] + t * (p2[0] - p1[0]),
          lon: p1[1] + t * (p2[1] - p1[1]),
          ele: p1[2] + t * (p2[2] - p1[2])
        };
      }
    }

    // Pass 2: If no segment was in +-0.25 deg box or bestDist > 25km, search all segments
    if (!candidateChecked || bestDist > 25) {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const x1 = (p1[1] - lon) * rad * R * cosLat;
        const y1 = (p1[0] - lat) * rad * R;
        const x2 = (p2[1] - lon) * rad * R * cosLat;
        const y2 = (p2[0] - lat) * rad * R;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;

        let t = 0;
        if (lenSq > 0.000000001) {
          t = Math.max(0, Math.min(1, (-x1 * dx - y1 * dy) / lenSq));
        }

        const qx = x1 + t * dx;
        const qy = y1 + t * dy;
        const d = Math.sqrt(qx * qx + qy * qy);

        if (d < bestDist) {
          bestDist = d;
          bestKm = p1[3] + t * (p2[3] - p1[3]);
          bestMile = p1[4] + t * (p2[4] - p1[4]);
          bestPoint = {
            lat: p1[0] + t * (p2[0] - p1[0]),
            lon: p1[1] + t * (p2[1] - p1[1]),
            ele: p1[2] + t * (p2[2] - p1[2])
          };
        }
      }
    }

    const isOffRoute = bestDist > 10.0;

    return {
      distanceKm: Math.round(bestDist * 100) / 100,
      distanceMiles: Math.round(bestDist * 0.621371 * 100) / 100,
      projectedRouteKm: Math.round(bestKm * 10) / 10,
      projectedRouteMile: Math.round(bestMile * 10) / 10,
      isOffRoute,
      nearestPointOnTrail: bestPoint,
      nearestMile: Math.round(bestMile * 10) / 10
    };
  }
}
