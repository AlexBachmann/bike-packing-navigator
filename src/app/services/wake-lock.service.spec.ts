import { TestBed } from '@angular/core/testing';
import { WakeLockService } from './wake-lock.service';
import { SettingsService } from './settings.service';
import { PwaInstallService } from './pwa-install.service';

describe('WakeLockService', () => {
  let service: WakeLockService;
  let settings: SettingsService;
  let pwaInstall: PwaInstallService;
  let mockSentinel: any;

  beforeEach(() => {
    localStorage.clear();

    mockSentinel = {
      released: false,
      listeners: new Map<string, Function>(),
      addEventListener(event: string, fn: Function) {
        this.listeners.set(event, fn);
      },
      removeEventListener(event: string) {
        this.listeners.delete(event);
      },
      async release() {
        this.released = true;
        const cb = this.listeners.get('release');
        if (cb) cb();
      }
    };

    // Mock navigator.wakeLock
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: vi.fn().mockResolvedValue(mockSentinel)
      },
      configurable: true,
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [WakeLockService, SettingsService, PwaInstallService]
    });

    settings = TestBed.inject(SettingsService);
    pwaInstall = TestBed.inject(PwaInstallService);
    pwaInstall.setStandaloneForTesting(true);
    service = TestBed.inject(WakeLockService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    localStorage.clear();
  });

  it('should be created and detect support', () => {
    expect(service).toBeTruthy();
    expect(service.isSupported()).toBe(true);
  });

  it('should request wake lock when supported and enabled', async () => {
    const success = await service.requestWakeLock();
    expect(success).toBe(true);
    expect(service.isActive()).toBe(true);
    expect((navigator.wakeLock as any).request).toHaveBeenCalledWith('screen');
  });

  it('should release wake lock when releaseWakeLock is called', async () => {
    await service.requestWakeLock();
    expect(service.isActive()).toBe(true);

    await service.releaseWakeLock();
    expect(service.isActive()).toBe(false);
    expect(mockSentinel.released).toBe(true);
  });

  it('should handle sentinel release event', async () => {
    await service.requestWakeLock();
    expect(service.isActive()).toBe(true);

    // Trigger browser releasing the lock (e.g. background tab)
    await mockSentinel.release();
    expect(service.isActive()).toBe(false);
  });

  it('should handle wakeLock request rejection gracefully', async () => {
    (navigator.wakeLock as any).request = vi.fn().mockRejectedValue(new Error('Battery saver active'));
    // Clear existing sentinel
    await service.releaseWakeLock();

    const success = await service.requestWakeLock();
    expect(success).toBe(false);
    expect(service.isActive()).toBe(false);
    expect(service.errorMessage()).toBe('Battery saver active');
  });

  it('should return false if wakeLock is not supported', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
      writable: true
    });

    // Create a new instance with unsupported environment
    const unsupportedService = TestBed.runInInjectionContext(() => new WakeLockService());
    expect(unsupportedService.isSupported()).toBe(false);

    const success = await unsupportedService.requestWakeLock();
    expect(success).toBe(false);
    expect(unsupportedService.isActive()).toBe(false);
  });

  it('should reject wake lock and indicate PWA install required when not in standalone mode', async () => {
    pwaInstall.setStandaloneForTesting(false);
    const success = await service.requestWakeLock();
    expect(success).toBe(false);
    expect(service.isActive()).toBe(false);
    expect(service.errorMessage()).toContain('PWA installation required');
  });
});
