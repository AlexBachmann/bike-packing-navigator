import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PmtilesStorageService, RouteSectionMeta } from '../../services/pmtiles-storage.service';
import { SettingsService } from '../../services/settings.service';
import { RouteManifestService } from '../../services/route-manifest.service';
import { ToastService } from '../../services/toast.service';
import { TileCacheService } from '../../services/tile-cache.service';
import { RouteSummary } from '../../models/route.model';

export interface RouteDownloadEvent {
  routeId: string;
  sectionId?: string;
}

@Component({
  selector: 'app-settings-offline-maps',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Offline Maps & Storage Card -->
    <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="font-bold text-white text-sm flex items-center gap-1.5">
            <span>📦</span>
            <span>Offline Maps & Storage</span>
          </h2>
          <p class="text-[11px] text-slate-400 mt-0.5">
            Download vector corridor PMTiles for 100% offline navigation in remote canyons.
          </p>
        </div>

        <button
          type="button"
          (click)="onOpenWipeConfirm()"
          class="px-2.5 py-1 text-[11px] font-mono font-medium rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 transition cursor-pointer shrink-0"
          title="Delete all cached vector PMTiles archives"
        >
          Wipe All Archives
        </button>
      </div>

      <!-- Storage Quota Bar -->
      <div class="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-2 mb-4">
        <div class="flex items-center justify-between text-xs font-mono">
          <span class="text-slate-400">Total Offline Storage</span>
          <span class="text-emerald-400 font-bold">
            {{ formatBytes(totalUsedBytes()) }}
            @if (quotaBytes() > 0) {
              <span class="text-slate-500 font-normal">/ {{ formatBytes(quotaBytes()) }}</span>
            }
          </span>
        </div>
        <div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
            [style.width.%]="storageUsagePercent() > 0 ? storageUsagePercent() : (totalUsedBytes() > 0 ? 3 : 0)"
          ></div>
        </div>
        <p class="text-[10px] text-slate-500">
          Vector archives are saved in browser Origin Private File System (OPFS) and persist across sessions.
        </p>
      </div>

      <!-- Map Renderer Engine Selector -->
      <div class="mb-4 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <label class="text-slate-300 font-medium flex items-center gap-1.5">
            <span>🗺️</span>
            <span>Map Rendering Engine</span>
          </label>
          <span class="text-[10px] text-emerald-400 font-mono">Instant Switch</span>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            (click)="onSetMapRenderer('auto')"
            class="p-2.5 rounded-lg border text-left cursor-pointer transition"
            [ngClass]="mapRenderer() === 'auto'
              ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-300 shadow-sm'
              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'"
          >
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs flex items-center gap-1.5">⚡ Auto-detect Vector</span>
              @if (mapRenderer() === 'auto') {
                <span class="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-500/20 px-1.5 py-0.5 rounded">RECOMMENDED</span>
              }
            </div>
            <p class="text-[10px] text-slate-400 mt-1">
              Auto uses crisp vector tiles when downloaded or available; seamlessly falls back to online raster.
            </p>
          </button>

          <button
            type="button"
            (click)="onSetMapRenderer('raster')"
            class="p-2.5 rounded-lg border text-left cursor-pointer transition"
            [ngClass]="mapRenderer() === 'raster'
              ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-300 shadow-sm'
              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'"
          >
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs flex items-center gap-1.5">🌐 Force Raster</span>
              @if (mapRenderer() === 'raster') {
                <span class="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-500/20 px-1.5 py-0.5 rounded">ACTIVE</span>
              }
            </div>
            <p class="text-[10px] text-slate-400 mt-1">
              Always uses lightweight raster tiles. Saves storage and avoids vector overhead on older devices.
            </p>
          </button>
        </div>
      </div>

      <!-- Per-Route Storage Breakdown List -->
      <div class="space-y-2">
        <div class="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
          <span>📂</span>
          <span>Route Corridor Archives</span>
        </div>

        @if (routes().length === 0) {
          <p class="text-xs text-slate-500 italic p-3 bg-slate-950/40 rounded-lg border border-slate-800">
            No routes loaded in manifest.
          </p>
        } @else {
          <div class="space-y-2">
            @for (route of routes(); track route.id) {
              <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="w-6 h-6 rounded bg-slate-800 text-emerald-400 text-xs font-mono font-bold flex items-center justify-center shrink-0">
                      {{ route.badge || 'RT' }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-bold text-white truncate">{{ route.name }}</div>
                      <div class="text-[10px] text-slate-400 font-mono">
                        Est. {{ getEstimatedSize(route.id) }}
                        @if (isRouteCached(route.id)) {
                          <span class="text-emerald-400 font-semibold ml-1.5">● Cached</span>
                        } @else {
                          <span class="text-slate-500 ml-1.5">○ Not Cached</span>
                        }
                      </div>
                    </div>
                  </div>

                  <!-- Route Actions -->
                  <div class="flex items-center gap-1.5 shrink-0">
                    @if (hasSections(route.id)) {
                      <button
                        type="button"
                        (click)="onToggleRouteSections(route.id)"
                        class="px-2 py-1 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                      >
                        Sections ({{ getSections(route.id).length }}) {{ isRouteExpanded(route.id) ? '▴' : '▾' }}
                      </button>
                    }

                    @if (isDownloading(route.id)) {
                      <span class="px-2 py-1 text-[10px] font-mono rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse">
                        {{ getDownloadProgress(route.id) }}%
                      </span>
                    } @else if (isRouteCached(route.id)) {
                      <button
                        type="button"
                        (click)="onDownloadRoute(route.id)"
                        class="px-2 py-1 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                        title="Re-download full archive"
                      >
                        Re-download
                      </button>
                      <button
                        type="button"
                        (click)="onDeleteRoute(route.id)"
                        class="px-2 py-1 text-[10px] font-mono rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 hover:text-rose-300 border border-rose-800/50 transition cursor-pointer"
                        title="Delete archive from storage"
                      >
                        Delete
                      </button>
                    } @else {
                      <button
                        type="button"
                        (click)="onDownloadRoute(route.id)"
                        class="px-2.5 py-1 text-[10px] font-mono font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
                      >
                        ⬇ Download
                      </button>
                    }
                  </div>
                </div>

                <!-- Multi-section Expansion Panel -->
                @if (hasSections(route.id) && isRouteExpanded(route.id)) {
                  <div class="mt-2 pt-2 border-t border-slate-800/80 space-y-1.5 pl-3">
                    <div class="text-[10px] uppercase font-mono text-slate-500 font-bold mb-1">
                      Route Sections (Modular Download)
                    </div>
                    @for (sec of getSections(route.id); track sec.sectionId) {
                      <div class="flex items-center justify-between gap-2 p-1.5 bg-slate-900/60 rounded-lg border border-slate-800/60 text-xs">
                        <div class="min-w-0 flex-1">
                          <div class="text-[11px] font-medium text-slate-200 truncate">{{ sec.name }}</div>
                          <div class="text-[9px] font-mono text-slate-400">
                            Est. {{ formatBytes(sec.estimatedSizeBytes) }}
                            @if (isRouteCached(route.id, sec.sectionId)) {
                              <span class="text-emerald-400 ml-1">✓ Cached</span>
                            } @else {
                              <span class="text-slate-500 ml-1">○ Online Only</span>
                            }
                          </div>
                        </div>

                        <div class="flex items-center gap-1 shrink-0">
                          @if (isDownloading(route.id, sec.sectionId)) {
                            <span class="px-1.5 py-0.5 text-[9px] font-mono rounded bg-sky-500/20 text-sky-300">
                              {{ getDownloadProgress(route.id, sec.sectionId) }}%
                            </span>
                          } @else if (isRouteCached(route.id, sec.sectionId)) {
                            <button
                              type="button"
                              (click)="onDeleteRoute(route.id, sec.sectionId)"
                              class="px-1.5 py-0.5 text-[9px] font-mono rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-800/40 transition cursor-pointer"
                              title="Delete section archive"
                            >
                              Delete
                            </button>
                          } @else {
                            <button
                              type="button"
                              (click)="onDownloadRoute(route.id, sec.sectionId)"
                              class="px-2 py-0.5 text-[9px] font-mono font-medium rounded bg-emerald-700 hover:bg-emerald-600 text-white transition cursor-pointer"
                            >
                              ⬇ Download
                            </button>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>

    <!-- Wipe Offline Archives Confirmation Modal -->
    @if (showWipeConfirm()) {
      <div class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
        <div class="bg-slate-900 border border-rose-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl shadow-black/90 flex flex-col gap-3">
          <div class="flex items-center gap-2.5 text-rose-400">
            <span class="text-2xl leading-none">🗑️</span>
            <h3 class="font-bold text-white text-base">Wipe Offline Map Archives?</h3>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed">
            This will permanently delete all downloaded PMTiles vector files from your device storage. You will need an internet connection to re-download them.
          </p>
          <div class="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800 mt-1">
            <button
              type="button"
              (click)="onCancelWipeConfirm()"
              class="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="onConfirmWipeAllArchives()"
              class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition shadow-lg shadow-rose-950 cursor-pointer"
            >
              Yes, Wipe Archives
            </button>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class SettingsOfflineMapsComponent implements OnInit {
  readonly pmtilesStorage = inject(PmtilesStorageService);
  readonly settings = inject(SettingsService);
  readonly manifestService = inject(RouteManifestService);
  readonly toast = inject(ToastService);
  readonly tileCache = inject(TileCacheService);

  // --- Inputs ---
  readonly totalUsedBytes = input<number>(0);
  readonly quotaBytes = input<number>(0);
  readonly storageUsagePercent = input<number>(0);
  readonly mapRenderer = input<'auto' | 'raster'>('auto');
  readonly routes = input<RouteSummary[]>([]);
  readonly expandedRoutes = input<Set<string>>(new Set());
  readonly showWipeConfirm = input<boolean>(false);
  readonly cachedTileCount = input<number>(0);

  // --- Outputs ---
  readonly setMapRenderer = output<'auto' | 'raster'>();
  readonly openWipeConfirm = output<void>();
  readonly cancelWipeConfirm = output<void>();
  readonly confirmWipeAllArchives = output<void>();
  readonly toggleRouteSections = output<string>();
  readonly downloadRoute = output<RouteDownloadEvent>();
  readonly deleteRoute = output<RouteDownloadEvent>();
  readonly cancelDownload = output<RouteDownloadEvent>();
  readonly clearRasterCache = output<void>();

  // Internal reactive state for tile cache metrics
  readonly rasterTilesCount = signal<number>(0);

  async ngOnInit(): Promise<void> {
    try {
      const count = await this.tileCache.getCachedTileCount();
      this.rasterTilesCount.set(count);
    } catch {
      // Ignore cache storage inspection error in restricted environments
    }
  }

  // --- Helper Methods ---
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

  isRouteExpanded(routeId: string): boolean {
    return this.expandedRoutes().has(routeId);
  }

  onSetMapRenderer(mode: 'auto' | 'raster'): void {
    this.settings.setMapRenderer(mode);
    this.setMapRenderer.emit(mode);
  }

  onOpenWipeConfirm(): void {
    this.openWipeConfirm.emit();
  }

  onCancelWipeConfirm(): void {
    this.cancelWipeConfirm.emit();
  }

  onConfirmWipeAllArchives(): void {
    this.confirmWipeAllArchives.emit();
  }

  onToggleRouteSections(routeId: string): void {
    this.toggleRouteSections.emit(routeId);
  }

  onDownloadRoute(routeId: string, sectionId?: string): void {
    this.downloadRoute.emit({ routeId, sectionId });
  }

  onDeleteRoute(routeId: string, sectionId?: string): void {
    this.deleteRoute.emit({ routeId, sectionId });
  }
}
