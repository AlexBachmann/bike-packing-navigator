import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { baseHrefInterceptor } from './base-href.interceptor';

describe('baseHrefInterceptor', () => {
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
  });

  afterEach(() => {
    httpTesting.verify();
    if (originalBase) {
      originalBase.setAttribute('href', '/');
    }
  });

  it('should leave /data/ URLs untouched when base href is root /', () => {
    if (originalBase) {
      originalBase.setAttribute('href', '/');
    }

    http.get('/data/routes.json').subscribe();
    const req = httpTesting.expectOne('/data/routes.json');
    expect(req.request.url).toBe('/data/routes.json');
    req.flush({});
  });

  it('should prepend base href when base href is non-root (e.g. GitHub Pages)', () => {
    if (!originalBase) {
      originalBase = document.createElement('base');
      document.head.appendChild(originalBase);
    }
    originalBase.setAttribute('href', '/bike-packing-navigator/');

    http.get('/data/routes.json').subscribe();
    const req = httpTesting.expectOne('/bike-packing-navigator/data/routes.json');
    expect(req.request.url).toBe('/bike-packing-navigator/data/routes.json');
    req.flush({});
  });

  it('should leave non-data URLs untouched even on non-root base href', () => {
    if (originalBase) {
      originalBase.setAttribute('href', '/bike-packing-navigator/');
    }

    http.get('https://api.open-meteo.com/v1/forecast').subscribe();
    const req = httpTesting.expectOne('https://api.open-meteo.com/v1/forecast');
    expect(req.request.url).toBe('https://api.open-meteo.com/v1/forecast');
    req.flush({});
  });
});
