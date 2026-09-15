import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { SettingsPaceEtaComponent } from './settings-pace-eta.component';

describe('SettingsPaceEtaComponent', () => {
  let component: SettingsPaceEtaComponent;
  let componentRef: ComponentRef<SettingsPaceEtaComponent>;
  let fixture: ComponentFixture<SettingsPaceEtaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPaceEtaComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPaceEtaComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    fixture.detectChanges();
  });

  it('1. should create component and apply block host class', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('2. should mark Power Model button as ACTIVE when paceMode is power', () => {
    componentRef.setInput('paceMode', 'power');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const powerBtn = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Power Model'));
    expect(powerBtn).toBeTruthy();
    expect(powerBtn!.textContent).toContain('ACTIVE');

    const speedBtn = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Speed Model'));
    expect(speedBtn).toBeTruthy();
    expect(speedBtn!.textContent).not.toContain('ACTIVE');
  });

  it('3. should mark Speed Model button as ACTIVE when paceMode is speed', () => {
    componentRef.setInput('paceMode', 'speed');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const speedBtn = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Speed Model'));
    expect(speedBtn).toBeTruthy();
    expect(speedBtn!.textContent).toContain('ACTIVE');

    const powerBtn = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Power Model'));
    expect(powerBtn).toBeTruthy();
    expect(powerBtn!.textContent).not.toContain('ACTIVE');
  });

  it('4. should emit paceModeChange with "power" on clicking Power Model button', () => {
    const emitSpy = vi.spyOn(component.paceModeChange, 'emit');
    const powerBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Power Model'));
    expect(powerBtn).toBeTruthy();
    powerBtn!.click();

    expect(emitSpy).toHaveBeenCalledWith('power');
  });

  it('5. should emit paceModeChange with "speed" on clicking Speed Model button', () => {
    const emitSpy = vi.spyOn(component.paceModeChange, 'emit');
    const speedBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Speed Model'));
    expect(speedBtn).toBeTruthy();
    speedBtn!.click();

    expect(emitSpy).toHaveBeenCalledWith('speed');
  });

  it('6. should render Climb Surge & Hike-a-Bike section in power mode', () => {
    componentRef.setInput('paceMode', 'power');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Climb Surge & Hike-a-Bike Parameters');
  });

  it('7. should hide Climb Surge & Hike-a-Bike section in speed mode', () => {
    componentRef.setInput('paceMode', 'speed');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Climb Surge & Hike-a-Bike Parameters');
  });

  it('8. should emit climbSurgePercentChange on input change', () => {
    const emitSpy = vi.spyOn(component.climbSurgePercentChange, 'emit');
    component.onClimbSurgePercentChange(20);
    expect(emitSpy).toHaveBeenCalledWith(20);
  });

  it('9. should emit climbSurgeDurationMinutesChange on input change', () => {
    const emitSpy = vi.spyOn(component.climbSurgeDurationMinutesChange, 'emit');
    component.onClimbSurgeDurationMinutesChange(15);
    expect(emitSpy).toHaveBeenCalledWith(15);
  });

  it('10. should emit hikeBikeThresholdChange and hikeBikeBaseSpeedChange on input', () => {
    const threshSpy = vi.spyOn(component.hikeBikeThresholdChange, 'emit');
    const speedSpy = vi.spyOn(component.hikeBikeBaseSpeedChange, 'emit');

    component.onHikeBikeThresholdChange(4.2);
    expect(threshSpy).toHaveBeenCalledWith(4.2);

    component.onHikeBikeBaseSpeedChange(3.0);
    expect(speedSpy).toHaveBeenCalledWith(3.0);
  });

  it('11. should format unit suffix correctly based on distanceUnit', () => {
    componentRef.setInput('paceMode', 'power');
    componentRef.setInput('distanceUnit', 'miles');
    componentRef.setInput('hikeBikeThresholdKmh', 6.0);
    componentRef.setInput('hikeBikeBaseSpeedKmh', 4.0);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('mph (6.0 km/h)');

    componentRef.setInput('distanceUnit', 'km');
    fixture.detectChanges();
    expect(el.textContent).toContain('km/h (3.7 mph)');
  });

  it('12. should ensure all buttons have explicit type="button"', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(2);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });
});
