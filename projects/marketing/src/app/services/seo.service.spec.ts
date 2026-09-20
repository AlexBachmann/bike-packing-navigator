import { TestBed } from '@angular/core/testing';
import { Title, Meta } from '@angular/platform-browser';
import { SeoService } from './seo.service';

describe('SeoService', () => {
  let service: SeoService;
  let titleService: Title;
  let metaService: Meta;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SeoService, Title, Meta],
    });
    service = TestBed.inject(SeoService);
    titleService = TestBed.inject(Title);
    metaService = TestBed.inject(Meta);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should set title and standard meta tags', () => {
    service.setMeta({
      title: 'Physics ETA Modeling',
      description: 'Newtonian cycling physics for bikepacking.',
      urlPath: 'features/eta-modeling',
      keywords: 'bikepacking, physics',
    });

    expect(titleService.getTitle()).toBe('Physics ETA Modeling | Bikepack Navigator');
    expect(metaService.getTag('name="description"')?.content).toBe(
      'Newtonian cycling physics for bikepacking.',
    );
    expect(metaService.getTag('name="keywords"')?.content).toBe('bikepacking, physics');
    expect(metaService.getTag('property="og:title"')?.content).toBe(
      'Physics ETA Modeling | Bikepack Navigator',
    );
    expect(metaService.getTag('property="og:url"')?.content).toBe(
      'https://alexbachmann.github.io/bike-packing-navigator/welcome/features/eta-modeling',
    );
    expect(metaService.getTag('name="twitter:card"')?.content).toBe('summary_large_image');
  });

  it('should use default image and root url when urlPath/imageUrl omitted', () => {
    service.setMeta({
      title: 'Home',
      description: 'Backcountry Copilot',
    });

    expect(metaService.getTag('property="og:url"')?.content).toBe(
      'https://alexbachmann.github.io/bike-packing-navigator/welcome/',
    );
    expect(metaService.getTag('property="og:image"')?.content).toContain('og-preview.jpg');
  });
});
