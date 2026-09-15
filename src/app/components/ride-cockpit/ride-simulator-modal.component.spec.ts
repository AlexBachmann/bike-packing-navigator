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

  it('1. should render FAB button with game controller icon in idle state', () => {
    const fab = fixture.nativeElement.querySelector('[data-testid="simulator-fab"]') as HTMLButtonElement;
    expect(fab).toBeTruthy();
    expect(fab.textContent).toContain('🎮');
    expect(fab.getAttribute('title')).toBe('Open GPS Simulator');
    expect(fab.classList.contains('bg-slate-900/90')).toBe(true);
  });

  it('2. should render FAB button with pulsing play icon in running state', () => {
    fixture.componentRef.setInput('isRunning', true);
    fixture.detectChanges();

    const fab = fixture.nativeElement.querySelector('[data-testid="simulator-fab"]') as HTMLButtonElement;
    expect(fab.textContent).toContain('▶️');
    expect(fab.getAttribute('title')).toBe('Simulator Running');
    expect(fab.classList.contains('bg-emerald-500')).toBe(true);
  });

  it('3. should emit toggleOpen when FAB button is clicked', () => {
    const spy = vi.fn();
    component.toggleOpen.subscribe(spy);

    const fab = fixture.nativeElement.querySelector('[data-testid="simulator-fab"]') as HTMLButtonElement;
    fab.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('4. should not render modal when isOpen is false', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('[data-testid="simulator-modal"]');
    expect(modal).toBeNull();
  });

  it('5. should render modal dialog when isOpen is true', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('[data-testid="simulator-modal"]');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('GPS Simulator');
  });

  it('6. should emit toggleOpen when modal close button (✕) is clicked', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const spy = vi.fn();
    component.toggleOpen.subscribe(spy);

    const closeBtn = fixture.nativeElement.querySelector('button[aria-label="Close GPS Simulator modal"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('7. should bind speed input value and emit clamped speedChange on user input', () => {
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

    // Clamping high (> 120)
    speedInput.value = '150';
    speedInput.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(120);

    // Clamping low (< 0)
    speedInput.value = '-10';
    speedInput.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('8. should render speed presets and emit presetSelect on click', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('speed', 15);
    fixture.componentRef.setInput('presets', [10, 15, 25, 45]);
    fixture.detectChanges();

    const presetButtons = fixture.nativeElement.querySelectorAll('button.text-\\[10px\\]');
    expect(presetButtons.length).toBe(4);

    // Check active preset highlight
    const activeBtn = Array.from(presetButtons).find((b: any) => b.textContent?.trim() === '15') as HTMLElement;
    expect(activeBtn.classList.contains('text-emerald-400')).toBe(true);

    const spy = vi.fn();
    component.presetSelect.subscribe(spy);

    const preset25Btn = Array.from(presetButtons).find((b: any) => b.textContent?.trim() === '25') as HTMLElement;
    preset25Btn.click();

    expect(spy).toHaveBeenCalledWith(25);
  });

  it('9. should render Play button in idle state and emit togglePlay', () => {
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

  it('10. should render Stop button in running state with rose color and emit togglePlay', () => {
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

  it('11. should render Reset button and emit reset on click', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const resetBtn = fixture.nativeElement.querySelector('[data-testid="sim-reset-btn"]') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();

    const spy = vi.fn();
    component.reset.subscribe(spy);
    resetBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('12. should support custom presets array input', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('presets', [5, 15, 25, 40]);
    fixture.detectChanges();

    const presetButtons = fixture.nativeElement.querySelectorAll('button.text-\\[10px\\]');
    const texts = Array.from(presetButtons).map((b: any) => b.textContent?.trim());
    expect(texts).toEqual(['5', '15', '25', '40']);
  });
});
