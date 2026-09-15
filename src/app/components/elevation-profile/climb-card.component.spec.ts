import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClimbCardComponent } from './climb-card.component';
import { UpcomingClimb } from '../../models/elevation.model';

describe('ClimbCardComponent', () => {
  let component: ClimbCardComponent;
  let fixture: ComponentFixture<ClimbCardComponent>;

  const baseClimb: UpcomingClimb = {
    id: 'climb-1',
    name: 'Reddish Knob Ascent',
    state: 'VA',
    startMile: 50.0,
    endMile: 58.0,
    startKm: 80.467,
    endKm: 93.342,
    lengthMiles: 8.0,
    lengthKm: 12.875,
    startElevationMeters: 500,
    summitElevationMeters: 1340,
    startElevationFeet: 1640,
    summitElevationFeet: 4396,
    elevationGainMeters: 840,
    elevationGainFeet: 2756,
    avgGradePercent: 6.5,
    maxGradePercent: 12.0,
    isIconic: true,
    difficulty: 'difficult',
    notes: 'Steep gravel ascent leading to summit vista.',
    trailName: 'Briery Branch Gap',
    parkName: 'George Washington National Forest',
    landmark: 'Reddish Knob Tower',
    status: 'upcoming',
    distanceToStartMiles: 10.0,
    distanceToStartKm: 16.1,
    distanceToSummitMiles: 18.0,
    distanceToSummitKm: 29.0,
    distanceAgoMiles: 0,
    distanceAgoKm: 0,
    climbRemainingMeters: 840,
    climbRemainingFeet: 2756,
    climbCompletedPercent: 0,
    estimatedSeconds: 3600,
    estimatedTimeFormatted: '1h 00m',
    hikeBikeDistanceKm: 2.0,
    hikeBikeDistanceMiles: 1.2,
    hikeBikeDistanceMeters: 2000,
    hikeBikeSeconds: 1200,
    hikeBikeTimeFormatted: '20m',
    miniProfile: {
      linePathD: 'M 0 30 L 50 10 L 100 5',
      areaPathD: 'M 0 30 L 50 10 L 100 5 L 100 36 L 0 36 Z',
      startPoint: { x: 0, y: 30 },
      endPoint: { x: 100, y: 36 },
      summitPoint: { x: 100, y: 5 },
      riderDot: { x: 50, y: 10 },
      thunderstormHazardPoint: { x: 75, y: 8 },
      gradientStops: [
        { offset: '0%', color: '#10b981' },
        { offset: '100%', color: '#f59e0b' }
      ],
      width: 100
    },
    climbWeather: {
      climbId: 'climb-1',
      climbName: 'Reddish Knob Ascent',
      hasThunderstormHazard: true,
      thunderstormHazard: {
        hasHazard: true,
        earliestKm: 5,
        latestKm: 10,
        estimatedTimeFormatted: '15:30',
        estimatedArrivalTimestamp: 1726005000,
        weatherCode: 95,
        severity: 'severe',
        message: 'Severe thunderstorms forecasted during summit window',
        summitAffected: true
      },
      summitWeather: {
        climbKm: 8,
        routeKm: 93.3,
        routeMile: 58.0,
        lat: 45.0,
        lon: -110.0,
        elevationM: 1340,
        elevationFt: 4396,
        estimatedArrivalSeconds: 7200,
        estimatedArrivalTimestamp: 1726007200,
        estimatedArrivalFormatted: '16:00',
        weatherAtArrival: {
          tempC: 14,
          tempF: 57,
          precipitationMm: 5.0,
          precipitationInches: 0.2,
          windSpeedKmh: 35,
          windSpeedMph: 22,
          windDirectionDeg: 270,
          windCardinal: 'W',
          weatherCode: 95,
          weatherDescription: 'Severe Thunderstorm',
          weatherIcon: '⚡',
          isThunderstorm: true
        }
      },
      baseWeather: {
        climbKm: 0,
        routeKm: 80.5,
        routeMile: 50.0,
        lat: 45.0,
        lon: -110.0,
        elevationM: 500,
        elevationFt: 1640,
        estimatedArrivalSeconds: 3600,
        estimatedArrivalTimestamp: 1726003600,
        estimatedArrivalFormatted: '15:00',
        weatherAtArrival: {
          tempC: 22,
          tempF: 72,
          precipitationMm: 0,
          precipitationInches: 0,
          windSpeedKmh: 15,
          windSpeedMph: 9,
          windDirectionDeg: 180,
          windCardinal: 'S',
          weatherCode: 0,
          weatherDescription: 'Clear',
          weatherIcon: '☀️',
          isThunderstorm: false
        }
      },
      kmPoints: [],
      estimatedStartTimestamp: 1726003600,
      estimatedSummitTimestamp: 1726007200,
      estimatedStartTimeFormatted: '15:00',
      estimatedSummitTimeFormatted: '16:00'
    }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClimbCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ClimbCardComponent);
    component = fixture.componentInstance;
  });

  it('should create the climb card component', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render UPCOMING, CURRENT CLIMB (with pulse), or PASSED status badge', () => {
    fixture.componentRef.setInput('climb', { ...baseClimb, status: 'upcoming' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('UPCOMING');

    fixture.componentRef.setInput('climb', { ...baseClimb, status: 'climbing' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('CURRENT CLIMB');

    fixture.componentRef.setInput('climb', { ...baseClimb, status: 'passed' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('PASSED');
  });

  it('should render ICONIC PASS badge when climb.isIconic is true', () => {
    fixture.componentRef.setInput('climb', { ...baseClimb, isIconic: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ICONIC PASS');

    fixture.componentRef.setInput('climb', { ...baseClimb, isIconic: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('ICONIC PASS');
  });

  it('should render difficulty badge with correct severity color classes', () => {
    fixture.componentRef.setInput('climb', { ...baseClimb, difficulty: 'extreme' });
    fixture.detectChanges();
    const extremeBadge = fixture.nativeElement.querySelector('.bg-rose-950');
    expect(extremeBadge?.textContent).toContain('extreme');

    fixture.componentRef.setInput('climb', { ...baseClimb, difficulty: 'moderate' });
    fixture.detectChanges();
    const modBadge = fixture.nativeElement.querySelector('.bg-yellow-950');
    expect(modBadge?.textContent).toContain('moderate');
  });

  it('should render miniature SVG sparkline profile with line and area paths', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg[aria-label="Miniature climb profile"]');
    expect(svg).toBeTruthy();
    const paths = svg.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });

  it('should render active rider position dot on sparkline when status is climbing', () => {
    fixture.componentRef.setInput('climb', { ...baseClimb, status: 'climbing' });
    fixture.detectChanges();
    const pingDot = fixture.nativeElement.querySelector('circle.animate-ping');
    expect(pingDot).toBeTruthy();
  });

  it('should render thunderstorm hazard ping indicator and alert banner when weather hazard is present', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Thunderstorm Hazard at Arrival');
  });

  it('should render geographic context tags (trailName, parkName, landmark)', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Briery Branch Gap');
    expect(text).toContain('George Washington National Forest');
    expect(text).toContain('Reddish Knob Tower');
  });

  it('should render guidebook notes with word-break styling', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Steep gravel ascent leading to summit vista.');
  });

  it('should display estimated time and hike-a-bike stats in power mode', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.componentRef.setInput('isPowerMode', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Est. hike-a-bike:');
    expect(fixture.nativeElement.textContent).toContain('1.2 mi');
  });

  it('should hide hike-a-bike stats when isPowerMode is false', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.componentRef.setInput('isPowerMode', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Est. hike-a-bike:');
  });

  it('should emit toggleWeatherBreakdown with climb.id on breakdown button click', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();

    let toggledId = '';
    component.toggleWeatherBreakdown.subscribe((id) => (toggledId = id));

    const btn = fixture.nativeElement.querySelector('button.cursor-pointer.text-emerald-400') as HTMLButtonElement;
    btn.click();
    expect(toggledId).toBe('climb-1');
  });

  it('should embed ClimbWeatherBreakdownComponent when isWeatherExpanded is true', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.componentRef.setInput('isWeatherExpanded', true);
    fixture.detectChanges();
    const breakdown = fixture.nativeElement.querySelector('app-climb-weather-breakdown');
    expect(breakdown).toBeTruthy();
  });

  it('should emit jumpToMile with startMile for Base and endMile for Summit', () => {
    fixture.componentRef.setInput('climb', baseClimb);
    fixture.detectChanges();

    const jumps: number[] = [];
    component.jumpToMile.subscribe((m) => jumps.push(m));

    const buttons = fixture.nativeElement.querySelectorAll('button');
    const baseBtn = Array.from(buttons).find((b: any) => b.textContent.includes('Base')) as HTMLButtonElement;
    const summitBtn = Array.from(buttons).find((b: any) => b.textContent.includes('Summit')) as HTMLButtonElement;

    baseBtn.click();
    summitBtn.click();

    expect(jumps).toEqual([50.0, 58.0]);
  });
});
