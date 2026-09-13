import { Injectable, signal, OnDestroy } from '@angular/core';

export type InstallOutcome = 'accepted' | 'dismissed' | 'instructions_shown';

@Injectable({
  providedIn: 'root'
})
export class PwaInstallService implements OnDestroy {
  /**
   * Whether the app is currently running in standalone display mode (installed PWA).
   */
  readonly isStandalone = signal<boolean>(this.checkIsStandalone());

  /**
   * Whether a browser installation prompt is deferred and ready to be triggered.
   */
  readonly canInstall = signal<boolean>(false);

  /**
   * Whether the user has installed the PWA (either standalone or via appinstalled event).
   */
  readonly isInstalled = signal<boolean>(this.checkIsStandalone());

  /**
   * Whether the client device is iOS (iPhone/iPad).
   */
  readonly isIOS = signal<boolean>(this.checkIsIOS());

  /**
   * Whether the install instructions modal is open.
   */
  readonly showInstallModal = signal<boolean>(false);

  private deferredPrompt: any = null;
  private beforeInstallHandler: ((e: any) => void) | null = null;
  private appInstalledHandler: (() => void) | null = null;
  private mediaQueryList: MediaQueryList | null = null;
  private mediaQueryHandler: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    this.init();
  }

  private init(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Capture beforeinstallprompt event (Chromium, Android Chrome, Edge)
    this.beforeInstallHandler = (e: any) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.canInstall.set(true);
    };
    window.addEventListener('beforeinstallprompt', this.beforeInstallHandler);

    // Track appinstalled event
    this.appInstalledHandler = () => {
      this.isInstalled.set(true);
      this.isStandalone.set(true);
      this.canInstall.set(false);
      this.deferredPrompt = null;
    };
    window.addEventListener('appinstalled', this.appInstalledHandler);

    // Monitor display-mode changes
    if (window.matchMedia) {
      this.mediaQueryList = window.matchMedia('(display-mode: standalone)');
      this.mediaQueryHandler = (e: MediaQueryListEvent) => {
        const standalone = e.matches || this.checkIsStandalone();
        this.isStandalone.set(standalone);
        if (standalone) {
          this.isInstalled.set(true);
        }
      };
      if (this.mediaQueryList.addEventListener) {
        this.mediaQueryList.addEventListener('change', this.mediaQueryHandler);
      }
    }
  }

  /**
   * Trigger the PWA installation.
   * If a deferred browser prompt is available, it is invoked directly.
   * Otherwise, opens the platform-tailored installation guide modal.
   */
  async promptInstall(): Promise<InstallOutcome> {
    if (this.deferredPrompt) {
      try {
        await this.deferredPrompt.prompt();
        const choice = await this.deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          this.isInstalled.set(true);
          this.isStandalone.set(true);
        }
        this.deferredPrompt = null;
        this.canInstall.set(false);
        return choice?.outcome || 'accepted';
      } catch {
        this.showInstallModal.set(true);
        return 'instructions_shown';
      }
    }

    // Fallback: show instructions modal (especially for iOS Safari or desktop browser controls)
    this.showInstallModal.set(true);
    return 'instructions_shown';
  }

  openInstallGuide(): void {
    this.showInstallModal.set(true);
  }

  closeInstallModal(): void {
    this.showInstallModal.set(false);
  }

  /**
   * Test helper to set standalone state in unit test environments
   */
  setStandaloneForTesting(val: boolean): void {
    this.isStandalone.set(val);
    if (val) {
      this.isInstalled.set(true);
    }
  }

  private checkIsStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    const isStandaloneMatchMedia =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (window.navigator as any)?.standalone === true;
    const isAndroidTWA =
      typeof document !== 'undefined' &&
      document.referrer?.startsWith('android-app://');

    return Boolean(isStandaloneMatchMedia || isIOSStandalone || isAndroidTWA);
  }

  private checkIsIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent || '') &&
      !(typeof window !== 'undefined' && (window as any).MSStream)
    );
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      if (this.beforeInstallHandler) {
        window.removeEventListener('beforeinstallprompt', this.beforeInstallHandler);
      }
      if (this.appInstalledHandler) {
        window.removeEventListener('appinstalled', this.appInstalledHandler);
      }
      if (this.mediaQueryList && this.mediaQueryHandler && this.mediaQueryList.removeEventListener) {
        this.mediaQueryList.removeEventListener('change', this.mediaQueryHandler);
      }
    }
  }
}
