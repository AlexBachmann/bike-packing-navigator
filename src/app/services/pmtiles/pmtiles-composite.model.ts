import { Header, PMTiles, RangeResponse, Source } from 'pmtiles';

export interface RouteSectionMeta {
  sectionId: string;
  name: string;
  filename: string;
  estimatedSizeBytes: number;
  url: string;
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
  status: 'idle' | 'downloading' | 'completed' | 'error';
  errorMessage?: string;
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
      throw new DOMException('The request was aborted', 'AbortError');
    }
    const clampedOffset = Math.max(0, offset);
    const clampedLength = Math.max(0, length);
    const slice = this.blob.slice(clampedOffset, clampedOffset + clampedLength);
    const data = await slice.arrayBuffer();
    return { data };
  }
}

/**
 * RoutePMTiles: Wrapper around PMTiles that ensures TileJSON returns
 * unconstrained global bounds [-180, -85.051129, 180, 85.051129].
 * This prevents MapLibre GL from culling viewport tile requests for
 * neighboring corridor tiles, POIs, and overzoomed parent tiles.
 */
export class RoutePMTiles extends PMTiles {
  override async getTileJson(baseTilesUrl: string): Promise<unknown> {
    const raw = (await super.getTileJson(baseTilesUrl)) as Record<string, unknown>;
    return {
      ...raw,
      bounds: [-180, -85.051129, 180, 85.051129]
    };
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
      tilejson: '3.0.0',
      scheme: 'xyz',
      tiles: [`${baseTilesUrl}/{z}/{x}/{y}.mvt`],
      vector_layers: meta?.['vector_layers'] || [],
      attribution: meta?.['attribution'] || 'Bikepack Navigator',
      name: this.compositeKey,
      bounds: [-180, -85.051129, 180, 85.051129],
      center: [header.centerLon, header.centerLat, header.centerZoom],
      minzoom: header.minZoom,
      maxzoom: header.maxZoom
    };
  }
}
