import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { WelcomeScreenComponent } from './welcome-screen.component';
import { RouteManifestService } from '../../services/route-manifest.service';
import { RouteSummary } from '../../models/route.model';

describe('WelcomeScreenComponent', () => {
  let component: WelcomeScreenComponent;
  let fixture: ComponentFixture<WelcomeScreenComponent>;
  let manifestService: RouteManifestService;

  const mockRoutes: RouteSummary[] = [
    {
      id: 'tour-divide-2025',
      name: 'Tour Divide 2025',
      shortName: 'TD',
      badge: 'TD',
      totalDistanceMiles: 2679.2,
      totalDistanceKm: 4311.8,
      elevationGainFt: 149600,
      elevationGainM: 45600,
      startLocation: 'Banff, AB',
      endLocation: 'Antelope Wells, NM',
      iconicCheckpoints: ['Banff', 'Sparwood', 'Steamboat Springs', 'Antelope Wells'],
      startCoordinates: [51.16, -115.56],
      bounds: [[31.33, -115.56], [51.16, -108.53]],
      description: 'The iconic GDMBR route along the Continental Divide.',
      iconicPass: 'Brazos Ridge'
    },
    {
      id: 'colorado-trail',
      name: 'Colorado Trail',
      shortName: 'CT',
      badge: 'CT',
      totalDistanceMiles: 535.0,
      totalDistanceKm: 861.0,
      elevationGainFt: 89000,
      elevationGainM: 27127,
      startLocation: 'Denver (Waterton Canyon), CO',
      endLocation: 'Durango, CO',
      iconicCheckpoints: ['Waterton Canyon', 'Breckenridge', 'Leadville', 'Silverton', 'Durango'],
      startCoordinates: [39.49, -105.09],
      bounds: [[37.27, -107.88], [39.49, -105.09]],
      description: 'Rugged high-altitude singletrack through the Colorado Rockies.',
      highestPoint: 'Coney Summit'
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WelcomeScreenComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), RouteManifestService]
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeScreenComponent);
    component = fixture.componentInstance;
    manifestService = TestBed.inject(RouteManifestService);
  });

  it('should create the welcome screen component', () => {
    expect(component).toBeTruthy();
  });

  it('should render route cards from routes input', () => {
    fixture.componentRef.setInput('routes', mockRoutes);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tour Divide 2025');
    expect(el.textContent).toContain('Colorado Trail');
    expect(el.textContent).toContain('2,679.2 mi');
    expect(el.textContent).toContain('535 mi');
    expect(el.textContent).toContain('Banff, AB → Antelope Wells, NM');
  });

  it('should fallback to manifestService.availableRoutes when input is not provided', () => {
    manifestService.availableRoutes.set(mockRoutes);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tour Divide 2025');
    expect(el.textContent).toContain('Colorado Trail');
  });

  it('should format distances in kilometers when unit input is km', () => {
    fixture.componentRef.setInput('routes', mockRoutes);
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('4,311.8 km');
    expect(el.textContent).toContain('861 km');
    expect(el.textContent).toContain('~46k m');
  });

  it('should format distances in miles when unit input is miles', () => {
    fixture.componentRef.setInput('routes', mockRoutes);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('2,679.2 mi');
    expect(el.textContent).toContain('535 mi');
    expect(el.textContent).toContain('~150k ft');
  });

  it('should display iconic checkpoints for each route', () => {
    fixture.componentRef.setInput('routes', mockRoutes);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Waterton Canyon');
    expect(el.textContent).toContain('Silverton');
    expect(el.textContent).toContain('Sparwood');
  });

  it('should emit routeSelect and call manifestService.selectRoute on button click', () => {
    fixture.componentRef.setInput('routes', mockRoutes);
    fixture.detectChanges();

    const selectSpy = vi.spyOn(manifestService, 'selectRoute');
    let emittedRouteId: string | undefined;
    component.routeSelect.subscribe((id) => {
      emittedRouteId = id;
    });

    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons.length).toBe(2);

    buttons[1].click(); // Click Colorado Trail

    expect(emittedRouteId).toBe('colorado-trail');
    expect(selectSpy).toHaveBeenCalledWith('colorado-trail');
  });

  it('should handle empty route list gracefully without throwing', () => {
    fixture.componentRef.setInput('routes', []);
    manifestService.availableRoutes.set([]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Select Your Bikepacking Route');
    expect(el.querySelectorAll('button').length).toBe(0);
  });
});
