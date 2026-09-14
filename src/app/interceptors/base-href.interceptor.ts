import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Resolves a URL or asset path relative to the document <base href> attribute.
 * - Leaves absolute protocol URLs (https://, http://, pmtiles://, etc.), data: and blob: URLs untouched.
 * - Strips redundant trailing/leading slashes to prevent double-slashing (e.g. /bike-packing-navigator//data).
 * - Avoids duplicate prefixing if the path already starts with the base href.
 */
export function resolveBaseHref(url: string): string {
  if (!url) return url;
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }

  const baseElement = typeof document !== 'undefined' ? document.querySelector('base') : null;
  const baseHref = baseElement?.getAttribute('href') || '/';

  if (baseHref && baseHref !== '/') {
    const prefix = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    if (!cleanUrl.startsWith(prefix)) {
      return `${prefix}${cleanUrl}`;
    }
  }

  return url;
}

/**
 * Ensures asset requests starting with '/data/' or '/assets/' respect non-root base-hrefs
 * (such as GitHub Pages '/bike-packing-navigator/').
 */
export const baseHrefInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('/data/') || req.url.startsWith('/assets/')) {
    const resolvedUrl = resolveBaseHref(req.url);
    if (resolvedUrl !== req.url) {
      const resolvedReq = req.clone({
        url: resolvedUrl
      });
      return next(resolvedReq);
    }
  }

  return next(req);
};

