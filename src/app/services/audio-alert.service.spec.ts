import { TestBed } from '@angular/core/testing';
import { AudioAlertService } from './audio-alert.service';
import { vi } from 'vitest';

describe('AudioAlertService', () => {
  let service: AudioAlertService;
  let mockCtx: any;
  let mockOsc: any;
  let mockGain: any;

  function createMockAudioContext(initialState: 'running' | 'suspended' | 'closed' = 'running') {
    mockOsc = {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn()
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      onended: null as any
    };

    mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn(),
      disconnect: vi.fn()
    };

    mockCtx = {
      state: initialState,
      currentTime: 10,
      destination: {},
      createOscillator: vi.fn().mockReturnValue(mockOsc),
      createGain: vi.fn().mockReturnValue(mockGain),
      resume: vi.fn().mockImplementation(async () => {
        mockCtx.state = 'running';
      }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    return mockCtx;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AudioAlertService]
    });

    service = TestBed.inject(AudioAlertService);
    const ctx = createMockAudioContext('running');
    service.setAudioContextForTesting(ctx as unknown as AudioContext);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created with unlatched state', () => {
    expect(service).toBeTruthy();
    expect(service.hasAlerted()).toBe(false);
    expect(service.isAlerted()).toBe(false);
  });

  it('should generate 880 Hz tone and set latch on playOffCourseBeep', async () => {
    await service.playOffCourseBeep();

    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
    expect(mockOsc.type).toBe('sine');
    expect(mockOsc.frequency.setValueAtTime).toHaveBeenCalledWith(880, 10);
    expect(mockGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10);
    expect(mockGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.25, 10.02);
    expect(mockOsc.connect).toHaveBeenCalledWith(mockGain);
    expect(mockGain.connect).toHaveBeenCalledWith(mockCtx.destination);
    expect(mockOsc.start).toHaveBeenCalledWith(10);
    expect(mockOsc.stop).toHaveBeenCalledWith(10.2);

    expect(service.hasAlerted()).toBe(true);
    expect(service.isAlerted()).toBe(true);
  });

  it('should debounce tone generation: subsequent calls while latched produce no audio', async () => {
    await service.playOffCourseBeep();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);

    // Call repeatedly while still latched
    await service.playOffCourseBeep();
    await service.playOffCourseBeep();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
  });

  it('should allow new tone after resetOffCourseLatch is called', async () => {
    await service.playOffCourseBeep();
    expect(service.hasAlerted()).toBe(true);
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);

    service.resetOffCourseLatch();
    expect(service.hasAlerted()).toBe(false);

    await service.playOffCourseBeep();
    expect(service.hasAlerted()).toBe(true);
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  describe('processDistance with Corridor Hysteresis', () => {
    it('should not alert when distance is within route corridor (<= 35m)', async () => {
      const alerted10 = await service.processDistance(10);
      expect(alerted10).toBe(false);
      expect(service.hasAlerted()).toBe(false);
      expect(mockCtx.createOscillator).not.toHaveBeenCalled();

      const alerted35 = await service.processDistance(35);
      expect(alerted35).toBe(false);
      expect(service.hasAlerted()).toBe(false);
      expect(mockCtx.createOscillator).not.toHaveBeenCalled();
    });

    it('should trigger alert when distance exceeds 35m', async () => {
      const alerted36 = await service.processDistance(35.1);
      expect(alerted36).toBe(true);
      expect(service.hasAlerted()).toBe(true);
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    });

    it('should not re-alert while remaining off-course (> 35m)', async () => {
      await service.processDistance(40);
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);

      const alerted50 = await service.processDistance(50);
      expect(alerted50).toBe(false);
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    });

    it('should maintain latched state in the hysteresis deadband (25m < d <= 35m)', async () => {
      // Go off course
      await service.processDistance(45);
      expect(service.hasAlerted()).toBe(true);
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);

      // Move into deadband
      const inDeadband = await service.processDistance(30);
      expect(inDeadband).toBe(false);
      expect(service.hasAlerted()).toBe(true);
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    });

    it('should reset latch when distance re-enters corridor (<= 25m) and allow re-alerting', async () => {
      // 1. Initial off-course alert
      await service.processDistance(38);
      expect(service.hasAlerted()).toBe(true);

      // 2. Return to route: distance <= 25m
      const reEntered = await service.processDistance(24);
      expect(reEntered).toBe(false);
      expect(service.hasAlerted()).toBe(false);

      // 3. Second excursion > 35m triggers second alert
      const secondAlert = await service.processDistance(42);
      expect(secondAlert).toBe(true);
      expect(service.hasAlerted()).toBe(true);
      expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    });
  });

  describe('AudioContext Resilience & Headless Fallbacks', () => {
    it('should attempt to resume suspended AudioContext', async () => {
      const suspendedCtx = createMockAudioContext('suspended');
      service.setAudioContextForTesting(suspendedCtx as unknown as AudioContext);

      await service.playOffCourseBeep();

      expect(suspendedCtx.resume).toHaveBeenCalled();
      expect(suspendedCtx.createOscillator).toHaveBeenCalledTimes(1);
    });

    it('should handle suspended AudioContext failing to resume without throwing', async () => {
      const failingCtx = createMockAudioContext('suspended');
      failingCtx.resume = vi.fn().mockRejectedValue(new Error('Autoplay blocked'));
      service.setAudioContextForTesting(failingCtx as unknown as AudioContext);

      await expect(service.playOffCourseBeep()).resolves.not.toThrow();
      expect(service.hasAlerted()).toBe(true);
      expect(failingCtx.createOscillator).not.toHaveBeenCalled();
    });

    it('should function gracefully when AudioContext is null or unavailable', async () => {
      service.setAudioContextForTesting(null);

      // Should complete without throwing and latch state
      await expect(service.playOffCourseBeep()).resolves.not.toThrow();
      expect(service.hasAlerted()).toBe(true);

      service.resetOffCourseLatch();
      expect(service.hasAlerted()).toBe(false);
    });

    it('should close AudioContext on service destroy', () => {
      service.ngOnDestroy();
      expect(mockCtx.close).toHaveBeenCalledTimes(1);
    });

    it('should re-instantiate AudioContext when existing context is in closed state', async () => {
      // 1. Inject closed context
      const closedCtx = createMockAudioContext('closed');
      service.setAudioContextForTesting(closedCtx as unknown as AudioContext);

      // 2. Prepare replacement context and mock global constructor
      const replacementCtx = createMockAudioContext('running');
      const audioContextConstructorSpy = vi.fn().mockImplementation(function() {
        return replacementCtx;
      });
      vi.stubGlobal('AudioContext', audioContextConstructorSpy);

      try {
        await service.playOffCourseBeep();

        expect(audioContextConstructorSpy).toHaveBeenCalledTimes(1);
        expect(replacementCtx.createOscillator).toHaveBeenCalledTimes(1);
        expect(closedCtx.createOscillator).not.toHaveBeenCalled();
        expect(service.hasAlerted()).toBe(true);

        // 3. Subsequent alert while running should reuse new context without re-instantiating
        service.resetOffCourseLatch();
        await service.playOffCourseBeep();
        expect(audioContextConstructorSpy).toHaveBeenCalledTimes(1);
        expect(replacementCtx.createOscillator).toHaveBeenCalledTimes(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should handle closed AudioContext gracefully when AudioContext constructor throws', async () => {
      const closedCtx = createMockAudioContext('closed');
      service.setAudioContextForTesting(closedCtx as unknown as AudioContext);

      const throwingConstructor = vi.fn().mockImplementation(function() {
        throw new Error('Audio hardware unavailable');
      });
      vi.stubGlobal('AudioContext', throwingConstructor);

      try {
        await expect(service.playOffCourseBeep()).resolves.not.toThrow();
        expect(throwingConstructor).toHaveBeenCalledTimes(1);
        expect(service.hasAlerted()).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should re-instantiate via webkitAudioContext fallback when AudioContext is absent and state is closed', async () => {
      const closedCtx = createMockAudioContext('closed');
      service.setAudioContextForTesting(closedCtx as unknown as AudioContext);

      const replacementCtx = createMockAudioContext('running');
      const webkitConstructorSpy = vi.fn().mockImplementation(function() {
        return replacementCtx;
      });

      vi.stubGlobal('AudioContext', undefined);
      vi.stubGlobal('webkitAudioContext', webkitConstructorSpy);

      try {
        await service.playOffCourseBeep();

        expect(webkitConstructorSpy).toHaveBeenCalledTimes(1);
        expect(replacementCtx.createOscillator).toHaveBeenCalledTimes(1);
        expect(closedCtx.createOscillator).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
