import { Injectable, inject } from '@angular/core';
import { RouteLoaderService } from './route-loader.service';
import { SettingsService } from '../settings.service';
import { EtaPhysicsService } from '../eta-physics.service';
import { WaypointViewModel, isSelfServiceWaschsalon } from '../../models/waypoint.model';

@Injectable({
  providedIn: 'root'
})
export class WaypointQueryService {
  private readonly loader = inject(RouteLoaderService);
  private readonly settings = inject(SettingsService);
  private readonly etaPhysics = inject(EtaPhysicsService);

  calculateWaypointsAhead(
    currentMile: number,
    avgSpeedMph: number,
    filterCategories: Set<string> | null = null,
    limit: number = 50
  ): WaypointViewModel[] {
    const all = this.loader.places();
    if (!all.length) return [];

    const isPowerMode = this.settings.paceMode() === 'power';
    const effectiveSpeed = Math.max(1.0, avgSpeedMph);

    // Register reactive dependency on async background calculation completion
    if (isPowerMode) {
      this.etaPhysics.cacheVersion();
    }

    const waypoints = all
      .filter((p) => {
        // Only waypoints at or ahead of current mile
        if (p.route_mile < currentMile - 0.2) return false;
        // Category filter if applied
        if (filterCategories && filterCategories.size > 0) {
          const isLaundry = p.category === 'laundromat' || p.category === 'laundry';
          if (isLaundry && !isSelfServiceWaschsalon(p.name)) {
            return false;
          }
          const hasDirectMatch = filterCategories.has(p.category);
          const isLaundryMatch =
            (filterCategories.has('laundromat') || filterCategories.has('laundry')) && isLaundry;
          const isWaterMatch =
            p.category === 'water' &&
            (filterCategories.has('water') ||
              filterCategories.has('grocery') ||
              filterCategories.has('gas_station') ||
              filterCategories.size >= 9);
          if (!hasDirectMatch && !isLaundryMatch && !isWaterMatch) {
            return false;
          }
        }
        return true;
      })
      .slice(0, limit);

    return waypoints.map((p) => {
      const distanceAheadMiles = Math.max(0, p.route_mile - currentMile);
      const distanceAheadKm = distanceAheadMiles * 1.60934;

      let estimatedHours = 0;
      if (isPowerMode) {
        const estimatedSeconds = this.etaPhysics.calculateEtaSeconds(currentMile, p.route_mile);
        estimatedHours = estimatedSeconds / 3600;
      } else {
        estimatedHours = distanceAheadMiles / effectiveSpeed;
      }

      const hours = Math.floor(estimatedHours);
      const minutes = Math.round((estimatedHours - hours) * 60);

      let timeFormatted = '';
      if (hours === 0) {
        timeFormatted = `${minutes}m`;
      } else if (hours < 24) {
        timeFormatted = `${hours}h ${minutes.toString().padStart(2, '0')}m`;
      } else {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        timeFormatted = `${days}d ${remHours}h`;
      }

      return {
        ...p,
        distanceAheadMiles,
        distanceAheadKm,
        estimatedHours,
        estimatedTimeFormatted: timeFormatted
      };
    });
  }
}
