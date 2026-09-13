import { Injectable, inject, signal, effect, OnDestroy } from '@angular/core';
import { SettingsService } from './settings.service';
import { PwaInstallService } from './pwa-install.service';

@Injectable({
  providedIn: 'root'
})
export class WakeLockService implements OnDestroy {
  private readonly settings = inject(SettingsService);
  readonly pwaInstall = inject(PwaInstallService);

  readonly isSupported = signal<boolean>(
    typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!(navigator as any).wakeLock
  );
  readonly isActive = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  private sentinel: any = null;
  private visibilityHandler: (() => void) | null = null;
  private userInteractionHandler: (() => void) | null = null;

  constructor() {
    this.init();
  }

  init(): void {
    if (!this.isSupported()) {
      return;
    }

    // Reactively request or release wake lock based on user setting and standalone state
    effect(() => {
      const shouldKeepAwake = this.settings.keepScreenAwake();
      const isStandalone = this.pwaInstall.isStandalone();
      if (shouldKeepAwake && isStandalone) {
        this.requestWakeLock();
      } else {
        this.releaseWakeLock();
      }
    });

    // Handle visibility changes: re-acquire lock when app returns to foreground
    if (typeof document !== 'undefined') {
      this.visibilityHandler = async () => {
        if (
          document.visibilityState === 'visible' &&
          this.settings.keepScreenAwake() &&
          !this.sentinel
        ) {
          await this.requestWakeLock();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // Some mobile browsers require a user gesture before granting wake lock
    if (typeof window !== 'undefined') {
      this.userInteractionHandler = async () => {
        if (this.settings.keepScreenAwake() && !this.sentinel) {
          await this.requestWakeLock();
        }
      };
      window.addEventListener('pointerdown', this.userInteractionHandler, { passive: true });
    }
  }

  async requestWakeLock(): Promise<boolean> {
    if (!this.isSupported() || typeof navigator === 'undefined' || !navigator.wakeLock) {
      return false;
    }

    // Gated behind installed PWA: screen wake lock is only active in standalone mode
    if (!this.pwaInstall.isStandalone()) {
      this.isActive.set(false);
      this.errorMessage.set('PWA installation required to activate screen wake lock');
      return false;
    }

    // Already locked and active
    if (this.sentinel && !this.sentinel.released) {
      this.isActive.set(true);
      return true;
    }

    try {
      this.sentinel = await (navigator.wakeLock as any).request('screen');
      this.isActive.set(true);
      this.errorMessage.set(null);

      this.sentinel.addEventListener('release', () => {
        this.isActive.set(false);
        this.sentinel = null;
      });

      return true;
    } catch (err: any) {
      // Browser may reject if battery saver is active, window is hidden, or gesture needed
      this.isActive.set(false);
      this.sentinel = null;
      this.errorMessage.set(err?.message || 'Failed to acquire wake lock');
      return false;
    }
  }

  async releaseWakeLock(): Promise<void> {
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Ignored
      }
      this.sentinel = null;
    }
    this.isActive.set(false);
  }

  ngOnDestroy(): void {
    this.releaseWakeLock();
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (typeof window !== 'undefined' && this.userInteractionHandler) {
      window.removeEventListener('pointerdown', this.userInteractionHandler);
    }
  }
}
