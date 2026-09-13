import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WeatherForecastComponent } from './weather-forecast.component';
import { WeatherService } from '../../services/weather.service';
import { SettingsService } from '../../services/settings.service';
import { WeatherSegment, TwoHourWeatherOutlook } from '../../models/weather.model';

describe('WeatherForecastComponent', () => {
  let component: WeatherForecastComponent;
  let fixture: ComponentFixture<WeatherForecastComponent>;
  let mockWeatherService: any;
  let mockSettingsService: any;
  let twoHourOutlookSignal: ReturnType<typeof signal<TwoHourWeatherOutlook>>;

  const defaultOutlook: TwoHourWeatherOutlook = {
    alertKind: 'normal',
    icon: '☀️',
    badgeText: 'Benign',
    title: 'Clear 2-Hour Trail Outlook',
    summary: 'Clear sky, 16°C',
    detailMessage: 'No thunderstorms, heavy mud, or punishing headwinds forecast for the next 2 hours of travel.',
    advice: 'Smooth conditions ahead. Maintain target cadence and enjoy the trail.'
  };

  const sampleSegment: WeatherSegment = {
    km: 160.0,
    mile: 99.4,
    label: 'Current Location (KM 160.0)',
    lat: 51.17,
    lon: -115.57,
    elevationM: 1400,
    current: {
      time: '2026-09-13T14:00',
      tempC: 16.0,
      tempF: 61,
      precipitationMm: 0.0,
      precipitationInches: 0.0,
      windSpeedKmh: 12.0,
      windSpeedMph: 7.5,
      windDirectionDeg: 315,
      windCardinal: 'NW',
      weatherCode: 2,
      weatherDescription: 'Partly cloudy',
      weatherIcon: '⛅'
    },
    hourly24h: [
      {
        time: '2026-09-13T14:00',
        tempC: 16.0,
        tempF: 61,
        precipitationMm: 0.0,
        precipitationInches: 0.0,
        windSpeedKmh: 12.0,
        windSpeedMph: 7.5,
        windDirectionDeg: 315,
        windCardinal: 'NW',
        weatherCode: 2,
        weatherDescription: 'Partly cloudy',
        weatherIcon: '⛅'
      }
    ]
  };

  beforeEach(async () => {
    twoHourOutlookSignal = signal<TwoHourWeatherOutlook>(defaultOutlook);
    mockWeatherService = {
      segmentForecasts: signal<WeatherSegment[]>([sampleSegment]),
      currentWeather: signal(sampleSegment.current),
      twoHourOutlook: twoHourOutlookSignal,
      lastUpdated: signal(Date.now() - 5 * 60000), // 5m ago
      isLoading: signal(false),
      isStale: signal(false),
      minutesUntilNextAllowedRefresh: signal(25),
      refreshWeather: () => Promise.resolve(true)
    };

    mockSettingsService = {
      distanceUnit: signal<'miles' | 'km'>('km')
    };

    await TestBed.configureTestingModule({
      imports: [WeatherForecastComponent],
      providers: [
        { provide: WeatherService, useValue: mockWeatherService },
        { provide: SettingsService, useValue: mockSettingsService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WeatherForecastComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create WeatherForecastComponent', () => {
    expect(component).toBeTruthy();
    expect(component.segments().length).toBe(1);
    expect(component.activeSegment()?.label).toContain('Current Location');
  });

  it('should display active segment weather condition and temperature', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Trail Weather Forecast');
    expect(el.textContent).toContain('16°C');
    expect(el.textContent).toContain('Partly cloudy');
    expect(el.textContent).toContain('NW');
  });

  it('should render the Next 2 Hours Trail Outlook card with normal benign conditions', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Next 2 Hours • Benign');
    expect(el.textContent).toContain('Clear 2-Hour Trail Outlook');
    expect(el.textContent).toContain('Smooth conditions ahead');
  });

  it('should render Thunderstorm Warning priority card when thunderstorm is forecast within 2 hours', () => {
    twoHourOutlookSignal.set({
      alertKind: 'thunderstorm',
      icon: '⛈️',
      badgeText: 'Thunderstorm',
      title: 'Thunderstorm Warning (Next 2h)',
      summary: 'Thunderstorm forecast in ~45m at KM 175.0',
      detailMessage: 'Thunderstorm conditions forecast along your trail in approximately 45m around KM 175.0. High lightning hazard.',
      advice: 'Avoid exposed peaks and ridgelines. Plan ascent timing carefully.',
      locationKmRange: { startKm: 175.0, endKm: 175.0 },
      etaSeconds: 2700,
      etaFormatted: '45m',
      metrics: {
        precipitationMm: 6.5,
        windSpeedKmh: 42
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Thunderstorm Warning (Next 2h)');
    expect(el.textContent).toContain('In ~45m');
    expect(el.textContent).toContain('175.0 km');
    expect(el.textContent).toContain('High lightning hazard');
    expect(el.textContent).toContain('Avoid exposed peaks');
    expect(el.textContent).toContain('Rain: 6.5 mm/h');
  });

  it('should render Heavy Mud Hazard priority card with soil terrain details', () => {
    twoHourOutlookSignal.set({
      alertKind: 'mud',
      icon: '🚜',
      badgeText: 'Heavy Mud Risk',
      title: 'Heavy Mud Hazard (Next 2h)',
      summary: 'Rain on dirt in ~35m (KM 168.0)',
      detailMessage: 'Rain forecast over mud-susceptible terrain (dirt). Soft dirt turns into unrideable peanut butter clay.',
      advice: 'Anticipate heavy tire packing and unavoidable hike-a-bike.',
      locationKmRange: { startKm: 168.0, endKm: 168.0 },
      etaSeconds: 2100,
      etaFormatted: '35m',
      metrics: {
        precipitationMm: 2.8,
        surface: 'dirt',
        tracktype: 'grade4'
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Heavy Mud Hazard (Next 2h)');
    expect(el.textContent).toContain('In ~35m');
    expect(el.textContent).toContain('Surface: dirt (grade4)');
    expect(el.textContent).toContain('unrideable peanut butter clay');
  });

  it('should render Heavy Headwind advisory card with opposing wind metrics', () => {
    twoHourOutlookSignal.set({
      alertKind: 'headwind',
      icon: '🌬️',
      badgeText: 'Heavy Headwind',
      title: 'Heavy Headwind Ahead (Next 2h)',
      summary: '28 km/h direct headwind in ~50m',
      detailMessage: 'Punishing headwind (28 km/h opposing vector from S) expected around KM 180.0.',
      advice: 'Tuck into an aerodynamic position and pace conservatively.',
      locationKmRange: { startKm: 180.0, endKm: 180.0 },
      etaSeconds: 3000,
      etaFormatted: '50m',
      metrics: {
        windSpeedKmh: 30,
        headwindKmh: 28,
        windCardinal: 'S'
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Heavy Headwind Ahead (Next 2h)');
    expect(el.textContent).toContain('Headwind: 28 km/h (S)');
    expect(el.textContent).toContain('Tuck into an aerodynamic position');
  });

  it('should render Strong Tailwind assist card', () => {
    twoHourOutlookSignal.set({
      alertKind: 'tailwind',
      icon: '💨',
      badgeText: 'Tailwind Boost',
      title: 'Strong Tailwind Assist (Next 2h)',
      summary: '25 km/h tailwind push in ~30m',
      detailMessage: 'Strong aerodynamic assist (25 km/h tailwind push from N) expected around KM 170.0.',
      advice: 'Capitalize on this section to make fast miles.',
      locationKmRange: { startKm: 170.0, endKm: 170.0 },
      etaSeconds: 1800,
      etaFormatted: '30m',
      metrics: {
        windSpeedKmh: 26,
        tailwindKmh: 25,
        windCardinal: 'N'
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Strong Tailwind Assist (Next 2h)');
    expect(el.textContent).toContain('Tailwind: 25 km/h (N)');
    expect(el.textContent).toContain('Capitalize on this section');
  });

  it('should convert units to miles and mph when distanceUnit is miles', () => {
    mockSettingsService.distanceUnit.set('miles');
    twoHourOutlookSignal.set({
      alertKind: 'headwind',
      icon: '🌬️',
      badgeText: 'Heavy Headwind',
      title: 'Heavy Headwind Ahead (Next 2h)',
      summary: 'Headwind ahead',
      detailMessage: 'Opposing wind',
      advice: 'Pace carefully',
      locationKmRange: { startKm: 160.934, endKm: 160.934 },
      etaFormatted: '1h',
      metrics: {
        headwindKmh: 32.1868,
        windCardinal: 'SW',
        precipitationMm: 25.4
      }
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('100.0 mi');
    expect(el.textContent).toContain('20 mph');
    expect(el.textContent).toContain('1.00 in/h');
  });

  it('should emit close when close button is clicked', () => {
    let closed = false;
    component.close.subscribe(() => (closed = true));
    component.onClose();
    expect(closed).toBe(true);
  });
});
