import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef } from '@angular/core';
import { SettingsOfflineMapsComponent } from './settings-offline-maps.component';
import { PmtilesStorageService } from '../../services/pmtiles-storage.service';
import { SettingsService } from '../../services/settings.service';
import { RouteSummary } from '../../models/route.model';

const MOCK_ROUTES: RouteSummary[] = [
  {
    id: 'tour-divide-2025',
    name: 'Tour Divide 2025',
    shortName: 'Tour Divide',
    badge: 'TD',
    totalDistanceKm: 4418,
    totalDistanceMiles: 2745,
    distanceKm: 4418,
    distanceMiles: 2745,
    elevationGainM: 45000,
    elevationGainFt: 147637,
    elevationGainMeters: 45000,
    elevationGainFeet: 147637,
    highestElevationMeters: 3630,
    highestElevationFeet: 11911,
    startLocation: 'Banff, Alberta, Canada',
    endLocation: 'Antelope Wells, New Mexico, USA',
    startCoordinates: [51.1784, -115.5708],
    bounds: [[31, -116], [52, -105]],
    iconicCheckpoints: ['Banff', 'Antelope Wells'],
    description: 'Premier bikepacking route along the Continental Divide.'
  },
  {
    id: 'colorado-trail',
    name: 'Colorado Trail',
    shortName: 'Colorado Trail',
    badge: 'CT',
    totalDistanceKm: 861,
    totalDistanceMiles: 535,
    distanceKm: 861,
    distanceMiles: 535,
    elevationGainM: 27000,
    elevationGainFt: 89000,
    elevationGainMeters: 27000,
    elevationGainFeet: 89000,
    highestElevationMeters: 4040,
    highestElevationFeet: 13260,
    startLocation: 'Waterton Canyon, CO',
    endLocation: 'Durango, CO',
    startCoordinates: [39.4925, -105.0934],
    bounds: [[37, -108], [40, -105]],
    iconicCheckpoints: ['Waterton Canyon', 'Durango'],
    description: 'Rugged high-elevation trail through the Colorado Rockies.'
  }
];

describe('SettingsOfflineMapsComponent', () => {
  let component: SettingsOfflineMapsComponent;
  let componentRef: ComponentRef<SettingsOfflineMapsComponent>;
  let fixture: ComponentFixture<SettingsOfflineMapsComponent>;
  let pmtilesStorage: PmtilesStorageService;
  let settings: SettingsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsOfflineMapsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsOfflineMapsComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    pmtilesStorage = TestBed.inject(PmtilesStorageService);
    settings = TestBed.inject(SettingsService);
    fixture.detectChanges();
  });

  it('1. should create and have block host class', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList.contains('block')).toBe(true);
  });

  it('2. should display storage quota and usage progress bar correctly', () => {
    componentRef.setInput('totalUsedBytes', 45 * 1024 * 1024);
    componentRef.setInput('quotaBytes', 2 * 1024 * 1024 * 1024);
    componentRef.setInput('storageUsagePercent', 2);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Total Offline Storage');
    expect(el.textContent).toContain('45.0 MB');
    expect(el.textContent).toContain('2.0 GB');

    const progressBar = el.querySelector('.bg-gradient-to-r') as HTMLElement;
    expect(progressBar.style.width).toBe('2%');
  });

  it('3. should switch map renderer and emit setMapRenderer event', () => {
    const emitSpy = vi.spyOn(component.setMapRenderer, 'emit');

    const rasterBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Force Raster'));
    expect(rasterBtn).toBeTruthy();
    rasterBtn!.click();

    expect(settings.mapRenderer()).toBe('raster');
    expect(emitSpy).toHaveBeenCalledWith('raster');

    const autoBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Auto-detect Vector'));
    expect(autoBtn).toBeTruthy();
    autoBtn!.click();

    expect(settings.mapRenderer()).toBe('auto');
    expect(emitSpy).toHaveBeenCalledWith('auto');
  });

  it('4. should render route corridor archive items with badge and size estimate', () => {
    componentRef.setInput('routes', MOCK_ROUTES);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tour Divide 2025');
    expect(el.textContent).toContain('TD');
    expect(el.textContent).toContain('Colorado Trail');
    expect(el.textContent).toContain('CT');
  });

  it('5. should emit downloadRoute event when clicking download button', () => {
    componentRef.setInput('routes', [MOCK_ROUTES[1]]);
    vi.spyOn(pmtilesStorage, 'isRouteCachedSync').mockReturnValue(false);
    vi.spyOn(pmtilesStorage, 'isDownloading').mockReturnValue(false);
    fixture.detectChanges();

    const emitSpy = vi.spyOn(component.downloadRoute, 'emit');
    const dlBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Download'));
    expect(dlBtn).toBeTruthy();
    dlBtn!.click();

    expect(emitSpy).toHaveBeenCalledWith({ routeId: 'colorado-trail', sectionId: undefined });
  });

  it('6. should render live download percentage badge when route is downloading', () => {
    componentRef.setInput('routes', [MOCK_ROUTES[1]]);
    vi.spyOn(pmtilesStorage, 'isDownloading').mockReturnValue(true);
    vi.spyOn(pmtilesStorage, 'getDownloadProgress').mockReturnValue({
      routeId: 'colorado-trail',
      loadedBytes: 25000000,
      totalBytes: 50000000,
      percentage: 50,
      status: 'downloading'
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('50%');
    expect(el.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('7. should toggle multi-section expansion and emit toggleRouteSections event', () => {
    componentRef.setInput('routes', [MOCK_ROUTES[0]]);
    fixture.detectChanges();
    const emitSpy = vi.spyOn(component.toggleRouteSections, 'emit');

    const sectionsBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.includes('Sections'));
    expect(sectionsBtn).toBeTruthy();
    sectionsBtn!.click();

    expect(emitSpy).toHaveBeenCalledWith('tour-divide-2025');
  });

  it('8. should render section rows and trigger section download when expanded', () => {
    componentRef.setInput('routes', [MOCK_ROUTES[0]]);
    componentRef.setInput('expandedRoutes', new Set(['tour-divide-2025']));
    vi.spyOn(pmtilesStorage, 'isRouteCachedSync').mockReturnValue(false);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Route Sections (Modular Download)');

    const emitSpy = vi.spyOn(component.downloadRoute, 'emit');
    const sectionDlBtns = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .filter((b) => b.textContent?.includes('Download'));
    expect(sectionDlBtns.length).toBeGreaterThan(1);
    sectionDlBtns[1].click();

    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ routeId: 'tour-divide-2025' }));
  });

  it('9. should render Re-download and Delete buttons when route is cached', () => {
    componentRef.setInput('routes', [MOCK_ROUTES[1]]);
    vi.spyOn(pmtilesStorage, 'isRouteCachedSync').mockReturnValue(true);
    vi.spyOn(pmtilesStorage, 'isDownloading').mockReturnValue(false);
    fixture.detectChanges();

    const dlEmitSpy = vi.spyOn(component.downloadRoute, 'emit');
    const delEmitSpy = vi.spyOn(component.deleteRoute, 'emit');

    const reDownloadBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Re-download');
    expect(reDownloadBtn).toBeTruthy();
    reDownloadBtn!.click();
    expect(dlEmitSpy).toHaveBeenCalledWith({ routeId: 'colorado-trail', sectionId: undefined });

    const deleteBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Delete');
    expect(deleteBtn).toBeTruthy();
    deleteBtn!.click();
    expect(delEmitSpy).toHaveBeenCalledWith({ routeId: 'colorado-trail', sectionId: undefined });
  });

  it('10. should handle wipe all archives modal workflow', () => {
    const openSpy = vi.spyOn(component.openWipeConfirm, 'emit');
    const cancelSpy = vi.spyOn(component.cancelWipeConfirm, 'emit');
    const confirmSpy = vi.spyOn(component.confirmWipeAllArchives, 'emit');

    const wipeTriggerBtn = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Wipe All Archives');
    expect(wipeTriggerBtn).toBeTruthy();
    wipeTriggerBtn!.click();
    expect(openSpy).toHaveBeenCalled();

    // Show modal via input
    componentRef.setInput('showWipeConfirm', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Wipe Offline Map Archives?');

    const cancelBtn = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Cancel');
    expect(cancelBtn).toBeTruthy();
    cancelBtn!.click();
    expect(cancelSpy).toHaveBeenCalled();

    const confirmBtn = Array.from(el.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Yes, Wipe Archives');
    expect(confirmBtn).toBeTruthy();
    confirmBtn!.click();
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('11. should enforce type="button" on all interactive buttons', () => {
    componentRef.setInput('showWipeConfirm', true);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });
});
