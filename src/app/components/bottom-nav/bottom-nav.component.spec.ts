import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BottomNavComponent } from './bottom-nav.component';
import { NavigationTab } from '../../models/settings.model';

describe('BottomNavComponent', () => {
  let component: BottomNavComponent;
  let fixture: ComponentFixture<BottomNavComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BottomNavComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(BottomNavComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('activeTab', 'waypoints');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render all 6 tabs', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(6);
    expect(el.textContent).toContain('Ride');
    expect(el.textContent).toContain('Waypoints');
    expect(el.textContent).toContain('Profile');
    expect(el.textContent).toContain('Map');
    expect(el.textContent).toContain('Resupply');
    expect(el.textContent).toContain('Settings');
  });

  it('should emit tabChange when clicking a tab button', () => {
    let changedTab: NavigationTab | undefined;
    component.tabChange.subscribe((tab) => {
      changedTab = tab;
    });

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    // Button index 2 is Profile
    buttons[2].click();
    expect(changedTab).toBe('profile');
  });

  it('should highlight active tab with emerald text class', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons[0].classList.contains('text-emerald-400')).toBe(false);
    expect(buttons[1].classList.contains('text-emerald-400')).toBe(true);
    expect(buttons[2].classList.contains('text-emerald-400')).toBe(false);

    fixture.componentRef.setInput('activeTab', 'ride');
    fixture.detectChanges();
    expect(buttons[0].classList.contains('text-emerald-400')).toBe(true);
    expect(buttons[1].classList.contains('text-emerald-400')).toBe(false);

    fixture.componentRef.setInput('activeTab', 'profile');
    fixture.detectChanges();
    expect(buttons[2].classList.contains('text-emerald-400')).toBe(true);
  });

  it('should have block host class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should emit correct tab for each button clicked', () => {
    const emittedTabs: string[] = [];
    component.tabChange.subscribe((tab) => {
      emittedTabs.push(tab);
    });

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    // tabs: ride (0), waypoints (1), profile (2), map (3), resupply (4), settings (5)
    buttons[0].click();
    buttons[1].click();
    buttons[3].click();
    buttons[4].click();
    buttons[5].click();

    expect(emittedTabs).toEqual(['ride', 'waypoints', 'map', 'resupply', 'settings']);
  });

  it('should have accessibility attributes including aria-label, type="button", and aria-current', () => {
    const el = fixture.nativeElement as HTMLElement;
    const nav = el.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Main navigation');

    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(6);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });

    // activeTab is 'waypoints' (button 1)
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    expect(buttons[1].getAttribute('aria-current')).toBe('page');

    fixture.componentRef.setInput('activeTab', 'ride');
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-current')).toBe('page');
    expect(buttons[1].getAttribute('aria-current')).toBeNull();

    fixture.componentRef.setInput('activeTab', 'settings');
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    expect(buttons[5].getAttribute('aria-current')).toBe('page');
  });
});
