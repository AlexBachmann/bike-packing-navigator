import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { SettingsRiderRigComponent } from './settings-rider-rig.component';

describe('SettingsRiderRigComponent', () => {
  let component: SettingsRiderRigComponent;
  let componentRef: ComponentRef<SettingsRiderRigComponent>;
  let fixture: ComponentFixture<SettingsRiderRigComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsRiderRigComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsRiderRigComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    fixture.detectChanges();
  });

  it('1. should create component and apply block host class', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('2. should render KG unit label when weightUnit is kg', () => {
    componentRef.setInput('weightUnit', 'kg');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('KG');
  });

  it('3. should render LBS unit label when weightUnit is lbs', () => {
    componentRef.setInput('weightUnit', 'lbs');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('LBS');
  });

  it('4. should emit toggleWeightUnit when clicking unit toggle button', () => {
    const emitSpy = vi.spyOn(component.toggleWeightUnit, 'emit');

    const btn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Unit:'));
    expect(btn).toBeTruthy();
    btn!.click();

    expect(emitSpy).toHaveBeenCalled();
  });

  it('5. should emit riderWeightChange with numeric value on valid input', () => {
    const emitSpy = vi.spyOn(component.riderWeightChange, 'emit');
    component.onRiderWeightChange(82.5);
    expect(emitSpy).toHaveBeenCalledWith(82.5);
  });

  it('6. should emit null on riderWeightChange when input is empty or invalid', () => {
    const emitSpy = vi.spyOn(component.riderWeightChange, 'emit');
    component.onRiderWeightChange(null);
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.onRiderWeightChange(0);
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.onRiderWeightChange(-10);
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.onRiderWeightChange(NaN);
    expect(emitSpy).toHaveBeenCalledWith(null);
  });

  it('7. should emit bikeWeightChange with numeric value on valid input', () => {
    const emitSpy = vi.spyOn(component.bikeWeightChange, 'emit');
    component.onBikeWeightChange(11.8);
    expect(emitSpy).toHaveBeenCalledWith(11.8);

    component.onBikeWeightChange(null);
    expect(emitSpy).toHaveBeenCalledWith(null);

    component.onGearWeightChange(4.5);
    component.onGearWeightChange(null);
  });

  it('8. should emit waterCapacityChange with numeric value on valid input', () => {
    const emitSpy = vi.spyOn(component.waterCapacityChange, 'emit');
    component.onWaterCapacityChange(3.5);
    expect(emitSpy).toHaveBeenCalledWith(3.5);

    component.onWaterCapacityChange(0);
    expect(emitSpy).toHaveBeenCalledWith(0);

    component.onWaterCapacityChange(null);
    expect(emitSpy).toHaveBeenCalledWith(null);
  });

  it('9. should render total loaded weight summary bar when totalLoadedWeight is present', () => {
    componentRef.setInput('totalLoadedWeight', 94.2);
    componentRef.setInput('waterWeightInUnit', 3.5);
    componentRef.setInput('totalBaseWeight', 90.7);
    componentRef.setInput('weightUnit', 'kg');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Total Loaded');
    expect(el.textContent).toContain('94.2 kg');
    expect(el.textContent).toContain('3.5 kg');
    expect(el.textContent).toContain('90.7 kg');
  });

  it('10. should hide total rig summary bar when totalLoadedWeight is null', () => {
    componentRef.setInput('totalLoadedWeight', null);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Total Loaded');
  });

  it('11. should ensure all buttons have explicit type="button"', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(1);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });
});
