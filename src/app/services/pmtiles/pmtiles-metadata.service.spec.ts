import { TestBed } from '@angular/core/testing';
import { PmtilesMetadataService } from './pmtiles-metadata.service';
import { PmtilesDbService } from './pmtiles-db.service';

describe('PmtilesMetadataService', () => {
  let service: PmtilesMetadataService;
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      getTotalStorageBytes: vi.fn().mockResolvedValue(100 * 1024 * 1024)
    };

    TestBed.configureTestingModule({
      providers: [
        PmtilesMetadataService,
        { provide: PmtilesDbService, useValue: dbMock }
      ]
    });

    service = TestBed.inject(PmtilesMetadataService);
  });

  it('should identify routes with multi-sections', () => {
    expect(service.hasSections('tour-divide-2025')).toBe(true);
    expect(service.hasSections('colorado-trail')).toBe(false);
  });

  it('should return 4 sections for tour-divide-2025 and 1 for others', () => {
    expect(service.getRouteSections('tour-divide-2025').length).toBe(4);
    expect(service.getRouteSections('colorado-trail').length).toBe(1);
  });

  it('should estimate size accurately in bytes and human strings', () => {
    expect(service.getEstimatedSizeBytes('tour-divide-2025')).toBe(110 * 1024 * 1024);
    expect(service.getEstimatedSize('tour-divide-2025')).toContain('110 MB (4 sections)');
    expect(service.getEstimatedSize('colorado-trail')).toBe('~25 MB');
  });

  it('should format bytes nicely into KB, MB, and GB', () => {
    expect(service.formatBytes(0)).toBe('0 B');
    expect(service.formatBytes(500)).toBe('500 B');
    expect(service.formatBytes(1500)).toBe('1.5 KB');
    expect(service.formatBytes(15 * 1024 * 1024)).toBe('15.0 MB');
    expect(service.formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });

  it('should return storage estimates based on dbService and navigator', async () => {
    const est = await service.getStorageEstimate();
    expect(est.usedBytes).toBeGreaterThan(0);
    expect(est.quotaBytes).toBeGreaterThan(0);
  });
});
