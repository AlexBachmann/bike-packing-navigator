import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const swUrl = new URL('sw.js', document.baseURI).href;
  navigator.serviceWorker.register(swUrl).catch((err) => {
    console.warn('Service Worker registration skipped/failed:', err);
  });
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
