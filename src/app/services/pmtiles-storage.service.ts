import { Injectable, inject } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { Protocol, PMTiles } from 'pmtiles';
import { resolveBaseHref } from '../interceptors/base-href.interceptor';
import {
  BlobSource,
  CompositePMTiles,
  RoutePMTiles,
  RouteSectionMeta,
  StoredPmtilesRecord,
  DownloadProgress
} from './pmtiles/pmtiles-composite.model';
import { PmtilesDbService } from './pmtiles/pmtiles-db.service';
import { PmtilesDownloaderService } from './pmtiles/pmtiles-downloader.service';
import { PmtilesMetadataService } from './pmtiles/pmtiles-metadata.service';

export type { RouteSectionMeta, StoredPmtilesRecord, DownloadProgress };
export { BlobSource, CompositePMTiles, RoutePMTiles };

let protocolRegisteredGlobally = false;

@Injectable({
  providedIn: 'root'
})
export class PmtilesStorageService {
  readonly dbService = inject(PmtilesDbService);
  readonly downloader = inject(PmtilesDownloaderService);
  readonly metadata = inject(PmtilesMetadataService);

  readonly DB_NAME = this.dbService.DB_NAME;
  readonly STORE_NAME = this.dbService.STORE_NAME;

  private protocol: Protocol | null = null;
  private readonly pmtilesInstances = new Map<string, PMTiles>();
  private readonly compositeInstances = new Map<string, CompositePMTiles>();
  private readonly remoteUrlMap = new Map<string, string>();

  readonly activeDownloads = this.downloader.activeDownloads;

  constructor() {
    this.downloader.setArchiveSaver((routeId, blob, sectionId, sourceUrl) => {
      return this.saveArchive(routeId, blob, sectionId, sourceUrl);
    });

    this.initProtocol();
    this.loadCachedArchivesIntoProtocol().catch(() => {});
  }

  initProtocol(): Protocol {
    if (!this.protocol) {
      this.protocol = new Protocol({ metadata: true });
      if (!protocolRegisteredGlobally && typeof maplibregl !== 'undefined') {
        if (typeof maplibregl.setWorkerUrl === 'function') {
          maplibregl.setWorkerUrl(resolveBaseHref('/maplibre-gl-worker.mjs'));
        }
        if (maplibregl.addProtocol) {
          try {
            maplibregl.addProtocol('pmtiles', this.protocol.tile);
            protocolRegisteredGlobally = true;
          } catch {
            // Protocol might already be added
          }
        }
      }
    }
    return this.protocol;
  }

  getProtocol(): Protocol {
    return this.initProtocol();
  }

  private buildKey(routeId: string, sectionId?: string): string {
    return this.dbService.buildKey(routeId, sectionId);
  }

  registerInstance(key: string, pmtiles: PMTiles): void {
    const protocol = this.initProtocol();
    this.pmtilesInstances.set(key, pmtiles);
    protocol.add(pmtiles);
    protocol.tiles.set(key, pmtiles);
  }

  getInstance(key: string): PMTiles | undefined {
    return this.pmtilesInstances.get(key) || this.protocol?.get(key);
  }

  registerArchive(routeId: string, blob: Blob, sectionId?: string): PMTiles {
    const key = this.buildKey(routeId, sectionId);
    const source = new BlobSource(key, blob);
    const pmtiles = new RoutePMTiles(source);
    this.registerInstance(key, pmtiles);

    if (sectionId) {
      const aliasKey = `${routeId}/section-${sectionId}`;
      this.registerInstance(aliasKey, pmtiles);

      let composite = this.compositeInstances.get(routeId);
      if (!composite) {
        composite = new CompositePMTiles(routeId, [{ id: sectionId, pmtiles }]);
        this.compositeInstances.set(routeId, composite);
        this.registerInstance(routeId, composite);
      } else {
        composite.addSection(sectionId, pmtiles);
        this.registerInstance(routeId, composite);
      }
    } else {
      const composite = this.compositeInstances.get(routeId);
      if (composite && composite.getSections().length > 0 && blob.size < 20 * 1024 * 1024) {
        this.registerInstance(routeId, composite);
      }
    }

    return pmtiles;
  }

  registerRemoteUrl(routeId: string, url: string, sectionId?: string): PMTiles {
    const resolvedUrl = resolveBaseHref(url);
    const key = this.buildKey(routeId, sectionId);
    this.remoteUrlMap.set(key, resolvedUrl);
    const pmtiles = new RoutePMTiles(resolvedUrl);
    this.registerInstance(key, pmtiles);

    if (sectionId) {
      const aliasKey = `${routeId}/section-${sectionId}`;
      this.registerInstance(aliasKey, pmtiles);

      let composite = this.compositeInstances.get(routeId);
      if (!composite) {
        composite = new CompositePMTiles(routeId, [{ id: sectionId, pmtiles }]);
        this.compositeInstances.set(routeId, composite);
        this.registerInstance(routeId, composite);
      } else {
        composite.addSection(sectionId, pmtiles);
        this.registerInstance(routeId, composite);
      }
    }

    return pmtiles;
  }

  isRouteCachedSync(routeId: string, sectionId?: string): boolean {
    return this.dbService.isRouteCachedSync(routeId, sectionId);
  }

  isSectionCached(routeId: string, sectionId: string): boolean {
    return this.dbService.isSectionCached(routeId, sectionId);
  }

  async isRouteCached(routeId: string, sectionId?: string): Promise<boolean> {
    return this.dbService.isRouteCached(routeId, sectionId);
  }

  async getArchive(routeId: string, sectionId?: string): Promise<Blob | null> {
    return this.dbService.getArchive(routeId, sectionId);
  }

  async saveArchive(
    routeId: string,
    blob: Blob,
    sectionId?: string,
    sourceUrl?: string
  ): Promise<void> {
    this.registerArchive(routeId, blob, sectionId);
    await this.dbService.saveArchive(routeId, blob, sectionId, sourceUrl);
  }

  async deleteArchive(routeId: string, sectionId?: string): Promise<void> {
    const key = this.buildKey(routeId, sectionId);
    this.pmtilesInstances.delete(key);

    if (sectionId) {
      const aliasKey = `${routeId}/section-${sectionId}`;
      this.pmtilesInstances.delete(aliasKey);

      const composite = this.compositeInstances.get(routeId);
      if (composite) {
        composite.removeSection(sectionId);
        if (composite.getSections().length === 0) {
          this.compositeInstances.delete(routeId);
          this.pmtilesInstances.delete(routeId);
        }
      }
    } else {
      this.compositeInstances.delete(routeId);
    }

    await this.dbService.deleteArchive(routeId, sectionId);
  }

  async deleteRouteArchives(routeId: string): Promise<void> {
    const records = await this.listArchives();
    const routeRecords = records.filter((r) => r.routeId === routeId);
    for (const r of routeRecords) {
      await this.deleteArchive(r.routeId, r.sectionId);
    }
    await this.deleteArchive(routeId);
  }

  async deleteRoute(routeId: string, sectionId?: string): Promise<void> {
    if (sectionId) {
      await this.deleteArchive(routeId, sectionId);
    } else {
      await this.deleteRouteArchives(routeId);
    }
  }

  async clearAllArchives(): Promise<void> {
    this.pmtilesInstances.clear();
    this.compositeInstances.clear();
    this.remoteUrlMap.clear();
    await this.dbService.clearAllArchives();
  }

  async listArchives(): Promise<StoredPmtilesRecord[]> {
    return this.dbService.listArchives();
  }

  async getTotalStorageBytes(): Promise<number> {
    return this.dbService.getTotalStorageBytes();
  }

  async getRouteStorageBytes(routeId: string): Promise<number> {
    return this.dbService.getRouteStorageBytes(routeId);
  }

  async getCachedRouteIds(): Promise<string[]> {
    return this.dbService.getCachedRouteIds();
  }

  async loadCachedArchivesIntoProtocol(): Promise<void> {
    const records = await this.listArchives();
    const routesWithSections = new Set<string>();
    for (const r of records) {
      if (r.sectionId) {
        routesWithSections.add(r.routeId);
      }
    }

    const sectionRecords = records.filter((r) => !!r.sectionId);
    const nonSectionRecords = records.filter((r) => !r.sectionId);

    for (const r of sectionRecords) {
      this.registerArchive(r.routeId, r.blob, r.sectionId);
    }

    for (const r of nonSectionRecords) {
      if (routesWithSections.has(r.routeId) && (r.sizeBytes || 0) < 20 * 1024 * 1024) {
        console.warn(`[PMTiles] Auto-cleaning corrupt legacy root record for ${r.routeId} (${r.sizeBytes} bytes)`);
        await this.deleteArchive(r.routeId);
        continue;
      }
      this.registerArchive(r.routeId, r.blob, r.sectionId);
    }
  }

  resolveTileUrl(routeId: string, sectionId?: string): string {
    return sectionId ? `pmtiles://${routeId}/${sectionId}` : `pmtiles://${routeId}`;
  }

  getCompositeRoute(routeId: string): CompositePMTiles | null {
    return this.compositeInstances.get(routeId) || null;
  }

  async downloadArchive(
    routeId: string,
    url: string,
    sectionId?: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<Blob> {
    return this.downloader.downloadArchive(routeId, url, sectionId, onProgress);
  }

  isDownloading(routeId: string, sectionId?: string): boolean {
    return this.downloader.isDownloading(routeId, sectionId);
  }

  getDownloadProgress(routeId: string, sectionId?: string): DownloadProgress | undefined {
    return this.downloader.getDownloadProgress(routeId, sectionId);
  }

  hasSections(routeId: string): boolean {
    return this.metadata.hasSections(routeId);
  }

  getRouteSections(routeId: string): RouteSectionMeta[] {
    return this.metadata.getRouteSections(routeId);
  }

  getEstimatedSizeBytes(routeId: string): number {
    return this.metadata.getEstimatedSizeBytes(routeId);
  }

  getEstimatedSize(routeId: string): string {
    return this.metadata.getEstimatedSize(routeId);
  }

  formatBytes(bytes: number): string {
    return this.metadata.formatBytes(bytes);
  }

  async getStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }> {
    return this.metadata.getStorageEstimate();
  }

  async downloadRoute(
    routeId: string,
    sectionId?: string,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<Blob> {
    const blob = await this.downloader.downloadRoute(routeId, sectionId, onProgress);
    if (this.hasSections(routeId) && !sectionId) {
      const composite = this.compositeInstances.get(routeId);
      if (composite) {
        this.registerInstance(routeId, composite);
      }
    }
    return blob;
  }
}
