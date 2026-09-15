import { Injectable, inject, OnDestroy } from '@angular/core';
import { Place, WaypointViewModel, ProjectionResult, Milestone } from '../models/waypoint.model';
import { Climb, MountainPass } from '../models/elevation.model';
import { EtaPhysicsService } from './eta-physics.service';
import { SettingsService } from './settings.service';
import { RouteManifestService } from './route-manifest.service';
import { RouteTrack } from '../models/route.model';
import { OsmTurnDefinition } from '../models/ride-cockpit.model';
import { OfflineStorageService } from './offline-storage.service';
import { NetworkStatusService } from './network-status.service';
import { RouteLoaderService } from './route/route-loader.service';
import { RouteProjectionService } from './route/route-projection.service';
import { WaypointQueryService } from './route/waypoint-query.service';

export type RouteTrackData = RouteTrack;

@Injectable({
  providedIn: 'root'
})
export class RouteDataService implements OnDestroy {
  private readonly loader = inject(RouteLoaderService);
  private readonly projection = inject(RouteProjectionService);
  private readonly waypointQuery = inject(WaypointQueryService);

  readonly etaPhysics = inject(EtaPhysicsService);
  readonly settings = inject(SettingsService);
  readonly manifestService = inject(RouteManifestService);
  readonly offlineStorage = inject(OfflineStorageService);
  readonly networkStatus = inject(NetworkStatusService);

  // Direct writable signals shared across domain
  readonly places = this.loader.places;
  readonly trackPoints = this.loader.trackPoints;
  readonly guidanceTrackPoints = this.loader.guidanceTrackPoints;
  readonly hasGuidanceTrack = this.loader.hasGuidanceTrack;
  readonly climbs = this.loader.climbs;
  readonly passes = this.loader.passes;
  readonly milestones = this.loader.milestones;
  readonly turns = this.loader.turns;

  readonly activeRouteId = this.loader.activeRouteId;
  readonly totalMilesSignal = this.loader.totalMilesSignal;
  readonly totalKmSignal = this.loader.totalKmSignal;
  readonly isLoading = this.loader.isLoading;
  readonly isTrackLoading = this.loader.isTrackLoading;
  readonly error = this.loader.error;

  get totalDistanceMiles(): number {
    return this.loader.totalDistanceMiles;
  }

  get totalDistanceKm(): number {
    return this.loader.totalDistanceKm;
  }

  ngOnDestroy(): void {
    this.loader.unloadRoute();
  }

  loadRoute(routeId: string): void {
    this.loader.loadRoute(routeId);
  }

  loadTurns(routeId: string): void {
    this.loader.loadTurns(routeId);
  }

  loadGuidanceTrack(routeId: string): Promise<void> {
    return this.loader.loadGuidanceTrack(routeId);
  }

  unloadRoute(): void {
    this.loader.unloadRoute();
  }

  /**
   * Orthogonally projects a coordinate (lat, lon) onto the closest segment of the active route.
   */
  projectOntoRoute(lat: number, lon: number): ProjectionResult | null {
    return this.projection.projectOntoRoute(lat, lon);
  }

  /**
   * Finds and calculates travel time/distance for waypoints ahead of current rider position.
   */
  calculateWaypointsAhead(
    currentMile: number,
    avgSpeedMph: number,
    filterCategories: Set<string> | null = null,
    limit: number = 50
  ): WaypointViewModel[] {
    return this.waypointQuery.calculateWaypointsAhead(currentMile, avgSpeedMph, filterCategories, limit);
  }
}
