import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ToastService]
    });
    service = TestBed.inject(ToastService);
    service.clear();
  });

  afterEach(() => {
    service.clear();
  });

  it('should be created with empty toasts', () => {
    expect(service).toBeTruthy();
    expect(service.activeToasts().length).toBe(0);
    expect(service.currentToast()).toBeNull();
  });

  it('should add toast and update currentToast', () => {
    const id = service.show('Test notification', 'info');
    expect(id).toBeTruthy();
    expect(service.activeToasts().length).toBe(1);
    expect(service.currentToast()?.message).toBe('Test notification');
    expect(service.currentToast()?.type).toBe('info');
  });

  it('should support warning, error, and success helpers', () => {
    service.showWarning('Warning message');
    expect(service.currentToast()?.type).toBe('warning');

    service.showError('Error message');
    expect(service.currentToast()?.type).toBe('error');

    service.showSuccess('Success message');
    expect(service.currentToast()?.type).toBe('success');
  });

  it('should dismiss toast by ID', () => {
    const id1 = service.show('Msg 1', 'info', 0);
    const id2 = service.show('Msg 2', 'warning', 0);
    expect(service.activeToasts().length).toBe(2);

    service.dismiss(id1);
    expect(service.activeToasts().length).toBe(1);
    expect(service.activeToasts()[0].id).toBe(id2);
  });

  it('should dismiss latest toast if no ID provided', () => {
    service.show('Msg 1', 'info', 0);
    service.show('Msg 2', 'warning', 0);

    service.dismiss();
    expect(service.activeToasts().length).toBe(1);
    expect(service.activeToasts()[0].message).toBe('Msg 1');
  });

  it('should auto-dismiss toast after duration', () => {
    vi.useFakeTimers();
    try {
      service.show('Auto dismiss', 'info', 1000);
      expect(service.activeToasts().length).toBe(1);

      vi.advanceTimersByTime(500);
      expect(service.activeToasts().length).toBe(1);

      vi.advanceTimersByTime(600);
      expect(service.activeToasts().length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should clear all toasts', () => {
    service.show('Msg 1', 'info', 0);
    service.show('Msg 2', 'info', 0);
    expect(service.activeToasts().length).toBe(2);

    service.clear();
    expect(service.activeToasts().length).toBe(0);
    expect(service.currentToast()).toBeNull();
  });
});
