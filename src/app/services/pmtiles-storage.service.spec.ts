import { TestBed } from "@angular/core/testing";
import {
  PmtilesStorageService,
  BlobSource,
  CompositePMTiles
} from "./pmtiles-storage.service";
import * as maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";

describe("PmtilesStorageService", () => {
  let service: PmtilesStorageService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [PmtilesStorageService]
    });
    service = TestBed.inject(PmtilesStorageService);
    await service.clearAllArchives();
  });

  describe("BlobSource", () => {
    it("should return the archive key", () => {
      const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
      const source = new BlobSource("test-archive", blob);
      expect(source.getKey()).toBe("test-archive");
    });

    it("should slice and return correct byte ranges", async () => {
      const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const blob = new Blob([bytes]);
      const source = new BlobSource("byte-test", blob);

      const resp1 = await source.getBytes(0, 4);
      const data1 = new Uint8Array(resp1.data);
      expect(Array.from(data1)).toEqual([10, 20, 30, 40]);

      const resp2 = await source.getBytes(2, 3);
      const data2 = new Uint8Array(resp2.data);
      expect(Array.from(data2)).toEqual([30, 40, 50]);
    });

    it("should throw AbortError when signal is already aborted", async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      const source = new BlobSource("abort-test", blob);
      const controller = new AbortController();
      controller.abort();

      await expect(source.getBytes(0, 2, controller.signal)).rejects.toThrow("The request was aborted");
    });

    it("should handle offset past end of blob gracefully", async () => {
      const blob = new Blob([new Uint8Array([1, 2])]);
      const source = new BlobSource("oob-test", blob);
      const resp = await source.getBytes(100, 5);
      expect(resp.data.byteLength).toBe(0);
    });
  });

  describe("Service Initialization & Protocol Registration", () => {
    it("should create service and expose DB and store constants", () => {
      expect(service).toBeTruthy();
      expect(service.DB_NAME).toBe("bikepack-pmtiles-v1");
      expect(service.STORE_NAME).toBe("archives");
    });

    it("should initialize PMTiles protocol handler", () => {
      const protocol = service.getProtocol();
      expect(protocol).toBeTruthy();
      expect(typeof protocol.tile).toBe("function");
    });

    it("should resolve valid pmtiles:// URLs", () => {
      expect(service.resolveTileUrl("arizona-trail-300")).toBe("pmtiles://arizona-trail-300");
      expect(service.resolveTileUrl("tour-divide-2025", "1")).toBe("pmtiles://tour-divide-2025/1");
      expect(service.resolveTileUrl("tour-divide-2025", "section-2")).toBe("pmtiles://tour-divide-2025/section-2");
    });
  });

  describe("Archive Storage CRUD & Quota", () => {
    it("should report false for uncached archive", async () => {
      expect(await service.isRouteCached("unknown-route")).toBe(false);
      expect(service.isRouteCachedSync("unknown-route")).toBe(false);
      expect(await service.getArchive("unknown-route")).toBeNull();
    });

    it("should save, query, and retrieve an archive Blob", async () => {
      const testBytes = new Uint8Array([0x50, 0x4d, 0x54, 0x03, 1, 2, 3, 4]);
      const blob = new Blob([testBytes], { type: "application/octet-stream" });

      await service.saveArchive("arizona-trail-300", blob);

      expect(await service.isRouteCached("arizona-trail-300")).toBe(true);
      expect(service.isRouteCachedSync("arizona-trail-300")).toBe(true);

      const retrieved = await service.getArchive("arizona-trail-300");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.size).toBe(blob.size);

      const retrievedBuf = await retrieved?.arrayBuffer();
      expect(new Uint8Array(retrievedBuf!)).toEqual(testBytes);
    });

    it("should list cached route IDs and stored records", async () => {
      const blob1 = new Blob([new Uint8Array([1, 2, 3])]);
      const blob2 = new Blob([new Uint8Array([4, 5, 6, 7])]);

      await service.saveArchive("azt-300", blob1);
      await service.saveArchive("ct-500", blob2);

      const routeIds = await service.getCachedRouteIds();
      expect(routeIds.length).toBe(2);
      expect(routeIds).toContain("azt-300");
      expect(routeIds).toContain("ct-500");

      const records = await service.listArchives();
      expect(records.length).toBe(2);
    });

    it("should calculate total storage bytes and per-route storage bytes", async () => {
      const blob1 = new Blob([new Uint8Array(100)]);
      const blob2 = new Blob([new Uint8Array(250)]);

      await service.saveArchive("route-a", blob1);
      await service.saveArchive("route-b", blob2);

      const total = await service.getTotalStorageBytes();
      expect(total).toBe(350);

      const routeABytes = await service.getRouteStorageBytes("route-a");
      expect(routeABytes).toBe(100);

      const routeBBytes = await service.getRouteStorageBytes("route-b");
      expect(routeBBytes).toBe(250);
    });

    it("should delete a single archive", async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      await service.saveArchive("route-to-delete", blob);
      expect(await service.isRouteCached("route-to-delete")).toBe(true);

      await service.deleteArchive("route-to-delete");
      expect(await service.isRouteCached("route-to-delete")).toBe(false);
      expect(await service.getArchive("route-to-delete")).toBeNull();
    });

    it("should delete all sections of a multi-section route", async () => {
      const b1 = new Blob([new Uint8Array([1, 2])]);
      const b2 = new Blob([new Uint8Array([3, 4])]);

      await service.saveArchive("tour-divide-2025", b1, "1");
      await service.saveArchive("tour-divide-2025", b2, "2");

      expect(await service.isRouteCached("tour-divide-2025", "1")).toBe(true);
      expect(await service.isRouteCached("tour-divide-2025", "2")).toBe(true);

      await service.deleteRouteArchives("tour-divide-2025");
      expect(await service.isRouteCached("tour-divide-2025", "1")).toBe(false);
      expect(await service.isRouteCached("tour-divide-2025", "2")).toBe(false);
    });

    it("should clear all archives completely", async () => {
      const b = new Blob([new Uint8Array([1, 2])]);
      await service.saveArchive("r1", b);
      await service.saveArchive("r2", b);

      await service.clearAllArchives();
      expect((await service.listArchives()).length).toBe(0);
      expect(await service.getTotalStorageBytes()).toBe(0);
    });
  });

  describe("Multi-Section & Composite Route Resolution", () => {
    it("should automatically assemble CompositePMTiles when section archives are saved", async () => {
      const b1 = new Blob([new Uint8Array([1, 2, 3])]);
      const b2 = new Blob([new Uint8Array([4, 5, 6])]);

      await service.saveArchive("tour-divide-2025", b1, "1");
      await service.saveArchive("tour-divide-2025", b2, "2");

      const composite = service.getCompositeRoute("tour-divide-2025");
      expect(composite).not.toBeNull();
      expect(composite?.getSections().length).toBe(2);
      expect(composite?.getSections().map((s) => s.id)).toEqual(["1", "2"]);
    });

    it("should query across multiple sections in CompositePMTiles", async () => {
      const mockPmtiles1 = {
        getHeader: vi.fn().mockResolvedValue({
          minLon: -115.0,
          minLat: 48.0,
          maxLon: -113.0,
          maxLat: 51.0,
          minZoom: 0,
          maxZoom: 12
        }),
        getZxy: vi.fn().mockImplementation(async (z: number, x: number, y: number) => {
          if (z === 8 && x === 50 && y === 80) {
            return { data: new Uint8Array([1, 1, 1]).buffer };
          }
          return undefined;
        }),
        getMetadata: vi.fn().mockResolvedValue({ vector_layers: [{ id: "transportation" }] })
      } as unknown as PMTiles;

      const mockPmtiles2 = {
        getHeader: vi.fn().mockResolvedValue({
          minLon: -113.0,
          minLat: 44.0,
          maxLon: -110.0,
          maxLat: 48.0,
          minZoom: 2,
          maxZoom: 14
        }),
        getZxy: vi.fn().mockImplementation(async (z: number, x: number, y: number) => {
          if (z === 8 && x === 52 && y === 90) {
            return { data: new Uint8Array([2, 2, 2]).buffer };
          }
          return undefined;
        }),
        getMetadata: vi.fn().mockResolvedValue({ vector_layers: [{ id: "transportation" }] })
      } as unknown as PMTiles;

      const composite = new CompositePMTiles("tour-divide-2025", [
        { id: "1", pmtiles: mockPmtiles1 },
        { id: "2", pmtiles: mockPmtiles2 }
      ]);

      // Verify union bounding box and min/max zoom
      const header = await composite.getHeader();
      expect(header.minLon).toBe(-115.0);
      expect(header.maxLon).toBe(-110.0);
      expect(header.minLat).toBe(44.0);
      expect(header.maxLat).toBe(51.0);
      expect(header.minZoom).toBe(0);
      expect(header.maxZoom).toBe(14);

      // Verify TileJSON generation
      const tilejson = (await composite.getTileJson("pmtiles://tour-divide-2025")) as any;
      expect(tilejson.name).toBe("tour-divide-2025");
      expect(tilejson.minzoom).toBe(0);
      expect(tilejson.maxzoom).toBe(14);

      // Verify querying tile from Section 1
      const tile1 = await composite.getZxy(8, 50, 80);
      expect(tile1).toBeDefined();
      expect(new Uint8Array(tile1!.data)).toEqual(new Uint8Array([1, 1, 1]));

      // Verify querying tile from Section 2
      const tile2 = await composite.getZxy(8, 52, 90);
      expect(tile2).toBeDefined();
      expect(new Uint8Array(tile2!.data)).toEqual(new Uint8Array([2, 2, 2]));

      // Verify querying non-existent tile returns undefined
      const tileMissing = await composite.getZxy(8, 999, 999);
      expect(tileMissing).toBeUndefined();
    });

    it("should remove section from composite and unregister when empty", async () => {
      const b1 = new Blob([new Uint8Array([1])]);
      const b2 = new Blob([new Uint8Array([2])]);

      await service.saveArchive("td", b1, "1");
      await service.saveArchive("td", b2, "2");

      let composite = service.getCompositeRoute("td");
      expect(composite?.getSections().length).toBe(2);

      await service.deleteArchive("td", "1");
      composite = service.getCompositeRoute("td");
      expect(composite?.getSections().length).toBe(1);

      await service.deleteArchive("td", "2");
      composite = service.getCompositeRoute("td");
      expect(composite).toBeNull();
    });
  });

  describe("Remote URL Registration", () => {
    it("should register a remote URL for network streaming fallback", () => {
      const pmtiles = service.registerRemoteUrl(
        "remote-route",
        "https://cdn.example.com/remote-route.pmtiles"
      );
      expect(pmtiles).toBeTruthy();
      expect(service.getProtocol().get("remote-route")).toBeDefined();
    });
  });

  describe("Streaming Download with Progress Tracking", () => {
    it("should download archive, report progress, and save to storage", async () => {
      const mockData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const progressUpdates: any[] = [];

      const mockResponse = new Response(mockData, {
        status: 200,
        headers: { "Content-Length": "8" }
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const downloadedBlob = await service.downloadArchive(
        "stream-route",
        "https://example.com/stream-route.pmtiles",
        undefined,
        (p) => progressUpdates.push({ ...p })
      );

      expect(downloadedBlob.size).toBe(8);
      expect(await service.isRouteCached("stream-route")).toBe(true);

      expect(progressUpdates.length).toBeGreaterThan(0);
      const lastProgress = progressUpdates[progressUpdates.length - 1];
      expect(lastProgress.percentage).toBe(100);
      expect(lastProgress.status).toBe("completed");
      expect(lastProgress.loadedBytes).toBe(8);
    });

    it("should report error progress when fetch fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network disconnect"));

      const progressUpdates: any[] = [];
      await expect(
        service.downloadArchive(
          "fail-route",
          "https://example.com/fail.pmtiles",
          undefined,
          (p) => progressUpdates.push({ ...p })
        )
      ).rejects.toThrow("Network disconnect");

      const lastProgress = progressUpdates[progressUpdates.length - 1];
      expect(lastProgress.status).toBe("error");
      expect(lastProgress.errorMessage).toContain("Network disconnect");
    });

    it("should provide route section metadata and multi-section identification", () => {
      expect(service.hasSections("tour-divide-2025")).toBe(true);
      expect(service.hasSections("arizona-trail-300")).toBe(false);

      const tdSections = service.getRouteSections("tour-divide-2025");
      expect(tdSections.length).toBe(4);
      expect(tdSections[0].name).toContain("Section 1");
      expect(tdSections[3].name).toContain("Section 4");

      const aztSections = service.getRouteSections("arizona-trail-300");
      expect(aztSections.length).toBe(1);
      expect(aztSections[0].sectionId).toBe("full");
    });

    it("should provide estimated size strings and format bytes accurately", () => {
      expect(service.getEstimatedSize("tour-divide-2025")).toContain("110 MB (4 sections)");
      expect(service.getEstimatedSize("arizona-trail-300")).toBe("~15 MB");
      expect(service.getEstimatedSize("colorado-trail")).toBe("~25 MB");

      expect(service.formatBytes(0)).toBe("0 B");
      expect(service.formatBytes(500)).toBe("500 B");
      expect(service.formatBytes(1536)).toBe("1.5 KB");
      expect(service.formatBytes(15 * 1024 * 1024)).toBe("15.0 MB");
      expect(service.formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
    });

    it("should estimate storage quota and report used bytes", async () => {
      const estimate = await service.getStorageEstimate();
      expect(estimate).toBeTruthy();
      expect(typeof estimate.usedBytes).toBe("number");
      expect(typeof estimate.quotaBytes).toBe("number");
      expect(estimate.quotaBytes).toBeGreaterThan(0);
    });

    it("should handle download failure, update status to error, and rethrow", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection failed"));

      await expect(service.downloadRoute("colorado-trail")).rejects.toThrow("Network connection failed");

      const progress = service.getDownloadProgress("colorado-trail");
      expect(progress?.status).toBe("error");
      expect(progress?.errorMessage).toContain("Network connection failed");
      expect(service.isRouteCachedSync("colorado-trail")).toBe(false);
      expect(service.isDownloading("colorado-trail")).toBe(false);
    });

    it("should download a route successfully and update activeDownloads signal", async () => {
      const headerBytes = new Uint8Array(127);
      headerBytes[0] = 0x50; // 'P'
      headerBytes[1] = 0x4d; // 'M'
      headerBytes[2] = 0x54; // 'T'
      headerBytes[3] = 0x03; // version 3

      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(headerBytes, {
          status: 200,
          headers: { "Content-Length": "127" }
        })
      );

      const downloadedBlob = await service.downloadRoute("colorado-trail");
      expect(downloadedBlob).toBeTruthy();
      expect(downloadedBlob.size).toBe(127);
      expect(service.isRouteCachedSync("colorado-trail")).toBe(true);

      const progress = service.getDownloadProgress("colorado-trail");
      expect(progress?.status).toBe("completed");
      expect(progress?.percentage).toBe(100);
      expect(service.isDownloading("colorado-trail")).toBe(false);
    });

    it("should download all sections of a multi-section route successfully", async () => {
      const headerBytes = new Uint8Array(127);
      headerBytes[0] = 0x50;
      headerBytes[1] = 0x4d;
      headerBytes[2] = 0x54;
      headerBytes[3] = 0x03;

      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(headerBytes, {
          status: 200,
          headers: { "Content-Length": "127" }
        })
      );

      const blob = await service.downloadRoute("tour-divide-2025");
      expect(blob).toBeTruthy();
      expect(service.isRouteCachedSync("tour-divide-2025")).toBe(true);
      expect(service.isSectionCached("tour-divide-2025", "1")).toBe(true);
      expect(service.isSectionCached("tour-divide-2025", "4")).toBe(true);

      const p = service.getDownloadProgress("tour-divide-2025");
      expect(p?.status).toBe("completed");
      expect(p?.percentage).toBe(100);
    });

    it("should propagate error when multi-section download fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Multi-section fetch timeout"));

      await expect(service.downloadRoute("tour-divide-2025")).rejects.toThrow("Multi-section fetch timeout");

      const p = service.getDownloadProgress("tour-divide-2025");
      expect(p?.status).toBe("error");
      expect(p?.errorMessage).toContain("Multi-section fetch timeout");
    });
  });
});
