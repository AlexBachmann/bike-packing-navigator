import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RideClimbMiniWidgetComponent,
  ActiveClimbStatus
} from './ride-climb-mini-widget.component';

describe('RideClimbMiniWidgetComponent Unit Tests', () => {
  let component: RideClimbMiniWidgetComponent;
  let fixture: ComponentFixture<RideClimbMiniWidgetComponent>;

  const mockClimbStatus: ActiveClimbStatus = {
    climbId: 'climb-101',
    name: 'Roxborough Ascent',
    remainingMiles: 0.4,
    remainingKm: 0.64,
    remainingFormatted: '0.4 mi left',
    gradePercent: 7.2,
    progressPercent: 65,
    miniProfile: {
      width: 140,
      areaPathD: 'M 0 36 L 0 20 L 70 10 L 140 5 L 140 36 Z',
      linePathD: 'M 0 20 L 70 10 L 140 5',
      startPoint: { x: 0, y: 20 },
      endPoint: { x: 140, y: 15 },
      summitPoint: { x: 140, y: 5 },
      riderDot: { x: 91, y: 8 },
      gradientStops: [
        { offset: '0%', color: '#10b981' },
        { offset: '50%', color: '#f59e0b' },
        { offset: '100%', color: '#ef4444' }
      ]
    }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RideClimbMiniWidgetComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RideClimbMiniWidgetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should create and not render widget when climbStatus is null', () => {
    expect(component).toBeTruthy();
    expect(component.climbStatus()).toBeNull();
    const widget = fixture.nativeElement.querySelector('[data-testid="climb-mini-widget"]');
    expect(widget).toBeNull();
  });

  it('2. should render climb header with name, grade, and remaining distance', () => {
    fixture.componentRef.setInput('climbStatus', mockClimbStatus);
    fixture.detectChanges();

    const widget = fixture.nativeElement.querySelector('[data-testid="climb-mini-widget"]');
    expect(widget).toBeTruthy();
    expect(widget.textContent).toContain('⛰️');
    expect(widget.textContent).toContain('Roxborough Ascent');
    expect(widget.textContent).toContain('7.2% avg');
    expect(widget.textContent).toContain('0.4 mi left');
  });

  it('3. should render SVG paths, linear gradients, start anchor and summit dots', () => {
    fixture.componentRef.setInput('climbStatus', mockClimbStatus);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 140 36');
    expect(svg.getAttribute('aria-label')).toBe('Miniature climb profile');

    const defs = svg.querySelector('defs');
    expect(defs).toBeTruthy();
    const slopeGrad = defs.querySelector('#rideMiniSlopeGrad-climb-101');
    const areaGrad = defs.querySelector('#rideMiniAreaGrad-climb-101');
    expect(slopeGrad).toBeTruthy();
    expect(areaGrad).toBeTruthy();

    const paths = svg.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('d')).toBe(mockClimbStatus.miniProfile.areaPathD);
    expect(paths[1].getAttribute('d')).toBe(mockClimbStatus.miniProfile.linePathD);

    const circles = svg.querySelectorAll('circle');
    // startPoint (1) + summitPoint (1) + riderDot (ping + solid = 2) = 4 circles
    expect(circles.length).toBe(4);
  });

  it('4. should render animated riderDot guideline and ping circle when riderDot exists', () => {
    fixture.componentRef.setInput('climbStatus', mockClimbStatus);
    fixture.detectChanges();

    const line = fixture.nativeElement.querySelector('line');
    expect(line).toBeTruthy();
    expect(line.getAttribute('x1')).toBe('91');
    expect(line.getAttribute('stroke-dasharray')).toBe('1.5,1.5');

    const pingCircle = fixture.nativeElement.querySelector('.animate-ping');
    expect(pingCircle).toBeTruthy();
  });

  it('5. should omit rider guideline and dot when riderDot is null', () => {
    const climbWithoutRider: ActiveClimbStatus = {
      ...mockClimbStatus,
      miniProfile: {
        ...mockClimbStatus.miniProfile,
        riderDot: null
      }
    };
    fixture.componentRef.setInput('climbStatus', climbWithoutRider);
    fixture.detectChanges();

    const line = fixture.nativeElement.querySelector('line');
    expect(line).toBeNull();
    const pingCircle = fixture.nativeElement.querySelector('.animate-ping');
    expect(pingCircle).toBeNull();

    const circles = fixture.nativeElement.querySelectorAll('circle');
    // startPoint + summitPoint = 2
    expect(circles.length).toBe(2);
  });
});
