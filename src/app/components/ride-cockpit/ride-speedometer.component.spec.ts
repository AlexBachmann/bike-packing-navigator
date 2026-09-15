import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { RideSpeedometerComponent } from './ride-speedometer.component';

describe('RideSpeedometerComponent Unit Tests', () => {
  let component: RideSpeedometerComponent;
  let fixture: ComponentFixture<RideSpeedometerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RideSpeedometerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RideSpeedometerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('speedValue', '24');
    fixture.componentRef.setInput('speedUnit', 'km/h');
    fixture.componentRef.setInput('speedText', '24 km/h');
    fixture.detectChanges();
  });

  it('1. should create and render speedometer widget with metric values', () => {
    expect(component).toBeTruthy();
    const widget = fixture.nativeElement.querySelector('[data-testid="speedometer-widget"]');
    expect(widget).toBeTruthy();

    const speedVal = fixture.nativeElement.querySelector('[data-testid="speed-value"]');
    const speedUnit = fixture.nativeElement.querySelector('[data-testid="speed-unit"]');
    const speedText = fixture.nativeElement.querySelector('[data-testid="speed-text"]');

    expect(speedVal.textContent.trim()).toBe('24');
    expect(speedUnit.textContent.trim()).toBe('km/h');
    expect(speedText.textContent.trim()).toBe('24 km/h');
    expect(speedText.classList.contains('sr-only')).toBe(true);
  });

  it('2. should render imperial speed value and unit', () => {
    fixture.componentRef.setInput('speedValue', '15.0');
    fixture.componentRef.setInput('speedUnit', 'mph');
    fixture.componentRef.setInput('speedText', '15.0 mph');
    fixture.detectChanges();

    const speedVal = fixture.nativeElement.querySelector('[data-testid="speed-value"]');
    const speedUnit = fixture.nativeElement.querySelector('[data-testid="speed-unit"]');
    const speedText = fixture.nativeElement.querySelector('[data-testid="speed-text"]');

    expect(speedVal.textContent.trim()).toBe('15.0');
    expect(speedUnit.textContent.trim()).toBe('mph');
    expect(speedText.textContent.trim()).toBe('15.0 mph');
  });

  it('3. should render SPEED uppercase header label', () => {
    const header = fixture.nativeElement.querySelector('span.text-\\[9px\\]');
    expect(header).toBeTruthy();
    expect(header.textContent).toContain('Speed');
  });
});
