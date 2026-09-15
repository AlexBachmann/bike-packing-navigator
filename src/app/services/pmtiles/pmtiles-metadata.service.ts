import { Injectable, inject } from '@angular/core';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';
import { RouteSectionMeta } from './pmtiles-composite.model';
import { PmtilesDbService } from './pmtiles-db.service';

@Injectable({
  providedIn: 'root'
})
export class PmtilesMetadataService {
  private readonly dbService = inject(PmtilesDbService);

  hasSections(routeId: string): boolean {
    return routeId === 'tour-divide-2025';
  }

  getRouteSections(routeId: string): RouteSectionMeta[] {
    if (routeId === 'tour-divide-2025') {
      return [
        {
          sectionId: '1',
          name: 'Section 1: Canada & Montana',
          filename: 'section-1.pmtiles',
          estimatedSizeBytes: 28 * 1024 * 1024,
          url: resolveBaseHref('/data/routes/tour-divide-2025/section-1.pmtiles')
        },
        {
          sectionId: '2',
          name: 'Section 2: Wyoming',
          filename: 'section-2.pmtiles',
          estimatedSizeBytes: 22 * 1024 * 1024,
          url: resolveBaseHref('/data/routes/tour-divide-2025/section-2.pmtiles')
        },
        {
          sectionId: '3',
          name: 'Section 3: Colorado',
          filename: 'section-3.pmtiles',
          estimatedSizeBytes: 35 * 1024 * 1024,
          url: resolveBaseHref('/data/routes/tour-divide-2025/section-3.pmtiles')
        },
        {
          sectionId: '4',
          name: 'Section 4: New Mexico',
          filename: 'section-4.pmtiles',
          estimatedSizeBytes: 25 * 1024 * 1024,
          url: resolveBaseHref('/data/routes/tour-divide-2025/section-4.pmtiles')
        }
      ];
    }

    return [
      {
        sectionId: 'full',
        name: 'Full Route Corridor',
        filename: 'corridor.pmtiles',
        estimatedSizeBytes: this.getEstimatedSizeBytes(routeId),
        url: resolveBaseHref(`/data/routes/${routeId}/corridor.pmtiles`)
      }
    ];
  }

  getEstimatedSizeBytes(routeId: string): number {
    switch (routeId) {
      case 'tour-divide-2025':
        return 110 * 1024 * 1024;
      case 'silk-road-mountain-race-2026':
        return 65 * 1024 * 1024;
      case 'atlas-mountain-race-2026':
        return 45 * 1024 * 1024;
      case 'hellenic-mountain-race-2026':
        return 35 * 1024 * 1024;
      case 'highland-trail-550':
        return 30 * 1024 * 1024;
      case 'colorado-trail':
        return 25 * 1024 * 1024;
      case 'arizona-trail-300':
      default:
        return 15 * 1024 * 1024;
    }
  }

  getEstimatedSize(routeId: string): string {
    if (this.hasSections(routeId)) {
      const sections = this.getRouteSections(routeId);
      const totalMb = Math.round(this.getEstimatedSizeBytes(routeId) / (1024 * 1024));
      return `~${totalMb} MB (${sections.length} sections)`;
    }
    const mb = Math.round(this.getEstimatedSizeBytes(routeId) / (1024 * 1024));
    return `~${mb} MB`;
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  async getStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }> {
    const usedBytes = await this.dbService.getTotalStorageBytes();
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        return { usedBytes: est.usage ?? usedBytes, quotaBytes: est.quota ?? (50 * 1024 * 1024 * 1024) };
      } catch {
        // Fall back to estimated
      }
    }
    return { usedBytes, quotaBytes: 50 * 1024 * 1024 * 1024 };
  }
}
