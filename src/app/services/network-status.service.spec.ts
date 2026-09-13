import { TestBed } from '@angular/core/testing';
import { NetworkStatusService } from './network-status.service';

describe('NetworkStatusService', () => {
  let service: NetworkStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [NetworkStatusService]
    });
    service = TestBed.inject(NetworkStatusService);
  });

  afterEach(() => {
    service.setOnline(true);
  });

  it('should be created and expose reactive isOnline and isOffline signals', () => {
    expect(service).toBeTruthy();
    expect(typeof service.isOnline()).toBe('boolean');
    expect(service.isOffline()).toBe(!service.isOnline());
  });

  it('should toggle online/offline via setOnline()', () => {
    service.setOnline(false);
    expect(service.isOnline()).toBe(false);
    expect(service.isOffline()).toBe(true);

    service.setOnline(true);
    expect(service.isOnline()).toBe(true);
    expect(service.isOffline()).toBe(false);
  });

  it('should respond to window online and offline events', () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('offline'));
      expect(service.isOnline()).toBe(false);

      window.dispatchEvent(new Event('online'));
      expect(service.isOnline()).toBe(true);
    }
  });
});
