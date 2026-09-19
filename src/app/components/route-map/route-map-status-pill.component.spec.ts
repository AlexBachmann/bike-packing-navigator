import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteMapStatusPillComponent } from './route-map-status-pill.component';
import { describe, it, expect, beforeEach } from 'vitest';

describe('RouteMapStatusPillComponent', () => {
  let component: RouteMapStatusPillComponent;
  let fixture: ComponentFixture<RouteMapStatusPillComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteMapStatusPillComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RouteMapStatusPillComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('currentMile', 125.4);
    fixture.componentRef.setInput('unit', 'miles');
    fixture.componentRef.setInput('activeMapMode', 'raster');
    fixture.componentRef.setInput('isVectorCached', false);
    fixture.componentRef.setInput('isDownloading', false);
    fixture.componentRef.setInput('downloadPercentage', 0);
    fixture.componentRef.setInput('activeRouteSizeEstimate', '~24 MB');
    fixture.componentRef.setInput('isForcedRaster', false);
    fixture.detectChanges();
  });

  it('1. should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('2. should render position telemetry in miles and km correctly', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Mile 125.4');

    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();
    expect(el.textContent).toContain('KM 201.8');
  });

  it('3. should render Raster Map indicator when in raster mode', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Raster Map');
  });

  it('4. should render Vector (Offline ready) indicator and switch to raster button when in vector mode', () => {
    fixture.componentRef.setInput('activeMapMode', 'vector');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Vector (Offline ready)');
    expect(el.textContent).not.toContain('Offline Ready Offline Ready');
    const switchBtn = el.querySelector('button[aria-label="Switch to raster map"]');
    expect(switchBtn).toBeTruthy();
  });

  it('5. should render download button with file size estimate when vector is not cached', () => {
    const el = fixture.nativeElement as HTMLElement;
    const downloadBtn = el.querySelector('button[aria-label="Download offline vector map for active route"]');
    expect(downloadBtn).toBeTruthy();
    expect(downloadBtn?.textContent).toContain('Download Vector (~24 MB)');
  });

  it('6. should emit downloadVector when download button is clicked', () => {
    let downloadClicked = false;
    component.downloadVector.subscribe(() => (downloadClicked = true));

    const downloadBtn = fixture.nativeElement.querySelector(
      'button[aria-label="Download offline vector map for active route"]'
    ) as HTMLButtonElement;
    downloadBtn.click();

    expect(downloadClicked).toBe(true);
  });

  it('7. should render progress bar when downloading', () => {
    fixture.componentRef.setInput('isDownloading', true);
    fixture.componentRef.setInput('downloadPercentage', 65);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('65%');
    expect(el.querySelector('.bg-emerald-500')?.getAttribute('style')).toContain('width: 65%');
  });

  it('8. should render switch to vector button when in raster mode and vector is cached', () => {
    fixture.componentRef.setInput('isVectorCached', true);
    fixture.componentRef.setInput('activeMapMode', 'raster');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Raster Map');
    const switchBtn = el.querySelector('button[aria-label="Switch to vector map"]');
    expect(switchBtn).toBeTruthy();
  });

  it('9. should emit toggleMapMode when raster switch button or vector switch button is clicked', () => {
    let toggleCount = 0;
    component.toggleMapMode.subscribe(() => toggleCount++);

    fixture.componentRef.setInput('activeMapMode', 'vector');
    fixture.detectChanges();

    const toRasterBtn = fixture.nativeElement.querySelector('button[aria-label="Switch to raster map"]') as HTMLButtonElement;
    toRasterBtn.click();
    expect(toggleCount).toBe(1);

    fixture.componentRef.setInput('activeMapMode', 'raster');
    fixture.componentRef.setInput('isVectorCached', true);
    fixture.detectChanges();

    const toVectorBtn = fixture.nativeElement.querySelector('button[aria-label="Switch to vector map"]') as HTMLButtonElement;
    toVectorBtn.click();
    expect(toggleCount).toBe(2);
  });
});
