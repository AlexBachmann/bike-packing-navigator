import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClimbWeatherBreakdownComponent } from './climb-weather-breakdown.component';
import { ClimbKmWeatherPoint } from '../../models/weather.model';

describe('ClimbWeatherBreakdownComponent', () => {
  let component: ClimbWeatherBreakdownComponent;
  let fixture: ComponentFixture<ClimbWeatherBreakdownComponent>;

  const mockPoints: ClimbKmWeatherPoint[] = [
    {
      climbKm: 0,
      routeKm: 100,
      routeMile: 62.137,
      lat: 45.0,
      lon: -110.0,
      elevationM: 1000,
      elevationFt: 3281,
      estimatedArrivalSeconds: 3600,
      estimatedArrivalTimestamp: 1726000000,
      estimatedArrivalFormatted: '14:00',
      weatherAtArrival: {
        tempC: 20,
        tempF: 68,
        precipitationMm: 0,
        precipitationInches: 0,
        windSpeedKmh: 15,
        windSpeedMph: 9,
        windDirectionDeg: 180,
        windCardinal: 'S',
        weatherCode: 0,
        weatherDescription: 'Clear',
        weatherIcon: '☀️',
        isThunderstorm: false
      }
    },
    {
      climbKm: 5,
      routeKm: 105,
      routeMile: 65.244,
      lat: 45.05,
      lon: -110.05,
      elevationM: 1500,
      elevationFt: 4921,
      estimatedArrivalSeconds: 5400,
      estimatedArrivalTimestamp: 1726001800,
      estimatedArrivalFormatted: '14:30',
      weatherAtArrival: {
        tempC: 15,
        tempF: 59,
        precipitationMm: 2.5,
        precipitationInches: 0.1,
        windSpeedKmh: 25,
        windSpeedMph: 16,
        windDirectionDeg: 270,
        windCardinal: 'W',
        weatherCode: 95,
        weatherDescription: 'Thunderstorm',
        weatherIcon: '⚡',
        isThunderstorm: true
      }
    },
    {
      climbKm: 10,
      routeKm: 110,
      routeMile: 68.351,
      lat: 45.1,
      lon: -110.1,
      elevationM: 2000,
      elevationFt: 6562,
      estimatedArrivalSeconds: 7200,
      estimatedArrivalTimestamp: 1726003600,
      estimatedArrivalFormatted: '15:00',
      weatherAtArrival: {
        tempC: 10,
        tempF: 50,
        precipitationMm: 0,
        precipitationInches: 0,
        windSpeedKmh: 30,
        windSpeedMph: 19,
        windDirectionDeg: 315,
        windCardinal: 'NW',
        weatherCode: 1,
        weatherDescription: 'Partly cloudy',
        weatherIcon: '⛅',
        isThunderstorm: false
      }
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClimbWeatherBreakdownComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ClimbWeatherBreakdownComponent);
    component = fixture.componentInstance;
  });

  it('should create the climb weather breakdown component', () => {
    expect(component).toBeTruthy();
  });

  it('should display interval forecast header and point count', () => {
    fixture.componentRef.setInput('kmPoints', mockPoints);
    fixture.detectChanges();

    const countEl = fixture.nativeElement.querySelector('[data-testid="km-points-count"]');
    expect(countEl?.textContent).toContain('3 points');
    const items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items.length).toBe(3);
  });

  it('should label first point as Base, last as Summit, and intermediate points as relative offset', () => {
    fixture.componentRef.setInput('kmPoints', mockPoints);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[0].textContent).toContain('Base');
    expect(items[1].textContent).toContain('+3.1 mi');
    expect(items[2].textContent).toContain('Summit');
  });

  it('should format distances and elevations in miles or km based on unit input', () => {
    fixture.componentRef.setInput('kmPoints', mockPoints);
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    let items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[1].textContent).toContain('+5.0 km');
    expect(items[0].textContent).toContain('KM 100.0');
    expect(items[0].textContent).toContain('1,000 m');

    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[1].textContent).toContain('+3.1 mi');
    expect(items[0].textContent).toContain('Mi 62.1');
    expect(items[0].textContent).toContain('3,281 ft');
  });

  it('should display temperature in °F or °C based on unit input', () => {
    fixture.componentRef.setInput('kmPoints', mockPoints);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    let items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[0].textContent).toContain('68°F');

    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[0].textContent).toContain('20°C');
  });

  it('should highlight thunderstorm intervals with red styling and storm badge', () => {
    fixture.componentRef.setInput('kmPoints', mockPoints);
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[1].classList.contains('bg-rose-950/60')).toBe(true);
    const stormBadge = items[1].querySelector('[data-testid="storm-badge"]');
    expect(stormBadge?.textContent).toContain('⚡ STORM');
  });

  it('should display precipitation in inches/mm or Dry', () => {
    fixture.componentRef.setInput('kmPoints', mockPoints);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.detectChanges();

    let items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[0].textContent).toContain('Dry');
    expect(items[1].textContent).toContain('0.1in');

    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();

    items = fixture.nativeElement.querySelectorAll('[data-testid="km-point-item"]');
    expect(items[1].textContent).toContain('2.5mm');
  });
});
