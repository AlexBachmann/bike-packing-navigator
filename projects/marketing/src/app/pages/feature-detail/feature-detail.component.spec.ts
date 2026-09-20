import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { FeatureDetailComponent } from './feature-detail.component';
import { SeoService } from '../../services/seo.service';

describe('FeatureDetailComponent', () => {
  let component: FeatureDetailComponent;
  let fixture: ComponentFixture<FeatureDetailComponent>;
  let seoService: SeoService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureDetailComponent],
      providers: [
        provideRouter([]),
        SeoService,
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ slug: 'eta-modeling' })),
            snapshot: {
              data: { slug: 'eta-modeling' },
              paramMap: convertToParamMap({ slug: 'eta-modeling' }),
            },
          },
        },
      ],
    }).compileComponents();

    seoService = TestBed.inject(SeoService);
    vi.spyOn(seoService, 'setMeta');

    fixture = TestBed.createComponent(FeatureDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the feature detail component', () => {
    expect(component).toBeTruthy();
  });

  it('should load eta-modeling detail by default', () => {
    expect(component.detail).toBeTruthy();
    expect(component.detail?.slug).toBe('eta-modeling');
    expect(component.detail?.title).toBe('Physics-Based Dynamic ETA Modeling');
    expect(component.detail?.equations.length).toBeGreaterThan(0);
    expect(component.detail?.architectureSections.length).toBe(3);
  });

  it('should update SEO meta for eta-modeling', () => {
    expect(seoService.setMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Physics-Based Dynamic ETA Modeling',
        urlPath: 'features/eta-modeling',
      }),
    );
  });

  it('should render breadcrumbs, formula code block, and capabilities', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Home');
    expect(compiled.textContent).toContain('Features');
    expect(compiled.textContent).toContain('Physics-Based Dynamic ETA Modeling');
    expect(compiled.textContent).toContain('½ ρ CdA v³ + m g (sin θ + Crr cos θ) v - η P = 0');
    expect(compiled.textContent).toContain('Core Mathematical Formulations');
    expect(compiled.textContent).toContain('Field Capabilities');
  });

  it('should render next and previous pillar navigation links', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.detail?.nextSlug).toBe('weather-hazards');
    expect(component.detail?.prevSlug).toBe('open-source');
    const links = compiled.querySelectorAll('a');
    const linkTexts = Array.from(links).map((l) => l.textContent?.trim());
    expect(linkTexts.some((t) => t?.includes('Trail Weather & Hazards'))).toBe(true);
  });
});
