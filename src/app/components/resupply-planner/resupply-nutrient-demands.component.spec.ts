import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResupplyNutrientDemandsComponent } from './resupply-nutrient-demands.component';
import { DayScheduleSummary, NutrientTargets } from '../../models/resupply.model';

describe('ResupplyNutrientDemandsComponent', () => {
  let component: ResupplyNutrientDemandsComponent;
  let fixture: ComponentFixture<ResupplyNutrientDemandsComponent>;

  const mockSchedule: DayScheduleSummary = {
    ridingHours: 6.5,
    sleepHours: 6.0,
    prepWakeHours: 1.0,
    daytimeOffBikeHours: 1.5,
    totalElapsedHours: 15.0,
    sleepCyclesCount: 1,
    arrivalHour: 23.0,
    arrivesAfterNightfall: true
  };

  const mockTargets: NutrientTargets = {
    baseCalories: 3000,
    safetyBufferCalories: 450,
    safetyBufferPercent: 15,
    userAdjustmentCalories: 0,
    totalCaloriesTarget: 3450,
    carbsTargetGrams: 474,
    proteinTargetGrams: 129,
    fatTargetGrams: 115,
    sodiumTargetMg: 4200,
    potassiumTargetMg: 2800,
    magnesiumTargetMg: 450,
    fluidsTargetMl: 4500
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResupplyNutrientDemandsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ResupplyNutrientDemandsComponent);
    component = fixture.componentInstance;
  });

  function setStandardInputs() {
    fixture.componentRef.setInput('dailyRidingPercent', 60);
    fixture.componentRef.setInput('targetSleepHours', 6.0);
    fixture.componentRef.setInput('dayScheduleSummary', mockSchedule);
    fixture.componentRef.setInput('nutrientTargets', mockTargets);
    fixture.componentRef.setInput('safetyBufferPercent', 15);
    fixture.componentRef.setInput('riderPowerWatts', 165);
    fixture.componentRef.setInput('totalSystemMassKg', 85);
    fixture.componentRef.setInput('displaySpeed', '14.2');
    fixture.componentRef.setInput('speedUnit', 'mph');
    fixture.detectChanges();
  }

  it('should create the component', () => {
    setStandardInputs();
    expect(component).toBeTruthy();
  });

  it('should render rider physics context', () => {
    setStandardInputs();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('165 W');
    expect(text).toContain('85 kg');
    expect(text).toContain('14.2 mph');
    expect(text).toContain('6.5h');
  });

  it('should emit ridingPercentChange when range slider changes', () => {
    setStandardInputs();
    let emitted = 0;
    component.ridingPercentChange.subscribe((v) => (emitted = v));

    const slider = fixture.nativeElement.querySelector('input[aria-label="Daily Riding Percentage"]') as HTMLInputElement;
    slider.value = '70';
    slider.dispatchEvent(new Event('input'));
    expect(emitted).toBe(70);
  });

  it('should emit sleepHoursChange when sleep range slider changes', () => {
    setStandardInputs();
    let emitted = 0;
    component.sleepHoursChange.subscribe((v) => (emitted = v));

    const slider = fixture.nativeElement.querySelector('input[aria-label="Target Sleep Hours"]') as HTMLInputElement;
    slider.value = '7.5';
    slider.dispatchEvent(new Event('input'));
    expect(emitted).toBe(7.5);
  });

  it('should render nightfall warning badge when arrivesAfterNightfall is true', () => {
    setStandardInputs();
    expect(fixture.nativeElement.textContent).toContain('Nightfall Trigger Active');

    fixture.componentRef.setInput('dayScheduleSummary', { ...mockSchedule, arrivesAfterNightfall: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Nightfall Trigger Active');
  });

  it('should render needed calories target with data-testid', () => {
    setStandardInputs();
    const display = fixture.nativeElement.querySelector('[data-testid="needed-calories-display"]');
    expect(display).toBeDefined();
    expect(display.textContent).toContain('3,450');
  });

  it('should emit adjustBufferPercent when buffer decrement or increment button is clicked', () => {
    setStandardInputs();
    const deltas: number[] = [];
    component.adjustBufferPercent.subscribe((d) => deltas.push(d));

    const decBtn = fixture.nativeElement.querySelector('[data-testid="buffer-decrement-btn"]') as HTMLButtonElement;
    const incBtn = fixture.nativeElement.querySelector('[data-testid="buffer-increment-btn"]') as HTMLButtonElement;

    decBtn.click();
    incBtn.click();

    expect(deltas).toEqual([-5, 5]);
  });

  it('should display correct buffer label based on safetyBufferPercent', () => {
    setStandardInputs();
    const display = fixture.nativeElement.querySelector('[data-testid="buffer-setting-display"]');
    expect(display.textContent).toContain('Safety Buffer');

    fixture.componentRef.setInput('safetyBufferPercent', -10);
    fixture.detectChanges();
    expect(display.textContent).toContain('Deficit Buffer');

    fixture.componentRef.setInput('safetyBufferPercent', 0);
    fixture.detectChanges();
    expect(display.textContent).toContain('Buffer');
  });

  it('should render multi-nutrient targets grid values', () => {
    setStandardInputs();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('474 g'); // carbs
    expect(text).toContain('129 g'); // protein
    expect(text).toContain('115 g'); // fat
    expect(text).toContain('4200 mg'); // sodium
    expect(text).toContain('4.5 L'); // hydration
  });
});
