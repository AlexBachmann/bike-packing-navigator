import {
  ChangeDetectionStrategy,
  Component,
  AfterViewInit,
  OnDestroy,
  OnInit,
  input,
  output,
  effect,
  ElementRef,
  viewChild,
  signal,
  computed,
  inject,
  untracked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as maplibregl from 'maplibre-gl';
import { RouteDataService } from '../../services/route-data.service';
import { RouteManifestService } from '../../services/route-manifest.service';
import { SettingsService } from '../../services/settings.service';
import { PmtilesStorageService, DownloadProgress } from '../../services/pmtiles-storage.service';
import { TurnGuidanceService } from '../../services/turn-guidance.service';
import { GpsSimulatorService } from '../../services/gps-simulator.service';
import { AudioAlertService } from '../../services/audio-alert.service';
import { DeadReckoningService } from '../../services/dead-reckoning.service';
import { GpsState, Place } from '../../models/waypoint.model';
import {
  getPoiIconConfig,
  createPoiMarkerElement,
  createPoiPopupHtml
} from '../route-map/route-map-poi.helper';
import { computeProximityAlerts, ProximityAlert } from '../../services/proximity-alert.service';
import { Climb, ClimbMiniProfile, buildClimbMiniProfile } from '../../models/elevation.model';
import { TurnCue, TurnDirection } from '../../models/ride-cockpit.model';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';
import { getRasterBaselineStyle, getVectorStyleSpec } from '../route-map/route-map.component';
import { RideTurnGuidanceBannerComponent, getTurnIcon } from './ride-turn-guidance-banner.component';
import { RideOffCourseBannerComponent, OffCourseAlertStatus } from './ride-off-course-banner.component';
import { RideClimbMiniWidgetComponent, ActiveClimbStatus } from './ride-climb-mini-widget.component';
import { RideSpeedometerComponent } from './ride-speedometer.component';
import { RideSimulatorModalComponent } from './ride-simulator-modal.component';
import { RideVectorDownloadCardComponent } from './ride-vector-download-card.component';
import { calculateDeflectionAngle, normalizeBearing } from '../../utils/geo-math.utils';

export { getTurnIcon } from './ride-turn-guidance-banner.component';
export type { OffCourseAlertStatus } from './ride-off-course-banner.component';
export type { ActiveClimbStatus } from './ride-climb-mini-widget.component';
export type { ProximityAlert } from '../../services/proximity-alert.service';

export const DEFAULT_3D_PITCH = 55;
export const MIN_3D_PITCH = 50;
export const MAX_3D_PITCH = 60;
export const MAX_CAMERA_ROTATION_SPEED_DEG_PER_SEC = 45; // 360 deg turn in 8.0s (45 deg in 1.0s)
export const RIDER_VERTICAL_ANCHOR_RATIO = 0.72; // Lower third to lower quarter (72% from top)
export const LOWER_THIRD_TOP_PADDING = 264; // Baseline top padding for standard 600px viewport
export const LOWER_THIRD_BOTTOM_PADDING = 0;

/**
 * Formats speed in km/h or mph according to user distance unit setting.
 */
export function formatSpeed(speedKph: number, unit: 'miles' | 'km'): string {
  const cleanSpeed = Math.max(0, isNaN(speedKph) ? 0 : speedKph);
  if (unit === 'km') {
    return `${cleanSpeed.toFixed(0)} km/h`;
  } else {
    const mph = cleanSpeed * 0.621371;
    return `${mph.toFixed(1)} mph`;
  }
}

@Component({
  selector: 'app-ride-cockpit',
  standalone: true,
  imports: [
    CommonModule,
    RideTurnGuidanceBannerComponent,
    RideOffCourseBannerComponent,
    RideClimbMiniWidgetComponent,
    RideSpeedometerComponent,
    RideSimulatorModalComponent,
    RideVectorDownloadCardComponent
  ],
  templateUrl: './ride-cockpit.component.html',
  styleUrl: './ride-cockpit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full h-full relative'
  }
})
export class RideCockpitComponent implements OnInit, AfterViewInit, OnDestroy {
  // Services
  readonly routeService = inject(RouteDataService);
  readonly routeManifest = inject(RouteManifestService, { optional: true });
  readonly settings = inject(SettingsService);
  readonly pmtilesStorage = inject(PmtilesStorageService);
  readonly turnGuidance = inject(TurnGuidanceService);
  readonly gpsSimulator = inject(GpsSimulatorService);
  readonly audioAlert = inject(AudioAlertService);
  readonly deadReckoning = inject(DeadReckoningService);

  // Service aliases
  readonly routeDataService = this.routeService;
  readonly turnGuidanceService = this.turnGuidance;
  readonly gpsSimulatorService = this.gpsSimulator;
  readonly audioAlertService = this.audioAlert;
  readonly deadReckoningService = this.deadReckoning;

  // Inputs
  readonly currentMile = input<number>(0);
  readonly unit = input<'miles' | 'km'>('miles');
  readonly gpsState = input<GpsState | null>(null);

  // Outputs
  readonly selectMile = output<number>();
  readonly enableGps = output<void>();

  // Template container reference
  readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  // Internal Camera & Render State
  readonly cameraPitch = signal<number>(DEFAULT_3D_PITCH);
  readonly autoFollow = signal<boolean>(true);
  readonly isVectorCached = signal<boolean>(false);
  readonly isCheckingCache = signal<boolean>(false);
  readonly isDownloadingVector = signal<boolean>(false);
  readonly downloadProgressPercent = signal<number>(0);
  readonly downloadError = signal<string | null>(null);

  // Simulator UI State
  readonly isSimulatorOpen = signal<boolean>(false);
  readonly simSpeedInput = signal<number>(15);

  private lastKnownHeading = 0;
  private currentCameraBearing: number | null = null;
  private lastCameraTimestamp = 0;
  private map: maplibregl.Map | null = null;
  private riderMarker: maplibregl.Marker | null = null;
  private riderArrowEl: HTMLElement | null = null;
  private poiMarkers: maplibregl.Marker[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private isDestroyed = false;

  getPoiMarkers(): readonly maplibregl.Marker[] {
    return this.poiMarkers;
  }

  // Active route signals
  readonly activeRouteId = computed<string | null>(() => {
    const fromService = typeof this.routeService?.activeRouteId === 'function'
      ? this.routeService.activeRouteId()
      : (this.routeService as any)?.activeRouteId || null;
    return fromService || this.settings.selectedRouteKey() || null;
  });

  readonly routeTitle = computed<string>(() => {
    const manifest = this.routeManifest?.activeRouteSummary?.();
    return manifest?.name || this.activeRouteId() || 'Active Route';
  });

  readonly estimatedSize = computed<string>(() => {
    const id = this.activeRouteId();
    return id && typeof this.pmtilesStorage.getEstimatedSize === 'function'
      ? this.pmtilesStorage.getEstimatedSize(id)
      : '~25 MB';
  });
  readonly estimatedDownloadSize = this.estimatedSize;

  readonly isDownloading = computed<boolean>(() => {
    const id = this.activeRouteId();
    const activeDownloads = typeof this.pmtilesStorage.activeDownloads === 'function'
      ? this.pmtilesStorage.activeDownloads()
      : (this.pmtilesStorage as any)?.activeDownloads || {};
    const active = id ? activeDownloads[id]?.status === 'downloading' : false;
    return active || this.isDownloadingVector();
  });

  readonly downloadPercentage = computed<number>(() => {
    const id = this.activeRouteId();
    const activeDownloads = typeof this.pmtilesStorage.activeDownloads === 'function'
      ? this.pmtilesStorage.activeDownloads()
      : (this.pmtilesStorage as any)?.activeDownloads || {};
    const dp = id ? activeDownloads[id] : undefined;
    return dp?.percentage ?? this.downloadProgressPercent();
  });
  readonly downloadPercent = this.downloadPercentage;

  readonly isGpsOff = computed<boolean>(() => {
    return !this.gpsState()?.enabled && !this.gpsSimulator.running();
  });
  readonly isGpsActive = computed<boolean>(() => !this.isGpsOff());

  // Effective Mile
  readonly effectiveMile = computed<number>(() => {
    if (this.deadReckoning.isTracking() && this.deadReckoning.isMoving()) {
      return this.deadReckoning.interpolatedMile();
    }
    if (this.gpsSimulator.running()) {
      return this.gpsSimulator.simulatedMile();
    }
    const gps = this.gpsState();
    if (gps && gps.enabled && gps.projection?.projectedRouteMile !== undefined) {
      return gps.projection.projectedRouteMile;
    }
    return this.currentMile();
  });

  // Effective Coords [lat, lon]
  readonly effectiveCoords = computed<[number, number] | null>(() => {
    if (this.deadReckoning.isTracking() && this.deadReckoning.isMoving()) {
      const coords = this.deadReckoning.interpolatedCoords();
      if (coords) return coords;
    }
    if (this.gpsSimulator.running()) {
      const coords = this.gpsSimulator.simulatedCoords();
      if (coords) return [coords[0], coords[1]];
    }
    const gps = this.gpsState();
    if (gps && gps.enabled && gps.latitude !== null && gps.longitude !== null) {
      return [gps.latitude, gps.longitude];
    }
    const guidance = typeof this.routeService.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
    const pts = guidance && guidance.length > 0 ? guidance : this.routeService.trackPoints();
    if (pts && pts.length > 0) {
      return this.interpolatePointAtMile(pts, this.effectiveMile());
    }
    return null;
  });

  // Effective Heading [0, 360)
  readonly effectiveHeading = computed<number>(() => {
    // 1. Dead reckoning interpolated heading when moving
    if (this.deadReckoning.isTracking() && this.deadReckoning.isMoving()) {
      return this.deadReckoning.interpolatedHeading();
    }

    // 2. Simulation static heading fallback when not moving
    if (this.gpsSimulator.running()) {
      return this.gpsSimulator.simulatedHeading();
    }

    // 3. Real GPS updates
    const gps = this.gpsState();
    if (gps && gps.enabled) {
      if (typeof gps.heading === 'number' && !isNaN(gps.heading)) {
        return ((gps.heading % 360) + 360) % 360;
      }
    }

    // 4. Fallback: If no two GPS positions exist (or GPS off), point into the direction of the route
    return this.getForwardTrackBearing(this.effectiveMile());
  });

  // Effective Speed (km/h)
  readonly currentSpeedKph = computed<number>(() => {
    if (this.gpsSimulator.running()) {
      return this.gpsSimulator.simulatedSpeedKph();
    }
    if (this.deadReckoning.isTracking()) {
      return this.deadReckoning.speedKph();
    }
    const gps = this.gpsState();
    if (gps && gps.enabled && typeof (gps as any).speedKph === 'number') {
      return (gps as any).speedKph;
    }
    return 0;
  });

  readonly displaySpeedValue = computed<string>(() => {
    const cleanSpeed = Math.max(0, isNaN(this.currentSpeedKph()) ? 0 : this.currentSpeedKph());
    return this.unit() === 'km'
      ? cleanSpeed.toFixed(0)
      : (cleanSpeed * 0.621371).toFixed(1);
  });
  readonly speedValue = this.displaySpeedValue;

  readonly displaySpeedUnit = computed<string>(() => {
    return this.unit() === 'km' ? 'km/h' : 'mph';
  });
  readonly speedUnit = this.displaySpeedUnit;

  readonly displaySpeedText = computed<string>(() => {
    return formatSpeed(this.currentSpeedKph(), this.unit());
  });

  // Effective Position bundle
  readonly effectivePosition = computed(() => {
    const coords = this.effectiveCoords();
    const lat = coords ? coords[0] : 0;
    const lon = coords ? coords[1] : 0;
    const heading = this.effectiveHeading();
    const speedKph = this.currentSpeedKph();
    const mile = this.effectiveMile();
    return { lat, lon, heading, speedKph, mile };
  });

  // Turn-Ahead Guidance: Based on authentic OSM Decision Points
  readonly turnCue = computed<TurnCue | null>(() => {
    const mile = this.effectiveMile();
    const rawPts = this.routeService.trackPoints();
    const guidance = typeof this.routeService?.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
    const pts = guidance && guidance.length >= 3 ? guidance : rawPts;
    const turns = this.routeService.turns();
    const u = this.unit();
    if (!pts || pts.length < 3) return null;
    return this.turnGuidance.computeTurnAhead(mile, pts, u, turns);
  });

  // Active Climb Status
  readonly activeClimb = computed<Climb | null>(() => {
    const mile = this.effectiveMile();
    const climbs = this.routeService.climbs();
    if (!climbs || climbs.length === 0) return null;
    return climbs.find((c) => mile >= c.startMile && mile <= c.endMile) || null;
  });

  readonly climbStatus = computed<ActiveClimbStatus | null>(() => {
    const climb = this.activeClimb();
    if (!climb) return null;
    const mile = this.effectiveMile();
    const u = this.unit();
    const pts = this.routeService.trackPoints() || [];

    const remainingMiles = Math.max(0, climb.endMile - mile);
    const remainingKm = remainingMiles * 1.609344;
    const progressPercent = Math.min(
      100,
      Math.max(0, ((mile - climb.startMile) / (climb.endMile - climb.startMile || 1)) * 100)
    );

    const remainingFormatted = u === 'km'
      ? (remainingKm < 1 ? `${Math.round(remainingKm * 1000)} m` : `${remainingKm.toFixed(1)} km`)
      : (remainingMiles < 0.1 ? `${Math.round(remainingMiles * 5280)} ft` : `${remainingMiles.toFixed(1)} mi`);

    const miniProfile = buildClimbMiniProfile(climb, pts, mile, true);
    const svgPaths = this.generateClimbSvgPath(climb, progressPercent);

    return {
      climbId: climb.id,
      name: climb.name,
      remainingMiles,
      remainingKm,
      remainingFormatted,
      gradePercent: climb.avgGradePercent,
      progressPercent,
      miniProfile,
      svgPaths
    };
  });

  // Off-Course Alert Status
  readonly offCourseStatus = computed<OffCourseAlertStatus>(() => {
    const coords = this.effectiveCoords();
    if (!coords) {
      return { isOffCourse: false, distanceMeters: 0, displayText: '', returnBearingDeg: 0 };
    }
    const [lat, lon] = coords;
    if (lat === 0 && lon === 0) {
      return { isOffCourse: false, distanceMeters: 0, displayText: '', returnBearingDeg: 0 };
    }
    const projection = this.routeService.projectOntoRoute(lat, lon);
    if (!projection) {
      return { isOffCourse: false, distanceMeters: 0, displayText: '', returnBearingDeg: 0 };
    }

    const deviationMeters = projection.distanceKm * 1000;
    const isAlerted = typeof this.audioAlert?.isAlerted === 'function'
      ? this.audioAlert.isAlerted()
      : (typeof this.audioAlert?.hasAlerted === 'function' ? this.audioAlert.hasAlerted() : false);
    const isOffCourse =
      deviationMeters > AudioAlertService.OFF_COURSE_THRESHOLD_METERS ||
      (isAlerted && deviationMeters > AudioAlertService.HYSTERESIS_RESET_THRESHOLD_METERS);
    const u = this.unit();

    const nearest = projection.nearestPointOnTrail;
    const returnBearing = nearest
      ? this.turnGuidance.calculateBearing(lat, lon, nearest.lat, nearest.lon)
      : 0;

    let displayText = '';
    if (isOffCourse) {
      if (u === 'km') {
        displayText = deviationMeters >= 1000
          ? `⚠️ Off Route: ${(deviationMeters / 1000).toFixed(1)} km`
          : `⚠️ Off Route: ${Math.round(deviationMeters)} m`;
      } else {
        const yards = Math.round(deviationMeters * 1.09361);
        displayText = yards >= 1760
          ? `⚠️ Off Route: ${(yards / 1760).toFixed(1)} mi`
          : `⚠️ Off Route: ${yards} yd`;
      }
    }

    return {
      isOffCourse,
      distanceMeters: deviationMeters,
      displayText,
      returnBearingDeg: returnBearing
    };
  }, {
    equal: (a, b) =>
      a.isOffCourse === b.isOffCourse &&
      Math.abs(a.distanceMeters - b.distanceMeters) < 0.1 &&
      a.displayText === b.displayText &&
      Math.abs(a.returnBearingDeg - b.returnBearingDeg) < 0.1
  });

  readonly relativeReturnAngle = computed<number>(() => {
    const returnDeg = this.offCourseStatus().returnBearingDeg;
    const heading = this.effectiveHeading();
    return ((returnDeg - heading + 540) % 360) - 180;
  });

  // Proximity Heads-Up Alerts (R3)
  readonly proximityAlerts = computed<ProximityAlert[]>(() => {
    return computeProximityAlerts(
      this.effectiveMile(),
      this.routeService.places(),
      this.unit()
    );
  });

  constructor() {
    // Synchronous initial cache check if route active
    const initialRoute = this.activeRouteId();
    if (initialRoute && typeof this.pmtilesStorage?.isRouteCachedSync === 'function') {
      this.isVectorCached.set(this.pmtilesStorage.isRouteCachedSync(initialRoute));
    }

    // Effect 1: Reactive camera tracking & rider marker updates
    effect(() => {
      const pos = this.effectivePosition();
      if (!this.map || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return;
      if (pos.lat === 0 && pos.lon === 0) return;

      untracked(() => {
        this.updateRiderMarkerAndCamera();
      });
    });

    // Effect 2: Reactive route line redraw when trackpoints or guidance change
    effect(() => {
      const points = this.routeService.trackPoints();
      const guidance = typeof this.routeService?.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
      const effectivePoints = guidance && guidance.length >= 2 ? guidance : points;
      if (effectivePoints && effectivePoints.length >= 2) {
        untracked(() => {
          if (!this.gpsSimulator.running() && typeof this.gpsSimulator.setTrackPoints === 'function') {
            this.gpsSimulator.setTrackPoints(effectivePoints);
          }
        });
      }
      if (!this.map) return;
      if ((guidance && guidance.length >= 2) || (points && points.length >= 2)) {
        untracked(() => {
          this.drawRoute();
        });
      } else {
        untracked(() => {
          this.clearRouteLayers();
        });
      }
    });

    // Effect 3: Acoustic off-course tone monitor
    effect(() => {
      const status = this.offCourseStatus();
      if (status.distanceMeters > 0) {
        untracked(() => {
          this.audioAlert.processDistance(status.distanceMeters);
        });
      }
    });

    // Effect 4: Simulator milestone emitter to synchronize parent
    effect(() => {
      if (this.gpsSimulator.running()) {
        const simMile = this.gpsSimulator.simulatedMile();
        untracked(() => {
          this.selectMile.emit(simMile);
        });
      }
    });

    // Effect 4b: Sync external currentMile changes to gpsSimulator
    effect(() => {
      const mile = this.currentMile();
      untracked(() => {
        if (typeof this.gpsSimulator.seek !== 'function') return;
        if (this.gpsSimulator.running()) {
          // If simulator is running, only seek if external jump occurred (> 0.05 mile delta)
          // to prevent echoing the simulator's continuous playback.
          if (Math.abs(mile - this.gpsSimulator.simulatedMile()) > 0.05) {
            this.gpsSimulator.seek(mile);
          }
        } else {
          // When stopped, always keep simulator in sync with currentMile
          if (Math.abs(mile - this.gpsSimulator.simulatedMile()) > 1e-4) {
            this.gpsSimulator.seek(mile);
          }
        }
      });
    });

    // Effect 5: Check vector cache and load turns when route changes
    effect(() => {
      const routeId = this.activeRouteId();
      if (routeId) {
        untracked(() => {
          if (this.gpsSimulator.running()) {
            this.gpsSimulator.stop();
          }
          this.checkVectorCache(routeId);
          if (typeof this.routeService?.loadTurns === 'function') {
            this.routeService.loadTurns(routeId);
          }
        });
      }
    });

    // Effect 6: Reactive map style updates in Ride mode
    effect(() => {
      const styleType = this.settings.mapStyle();
      const routeId = this.activeRouteId();
      if (!this.map || !routeId) return;

      untracked(async () => {
        try {
          const isCached = this.isVectorCached();
          const newStyle = isCached
            ? await getVectorStyleSpec(styleType, routeId, this.pmtilesStorage, true)
            : getRasterBaselineStyle(styleType);
          if (this.map && !this.isDestroyed) {
            if (this.riderMarker) {
              this.riderMarker.remove();
              this.riderMarker = null;
            }
            this.map.setStyle(newStyle);
            this.map.once('styledata', () => {
              this.drawRoute();
              const currentPos = this.effectivePosition();
              this.updateRiderMarker(currentPos.lat, currentPos.lon, currentPos.heading);
              this.updatePoiMarkers(this.routeService.places());
            });
          }
        } catch {
          // ignore
        }
      });
    });

    // Effect 7: Reactive route waypoint markers on 3D canvas (R2)
    effect(() => {
      const places = this.routeService.places();
      if (!this.map) return;
      untracked(() => {
        this.updatePoiMarkers(places);
      });
    });
  }

  ngOnInit(): void {
    const routeId = this.activeRouteId();
    if (routeId) {
      this.checkVectorCache(routeId);
      if (typeof this.routeService?.loadTurns === 'function') {
        this.routeService.loadTurns(routeId);
      }
    }
  }

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    if (this.isVectorCached()) {
      this.init3DMap(container);
    }
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.riderMarker) {
      this.riderMarker.remove();
      this.riderMarker = null;
      this.riderArrowEl = null;
    }
    if (this.map) {
      this.clearRouteLayers();
      this.map.remove();
      this.map = null;
    }
    this.clearPoiMarkers();
    if (typeof window !== 'undefined') {
      window.removeEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.removeEventListener('td-jump-mile', this.handlePopupJump as EventListener);
    }
    this.currentCameraBearing = null;
    this.lastCameraTimestamp = 0;
  }

  // --------------------------------------------------------------------------
  // Vector Map Gating & Download Action
  // --------------------------------------------------------------------------

  async checkVectorCache(routeId?: string): Promise<void> {
    const id = routeId || this.activeRouteId();
    if (!id) {
      if (this.isDestroyed) return;
      this.isVectorCached.set(false);
      this.isCheckingCache.set(false);
      return;
    }

    if (typeof this.pmtilesStorage.isRouteCachedSync === 'function' && this.pmtilesStorage.isRouteCachedSync(id)) {
      if (this.isDestroyed) return;
      this.isVectorCached.set(true);
      this.isCheckingCache.set(false);
      const container = this.mapContainer()?.nativeElement;
      if (!this.map && container) {
        this.init3DMap(container);
      }
      return;
    }

    this.isCheckingCache.set(true);
    try {
      const cached = await this.pmtilesStorage.isRouteCached(id);
      if (this.isDestroyed) return;
      this.isVectorCached.set(cached);
      const container = this.mapContainer()?.nativeElement;
      if (cached && !this.map && container) {
        this.init3DMap(container);
      }
    } catch {
      if (this.isDestroyed) return;
      this.isVectorCached.set(false);
    } finally {
      if (!this.isDestroyed) {
        this.isCheckingCache.set(false);
      }
    }
  }

  async downloadVectorMap(): Promise<void> {
    const routeId = this.activeRouteId();
    if (!routeId || this.isDestroyed) return;

    this.isDownloadingVector.set(true);
    this.downloadError.set(null);
    this.downloadProgressPercent.set(0);

    try {
      if (typeof this.pmtilesStorage.downloadRoute === 'function') {
        await this.pmtilesStorage.downloadRoute(routeId, undefined, (progress: DownloadProgress) => {
          if (this.isDestroyed) return;
          this.downloadProgressPercent.set(progress.percentage);
        });
      } else if (typeof (this.pmtilesStorage as any).downloadRoutePmtiles === 'function') {
        await (this.pmtilesStorage as any).downloadRoutePmtiles(routeId, (progress: any) => {
          if (this.isDestroyed) return;
          this.downloadProgressPercent.set(Math.round(progress.percent || progress.percentage || 0));
        });
      }
      if (this.isDestroyed) return;
      this.isVectorCached.set(true);
      this.isDownloadingVector.set(false);
      const container = this.mapContainer()?.nativeElement;
      if (!this.map && container) {
        this.init3DMap(container);
      } else if (this.map && routeId) {
        const vectorStyle = await getVectorStyleSpec(this.settings.mapStyle(), routeId, this.pmtilesStorage, true);
        if (this.map && !this.isDestroyed) {
          if (this.riderMarker) {
            this.riderMarker.remove();
            this.riderMarker = null;
          }
          this.map.setStyle(vectorStyle);
          this.map.once('styledata', () => {
            this.drawRoute();
            const currentPos = this.effectivePosition();
            this.updateRiderMarker(currentPos.lat, currentPos.lon, currentPos.heading);
            this.updatePoiMarkers(this.routeService.places());
          });
        }
      }
    } catch (err) {
      if (this.isDestroyed) return;
      const msg = err instanceof Error ? err.message : 'Download failed. Please verify your connection.';
      this.downloadError.set(msg);
      this.isDownloadingVector.set(false);
    }
  }

  // --------------------------------------------------------------------------
  // Map Initialization & Lifecycle
  // --------------------------------------------------------------------------

  private async init3DMap(container: HTMLElement): Promise<void> {
    if (this.isDestroyed || !container || !container.isConnected) return;
    if (typeof maplibregl !== 'undefined' && typeof maplibregl.setWorkerUrl === 'function') {
      maplibregl.setWorkerUrl(resolveBaseHref('/maplibre-gl-worker.mjs'));
    }

    const pos = this.effectivePosition();
    let initialCenter: [number, number] = [-105.0945, 39.4912];
    if (Number.isFinite(pos.lat) && Number.isFinite(pos.lon) && (pos.lat !== 0 || pos.lon !== 0)) {
      initialCenter = [pos.lon, pos.lat];
    } else {
      const pts = this.routeService.trackPoints();
      if (pts && pts.length > 0) {
        initialCenter = [pts[0][1], pts[0][0]];
      }
    }

    const initialHeading = Number.isFinite(pos.heading) ? ((pos.heading % 360) + 360) % 360 : 0;
    this.lastKnownHeading = initialHeading;

    const routeId = this.activeRouteId();
    let style: maplibregl.StyleSpecification = getRasterBaselineStyle(this.settings.mapStyle());
    if (routeId) {
      try {
        style = await getVectorStyleSpec(this.settings.mapStyle(), routeId, this.pmtilesStorage, true);
      } catch {
        style = getRasterBaselineStyle(this.settings.mapStyle());
      }
    }
    if (this.isDestroyed || !container.isConnected) return;

    const map = new maplibregl.Map({
      container,
      style,
      center: initialCenter,
      zoom: 16,
      pitch: DEFAULT_3D_PITCH,
      bearing: initialHeading,
      attributionControl: false
    });
    this.map = map;

    map.setPadding(this.getCameraPadding());

    map.on('dragstart', () => {
      this.autoFollow.set(false);
    });

    const onStyleReady = () => {
      this.drawRoute();
      const currentPos = this.effectivePosition();
      this.updateRiderMarker(currentPos.lat, currentPos.lon, currentPos.heading);
      this.updatePoiMarkers(this.routeService.places());
      this.easeCameraToPosition(currentPos.lat, currentPos.lon, currentPos.heading, currentPos.speedKph, true);
    };

    if (map.isStyleLoaded()) {
      onStyleReady();
    } else {
      map.once('load', onStyleReady);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.map) {
          this.map.resize();
          this.map.setPadding(this.getCameraPadding());
        }
      });
      this.resizeObserver.observe(container);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
    }

    setTimeout(() => {
      this.map?.resize();
      this.map?.setPadding(this.getCameraPadding());
    }, 150);
  }

  private handleWindowResize = (): void => {
    if (this.map) {
      this.map.resize();
      this.map.setPadding(this.getCameraPadding());
    }
  };

  /**
   * Calculates camera viewport padding to place rider in the lower quarter / lower third
   * (~72% down from the top), maximizing forward route visibility into the 3D horizon.
   */
  getCameraPadding(): { top: number; bottom: number; left: number; right: number } {
    const containerHeight =
      this.mapContainer()?.nativeElement?.clientHeight ||
      (typeof this.map?.getContainer === 'function' ? this.map.getContainer()?.clientHeight : 0) ||
      0;
    const topPadding = containerHeight > 0
      ? Math.round(containerHeight * (2 * RIDER_VERTICAL_ANCHOR_RATIO - 1))
      : LOWER_THIRD_TOP_PADDING;
    return { top: Math.max(0, topPadding), bottom: 0, left: 0, right: 0 };
  }

  recenterCamera(): void {
    this.autoFollow.set(true);
    const pos = this.effectivePosition();
    this.easeCameraToPosition(pos.lat, pos.lon, pos.heading, pos.speedKph);
  }

  setPitch(pitch: number): void {
    const clamped = Math.max(MIN_3D_PITCH, Math.min(MAX_3D_PITCH, pitch));
    this.cameraPitch.set(clamped);
    this.map?.setPitch(clamped);
  }

  // --------------------------------------------------------------------------
  // Camera Tracking & Road Snapping
  // --------------------------------------------------------------------------

  private updateRiderMarkerAndCamera(): void {
    const pos = this.effectivePosition();
    if (!this.map || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return;
    if (pos.lat === 0 && pos.lon === 0) return;

    let finalCoords: [number, number] = [pos.lat, pos.lon];

    // Only query rendered features for road snapping when NOT smoothly interpolating along route track.
    // At 60fps, queryRenderedFeatures() snaps to screen-space quantized tile vertices, causing 1-2px jitter.
    const isSmoothTracking = (this.deadReckoning.isTracking() && this.deadReckoning.isMoving()) || this.gpsSimulator.running();
    if (!isSmoothTracking && this.map.isStyleLoaded()) {
      try {
        const transLayers = this.map.getStyle().layers
          ?.filter((l: any) => l['source-layer'] === 'transportation')
          .map((l: any) => l.id) || [];
        const availableLayers = [...transLayers, 'route-main', 'route-glow'].filter(
          (l) => this.map!.getLayer(l)
        );
        const features = availableLayers.length > 0
          ? this.map.queryRenderedFeatures({ layers: availableLayers })
          : this.map.queryRenderedFeatures();
        if (features && features.length > 0) {
          finalCoords = this.turnGuidance.snapToTrail([pos.lat, pos.lon], pos.heading, features);
        }
      } catch {
        finalCoords = [pos.lat, pos.lon];
      }
    }

    const [lat, lon] = finalCoords;
    if (this.autoFollow()) {
      this.easeCameraToPosition(lat, lon, pos.heading, pos.speedKph);
    }
    this.updateRiderMarker(lat, lon, pos.heading);
  }

  private easeCameraToPosition(
    lat: number,
    lon: number,
    heading: number,
    speedKph: number,
    instant = false
  ): void {
    if (!this.map) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat === 0 && lon === 0) return;

    let targetBearing = heading;
    if ((!Number.isFinite(targetBearing) || (targetBearing === 0 && speedKph === 0)) && this.lastKnownHeading !== 0) {
      targetBearing = this.lastKnownHeading;
    } else if (Number.isFinite(targetBearing)) {
      targetBearing = normalizeBearing(targetBearing);
      this.lastKnownHeading = targetBearing;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.currentCameraBearing === null || instant || this.lastCameraTimestamp === 0) {
      this.currentCameraBearing = targetBearing;
      this.lastCameraTimestamp = now;
    }

    const clampedPitch = Math.max(MIN_3D_PITCH, Math.min(MAX_3D_PITCH, this.cameraPitch()));
    const cameraPadding = this.getCameraPadding();
    const deflection = calculateDeflectionAngle(this.currentCameraBearing, targetBearing);

    if (speedKph > 0) {
      if (instant) {
        this.currentCameraBearing = targetBearing;
      } else {
        const deltaSec = Math.max(0.001, Math.min(1.0, (now - this.lastCameraTimestamp) / 1000));
        const maxTurn = MAX_CAMERA_ROTATION_SPEED_DEG_PER_SEC * deltaSec;
        if (Math.abs(deflection) <= maxTurn) {
          this.currentCameraBearing = targetBearing;
        } else {
          this.currentCameraBearing = normalizeBearing(
            this.currentCameraBearing + Math.sign(deflection) * maxTurn
          );
        }
      }
      this.lastCameraTimestamp = now;

      this.map.jumpTo({
        center: [lon, lat],
        bearing: this.currentCameraBearing,
        pitch: clampedPitch,
        padding: cameraPadding
      });
    } else {
      this.lastCameraTimestamp = now;
      if (instant) {
        this.currentCameraBearing = targetBearing;
        this.map.jumpTo({
          center: [lon, lat],
          bearing: targetBearing,
          pitch: clampedPitch,
          padding: cameraPadding
        });
      } else {
        const maxDurationMs = (360 / MAX_CAMERA_ROTATION_SPEED_DEG_PER_SEC) * 1000;
        const durationMs = Math.max(
          50,
          Math.min(maxDurationMs, (Math.abs(deflection) / MAX_CAMERA_ROTATION_SPEED_DEG_PER_SEC) * 1000)
        );
        this.currentCameraBearing = targetBearing;
        this.map.easeTo({
          center: [lon, lat],
          bearing: targetBearing,
          pitch: clampedPitch,
          padding: cameraPadding,
          duration: durationMs,
          easing: (t) => t
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Route Layers
  // --------------------------------------------------------------------------

  private drawRoute(): void {
    if (!this.map) return;
    if (!this.map.isStyleLoaded()) {
      this.map.once('load', () => this.drawRoute());
      return;
    }

    const rawPoints = this.routeService.trackPoints();
    const guidance = typeof this.routeService?.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
    const guidancePoints = guidance && guidance.length >= 2 ? guidance : rawPoints;

    if (!rawPoints || rawPoints.length < 2) {
      this.clearRouteLayers();
      return;
    }

    const hasGuidance = typeof this.routeService?.hasGuidanceTrack === 'function' ? this.routeService.hasGuidanceTrack() : false;

    // 1. Raw GPX track: subtle green line (#10b981, width ~2.5px, opacity ~0.6)
    const rawCoordinates: [number, number][] = rawPoints.map((p) => [p[1], p[0]]);
    const rawGeojson = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: rawCoordinates
      }
    };

    // 2. Road-snapped guidance track: prominent blue line (#38bdf8 / #0284c7, glow ~8px, main ~4.5px)
    const guidanceCoordinates: [number, number][] = guidancePoints.map((p) => [p[1], p[0]]);
    const guidanceGeojson = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: guidanceCoordinates
      }
    };

    try {
      // Add or update raw GPX track layer
      const existingRawSource = this.map.getSource('raw-route-source') as maplibregl.GeoJSONSource;
      if (!existingRawSource) {
        this.map.addSource('raw-route-source', {
          type: 'geojson',
          data: rawGeojson
        });
      } else {
        existingRawSource.setData(rawGeojson);
      }

      if (!this.map.getLayer('raw-route-line')) {
        const beforeLayerId = this.map.getLayer('route-glow') ? 'route-glow' : (this.map.getLayer('route-main') ? 'route-main' : undefined);
        this.map.addLayer({
          id: 'raw-route-line',
          type: 'line',
          source: 'raw-route-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
            'visibility': hasGuidance ? 'visible' : 'none'
          },
          paint: {
            'line-color': '#10b981',
            'line-width': 2.5,
            'line-opacity': 0.6
          }
        }, beforeLayerId);
      } else {
        this.map.setLayoutProperty('raw-route-line', 'visibility', hasGuidance ? 'visible' : 'none');
      }

      // Add or update road-snapped guidance track layers
      const existingSource = this.map.getSource('route-source') as maplibregl.GeoJSONSource;
      if (existingSource) {
        existingSource.setData(guidanceGeojson);
      } else {
        this.map.addSource('route-source', {
          type: 'geojson',
          data: guidanceGeojson
        });
      }

      const glowColor = hasGuidance ? '#0284c7' : '#10b981';
      const mainColor = hasGuidance ? '#38bdf8' : '#34d399';
      const glowWidth = 8;
      const mainWidth = hasGuidance ? 4.5 : 4;

      if (!this.map.getLayer('route-glow')) {
        const beforeLayerId = this.map.getLayer('route-main') ? 'route-main' : undefined;
        this.map.addLayer({
          id: 'route-glow',
          type: 'line',
          source: 'route-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': glowColor,
            'line-width': glowWidth,
            'line-opacity': 0.45,
            'line-blur': 3
          }
        }, beforeLayerId);
      } else {
        this.map.setPaintProperty('route-glow', 'line-color', glowColor);
      }

      if (!this.map.getLayer('route-main')) {
        this.map.addLayer({
          id: 'route-main',
          type: 'line',
          source: 'route-source',
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': mainColor,
            'line-width': mainWidth,
            'line-opacity': 0.95
          }
        });
      } else {
        this.map.setPaintProperty('route-main', 'line-color', mainColor);
        this.map.setPaintProperty('route-main', 'line-width', mainWidth);
      }

      // Explicitly enforce stacking order
      if (typeof this.map.moveLayer === 'function') {
        if (this.map.getLayer('raw-route-line') && this.map.getLayer('route-glow')) {
          this.map.moveLayer('raw-route-line', 'route-glow');
        }
        if (this.map.getLayer('route-glow') && this.map.getLayer('route-main')) {
          this.map.moveLayer('route-glow', 'route-main');
        }
      }
    } catch {
      this.map.once('styledata', () => this.drawRoute());
    }
  }

  private clearRouteLayers(): void {
    if (!this.map) return;
    try {
      if (this.map.getLayer('raw-route-line')) this.map.removeLayer('raw-route-line');
      if (this.map.getSource('raw-route-source')) this.map.removeSource('raw-route-source');
      if (this.map.getLayer('route-glow')) this.map.removeLayer('route-glow');
      if (this.map.getLayer('route-main')) this.map.removeLayer('route-main');
      if (this.map.getSource('route-source')) this.map.removeSource('route-source');
    } catch {
      // Ignore
    }
  }

  // --------------------------------------------------------------------------
  // Rider Marker
  // --------------------------------------------------------------------------

  private updateRiderMarker(lat: number, lon: number, heading: number): void {
    if (!this.map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat === 0 && lon === 0) return;

    const normalizedHeading = ((heading % 360) + 360) % 360;
    const lngLat: [number, number] = [lon, lat];

    if (!this.riderMarker) {
      const el = document.createElement('div');
      el.className = 'rider-3d-marker';
      el.innerHTML = `
        <div class="relative flex items-center justify-center w-10 h-10 select-none">
          <div class="absolute w-9 h-9 rounded-full bg-emerald-400/40 animate-ping"></div>
          <div class="relative w-8 h-8 rounded-full bg-slate-950 border-2 border-emerald-400 shadow-xl flex items-center justify-center shadow-emerald-950">
            <div class="rider-arrow flex items-center justify-center">
              <svg class="w-4 h-4 text-emerald-400 drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
              </svg>
            </div>
          </div>
        </div>
      `;

      this.riderMarker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
        subpixelPositioning: true
      })
        .setLngLat(lngLat)
        .setRotation(normalizedHeading)
        .addTo(this.map);
    } else {
      this.riderMarker.setLngLat(lngLat);
      this.riderMarker.setRotation(normalizedHeading);
    }
  }

  // --------------------------------------------------------------------------
  // Waypoint / POI Markers (R2)
  // --------------------------------------------------------------------------

  private updatePoiMarkers(places: Place[]): void {
    if (!this.map) return;

    this.clearPoiMarkers();
    if (!places || places.length === 0) return;

    for (const place of places) {
      const lat = place.location?.lat;
      const lon = place.location?.lon;
      if (lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon)) continue;

      const iconConfig = getPoiIconConfig(place);
      const el = createPoiMarkerElement(iconConfig);

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        pitchAlignment: 'viewport',
        rotationAlignment: 'viewport',
        subpixelPositioning: true
      }).setLngLat([lon, lat]);

      if (typeof maplibregl.Popup === 'function' && typeof (marker as any).setPopup === 'function') {
        const popupHtml = createPoiPopupHtml(place, iconConfig, this.unit());
        const popup = new maplibregl.Popup({
          className: 'dark-maplibre-popup',
          offset: 15,
          closeButton: true,
          closeOnClick: false
        }).setHTML(popupHtml);
        marker.setPopup(popup);
      }

      marker.addTo(this.map);
      this.poiMarkers.push(marker);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.removeEventListener('td-jump-mile', this.handlePopupJump as EventListener);
      window.addEventListener('bpn-jump-mile', this.handlePopupJump as EventListener);
      window.addEventListener('td-jump-mile', this.handlePopupJump as EventListener);
    }
  }

  private clearPoiMarkers(): void {
    for (const marker of this.poiMarkers) {
      marker.remove();
    }
    this.poiMarkers = [];
  }

  private handlePopupJump = (e: Event): void => {
    const customEvent = e as CustomEvent<number>;
    if (typeof customEvent?.detail === 'number') {
      this.selectMile.emit(customEvent.detail);
      if (this.gpsSimulator.running() || typeof this.gpsSimulator.seek === 'function') {
        this.gpsSimulator.seek(customEvent.detail);
      }
      if (typeof document !== 'undefined') {
        const popups = document.querySelectorAll('.maplibregl-popup');
        popups.forEach((p) => p.remove());
      }
    }
  };

  // --------------------------------------------------------------------------
  // Helpers: Geometry, Climb SVG, Turns, Simulator
  // --------------------------------------------------------------------------

  generateClimbSvgPath(climb: Climb, progressPercent: number): {
    linePath: string;
    areaPath: string;
    riderX: number;
    riderY: number;
  } {
    const pts = this.routeService.trackPoints();
    const climbPts = pts && pts.length > 0
      ? pts.filter((p) => p[4] >= climb.startMile && p[4] <= climb.endMile)
      : [];

    const W = 100;
    const H = 24;
    const padTop = 3;
    const padBot = 3;
    const usableH = H - padTop - padBot;

    if (climbPts.length >= 2) {
      let minEle = Infinity;
      let maxEle = -Infinity;
      for (const p of climbPts) {
        if (p[2] < minEle) minEle = p[2];
        if (p[2] > maxEle) maxEle = p[2];
      }
      const eleRange = Math.max(10, maxEle - minEle);
      const lenMiles = climb.endMile - climb.startMile || 1;

      const pointsSvg: string[] = [];
      for (const p of climbPts) {
        const x = ((p[4] - climb.startMile) / lenMiles) * W;
        const y = padTop + (1 - (p[2] - minEle) / eleRange) * usableH;
        pointsSvg.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }

      const linePath = `M ${pointsSvg.join(' L ')}`;
      const areaPath = `${linePath} L ${W},${H} L 0,${H} Z`;

      const startEle = climb.startElevationMeters || minEle;
      const summitEle = climb.summitElevationMeters || maxEle;
      const riderEle = startEle + (progressPercent / 100) * (summitEle - startEle);
      const riderX = (progressPercent / 100) * W;
      const riderY = padTop + (1 - Math.max(0, Math.min(1, (riderEle - minEle) / eleRange))) * usableH;

      return { linePath, areaPath, riderX, riderY };
    }

    const riderX = (progressPercent / 100) * W;
    const riderY = 21 - (progressPercent / 100) * 16;
    return {
      linePath: 'M 0,21 L 100,5',
      areaPath: 'M 0,21 L 100,5 L 100,24 L 0,24 Z',
      riderX,
      riderY
    };
  }

  getTurnIcon(direction: TurnDirection): string {
    return getTurnIcon(direction);
  }

  toggleSimulatorModal(): void {
    this.isSimulatorOpen.update((v) => !v);
  }

  onSimSpeedChange(speed: number): void {
    const validSpeed = Math.max(0, speed);
    this.simSpeedInput.set(validSpeed);
    if (this.gpsSimulator.running()) {
      this.gpsSimulator.setSpeed(validSpeed);
    }
  }


  onSimSpeedInputChange(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.onSimSpeedChange(val);
  }

  setSimPreset(speed: number): void {
    this.simSpeedInput.set(speed);
    if (this.gpsSimulator.running()) {
      this.gpsSimulator.setSpeed(speed);
    }
  }

  toggleSimulation(): void {
    if (this.gpsSimulator.running()) {
      const stopMile = typeof this.gpsSimulator.simulatedMile === 'function'
        ? this.gpsSimulator.simulatedMile()
        : this.currentMile();
      this.gpsSimulator.stop();
      this.selectMile.emit(stopMile);
    } else {
      const rawPts = this.routeService.trackPoints();
      const guidance = typeof this.routeService?.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
      const pts = guidance && guidance.length >= 2 ? guidance : rawPts;
      const speed = this.simSpeedInput();
      if (pts && pts.length >= 2 && typeof this.gpsSimulator.setTrackPoints === 'function') {
        this.gpsSimulator.setTrackPoints(pts);
      }
      if (typeof this.gpsSimulator.seek === 'function') {
        this.gpsSimulator.seek(this.currentMile());
      }
      this.gpsSimulator.start(speed, pts);
    }
  }

  resetSimulation(): void {
    this.gpsSimulator.reset();
    const resetMile = typeof this.gpsSimulator.simulatedMile === 'function'
      ? this.gpsSimulator.simulatedMile()
      : 0;
    this.selectMile.emit(resetMile);
  }

  private interpolatePointAtMile(
    pts: [number, number, number, number, number][],
    targetMile: number
  ): [number, number] {
    if (!pts || pts.length === 0) return [0, 0];
    if (targetMile <= pts[0][4]) return [pts[0][0], pts[0][1]];
    const last = pts.length - 1;
    if (targetMile >= pts[last][4]) return [pts[last][0], pts[last][1]];

    let low = 0;
    let high = last;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (pts[mid][4] <= targetMile) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const idxA = Math.max(0, low - 1);
    const idxB = Math.min(last, idxA + 1);
    const span = pts[idxB][4] - pts[idxA][4];
    const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (targetMile - pts[idxA][4]) / span));

    const lat = pts[idxA][0] + t * (pts[idxB][0] - pts[idxA][0]);
    const lon = pts[idxA][1] + t * (pts[idxB][1] - pts[idxA][1]);
    return [lat, lon];
  }

  private getForwardTrackBearing(mile: number): number {
    const guidance = typeof this.routeService?.guidanceTrackPoints === 'function' ? this.routeService.guidanceTrackPoints() : [];
    const points = guidance && guidance.length >= 2 ? guidance : this.routeService.trackPoints();
    if (!points || points.length < 2) return 0;
    if (typeof this.turnGuidance?.getRouteTangentBearing === 'function') {
      return this.turnGuidance.getRouteTangentBearing(points, mile, 25.0);
    }
    const p1 = points[0];
    const p2 = points[1];
    return typeof this.turnGuidance?.calculateBearing === 'function'
      ? this.turnGuidance.calculateBearing(p1[0], p1[1], p2[0], p2[1])
      : 0;
  }
}
