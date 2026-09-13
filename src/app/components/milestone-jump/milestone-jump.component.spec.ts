import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MilestoneJumpComponent } from './milestone-jump.component';
import { MAJOR_MILESTONES } from '../../models/waypoint.model';

describe('MilestoneJumpComponent', () => {
  let component: MilestoneJumpComponent;
  let fixture: ComponentFixture<MilestoneJumpComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MilestoneJumpComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(MilestoneJumpComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('unit', 'miles');
    fixture.componentRef.setInput('milestones', MAJOR_MILESTONES);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render milestone buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Banff, AB');
    expect(el.textContent).toContain('Antelope Wells, NM');
  });

  it('should emit jumpToMilestone when milestone button is clicked', () => {
    let emittedMile: number | undefined;
    component.jumpToMilestone.subscribe((mile) => {
      emittedMile = mile;
    });

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    // First milestone button is Banff (mile 0)
    buttons[0].click();
    expect(emittedMile).toBe(0.0);
  });

  it('should emit simulateGps when GPS simulation button is clicked', () => {
    let coords: { lat: number; lon: number } | undefined;
    component.simulateGps.subscribe((c) => {
      coords = c;
    });

    component.onSimulateGps(51.161267, -115.56016);
    expect(coords).toEqual({ lat: 51.161267, lon: -115.56016 });
  });

  it('should show km labels when unit is km', () => {
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('KM');
  });

  it('should have block host class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should emit simulateGps when clicking Banff Grand Depart simulation button', () => {
    let coords: { lat: number; lon: number } | undefined;
    component.simulateGps.subscribe((c) => {
      coords = c;
    });

    const el = fixture.nativeElement as HTMLElement;
    const simBtns = el.querySelectorAll('.grid-cols-2 button');
    // First sim button is Banff Grand Depart
    const banffSimBtn = Array.from(simBtns).find((b) => b.textContent?.includes('Banff Grand Depart')) as HTMLButtonElement;
    expect(banffSimBtn).toBeTruthy();
    banffSimBtn.click();

    expect(coords).toEqual({ lat: 51.161267, lon: -115.56016 });
  });

  it('should have type="button" on all milestone and simulation buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  it('should emit simulateGps when clicking Butte, MT simulation button', () => {
    let coords: { lat: number; lon: number } | undefined;
    component.simulateGps.subscribe((c) => {
      coords = c;
    });

    const el = fixture.nativeElement as HTMLElement;
    const simBtns = el.querySelectorAll('.grid-cols-2.text-xs button');
    const butteBtn = Array.from(simBtns).find((b) => b.textContent?.includes('Butte, MT (0.4 km off)')) as HTMLButtonElement;
    expect(butteBtn).toBeTruthy();
    butteBtn.click();

    expect(coords).toEqual({ lat: 46.0038, lon: -112.5347 });
  });
});
