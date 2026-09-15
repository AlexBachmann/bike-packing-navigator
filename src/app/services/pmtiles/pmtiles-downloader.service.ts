import { Injectable, inject, signal } from '@angular/core';
import { resolveBaseHref } from '../../interceptors/base-href.interceptor';
import { DownloadProgress } from './pmtiles-composite.model';
import { PmtilesDbService } from './pmtiles-db.service';
import { PmtilesMetadataService } from './pmtiles-metadata.service';

export type ArchiveSaveHandler = (
  routeId: string,
  blob: Blob,
  sectionId?: string,
  sourceUrl?: string
) => Promise<void>;

@Injectable({
  providedIn: 'root'
})
export class PmtilesDownloaderService {
  private readonly dbService = inject(PmtilesDbService);
  private readonly metadataService = inject(PmtilesMetadataService);

  readonly activeDownloads = signal<Record<string, DownloadProgress>>({});

  private archiveSaver: ArchiveSaveHandler = (routeId, blob, sectionId, sourceUrl) => {
    return this.dbService.saveArchive(routeId, blob, sectionId, sourceUrl);
  };

  setArchiveSaver(saver: ArchiveSaveHandler): void {
    this.archiveSaver = saver;
  }

  isDownloading(routeId: string, sectionId?: string): boolean {
    const key = this.dbService.buildKey(routeId, sectionId);
    const p = this.activeDownloads()[key];
    return p?.status === 'downloading';
  }

  getDownloadProgress(routeId: string, sectionId?: string): DownloadProgress | undefined {
    const key = this.dbService.buildKey(routeId, sectionId);
    return this.activeDownloads()[key];
  }

  async downloadArchive(
    routeId: string,
    url: string,
    sectionId?: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<Blob> {
    const progress: DownloadProgress = {
      routeId,
      sectionId,
      loadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      status: 'downloading'
    };
    onProgress?.(progress);

    try {
      const resolvedUrl = resolveBaseHref(url);
      const res = await fetch(resolvedUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const contentLengthHeader = res.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      progress.totalBytes = totalBytes;

      if (!res.body) {
        const blob = await res.blob();
        await this.archiveSaver(routeId, blob, sectionId, url);
        progress.loadedBytes = blob.size;
        progress.percentage = 100;
        progress.status = 'completed';
        onProgress?.(progress);
        return blob;
      }

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loadedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loadedBytes += value.length;
          progress.loadedBytes = loadedBytes;
          if (totalBytes > 0) {
            progress.percentage = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
          }
          onProgress?.({ ...progress });
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
      await this.archiveSaver(routeId, blob, sectionId, url);

      progress.loadedBytes = blob.size;
      progress.percentage = 100;
      progress.status = 'completed';
      onProgress?.(progress);

      return blob;
    } catch (err) {
      progress.status = 'error';
      progress.errorMessage = err instanceof Error ? err.message : String(err);
      onProgress?.(progress);
      throw err;
    }
  }

  async downloadRoute(
    routeId: string,
    sectionId?: string,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<Blob> {
    const key = this.dbService.buildKey(routeId, sectionId);

    // Multi-section download all
    if (this.metadataService.hasSections(routeId) && !sectionId) {
      const sections = this.metadataService.getRouteSections(routeId);
      const totalEstimated = this.metadataService.getEstimatedSizeBytes(routeId);
      let cumulativeLoaded = 0;

      const masterProgress: DownloadProgress = {
        routeId,
        loadedBytes: 0,
        totalBytes: totalEstimated,
        percentage: 0,
        status: 'downloading'
      };
      this.activeDownloads.update((d) => ({ ...d, [routeId]: masterProgress }));
      onProgress?.(masterProgress);

      let lastBlob: Blob = new Blob([]);
      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        try {
          lastBlob = await this.downloadArchive(
            routeId,
            sec.url,
            sec.sectionId,
            (subProgress) => {
              const currentSecLoaded = subProgress.loadedBytes;
              const approxOverallLoaded = cumulativeLoaded + currentSecLoaded;
              const pct = Math.min(99, Math.round((approxOverallLoaded / totalEstimated) * 100));
              const updated: DownloadProgress = {
                routeId,
                loadedBytes: approxOverallLoaded,
                totalBytes: totalEstimated,
                percentage: pct,
                status: 'downloading'
              };
              this.activeDownloads.update((d) => ({ ...d, [routeId]: updated }));
              onProgress?.(updated);
            }
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorProgress: DownloadProgress = {
            routeId,
            sectionId: sec.sectionId,
            loadedBytes: cumulativeLoaded,
            totalBytes: totalEstimated,
            percentage: 0,
            status: 'error',
            errorMessage
          };
          this.activeDownloads.update((d) => ({ ...d, [routeId]: errorProgress }));
          onProgress?.(errorProgress);
          throw err;
        }
        cumulativeLoaded += sec.estimatedSizeBytes;
      }

      const completed: DownloadProgress = {
        routeId,
        loadedBytes: totalEstimated,
        totalBytes: totalEstimated,
        percentage: 100,
        status: 'completed'
      };
      this.activeDownloads.update((d) => ({ ...d, [routeId]: completed }));
      onProgress?.(completed);
      return lastBlob;
    }

    // Single section or non-sectioned route
    let url = resolveBaseHref(`/data/routes/${routeId}/corridor.pmtiles`);
    if (sectionId) {
      const sec = this.metadataService.getRouteSections(routeId).find((s) => s.sectionId === sectionId);
      url = sec ? sec.url : resolveBaseHref(`/data/routes/${routeId}/section-${sectionId}.pmtiles`);
    }

    const progressTracker = (p: DownloadProgress) => {
      this.activeDownloads.update((d) => ({ ...d, [key]: p }));
      if (sectionId) {
        this.activeDownloads.update((d) => ({ ...d, [routeId]: p }));
      }
      onProgress?.(p);
    };

    try {
      const blob = await this.downloadArchive(routeId, url, sectionId, progressTracker);
      return blob;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorProgress: DownloadProgress = {
        routeId,
        sectionId,
        loadedBytes: 0,
        totalBytes: 0,
        percentage: 0,
        status: 'error',
        errorMessage
      };
      progressTracker(errorProgress);
      throw err;
    }
  }
}
