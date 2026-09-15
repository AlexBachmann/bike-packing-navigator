import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RideVectorDownloadCardComponent } from './ride-vector-download-card.component';

describe('RideVectorDownloadCardComponent Unit Tests', () => {
  let component: RideVectorDownloadCardComponent;
  let fixture: ComponentFixture<RideVectorDownloadCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RideVectorDownloadCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RideVectorDownloadCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('1. should render vector map required card with route title and estimated size', () => {
    fixture.componentRef.setInput('routeTitle', 'Colorado Trail');
    fixture.componentRef.setInput('estimatedSize', '38 MB');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('[data-testid="vector-download-card"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Vector Map Required');
    expect(card.textContent).toContain('Colorado Trail');
    expect(card.textContent).toContain('38 MB');
  });

  it('2. should render 1-click download button in idle state and emit download output on click', () => {
    fixture.componentRef.setInput('estimatedSize', '25 MB');
    fixture.componentRef.setInput('isDownloading', false);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('[data-testid="download-vector-btn"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Download Vector Map (25 MB)');
    expect(btn.disabled).toBe(false);

    const spy = vi.fn();
    component.download.subscribe(spy);
    btn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('3. should render progress bar and percentage during active download', () => {
    fixture.componentRef.setInput('isDownloading', true);
    fixture.componentRef.setInput('downloadPercentage', 64);
    fixture.detectChanges();

    const progressBlock = fixture.nativeElement.querySelector('[data-testid="download-progress-block"]');
    expect(progressBlock).toBeTruthy();
    expect(progressBlock.textContent).toContain('Downloading tiles...');
    expect(progressBlock.textContent).toContain('64%');

    const progressBar = progressBlock.querySelector('.bg-gradient-to-r') as HTMLElement;
    expect(progressBar.style.width).toBe('64%');
  });

  it('4. should render disabled button with spinner during active download', () => {
    fixture.componentRef.setInput('isDownloading', true);
    fixture.componentRef.setInput('downloadPercentage', 42);
    fixture.detectChanges();

    const idleBtn = fixture.nativeElement.querySelector('[data-testid="download-vector-btn"]');
    expect(idleBtn).toBeNull();

    const disabledBtn = fixture.nativeElement.querySelector('button[disabled]') as HTMLButtonElement;
    expect(disabledBtn).toBeTruthy();
    expect(disabledBtn.textContent).toContain('Downloading 42%...');

    const spy = vi.fn();
    component.download.subscribe(spy);
    disabledBtn.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it('5. should display error message banner when downloadError is present', () => {
    fixture.componentRef.setInput('downloadError', 'Network timeout while fetching chunk 3');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('[data-testid="vector-download-card"]');
    expect(card.textContent).toContain('⚠️ Network timeout while fetching chunk 3');
  });

  it('6. should not display progress block or error state in idle state', () => {
    fixture.componentRef.setInput('isDownloading', false);
    fixture.componentRef.setInput('downloadError', null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="download-progress-block"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.bg-rose-950\\/60')).toBeNull();
  });

  it('7. should dynamically update progress bar width as download progresses', () => {
    fixture.componentRef.setInput('isDownloading', true);
    fixture.componentRef.setInput('downloadPercentage', 10);
    fixture.detectChanges();

    let progressBar = fixture.nativeElement.querySelector('.bg-gradient-to-r') as HTMLElement;
    expect(progressBar.style.width).toBe('10%');

    fixture.componentRef.setInput('downloadPercentage', 95);
    fixture.detectChanges();

    progressBar = fixture.nativeElement.querySelector('.bg-gradient-to-r') as HTMLElement;
    expect(progressBar.style.width).toBe('95%');
  });

  it('8. should render backdrop overlay covering full parent area with high z-index', () => {
    const card = fixture.nativeElement.querySelector('[data-testid="vector-download-card"]');
    expect(card.classList.contains('absolute')).toBe(true);
    expect(card.classList.contains('inset-0')).toBe(true);
    expect(card.classList.contains('z-40')).toBe(true);
    expect(card.classList.contains('backdrop-blur-md')).toBe(true);
  });
});
