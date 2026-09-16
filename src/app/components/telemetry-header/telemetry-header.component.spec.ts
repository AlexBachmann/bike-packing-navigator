import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TelemetryHeaderComponent } from './telemetry-header.component';
import { RouteDataService } from '../../services/route-data.service';
import { SettingsService } from '../../services/settings.service';
import { GpsState } from '../../models/waypoint.model';
import { RouteSummary } from '../../models/route.model';

describe('TelemetryHeaderComponent', () => {
  let component: TelemetryHeaderComponent;
  let fixture: ComponentFixture<TelemetryHeaderComponent>;
  let settings: SettingsService;

  const defaultGpsState: GpsState = {
    enabled: false,
    loading: false,
    lastUpdated: null,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    error: null,
    projection: null
  };

  const sampleRoute: RouteSummary = {
    id: 'tour-divide-2025',
    name: 'Tour Divide 2025',
    shortName: 'TD',
    badge: 'TD',
    totalDistanceMiles: 2683,
    totalDistanceKm: 4318,
    elevationGainFt: 152000,
    elevationGainM: 46330,
    startLocation: 'Banff, AB',
    endLocation: 'Antelope Wells, NM',
    iconicCheckpoints: ['Banff', 'Sparwood', 'Steamboat Springs', 'Antelope Wells'],
    startCoordinates: [51.1784, -115.5708],
    bounds: [[31.3322, -115.5708], [51.1784, -108.2091]],
    description: 'The iconic GDMBR route'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TelemetryHeaderComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(TelemetryHeaderComponent);
    component = fixture.componentInstance;
    settings = TestBed.inject(SettingsService);

    fixture.componentRef.setInput('availableRoutes', [sampleRoute]);
    fixture.componentRef.setInput('activeRouteId', 'tour-divide-2025');
    fixture.componentRef.setInput('currentMile', 100);
    fixture.componentRef.setInput('isHeaderCollapsed', false);
    fixture.componentRef.setInput('gpsState', defaultGpsState);
    fixture.componentRef.setInput('nextTown', undefined);
    fixture.componentRef.setInput('nextBikeShop', undefined);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render title and route info', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tour Divide 2025');
    expect(el.textContent).toContain('Banff, AB → Antelope Wells, NM');
  });

  it('should correctly select the active route in the dropdown when preselected', () => {
    const ctRoute: RouteSummary = {
      id: 'colorado-trail',
      name: 'Colorado Trail',
      shortName: 'CT',
      badge: 'CT',
      totalDistanceMiles: 535,
      totalDistanceKm: 861,
      elevationGainFt: 89000,
      elevationGainM: 27127,
      startLocation: 'Denver, CO',
      endLocation: 'Durango, CO',
      iconicCheckpoints: ['Denver', 'Durango'],
      startCoordinates: [39.5, -105.1],
      bounds: [[37.3, -107.9], [39.5, -105.1]],
      description: 'The iconic Colorado Trail'
    };
    fixture.componentRef.setInput('availableRoutes', [sampleRoute, ctRoute]);
    fixture.componentRef.setInput('activeRouteId', 'colorado-trail');
    fixture.detectChanges();

    const triggerBtn = fixture.nativeElement.querySelector('button[title*="Click to browse and select bikepacking routes"]');
    expect(triggerBtn).toBeTruthy();
    expect(triggerBtn.textContent).toContain('Colorado Trail');
  });

  it('should emit openRouteModal when route button is clicked', () => {
    let opened = false;
    component.openRouteModal.subscribe(() => {
      opened = true;
    });
    const triggerBtn = fixture.nativeElement.querySelector('button[title*="Click to browse and select bikepacking routes"]') as HTMLButtonElement;
    triggerBtn.click();
    expect(opened).toBe(true);
  });

  it('should render placeholder and hide telemetry card when no route is active', () => {
    fixture.componentRef.setInput('activeRouteId', null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Select a Route...');
    expect(el.textContent).toContain('No route selected');
    expect(el.querySelector('input[type="range"]')).toBeNull();
  });

  it('should emit routeChange when route dropdown selection changes', () => {
    let emittedRoute: string | undefined;
    component.routeChange.subscribe((routeId) => {
      emittedRoute = routeId;
    });
    component.onRouteChange('colorado-trail');
    expect(emittedRoute).toBe('colorado-trail');
  });

  it('should toggle unit when unit button is clicked', () => {
    settings.distanceUnit.set('miles');
    component.toggleUnit();
    expect(settings.distanceUnit()).toBe('km');
    component.toggleUnit();
    expect(settings.distanceUnit()).toBe('miles');
  });

  it('should emit stepLocation on stepper click', () => {
    let emittedDelta: number | undefined;
    component.stepLocation.subscribe((delta) => {
      emittedDelta = delta;
    });
    component.onStepLocation(5);
    expect(emittedDelta).toBe(5);
  });

  it('should emit sliderChange on range change', () => {
    let emittedVal: number | undefined;
    component.sliderChange.subscribe((val) => {
      emittedVal = val;
    });
    component.onSliderChange(150);
    expect(emittedVal).toBe(150);
  });

  it('should emit toggleHeaderCollapse when collapse button clicked', () => {
    let fired = false;
    component.toggleHeaderCollapse.subscribe(() => {
      fired = true;
    });
    const el = fixture.nativeElement as HTMLElement;
    const collapseBtn = el.querySelector('button[title*="Collapse next resupply"]') as HTMLButtonElement;
    collapseBtn.click();
    expect(fired).toBe(true);
  });

  it('should have sticky top-0 z-30 block host classes', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('sticky')).toBe(true);
    expect(el.classList.contains('top-0')).toBe(true);
    expect(el.classList.contains('z-30')).toBe(true);
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should emit toggleGps when GPS button is clicked', () => {
    let fired = false;
    component.toggleGps.subscribe(() => {
      fired = true;
    });
    const el = fixture.nativeElement as HTMLElement;
    const gpsBtn = el.querySelector('button[title*="GPS"]') as HTMLButtonElement;
    gpsBtn.click();
    expect(fired).toBe(true);
  });

  it('should render locating spinner when gpsState loading is true', () => {
    fixture.componentRef.setInput('gpsState', {
      ...defaultGpsState,
      enabled: true,
      loading: true
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Locating...');
  });

  it('should render off-route alert and emit dismissGpsAlert when closed', () => {
    let dismissed = false;
    component.dismissGpsAlert.subscribe(() => {
      dismissed = true;
    });

    fixture.componentRef.setInput('gpsState', {
      ...defaultGpsState,
      enabled: true,
      projection: {
        nearestPoint: [51.0, -114.0, 1000],
        projectedRouteMile: 50.0,
        projectedRouteKm: 80.467,
        distanceMiles: 15.0,
        distanceKm: 24.14,
        isOffRoute: true
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Off-Route Alert (> 10 km)');
    expect(el.textContent).toContain('15.0 mi off route');

    const dismissBtn = el.querySelector('button[title="Dismiss alert"]') as HTMLButtonElement;
    dismissBtn.click();
    expect(dismissed).toBe(true);
  });

  it('should render on-route banner when projection is within 10 km', () => {
    fixture.componentRef.setInput('gpsState', {
      ...defaultGpsState,
      enabled: true,
      projection: {
        nearestPoint: [51.16, -115.56, 1400],
        projectedRouteMile: 10.0,
        projectedRouteKm: 16.09,
        distanceMiles: 0.2,
        distanceKm: 0.32,
        isOffRoute: false
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('On Route:');
    expect(el.textContent).toContain('Mile 10.0');
    expect(el.textContent).toContain('320m off centerline');
  });

  it('should render GPS error banner and emit clearGpsError when closed', () => {
    let cleared = false;
    component.clearGpsError.subscribe(() => {
      cleared = true;
    });

    fixture.componentRef.setInput('gpsState', {
      ...defaultGpsState,
      enabled: true,
      error: 'Location permission denied.'
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Location permission denied.');

    const errorCloseBtn = el.querySelector('.bg-amber-950\\/40 button') as HTMLButtonElement;
    errorCloseBtn.click();
    expect(cleared).toBe(true);
  });

  it('should render next town and next bike shop information with distances', () => {
    fixture.componentRef.setInput('currentMile', 100);
    fixture.componentRef.setInput('nextTown', {
      id: 't1',
      name: 'Eureka',
      category: 'town',
      type: 'town',
      lat: 48.88,
      lon: -115.05,
      route_mile: 120.0
    });
    fixture.componentRef.setInput('nextBikeShop', {
      id: 'b1',
      name: 'The Bike Shop',
      town: 'Eureka',
      category: 'bike_shop',
      type: 'bike_shop',
      lat: 48.88,
      lon: -115.05,
      route_mile: 120.5
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Eureka');
    expect(el.textContent).toContain('+20.0 mi');
    expect(el.textContent).toContain('+20.5 mi');
  });

  it('should adjust power and speed via component methods', () => {
    settings.paceMode.set('power');
    settings.riderPowerWatts.set(150);
    component.adjustPower(10);
    expect(settings.riderPowerWatts()).toBe(160);

    settings.paceMode.set('speed');
    settings.setAvgSpeedMph(10.0);
    component.adjustSpeed(0.5);
    expect(settings.displaySpeed()).toBe(10.5);

    component.togglePaceMode();
    expect(settings.paceMode()).toBe('power');
  });

  it('should render next town and next bike shop in KM mode', () => {
    settings.distanceUnit.set('km');
    fixture.componentRef.setInput('currentMile', 100);
    fixture.componentRef.setInput('nextTown', {
      id: 't1',
      name: 'Eureka',
      category: 'town',
      type: 'town',
      lat: 48.88,
      lon: -115.05,
      route_mile: 120.0
    });
    fixture.componentRef.setInput('nextBikeShop', {
      id: 'b1',
      name: 'The Bike Shop',
      town: 'Eureka',
      category: 'bike_shop',
      type: 'bike_shop',
      lat: 48.88,
      lon: -115.05,
      route_mile: 120.5
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Eureka');
    expect(el.textContent).toContain('+32.2 km');
    expect(el.textContent).toContain('+33.0 km');
  });

  it('should render fallback text when next town and bike shop are undefined', () => {
    fixture.componentRef.setInput('nextTown', undefined);
    fixture.componentRef.setInput('nextBikeShop', undefined);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Route finish ahead');
    expect(el.textContent).toContain('None ahead');
  });

  it('should have type="button" on all interactive buttons', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  it('should set --telemetry-header-height CSS property on documentElement in ngAfterViewInit', () => {
    fixture.detectChanges();
    vi.spyOn(fixture.nativeElement, 'getBoundingClientRect').mockReturnValue({
      height: 160,
      width: 400,
      top: 0,
      bottom: 160,
      left: 0,
      right: 400,
      x: 0,
      y: 0,
      toJSON: () => {}
    });

    component.ngAfterViewInit();
    const val = document.documentElement.style.getPropertyValue('--telemetry-header-height');
    expect(val).toBe('160px');
  });

  describe('GPS Simulator Integration in Telemetry Header', () => {
    it('should render the GPS simulator trigger button in header', () => {
      const simBtn = fixture.nativeElement.querySelector('[data-testid="telemetry-sim-btn"]');
      expect(simBtn).toBeTruthy();
      expect(simBtn.textContent).toContain('Sim');
    });

    it('should toggle simulator modal when simulator button is clicked', () => {
      expect(component.isSimulatorOpen()).toBe(false);
      const simBtn = fixture.nativeElement.querySelector('[data-testid="telemetry-sim-btn"]') as HTMLButtonElement;
      simBtn.click();
      fixture.detectChanges();
      expect(component.isSimulatorOpen()).toBe(true);

      const modal = fixture.nativeElement.querySelector('[data-testid="simulator-modal"]');
      expect(modal).toBeTruthy();

      simBtn.click();
      fixture.detectChanges();
      expect(component.isSimulatorOpen()).toBe(false);
    });

    it('should toggle simulation on and off', () => {
      const mockPoints: [number, number, number, number, number][] = [
        [51.0, -115.0, 1400, 0, 0],
        [51.1, -114.9, 1400, 10, 6.2]
      ];
      component.gpsSimulator.setTrackPoints(mockPoints);
      expect(component.gpsSimulator.running()).toBe(false);
      component.toggleSimulation();
      expect(component.gpsSimulator.running()).toBe(true);

      component.toggleSimulation();
      expect(component.gpsSimulator.running()).toBe(false);
    });

    it('should emit sliderChange with stopMile when toggleSimulation stops simulation', () => {
      settings.distanceUnit.set('miles');
      const mockPoints: [number, number, number, number, number][] = [
        [51.0, -115.0, 1400, 0, 0],
        [51.1, -114.9, 1400, 10, 6.2]
      ];
      component.gpsSimulator.setTrackPoints(mockPoints);
      component.gpsSimulator.seek(3.5);
      component.gpsSimulator.start(15, mockPoints);
      expect(component.gpsSimulator.running()).toBe(true);

      const sliderSpy = vi.spyOn(component.sliderChange, 'emit');
      component.toggleSimulation(); // Stop
      expect(component.gpsSimulator.running()).toBe(false);
      expect(sliderSpy).toHaveBeenCalledWith(3.5);
    });

    it('should emit sliderChange in km when stopping simulation in km mode', () => {
      settings.distanceUnit.set('km');
      const mockPoints: [number, number, number, number, number][] = [
        [51.0, -115.0, 1400, 0, 0],
        [51.1, -114.9, 1400, 10, 6.2]
      ];
      component.gpsSimulator.setTrackPoints(mockPoints);
      component.gpsSimulator.seek(2.0);
      component.gpsSimulator.start(15, mockPoints);

      const sliderSpy = vi.spyOn(component.sliderChange, 'emit');
      component.toggleSimulation(); // Stop
      expect(component.gpsSimulator.running()).toBe(false);
      expect(sliderSpy).toHaveBeenCalledWith(2.0 * 1.60934);
    });

    it('should emit sliderChange(0) when resetSimulation is called', () => {
      const sliderSpy = vi.spyOn(component.sliderChange, 'emit');
      component.resetSimulation();
      expect(component.gpsSimulator.running()).toBe(false);
      expect(sliderSpy).toHaveBeenCalledWith(0);
    });

    it('should update sim speed when onSimSpeedChange is called', () => {
      component.onSimSpeedChange(35);
      expect(component.simSpeedInput()).toBe(35);
    });
  });
});
