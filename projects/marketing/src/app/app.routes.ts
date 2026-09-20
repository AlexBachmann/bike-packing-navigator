import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'features/eta-modeling',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'eta-modeling' },
  },
  {
    path: 'features/weather-hazards',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'weather-hazards' },
  },
  {
    path: 'features/resupply-nutrition',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'resupply-nutrition' },
  },
  {
    path: 'features/waypoint-water',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'waypoint-water' },
  },
  {
    path: 'features/climb-analytics',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'climb-analytics' },
  },
  {
    path: 'features/offline-mapping',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'offline-mapping' },
  },
  {
    path: 'features/open-source',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
    data: { slug: 'open-source' },
  },
  {
    path: 'features/:slug',
    loadComponent: () =>
      import('./pages/feature-detail/feature-detail.component').then(
        (m) => m.FeatureDetailComponent,
      ),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
