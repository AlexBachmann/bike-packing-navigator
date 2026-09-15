import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteMapControlsComponent } from './route-map-controls.component';
import { describe, it, expect, beforeEach } from 'vitest';

describe('RouteMapControlsComponent', () => {
  let component: RouteMapControlsComponent;
  let fixture: ComponentFixture<RouteMapControlsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteMapControlsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RouteMapControlsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('mapStyle', 'dark');
    fixture.componentRef.setInput('totalDistanceKm', 4311.8);
    fixture.detectChanges();
  });

  it('1. should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('2. should render all 3 control buttons with type="button" and valid aria-labels', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('3. should format dynamic route distance in fitFullRoute button title and aria-label', () => {
    const el = fixture.nativeElement as HTMLElement;
    const fitBtn = el.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(fitBtn.getAttribute('title')).toContain('4,311.8 km route');
    expect(fitBtn.getAttribute('aria-label')).toContain('4,311.8 km route');
  });

  it('4. should toggle style button icon and title based on mapStyle input', () => {
    const el = fixture.nativeElement as HTMLElement;
    const styleBtn = el.querySelectorAll('button')[2] as HTMLButtonElement;
    expect(styleBtn.textContent).toContain('🗺️');
    expect(styleBtn.getAttribute('title')).toBe('Switch to Topographic Contours');

    fixture.componentRef.setInput('mapStyle', 'topo');
    fixture.detectChanges();

    expect(styleBtn.textContent).toContain('🌓');
    expect(styleBtn.getAttribute('title')).toBe('Switch to Dark Matter Style');
  });

  it('5. should emit centerOnRider, fitFullRoute, and toggleMapStyle on button clicks', () => {
    let centerCalled = false;
    let fitCalled = false;
    let styleCalled = false;

    component.centerOnRider.subscribe(() => (centerCalled = true));
    component.fitFullRoute.subscribe(() => (fitCalled = true));
    component.toggleMapStyle.subscribe(() => (styleCalled = true));

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();

    expect(centerCalled).toBe(true);
    expect(fitCalled).toBe(true);
    expect(styleCalled).toBe(true);
  });
});
