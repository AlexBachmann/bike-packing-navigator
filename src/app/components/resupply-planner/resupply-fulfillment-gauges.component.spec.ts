import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ResupplyFulfillmentGaugesComponent } from './resupply-fulfillment-gauges.component';
import { NutrientFulfillment } from '../../models/resupply.model';

describe('ResupplyFulfillmentGaugesComponent', () => {
  let component: ResupplyFulfillmentGaugesComponent;
  let fixture: ComponentFixture<ResupplyFulfillmentGaugesComponent>;

  const mockFulfillment: NutrientFulfillment = {
    calories: { current: 3800, target: 3450, percentage: 110 },
    carbs: { current: 400, target: 474, percentage: 84 },
    protein: { current: 140, target: 129, percentage: 108 },
    fat: { current: 100, target: 115, percentage: 87 },
    sodium: { current: 4500, target: 4200, percentage: 107 },
    fluids: { current: 3500, target: 4500, percentage: 78 }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResupplyFulfillmentGaugesComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ResupplyFulfillmentGaugesComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    fixture.componentRef.setInput('fulfillment', mockFulfillment);
    fixture.componentRef.setInput('compact', false);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render standard detailed gauges with current, target, and percentage values', () => {
    fixture.componentRef.setInput('fulfillment', mockFulfillment);
    fixture.componentRef.setInput('compact', false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Nutritional Fulfillment Gauges');
    expect(text).toContain('3800 / 3450 kcal');
    expect(text).toContain('110%');
    expect(text).toContain('140 / 129 g');
    expect(text).toContain('108%');
  });

  it('should display surplus badges in detailed mode when percentage > 100%', () => {
    fixture.componentRef.setInput('fulfillment', mockFulfillment);
    fixture.componentRef.setInput('compact', false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('+10% surplus');
    expect(text).toContain('+8% surplus');
  });

  it('should render compact sticky mini fulfillment bar with all 5 mini gauges', () => {
    fixture.componentRef.setInput('fulfillment', mockFulfillment);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('[data-testid="sticky-mini-fulfillment"]');
    expect(container).toBeDefined();

    expect(fixture.nativeElement.querySelector('[data-testid="mini-gauge-calories"]')).toBeDefined();
    expect(fixture.nativeElement.querySelector('[data-testid="mini-gauge-protein"]')).toBeDefined();
    expect(fixture.nativeElement.querySelector('[data-testid="mini-gauge-fat"]')).toBeDefined();
    expect(fixture.nativeElement.querySelector('[data-testid="mini-gauge-sodium"]')).toBeDefined();
    expect(fixture.nativeElement.querySelector('[data-testid="mini-gauge-fluids"]')).toBeDefined();
  });

  it('should display checkmark ✓ in mini gauge when fulfillment is >= 100%', () => {
    fixture.componentRef.setInput('fulfillment', mockFulfillment);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    const calGauge = fixture.nativeElement.querySelector('[data-testid="mini-gauge-calories"]') as HTMLElement;
    expect(calGauge.textContent).toContain('✓');

    const fluidsGauge = fixture.nativeElement.querySelector('[data-testid="mini-gauge-fluids"]') as HTMLElement;
    expect(fluidsGauge.textContent).not.toContain('✓');
  });

  it('should provide informative title tooltips on mini gauges', () => {
    fixture.componentRef.setInput('fulfillment', mockFulfillment);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();

    const calGauge = fixture.nativeElement.querySelector('[data-testid="mini-gauge-calories"]') as HTMLElement;
    expect(calGauge.getAttribute('title')).toContain('Calories: 3800 / 3450 kcal (110%)');
  });
});
