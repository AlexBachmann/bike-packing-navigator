import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { baseHrefInterceptor, resolveBaseHref } from './base-href.interceptor';

describe('baseHrefInterceptor & resolveBaseHref', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let originalBase: HTMLBaseElement | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([baseHrefInterceptor])),
        provideHttpClientTesting()
      ]
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    originalBase = document.querySelector('base');
    if (!originalBase) {
      originalBase = document.createElement('base');
      document.head.appendChild(originalBase);
    }
  });

  afterEach(() => {
    httpTesting.verify();
    if (originalBase) {
      originalBase.setAttribute('href', '/');
    }
  });

  describe('resolveBaseHref', () => {
    it('should return untouched URL when base href is root /', () => {
      originalBase?.setAttribute('href', '/');
      expect(resolveBaseHref('/data/routes.json')).toBe('/data/routes.json');
      expect(resolveBaseHref('/assets/styles/vector-dark.json')).toBe('/assets/styles/vector-dark.json');
    });

    it('should prefix relative paths when base href is non-root (e.g. GitHub Pages)', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator/');
      expect(resolveBaseHref('/data/routes.json')).toBe('/bike-packing-navigator/data/routes.json');
      expect(resolveBaseHref('/assets/styles/vector-dark.json')).toBe('/bike-packing-navigator/assets/styles/vector-dark.json');
      expect(resolveBaseHref('data/routes.json')).toBe('/bike-packing-navigator/data/routes.json');
    });

    it('should handle base href without trailing slash', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator');
      expect(resolveBaseHref('/data/routes.json')).toBe('/bike-packing-navigator/data/routes.json');
    });

    it('should not duplicate prefix if already prefixed', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator/');
      expect(resolveBaseHref('/bike-packing-navigator/data/routes.json')).toBe('/bike-packing-navigator/data/routes.json');
    });

    it('should preserve external and special protocol URLs', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator/');
      expect(resolveBaseHref('https://tiles.openfreemap.org/planet')).toBe('https://tiles.openfreemap.org/planet');
      expect(resolveBaseHref('http://example.com/test.pmtiles')).toBe('http://example.com/test.pmtiles');
      expect(resolveBaseHref('pmtiles://tour-divide-2025')).toBe('pmtiles://tour-divide-2025');
      expect(resolveBaseHref('blob:http://localhost:4200/uuid')).toBe('blob:http://localhost:4200/uuid');
      expect(resolveBaseHref('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')).toBe(
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      );
    });

    it('should handle empty or falsy strings', () => {
      expect(resolveBaseHref('')).toBe('');
    });
  });

  describe('baseHrefInterceptor', () => {
    it('should leave /data/ URLs untouched when base href is root /', () => {
      originalBase?.setAttribute('href', '/');

      http.get('/data/routes.json').subscribe();
      const req = httpTesting.expectOne('/data/routes.json');
      expect(req.request.url).toBe('/data/routes.json');
      req.flush({});
    });

    it('should prepend base href when base href is non-root (e.g. GitHub Pages)', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator/');

      http.get('/data/routes.json').subscribe();
      const req = httpTesting.expectOne('/bike-packing-navigator/data/routes.json');
      expect(req.request.url).toBe('/bike-packing-navigator/data/routes.json');
      req.flush({});
    });

    it('should intercept /assets/ requests as well under non-root base href', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator/');

      http.get('/assets/icons/poi.svg').subscribe();
      const req = httpTesting.expectOne('/bike-packing-navigator/assets/icons/poi.svg');
      expect(req.request.url).toBe('/bike-packing-navigator/assets/icons/poi.svg');
      req.flush({});
    });

    it('should leave external URLs untouched even on non-root base href', () => {
      originalBase?.setAttribute('href', '/bike-packing-navigator/');

      http.get('https://api.open-meteo.com/v1/forecast').subscribe();
      const req = httpTesting.expectOne('https://api.open-meteo.com/v1/forecast');
      expect(req.request.url).toBe('https://api.open-meteo.com/v1/forecast');
      req.flush({});
    });
  });
});

