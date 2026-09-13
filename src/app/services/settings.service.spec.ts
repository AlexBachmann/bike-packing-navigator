import { TestBed } from '@angular/core/testing';
import { SettingsService } from './settings.service';
import { ResupplyCatalogService } from './resupply-catalog.service';

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(SettingsService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created with defaults', () => {
    expect(service).toBeTruthy();
    expect(service.riderWeight()).toBeNull();
    expect(service.bikeWeight()).toBeNull();
    expect(service.waterCapacityLiters()).toBeNull();
    expect(service.weightUnit()).toBe('kg');
    expect(service.riderPowerWatts()).toBe(150);
  });

  it('should store and retrieve rider, bike weight, and water capacity', () => {
    service.setRiderWeight(75.5);
    service.setBikeWeight(12.3);
    service.setWaterCapacity(3.5);

    expect(service.riderWeight()).toBe(75.5);
    expect(service.bikeWeight()).toBe(12.3);
    expect(service.waterCapacityLiters()).toBe(3.5);

    // Verify localStorage has saved values
    const raw = localStorage.getItem('tour_divide_user_settings');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.riderWeight).toBe(75.5);
    expect(parsed.bikeWeight).toBe(12.3);
    expect(parsed.waterCapacityLiters).toBe(3.5);
  });

  it('should compute loaded rig metrics', () => {
    service.setRiderWeight(80);
    service.setBikeWeight(14);
    service.setWaterCapacity(4); // 4 liters = 4 kg in 'kg' mode

    expect(service.waterWeightInUnit()).toBe(4.0);
    expect(service.totalBaseWeight()).toBe(94.0);
    expect(service.totalLoadedWeight()).toBe(98.0);
  });

  it('should convert weights when toggling between kg and lbs', () => {
    service.setRiderWeight(100); // 100 kg
    service.setBikeWeight(10);  // 10 kg
    expect(service.weightUnit()).toBe('kg');

    service.toggleWeightUnit();
    expect(service.weightUnit()).toBe('lbs');
    expect(service.riderWeight()).toBeCloseTo(220.5, 0);
    expect(service.bikeWeight()).toBeCloseTo(22.0, 0);

    service.toggleWeightUnit();
    expect(service.weightUnit()).toBe('kg');
    expect(service.riderWeight()).toBeCloseTo(100, 0);
  });

  it('should adjust power in 10W increments and clamp within bounds', () => {
    expect(service.riderPowerWatts()).toBe(150);

    service.adjustPower(10);
    expect(service.riderPowerWatts()).toBe(160);

    service.adjustPower(-20);
    expect(service.riderPowerWatts()).toBe(140);

    // Verify persisted
    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.riderPowerWatts).toBe(140);
  });

  it('should completely clear all local storage and reset signals on clearAllLocalStorage()', () => {
    const resupplyCatalog = TestBed.inject(ResupplyCatalogService);
    resupplyCatalog.deleteRecipe('tuna-sandwich');
    expect(resupplyCatalog.recipes().some((r) => r.id === 'tuna-sandwich')).toBe(false);

    service.setRiderWeight(82);
    service.setBikeWeight(15);
    service.setWaterCapacity(5);
    service.adjustPower(30);
    localStorage.setItem('extra_key', 'test');

    service.clearAllLocalStorage();

    expect(localStorage.getItem('tour_divide_user_settings')).toBeNull();
    expect(localStorage.getItem('extra_key')).toBeNull();
    expect(service.riderWeight()).toBeNull();
    expect(service.bikeWeight()).toBeNull();
    expect(service.waterCapacityLiters()).toBeNull();
    expect(service.riderPowerWatts()).toBe(150);
    expect(service.paceMode()).toBe('power');

    // Resupply catalog was also reset and restored
    expect(resupplyCatalog.recipes().some((r) => r.id === 'tuna-sandwich')).toBe(true);
    expect(resupplyCatalog.isRecipeDeleted('tuna-sandwich')).toBe(false);
  });

  it('should toggle and set pace mode between power and speed', () => {
    expect(service.paceMode()).toBe('power');

    service.togglePaceMode();
    expect(service.paceMode()).toBe('speed');

    // Check localStorage persistence
    let raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.paceMode).toBe('speed');

    service.togglePaceMode();
    expect(service.paceMode()).toBe('power');

    service.setPaceMode('speed');
    expect(service.paceMode()).toBe('speed');
  });

  it('should adjust speed by 0.5 of given unit and round to 0.5 precision', () => {
    expect(service.avgSpeedMph()).toBe(10.5);
    expect(service.displaySpeed()).toBe(10.5);
    expect(service.speedUnit()).toBe('mph');

    // Adjust in miles mode (+0.5)
    service.adjustSpeed(0.5);
    expect(service.avgSpeedMph()).toBe(11.0);
    expect(service.displaySpeed()).toBe(11.0);

    // Decrement in miles mode (-0.5)
    service.adjustSpeed(-0.5);
    expect(service.avgSpeedMph()).toBe(10.5);
    expect(service.displaySpeed()).toBe(10.5);

    // Switch to km
    service.distanceUnit.set('km');
    expect(service.speedUnit()).toBe('kph');
    // 10.5 * 1.609344 = 16.898... rounded to 0.5 precision is 17.0
    expect(service.displaySpeed()).toBe(17.0);

    // Adjust in km mode (+0.5 kph)
    service.adjustSpeed(0.5);
    expect(service.displaySpeed()).toBe(17.5);

    // Adjust in km mode again (+0.5 kph)
    service.adjustSpeed(0.5);
    expect(service.displaySpeed()).toBe(18.0);

    // Decrement in km mode (-0.5 kph)
    service.adjustSpeed(-0.5);
    expect(service.displaySpeed()).toBe(17.5);
  });

  it('should store and compute climb surge and hike-a-bike parameters', () => {
    expect(service.climbSurgePercent()).toBe(10);
    expect(service.climbSurgeDurationMinutes()).toBe(10);
    expect(service.hikeBikeThresholdKmh()).toBe(6.0);
    expect(service.hikeBikeBaseSpeedKmh()).toBe(4.0);

    // Baseline 150W: 10% surge = 165W (+15W)
    expect(service.maxClimbSurgePowerWatts()).toBe(165);
    expect(service.climbSurgeWattsDelta()).toBe(15);

    // Update settings
    service.setClimbSurgePercent(20);
    service.setClimbSurgeDurationMinutes(15);
    service.setHikeBikeThresholdKmh(7.0);
    service.setHikeBikeBaseSpeedKmh(4.5);

    expect(service.climbSurgePercent()).toBe(20);
    expect(service.maxClimbSurgePowerWatts()).toBe(180);
    expect(service.climbSurgeWattsDelta()).toBe(30);
    expect(service.climbSurgeDurationMinutes()).toBe(15);
    expect(service.hikeBikeThresholdKmh()).toBe(7.0);
    expect(service.hikeBikeBaseSpeedKmh()).toBe(4.5);

    // Verify localStorage persistence
    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.climbSurgePercent).toBe(20);
    expect(raw.climbSurgeDurationMinutes).toBe(15);
    expect(raw.hikeBikeThresholdKmh).toBe(7.0);
    expect(raw.hikeBikeBaseSpeedKmh).toBe(4.5);
  });

  it('should adapt hike-a-bike speed display and setters to distanceUnit (miles vs km)', () => {
    // Default in miles mode: 6.0 km/h -> 3.7 mph, 4.0 km/h -> 2.5 mph
    service.distanceUnit.set('miles');
    expect(service.displayHikeBikeThreshold()).toBe(3.7);
    expect(service.displayHikeBikeBaseSpeed()).toBe(2.5);

    // Set in mph while in miles mode
    service.setHikeBikeThresholdInUnit(3.5); // 3.5 mph -> 5.6 km/h
    service.setHikeBikeBaseSpeedInUnit(2.0); // 2.0 mph -> 3.2 km/h
    expect(service.displayHikeBikeThreshold()).toBe(3.5);
    expect(service.displayHikeBikeBaseSpeed()).toBe(2.0);
    expect(service.hikeBikeThresholdKmh()).toBe(5.6);
    expect(service.hikeBikeBaseSpeedKmh()).toBe(3.2);

    // Switch to km mode
    service.distanceUnit.set('km');
    expect(service.displayHikeBikeThreshold()).toBe(5.6);
    expect(service.displayHikeBikeBaseSpeed()).toBe(3.2);

    // Set in km/h while in km mode
    service.setHikeBikeThresholdInUnit(6.0);
    service.setHikeBikeBaseSpeedInUnit(4.0);
    expect(service.hikeBikeThresholdKmh()).toBe(6.0);
    expect(service.hikeBikeBaseSpeedKmh()).toBe(4.0);
    expect(service.displayHikeBikeThreshold()).toBe(6.0);
    expect(service.displayHikeBikeBaseSpeed()).toBe(4.0);
  });

  it('should compute default and customized total system mass in kg', () => {
    // Defaults (null weights): 75 kg rider + 14 kg bike + 0L water = 89 kg
    expect(service.totalSystemMassKg()).toBe(89.0);

    service.setRiderWeight(80.0);
    service.setBikeWeight(15.0);
    service.setWaterCapacity(4.0); // 4L = 4kg
    expect(service.totalSystemMassKg()).toBe(99.0);
  });

  it('should store, toggle, and persist mapStyle', () => {
    expect(service.mapStyle()).toBe('dark');

    service.toggleMapStyle();
    expect(service.mapStyle()).toBe('topo');

    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.mapStyle).toBe('topo');

    service.setMapStyle('dark');
    expect(service.mapStyle()).toBe('dark');

    const raw2 = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw2.mapStyle).toBe('dark');
  });

  it('should store, change, and persist activeTab', () => {
    expect(service.activeTab()).toBe('waypoints');

    service.setActiveTab('profile');
    expect(service.activeTab()).toBe('profile');

    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.activeTab).toBe('profile');

    service.setActiveTab('map');
    expect(service.activeTab()).toBe('map');

    const raw2 = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw2.activeTab).toBe('map');

    service.clearAllLocalStorage();
    expect(service.activeTab()).toBe('waypoints');
    expect(service.currentLocationMile()).toBe(0);
    expect(service.routeLocations()).toEqual({});
  });

  it('should store and retrieve location per route', () => {
    expect(service.getLocationForRoute('tour-divide-2025')).toBe(0);

    service.saveLocation('tour-divide-2025', 152.3);
    expect(service.currentLocationMile()).toBe(152.3);
    expect(service.getLocationForRoute('tour-divide-2025')).toBe(152.3);

    service.saveLocation('colorado-trail', 45.0);
    expect(service.currentLocationMile()).toBe(45.0);
    expect(service.getLocationForRoute('colorado-trail')).toBe(45.0);
    // Previous route location preserved
    expect(service.getLocationForRoute('tour-divide-2025')).toBe(152.3);

    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.currentLocationMile).toBe(45.0);
    expect(raw.routeLocations['tour-divide-2025']).toBe(152.3);
    expect(raw.routeLocations['colorado-trail']).toBe(45.0);
  });

  it('should store, retrieve, and reset mapZoomLevel', () => {
    expect(service.mapZoomLevel()).toBe(8);

    service.setMapZoomLevel(12);
    expect(service.mapZoomLevel()).toBe(12);

    const raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.mapZoomLevel).toBe(12);

    // Clamp extreme zoom levels
    service.setMapZoomLevel(25);
    expect(service.mapZoomLevel()).toBe(18);

    service.setMapZoomLevel(0);
    expect(service.mapZoomLevel()).toBe(2);

    service.clearAllLocalStorage();
    expect(service.mapZoomLevel()).toBe(8);
  });

  it('should store, toggle, and reset keepScreenAwake', () => {
    expect(service.keepScreenAwake()).toBe(true);

    service.setKeepScreenAwake(false);
    expect(service.keepScreenAwake()).toBe(false);

    let raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.keepScreenAwake).toBe(false);

    service.toggleKeepScreenAwake();
    expect(service.keepScreenAwake()).toBe(true);

    raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.keepScreenAwake).toBe(true);

    service.setKeepScreenAwake(false);
    service.clearAllLocalStorage();
    expect(service.keepScreenAwake()).toBe(true);
  });

  it('should store, toggle, and reset anonymousTelemetryEnabled', () => {
    expect(service.anonymousTelemetryEnabled()).toBe(true);

    service.setAnonymousTelemetryEnabled(false);
    expect(service.anonymousTelemetryEnabled()).toBe(false);

    let raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.anonymousTelemetryEnabled).toBe(false);

    service.toggleAnonymousTelemetry();
    expect(service.anonymousTelemetryEnabled()).toBe(true);

    raw = JSON.parse(localStorage.getItem('tour_divide_user_settings')!);
    expect(raw.anonymousTelemetryEnabled).toBe(true);

    service.setAnonymousTelemetryEnabled(false);
    service.clearAllLocalStorage();
    expect(service.anonymousTelemetryEnabled()).toBe(true);
  });
});

