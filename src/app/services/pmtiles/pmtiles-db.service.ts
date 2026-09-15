import { Injectable } from '@angular/core';
import { StoredPmtilesRecord } from './pmtiles-composite.model';

@Injectable({
  providedIn: 'root'
})
export class PmtilesDbService {
  readonly DB_NAME = 'bikepack-pmtiles-v1';
  readonly STORE_NAME = 'archives';

  private dbPromise: Promise<IDBDatabase | null> | null = null;
  readonly memoryArchives = new Map<string, StoredPmtilesRecord>();
  readonly cachedKeys = new Set<string>();

  buildKey(routeId: string, sectionId?: string): string {
    return sectionId ? `${routeId}/${sectionId}` : routeId;
  }

  initDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(this.DB_NAME, 1);

        req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
            store.createIndex('routeId', 'routeId', { unique: false });
          }
        };

        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
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
          console.warn('[PMTiles] IndexedDB unavailable, using in-memory store');
          resolve(null);
        };
      } catch (err) {
        console.warn('[PMTiles] Error opening IndexedDB:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  isRouteCachedSync(routeId: string, sectionId?: string): boolean {
    if (sectionId) {
      const key = this.buildKey(routeId, sectionId);
      return this.cachedKeys.has(key) || this.memoryArchives.has(key);
    }
    if (this.cachedKeys.has(routeId) || this.memoryArchives.has(routeId)) {
      return true;
    }
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
          const tx = db.transaction(this.STORE_NAME, 'readonly');
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
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const index = store.index('routeId');
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
        const tx = db.transaction(this.STORE_NAME, 'readonly');
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

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
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

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
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

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
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
        const tx = db.transaction(this.STORE_NAME, 'readonly');
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
}
