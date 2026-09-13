import { Injectable, inject, signal, effect, computed } from '@angular/core';
import { SettingsService } from './settings.service';
import { NetworkStatusService } from './network-status.service';

export const GA_MEASUREMENT_ID = 'G-GDV26JZZFJ';
const PENDING_EVENTS_STORAGE_KEY = 'bp_pending_analytics_events';

// Exact GPS coordinates and PII are stripped. Broad/coarsened location attributes are permitted.
const SENSITIVE_KEY_PATTERNS = [
  /^lat$/i,
  /^lng$/i,
  /^lon$/i,
  /^latitude$/i,
  /^longitude$/i,
  /^rider_lat/i,
  /^rider_lng/i,
  /^gps_lat/i,
  /^gps_lng/i,
  /^coordinates$/i,
  /email/i,
  /user/i,
  /password/i
];

export interface BroadLocationContext {
  route_state?: string;
  nearest_town?: string;
  mile_bucket?: string;
  approx_lat?: number;
  approx_lng?: number;
  geo_grid?: string;
}

export interface QueuedEvent {
  name: string;
  params: Record<string, any>;
  timestamp: number;
}

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    [key: string]: any;
  }
}

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private readonly settings = inject(SettingsService);
  private readonly networkStatus = inject(NetworkStatusService);

  readonly broadLocation = signal<BroadLocationContext>({});
  readonly pendingEvents = signal<QueuedEvent[]>([]);
  readonly pendingEventsCount = computed(() => this.pendingEvents().length);

  readonly isDntActive = signal<boolean>(
    typeof navigator !== 'undefined' &&
      (navigator.doNotTrack === '1' || (typeof window !== 'undefined' && (window as any).doNotTrack === '1'))
  );

  readonly isTelemetryActive = computed(() => {
    return !this.isDntActive() && this.settings.anonymousTelemetryEnabled();
  });

  constructor() {
    this.loadPendingEvents();

    // Reactively update Google Analytics disable flag based on user telemetry setting & DNT
    effect(() => {
      const active = this.isTelemetryActive();
      if (typeof window !== 'undefined') {
        window[`ga-disable-${GA_MEASUREMENT_ID}`] = !active;
      }
      if (!active) {
        this.clearPendingQueue();
      }
    });

    // Reactively flush queued events when network transitions from offline to online
    effect(() => {
      const isOnline = this.networkStatus.isOnline();
      if (isOnline && this.isTelemetryActive()) {
        this.flushPendingQueue();
      }
    });
  }

  /**
   * Sets or updates current broad location context (state, nearest town, 50-mile bucket, ~11km grid).
   */
  setBroadLocation(context: BroadLocationContext): void {
    this.broadLocation.set(context);
  }

  /**
   * Track an event with user anonymization and offline resilience.
   * If offline or gtag is not loaded, event is queued to IndexedDB/localStorage.
   */
  trackEvent(eventName: string, params: Record<string, any> = {}): void {
    if (!this.isTelemetryActive()) {
      return;
    }

    const broad = this.broadLocation();
    const mergedParams = {
      ...broad,
      ...params
    };
    const sanitizedParams = this.sanitizeParams(mergedParams);

    const isOnline = this.networkStatus.isOnline();
    const hasGtag = typeof window !== 'undefined' && typeof window.gtag === 'function';

    if (isOnline && hasGtag) {
      try {
        window.gtag!('event', eventName, sanitizedParams);
      } catch {
        this.enqueueEvent(eventName, sanitizedParams);
      }
    } else {
      this.enqueueEvent(eventName, sanitizedParams);
    }
  }

  /**
   * Track page or virtual view (scrubbed of query params or personal identifiers).
   */
  trackPageView(pageTitle?: string, pagePath?: string): void {
    const cleanPath = pagePath || (typeof window !== 'undefined' ? window.location.pathname : '/');
    this.trackEvent('page_view', {
      page_title: pageTitle || 'Bike Packing Navigator',
      page_location: cleanPath,
      page_path: cleanPath
    });
  }

  /**
   * Track route loaded event.
   */
  trackRouteLoaded(routeId: string, routeName: string, totalMiles: number): void {
    this.trackEvent('route_loaded', {
      route_id: routeId,
      route_name: routeName,
      total_miles: Math.round(totalMiles)
    });
  }

  /**
   * Track navigation tab switch.
   */
  trackTabChanged(tabName: string): void {
    this.trackEvent('tab_changed', {
      tab_name: tabName
    });
  }

  /**
   * Track waypoint category filter selection.
   */
  trackCategoryFiltered(category: string, activeCount: number): void {
    this.trackEvent('category_filtered', {
      category_name: category,
      active_category_count: activeCount
    });
  }

  /**
   * Track offline caching event.
   */
  trackRouteCachedOffline(routeId: string): void {
    this.trackEvent('route_offline_cached', {
      route_id: routeId
    });
  }

  /**
   * Flushes in-app pending event queue and signals the Service Worker to replay intercepted hits.
   */
  flushPendingQueue(): void {
    const queue = [...this.pendingEvents()];
    if (queue.length === 0) {
      this.notifyServiceWorkerToReplay();
      return;
    }

    const hasGtag = typeof window !== 'undefined' && typeof window.gtag === 'function';
    if (!hasGtag) {
      this.notifyServiceWorkerToReplay();
      return;
    }

    const remaining: QueuedEvent[] = [];
    const now = Date.now();

    for (const item of queue) {
      // Discard items older than 48 hours
      if (now - item.timestamp > 48 * 60 * 60 * 1000) {
        continue;
      }

      try {
        const replayDelay = Math.max(0, now - item.timestamp);
        window.gtag!('event', item.name, {
          ...item.params,
          _offline_replayed: 1,
          _queue_time_ms: replayDelay
        });
      } catch {
        remaining.push(item);
      }
    }

    this.pendingEvents.set(remaining);
    this.savePendingEvents();
    this.notifyServiceWorkerToReplay();
  }

  /**
   * Clears in-app pending queue.
   */
  clearPendingQueue(): void {
    this.pendingEvents.set([]);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(PENDING_EVENTS_STORAGE_KEY);
    }
  }

  /**
   * Sanitize parameters to eliminate exact GPS coordinates or personally identifiable information,
   * while safely preserving coarsened broad location data (1-decimal ~11km grid, state, nearest town, mile bucket).
   */
  sanitizeParams(params: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }

      // Safe coarsened coordinates: enforce rounding to 1 decimal place (~11km / ~7mi radius)
      if (key === 'approx_lat' || key === 'approx_lng') {
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (!isNaN(num)) {
          clean[key] = Math.round(num * 10) / 10;
        }
        continue;
      }

      // Safe broad location string attributes
      if (key === 'geo_grid' || key === 'route_state' || key === 'nearest_town' || key === 'mile_bucket') {
        clean[key] = String(value);
        continue;
      }

      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        continue;
      }

      if (typeof value === 'object') {
        // Drop complex objects/arrays that could leak geo-features
        continue;
      }

      clean[key] = value;
    }

    return clean;
  }

  private enqueueEvent(name: string, params: Record<string, any>): void {
    const event: QueuedEvent = {
      name,
      params,
      timestamp: Date.now()
    };
    this.pendingEvents.update((list) => [...list, event]);
    this.savePendingEvents();
  }

  private loadPendingEvents(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = localStorage.getItem(PENDING_EVENTS_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as QueuedEvent[];
        if (Array.isArray(list)) {
          const now = Date.now();
          const valid = list.filter((item) => now - item.timestamp < 48 * 60 * 60 * 1000);
          this.pendingEvents.set(valid);
        }
      }
    } catch (err) {
      console.warn('Could not load pending analytics events from localStorage:', err);
    }
  }

  private savePendingEvents(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(PENDING_EVENTS_STORAGE_KEY, JSON.stringify(this.pendingEvents()));
    } catch (err) {
      console.warn('Could not save pending analytics events to localStorage:', err);
    }
  }

  private notifyServiceWorkerToReplay(): void {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'FLUSH_OFFLINE_ANALYTICS' });
    }
  }
}
