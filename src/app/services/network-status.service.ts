import { Injectable, signal, computed, OnDestroy, Signal } from '@angular/core';

export interface INetworkStatusService {
  readonly isOnline: Signal<boolean>;
  setOnline(online: boolean): void;
}

@Injectable({
  providedIn: 'root'
})
export class NetworkStatusService implements INetworkStatusService, OnDestroy {
  private readonly _isOnline = signal<boolean>(
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true
  );

  readonly isOnline = this._isOnline.asReadonly();
  readonly isOffline = computed(() => !this._isOnline());

  private readonly handleOnline = (): void => {
    this._isOnline.set(true);
  };

  private readonly handleOffline = (): void => {
    this._isOnline.set(false);
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }

  setOnline(online: boolean): void {
    this._isOnline.set(online);
  }
}
