import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ElevationProfileComponent } from './elevation-profile.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { WeatherService } from '../../services/weather.service';

import { Climb, MountainPass } from '../../models/elevation.model';

const MOCK_CLIMBS: Climb[] = [
  {
    id: 'climb-1',
    name: 'Spray River Bench',
    state: 'AB',
    startMile: 3.7,
    endMile: 4.4,
    startKm: 5.9,
    endKm: 7.1,
    lengthMiles: 0.7,
    lengthKm: 1.2,
    startElevationMeters: 1414,
    summitElevationMeters: 1471,
    startElevationFeet: 4639,
    summitElevationFeet: 4826,
    elevationGainMeters: 57,
    elevationGainFeet: 187,
    avgGradePercent: 4.8,
    maxGradePercent: 6.5,
    isIconic: false,
    difficulty: 'moderate',
    trailName: 'Goat Creek Trail (TCT)',
    parkName: 'Banff National Park',
    landmark: 'Mount Rundle / Spray River',
    notes: 'Climbs away from the Bow Valley along the hardpacked doubletrack of the Goat Creek Trail within Banff National Park.'
  },
  {
    id: 'elk-pass',
    name: 'Elk Pass',
    state: 'BC/AB',
    startMile: 47.8,
    endMile: 48.2,
    startKm: 76.9,
    endKm: 77.5,
    lengthMiles: 0.4,
    lengthKm: 0.6,
    startElevationMeters: 1800,
    summitElevationMeters: 1930,
    startElevationFeet: 5905,
    summitElevationFeet: 6332,
    elevationGainMeters: 130,
    elevationGainFeet: 427,
    avgGradePercent: 6.8,
    maxGradePercent: 11.2,
    isIconic: true,
    difficulty: 'difficult'
  },
  {
    id: 'fleecer-ridge',
    name: 'Fleecer Ridge Summit',
    state: 'MT',
    startMile: 735.0,
    endMile: 739.1,
    startKm: 1182.8,
    endKm: 1189.4,
    lengthMiles: 4.1,
    lengthKm: 6.6,
    startElevationMeters: 1600,
    summitElevationMeters: 1880,
    startElevationFeet: 5249,
    summitElevationFeet: 6168,
    elevationGainMeters: 280,
    elevationGainFeet: 919,
    avgGradePercent: 8.5,
    maxGradePercent: 35.0,
    isIconic: true,
    difficulty: 'extreme'
  },
  {
    id: 'boreas-pass',
    name: 'Boreas Pass',
    state: 'CO',
    startMile: 1680.0,
    endMile: 1688.3,
    startKm: 2703.7,
    endKm: 2717.0,
    lengthMiles: 8.3,
    lengthKm: 13.3,
    startElevationMeters: 2900,
    summitElevationMeters: 3495,
    startElevationFeet: 9514,
    summitElevationFeet: 11467,
    elevationGainMeters: 595,
    elevationGainFeet: 1952,
    avgGradePercent: 4.5,
    maxGradePercent: 7.0,
    isIconic: true,
    difficulty: 'difficult'
  },
  {
    id: 'indiana-pass',
    name: 'Indiana Pass (Course High Point)',
    state: 'CO',
    startMile: 1940.0,
    endMile: 1947.9,
    startKm: 3122.0,
    endKm: 3134.8,
    lengthMiles: 7.9,
    lengthKm: 12.8,
    startElevationMeters: 2600,
    summitElevationMeters: 3537,
    startElevationFeet: 8530,
    summitElevationFeet: 11604,
    elevationGainMeters: 937,
    elevationGainFeet: 3074,
    avgGradePercent: 7.3,
    maxGradePercent: 12.0,
    isIconic: true,
    difficulty: 'extreme'
  },
  {
    id: 'climb-3',
    name: 'Gentle Valley Rise',
    state: 'BC',
    startMile: 55.0,
    endMile: 59.0,
    startKm: 88.5,
    endKm: 95.0,
    lengthMiles: 4.0,
    lengthKm: 6.5,
    startElevationMeters: 1200,
    summitElevationMeters: 1350,
    startElevationFeet: 3937,
    summitElevationFeet: 4429,
    elevationGainMeters: 150,
    elevationGainFeet: 492,
    avgGradePercent: 3.2,
    maxGradePercent: 5.0,
    isIconic: false,
    difficulty: 'moderate'
  }
];

const MOCK_PASSES: MountainPass[] = [
  {
    id: 'elk-pass',
    name: 'Elk Pass',
    state: 'BC/AB',
    routeMile: 48.0,
    routeKm: 77.2,
    elevationMeters: 1930,
    elevationFeet: 6332,
    lat: 50.598,
    lon: -115.086,
    difficulty: 'moderate',
    notes: 'Rocky climb along Kananaskis Lakes into British Columbia backcountry.'
  }
];

describe('ElevationProfileComponent', () => {
  let component: ElevationProfileComponent;
  let fixture: ComponentFixture<ElevationProfileComponent>;
  let mockRouteService: Partial<RouteDataService>;
  let settingsService: SettingsService;

  beforeEach(async () => {
    // Mock track points: [lat, lon, ele, km, mi]
    const sampleTrackPoints: [number, number, number, number, number][] = [
      [51.16, -115.56, 1400, 0.0, 0.0],
      [51.10, -115.50, 1500, 16.0, 10.0],
      [50.90, -115.35, 1750, 48.0, 30.0],
      [50.60, -115.08, 1930, 80.0, 50.0],
      [49.73, -114.88, 1150, 190.0, 118.0]
    ];

    mockRouteService = {
      activeRouteId: signal<string | null>('tour-divide-2025'),
      totalDistanceMiles: 2679.2,
      totalDistanceKm: 4311.8,
      trackPoints: signal(sampleTrackPoints),
      places: signal([]),
      climbs: signal(MOCK_CLIMBS),
      passes: signal(MOCK_PASSES)
    };

    await TestBed.configureTestingModule({
      imports: [ElevationProfileComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RouteDataService, useValue: mockRouteService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ElevationProfileComponent);
    component = fixture.componentInstance;
    settingsService = TestBed.inject(SettingsService);
    fixture.detectChanges();
  });

  it('should create the elevation profile component', () => {
    expect(component).toBeTruthy();
  });

  it('should calculate activeWindow correctly for different zoom modes', () => {
    fixture.componentRef.setInput('currentMile', 100);

    component.setZoom('next10');
    expect(component.activeWindow().start).toBe(99.5);
    expect(component.activeWindow().end).toBe(109.5);

    component.setZoom('next25');
    expect(component.activeWindow().start).toBe(99);
    expect(component.activeWindow().end).toBe(124);

    component.setZoom('next50');
    expect(component.activeWindow().start).toBe(98);
    expect(component.activeWindow().end).toBe(148);

    component.setZoom('next100');
    expect(component.activeWindow().start).toBe(95);
    expect(component.activeWindow().end).toBe(195);

    component.setZoom('full');
    expect(component.activeWindow().start).toBe(0);
    expect(component.activeWindow().end).toBe(2679.2);
  });

  it('should generate SVG path for elevation data in window', () => {
    fixture.componentRef.setInput('currentMile', 0);
    component.setZoom('next50');
    fixture.detectChanges();

    const points = component.chartPoints();
    expect(points.length).toBeGreaterThan(0);
    expect(component.linePathD()).toContain('M');
  });

  it('should emit selectMile when jumping to a mile', () => {
    let emittedMile: number | undefined;
    component.selectMile.subscribe((mile) => {
      emittedMile = mile;
    });

    component.jumpToMile(48.0);
    expect(emittedMile).toBe(48.0);
  });

  it('should calculate activeWindow and zoom distance correctly when unit is km', () => {
    fixture.componentRef.setInput('currentMile', 0);
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    component.setZoom('next10');
    const win10 = component.activeWindow();
    expect(win10.start).toBe(0);
    expect(win10.end * 1.60934).toBeCloseTo(10, 0);

    component.setZoom('next25');
    const win25 = component.activeWindow();
    expect(win25.start).toBe(0);
    expect(win25.end * 1.60934).toBeCloseTo(25, 0);

    component.setZoom('next50');
    const win50 = component.activeWindow();
    expect(win50.start).toBe(0);
    expect(win50.end * 1.60934).toBeCloseTo(50, 0);

    component.setZoom('next100');
    const win100 = component.activeWindow();
    expect(win100.start).toBe(0);
    expect(win100.end * 1.60934).toBeCloseTo(100, 0);

    component.setZoom('full');
    expect(component.activeWindow().start).toBe(0);
    expect(component.activeWindow().end).toBe(2679.2);
  });

  it('should render km labels, pass distances, and 10/25/50/100/All buttons in km mode', () => {
    fixture.componentRef.setInput('currentMile', 50);
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    // Zoom buttons should show 10 km, 25 km, 50 km, 100 km, All
    expect(compiled.textContent).toContain('10 km');
    expect(compiled.textContent).toContain('25 km');
    expect(compiled.textContent).toContain('50 km');
    expect(compiled.textContent).toContain('100 km');
    expect(compiled.textContent).toContain('All');
    expect(compiled.textContent).toContain('Window: KM');

    // Passes list check
    const passes = component.passesWithStatus();
    expect(passes.length).toBeGreaterThan(0);
    // Elk pass is at mile 48.0, rider is at 50.0 -> Elk pass is passed
    const elkPass = passes.find((p) => p.id === 'elk-pass');
    expect(elkPass).toBeDefined();
    expect(elkPass!.status).toBe('passed');
    expect(elkPass!.diffKm).toBeLessThan(0);
    // Elk pass summit in meters should be in DOM
    expect(compiled.textContent).toContain('1,930 m');
  });

  it('should identify iconic passes in the climb dataset', () => {
    expect(component.allClimbs.length).toBeGreaterThanOrEqual(4);
    const iconicClimbs = component.allClimbs.filter((c) => c.isIconic);
    expect(iconicClimbs.length).toBe(4);

    const iconicIds = iconicClimbs.map((c) => c.id);
    expect(iconicIds).toContain('elk-pass');
    expect(iconicIds).toContain('indiana-pass');
    expect(iconicIds).toContain('fleecer-ridge');
    expect(iconicIds).toContain('boreas-pass');
  });

  it('should calculate climb status correctly based on rider mileage', () => {
    // Elk pass is around startMile ~47.8, endMile ~48.2 (mile 48.0)
    const elk = component.allClimbs.find((c) => c.id === 'elk-pass')!;
    expect(elk).toBeDefined();

    // Rider before climb base
    fixture.componentRef.setInput('currentMile', elk.startMile - 5);
    fixture.detectChanges();
    let statusList = component.climbsWithStatus();
    let elkStatus = statusList.find((c) => c.id === 'elk-pass')!;
    expect(elkStatus.status).toBe('upcoming');
    expect(elkStatus.distanceToStartMiles).toBeCloseTo(5, 1);

    // Rider on climb
    fixture.componentRef.setInput('currentMile', (elk.startMile + elk.endMile) / 2);
    fixture.detectChanges();
    statusList = component.climbsWithStatus();
    elkStatus = statusList.find((c) => c.id === 'elk-pass')!;
    expect(elkStatus.status).toBe('climbing');
    expect(elkStatus.climbCompletedPercent).toBeGreaterThan(0);

    // Rider past summit
    fixture.componentRef.setInput('currentMile', elk.endMile + 10);
    fixture.detectChanges();
    statusList = component.climbsWithStatus();
    elkStatus = statusList.find((c) => c.id === 'elk-pass')!;
    expect(elkStatus.status).toBe('passed');
    expect(elkStatus.distanceAgoMiles).toBeCloseTo(10, 1);
  });

  it('should filter climbs by window, upcoming, and all', () => {
    fixture.componentRef.setInput('currentMile', 50);
    component.setZoom('next25'); // window ~ 49 to 74 miles
    fixture.detectChanges();

    // Window filter
    component.setClimbFilter('window');
    const windowClimbs = component.filteredClimbs();
    expect(windowClimbs.length).toBe(component.windowClimbsCount());

    // All filter
    component.setClimbFilter('all');
    expect(component.filteredClimbs().length).toBe(component.allClimbs.length);

    // Upcoming filter (currentMile = 50, should not include passed climbs from miles 0-40)
    component.setClimbFilter('upcoming');
    const upcoming = component.filteredClimbs();
    expect(upcoming.every((c) => c.status !== 'passed')).toBe(true);
  });

  it('should render climb cards with length, gain, grade, and jump buttons', () => {
    fixture.componentRef.setInput('currentMile', 0);
    component.setClimbFilter('all');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Upcoming Climbs');
    expect(compiled.textContent).toContain('In Window');
    expect(compiled.textContent).toContain('Avg Grade');
    expect(compiled.textContent).toContain('Base ↳');
    expect(compiled.textContent).toContain('Summit ↳');
  });

  it('should compute and display Estimated time on climb cards', () => {
    fixture.componentRef.setInput('currentMile', 0);
    component.setClimbFilter('all');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Estimated time:');
    const firstClimb = component.climbsWithStatus()[0];
    expect(firstClimb.estimatedSeconds).toBeGreaterThan(0);
    expect(firstClimb.estimatedTimeFormatted).toMatch(/\d+[mh]/);
  });

  it('should display "Estimated time remaining:" and remaining duration when rider is climbing', () => {
    const elk = component.allClimbs.find((c) => c.id === 'elk-pass')!;
    fixture.componentRef.setInput('currentMile', (elk.startMile + elk.endMile) / 2);
    component.setClimbFilter('all');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Estimated time remaining:');
    expect(compiled.textContent).toContain('left');
  });

  it('should display hike-a-bike stats in power mode and hide them in speed mode', () => {
    // In Power Mode
    settingsService.paceMode.set('power');
    fixture.componentRef.setInput('currentMile', 0);
    component.setClimbFilter('all');
    fixture.detectChanges();

    let compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Est. hike-a-bike:');

    // In Speed Mode
    settingsService.paceMode.set('speed');
    fixture.detectChanges();

    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).not.toContain('Est. hike-a-bike:');
  });

  it('should pin scrub data on click and position popup on opposite side', () => {
    fixture.componentRef.setInput('currentMile', 0);
    component.setZoom('next50');
    fixture.detectChanges();

    // Simulate click on right side of canvas (ratio = 0.8)
    const mockTarget = {
      getBoundingClientRect: () => ({ left: 0, width: 1000, top: 0, height: 240 })
    } as unknown as HTMLElement;

    const rightClickEvent = {
      currentTarget: mockTarget,
      clientX: 800
    } as unknown as MouseEvent;

    component.handleClick(rightClickEvent);
    expect(component.isPinned()).toBe(true);
    expect(component.scrubData()).not.toBeNull();
    expect(component.popupSide()).toBe('left');

    const pinnedMile = component.scrubData()!.routeMile;

    // Moving mouse across without button held down should NOT overwrite pinned data
    const hoverMoveEvent = {
      currentTarget: mockTarget,
      clientX: 200,
      buttons: 0
    } as unknown as MouseEvent;

    component.handleMouseMove(hoverMoveEvent);
    expect(component.scrubData()!.routeMile).toBe(pinnedMile);
    expect(component.popupSide()).toBe('left');

    // Leaving canvas should NOT clear pinned scrub data
    component.onMouseLeave();
    expect(component.scrubData()).not.toBeNull();

    // Simulate click on left side of canvas (ratio = 0.2)
    const leftClickEvent = {
      currentTarget: mockTarget,
      clientX: 200
    } as unknown as MouseEvent;

    component.handleClick(leftClickEvent);
    expect(component.popupSide()).toBe('right');

    // Explicit clear should unpin and remove scrub data
    component.clearScrub(true);
    expect(component.isPinned()).toBe(false);
    expect(component.scrubData()).toBeNull();
  });

  it('should unpin and clear scrub data when jumpToMile is executed', () => {
    component.scrubData.set({
      routeMile: 20.0,
      routeKm: 32.2,
      elevationMeters: 1628,
      elevationFeet: 5341,
      gradePercent: 14.5,
      distanceAheadMiles: 20.0,
      distanceAheadKm: 32.2
    });
    component.isPinned.set(true);

    component.jumpToMile(20.0);
    expect(component.isPinned()).toBe(false);
    expect(component.scrubData()).toBeNull();
  });

  it('should have type="button" on all rendered buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  it('should compute miniProfile with valid SVG paths and anchor points for climbs', () => {
    fixture.componentRef.setInput('currentMile', 0);
    fixture.detectChanges();

    const climbs = component.climbsWithStatus();
    expect(climbs.length).toBeGreaterThan(0);

    const firstClimb = climbs[0];
    expect(firstClimb.miniProfile).toBeDefined();
    expect(firstClimb.miniProfile?.linePathD).toMatch(/^M \d+(\.\d+)? \d+(\.\d+)? L/);
    expect(firstClimb.miniProfile?.areaPathD).toContain('Z');
    expect(firstClimb.miniProfile?.startPoint.x).toBe(2.5);
    expect(firstClimb.miniProfile?.width).toBeGreaterThanOrEqual(70);
    expect(firstClimb.miniProfile?.width).toBeLessThanOrEqual(150);
    expect(firstClimb.miniProfile?.endPoint.x).toBe((firstClimb.miniProfile?.width ?? 0) - 2.5);
    expect(firstClimb.miniProfile?.summitPoint).toBeDefined();
    expect(firstClimb.miniProfile?.gradientStops.length).toBeGreaterThan(0);
    expect(firstClimb.miniProfile?.riderDot).toBeNull();
  });

  it('should calculate active climbing riderDot when rider is on the climb', () => {
    // Banff climb spans miles 3.7 to 4.4
    fixture.componentRef.setInput('currentMile', 4.0);
    fixture.detectChanges();

    const climbs = component.climbsWithStatus();
    const climbing = climbs.find((c) => c.status === 'climbing');
    expect(climbing).toBeDefined();
    expect(climbing?.miniProfile).toBeDefined();
    expect(climbing?.miniProfile?.riderDot).not.toBeNull();
    expect(climbing?.miniProfile?.riderDot?.x).toBeGreaterThan(2.5);
    expect(climbing?.miniProfile?.riderDot?.x).toBeLessThan(climbing?.miniProfile?.endPoint.x ?? 150);
  });

  it('should scale miniature profile width inversely with climb average grade', () => {
    fixture.componentRef.setInput('currentMile', 0);
    fixture.detectChanges();

    const climbs = component.climbsWithStatus();
    const steepClimb = climbs.find((c) => c.avgGradePercent >= 6.0);
    const gentleClimb = climbs.find((c) => c.avgGradePercent <= 4.0);

    expect(steepClimb?.miniProfile).toBeDefined();
    expect(gentleClimb?.miniProfile).toBeDefined();
    if (steepClimb?.miniProfile && gentleClimb?.miniProfile) {
      expect(steepClimb.miniProfile.width).toBeLessThan(gentleClimb.miniProfile.width);
      expect(steepClimb.miniProfile.width).toBeGreaterThanOrEqual(70);
      expect(gentleClimb.miniProfile.width).toBeLessThanOrEqual(150);
    }
  });

  it('should render miniature elevation profile SVG inside climb cards in DOM', () => {
    fixture.componentRef.setInput('currentMile', 0);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const miniSvgs = el.querySelectorAll('svg[aria-label="Miniature climb profile"]');
    expect(miniSvgs.length).toBeGreaterThan(0);

    const firstSvg = miniSvgs[0];
    expect(firstSvg.querySelector('path')).toBeTruthy();
    expect(firstSvg.querySelector('circle')).toBeTruthy();
    expect(firstSvg.querySelector('linearGradient')).toBeTruthy();
  });

  it('should render arrival weather summary pill and toggle 1km breakdown drawer', () => {
    const weatherService = TestBed.inject(WeatherService);
    vi.spyOn(weatherService, 'getClimbForecast').mockImplementation(((climbId: string) => {
      if (climbId === 'climb-1') {
        return {
          climbId: 'climb-1',
          climbName: 'Climb out of Banff',
          hasThunderstormHazard: false,
          summitWeather: {
            climbKm: 1.2,
            routeKm: 7.1,
            routeMile: 4.4,
            lat: 51.15,
            lon: -115.55,
            elevationM: 1471,
            elevationFt: 4826,
            estimatedArrivalSeconds: 1800,
            estimatedArrivalTimestamp: Date.now() + 1800000,
            estimatedArrivalFormatted: '2:30 PM',
            weatherAtArrival: {
              tempC: 18,
              tempF: 64,
              precipitationMm: 0,
              precipitationInches: 0,
              windSpeedKmh: 12,
              windSpeedMph: 7.5,
              windDirectionDeg: 180,
              windCardinal: 'S',
              weatherCode: 0,
              weatherDescription: 'Clear sky',
              weatherIcon: '☀️',
              isThunderstorm: false
            }
          },
          baseWeather: {} as any,
          kmPoints: [
            {
              climbKm: 0,
              routeKm: 5.9,
              routeMile: 3.7,
              lat: 51.16,
              lon: -115.56,
              elevationM: 1414,
              elevationFt: 4639,
              estimatedArrivalSeconds: 1200,
              estimatedArrivalTimestamp: Date.now() + 1200000,
              estimatedArrivalFormatted: '2:20 PM',
              weatherAtArrival: {
                tempC: 19,
                tempF: 66,
                precipitationMm: 0,
                precipitationInches: 0,
                windSpeedKmh: 10,
                windSpeedMph: 6.2,
                windDirectionDeg: 180,
                windCardinal: 'S',
                weatherCode: 0,
                weatherDescription: 'Clear sky',
                weatherIcon: '☀️',
                isThunderstorm: false
              }
            }
          ],
          estimatedStartTimestamp: Date.now() + 1200000,
          estimatedSummitTimestamp: Date.now() + 1800000,
          estimatedStartTimeFormatted: '2:20 PM',
          estimatedSummitTimeFormatted: '2:30 PM'
        };
      }
      return null;
    }) as any);

    fixture.componentRef.setInput('currentMile', 0.5);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Summit at ETA');
    expect(el.textContent).toContain('Clear sky');
    expect(el.textContent).toContain('1 km weather breakdown');

    // Toggle drawer
    component.toggleClimbWeatherBreakdown('climb-1');
    fixture.detectChanges();
    expect(component.isClimbWeatherExpanded('climb-1')).toBe(true);
    expect(el.textContent).toContain('1 KM Interval Forecast');
  });

  it('should display severe thunderstorm hazard alert banner on climb card and mini profile indicator', () => {
    const weatherService = TestBed.inject(WeatherService);
    vi.spyOn(weatherService, 'getClimbForecast').mockImplementation(((climbId: string) => {
      if (climbId === 'climb-1') {
        return {
          climbId: 'climb-1',
          climbName: 'Climb out of Banff',
          hasThunderstormHazard: true,
          thunderstormHazard: {
            hasHazard: true,
            earliestKm: 1.0,
            latestKm: 1.2,
            estimatedTimeFormatted: '2:30 PM',
            estimatedArrivalTimestamp: Date.now() + 1800000,
            weatherCode: 95,
            severity: 'severe',
            message: 'Thunderstorm forecast at summit (KM 1.2, 1471m) around 2:30 PM',
            summitAffected: true
          },
          summitWeather: {
            climbKm: 1.2,
            routeKm: 7.1,
            routeMile: 4.4,
            lat: 51.15,
            lon: -115.55,
            elevationM: 1471,
            elevationFt: 4826,
            estimatedArrivalSeconds: 1800,
            estimatedArrivalTimestamp: Date.now() + 1800000,
            estimatedArrivalFormatted: '2:30 PM',
            weatherAtArrival: {
              tempC: 14,
              tempF: 57,
              precipitationMm: 12,
              precipitationInches: 0.47,
              windSpeedKmh: 45,
              windSpeedMph: 28,
              windDirectionDeg: 270,
              windCardinal: 'W',
              weatherCode: 95,
              weatherDescription: 'Thunderstorm',
              weatherIcon: '⛈️',
              isThunderstorm: true
            }
          },
          baseWeather: {} as any,
          kmPoints: [],
          estimatedStartTimestamp: Date.now() + 1200000,
          estimatedSummitTimestamp: Date.now() + 1800000,
          estimatedStartTimeFormatted: '2:20 PM',
          estimatedSummitTimeFormatted: '2:30 PM'
        };
      }
      return null;
    }) as any);

    fixture.componentRef.setInput('currentMile', 0.5);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Thunderstorm Hazard at Arrival');
    expect(el.textContent).toContain('High lightning exposure hazard above treeline');

    // Verify mini profile ⚡ indicator is rendered
    const miniSvgs = el.querySelectorAll('svg[aria-label="Miniature climb profile"]');
    const firstSvg = miniSvgs[0];
    expect(firstSvg.textContent).toContain('⚡');
  });

  it('should render enriched geographic context badges (trailName, parkName, landmark) and guidebook notes', () => {
    fixture.componentRef.setInput('currentMile', 0);
    component.setClimbFilter('all');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Spray River Bench');
    expect(el.textContent).toContain('Goat Creek Trail (TCT)');
    expect(el.textContent).toContain('Banff National Park');
    expect(el.textContent).toContain('Mount Rundle / Spray River');

    const notesBox = el.querySelector('.border-emerald-500\\/80');
    expect(notesBox).toBeTruthy();
    expect(notesBox?.textContent).toContain('Climbs away from the Bow Valley');
  });

  it('should render badges with flex-wrap and notes with break-words to support mobile viewports', () => {
    fixture.componentRef.setInput('currentMile', 0);
    component.setClimbFilter('all');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badgeContainer = el.querySelector('.flex-wrap.items-center.gap-x-2');
    expect(badgeContainer).toBeTruthy();

    const notesBox = el.querySelector('.border-emerald-500\\/80');
    expect(notesBox?.classList.contains('break-words')).toBe(true);
  });
});

