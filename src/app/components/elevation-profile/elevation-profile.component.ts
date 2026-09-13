import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { EtaPhysicsService } from '../../services/eta-physics.service';
import { WeatherService } from '../../services/weather.service';
import { WeatherForecastComponent } from '../weather-forecast/weather-forecast.component';
import { ProfileWindowMode, ElevationScrubData, MountainPass, Climb, UpcomingClimb, ClimbFilterMode, ClimbMiniProfile, ClimbGradientStop } from '../../models/elevation.model';
import { ClimbWeatherForecast } from '../../models/weather.model';

export interface SvgPoint {
  x: number;
  y: number;
  mile: number;
  km: number;
  eleMeters: number;
  eleFeet: number;
  gradePercent: number;
}

@Component({
  selector: 'app-elevation-profile',
  standalone: true,
  imports: [CommonModule, WeatherForecastComponent],
  templateUrl: './elevation-profile.component.html',
  styleUrl: './elevation-profile.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ElevationProfileComponent {
  private readonly settings = inject(SettingsService);
  private readonly etaPhysics = inject(EtaPhysicsService);
  private readonly routeService = inject(RouteDataService);
  readonly weatherService = inject(WeatherService);

  readonly isWeatherExpanded = signal<boolean>(false);
  readonly expandedClimbWeatherId = signal<string | null>(null);

  toggleClimbWeatherBreakdown(climbId: string): void {
    this.expandedClimbWeatherId.update((curr) => (curr === climbId ? null : climbId));
  }

  isClimbWeatherExpanded(climbId: string): boolean {
    return this.expandedClimbWeatherId() === climbId;
  }

  // Inputs from parent shell
  readonly currentMile = input<number>(0);
  readonly unit = input<'miles' | 'km'>('miles');
  readonly avgSpeedMph = input<number>(10.5);
  readonly riderPowerWatts = input<number>(150);

  // Reactive pace mode
  readonly isPowerMode = computed(() => this.settings.paceMode() === 'power');

  // Output event to change rider position
  readonly selectMile = output<number>();

  // Zoom modes: upcoming 50 miles, upcoming 100 miles, or full tour
  readonly zoomMode = signal<ProfileWindowMode>('next50');

  // Scrubbing state
  readonly scrubData = signal<ElevationScrubData | null>(null);
  readonly scrubX = signal<number | null>(null);
  readonly scrubY = signal<number | null>(null);
  readonly isPinned = signal<boolean>(false);
  readonly popupSide = signal<'left' | 'right'>('right');

  // Mountain pass data & Climbs data
  readonly passesInput = input<MountainPass[] | null>(null, { alias: 'passes' });
  readonly climbsInput = input<Climb[] | null>(null, { alias: 'climbs' });

  readonly dynamicPasses = computed(() => {
    const fromInput = this.passesInput();
    if (fromInput && fromInput.length > 0) return fromInput;
    return this.routeService.passes ? this.routeService.passes() : [];
  });

  readonly dynamicClimbs = computed(() => {
    const fromInput = this.climbsInput();
    if (fromInput && fromInput.length > 0) return fromInput;
    return this.routeService.climbs ? this.routeService.climbs() : [];
  });

  get allPasses(): MountainPass[] {
    return this.dynamicPasses();
  }

  get allClimbs(): Climb[] {
    return this.dynamicClimbs();
  }

  readonly climbFilter = signal<ClimbFilterMode>('upcoming');
  protected readonly Math = Math;


  // SVG canvas dimensions
  readonly svgWidth = 800;
  readonly svgHeight = 240;
  readonly padLeft = 46;
  readonly padRight = 16;
  readonly padTop = 24;
  readonly padBottom = 28;

  constructor() {}

  formatDuration(seconds: number): string {
    if (seconds <= 0) return '0m';
    const totalMinutes = Math.round(seconds / 60);
    if (totalMinutes === 0) return '<1m';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
      return `${minutes}m`;
    } else if (hours < 24) {
      return minutes > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${hours}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return `${days}d ${remHours}h`;
    }
  }

  // Active mileage window [startMile, endMile]
  readonly activeWindow = computed(() => {
    const curr = this.currentMile();
    const mode = this.zoomMode();
    const totalMiles = this.routeService.totalDistanceMiles;
    const isKm = this.unit() === 'km';

    if (mode === 'full') {
      return { start: 0, end: totalMiles };
    } else if (mode === 'next100') {
      const windowDist = isKm ? (100 / 1.60934) : 100;
      const bufferDist = isKm ? (5 / 1.60934) : 5;
      const start = Math.max(0, curr - bufferDist);
      const end = Math.min(totalMiles, start + windowDist);
      return { start, end };
    } else if (mode === 'next50') {
      const windowDist = isKm ? (50 / 1.60934) : 50;
      const bufferDist = isKm ? (2 / 1.60934) : 2;
      const start = Math.max(0, curr - bufferDist);
      const end = Math.min(totalMiles, start + windowDist);
      return { start, end };
    } else if (mode === 'next25') {
      const windowDist = isKm ? (25 / 1.60934) : 25;
      const bufferDist = isKm ? (1 / 1.60934) : 1;
      const start = Math.max(0, curr - bufferDist);
      const end = Math.min(totalMiles, start + windowDist);
      return { start, end };
    } else {
      // 'next10'
      const windowDist = isKm ? (10 / 1.60934) : 10;
      const bufferDist = isKm ? (0.5 / 1.60934) : 0.5;
      const start = Math.max(0, curr - bufferDist);
      const end = Math.min(totalMiles, start + windowDist);
      return { start, end };
    }
  });

  // Rider current elevation computed directly from track data
  readonly currentRiderEle = computed(() => {
    const curr = this.currentMile();
    const pts = this.routeService.trackPoints();
    if (!pts || pts.length === 0) return { meters: 1400, feet: 4593 };

    let low = 0;
    let high = pts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (pts[mid][4] < curr) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const idx = Math.min(pts.length - 1, Math.max(0, low));
    const eleMeters = Math.round(pts[idx][2]);
    const eleFeet = Math.round(eleMeters * 3.28084);
    return { meters: eleMeters, feet: eleFeet };
  });

  // Filtered and downsampled track points for SVG chart
  readonly chartPoints = computed<SvgPoint[]>(() => {
    const rawPoints = this.routeService.trackPoints();
    if (!rawPoints || rawPoints.length === 0) return [];

    const { start, end } = this.activeWindow();
    const windowMiles = Math.max(1, end - start);

    // 1. Filter points in current window
    const inWindow = rawPoints.filter((pt) => pt[4] >= start && pt[4] <= end);
    if (inWindow.length === 0) return [];

    // 2. Downsample if needed (aim for ~250 points for smooth 60fps rendering)
    const targetCount = 250;
    const step = Math.max(1, Math.floor(inWindow.length / targetCount));
    const sampled: [number, number, number, number, number][] = [];

    for (let i = 0; i < inWindow.length; i += step) {
      sampled.push(inWindow[i]);
    }
    // Ensure the last point in window is included
    if (sampled[sampled.length - 1] !== inWindow[inWindow.length - 1]) {
      sampled.push(inWindow[inWindow.length - 1]);
    }

    // 3. Elevation range in meters
    let minEle = Infinity;
    let maxEle = -Infinity;
    for (const p of sampled) {
      if (p[2] < minEle) minEle = p[2];
      if (p[2] > maxEle) maxEle = p[2];
    }
    // Add vertical margin (50m buffer)
    minEle = Math.max(0, minEle - 50);
    maxEle = maxEle + 60;
    const eleRange = Math.max(50, maxEle - minEle);

    const drawWidth = this.svgWidth - this.padLeft - this.padRight;
    const drawHeight = this.svgHeight - this.padTop - this.padBottom;

    // 4. Map points to SVG coordinates with slope grade
    const result: SvgPoint[] = [];

    for (let i = 0; i < sampled.length; i++) {
      const p = sampled[i];
      const mile = p[4];
      const km = p[3];
      const eleMeters = p[2];
      const eleFeet = Math.round(eleMeters * 3.28084);

      const x = this.padLeft + ((mile - start) / windowMiles) * drawWidth;
      const y = this.padTop + (1 - (eleMeters - minEle) / eleRange) * drawHeight;

      // Calculate grade % relative to next/prev point
      let grade = 0;
      if (i < sampled.length - 1) {
        const next = sampled[i + 1];
        const distMeters = Math.max(1, (next[4] - mile) * 1609.34);
        const dEle = next[2] - eleMeters;
        grade = Math.round((dEle / distMeters) * 1000) / 10;
      } else if (i > 0) {
        grade = result[i - 1]?.gradePercent || 0;
      }

      result.push({
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        mile: Math.round(mile * 10) / 10,
        km: Math.round(km * 10) / 10,
        eleMeters: Math.round(eleMeters),
        eleFeet,
        gradePercent: grade
      });
    }

    return result;
  });

  // SVG Line path string (d attribute)
  readonly linePathD = computed(() => {
    const pts = this.chartPoints();
    if (pts.length < 2) return '';
    return pts.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
  });

  // SVG Filled area under the curve
  readonly areaPathD = computed(() => {
    const pts = this.chartPoints();
    if (pts.length < 2) return '';
    const bottomY = this.svgHeight - this.padBottom;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const linePart = pts.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
    return `${linePart} L ${last.x} ${bottomY} L ${first.x} ${bottomY} Z`;
  });

  // Gradient stops based on climb grade
  readonly gradientStops = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return [];
    const drawWidth = this.svgWidth - this.padLeft - this.padRight;

    return pts.map((p) => {
      const offsetPct = Math.max(0, Math.min(100, Math.round(((p.x - this.padLeft) / drawWidth) * 100)));
      let color = '#10b981'; // < 4% green
      if (p.gradePercent >= 12) {
        color = '#ef4444'; // > 12% red (extreme)
      } else if (p.gradePercent >= 8) {
        color = '#f97316'; // 8-12% orange (steep)
      } else if (p.gradePercent >= 4) {
        color = '#eab308'; // 4-8% yellow (moderate)
      } else if (p.gradePercent < -4) {
        color = '#06b6d4'; // Descent cyan
      }
      return { offset: `${offsetPct}%`, color };
    });
  });

  // Elevation statistics for visible chart window
  readonly chartStats = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) {
      return { minMeters: 0, maxMeters: 0, minFeet: 0, maxFeet: 0, gainMeters: 0, gainFeet: 0 };
    }

    let minM = Infinity;
    let maxM = -Infinity;
    let gainM = 0;

    for (let i = 0; i < pts.length; i++) {
      const ele = pts[i].eleMeters;
      if (ele < minM) minM = ele;
      if (ele > maxM) maxM = ele;

      if (i > 0 && ele > pts[i - 1].eleMeters) {
        gainM += ele - pts[i - 1].eleMeters;
      }
    }

    return {
      minMeters: Math.round(minM),
      maxMeters: Math.round(maxM),
      minFeet: Math.round(minM * 3.28084),
      maxFeet: Math.round(maxM * 3.28084),
      gainMeters: Math.round(gainM),
      gainFeet: Math.round(gainM * 3.28084)
    };
  });

  // Rider position on SVG chart
  readonly riderSvgPos = computed(() => {
    const curr = this.currentMile();
    const { start, end } = this.activeWindow();
    if (curr < start || curr > end) return null;

    const pts = this.chartPoints();
    if (pts.length === 0) return null;

    // Find closest point to currentMile
    let closest = pts[0];
    let minDiff = Math.abs(pts[0].mile - curr);
    for (const p of pts) {
      const diff = Math.abs(p.mile - curr);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    return {
      x: closest.x,
      y: closest.y,
      eleFeet: closest.eleFeet,
      eleMeters: closest.eleMeters
    };
  });

  // Visible mountain passes in current chart window
  readonly visiblePasses = computed(() => {
    const { start, end } = this.activeWindow();
    const pts = this.chartPoints();
    if (pts.length === 0) return [];

    const drawWidth = this.svgWidth - this.padLeft - this.padRight;
    const windowMiles = Math.max(1, end - start);

    return this.allPasses
      .filter((pass) => pass.routeMile >= start && pass.routeMile <= end)
      .map((pass) => {
        const x = this.padLeft + ((pass.routeMile - start) / windowMiles) * drawWidth;
        // Interpolate Y from chart points
        let closest = pts[0];
        let minDiff = Infinity;
        for (const p of pts) {
          const diff = Math.abs(p.mile - pass.routeMile);
          if (diff < minDiff) {
            minDiff = diff;
            closest = p;
          }
        }
        return {
          ...pass,
          svgX: Math.round(x * 10) / 10,
          svgY: closest.y
        };
      });
  });

  // Passes status for tracker card list
  readonly passesWithStatus = computed(() => {
    const curr = this.currentMile();
    const riderEle = this.currentRiderEle().meters;

    return this.allPasses.map((pass) => {
      const diffMiles = pass.routeMile - curr;
      const diffKm = pass.routeKm - (curr * 1.60934);
      const isPassed = diffMiles < -1.0;
      const isClimbing = diffMiles >= -1.0 && diffMiles <= 15.0;
      const climbRemainingMeters = Math.max(0, pass.elevationMeters - riderEle);
      const climbRemainingFeet = Math.round(climbRemainingMeters * 3.28084);

      let status: 'passed' | 'climbing' | 'upcoming' = 'upcoming';
      if (isPassed) status = 'passed';
      else if (isClimbing) status = 'climbing';

      return {
        ...pass,
        status,
        diffMiles: Math.round(diffMiles * 10) / 10,
        diffKm: Math.round(diffKm * 10) / 10,
        climbRemainingMeters,
        climbRemainingFeet
      };
    });
  });

  // Climbs with rider status (upcoming, climbing, passed)
  readonly climbsWithStatus = computed<UpcomingClimb[]>(() => {
    // Track cache changes and pace mode settings reactively
    this.etaPhysics.cacheVersion();
    this.settings.paceMode();
    this.settings.riderPowerWatts();
    this.settings.avgSpeedMph();

    const curr = this.currentMile();
    const currKm = curr * 1.60934;
    const riderEleM = this.currentRiderEle().meters;
    const trackPts = this.routeService.trackPoints();

    return this.allClimbs.map((climb) => {
      let status: 'passed' | 'climbing' | 'upcoming';
      let distanceToStartMiles = 0;
      let distanceToStartKm = 0;
      let distanceToSummitMiles = 0;
      let distanceToSummitKm = 0;
      let distanceAgoMiles = 0;
      let distanceAgoKm = 0;
      let climbRemainingMeters = 0;
      let climbCompletedPercent = 0;

      if (curr < climb.startMile) {
        status = 'upcoming';
        distanceToStartMiles = Math.round((climb.startMile - curr) * 10) / 10;
        distanceToStartKm = Math.round((climb.startKm - currKm) * 10) / 10;
        distanceToSummitMiles = Math.round((climb.endMile - curr) * 10) / 10;
        distanceToSummitKm = Math.round((climb.endKm - currKm) * 10) / 10;
        climbRemainingMeters = climb.elevationGainMeters;
      } else if (curr <= climb.endMile) {
        status = 'climbing';
        distanceToSummitMiles = Math.round((climb.endMile - curr) * 10) / 10;
        distanceToSummitKm = Math.round((climb.endKm - currKm) * 10) / 10;
        climbRemainingMeters = Math.max(0, climb.summitElevationMeters - riderEleM);
        const climbSpan = Math.max(0.1, climb.lengthMiles);
        climbCompletedPercent = Math.min(100, Math.max(0, Math.round(((curr - climb.startMile) / climbSpan) * 100)));
      } else {
        status = 'passed';
        distanceAgoMiles = Math.round((curr - climb.endMile) * 10) / 10;
        distanceAgoKm = Math.round((currKm - climb.endKm) * 10) / 10;
        climbCompletedPercent = 100;
      }

      const climbRemainingFeet = Math.round(climbRemainingMeters * 3.28084);

      // Estimate duration and hike-a-bike stats:
      // If actively climbing, calculate remaining time from current position to climb summit.
      // If upcoming or passed, calculate for the full climb.
      const stats = (status === 'climbing')
        ? this.etaPhysics.getClimbPhysicsStats(curr, climb.endMile)
        : this.etaPhysics.getClimbPhysicsStats(climb.startMile, climb.endMile);

      const isClimbing = status === 'climbing';
      const climbWeather = typeof this.weatherService.getClimbForecast === 'function'
        ? this.weatherService.getClimbForecast(climb.id)
        : null;
      const miniProfile = this.buildMiniProfile(climb, trackPts, curr, isClimbing, climbWeather);

      return {
        ...climb,
        status,
        distanceToStartMiles,
        distanceToStartKm,
        distanceToSummitMiles,
        distanceToSummitKm,
        distanceAgoMiles,
        distanceAgoKm,
        climbRemainingMeters,
        climbRemainingFeet,
        climbCompletedPercent,
        estimatedSeconds: stats.estimatedSeconds,
        estimatedTimeFormatted: this.formatDuration(stats.estimatedSeconds),
        hikeBikeDistanceKm: stats.hikeBikeDistanceKm,
        hikeBikeDistanceMiles: stats.hikeBikeDistanceMiles,
        hikeBikeDistanceMeters: stats.hikeBikeDistanceMeters,
        hikeBikeSeconds: stats.hikeBikeSeconds,
        hikeBikeTimeFormatted: this.formatDuration(stats.hikeBikeSeconds),
        climbWeather,
        miniProfile
      };
    });
  });

  // Filtered climbs based on user selection: 'window' | 'upcoming' | 'all'
  readonly filteredClimbs = computed<UpcomingClimb[]>(() => {
    const filter = this.climbFilter();
    const climbs = this.climbsWithStatus();

    if (filter === 'all') {
      return climbs;
    } else if (filter === 'window') {
      const { start, end } = this.activeWindow();
      return climbs.filter((c) => c.startMile <= end && c.endMile >= start);
    } else {
      // 'upcoming': rider is before or on the climb
      return climbs.filter((c) => c.status !== 'passed');
    }
  });

  // Climb counts for filter tabs
  readonly windowClimbsCount = computed(() => {
    const { start, end } = this.activeWindow();
    return this.allClimbs.filter((c) => c.startMile <= end && c.endMile >= start).length;
  });

  readonly upcomingClimbsCount = computed(() => {
    return this.climbsWithStatus().filter((c) => c.status !== 'passed').length;
  });

  setClimbFilter(filter: ClimbFilterMode): void {
    this.climbFilter.set(filter);
  }

  buildMiniProfile(
    climb: Climb,
    trackPts: [number, number, number, number, number][],
    currentMile: number,
    isClimbing: boolean,
    climbWeather?: ClimbWeatherForecast | null
  ): ClimbMiniProfile {
    // Dynamically scale width based on average grade:
    // Gentle climbs (<= 3%) are wider (up to 150px) to appear shallow and gradual.
    // Steep/brutal climbs (>= 11%) are narrower (down to 70px) so the visual slope rises sharply.
    const grade = climb.avgGradePercent && climb.avgGradePercent > 0
      ? climb.avgGradePercent
      : (climb.elevationGainMeters / Math.max(100, (climb.endMile - climb.startMile) * 1609.34)) * 100;

    const minGrade = 3.0;
    const maxGrade = 11.0;
    const minWidth = 70;
    const maxWidth = 150;
    const clampedGrade = Math.max(minGrade, Math.min(maxGrade, grade || 5.0));
    const gradeT = (clampedGrade - minGrade) / (maxGrade - minGrade);
    const svgWidth = Math.round(maxWidth - gradeT * (maxWidth - minWidth));

    const svgHeight = 36;
    const padX = 2.5;
    const padY = 3.5;
    const drawWidth = svgWidth - 2 * padX;
    const drawHeight = svgHeight - 2 * padY;

    // Small crest shoulder after summit to crown the mountain peak (10-15% of distance, max 1.5 miles)
    const climbSpan = Math.max(0.1, climb.endMile - climb.startMile);
    const crestBuffer = Math.min(1.5, Math.max(0.3, climbSpan * 0.12));
    const profileEndMile = climb.endMile + crestBuffer;

    let midPoints: { mile: number; ele: number }[] = [];
    let postPoints: { mile: number; ele: number }[] = [];

    if (trackPts && trackPts.length > 0) {
      const inClimb = trackPts.filter((p) => p[4] > climb.startMile && p[4] < climb.endMile);
      if (inClimb.length > 30) {
        const step = inClimb.length / 30;
        midPoints = Array.from({ length: 30 }, (_, idx) => {
          const pt = inClimb[Math.floor(idx * step)];
          return { mile: pt[4], ele: pt[2] };
        });
      } else {
        midPoints = inClimb.map((p) => ({ mile: p[4], ele: p[2] }));
      }

      // Post-summit descent points for crest shoulder
      const postClimb = trackPts.filter((p) => p[4] > climb.endMile && p[4] <= profileEndMile);
      if (postClimb.length > 5) {
        const step = postClimb.length / 5;
        postPoints = Array.from({ length: 5 }, (_, idx) => {
          const pt = postClimb[Math.floor(idx * step)];
          return { mile: pt[4], ele: pt[2] };
        });
      } else {
        postPoints = postClimb.map((p) => ({ mile: p[4], ele: p[2] }));
      }
    }

    const points = [
      { mile: climb.startMile, ele: climb.startElevationMeters },
      ...midPoints,
      { mile: climb.endMile, ele: climb.summitElevationMeters },
      ...postPoints
    ];

    const summitIdx = 1 + midPoints.length; // index of climb.summitElevationMeters

    let minEle = Infinity;
    let maxEle = -Infinity;
    for (const p of points) {
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
    }
    const eleRange = Math.max(10, maxEle - minEle);
    const totalSpan = Math.max(0.01, points[points.length - 1].mile - climb.startMile);

    const svgPts: { x: number; y: number; mile: number; grade: number }[] = points.map((p, i) => {
      const x = Math.round((padX + ((p.mile - climb.startMile) / totalSpan) * drawWidth) * 10) / 10;
      const y = Math.round((padY + (1 - (p.ele - minEle) / eleRange) * drawHeight) * 10) / 10;

      let grade = 0;
      if (i < points.length - 1) {
        const next = points[i + 1];
        const dist = Math.max(1, (next.mile - p.mile) * 1609.34);
        grade = ((next.ele - p.ele) / dist) * 100;
      } else if (i > 0) {
        const prev = points[i - 1];
        const dist = Math.max(1, (p.mile - prev.mile) * 1609.34);
        grade = ((p.ele - prev.ele) / dist) * 100;
      }

      return { x, y, mile: p.mile, grade };
    });

    const linePathD = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const first = svgPts[0];
    const last = svgPts[svgPts.length - 1];
    const summitPoint = svgPts[summitIdx] || last;
    const areaPathD = `${linePathD} L ${last.x} ${svgHeight} L ${first.x} ${svgHeight} Z`;

    // Calculate dynamic gradient stops matching the main elevation profile legend:
    // < 4%: #10b981 (green/teal), 4-8%: #eab308 (yellow), 8-12%: #f97316 (orange), > 12%: #ef4444 (red), < -4%: #06b6d4 (cyan)
    const gradientStops: ClimbGradientStop[] = svgPts.map((p) => {
      const offsetPct = Math.max(0, Math.min(100, Math.round(((p.x - padX) / drawWidth) * 100)));
      let color = '#10b981'; // < 4% green
      if (p.grade >= 12) {
        color = '#ef4444'; // > 12% red (extreme)
      } else if (p.grade >= 8) {
        color = '#f97316'; // 8-12% orange (steep)
      } else if (p.grade >= 4) {
        color = '#eab308'; // 4-8% yellow (moderate)
      } else if (p.grade < -4) {
        color = '#06b6d4'; // Descent cyan
      }
      return { offset: `${offsetPct}%`, color };
    });

    let riderDot: { x: number; y: number } | null = null;
    if (isClimbing && currentMile >= climb.startMile && currentMile <= climb.endMile) {
      for (let i = 0; i < summitIdx; i++) {
        if (currentMile >= points[i].mile && currentMile <= points[i + 1].mile) {
          const segSpan = Math.max(0.0001, points[i + 1].mile - points[i].mile);
          const t = (currentMile - points[i].mile) / segSpan;
          const rx = Math.round((svgPts[i].x + t * (svgPts[i + 1].x - svgPts[i].x)) * 10) / 10;
          const ry = Math.round((svgPts[i].y + t * (svgPts[i + 1].y - svgPts[i].y)) * 10) / 10;
          riderDot = { x: rx, y: ry };
          break;
        }
      }
      if (!riderDot) {
        riderDot = { x: summitPoint.x, y: summitPoint.y };
      }
    }

    let thunderstormHazardPoint: { x: number; y: number } | null = null;
    if (climbWeather?.hasThunderstormHazard && climbWeather.thunderstormHazard) {
      if (climbWeather.thunderstormHazard.summitAffected) {
        thunderstormHazardPoint = { x: summitPoint.x, y: summitPoint.y };
      } else {
        const hazardKm = climbWeather.thunderstormHazard.earliestKm;
        const spanKm = Math.max(0.1, climb.endKm - climb.startKm);
        const t = Math.max(0, Math.min(1, hazardKm / spanKm));
        const targetMile = climb.startMile + t * (climb.endMile - climb.startMile);
        let closestIdx = 0;
        let minD = Infinity;
        for (let i = 0; i < points.length; i++) {
          const d = Math.abs(points[i].mile - targetMile);
          if (d < minD) {
            minD = d;
            closestIdx = i;
          }
        }
        thunderstormHazardPoint = { x: svgPts[closestIdx].x, y: svgPts[closestIdx].y };
      }
    }

    return {
      linePathD,
      areaPathD,
      startPoint: { x: first.x, y: first.y },
      endPoint: { x: last.x, y: last.y },
      summitPoint: { x: summitPoint.x, y: summitPoint.y },
      riderDot,
      thunderstormHazardPoint,
      gradientStops,
      width: svgWidth
    };
  }

  getClimbColor(climb: UpcomingClimb): string {
    if (climb.status === 'climbing') return '#fbbf24'; // amber-400
    if (climb.status === 'passed') return '#64748b'; // slate-500
    if (climb.difficulty === 'extreme') return '#f43f5e'; // rose-500
    if (climb.difficulty === 'difficult') return '#f97316'; // orange-500
    if (climb.difficulty === 'moderate') return '#eab308'; // yellow-500
    return '#10b981'; // emerald-500
  }


  // Scrubbing handler (touch and mouse)
  handleScrubEvent(event: MouseEvent | TouchEvent, isPinnedAction = false): void {
    const target = event.currentTarget as HTMLElement;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    let clientX = 0;

    if ('touches' in event && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
    } else if ('clientX' in event) {
      clientX = event.clientX;
    } else {
      return;
    }

    const relX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, relX / rect.width));
    const svgTargetX = this.svgWidth * ratio;

    // Determine popup side: if clicked/scrubbed on the right half, show on the left side
    this.popupSide.set(ratio > 0.5 ? 'left' : 'right');

    // Find closest chart point
    const pts = this.chartPoints();
    if (pts.length === 0) return;

    let closest = pts[0];
    let minDiff = Infinity;
    for (const p of pts) {
      const diff = Math.abs(p.x - svgTargetX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    const curr = this.currentMile();
    const distanceAheadMiles = Math.round((closest.mile - curr) * 10) / 10;
    const distanceAheadKm = Math.round((closest.km - curr * 1.60934) * 10) / 10;

    this.scrubX.set(closest.x);
    this.scrubY.set(closest.y);
    this.scrubData.set({
      routeMile: closest.mile,
      routeKm: closest.km,
      elevationMeters: closest.eleMeters,
      elevationFeet: closest.eleFeet,
      gradePercent: closest.gradePercent,
      distanceAheadMiles,
      distanceAheadKm
    });

    if (isPinnedAction) {
      this.isPinned.set(true);
    }
  }

  handleMouseMove(event: MouseEvent): void {
    if (this.isPinned() && event.buttons !== 1) {
      // Point is pinned by click/tap; ignore hover moves so user can move cursor over to popup window
      return;
    }
    // If mouse button is held down (dragging), keep pinned
    const isDragging = event.buttons === 1;
    this.handleScrubEvent(event, isDragging);
  }

  handleClick(event: MouseEvent): void {
    this.handleScrubEvent(event, true);
  }

  handleTouchStart(event: TouchEvent): void {
    this.handleScrubEvent(event, true);
  }

  handleTouchMove(event: TouchEvent): void {
    this.handleScrubEvent(event, true);
  }

  onMouseLeave(): void {
    if (!this.isPinned()) {
      this.clearScrub();
    }
  }

  clearScrub(force = false): void {
    if (!force && this.isPinned()) {
      return;
    }
    this.scrubData.set(null);
    this.scrubX.set(null);
    this.scrubY.set(null);
    this.isPinned.set(false);
  }

  jumpToMile(mile: number): void {
    this.selectMile.emit(mile);
    this.clearScrub(true);
  }

  setZoom(mode: ProfileWindowMode): void {
    this.zoomMode.set(mode);
    this.clearScrub(true);
  }
}
