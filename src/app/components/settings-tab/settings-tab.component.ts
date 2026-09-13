import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { WakeLockService } from '../../services/wake-lock.service';
import { PwaInstallService } from '../../services/pwa-install.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-settings-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block'
  }
})
export class SettingsTabComponent {
  readonly settings = inject(SettingsService);
  readonly wakeLock = inject(WakeLockService);
  readonly pwaInstall = inject(PwaInstallService);
  readonly toast = inject(ToastService);

  // Confirmation modal state for clearing local storage
  readonly showClearConfirm = signal<boolean>(false);

  readonly riderPowerWatts = this.settings.riderPowerWatts;
  readonly paceMode = this.settings.paceMode;
  readonly displaySpeed = this.settings.displaySpeed;
  readonly speedUnit = this.settings.speedUnit;

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
}
