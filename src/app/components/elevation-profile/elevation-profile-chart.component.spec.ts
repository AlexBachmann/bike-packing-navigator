import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ElevationProfileChartComponent,
  VisiblePassMarker,
  RiderSvgPosition,
  ChartElevationStats,
  ActiveProfileWindow
} from './elevation-profile-chart.component';
import { ElevationScrubData } from '../../models/elevation.model';

describe('ElevationProfileChartComponent', () => {
  let component: ElevationProfileChartComponent;
  let fixture: ComponentFixture<ElevationProfileChartComponent>;

  const mockStats: ChartElevationStats = {
    minMeters: 500,
    maxMeters: 1500,
    minFeet: 1640,
    maxFeet: 4921,
    gainMeters: 1200,
    gainFeet: 3937
  };

  const mockWindow: ActiveProfileWindow = {
    start: 20,
    end: 80
  };

  const mockPasses: VisiblePassMarker[] = [
    {
      id: 'pass-1',
      name: 'Reddish Pass',
      state: 'VA',
      routeMile: 55.0,
      routeKm: 88.5,
      elevationMeters: 1340,
      elevationFeet: 4396,
      lat: 38.3,
      lon: -79.2,
      difficulty: 'difficult',
      notes: 'Pass notes',
      svgX: 400,
      svgY: 80
    }
  ];

  const mockRider: RiderSvgPosition = {
    x: 350,
    y: 120,
    eleFeet: 3200,
    eleMeters: 975
  };

  const mockScrub: ElevationScrubData = {
    routeMile: 60.5,
    routeKm: 97.4,
    elevationMeters: 1100,
    elevationFeet: 3609,
    gradePercent: 7.5,
    distanceAheadMiles: 5.5,
    distanceAheadKm: 8.9
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ElevationProfileChartComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ElevationProfileChartComponent);
    component = fixture.componentInstance;
  });

  it('should create the elevation profile chart component', () => {
    expect(component).toBeTruthy();
  });

  it('should render SVG canvas with viewBox attributes matching svgWidth and svgHeight inputs', () => {
    fixture.componentRef.setInput('svgWidth', 900);
    fixture.componentRef.setInput('svgHeight', 300);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 900 300');
  });

  it('should render elevation area fill and gradient slope line paths', () => {
    fixture.componentRef.setInput('areaPathD', 'M 0 0 L 100 100 Z');
    fixture.componentRef.setInput('linePathD', 'M 0 0 L 100 100');
    fixture.detectChanges();

    const paths = fixture.nativeElement.querySelectorAll('svg path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('d')).toBe('M 0 0 L 100 100 Z');
    expect(paths[1].getAttribute('d')).toBe('M 0 0 L 100 100');
  });

  it('should render horizontal and vertical gridlines with elevation labels from chartStats', () => {
    fixture.componentRef.setInput('chartStats', mockStats);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain("4921'");
    expect(text).toContain("1640'");

    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    const kmText = fixture.nativeElement.textContent;
    expect(kmText).toContain('1500m');
    expect(kmText).toContain('500m');
  });

  it('should render distance axis labels according to activeWindow and unit', () => {
    fixture.componentRef.setInput('activeWindow', mockWindow);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    let text = fixture.nativeElement.textContent;
    expect(text).toContain('Mi 20');
    expect(text).toContain('Mi 80');

    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    text = fixture.nativeElement.textContent;
    expect(text).toContain('KM 32');
    expect(text).toContain('KM 129');
  });

  it('should render mountain pass markers on curve and emit jumpToMile on click', () => {
    fixture.componentRef.setInput('visiblePasses', mockPasses);
    fixture.detectChanges();

    let jumpedMile = 0;
    component.jumpToMile.subscribe((m) => (jumpedMile = m));

    const passEl = fixture.nativeElement.querySelector('g.group');
    expect(passEl).toBeTruthy();
    expect(passEl.textContent).toContain('▲ Reddish Pass');

    passEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(jumpedMile).toBe(55.0);
  });

  it('should render rider location indicator and pulsing dot at riderSvgPos', () => {
    fixture.componentRef.setInput('riderSvgPos', mockRider);
    fixture.detectChanges();

    const pingCircle = fixture.nativeElement.querySelector('circle.animate-ping');
    expect(pingCircle).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('🚴 YOU');
  });

  it('should render interactive crosshair lines at scrubX and scrubY', () => {
    fixture.componentRef.setInput('scrubX', 250);
    fixture.componentRef.setInput('scrubY', 100);
    fixture.detectChanges();

    const scrubDot = fixture.nativeElement.querySelector('circle[fill="#38bdf8"]');
    expect(scrubDot).toBeTruthy();
    expect(scrubDot?.getAttribute('cx')).toBe('250');
    expect(scrubDot?.getAttribute('cy')).toBe('100');
  });

  it('should render scrub tooltip HUD with altitude, distance ahead, and grade badge', () => {
    fixture.componentRef.setInput('scrubData', mockScrub);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    const hud = fixture.nativeElement.querySelector('[data-testid="scrub-hud"]');
    expect(hud).toBeTruthy();
    expect(hud.textContent).toContain('Mi 60.5');
    expect(hud.textContent).toContain('3,609 ft');
    expect(hud.textContent).toContain('+5.5 mi');
    expect(hud.textContent).toContain('+7.5%');
  });

  it('should position scrub tooltip on opposite side using popupSide input', () => {
    fixture.componentRef.setInput('scrubData', mockScrub);
    fixture.componentRef.setInput('popupSide', 'left');
    fixture.detectChanges();

    let hud = fixture.nativeElement.querySelector('[data-testid="scrub-hud"]');
    expect(hud.classList.contains('left-3')).toBe(true);

    fixture.componentRef.setInput('popupSide', 'right');
    fixture.detectChanges();

    hud = fixture.nativeElement.querySelector('[data-testid="scrub-hud"]');
    expect(hud.classList.contains('right-3')).toBe(true);
  });

  it('should emit clearScrub when close button on HUD is clicked', () => {
    fixture.componentRef.setInput('scrubData', mockScrub);
    fixture.detectChanges();

    let cleared = false;
    component.clearScrub.subscribe((c) => (cleared = c));

    const closeBtn = fixture.nativeElement.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    closeBtn.click();
    expect(cleared).toBe(true);
  });

  it('should emit jumpToMile when Jump Rider Here button is clicked', () => {
    fixture.componentRef.setInput('scrubData', mockScrub);
    fixture.detectChanges();

    let jumped = 0;
    component.jumpToMile.subscribe((m) => (jumped = m));

    const jumpBtn = fixture.nativeElement.querySelector('[data-testid="jump-rider-btn"]') as HTMLButtonElement;
    jumpBtn.click();
    expect(jumped).toBe(60.5);
  });

  it('should emit chartMouseMove, chartClick, chartTouchStart, chartTouchMove, chartMouseLeave', () => {
    const container = fixture.nativeElement.querySelector('[data-testid="svg-canvas-container"]') as HTMLElement;

    let mouseMoved = false;
    let clicked = false;
    let touchStarted = false;
    let touchMoved = false;
    let mouseLeft = false;

    component.chartMouseMove.subscribe(() => (mouseMoved = true));
    component.chartClick.subscribe(() => (clicked = true));
    component.chartTouchStart.subscribe(() => (touchStarted = true));
    component.chartTouchMove.subscribe(() => (touchMoved = true));
    component.chartMouseLeave.subscribe(() => (mouseLeft = true));

    container.dispatchEvent(new MouseEvent('mousemove'));
    container.dispatchEvent(new MouseEvent('click'));
    container.dispatchEvent(new TouchEvent('touchstart'));
    container.dispatchEvent(new TouchEvent('touchmove'));
    container.dispatchEvent(new MouseEvent('mouseleave'));

    expect(mouseMoved).toBe(true);
    expect(clicked).toBe(true);
    expect(touchStarted).toBe(true);
    expect(touchMoved).toBe(true);
    expect(mouseLeft).toBe(true);
  });
});
