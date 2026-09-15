import { Injectable } from '@angular/core';
import { RouteSummary } from '../models/route.model';

export interface ITileCacheService {
  readonly cacheName: string;
  cacheTilesForRoute(routeSummary: RouteSummary, minZoom?: number, maxZoom?: number): Promise<number>;
  cacheCorridorTiles(points: [number, number, ...any[]][], minZoom?: number, maxZoom?: number): Promise<number>;
  hasTile(url: string): Promise<boolean>;
  getTile(url: string): Promise<Response | null>;
  putTile(url: string, response: Response): Promise<void>;
  getCachedTileCount(): Promise<number>;
  clearTileCache(): Promise<void>;
}

import {
  lat2tile,
  lon2tile,
  tile2lon,
  tile2lat,
  getTileUrlsForCoordinate,
  getTileBoundsForBoundingBox,
  type TileCoordinate,
  type TileBounds
} from '../utils/tile-math.utils';

export {
  lat2tile,
  lon2tile,
  tile2lon,
  tile2lat,
  getTileUrlsForCoordinate,
  getTileBoundsForBoundingBox,
  type TileCoordinate,
  type TileBounds
};



@Injectable({
  providedIn: 'root'
})
export class TileCacheService implements ITileCacheService {
  readonly cacheName = 'bikepack-map-tiles-v1';
  private readonly inMemoryTileMap = new Map<string, Response>();
  private readonly MAX_IN_MEMORY_TILES = 1000;

  private async getCache(): Promise<Cache | null> {
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        return await window.caches.open(this.cacheName);
      } catch (e) {
        console.warn('Cache Storage API not accessible, using in-memory tile cache', e);
      }
    }
    return null;
  }

  /**
   * Fetches a single tile genuinely via Fetch API with CORS mode,
   * stores cloned response into in-memory map and browser Cache Storage.
   * Resilient to network disconnects and non-200 responses.
   */
  private async fetchAndCacheTile(url: string, cache: Cache | null): Promise<boolean> {
    // 1. Skip network if already in memory
    if (this.inMemoryTileMap.has(url)) {
      return true;
    }

    // 2. Skip network if already in persistent Cache Storage
    if (cache) {
      try {
        const match = await cache.match(url);
        if (match) {
          this.setInMemoryTile(url, match.clone());
          return true;
        }
      } catch {
        // Fall through to fetch
      }
    }

    // 3. Genuine network fetch with CORS
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors'
      });

      if (!response.ok) {
        return false;
      }

      this.setInMemoryTile(url, response.clone());

      if (cache) {
        try {
          await cache.put(url, response.clone());
        } catch {
          // Ignore cache put error in sandboxed/quota-limited environments
        }
      }

      return true;
    } catch {
      // Offline resilience: network failure or aborted request caught gracefully
      return false;
    }
  }

  /**
   * Store into in-memory map with bounded LRU eviction
   */
  private setInMemoryTile(url: string, response: Response): void {
    if (this.inMemoryTileMap.size >= this.MAX_IN_MEMORY_TILES) {
      const oldestKey = this.inMemoryTileMap.keys().next().value;
      if (oldestKey) {
        this.inMemoryTileMap.delete(oldestKey);
      }
    }
    this.inMemoryTileMap.set(url, response);
  }

  /**
   * Concurrently processes tile URLs in bounded batches to avoid socket exhaustion
   */
  private async fetchBatch(urls: string[], cache: Cache | null, batchSize: number = 6): Promise<void> {
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      await Promise.all(batch.map((url) => this.fetchAndCacheTile(url, cache)));
    }
  }

  /**
   * Generates corridor tiles with a 1-tile buffer for a given route across zoom levels (default 5-10).
   * Genuinely fetches tiles from ArcGIS and OSM tile services and persists to Cache Storage.
   */
  async cacheTilesForRoute(
    routeSummary: RouteSummary,
    minZoom: number = 5,
    maxZoom: number = 10
  ): Promise<number> {
    let count = 0;
    const cache = await this.getCache();

    const [south, west] = routeSummary.bounds[0];
    const [north, east] = routeSummary.bounds[1];

    const allUrls: string[] = [];

    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z);
      const x1 = lon2tile(west, z);
      const x2 = lon2tile(east, z);
      const y1 = lat2tile(north, z);
      const y2 = lat2tile(south, z);

      const minX = Math.max(0, Math.min(x1, x2) - 1);
      const maxX = Math.min(n - 1, Math.max(x1, x2) + 1);
      const minY = Math.max(0, Math.min(y1, y2) - 1);
      const maxY = Math.min(n - 1, Math.max(y1, y2) + 1);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const tileUrls = getTileUrlsForCoordinate(z, x, y);
          allUrls.push(...tileUrls);
          count++;
        }
      }
    }

    await this.fetchBatch(allUrls, cache, 6);

    return count;
  }

  /**
   * Pre-caches corridor tiles given specific track point coordinates
   */
  async cacheCorridorTiles(
    points: [number, number, ...any[]][],
    minZoom: number = 5,
    maxZoom: number = 10
  ): Promise<number> {
    if (!points || points.length === 0) return 0;

    const tileKeys = new Set<string>();
    const cache = await this.getCache();

    for (let z = minZoom; z <= maxZoom; z++) {
      const n = Math.pow(2, z);
      for (const pt of points) {
        const cx = lon2tile(pt[1], z);
        const cy = lat2tile(pt[0], z);

        // 1-tile buffer
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const x = Math.max(0, Math.min(n - 1, cx + dx));
            const y = Math.max(0, Math.min(n - 1, cy + dy));
            tileKeys.add(`${z}/${x}/${y}`);
          }
        }
      }
    }

    let count = 0;
    const allUrls: string[] = [];
    for (const key of tileKeys) {
      const [zStr, xStr, yStr] = key.split('/');
      const z = parseInt(zStr, 10);
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      allUrls.push(...getTileUrlsForCoordinate(z, x, y));
      count++;
    }

    await this.fetchBatch(allUrls, cache, 6);

    return count;
  }

  async hasTile(url: string): Promise<boolean> {
    if (this.inMemoryTileMap.has(url)) return true;

    const cache = await this.getCache();
    if (!cache) return false;

    try {
      const match = await cache.match(url);
      return !!match;
    } catch {
      return false;
    }
  }

  async getTile(url: string): Promise<Response | null> {
    const memory = this.inMemoryTileMap.get(url);
    if (memory) {
      return memory.clone();
    }

    const cache = await this.getCache();
    if (!cache) return null;

    try {
      const match = await cache.match(url);
      if (match) {
        this.setInMemoryTile(url, match.clone());
        return match.clone();
      }
      return null;
    } catch {
      return null;
    }
  }

  async putTile(url: string, response: Response): Promise<void> {
    this.setInMemoryTile(url, response.clone());

    const cache = await this.getCache();
    if (!cache) return;

    try {
      await cache.put(url, response.clone());
    } catch {
      // Ignore cache put error
    }
  }

  async getCachedTileCount(): Promise<number> {
    const cache = await this.getCache();
    if (!cache) {
      return this.inMemoryTileMap.size;
    }

    try {
      const requests = await cache.keys();
      return Math.max(requests.length, this.inMemoryTileMap.size);
    } catch {
      return this.inMemoryTileMap.size;
    }
  }

  async clearTileCache(): Promise<void> {
    this.inMemoryTileMap.clear();

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        await window.caches.delete(this.cacheName);
      } catch {
        // Ignore delete error
      }
    }
  }
}
