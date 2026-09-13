import { ChangeDetectionStrategy, Component, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeatherService } from '../../services/weather.service';
import { SettingsService } from '../../services/settings.service';
import { WeatherSegment, WeatherHourPoint } from '../../models/weather.model';

@Component({
  selector: 'app-weather-forecast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weather-forecast.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class WeatherForecastComponent {
  readonly weatherService = inject(WeatherService);
  readonly settingsService = inject(SettingsService);

  readonly close = output<void>();

  readonly twoHourOutlook = this.weatherService.twoHourOutlook;
  readonly selectedSegmentIndex = signal<number>(0);

  readonly isMiles = computed(() => this.settingsService.distanceUnit() === 'miles');

  readonly segments = computed(() => this.weatherService.segmentForecasts());

  readonly activeSegment = computed<WeatherSegment | null>(() => {
    const segs = this.segments();
    if (segs.length === 0) return null;
    const idx = Math.min(this.selectedSegmentIndex(), segs.length - 1);
    return segs[Math.max(0, idx)];
  });

  readonly lastUpdatedFormatted = computed(() => {
    const ts = this.weatherService.lastUpdated();
    if (!ts) return 'Never';
    const minsAgo = Math.floor((Date.now() - ts) / 60000);
    if (minsAgo < 1) return 'Just now';
    if (minsAgo < 60) return `${minsAgo}m ago`;
    const hoursAgo = Math.floor(minsAgo / 60);
    return `${hoursAgo}h ${minsAgo % 60}m ago`;
  });

  selectSegment(index: number): void {
    this.selectedSegmentIndex.set(index);
  }

  onRefresh(force = false): void {
    this.weatherService.refreshWeather(force);
  }

  onClose(): void {
    this.close.emit();
  }

  formatHourTime(isoTime: string): string {
    if (!isoTime) return '';
    const parts = isoTime.split('T');
    if (parts.length < 2) return isoTime;
    return parts[1].slice(0, 5); // "14:00"
  }

  formatDistance(km: number): string {
    return this.isMiles()
      ? (km / 1.60934).toFixed(1) + ' mi'
      : km.toFixed(1) + ' km';
  }

  formatSpeed(kmh: number): string {
    return this.isMiles()
      ? Math.round(kmh / 1.60934) + ' mph'
      : Math.round(kmh) + ' km/h';
  }

  formatPrecip(mm: number): string {
    return this.isMiles()
      ? (mm / 25.4).toFixed(2) + ' in'
      : mm.toFixed(1) + ' mm';
  }
}
