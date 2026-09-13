import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WaypointCardComponent } from './waypoint-card.component';
import { WaypointViewModel } from '../../models/waypoint.model';

describe('WaypointCardComponent', () => {
  let component: WaypointCardComponent;
  let fixture: ComponentFixture<WaypointCardComponent>;

  const sampleWaypoint: WaypointViewModel = {
    id: 'banff-1',
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
    estimatedTimeFormatted: '18m',
    google_maps_url: 'https://maps.google.com/?q=51.16,-115.56'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WaypointCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(WaypointCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('waypoint', sampleWaypoint);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render waypoint name, town, and estimated time', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Banff Springs Hotel');
    expect(el.textContent).toContain('Banff, AB');
    expect(el.textContent).toContain('+3.1 mi');
    expect(el.textContent).toContain('in ~18m');
  });

  it('should render km when unit is km', () => {
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('+5.0 km');
    expect(el.textContent).toContain('KM 5.0');
  });

  it('should show off-trail distance when distance_to_trail_km > 0.05', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('off route');
  });

  it('should show On Trail when distance_to_trail_km <= 0.05', () => {
    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      distance_to_trail_km: 0.02
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('✔ On Trail');
  });

  it('should render external maps link', () => {
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe('https://maps.google.com/?q=51.16,-115.56');
    expect(link.textContent).toContain('Maps');
  });

  it('should have block host class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should not render town text when town is missing', () => {
    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      town: undefined,
      province_state: undefined
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('in Banff');
  });

  it('should not render maps link when google_maps_url is absent', () => {
    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      google_maps_url: undefined
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a')).toBeNull();
  });

  it('should resolve laundry alias to laundromat category badge', () => {
    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      category: 'laundry' as any
    });
    fixture.detectChanges();
    expect(component.categoryBadge().label).toBe('Laundry');
    expect(component.categoryBadge().icon).toBe('🧺');
  });

  it('should show On Trail at exact 0.05 km boundary and off route above 0.05 km', () => {
    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      distance_to_trail_km: 0.05
    });
    fixture.detectChanges();
    let el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('✔ On Trail');

    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      distance_to_trail_km: 0.051
    });
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('off route');
  });

  it('should render town without province_state when province_state is missing', () => {
    fixture.componentRef.setInput('waypoint', {
      ...sampleWaypoint,
      town: 'Banff',
      province_state: undefined
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('in Banff');
    expect(el.textContent).not.toContain('Banff,');
  });
});
