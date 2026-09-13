import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WaypointsListComponent } from './waypoints-list.component';
import { WaypointViewModel } from '../../models/waypoint.model';

describe('WaypointsListComponent', () => {
  let component: WaypointsListComponent;
  let fixture: ComponentFixture<WaypointsListComponent>;

  const sampleWaypoints: WaypointViewModel[] = [
    {
      id: 'p1',
      name: 'Banff Springs Hotel',
      category: 'hotel',
      type: 'hotel',
      town: 'Banff',
      province_state: 'AB',
      is_in_town: true,
      location: { lat: 51.16, lon: -115.56 },
      distance_to_trail_km: 0.1,
      route_km: 5.0,
      route_mile: 3.1,
      distanceAheadKm: 5.0,
      distanceAheadMiles: 3.1,
      estimatedHours: 0.3,
      estimatedTimeFormatted: '18m'
    },
    {
      id: 'p2',
      name: 'Mount Shark Camp',
      category: 'campground',
      type: 'campground',
      town: 'Canmore',
      province_state: 'AB',
      is_in_town: false,
      location: { lat: 50.85, lon: -115.38 },
      distance_to_trail_km: 0.0,
      route_km: 56.0,
      route_mile: 35.0,
      distanceAheadKm: 56.0,
      distanceAheadMiles: 35.0,
      estimatedHours: 3.5,
      estimatedTimeFormatted: '3h 30m'
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WaypointsListComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(WaypointsListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('waypoints', sampleWaypoints);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.componentRef.setInput('currentMile', 0);
    fixture.componentRef.setInput('isLoading', false);
    fixture.componentRef.setInput('error', null);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render waypoint cards for each waypoint', () => {
    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('app-waypoint-card');
    expect(cards.length).toBe(2);
    expect(el.textContent).toContain('Banff Springs Hotel');
    expect(el.textContent).toContain('Mount Shark Camp');
  });

  it('should render loading spinner when isLoading is true', () => {
    fixture.componentRef.setInput('isLoading', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Loading Waypoints & POIs...');
  });

  it('should render error message when error is set', () => {
    fixture.componentRef.setInput('error', 'Network failure');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Network failure');
  });

  it('should render empty message when waypoints array is empty', () => {
    fixture.componentRef.setInput('waypoints', []);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No waypoints match the selected filters');
  });

  it('should clear search query when clearSearch is called', () => {
    component.searchQuery.set('Banff');
    component.clearSearch();
    expect(component.searchQuery()).toBe('');
  });

  it('should have block host class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should update input element when searchQuery model changes', async () => {
    fixture.componentRef.setInput('searchQuery', 'Shark');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Shark');

    const clearBtn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
  });

  it('should update searchQuery model when user types into input', async () => {
    let emittedVal: string | undefined;
    component.searchQuery.subscribe((val) => {
      emittedVal = val;
    });

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Hotel';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.searchQuery()).toBe('Hotel');
    expect(emittedVal).toBe('Hotel');
  });

  it('should have type="button" and aria-label on clear search button', async () => {
    fixture.componentRef.setInput('searchQuery', 'Banff');
    fixture.detectChanges();
    await fixture.whenStable();

    const clearBtn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    expect(clearBtn.getAttribute('type')).toBe('button');
    expect(clearBtn.getAttribute('aria-label')).toBe('Clear search');
  });
});
