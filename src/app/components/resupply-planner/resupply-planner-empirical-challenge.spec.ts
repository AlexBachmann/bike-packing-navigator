import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ResupplyPlannerComponent } from './resupply-planner.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { ResupplyCatalogService } from '../../services/resupply-catalog.service';
import { ResupplyPhysicsService } from '../../services/resupply-physics.service';
import { ResupplyShoppingListService } from '../../services/resupply-shopping-list.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { ToastService } from '../../services/toast.service';
import { Place } from '../../models/waypoint.model';

function makePlace(p: Partial<Place> & { id: string; name: string; category: any; type: string; route_mile: number }): Place {
  return {
    is_in_town: true,
    location: { lat: 45.0, lon: -110.0 },
    distance_to_trail_km: 0.1,
    route_km: p.route_mile * 1.60934,
    ...p
  };
}

describe('ResupplyPlannerComponent Empirical Stress Test (Challenger M2)', () => {
  let component: ResupplyPlannerComponent;
  let fixture: ComponentFixture<ResupplyPlannerComponent>;
  let routeService: RouteDataService;
  let settingsService: SettingsService;
  let catalogService: ResupplyCatalogService;
  let physicsService: ResupplyPhysicsService;

  // Realistic synthetic place dataset covering route miles 0 to 2700 with diverse POI categories
  const testPlaces: Place[] = [
    // Behind Mile 0 (adversarial edge cases)
    makePlace({
      id: 'p-neg1',
      name: 'Pre-Route Staging Cafe',
      category: 'grocery',
      type: 'convenience_store',
      town: 'Banff Outskirts',
      route_mile: -0.5
    }),
    makePlace({
      id: 'p0',
      name: 'Mile 0.00 Boundary Shop',
      category: 'grocery',
      type: 'grocery',
      town: 'Banff',
      route_mile: 0.00
    }),
    makePlace({
      id: 'p0-04',
      name: 'Mile 0.04 Shop Inside Delta Buffer',
      category: 'grocery',
      type: 'grocery',
      town: 'Banff',
      route_mile: 0.04
    }),
    // Ahead of Mile 0 (Resupply vs Non-Resupply)
    makePlace({
      id: 'p0-close-grocery',
      name: 'Banff In-Town Quick Stop',
      category: 'grocery',
      type: 'convenience_store',
      town: 'Banff',
      route_mile: 3.5
    }),
    makePlace({
      id: 'p1-grocery',
      name: 'Banff Gourmet Grocer',
      category: 'grocery',
      type: 'supermarket',
      town: 'Banff',
      route_mile: 12.0
    }),
    makePlace({
      id: 'p1-camp',
      name: 'Two Jack Lakeside Campground',
      category: 'campground',
      type: 'campground',
      town: 'Banff NP',
      route_mile: 6.0
    }),
    makePlace({
      id: 'p1-pass',
      name: 'Spray Lakes Mountain Pass',
      category: 'mountain_pass',
      type: 'pass',
      route_mile: 15.0
    }),
    makePlace({
      id: 'p1-hotel',
      name: 'Canmore Alpine Lodge',
      category: 'hotel',
      type: 'hotel',
      town: 'Canmore',
      route_mile: 22.0
    }),
    makePlace({
      id: 'p1-gas',
      name: 'Canmore Esso & Convenience',
      category: 'gas_station',
      type: 'gas_station',
      town: 'Canmore',
      route_mile: 24.5
    }),
    makePlace({
      id: 'p1-town',
      name: 'Kananaskis Town Centre',
      category: 'town',
      type: 'town',
      town: 'Kananaskis',
      route_mile: 45.0
    }),

    // Around Mile 500
    makePlace({
      id: 'p500-behind',
      name: 'Mile 499.8 Pre-500 Gas Mart',
      category: 'gas_station',
      type: 'gas_station',
      town: 'Seeley Lake Outskirts',
      route_mile: 499.8
    }),
    makePlace({
      id: 'p500-exact',
      name: 'Mile 500.00 Exact Checkpoint',
      category: 'grocery',
      type: 'grocery',
      town: 'Seeley Lake',
      route_mile: 500.00
    }),
    makePlace({
      id: 'p500-camp',
      name: 'Big Larch Campground',
      category: 'campground',
      type: 'campground',
      town: 'Seeley Lake',
      route_mile: 502.0
    }),
    makePlace({
      id: 'p500-close-grocery',
      name: 'Seeley Lake Local Quick Stop',
      category: 'grocery',
      type: 'convenience_store',
      town: 'Seeley Lake',
      route_mile: 504.0
    }),
    makePlace({
      id: 'p500-grocery',
      name: 'Seeley Lake Supermarket',
      category: 'grocery',
      type: 'supermarket',
      town: 'Seeley Lake',
      route_mile: 508.0
    }),
    makePlace({
      id: 'p500-gas',
      name: 'Rover Convenience Store',
      category: 'gas_station',
      type: 'convenience_store',
      town: 'Ovando',
      route_mile: 540.0
    }),
    makePlace({
      id: 'p500-town',
      name: 'Ovando Resupply Post',
      category: 'town',
      type: 'town',
      town: 'Ovando',
      route_mile: 542.2
    }),

    // Around Mile 2500
    makePlace({
      id: 'p2500-behind',
      name: 'Silver City Chevron Behind 2500',
      category: 'gas_station',
      type: 'gas_station',
      town: 'Silver City',
      route_mile: 2498.0
    }),
    makePlace({
      id: 'p2500-exact',
      name: 'Mile 2500.00 Exact Store',
      category: 'grocery',
      type: 'convenience_store',
      town: 'Silver City',
      route_mile: 2500.00
    }),
    makePlace({
      id: 'p2500-camp',
      name: 'Continental Divide Trail Shelter',
      category: 'campground',
      type: 'campground',
      route_mile: 2505.0
    }),
    makePlace({
      id: 'p2500-gas',
      name: 'Separ Roadhouse & Gas',
      category: 'gas_station',
      type: 'gas_station',
      town: 'Separ',
      route_mile: 2548.0
    }),
    makePlace({
      id: 'p2500-town',
      name: 'Hachita Town Depot',
      category: 'town',
      type: 'town',
      town: 'Hachita',
      route_mile: 2630.0
    }),
    makePlace({
      id: 'p2500-finish',
      name: 'Antelope Wells Border Station Store',
      category: 'grocery',
      type: 'convenience_store',
      town: 'Antelope Wells',
      route_mile: 2679.2
    })
  ];

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ResupplyPlannerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RouteDataService,
        SettingsService,
        ResupplyCatalogService,
        ResupplyPhysicsService,
        ResupplyShoppingListService,
        PwaInstallService,
        ToastService
      ]
    }).compileComponents();

    routeService = TestBed.inject(RouteDataService);
    settingsService = TestBed.inject(SettingsService);
    catalogService = TestBed.inject(ResupplyCatalogService);
    physicsService = TestBed.inject(ResupplyPhysicsService);

    routeService.places.set(testPlaces);
    settingsService.setPower(160);
    settingsService.distanceUnit.set('miles');

    fixture = TestBed.createComponent(ResupplyPlannerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentMile', 0);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('1. Empirical Upcoming POI Filtering at Diverse Route Miles', () => {
    describe('At Route Mile 0', () => {
      beforeEach(() => {
        fixture.componentRef.setInput('currentMile', 0);
        fixture.componentRef.setInput('unit', 'miles');
        fixture.detectChanges();
      });

      it('confirms stops behind currentMile or within 10 km are strictly never shown', () => {
        const stops = component.upcomingStops();
        const ids = stops.map((s) => s.id);

        expect(ids).not.toContain('p-neg1');
        expect(ids).not.toContain('p0');
        expect(ids).not.toContain('p0-04');
        expect(ids).not.toContain('p0-close-grocery');
        expect(stops.every((s) => (s.routeMile - 0) * 1.60934 > 10)).toBe(true);
      });

      it('confirms non-resupply POIs (campgrounds, mountain passes, hotels) are completely excluded', () => {
        const stops = component.upcomingStops();
        const names = stops.map((s) => s.name);

        expect(names).not.toContain('Two Jack Lakeside Campground');
        expect(names).not.toContain('Spray Lakes Mountain Pass');
        expect(names).not.toContain('Canmore Alpine Lodge');
      });

      it('confirms valid resupply POIs (grocery, gas, town) ahead are included', () => {
        const stops = component.upcomingStops();
        const names = stops.map((s) => s.name);

        expect(names).toContain('Banff Gourmet Grocer');
        expect(names).toContain('Canmore Esso & Convenience');
        expect(names).toContain('Kananaskis Town Centre');
      });

      it('confirms distance ahead is accurately displayed in active units (miles vs km)', () => {
        // In miles mode
        let stops = component.upcomingStops();
        const banffGrocery = stops.find((s) => s.id === 'p1-grocery')!;
        expect(banffGrocery.distAhead).toBe(12.0);
        expect(banffGrocery.distAheadMiles).toBe(12.0);

        // Switch to km mode
        fixture.componentRef.setInput('unit', 'km');
        fixture.detectChanges();

        stops = component.upcomingStops();
        const banffGroceryKm = stops.find((s) => s.id === 'p1-grocery')!;
        const expectedKm = Math.round(12.0 * 1.60934 * 10) / 10;
        expect(banffGroceryKm.distAhead).toBe(expectedKm);
      });
    });

    describe('At Route Mile 500', () => {
      beforeEach(() => {
        fixture.componentRef.setInput('currentMile', 500);
        fixture.componentRef.setInput('unit', 'miles');
        fixture.detectChanges();
      });

      it('confirms stops behind Mile 500 or within 10 km are never shown', () => {
        const stops = component.upcomingStops();
        const ids = stops.map((s) => s.id);

        expect(ids).not.toContain('p500-behind');
        expect(ids).not.toContain('p500-exact');
        expect(ids).not.toContain('p500-close-grocery');
        expect(ids).not.toContain('p1-grocery');
        expect(ids).not.toContain('p1-gas');
        expect(stops.every((s) => (s.routeMile - 500) * 1.60934 > 10)).toBe(true);
      });

      it('confirms non-resupply POIs (campground at 502.0) are excluded', () => {
        const stops = component.upcomingStops();
        const ids = stops.map((s) => s.id);

        expect(ids).not.toContain('p500-camp');
      });

      it('confirms distance ahead is accurately calculated relative to Mile 500', () => {
        const stops = component.upcomingStops();
        const seeleyGrocery = stops.find((s) => s.id === 'p500-grocery')!;

        // 508.0 - 500.0 = 8.0 miles (12.87 km > 10 km)
        expect(seeleyGrocery.distAhead).toBe(8.0);
        expect(seeleyGrocery.distAheadMiles).toBe(8.0);

        // Switch to km
        fixture.componentRef.setInput('unit', 'km');
        fixture.detectChanges();

        const stopsKm = component.upcomingStops();
        const seeleyGroceryKm = stopsKm.find((s) => s.id === 'p500-grocery')!;
        const expectedKm = Math.round(8.0 * 1.60934 * 10) / 10;
        expect(seeleyGroceryKm.distAhead).toBe(expectedKm);
      });
    });

    describe('At Route Mile 2500', () => {
      beforeEach(() => {
        fixture.componentRef.setInput('currentMile', 2500);
        fixture.componentRef.setInput('unit', 'miles');
        fixture.detectChanges();
      });

      it('confirms stops behind Mile 2500 are never shown and campground excluded', () => {
        const stops = component.upcomingStops();
        const ids = stops.map((s) => s.id);

        expect(ids).not.toContain('p2500-behind');
        expect(ids).not.toContain('p2500-exact');
        expect(ids).not.toContain('p2500-camp');
        expect(stops.every((s) => s.routeMile > 2500.05)).toBe(true);
      });

      it('confirms upcoming stops near terminus are shown with accurate distance ahead', () => {
        const stops = component.upcomingStops();
        const separGas = stops.find((s) => s.id === 'p2500-gas')!;
        const finishStore = stops.find((s) => s.id === 'p2500-finish')!;

        // 2548.0 - 2500.0 = 48.0 miles
        expect(separGas.distAhead).toBe(48.0);
        // 2679.2 - 2500.0 = 179.2 miles
        expect(finishStore.distAhead).toBe(179.2);

        // Switch to km
        fixture.componentRef.setInput('unit', 'km');
        fixture.detectChanges();

        const stopsKm = component.upcomingStops();
        const separGasKm = stopsKm.find((s) => s.id === 'p2500-gas')!;
        const expectedKm = Math.round(48.0 * 1.60934 * 10) / 10;
        expect(separGasKm.distAhead).toBe(expectedKm);
      });
    });
  });

  describe('2. Distance Unit Switching (miles vs km)', () => {
    it('confirms preset chips update between miles (25, 50, 75, 100, 150) and km (40, 80, 120, 160, 240)', () => {
      // Miles mode
      fixture.componentRef.setInput('unit', 'miles');
      fixture.detectChanges();
      expect(component.distancePresets()).toEqual([25, 50, 75, 100, 150]);

      // KM mode
      fixture.componentRef.setInput('unit', 'km');
      fixture.detectChanges();
      expect(component.distancePresets()).toEqual([40, 80, 120, 160, 240]);
    });

    it('confirms custom distance input label and DOM preset chips update cleanly on unit switch', () => {
      component.distanceSelectionMode.set('custom');

      // 1. In miles mode
      fixture.componentRef.setInput('unit', 'miles');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('mi');
      const presetButtonsMiles = el.querySelectorAll('button');
      const milesButtonTexts = Array.from(presetButtonsMiles).map((b) => b.textContent?.trim());
      expect(milesButtonTexts.some((t) => t?.includes('25 mi'))).toBe(true);
      expect(milesButtonTexts.some((t) => t?.includes('50 mi'))).toBe(true);
      expect(milesButtonTexts.some((t) => t?.includes('75 mi'))).toBe(true);
      expect(milesButtonTexts.some((t) => t?.includes('100 mi'))).toBe(true);
      expect(milesButtonTexts.some((t) => t?.includes('150 mi'))).toBe(true);

      // 2. Switch to KM mode
      fixture.componentRef.setInput('unit', 'km');
      fixture.detectChanges();

      expect(el.textContent).toContain('km');
      const presetButtonsKm = el.querySelectorAll('button');
      const kmButtonTexts = Array.from(presetButtonsKm).map((b) => b.textContent?.trim());
      expect(kmButtonTexts.some((t) => t?.includes('40 km'))).toBe(true);
      expect(kmButtonTexts.some((t) => t?.includes('80 km'))).toBe(true);
      expect(kmButtonTexts.some((t) => t?.includes('120 km'))).toBe(true);
      expect(kmButtonTexts.some((t) => t?.includes('160 km'))).toBe(true);
      expect(kmButtonTexts.some((t) => t?.includes('240 km'))).toBe(true);
    });

    it('confirms targetDistanceMiles calculates accurately depending on unit', () => {
      // 50 miles in miles mode = 50 miles
      fixture.componentRef.setInput('unit', 'miles');
      component.setCustomDistance(50);
      fixture.detectChanges();
      expect(component.targetDistanceMiles()).toBe(50);

      // 80 km in km mode = 80 / 1.60934 miles (~49.71 miles)
      fixture.componentRef.setInput('unit', 'km');
      component.setCustomDistance(80);
      fixture.detectChanges();
      expect(component.targetDistanceMiles()).toBeCloseTo(49.71, 1);
    });

    it('confirms manual custom distance input change handles numeric values cleanly', () => {
      component.onCustomDistanceInputChange(65.5);
      expect(component.targetDistance()).toBe(65.5);

      component.adjustDistance(5);
      expect(component.targetDistance()).toBe(70.5);

      component.adjustDistance(-10);
      expect(component.targetDistance()).toBe(60.5);
    });
  });

  describe('3. Physiological Sliders & Caloric Stepper', () => {
    it('verifies day schedule breakdown updates dynamically when adjusting riding %', () => {
      component.setCustomDistance(100); // 100 miles
      component.dailyRidingPercent.set(60);
      const summary60 = component.dayScheduleSummary();

      component.onRidingPercentChange(40);
      const summary40 = component.dayScheduleSummary();

      // Lower riding % means lower daily riding hours, higher off-bike hours, longer total elapsed time
      expect(summary40.daytimeOffBikeHours).toBeGreaterThan(summary60.daytimeOffBikeHours);
      expect(summary40.totalElapsedHours).toBeGreaterThan(summary60.totalElapsedHours);

      component.onRidingPercentChange(80);
      const summary80 = component.dayScheduleSummary();
      expect(summary80.totalElapsedHours).toBeLessThan(summary40.totalElapsedHours);
    });

    it('verifies day schedule breakdown updates dynamically when adjusting sleep hours', () => {
      component.setCustomDistance(150); // 150 miles push requiring sleep
      component.targetSleepHours.set(6.0);
      const summary6h = component.dayScheduleSummary();

      component.onSleepHoursChange(8.5);
      const summary8h = component.dayScheduleSummary();

      expect(summary8h.sleepHours).toBeGreaterThan(summary6h.sleepHours);
      expect(summary8h.totalElapsedHours).toBeGreaterThan(summary6h.totalElapsedHours);
    });

    it('verifies nightfall sleep block triggers when push extends past 21:00 dusk', () => {
      // Short push (15 miles @ ~15mph -> ~1 hour ride) starting at 8:00 AM arrives ~9:00 AM
      component.setCustomDistance(15);
      const shortSummary = component.dayScheduleSummary();

      expect(shortSummary.arrivesAfterNightfall).toBe(false);
      expect(shortSummary.sleepCyclesCount).toBe(0);
      expect(shortSummary.sleepHours).toBe(0);

      // Long push (150 miles @ ~12mph -> >12 hours ride) starting at 8:00 AM arrives past 21:00 dusk
      component.setCustomDistance(150);
      const longSummary = component.dayScheduleSummary();

      expect(longSummary.arrivesAfterNightfall).toBe(true);
      expect(longSummary.sleepCyclesCount).toBeGreaterThanOrEqual(1);
      expect(longSummary.sleepHours).toBeGreaterThanOrEqual(component.targetSleepHours());
      expect(longSummary.prepWakeHours).toBe(1.0); // 30m prep + 30m wake
    });

    it('verifies caloric target displays default 0% safety buffer and adjusts by +/- 5% buffer steps', () => {
      component.setCustomDistance(50);
      const initialTargets = component.nutrientTargets();

      // Default 0% safety buffer
      expect(initialTargets.safetyBufferPercent).toBe(0);
      expect(initialTargets.safetyBufferCalories).toBe(0);
      expect(initialTargets.totalCaloriesTarget).toBe(initialTargets.baseCalories);

      // Interactive +5% buffer adjustment
      component.adjustBufferPercent(5);
      const steppedUp = component.nutrientTargets();
      expect(steppedUp.safetyBufferPercent).toBe(5);
      expect(steppedUp.safetyBufferCalories).toBe(Math.round(initialTargets.baseCalories * 0.05));
      expect(steppedUp.totalCaloriesTarget).toBe(initialTargets.baseCalories + Math.round(initialTargets.baseCalories * 0.05));

      // Another +5% buffer (10% total)
      component.adjustBufferPercent(5);
      const steppedUp2 = component.nutrientTargets();
      expect(steppedUp2.safetyBufferPercent).toBe(10);
      expect(steppedUp2.safetyBufferCalories).toBe(Math.round(initialTargets.baseCalories * 0.10));
      expect(steppedUp2.totalCaloriesTarget).toBe(initialTargets.baseCalories + Math.round(initialTargets.baseCalories * 0.10));

      // Decrement by 5%
      component.adjustBufferPercent(-5);
      const steppedDown = component.nutrientTargets();
      expect(steppedDown.safetyBufferPercent).toBe(5);
      expect(steppedDown.safetyBufferCalories).toBe(Math.round(initialTargets.baseCalories * 0.05));

      // Stepping down to -5% deficit
      component.adjustBufferPercent(-10);
      const deficit = component.nutrientTargets();
      expect(deficit.safetyBufferPercent).toBe(-5);
      expect(deficit.safetyBufferCalories).toBe(Math.round(initialTargets.baseCalories * -0.05));

      // Catalog reset restores safety buffer to 0% and user adjustment to 0
      component.confirmResetAll();
      const resetTargets = component.nutrientTargets();
      expect(resetTargets.safetyBufferPercent).toBe(0);
      expect(resetTargets.safetyBufferCalories).toBe(0);
      expect(resetTargets.totalCaloriesTarget).toBe(initialTargets.baseCalories);
    });
  });
});
