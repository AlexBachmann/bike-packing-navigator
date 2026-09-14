import { Injectable, signal } from "@angular/core";
import * as maplibregl from 'maplibre-gl';
import { Protocol, PMTiles, Source, RangeResponse, Header } from "pmtiles";

export interface RouteSectionMeta {
  sectionId: string;
  name: string;
  filename: string;
  estimatedSizeBytes: number;
  url: string;
}

/**
 * BlobSource: Custom PMTiles Source implementing zero-copy byte-range access
 * from an in-memory or IndexedDB Blob via Blob.slice().
 */
export class BlobSource implements Source {
  constructor(
    private readonly key: string,
    private readonly blob: Blob
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    if (signal?.aborted) {
      throw new DOMException("The request was aborted", "AbortError");
    }
    const clampedOffset = Math.max(0, offset);
    const clampedLength = Math.max(0, length);
    const slice = this.blob.slice(clampedOffset, clampedOffset + clampedLength);
    const data = await slice.arrayBuffer();
    return { data };
  }
}

/**
 * CompositePMTiles: Virtual PMTiles instance aggregating multiple sections
 * of a long route (e.g. Tour Divide 2025 sections 1..N) under a single
 * pmtiles://<route-id> URL.
 */
export class CompositePMTiles extends PMTiles {
  private sections: { id: string; pmtiles: PMTiles }[] = [];

  constructor(
    private readonly compositeKey: string,
    sections: { id: string; pmtiles: PMTiles }[] = []
  ) {
    super({
      getKey: () => compositeKey,
      getBytes: async (offset: number, length: number, signal?: AbortSignal) => {
        if (this.sections.length > 0) {
          return this.sections[0].pmtiles.source.getBytes(offset, length, signal);
        }
        return { data: new ArrayBuffer(0) };
      }
    });
    this.sections = [...sections];
  }

  addSection(sectionId: string, pmtiles: PMTiles): void {
    this.removeSection(sectionId);
    this.sections.push({ id: sectionId, pmtiles });
  }

  removeSection(sectionId: string): void {
    this.sections = this.sections.filter((s) => s.id !== sectionId);
  }

  getSections(): { id: string; pmtiles: PMTiles }[] {
    return [...this.sections];
  }

  override async getHeader(): Promise<Header> {
    if (this.sections.length === 0) {
      throw new Error(`CompositePMTiles "${this.compositeKey}" has no registered sections`);
    }
    const headers = await Promise.all(this.sections.map((s) => s.pmtiles.getHeader()));
    let minLon = 180;
    let minLat = 90;
    let maxLon = -180;
    let maxLat = -90;
    let minZoom = 24;
    let maxZoom = 0;

    for (const h of headers) {
      if (h.minLon < minLon) minLon = h.minLon;
      if (h.minLat < minLat) minLat = h.minLat;
      if (h.maxLon > maxLon) maxLon = h.maxLon;
      if (h.maxLat > maxLat) maxLat = h.maxLat;
      if (h.minZoom < minZoom) minZoom = h.minZoom;
      if (h.maxZoom > maxZoom) maxZoom = h.maxZoom;
    }

    return {
      ...headers[0],
      minLon,
      minLat,
      maxLon,
      maxLat,
      minZoom,
      maxZoom,
      centerLon: (minLon + maxLon) / 2,
      centerLat: (minLat + maxLat) / 2,
      centerZoom: minZoom
    };
  }

  override async getZxy(
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal
  ): Promise<RangeResponse | undefined> {
    for (const sec of this.sections) {
      try {
        const res = await sec.pmtiles.getZxy(z, x, y, signal);
        if (res && res.data && res.data.byteLength > 0) {
          return res;
        }
      } catch {
        // Fall through to check other sections
      }
    }
    return undefined;
  }

  override async getMetadata(): Promise<unknown> {
    if (this.sections.length > 0) {
      return this.sections[0].pmtiles.getMetadata();
    }
    return {};
  }

  override async getTileJson(baseTilesUrl: string): Promise<unknown> {
    const header = await this.getHeader();
    const meta = (await this.getMetadata()) as Record<string, unknown> | undefined;
    return {
      tilejson: "3.0.0",
      scheme: "xyz",
      tiles: [`${baseTilesUrl}/{z}/{x}/{y}.mvt`],
      vector_layers: meta?.["vector_layers"] || [],
      attribution: meta?.["attribution"] || "Bikepack Navigator",
      name: this.compositeKey,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      center: [header.centerLon, header.centerLat, header.centerZoom],
      minzoom: header.minZoom,
      maxzoom: header.maxZoom
    };
  }
}

export interface StoredPmtilesRecord {
  key: string;
  routeId: string;
  sectionId?: string;
  blob: Blob;
  sizeBytes: number;
  updatedAt: number;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface DownloadProgress {
  routeId: string;
  sectionId?: string;
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
  status: "idle" | "downloading" | "completed" | "error";
  errorMessage?: string;
}

let protocolRegisteredGlobally = false;

@Injectable({
  providedIn: "root"
})
export class PmtilesStorageService {
  readonly DB_NAME = "bikepack-pmtiles-v1";
  readonly STORE_NAME = "archives";

  private protocol: Protocol | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private readonly memoryArchives = new Map<string, StoredPmtilesRecord>();
  private readonly pmtilesInstances = new Map<string, PMTiles>();
  private readonly compositeInstances = new Map<string, CompositePMTiles>();
  private readonly remoteUrlMap = new Map<string, string>();
  private readonly cachedKeys = new Set<string>();

  readonly activeDownloads = signal<Record<string, DownloadProgress>>({});

  constructor() {
    this.initProtocol();
    this.loadCachedArchivesIntoProtocol().catch(() => {});
  }

  initProtocol(): Protocol {
    if (!this.protocol) {
      this.protocol = new Protocol({ metadata: true });
      if (!protocolRegisteredGlobally && typeof maplibregl !== "undefined" && maplibregl.addProtocol) {
        try {
          maplibregl.addProtocol("pmtiles", this.protocol.tile);
          protocolRegisteredGlobally = true;
        } catch {
          // Protocol might already be added
        }
      }
    }
    return this.protocol;
  }

  getProtocol(): Protocol {
    return this.initProtocol();
  }

  private initDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(this.DB_NAME, 1);

        req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            const store = db.createObjectStore(this.STORE_NAME, { keyPath: "key" });
            store.createIndex("routeId", "routeId", { unique: false });
          }
        };

        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction(this.STORE_NAME, "readonly");
            const store = tx.objectStore(this.STORE_NAME);
            const getAllKeysReq = store.getAllKeys();
            getAllKeysReq.onsuccess = () => {
              const keys = getAllKeysReq.result as string[];
              for (const k of keys) {
                this.cachedKeys.add(String(k));
              }
            };
          } catch {
            // Ignore initial transaction sync error
          }
          resolve(db);
        };

        req.onerror = () => {
          console.warn("[PMTiles] IndexedDB unavailable, using in-memory store");
          resolve(null);
        };
      } catch (err) {
        console.warn("[PMTiles] Error opening IndexedDB:", err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  private buildKey(routeId: string, sectionId?: string): string {
    return sectionId ? `${routeId}/${sectionId}` : routeId;
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
    const pmtiles = new PMTiles(source);
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
      }
    }

    return pmtiles;
  }

  registerRemoteUrl(routeId: string, url: string, sectionId?: string): PMTiles {
    const key = this.buildKey(routeId, sectionId);
    this.remoteUrlMap.set(key, url);
    const pmtiles = new PMTiles(url);
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
      }
    }

    return pmtiles;
  }

  isRouteCachedSync(routeId: string, sectionId?: string): boolean {
    if (sectionId) {
      const key = this.buildKey(routeId, sectionId);
      return this.cachedKeys.has(key) || this.memoryArchives.has(key);
    }
    // Direct match
    if (this.cachedKeys.has(routeId) || this.memoryArchives.has(routeId)) {
      return true;
    }
    // Check if any section of this route is cached
    for (const k of this.cachedKeys) {
      if (k.startsWith(`${routeId}/`)) return true;
    }
    for (const k of this.memoryArchives.keys()) {
      if (k.startsWith(`${routeId}/`)) return true;
    }
    return false;
  }

  isSectionCached(routeId: string, sectionId: string): boolean {
    return this.isRouteCachedSync(routeId, sectionId);
  }

  async isRouteCached(routeId: string, sectionId?: string): Promise<boolean> {
    if (this.isRouteCachedSync(routeId, sectionId)) {
      return true;
    }

    const db = await this.initDb();
    if (!db) {
      return this.isRouteCachedSync(routeId, sectionId);
    }

    if (sectionId) {
      const key = this.buildKey(routeId, sectionId);
      return new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(this.STORE_NAME, "readonly");
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => {
            const exists = !!req.result;
            if (exists) {
              this.cachedKeys.add(key);
            }
            resolve(exists);
          };
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const index = store.index("routeId");
        const req = index.getKey(routeId);
        req.onsuccess = () => {
          const exists = !!req.result;
          if (exists) {
            this.cachedKeys.add(String(req.result));
          }
          resolve(exists);
        };
        req.onerror = () => resolve(false);
      } catch {
        resolve(this.isRouteCachedSync(routeId));
      }
    });
  }

  async getArchive(routeId: string, sectionId?: string): Promise<Blob | null> {
    const key = this.buildKey(routeId, sectionId);
    const memoryRecord = this.memoryArchives.get(key);
    if (memoryRecord) {
      return memoryRecord.blob;
    }

    const db = await this.initDb();
    if (!db) {
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result) {
            const record = req.result as StoredPmtilesRecord;
            this.cachedKeys.add(key);
            this.memoryArchives.set(key, record);
            resolve(record.blob);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveArchive(
    routeId: string,
    blob: Blob,
    sectionId?: string,
    sourceUrl?: string
  ): Promise<void> {
    const key = this.buildKey(routeId, sectionId);
    const record: StoredPmtilesRecord = {
      key,
      routeId,
      sectionId,
      blob,
      sizeBytes: blob.size,
      updatedAt: Date.now(),
      sourceUrl
    };

    this.cachedKeys.add(key);
    this.memoryArchives.set(key, record);

    this.registerArchive(routeId, blob, sectionId);

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = (err) => reject(err);
      } catch {
        resolve();
      }
    });
  }

  async deleteArchive(routeId: string, sectionId?: string): Promise<void> {
    const key = this.buildKey(routeId, sectionId);
    this.cachedKeys.delete(key);
    this.memoryArchives.delete(key);
    this.pmtilesInstances.delete(key);

    if (sectionId) {
      const aliasKey = `${routeId}/section-${sectionId}`;
      this.cachedKeys.delete(aliasKey);
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

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
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
    this.cachedKeys.clear();
    this.memoryArchives.clear();
    this.pmtilesInstances.clear();
    this.compositeInstances.clear();
    this.remoteUrlMap.clear();

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async listArchives(): Promise<StoredPmtilesRecord[]> {
    const db = await this.initDb();
    if (!db) {
      return Array.from(this.memoryArchives.values());
    }

    return new Promise<StoredPmtilesRecord[]>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const records = (req.result as StoredPmtilesRecord[]) || [];
          for (const r of records) {
            this.cachedKeys.add(r.key);
            if (!this.memoryArchives.has(r.key)) {
              this.memoryArchives.set(r.key, r);
            }
          }
          resolve(records);
        };
        req.onerror = () => resolve(Array.from(this.memoryArchives.values()));
      } catch {
        resolve(Array.from(this.memoryArchives.values()));
      }
    });
  }

  async getTotalStorageBytes(): Promise<number> {
    const records = await this.listArchives();
    return records.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
  }

  async getRouteStorageBytes(routeId: string): Promise<number> {
    const records = await this.listArchives();
    return records
      .filter((r) => r.routeId === routeId)
      .reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
  }

  async getCachedRouteIds(): Promise<string[]> {
    const records = await this.listArchives();
    const ids = new Set<string>();
    for (const r of records) {
      ids.add(r.routeId);
    }
    return Array.from(ids);
  }

  async loadCachedArchivesIntoProtocol(): Promise<void> {
    const records = await this.listArchives();
    for (const r of records) {
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
    const progress: DownloadProgress = {
      routeId,
      sectionId,
      loadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      status: "downloading"
    };
    onProgress?.(progress);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const contentLengthHeader = res.headers.get("content-length");
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      progress.totalBytes = totalBytes;

      if (!res.body) {
        const blob = await res.blob();
        await this.saveArchive(routeId, blob, sectionId, url);
        progress.loadedBytes = blob.size;
        progress.percentage = 100;
        progress.status = "completed";
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

      const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
      await this.saveArchive(routeId, blob, sectionId, url);

      progress.loadedBytes = blob.size;
      progress.percentage = 100;
      progress.status = "completed";
      onProgress?.(progress);

      return blob;
    } catch (err) {
      progress.status = "error";
      progress.errorMessage = err instanceof Error ? err.message : String(err);
      onProgress?.(progress);
      throw err;
    }
  }

  isDownloading(routeId: string, sectionId?: string): boolean {
    const key = this.buildKey(routeId, sectionId);
    const p = this.activeDownloads()[key];
    return p?.status === "downloading";
  }

  getDownloadProgress(routeId: string, sectionId?: string): DownloadProgress | undefined {
    const key = this.buildKey(routeId, sectionId);
    return this.activeDownloads()[key];
  }

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
          url: '/data/routes/tour-divide-2025/section-1.pmtiles'
        },
        {
          sectionId: '2',
          name: 'Section 2: Wyoming',
          filename: 'section-2.pmtiles',
          estimatedSizeBytes: 22 * 1024 * 1024,
          url: '/data/routes/tour-divide-2025/section-2.pmtiles'
        },
        {
          sectionId: '3',
          name: 'Section 3: Colorado',
          filename: 'section-3.pmtiles',
          estimatedSizeBytes: 35 * 1024 * 1024,
          url: '/data/routes/tour-divide-2025/section-3.pmtiles'
        },
        {
          sectionId: '4',
          name: 'Section 4: New Mexico',
          filename: 'section-4.pmtiles',
          estimatedSizeBytes: 25 * 1024 * 1024,
          url: '/data/routes/tour-divide-2025/section-4.pmtiles'
        }
      ];
    }

    return [
      {
        sectionId: 'full',
        name: 'Full Route Corridor',
        filename: 'corridor.pmtiles',
        estimatedSizeBytes: this.getEstimatedSizeBytes(routeId),
        url: `/data/routes/${routeId}/corridor.pmtiles`
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
    const usedBytes = await this.getTotalStorageBytes();
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

  async downloadRoute(
    routeId: string,
    sectionId?: string,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<Blob> {
    const key = this.buildKey(routeId, sectionId);

    // Multi-section download all
    if (this.hasSections(routeId) && !sectionId) {
      const sections = this.getRouteSections(routeId);
      const totalEstimated = this.getEstimatedSizeBytes(routeId);
      let cumulativeLoaded = 0;

      const masterProgress: DownloadProgress = {
        routeId,
        loadedBytes: 0,
        totalBytes: totalEstimated,
        percentage: 0,
        status: "downloading"
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
                status: "downloading"
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
            status: "error",
            errorMessage
          };
          this.activeDownloads.update((d) => ({ ...d, [routeId]: errorProgress }));
          onProgress?.(errorProgress);
          throw err;
        }
        cumulativeLoaded += sec.estimatedSizeBytes;
      }

      await this.saveArchive(routeId, lastBlob);

      const completed: DownloadProgress = {
        routeId,
        loadedBytes: totalEstimated,
        totalBytes: totalEstimated,
        percentage: 100,
        status: "completed"
      };
      this.activeDownloads.update((d) => ({ ...d, [routeId]: completed }));
      onProgress?.(completed);
      return lastBlob;
    }

    // Single section or non-sectioned route
    let url = `/data/routes/${routeId}/corridor.pmtiles`;
    if (sectionId) {
      const sec = this.getRouteSections(routeId).find((s) => s.sectionId === sectionId);
      url = sec ? sec.url : `/data/routes/${routeId}/section-${sectionId}.pmtiles`;
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
        status: "error",
        errorMessage
      };
      progressTracker(errorProgress);
      throw err;
    }
  }
}
