import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SettingsTabComponent } from './settings-tab.component';
import { SettingsService } from '../../services/settings.service';
import { WakeLockService } from '../../services/wake-lock.service';
import { PwaInstallService } from '../../services/pwa-install.service';

describe('SettingsTabComponent', () => {
  let component: SettingsTabComponent;
  let fixture: ComponentFixture<SettingsTabComponent>;
  let settings: SettingsService;
  let wakeLock: WakeLockService;
  let pwaInstall: PwaInstallService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsTabComponent);
    component = fixture.componentInstance;
    settings = TestBed.inject(SettingsService);
    wakeLock = TestBed.inject(WakeLockService);
    pwaInstall = TestBed.inject(PwaInstallService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle weight unit', () => {
    settings.weightUnit.set('kg');
    settings.toggleWeightUnit();
    expect(settings.weightUnit()).toBe('lbs');
    settings.toggleWeightUnit();
    expect(settings.weightUnit()).toBe('kg');
  });

  it('should switch pace mode', () => {
    settings.setPaceMode('power');
    settings.setPaceMode('speed');
    expect(settings.paceMode()).toBe('speed');
    settings.setPaceMode('power');
    expect(settings.paceMode()).toBe('power');
  });

  it('should switch map style', () => {
    settings.setMapStyle('topo');
    expect(settings.mapStyle()).toBe('topo');
    settings.setMapStyle('dark');
    expect(settings.mapStyle()).toBe('dark');
  });

  it('should open and cancel clear storage confirmation dialog', () => {
    expect(component.showClearConfirm()).toBe(false);
    component.openClearConfirm();
    expect(component.showClearConfirm()).toBe(true);
    component.cancelClearConfirm();
    expect(component.showClearConfirm()).toBe(false);
  });

  it('should clear settings on confirmClearLocalStorage', () => {
    settings.setRiderWeight(90);
    component.openClearConfirm();
    component.confirmClearLocalStorage();
    expect(component.showClearConfirm()).toBe(false);
    expect(settings.riderWeight()).toBeNull();
  });

  it('should have block host class', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('should display total loaded weight summary when weights are present', () => {
    settings.weightUnit.set('kg');
    settings.setRiderWeight(75);
    settings.setBikeWeight(12);
    settings.setWaterCapacity(3);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Total Loaded');
    expect(el.textContent).toContain('90 kg');
  });

  it('should display climb surge and hike-a-bike section in power mode', () => {
    settings.setPaceMode('power');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Climb Surge & Hike-a-Bike Parameters');
  });

  it('should dismiss clear modal when clicking Cancel button in modal', () => {
    component.openClearConfirm();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const cancelBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
    expect(cancelBtn).toBeTruthy();
    cancelBtn!.click();
    fixture.detectChanges();

    expect(component.showClearConfirm()).toBe(false);
  });

  it('should have type="button" on all interactive buttons', () => {
    component.openClearConfirm();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(9); // unit toggle, 2 pace modes, 2 map styles, telemetry toggle, clear storage, modal cancel, modal confirm
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  it('should toggle anonymous telemetry setting', () => {
    expect(component.settings.anonymousTelemetryEnabled()).toBe(true);
    component.settings.toggleAnonymousTelemetry();
    expect(component.settings.anonymousTelemetryEnabled()).toBe(false);
    component.settings.toggleAnonymousTelemetry();
    expect(component.settings.anonymousTelemetryEnabled()).toBe(true);
  });

  it('should display INSTALL REQUIRED badge and install CTA button when wake lock is supported but not standalone', () => {
    wakeLock.isSupported.set(true);
    pwaInstall.setStandaloneForTesting(false);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('INSTALL REQUIRED');
    expect(el.textContent).toContain('App Installation Required');
    expect(el.textContent).toContain('Install App to Enable');

    // Toggle switch should be disabled
    const disabledBtn = el.querySelector('button[disabled]');
    expect(disabledBtn).toBeTruthy();
  });

  it('should call pwaInstall.promptInstall when clicking Install App CTA button', () => {
    wakeLock.isSupported.set(true);
    pwaInstall.setStandaloneForTesting(false);
    const promptSpy = vi.spyOn(pwaInstall, 'promptInstall').mockResolvedValue('instructions_shown');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const ctaButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Install App to Enable')
    );
    expect(ctaButton).toBeTruthy();
    ctaButton!.click();

    expect(promptSpy).toHaveBeenCalled();
  });

  it('should show active toggle switch when running in standalone PWA mode', () => {
    wakeLock.isSupported.set(true);
    pwaInstall.setStandaloneForTesting(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('INSTALL REQUIRED');
    expect(el.textContent).toContain('IDLE');

    const toggleBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('role') === 'switch' && !b.hasAttribute('disabled')
    );
    expect(toggleBtn).toBeTruthy();
  });

  it('should display and close PWA installation instructions modal', () => {
    pwaInstall.showInstallModal.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Install Bikepack Navigator');

    const closeBtn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'Got It'
    );
    expect(closeBtn).toBeTruthy();
    closeBtn!.click();
    fixture.detectChanges();

    expect(pwaInstall.showInstallModal()).toBe(false);
  });
});
