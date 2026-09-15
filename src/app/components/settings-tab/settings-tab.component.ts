import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { WakeLockService } from '../../services/wake-lock.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { ToastService } from '../../services/toast.service';
import { PmtilesStorageService, RouteSectionMeta } from '../../services/pmtiles-storage.service';
import { RouteManifestService } from '../../services/route-manifest.service';
import { SettingsRiderRigComponent } from './settings-rider-rig.component';
import { SettingsPaceEtaComponent } from './settings-pace-eta.component';
import { SettingsOfflineMapsComponent } from './settings-offline-maps.component';

@Component({
  selector: 'app-settings-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SettingsRiderRigComponent,
    SettingsPaceEtaComponent,
    SettingsOfflineMapsComponent
  ],
  templateUrl: './settings-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class SettingsTabComponent implements OnInit {
  readonly settings = inject(SettingsService);
  readonly wakeLock = inject(WakeLockService);
  readonly pwaInstall = inject(PwaInstallService);
  readonly toast = inject(ToastService);
  readonly pmtilesStorage = inject(PmtilesStorageService);
  readonly manifestService = inject(RouteManifestService);

  // Confirmation modal state for clearing local storage
  readonly showClearConfirm = signal<boolean>(false);
  // Confirmation modal state for wiping offline map archives
  readonly showWipeConfirm = signal<boolean>(false);

  readonly riderPowerWatts = this.settings.riderPowerWatts;
  readonly paceMode = this.settings.paceMode;
  readonly displaySpeed = this.settings.displaySpeed;
  readonly speedUnit = this.settings.speedUnit;
  readonly mapRenderer = this.settings.mapRenderer;

  readonly totalUsedBytes = signal<number>(0);
  readonly quotaBytes = signal<number>(0);
  readonly expandedRoutes = signal<Set<string>>(new Set());

  readonly routes = computed(() => {
    return this.manifestService.availableRoutes();
  });

  readonly storageUsagePercent = computed(() => {
    const quota = this.quotaBytes();
    if (quota <= 0) return 0;
    return Math.min(100, Math.round((this.totalUsedBytes() / quota) * 100));
  });

  async ngOnInit(): Promise<void> {
    await this.refreshStorageStats();
  }

  async refreshStorageStats(): Promise<void> {
    try {
      const est = await this.pmtilesStorage.getStorageEstimate();
      this.totalUsedBytes.set(est.usedBytes);
      this.quotaBytes.set(est.quotaBytes);
    } catch {
      // ignore
    }
  }

  formatBytes(bytes: number): string {
    return this.pmtilesStorage.formatBytes(bytes);
  }

  isRouteCached(routeId: string, sectionId?: string): boolean {
    return this.pmtilesStorage.isRouteCachedSync(routeId, sectionId);
  }

  isDownloading(routeId: string, sectionId?: string): boolean {
    return this.pmtilesStorage.isDownloading(routeId, sectionId);
  }

  getDownloadProgress(routeId: string, sectionId?: string): number {
    return this.pmtilesStorage.getDownloadProgress(routeId, sectionId)?.percentage ?? 0;
  }

  getEstimatedSize(routeId: string, sectionId?: string): string {
    if (sectionId) {
      const sec = this.pmtilesStorage.getRouteSections(routeId).find((s) => s.sectionId === sectionId);
      if (sec) return this.formatBytes(sec.estimatedSizeBytes);
    }
    return this.pmtilesStorage.getEstimatedSize(routeId);
  }

  hasSections(routeId: string): boolean {
    return this.pmtilesStorage.hasSections(routeId);
  }

  getSections(routeId: string): RouteSectionMeta[] {
    return this.pmtilesStorage.getRouteSections(routeId);
  }

  toggleRouteSections(routeId: string): void {
    this.expandedRoutes.update((set) => {
      const next = new Set(set);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else {
        next.add(routeId);
      }
      return next;
    });
  }

  isRouteExpanded(routeId: string): boolean {
    return this.expandedRoutes().has(routeId);
  }

  async downloadRoute(routeId: string, sectionId?: string): Promise<void> {
    try {
      await this.pmtilesStorage.downloadRoute(routeId, sectionId);
      await this.refreshStorageStats();
      const label = sectionId ? `${routeId} (${sectionId})` : routeId;
      this.toast.showSuccess(`Downloaded offline vector map for ${label}`);
    } catch (err: any) {
      this.toast.showError(`Download failed: ${err.message || err}`);
    }
  }

  async deleteRoute(routeId: string, sectionId?: string): Promise<void> {
    try {
      await this.pmtilesStorage.deleteRoute(routeId, sectionId);
      await this.refreshStorageStats();
      const label = sectionId ? `${routeId} (${sectionId})` : routeId;
      this.toast.showSuccess(`Deleted offline archive for ${label}`);
    } catch (err: any) {
      this.toast.showError(`Delete failed: ${err.message || err}`);
    }
  }

  openClearConfirm(): void {
    this.showClearConfirm.set(true);
  }

  cancelClearConfirm(): void {
    this.showClearConfirm.set(false);
  }

  confirmClearLocalStorage(): void {
    this.settings.clearAllLocalStorage();
    this.showClearConfirm.set(false);
    this.toast.showSuccess('Local storage cleared & default recipes restored');
  }

  openWipeConfirm(): void {
    this.showWipeConfirm.set(true);
  }

  cancelWipeConfirm(): void {
    this.showWipeConfirm.set(false);
  }

  async confirmWipeAllArchives(): Promise<void> {
    try {
      await this.pmtilesStorage.clearAllArchives();
      await this.refreshStorageStats();
      this.showWipeConfirm.set(false);
      this.toast.showSuccess('All offline vector map archives wiped');
    } catch (err: any) {
      this.toast.showError(`Failed to wipe archives: ${err.message || err}`);
    }
  }
}
