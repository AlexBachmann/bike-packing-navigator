import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RideSimulatorModalComponent } from './ride-simulator-modal.component';

describe('RideSimulatorModalComponent Unit Tests', () => {
  let component: RideSimulatorModalComponent;
  let fixture: ComponentFixture<RideSimulatorModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RideSimulatorModalComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RideSimulatorModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should not render modal when isOpen is false', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('[data-testid="simulator-modal"]');
    expect(modal).toBeNull();
  });

  it('2. should render modal dialog when isOpen is true', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('[data-testid="simulator-modal"]');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('GPS Simulator');
  });

  it('3. should emit toggleOpen when modal close button (✕) is clicked', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const spy = vi.fn();
    component.toggleOpen.subscribe(spy);

    const closeBtn = fixture.nativeElement.querySelector('button[aria-label="Close GPS Simulator modal"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('4. should bind speed input value and emit clamped speedChange on user input', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('speed', 25);
    fixture.detectChanges();

    const speedInput = fixture.nativeElement.querySelector('[data-testid="sim-speed-input"]') as HTMLInputElement;
    expect(speedInput.value).toBe('25');

    const spy = vi.fn();
    component.speedChange.subscribe(spy);

    // Normal change
    speedInput.value = '35';
    speedInput.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(35);

    // High speed input without upper limit
    speedInput.value = '250';
    speedInput.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(250);

    // Clamping low (< 0)
    speedInput.value = '-10';
    speedInput.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('5. should adjust speed by -5 and +5 when clicking +/- 5 buttons', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('speed', 20);
    fixture.detectChanges();

    const spy = vi.fn();
    component.speedChange.subscribe(spy);

    const minus5Btn = fixture.nativeElement.querySelector('[data-testid="sim-speed-minus-5"]') as HTMLButtonElement;
    expect(minus5Btn).toBeTruthy();
    minus5Btn.click();
    expect(spy).toHaveBeenCalledWith(15);

    const plus5Btn = fixture.nativeElement.querySelector('[data-testid="sim-speed-plus-5"]') as HTMLButtonElement;
    expect(plus5Btn).toBeTruthy();
    plus5Btn.click();
    expect(spy).toHaveBeenCalledWith(25);
  });

  it('6. should adjust speed by -25 and +25 without upper limit and clamped at 0', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('speed', 15);
    fixture.detectChanges();

    const spy = vi.fn();
    component.speedChange.subscribe(spy);

    // Speed is 15: clicking -25 should clamp to 0
    const minus25Btn = fixture.nativeElement.querySelector('[data-testid="sim-speed-minus-25"]') as HTMLButtonElement;
    expect(minus25Btn).toBeTruthy();
    minus25Btn.click();
    expect(spy).toHaveBeenCalledWith(0);

    // Speed is 120: clicking +25 should increase to 145 without upper bound
    fixture.componentRef.setInput('speed', 120);
    fixture.detectChanges();

    const plus25Btn = fixture.nativeElement.querySelector('[data-testid="sim-speed-plus-25"]') as HTMLButtonElement;
    expect(plus25Btn).toBeTruthy();
    plus25Btn.click();
    expect(spy).toHaveBeenCalledWith(145);
  });


  it('7. should render Play button in idle state and emit togglePlay', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('isRunning', false);
    fixture.detectChanges();

    const playStopBtn = fixture.nativeElement.querySelector('[data-testid="sim-play-stop-btn"]') as HTMLButtonElement;
    expect(playStopBtn.textContent).toContain('Play');
    expect(playStopBtn.classList.contains('bg-emerald-500')).toBe(true);

    const spy = vi.fn();
    component.togglePlay.subscribe(spy);
    playStopBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('8. should render Stop button in running state with rose color and emit togglePlay', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('isRunning', true);
    fixture.detectChanges();

    const playStopBtn = fixture.nativeElement.querySelector('[data-testid="sim-play-stop-btn"]') as HTMLButtonElement;
    expect(playStopBtn.textContent).toContain('Stop');
    expect(playStopBtn.classList.contains('bg-rose-500')).toBe(true);

    const spy = vi.fn();
    component.togglePlay.subscribe(spy);
    playStopBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('9. should render Reset button and emit reset on click', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('isRunning', false);
    fixture.detectChanges();

    const resetBtn = fixture.nativeElement.querySelector('[data-testid="sim-reset-btn"]') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();

    const spy = vi.fn();
    component.reset.subscribe(spy);
    resetBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

