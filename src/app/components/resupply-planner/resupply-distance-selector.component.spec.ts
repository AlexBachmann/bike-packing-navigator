import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ResupplyDistanceSelectorComponent,
  ResupplyStopItem
} from './resupply-distance-selector.component';

describe('ResupplyDistanceSelectorComponent', () => {
  let component: ResupplyDistanceSelectorComponent;
  let fixture: ComponentFixture<ResupplyDistanceSelectorComponent>;

  const mockStops: ResupplyStopItem[] = [
    {
      id: 'stop-1',
      name: 'Eureka General Store',
      town: 'Eureka, MT',
      routeMile: 125.4,
      distAhead: 45,
      distAheadMiles: 45,
      distAheadKm: 72.4,
      estimatedHours: 3.5,
      timeFormatted: '3h 30m',
      badgeIcon: '🛒',
      badgeLabel: 'Grocery'
    },
    {
      id: 'stop-2',
      name: 'Whitefish Mountain Outpost',
      town: 'Whitefish, MT',
      routeMile: 210.8,
      distAhead: 130,
      distAheadMiles: 130,
      distAheadKm: 209.2,
      estimatedHours: 9.2,
      timeFormatted: '9h 12m',
      badgeIcon: '🏪',
      badgeLabel: 'General Store'
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResupplyDistanceSelectorComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ResupplyDistanceSelectorComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 50);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render upcoming stops with names, towns, distance ahead and times', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 45);
    fixture.componentRef.setInput('distanceSelectionMode', 'stops');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Eureka General Store');
    expect(text).toContain('Eureka, MT');
    expect(text).toContain('+45 mi');
    expect(text).toContain('~3h 30m');
  });

  it('should emit selectStop with stop item when a stop card is clicked', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 45);
    fixture.componentRef.setInput('distanceSelectionMode', 'stops');
    fixture.detectChanges();

    let selected: ResupplyStopItem | null = null;
    component.selectStop.subscribe((stop) => {
      selected = stop;
    });

    const stopButtons = fixture.nativeElement.querySelectorAll('.grid button') as NodeListOf<HTMLButtonElement>;
    stopButtons[0].click();
    expect(selected).toEqual(mockStops[0]);
  });

  it('should apply active highlight to the selected stop card', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('selectedStopId', 'stop-1');
    fixture.componentRef.setInput('targetDistance', 45);
    fixture.componentRef.setInput('distanceSelectionMode', 'stops');
    fixture.detectChanges();

    const stopButtons = fixture.nativeElement.querySelectorAll('.grid button') as NodeListOf<HTMLButtonElement>;
    expect(stopButtons[0].className).toContain('border-emerald-500');
    expect(stopButtons[1].className).toContain('border-slate-800');
  });

  it('should render empty fallback when upcomingStops is empty and switch mode on button click', () => {
    fixture.componentRef.setInput('upcomingStops', []);
    fixture.componentRef.setInput('targetDistance', 50);
    fixture.componentRef.setInput('distanceSelectionMode', 'stops');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No upcoming resupply POIs found ahead');

    let mode: string | null = null;
    component.modeChange.subscribe((m) => {
      mode = m;
    });

    const customBtn = fixture.nativeElement.querySelector('.bg-slate-800.text-emerald-400') as HTMLButtonElement;
    customBtn.click();
    expect(mode).toBe('custom');
  });

  it('should emit modeChange when segmented tabs are clicked', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 50);
    fixture.detectChanges();

    const modesEmitted: string[] = [];
    component.modeChange.subscribe((m) => {
      modesEmitted.push(m);
    });

    const tabButtons = fixture.nativeElement.querySelectorAll('.rounded-xl button') as NodeListOf<HTMLButtonElement>;
    tabButtons[1].click(); // Custom Distance
    tabButtons[0].click(); // Upcoming Stops

    expect(modesEmitted).toEqual(['custom', 'stops']);
  });

  it('should emit adjustDistance on stepper button clicks in custom mode', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 50);
    fixture.componentRef.setInput('distanceSelectionMode', 'custom');
    fixture.detectChanges();

    const deltas: number[] = [];
    component.adjustDistance.subscribe((d) => {
      deltas.push(d);
    });

    const buttons = fixture.nativeElement.querySelectorAll('.space-y-3 button') as NodeListOf<HTMLButtonElement>;
    // buttons: -10, -5, +5, +10
    buttons[0].click(); // -10
    buttons[1].click(); // -5
    buttons[2].click(); // +5
    buttons[3].click(); // +10

    expect(deltas).toEqual([-10, -5, 5, 10]);
  });

  it('should emit distanceChange on preset chip click', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 50);
    fixture.componentRef.setInput('distanceSelectionMode', 'custom');
    fixture.componentRef.setInput('distancePresets', [25, 50, 75, 100]);
    fixture.detectChanges();

    let distanceSelected: number | null = null;
    component.distanceChange.subscribe((d) => {
      distanceSelected = d;
    });

    const presetChips = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .filter((b) => b.textContent?.includes('75 mi'));
    presetChips[0].click();
    expect(distanceSelected).toBe(75);
  });

  it('should properly adapt unit to km', () => {
    fixture.componentRef.setInput('upcomingStops', mockStops);
    fixture.componentRef.setInput('targetDistance', 80);
    fixture.componentRef.setInput('unit', 'km');
    fixture.componentRef.setInput('distanceSelectionMode', 'custom');
    fixture.componentRef.setInput('distancePresets', [40, 80, 120]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('km');
    expect(fixture.nativeElement.textContent).toContain('80 km');
  });
});
