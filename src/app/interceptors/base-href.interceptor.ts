import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Ensures asset requests starting with '/data/' respect non-root base-hrefs
 * (such as GitHub Pages '/bike-packing-navigator/').
 */
export const baseHrefInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('/data/')) {
    const baseElement = typeof document !== 'undefined' ? document.querySelector('base') : null;
    const baseHref = baseElement?.getAttribute('href') || '/';

    if (baseHref && baseHref !== '/') {
      const prefix = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
      const resolvedReq = req.clone({
        url: `${prefix}${req.url}`
      });
      return next(resolvedReq);
    }
  }

  return next(req);
};
