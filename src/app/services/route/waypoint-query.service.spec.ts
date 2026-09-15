import { TestBed } from '@angular/core/testing';
import { WaypointQueryService } from './waypoint-query.service';
import { RouteLoaderService } from './route-loader.service';
import { SettingsService } from '../settings.service';
import { EtaPhysicsService } from '../eta-physics.service';
import { signal } from '@angular/core';
import { Place } from '../../models/waypoint.model';

describe('WaypointQueryService', () => {
  let service: WaypointQueryService;
  let loaderMock: any;
  let settingsMock: any;
  let etaPhysicsMock: any;

  beforeEach(() => {
    loaderMock = {
      places: signal<Place[]>([])
    };
    settingsMock = {
      paceMode: signal<'speed' | 'power'>('speed')
    };
    etaPhysicsMock = {
      cacheVersion: signal(0),
      calculateEtaSeconds: vi.fn().mockReturnValue(3600)
    };

    TestBed.configureTestingModule({
      providers: [
        WaypointQueryService,
        { provide: RouteLoaderService, useValue: loaderMock },
        { provide: SettingsService, useValue: settingsMock },
        { provide: EtaPhysicsService, useValue: etaPhysicsMock }
      ]
    });

    service = TestBed.inject(WaypointQueryService);
  });

  it('should return empty array if places are empty', () => {
    expect(service.calculateWaypointsAhead(10, 10)).toEqual([]);
  });

  it('should filter out waypoints behind current mile - 0.2', () => {
    loaderMock.places.set([
      { id: 'p1', name: 'Behind', route_mile: 5, category: 'town', type: 'town' },
      { id: 'p2', name: 'Ahead', route_mile: 12, category: 'town', type: 'town' }
    ]);

    const results = service.calculateWaypointsAhead(10, 10);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('p2');
    expect(results[0].distanceAheadMiles).toBe(2);
  });

  it('should format estimated time correctly in Speed Mode', () => {
    loaderMock.places.set([
      { id: 'p1', name: 'Stop 1', route_mile: 15, category: 'grocery', type: 'grocery' },
      { id: 'p2', name: 'Stop 2', route_mile: 35, category: 'campground', type: 'campground' },
      { id: 'p3', name: 'Stop 3', route_mile: 270, category: 'town', type: 'town' }
    ]);

    // 10 mph
    const results = service.calculateWaypointsAhead(10, 10);
    // p1: 5 miles @ 10 mph = 0.5h = 30m
    expect(results[0].estimatedTimeFormatted).toBe('30m');
    // p2: 25 miles @ 10 mph = 2.5h = 2h 30m
    expect(results[1].estimatedTimeFormatted).toBe('2h 30m');
    // p3: 260 miles @ 10 mph = 26h = 1d 2h
    expect(results[2].estimatedTimeFormatted).toBe('1d 2h');
  });

  it('should use etaPhysics.calculateEtaSeconds in Power Mode', () => {
    settingsMock.paceMode.set('power');
    etaPhysicsMock.calculateEtaSeconds.mockReturnValue(7200); // 2 hours

    loaderMock.places.set([
      { id: 'p1', name: 'Climb Summit', route_mile: 20, category: 'poi', type: 'poi' }
    ]);

    const results = service.calculateWaypointsAhead(10, 10);
    expect(etaPhysicsMock.calculateEtaSeconds).toHaveBeenCalledWith(10, 20);
    expect(results[0].estimatedHours).toBe(2);
    expect(results[0].estimatedTimeFormatted).toBe('2h 00m');
  });

  it('should apply category filter and self-service laundry rule', () => {
    loaderMock.places.set([
      { id: 'p1', name: 'Clean Express Laundromat', route_mile: 15, category: 'laundromat', type: 'laundromat' },
      { id: 'p2', name: 'Dry Cleaners Only', route_mile: 16, category: 'laundromat', type: 'laundromat' },
      { id: 'p3', name: 'City Grocery', route_mile: 17, category: 'grocery', type: 'grocery' }
    ]);

    const categories = new Set(['laundromat']);
    const results = service.calculateWaypointsAhead(10, 10, categories);
    // Only p1 matches self-service waschsalon keywords
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('p1');
  });
});
