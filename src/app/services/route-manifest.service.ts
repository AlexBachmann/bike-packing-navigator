import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, of } from 'rxjs';
import { RouteSummary, RouteManifest } from '../models/route.model';
import { SettingsService } from './settings.service';
import { NetworkStatusService } from './network-status.service';
import { OfflineStorageService } from './offline-storage.service';
import { ToastService } from './toast.service';

export function getRouteKeyFromUrl(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get('route');
}

export function syncRouteKeyToUrl(routeKey: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    if (!window.location.protocol || !window.location.protocol.startsWith('http')) return;
    const url = new URL(window.location.href);
    if (routeKey) {
      url.searchParams.set('route', routeKey);
    } else {
      url.searchParams.delete('route');
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    // Ignore in non-browser or test environments
  }
}

@Injectable({
  providedIn: 'root'
})
export class RouteManifestService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);
  private readonly networkStatus = inject(NetworkStatusService);
  private readonly offlineStorage = inject(OfflineStorageService);
  private readonly toastService = inject(ToastService);

  readonly availableRoutes = signal<RouteSummary[]>([]);
  readonly activeRouteId = signal<string | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly isManifestLoading = this.isLoading.asReadonly();
  readonly manifestError = this.error.asReadonly();

  readonly activeRouteSummary = computed<RouteSummary | null>(() => {
    const id = this.activeRouteId();
    if (!id) return null;
    return this.availableRoutes().find((r) => r.id === id) || null;
  });

  constructor() {}

  loadManifest(): Observable<RouteSummary[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<RouteManifest | RouteSummary[]>('/data/routes.json').pipe(
      map((res) => {
        const routes: RouteSummary[] = Array.isArray(res) ? res : (res?.routes ?? []);
        return routes;
      }),
      tap((routes) => {
        this.availableRoutes.set(routes);
        this.isLoading.set(false);
        this.initializeActiveRoute(routes);
      }),
      catchError((err) => {
        console.error('Failed to load route manifest:', err);
        this.error.set('Failed to load available routes manifest.');
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  /**
   * Initializes active route adhering to precedence:
   * 1. URL query param ?route=<key>
   * 2. localStorage saved route
   * 3. null (welcome screen)
   */
  private async initializeActiveRoute(routes: RouteSummary[]): Promise<void> {
    // If activeRouteId is already set (e.g. set by test or user interaction), keep it
    if (this.activeRouteId()) {
      return;
    }

    const urlKey = getRouteKeyFromUrl();
    if (urlKey && routes.some((r) => r.id === urlKey)) {
      await this.selectRoute(urlKey, false);
      return;
    }

    const savedKey = this.settings.selectedRouteKey();
    if (savedKey && routes.some((r) => r.id === savedKey)) {
      await this.selectRoute(savedKey, false);
      return;
    }

    // Default: leave activeRouteId null for first visit welcome screen
    this.activeRouteId.set(null);
  }

  validateRouteId(routeId: string): boolean {
    return this.availableRoutes().some((r) => r.id === routeId);
  }

  async selectRoute(routeId: string | null, updateUrl: boolean = true): Promise<boolean> {
    if (!routeId) {
      this.activeRouteId.set(null);
      this.settings.setSelectedRouteKey(null);
      if (updateUrl) {
        syncRouteKeyToUrl(null);
      }
      return true;
    }

    const summary = this.getRouteSummary(routeId);
    if (!summary && this.availableRoutes().length > 0) {
      this.toastService.show(`Route '${routeId}' not recognized in manifest.`, 'warning');
      return false;
    }

    // Offline Guard:
    if (!this.networkStatus.isOnline()) {
      const isCached = await this.offlineStorage.isRouteCached(routeId);
      if (!isCached) {
        const routeName = summary?.name || routeId;
        this.toastService.show(
          `Internet connection required to download '${routeName}' for the first time.`,
          'warning'
        );
        return false;
      }
    }

    this.activeRouteId.set(routeId);
    this.settings.setSelectedRouteKey(routeId);
    if (updateUrl) {
      syncRouteKeyToUrl(routeId);
    }
    return true;
  }

  getRouteSummary(routeId: string): RouteSummary | undefined {
    return this.availableRoutes().find((r) => r.id === routeId);
  }
}

