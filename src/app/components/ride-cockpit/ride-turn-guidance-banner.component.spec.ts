import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RideTurnGuidanceBannerComponent,
  getTurnIcon
} from './ride-turn-guidance-banner.component';
import { TurnCue } from '../../models/ride-cockpit.model';

describe('RideTurnGuidanceBannerComponent Unit Tests', () => {
  let component: RideTurnGuidanceBannerComponent;
  let fixture: ComponentFixture<RideTurnGuidanceBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RideTurnGuidanceBannerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RideTurnGuidanceBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should create and not display chip when turnCue is null', () => {
    expect(component).toBeTruthy();
    expect(component.turnCue()).toBeNull();
    const chip = fixture.nativeElement.querySelector('[data-testid="turn-ahead-chip"]');
    expect(chip).toBeNull();
  });

  it('2. should display chip when turnCue is provided', () => {
    const cue: TurnCue = {
      direction: 'right',
      distanceMeters: 140,
      displayText: 'Turn right in 153 yards'
    };
    fixture.componentRef.setInput('turnCue', cue);
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('[data-testid="turn-ahead-chip"]');
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('role')).toBe('status');
    expect(chip.getAttribute('aria-live')).toBe('polite');
    expect(chip.textContent).toContain('Turn right in 153 yards');
    expect(chip.textContent).toContain('➡️');
  });

  it('3. should map all turn directions to proper arrows via getTurnIcon', () => {
    expect(getTurnIcon('slight-left')).toBe('↖️');
    expect(getTurnIcon('left')).toBe('⬅️');
    expect(getTurnIcon('sharp-left')).toBe('↙️');
    expect(getTurnIcon('slight-right')).toBe('↗️');
    expect(getTurnIcon('right')).toBe('➡️');
    expect(getTurnIcon('sharp-right')).toBe('↘️');
    expect(getTurnIcon('straight' as any)).toBe('⬆️');
    expect(component.getTurnIcon('left')).toBe('⬅️');
  });

  it('4. should update dynamically when turnCue changes or clears', () => {
    fixture.componentRef.setInput('turnCue', {
      direction: 'sharp-left',
      distanceMeters: 50,
      displayText: 'Sharp left in 50 m'
    });
    fixture.detectChanges();

    let chip = fixture.nativeElement.querySelector('[data-testid="turn-ahead-chip"]');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('↙️');
    expect(chip.textContent).toContain('Sharp left in 50 m');

    fixture.componentRef.setInput('turnCue', null);
    fixture.detectChanges();

    chip = fixture.nativeElement.querySelector('[data-testid="turn-ahead-chip"]');
    expect(chip).toBeNull();
  });
});
