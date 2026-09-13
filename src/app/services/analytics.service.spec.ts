import { TestBed } from '@angular/core/testing';
import { AnalyticsService, GA_MEASUREMENT_ID } from './analytics.service';
import { SettingsService } from './settings.service';
import { NetworkStatusService } from './network-status.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let settingsService: SettingsService;
  let networkStatusService: NetworkStatusService;
  let gtagSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    gtagSpy = vi.fn();
    window.gtag = gtagSpy as any;
    delete (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`];

    TestBed.configureTestingModule({
      providers: [AnalyticsService, SettingsService, NetworkStatusService]
    });

    service = TestBed.inject(AnalyticsService);
    settingsService = TestBed.inject(SettingsService);
    networkStatusService = TestBed.inject(NetworkStatusService);
  });

  afterEach(() => {
    delete (window as any).gtag;
    localStorage.clear();
  });

  it('should be created and default to active telemetry if DNT is false', () => {
    expect(service).toBeTruthy();
    expect(service.isTelemetryActive()).toBe(true);
  });

  describe('Data Sanitization & Anonymization', () => {
    it('should strip exact GPS coordinates (lat, lng, coord) and PII while preserving broad location', () => {
      const rawParams = {
        route_id: 'tour-divide-2025',
        latitude: 45.123456,
        longitude: -112.987654,
        rider_lat: 44.1,
        rider_lng: -111.2,
        user_email: 'test@example.com',
        user_name: 'Cyclist',
        category: 'water',
        total_miles: 2700,
        nested_geo: { type: 'Point', coordinates: [1, 2] },
        // Safe broad location parameters:
        route_state: 'MT',
        nearest_town: 'Near Butte',
        mile_bucket: '350-400mi',
        approx_lat: 45.1234, // will be coarsened to 45.1
        approx_lng: -112.987, // will be coarsened to -113.0
        geo_grid: '45.1,-113.0'
      };

      const sanitized = service.sanitizeParams(rawParams);

      expect(sanitized).toEqual({
        route_id: 'tour-divide-2025',
        category: 'water',
        total_miles: 2700,
        route_state: 'MT',
        nearest_town: 'Near Butte',
        mile_bucket: '350-400mi',
        approx_lat: 45.1,
        approx_lng: -113.0,
        geo_grid: '45.1,-113.0'
      });
      expect(sanitized['latitude']).toBeUndefined();
      expect(sanitized['longitude']).toBeUndefined();
      expect(sanitized['rider_lat']).toBeUndefined();
      expect(sanitized['user_email']).toBeUndefined();
      expect(sanitized['nested_geo']).toBeUndefined();
    });

    it('should automatically include broad location context in tracked events', () => {
      networkStatusService.setOnline(true);
      service.setBroadLocation({
        route_state: 'CO',
        nearest_town: 'Near Salida',
        mile_bucket: '1600-1650mi',
        approx_lat: 38.5,
        approx_lng: -106.0,
        geo_grid: '38.5,-106.0'
      });

      service.trackEvent('check_forecast', { horizon_hours: 24 });

      expect(gtagSpy).toHaveBeenCalledWith('event', 'check_forecast', {
        route_state: 'CO',
        nearest_town: 'Near Salida',
        mile_bucket: '1600-1650mi',
        approx_lat: 38.5,
        approx_lng: -106.0,
        geo_grid: '38.5,-106.0',
        horizon_hours: 24
      });
    });
  });

  describe('Online Tracking', () => {
    it('should send events immediately to gtag when online', () => {
      networkStatusService.setOnline(true);
      service.trackEvent('test_event', { step: 1, lat: 45 });

      expect(gtagSpy).toHaveBeenCalledTimes(1);
      expect(gtagSpy).toHaveBeenCalledWith('event', 'test_event', { step: 1 });
      expect(service.pendingEventsCount()).toBe(0);
    });

    it('should track page views with query-free paths', () => {
      networkStatusService.setOnline(true);
      service.trackPageView('Waypoints View', '/waypoints');

      expect(gtagSpy).toHaveBeenCalledWith('event', 'page_view', {
        page_title: 'Waypoints View',
        page_location: '/waypoints',
        page_path: '/waypoints'
      });
    });

    it('should track route loaded events with rounded miles', () => {
      networkStatusService.setOnline(true);
      service.trackRouteLoaded('tour-divide-2025', 'Tour Divide 2025', 2701.8);

      expect(gtagSpy).toHaveBeenCalledWith('event', 'route_loaded', {
        route_id: 'tour-divide-2025',
        route_name: 'Tour Divide 2025',
        total_miles: 2702
      });
    });
  });

  describe('Offline Queueing & Replay', () => {
    it('should queue events when offline and persist to localStorage', () => {
      networkStatusService.setOnline(false);

      service.trackEvent('offline_action', { category: 'food' });

      expect(gtagSpy).not.toHaveBeenCalled();
      expect(service.pendingEventsCount()).toBe(1);
      expect(service.pendingEvents()[0].name).toBe('offline_action');
      expect(service.pendingEvents()[0].params).toEqual({ category: 'food' });

      // Verify localStorage persistence
      const stored = JSON.parse(localStorage.getItem('bp_pending_analytics_events') || '[]');
      expect(stored.length).toBe(1);
      expect(stored[0].name).toBe('offline_action');
    });

    it('should flush queued events when connection comes back online', () => {
      networkStatusService.setOnline(false);
      service.trackEvent('offline_event_1', { id: 1 });
      service.trackEvent('offline_event_2', { id: 2 });

      expect(gtagSpy).not.toHaveBeenCalled();
      expect(service.pendingEventsCount()).toBe(2);

      // Transition to online
      networkStatusService.setOnline(true);
      service.flushPendingQueue();

      expect(gtagSpy).toHaveBeenCalledTimes(2);
      expect(gtagSpy).toHaveBeenCalledWith('event', 'offline_event_1', expect.objectContaining({
        id: 1,
        _offline_replayed: 1
      }));
      expect(gtagSpy).toHaveBeenCalledWith('event', 'offline_event_2', expect.objectContaining({
        id: 2,
        _offline_replayed: 1
      }));
      expect(service.pendingEventsCount()).toBe(0);
    });

    it('should notify Service Worker with FLUSH_OFFLINE_ANALYTICS message when flushing', () => {
      const postMessageSpy = vi.fn();
      (navigator as any).serviceWorker = {
        controller: {
          postMessage: postMessageSpy
        }
      };

      service.flushPendingQueue();

      expect(postMessageSpy).toHaveBeenCalledWith({ type: 'FLUSH_OFFLINE_ANALYTICS' });
    });
  });

  describe('Privacy Controls & Opt-Out', () => {
    it('should not track events when anonymousTelemetryEnabled is false', () => {
      settingsService.setAnonymousTelemetryEnabled(false);
      TestBed.flushEffects();

      expect(service.isTelemetryActive()).toBe(false);
      expect((window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(true);

      service.trackEvent('suppressed_event', { foo: 'bar' });

      expect(gtagSpy).not.toHaveBeenCalled();
      expect(service.pendingEventsCount()).toBe(0);
    });

    it('should clear any pending events when telemetry is disabled', () => {
      networkStatusService.setOnline(false);
      service.trackEvent('queued_before_disable', {});
      expect(service.pendingEventsCount()).toBe(1);

      settingsService.setAnonymousTelemetryEnabled(false);
      TestBed.flushEffects();

      expect(service.pendingEventsCount()).toBe(0);
      expect(localStorage.getItem('bp_pending_analytics_events')).toBeNull();
    });
  });
});
