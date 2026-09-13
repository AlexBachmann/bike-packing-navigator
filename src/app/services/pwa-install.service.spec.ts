import { TestBed } from '@angular/core/testing';
import { PwaInstallService } from './pwa-install.service';

describe('PwaInstallService', () => {
  let service: PwaInstallService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PwaInstallService]
    });
    service = TestBed.inject(PwaInstallService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should detect initial standalone status', () => {
    // In node/JSDOM default, standalone should be false
    expect(typeof service.isStandalone()).toBe('boolean');
  });

  it('should capture beforeinstallprompt event and enable canInstall', () => {
    const mockPromptEvent = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' })
    };

    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt'), mockPromptEvent)
    );

    expect(service.canInstall()).toBe(true);
  });

  it('should execute promptInstall with deferred prompt when user accepts', async () => {
    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const mockPromptEvent = {
      preventDefault: vi.fn(),
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' })
    };

    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt'), mockPromptEvent)
    );

    expect(service.canInstall()).toBe(true);

    const outcome = await service.promptInstall();
    expect(mockPrompt).toHaveBeenCalled();
    expect(outcome).toBe('accepted');
    expect(service.isInstalled()).toBe(true);
    expect(service.isStandalone()).toBe(true);
    expect(service.canInstall()).toBe(false);
  });

  it('should handle promptInstall when user dismisses prompt', async () => {
    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const mockPromptEvent = {
      preventDefault: vi.fn(),
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' })
    };

    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt'), mockPromptEvent)
    );

    const outcome = await service.promptInstall();
    expect(outcome).toBe('dismissed');
    expect(service.canInstall()).toBe(false);
  });

  it('should show install modal when promptInstall is called without deferred prompt', async () => {
    expect(service.showInstallModal()).toBe(false);
    const outcome = await service.promptInstall();
    expect(outcome).toBe('instructions_shown');
    expect(service.showInstallModal()).toBe(true);

    service.closeInstallModal();
    expect(service.showInstallModal()).toBe(false);
  });

  it('should handle appinstalled event', () => {
    window.dispatchEvent(new Event('appinstalled'));
    expect(service.isInstalled()).toBe(true);
    expect(service.isStandalone()).toBe(true);
    expect(service.canInstall()).toBe(false);
  });

  it('should allow setting standalone manually for test harnesses', () => {
    service.setStandaloneForTesting(true);
    expect(service.isStandalone()).toBe(true);
    expect(service.isInstalled()).toBe(true);

    service.setStandaloneForTesting(false);
    expect(service.isStandalone()).toBe(false);
  });
});
