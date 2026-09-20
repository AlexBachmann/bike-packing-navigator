import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('Marketing AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the marketing app shell', () => {
    expect(component).toBeTruthy();
  });

  it('should have the correct title and PWA target URL', () => {
    expect(component.title).toBe('Bikepack Navigator');
    expect(component.pwaUrl).toBe('/bike-packing-navigator/');
  });

  it('should render Launch App CTA buttons pointing to the PWA', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const ctaLinks = compiled.querySelectorAll('a[href="/bike-packing-navigator/"]');
    expect(ctaLinks.length).toBeGreaterThan(0);
  });

  it('should toggle mobile menu state', () => {
    expect(component.mobileMenuOpen()).toBe(false);
    component.toggleMobileMenu();
    expect(component.mobileMenuOpen()).toBe(true);
    component.closeMobileMenu();
    expect(component.mobileMenuOpen()).toBe(false);
  });
});
