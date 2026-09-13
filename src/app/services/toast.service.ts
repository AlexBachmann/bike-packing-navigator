import { Injectable, signal, computed, Signal } from '@angular/core';

export type ToastType = 'info' | 'warning' | 'error' | 'success';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  durationMs: number;
  timestamp: number;
  title?: string;
}

export interface IToastService {
  readonly activeToasts: Signal<ToastMessage[]>;
  show(message: string, type?: ToastType, durationMs?: number): string;
  dismiss(id?: string): void;
  clear(): void;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService implements IToastService {
  private readonly _toasts = signal<ToastMessage[]>([]);
  readonly activeToasts = this._toasts.asReadonly();

  readonly currentToast = computed<ToastMessage | null>(() => {
    const list = this._toasts();
    return list.length > 0 ? list[list.length - 1] : null;
  });

  private nextId = 1;
  private readonly timers = new Map<string, any>();

  show(message: string, type: ToastType = 'info', durationMs = 4000, title?: string): string {
    const id = `toast-${this.nextId++}-${Date.now()}`;
    const toast: ToastMessage = {
      id,
      message,
      type,
      durationMs,
      timestamp: Date.now(),
      title
    };

    this._toasts.update((current) => [...current, toast]);

    if (durationMs > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id);
      }, durationMs);
      this.timers.set(id, timer);
    }

    return id;
  }

  showWarning(message: string, durationMs = 5000, title?: string): string {
    return this.show(message, 'warning', durationMs, title);
  }

  showError(message: string, durationMs = 6000, title?: string): string {
    return this.show(message, 'error', durationMs, title);
  }

  showSuccess(message: string, durationMs = 4000, title?: string): string {
    return this.show(message, 'success', durationMs, title);
  }

  dismiss(id?: string): void {
    if (id) {
      const timer = this.timers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(id);
      }
      this._toasts.update((current) => current.filter((t) => t.id !== id));
    } else {
      // If no ID provided, dismiss the current/latest toast
      const current = this.currentToast();
      if (current) {
        this.dismiss(current.id);
      }
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this._toasts.set([]);
  }
}
