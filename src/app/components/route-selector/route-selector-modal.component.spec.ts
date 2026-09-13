import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteSelectorModalComponent } from './route-selector-modal.component';
import { RouteManifestService } from '../../services/route-manifest.service';
import { RouteSummary } from '../../models/route.model';
import { signal } from '@angular/core';

describe('RouteSelectorModalComponent', () => {
  let component: RouteSelectorModalComponent;
  let fixture: ComponentFixture<RouteSelectorModalComponent>;

  const mockTdRoute: RouteSummary = {
    id: 'tour-divide-2025',
    name: 'Tour Divide 2025',
    shortName: 'Tour Divide',
    badge: 'TD',
    startLocation: 'Banff, AB',
    endLocation: 'Antelope Wells, NM',
    totalDistanceMiles: 2679.2,
    totalDistanceKm: 4311.8,
    elevationGainFt: 149600,
    elevationGainM: 45600,
    highestPoint: 'Indiana Pass (11,910 ft)',
    iconicPass: 'Indiana Pass (11,910 ft)',
    iconicCheckpoints: ['Banff', 'Indiana Pass', 'Pie Town'],
    description: 'The premier self-supported bikepacking route along the Continental Divide.',
    startCoordinates: [51.1613, -115.5602],
    bounds: [[31.3323, -115.5602], [51.1613, -108.5303]]
  };

  const mockCtRoute: RouteSummary = {
    id: 'colorado-trail',
    name: 'The Colorado Trail',
    shortName: 'Colorado Trail',
    badge: 'CT',
    startLocation: 'Denver, CO',
    endLocation: 'Durango, CO',
    totalDistanceMiles: 514.7,
    totalDistanceKm: 828.4,
    elevationGainFt: 83143,
    elevationGainM: 25342,
    highestPoint: 'Coney Summit (13,258 ft)',
    iconicPass: 'Coney Summit (13,258 ft)',
    iconicCheckpoints: ['Waterton Canyon', 'Georgia Pass', 'Monarch Pass'],
    description: 'Traversing the Colorado Rockies from Denver to Durango.',
    startCoordinates: [39.4909, -105.0942],
    bounds: [[37.3314, -108.0387], [39.5516, -105.0942]]
  };

  const mockAvailableRoutes = [mockTdRoute, mockCtRoute];

  const mockManifestService = {
    availableRoutes: signal<RouteSummary[]>(mockAvailableRoutes),
    activeRouteId: signal<string | null>('tour-divide-2025'),
    activeRouteSummary: signal<RouteSummary | null>(mockTdRoute)
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteSelectorModalComponent],
      providers: [
        { provide: RouteManifestService, useValue: mockManifestService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RouteSelectorModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('availableRoutes', mockAvailableRoutes);
    fixture.componentRef.setInput('activeRouteId', 'tour-divide-2025');
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();
  });

  it('should create the route selector modal component', () => {
    expect(component).toBeTruthy();
  });

  it('should render route list with names, badges, descriptions, and metrics', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Select Bikepacking Route');
    expect(el.textContent).toContain('2 of 2 routes available');
    expect(el.textContent).toContain('Tour Divide 2025');
    expect(el.textContent).toContain('The Colorado Trail');
    expect(el.textContent).toContain('2,679.2 mi');
    expect(el.textContent).toContain('514.7 mi');
    expect(el.textContent).toContain('✓ ACTIVE');
  });

  it('should filter routes by search query', () => {
    component.searchQuery.set('Colorado');
    fixture.detectChanges();

    expect(component.filteredRoutes().length).toBe(1);
    expect(component.filteredRoutes()[0].id).toBe('colorado-trail');

    component.searchQuery.set('Pie Town');
    fixture.detectChanges();

    expect(component.filteredRoutes().length).toBe(1);
    expect(component.filteredRoutes()[0].id).toBe('tour-divide-2025');
  });

  it('should show empty state when no routes match search query and allow clearing', () => {
    component.searchQuery.set('Nonexistent Route');
    fixture.detectChanges();

    expect(component.filteredRoutes().length).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No routes found matching "Nonexistent Route"');

    component.clearSearch();
    fixture.detectChanges();

    expect(component.searchQuery()).toBe('');
    expect(component.filteredRoutes().length).toBe(2);
  });

  it('should emit routeSelect when a route is clicked', () => {
    let selectedId: string | undefined;
    component.routeSelect.subscribe((id) => {
      selectedId = id;
    });

    component.onSelect('colorado-trail');
    expect(selectedId).toBe('colorado-trail');
  });

  it('should emit close when close button or escape is triggered', () => {
    let closed = false;
    component.close.subscribe(() => {
      closed = true;
    });

    const closeBtn = fixture.nativeElement.querySelector('[aria-label="Close route selector dialog"]') as HTMLButtonElement;
    closeBtn.click();
    expect(closed).toBe(true);

    closed = false;
    component.handleEscape();
    expect(closed).toBe(true);
  });

  it('should display distance metrics in kilometers when unit is km', () => {
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('4,311.8 km');
    expect(el.textContent).toContain('828.4 km');
  });
});
