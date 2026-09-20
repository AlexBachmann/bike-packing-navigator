import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { HomeComponent } from './home.component';
import { SeoService } from '../../services/seo.service';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let seoService: SeoService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), SeoService],
    }).compileComponents();

    seoService = TestBed.inject(SeoService);
    vi.spyOn(seoService, 'setMeta');

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the home component', () => {
    expect(component).toBeTruthy();
  });

  it('should call setMeta on init with home page title and description', () => {
    expect(seoService.setMeta).toHaveBeenCalled();
  });

  it('should render the dynamic headline and punchy subhook', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('The Autonomous');
    expect(compiled.textContent).toContain('Backcountry Copilot');
    expect(compiled.textContent).toContain(
      "When you're 40 miles past cell service, hope is not a navigation strategy",
    );
  });

  it('should render primary CTA buttons linking to the PWA', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const pwaLinks = compiled.querySelectorAll('a[href="/bike-packing-navigator/"]');
    expect(pwaLinks.length).toBeGreaterThanOrEqual(2);
  });

  it('should have 5 core views in the interactive media showcase', () => {
    expect(component.showcaseViews.length).toBe(5);
    expect(component.showcaseViews.map((v) => v.name)).toEqual([
      'Live Ride Cockpit',
      'Elevation & Climb Weather',
      'Resupply & Nutrition',
      'Vector Map & Offline Cache',
      'Waypoint & Water Filters',
    ]);
  });

  it('should switch showcase view tabs and device viewport mode', () => {
    expect(component.activeShowcaseIndex()).toBe(0);
    component.selectShowcaseTab(2);
    expect(component.activeShowcaseIndex()).toBe(2);

    expect(component.showcaseDevice()).toBe('desktop');
    component.setShowcaseDevice('mobile');
    expect(component.showcaseDevice()).toBe('mobile');
  });

  it('should render all 7 feature pillars with athlete survival advantages', () => {
    expect(component.pillars.length).toBe(7);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain(
      'The 7 Survival Advantages of Autonomous Trail Intelligence',
    );
    expect(compiled.textContent).toContain('Physics-Based Dynamic ETA Modeling');
    expect(compiled.textContent).toContain('single grocery store closes at 7 PM');
    expect(compiled.textContent).toContain('Predictive Trail Weather & Hazard Intelligence');
    expect(compiled.textContent).toContain('Resupply & Nutrition Intelligence');
    expect(compiled.textContent).toContain('Enriched Waypoint & Water Intelligence');
    expect(compiled.textContent).toContain('Climb & Pass Analytics');
    expect(compiled.textContent).toContain('Offline Vector Cartography & Navigation');
    expect(compiled.textContent).toContain('Open-Source Philosophy & Community Trust');
  });

  it('should render the target personas comparison', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Self-Supported Ultra-Racers');
    expect(compiled.textContent).toContain('Recreational Wilderness Bikepackers');
  });

  it('should render the head-to-head comparison matrix', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const table = compiled.querySelector('table');
    expect(table).toBeTruthy();
    expect(compiled.textContent).toContain('Strava');
    expect(compiled.textContent).toContain('Komoot');
    expect(compiled.textContent).toContain('RideWithGPS');
    expect(compiled.textContent).toContain('Garmin Edge');
    expect(component.comparisonRows.length).toBeGreaterThanOrEqual(7);
  });
});
