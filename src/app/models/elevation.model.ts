import { ClimbWeatherForecast } from './weather.model';

export interface MountainPass {
  id: string;
  name: string;
  state: string;
  routeMile: number;
  routeKm: number;
  elevationMeters: number;
  elevationFeet: number;
  lat: number;
  lon: number;
  difficulty: 'moderate' | 'difficult' | 'extreme';
  notes: string;
}

export type ProfileWindowMode = 'next10' | 'next25' | 'next50' | 'next100' | 'full';

export interface ElevationScrubData {
  routeMile: number;
  routeKm: number;
  elevationMeters: number;
  elevationFeet: number;
  gradePercent: number;
  distanceAheadMiles: number;
  distanceAheadKm: number;
}

export interface Climb {
  id: string;
  name: string;
  state: string;
  startMile: number;
  endMile: number;
  startKm: number;
  endKm: number;
  lengthMiles: number;
  lengthKm: number;
  startElevationMeters: number;
  summitElevationMeters: number;
  startElevationFeet: number;
  summitElevationFeet: number;
  elevationGainMeters: number;
  elevationGainFeet: number;
  avgGradePercent: number;
  maxGradePercent: number;
  isIconic: boolean;
  passId?: string;
  difficulty?: 'moderate' | 'difficult' | 'extreme';
  notes?: string;
  trailName?: string;
  parkName?: string;
  landmark?: string;
  roadClass?: string;
  surface?: string;
  firmness?: string;
  tracktype?: string;
  researched?: boolean;
}


export interface ClimbGradientStop {
  offset: string;
  color: string;
}

export interface ClimbMiniProfile {
  linePathD: string;
  areaPathD: string;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  summitPoint: { x: number; y: number };
  riderDot: { x: number; y: number } | null;
  thunderstormHazardPoint?: { x: number; y: number } | null;
  gradientStops: ClimbGradientStop[];
  width: number;
}

export type ClimbFilterMode = 'window' | 'upcoming' | 'all';

export interface UpcomingClimb extends Climb {
  status: 'passed' | 'climbing' | 'upcoming';
  distanceToStartMiles: number;
  distanceToStartKm: number;
  distanceToSummitMiles: number;
  distanceToSummitKm: number;
  distanceAgoMiles: number;
  distanceAgoKm: number;
  climbRemainingMeters: number;
  climbRemainingFeet: number;
  climbCompletedPercent: number;
  estimatedSeconds: number;
  estimatedTimeFormatted: string;
  hikeBikeDistanceKm: number;
  hikeBikeDistanceMiles: number;
  hikeBikeDistanceMeters: number;
  hikeBikeSeconds: number;
  hikeBikeTimeFormatted: string;
  miniProfile?: ClimbMiniProfile;
  climbWeather?: ClimbWeatherForecast | null;
}

/**
 * Pure helper function to compute SVG path geometry, slope gradient stops,
 * summit point, and active rider location dot for a miniature climb profile.
 * Shared across ElevationProfileComponent and RideCockpitComponent.
 */
export function buildClimbMiniProfile(
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

