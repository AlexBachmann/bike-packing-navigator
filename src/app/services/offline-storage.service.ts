import { Injectable } from '@angular/core';
import { RouteDataPackage } from '../models/route.model';

export interface IOfflineStorageService {
  readonly DB_NAME: string;
  readonly STORE_NAME: string;
  isRouteCached(routeId: string): Promise<boolean>;
  getRoutePackage(routeId: string): Promise<RouteDataPackage | null>;
  saveRoutePackage(pkg: RouteDataPackage): Promise<void>;
  getCachedRouteIds(): Promise<string[]>;
  removeRoutePackage(routeId: string): Promise<void>;
  clearAll(): Promise<void>;
}

@Injectable({
  providedIn: 'root'
})
export class OfflineStorageService implements IOfflineStorageService {
  readonly DB_NAME = 'bikepack-offline-v1';
  readonly STORE_NAME = 'route-packages';

  private readonly cachedRouteIds = new Set<string>();
  private readonly inMemoryStore = new Map<string, RouteDataPackage>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor() {
    this.initDb();
  }

  private initDb(): Promise<IDBDatabase | null> {
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
            db.createObjectStore(this.STORE_NAME, { keyPath: 'routeId' });
          }
        };

        req.onsuccess = () => {
          const db = req.result;
          // Synchronize cached route IDs into in-memory set for rapid/sync checks
          try {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const getAllKeysReq = store.getAllKeys();
            getAllKeysReq.onsuccess = () => {
              const keys = getAllKeysReq.result as string[];
              for (const key of keys) {
                this.cachedRouteIds.add(String(key));
              }
            };
          } catch {
            // Ignore transaction error on initial sync
          }
          resolve(db);
        };

        req.onerror = () => {
          console.warn('IndexedDB unavailable, using in-memory store');
          resolve(null);
        };
      } catch (err) {
        console.warn('Error opening IndexedDB:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  isRouteCachedSync(routeId: string): boolean {
    return this.cachedRouteIds.has(routeId) || this.inMemoryStore.has(routeId);
  }

  async isRouteCached(routeId: string): Promise<boolean> {
    if (this.cachedRouteIds.has(routeId) || this.inMemoryStore.has(routeId)) {
      return true;
    }

    const db = await this.initDb();
    if (!db) {
      return this.inMemoryStore.has(routeId);
    }

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(routeId);
        req.onsuccess = () => {
          const exists = !!req.result;
          if (exists) {
            this.cachedRouteIds.add(routeId);
          }
          resolve(exists);
        };
        req.onerror = () => resolve(false);
      } catch {
        resolve(this.inMemoryStore.has(routeId));
      }
    });
  }

  async getRoutePackage(routeId: string): Promise<RouteDataPackage | null> {
    const db = await this.initDb();
    if (!db) {
      const memoryPkg = this.inMemoryStore.get(routeId);
      return memoryPkg ? JSON.parse(JSON.stringify(memoryPkg)) : null;
    }

    return new Promise<RouteDataPackage | null>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(routeId);
        req.onsuccess = () => {
          if (req.result) {
            this.cachedRouteIds.add(routeId);
            this.inMemoryStore.set(routeId, JSON.parse(JSON.stringify(req.result)));
            resolve(req.result as RouteDataPackage);
          } else {
            const memoryPkg = this.inMemoryStore.get(routeId);
            resolve(memoryPkg ? JSON.parse(JSON.stringify(memoryPkg)) : null);
          }
        };
        req.onerror = () => {
          const memoryPkg = this.inMemoryStore.get(routeId);
          resolve(memoryPkg ? JSON.parse(JSON.stringify(memoryPkg)) : null);
        };
      } catch {
        const memoryPkg = this.inMemoryStore.get(routeId);
        resolve(memoryPkg ? JSON.parse(JSON.stringify(memoryPkg)) : null);
      }
    });
  }

  async saveRoutePackage(pkg: RouteDataPackage): Promise<void> {
    this.cachedRouteIds.add(pkg.routeId);
    this.inMemoryStore.set(pkg.routeId, JSON.parse(JSON.stringify(pkg)));

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.put(pkg);
        req.onsuccess = () => resolve();
        req.onerror = (err) => reject(err);
      } catch (err) {
        // Still saved in inMemoryStore
        resolve();
      }
    });
  }

  async getCachedRouteIds(): Promise<string[]> {
    const db = await this.initDb();
    if (!db) {
      return Array.from(this.inMemoryStore.keys());
    }

    return new Promise<string[]>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.getAllKeys();
        req.onsuccess = () => {
          const keys = (req.result as string[]).map(String);
          for (const k of keys) {
            this.cachedRouteIds.add(k);
          }
          // Merge in-memory keys
          for (const k of this.inMemoryStore.keys()) {
            if (!keys.includes(k)) {
              keys.push(k);
            }
          }
          resolve(keys);
        };
        req.onerror = () => resolve(Array.from(this.inMemoryStore.keys()));
      } catch {
        resolve(Array.from(this.inMemoryStore.keys()));
      }
    });
  }

  async removeRoutePackage(routeId: string): Promise<void> {
    this.cachedRouteIds.delete(routeId);
    this.inMemoryStore.delete(routeId);

    const db = await this.initDb();
    if (!db) return;

    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.delete(routeId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clearAll(): Promise<void> {
    this.cachedRouteIds.clear();
    this.inMemoryStore.clear();

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
}
