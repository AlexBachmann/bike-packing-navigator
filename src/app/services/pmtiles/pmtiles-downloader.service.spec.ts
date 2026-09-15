import { TestBed } from '@angular/core/testing';
import { PmtilesDownloaderService } from './pmtiles-downloader.service';
import { PmtilesDbService } from './pmtiles-db.service';
import { PmtilesMetadataService } from './pmtiles-metadata.service';

describe('PmtilesDownloaderService', () => {
  let service: PmtilesDownloaderService;
  let dbMock: any;
  let metadataMock: any;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    dbMock = {
      buildKey: (r: string, s?: string) => (s ? `${r}/${s}` : r),
      saveArchive: vi.fn().mockResolvedValue(undefined)
    };

    metadataMock = {
      hasSections: vi.fn().mockReturnValue(false),
      getRouteSections: vi.fn().mockReturnValue([
        { sectionId: 'full', estimatedSizeBytes: 1000, url: '/test.pmtiles' }
      ]),
      getEstimatedSizeBytes: vi.fn().mockReturnValue(1000)
    };

    TestBed.configureTestingModule({
      providers: [
        PmtilesDownloaderService,
        { provide: PmtilesDbService, useValue: dbMock },
        { provide: PmtilesMetadataService, useValue: metadataMock }
      ]
    });

    service = TestBed.inject(PmtilesDownloaderService);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should stream downloadArchive and report progress', async () => {
    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5]);

    const mockResponse = {
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-length' ? '5' : null)
      },
      body: {
        getReader: () => {
          let step = 0;
          return {
            read: async () => {
              if (step === 0) {
                step++;
                return { done: false, value: chunk1 };
              }
              if (step === 1) {
                step++;
                return { done: false, value: chunk2 };
              }
              return { done: true, value: undefined };
            }
          };
        }
      }
    };

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const progressUpdates: number[] = [];
    const blob = await service.downloadArchive('test-route', '/test.pmtiles', undefined, (p) => {
      progressUpdates.push(p.percentage);
    });

    expect(blob.size).toBe(5);
    expect(progressUpdates).toContain(100);
    expect(dbMock.saveArchive).toHaveBeenCalled();
  });

  it('should track activeDownloads and isDownloading', async () => {
    const mockResponse = {
      ok: true,
      headers: { get: () => null },
      body: null,
      blob: async () => new Blob(['data'])
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    expect(service.isDownloading('test-route')).toBe(false);
    await service.downloadRoute('test-route');
    expect(service.getDownloadProgress('test-route')?.status).toBe('completed');
  });
});
