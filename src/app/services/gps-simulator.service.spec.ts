import { TestBed } from '@angular/core/testing';
import { GpsSimulatorService } from './gps-simulator.service';
import { DeadReckoningService } from './dead-reckoning.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('GpsSimulatorService', () => {
  let service: GpsSimulatorService;

  // Mock route: Banff to southern Alberta coordinates
  // Segment 1: Eastward from Banff (51.0, -115.0) to (51.0, -114.0) [heading ~90°]
  // Segment 2: Southward to (50.0, -114.0) [heading ~180°]
  // Segment 3: Westward to (50.0, -115.0) [heading ~270°]
  const MOCK_TRACK: [number, number, number, number, number][] = [
    [51.0, -115.0, 1400, 0.0, 0.0],
    [51.0, -114.0, 1400, 70.0, 43.5],
    [50.0, -114.0, 1400, 180.0, 111.8],
    [50.0, -115.0, 1400, 250.0, 155.3]
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GpsSimulatorService]
    });
    service = TestBed.inject(GpsSimulatorService);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Initialization & Default State', () => {
    it('should initialize with stopped state and default values', () => {
      expect(service).toBeTruthy();
      expect(service.running()).toBe(false);
      expect(service.speedKph()).toBe(15);
      expect(service.simulatedMile()).toBe(0);
      expect(service.simulatedCoords()).toBeNull();
      expect(service.simulatedHeading()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.state().running).toBe(false);
    });
  });

  describe('Simulation Controls: start()', () => {
    it('should start simulation with given speed and trackpoints', () => {
      service.start(25, MOCK_TRACK);

      expect(service.running()).toBe(true);
      expect(service.speedKph()).toBe(25);
      expect(service.simulatedSpeedKph()).toBe(25);
      expect(service.simulatedCoords()).toEqual([51.0, -115.0]);
      expect(service.simulatedHeading()).toBeCloseTo(90, 0);
    });

    it('should handle start with empty trackpoints gracefully', () => {
      service.start(20, []);
      expect(service.running()).toBe(false);
      expect(service.simulatedCoords()).toBeNull();
    });

    it('should restart from mile 0 if already at or past end of route', () => {
      service.setTrackPoints(MOCK_TRACK);
      service.seek(155.3);
      expect(service.simulatedMile()).toBe(155.3);

      service.start(20);
      expect(service.running()).toBe(true);
      expect(service.simulatedMile()).toBe(0);
    });

    it('should clean up existing timer when start() is called repeatedly', () => {
      vi.useFakeTimers();
      service.start(20, MOCK_TRACK, 1000);
      const firstMile = service.simulatedMile();

      // Call start again with different speed
      service.start(40, MOCK_TRACK, 1000);
      vi.advanceTimersByTime(1000);

      // Distance should advance at 40 km/h, not doubled from dual timers
      const expectedDelta = (40 * 1.0) / (3600 * 1.609344);
      expect(service.simulatedMile()).toBeCloseTo(firstMile + expectedDelta, 5);
      vi.useRealTimers();
    });

    it('should allow starting simulation at 0 km/h and keep speed at 0 without falling back to default', () => {
      service.start(0, MOCK_TRACK);

      expect(service.running()).toBe(true);
      expect(service.speedKph()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.simulatedCoords()).toEqual([51.0, -115.0]);
      expect(service.simulatedMile()).toBe(0);

      // Verify that ticking at speed 0 does not advance position
      service.tick(5.0);
      expect(service.simulatedMile()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.running()).toBe(true);
    });

    it('should override previously configured speed to 0 km/h when start(0) is called', () => {
      service.setSpeed(30);
      expect(service.speedKph()).toBe(30);

      service.start(0, MOCK_TRACK);
      expect(service.running()).toBe(true);
      expect(service.speedKph()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
    });

    it('should halt distance progression during interval timer ticks when started at 0 km/h', () => {
      vi.useFakeTimers();
      service.start(0, MOCK_TRACK, 1000);
      expect(service.simulatedMile()).toBe(0);

      vi.advanceTimersByTime(3000);
      expect(service.simulatedMile()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.running()).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('Simulation Controls: stop()', () => {
    it('should stop active simulation and set simulatedSpeedKph to 0 while retaining speedKph', () => {
      service.start(30, MOCK_TRACK);
      expect(service.running()).toBe(true);
      expect(service.simulatedSpeedKph()).toBe(30);

      service.stop();
      expect(service.running()).toBe(false);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.speedKph()).toBe(30);
    });

    it('should cease location updates after stop() is called', () => {
      vi.useFakeTimers();
      service.start(30, MOCK_TRACK, 1000);
      vi.advanceTimersByTime(1000);
      const mileAfter1Sec = service.simulatedMile();

      service.stop();
      vi.advanceTimersByTime(2000);
      expect(service.simulatedMile()).toBe(mileAfter1Sec);
      vi.useRealTimers();
    });
  });

  describe('Speed Controls: setSpeed()', () => {
    it('should update speedKph and simulatedSpeedKph while running', () => {
      service.start(20, MOCK_TRACK);
      service.setSpeed(35);

      expect(service.speedKph()).toBe(35);
      expect(service.simulatedSpeedKph()).toBe(35);
    });

    it('should update speedKph without changing simulatedSpeedKph while stopped', () => {
      service.setSpeed(45);

      expect(service.speedKph()).toBe(45);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.running()).toBe(false);
    });

    it('should allow negative speed inputs and update speedKph', () => {
      service.setSpeed(-15);
      expect(service.speedKph()).toBe(-15);

      service.setSpeed(-200);
      expect(service.speedKph()).toBe(-200);
    });
  });

  describe('Position Seeking: seek()', () => {
    it('should seek to specific mile and interpolate coordinates and heading', () => {
      service.setTrackPoints(MOCK_TRACK);
      // Mile 21.75 is exactly halfway along segment 1 (0 to 43.5 mi, lon -115 to -114)
      service.seek(21.75);

      expect(service.simulatedMile()).toBe(21.75);
      expect(service.simulatedCoords()![0]).toBeCloseTo(51.0, 5);
      expect(service.simulatedCoords()![1]).toBeCloseTo(-114.5, 5);
      expect(service.simulatedHeading()).toBeCloseTo(90, 0);
    });

    it('should seek across segments and compute correct heading on segment 2', () => {
      service.setTrackPoints(MOCK_TRACK);
      // Mile 77.65 is halfway along segment 2 (43.5 to 111.8 mi, lat 51.0 to 50.0)
      service.seek(77.65);

      expect(service.simulatedMile()).toBe(77.65);
      expect(service.simulatedCoords()![0]).toBeCloseTo(50.5, 5);
      expect(service.simulatedCoords()![1]).toBeCloseTo(-114.0, 5);
      expect(service.simulatedHeading()).toBeCloseTo(180, 0); // Southward
    });

    it('should clamp seek values below 0 to start of route', () => {
      service.setTrackPoints(MOCK_TRACK);
      service.seek(-10);

      expect(service.simulatedMile()).toBe(0);
      expect(service.simulatedCoords()).toEqual([51.0, -115.0]);
    });

    it('should clamp seek values exceeding total distance and stop simulation', () => {
      service.start(20, MOCK_TRACK);
      service.seek(300);

      expect(service.simulatedMile()).toBe(155.3);
      expect(service.simulatedCoords()).toEqual([50.0, -115.0]);
      expect(service.running()).toBe(false);
      expect(service.simulatedSpeedKph()).toBe(0);
    });

    it('should retain seeked mile when called before trackpoints are set, and interpolate when trackpoints are added', () => {
      // Simulate page load where saved location (e.g. 21.75) is seeked before trackpoints load
      service.seek(21.75);
      expect(service.simulatedMile()).toBe(21.75);
      expect(service.simulatedCoords()).toBeNull();

      // Now trackpoints arrive
      service.setTrackPoints(MOCK_TRACK);
      expect(service.simulatedMile()).toBe(21.75);
      expect(service.simulatedCoords()![0]).toBeCloseTo(51.0, 5);
      expect(service.simulatedCoords()![1]).toBeCloseTo(-114.5, 5);
      expect(service.simulatedHeading()).toBeCloseTo(90, 0);
    });

    it('should start simulation from previously seeked mile instead of starting at 0', () => {
      service.setTrackPoints(MOCK_TRACK);
      service.seek(77.65); // Seek to mile 77.65
      expect(service.simulatedMile()).toBe(77.65);

      // Start simulation
      service.start(25);
      expect(service.running()).toBe(true);
      expect(service.simulatedMile()).toBe(77.65);
      expect(service.simulatedCoords()![0]).toBeCloseTo(50.5, 5);
    });
  });

  describe('Simulation Stepping: tick()', () => {
    it('should advance simulatedMile accurately based on speed and deltaSeconds', () => {
      service.start(36, MOCK_TRACK); // 36 km/h = 10 m/s
      // In 1 second: 36 / (3600 * 1.609344) = 0.0062137 mi
      service.tick(1.0);

      expect(service.simulatedMile()).toBeCloseTo(0.0062137, 5);
    });

    it('should automatically stop upon reaching or exceeding end of route', () => {
      service.start(36, MOCK_TRACK);
      // Seek near end of route (155.3 mi)
      service.seek(155.29);
      expect(service.running()).toBe(true);

      // Tick 5 seconds: advances ~0.031 miles, passing 155.3
      service.tick(5.0);

      expect(service.running()).toBe(false);
      expect(service.simulatedMile()).toBe(155.3);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.simulatedCoords()).toEqual([50.0, -115.0]);
    });

    it('should no-op on tick() when simulation is stopped', () => {
      service.setTrackPoints(MOCK_TRACK);
      service.tick(5.0);
      expect(service.simulatedMile()).toBe(0);
    });

    it('should step backwards when speed is negative', () => {
      service.start(36, MOCK_TRACK);
      service.seek(10.0);
      service.setSpeed(-36); // -36 km/h = -0.0062137 mi/s

      service.tick(1.0);
      expect(service.simulatedMile()).toBeCloseTo(10.0 - 0.0062137, 5);
      // Heading should face backwards (opposite of ~90 deg East -> ~270 deg West)
      expect(service.simulatedHeading()).toBeCloseTo(270, 0);
    });

    it('should stop automatically at position 0 when driving backwards', () => {
      service.start(36, MOCK_TRACK);
      service.seek(0.01);
      service.setSpeed(-36); // in 5 seconds advances -0.031 mi

      service.tick(5.0);

      expect(service.running()).toBe(false);
      expect(service.simulatedMile()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.simulatedCoords()).toEqual([51.0, -115.0]);
    });
  });

  describe('Heading Calculation Accuracy', () => {
    it('should calculate accurate east heading (~90 deg) on segment 1', () => {
      service.start(15, MOCK_TRACK);
      service.seek(10);
      expect(service.simulatedHeading()).toBeCloseTo(90, 0);
    });

    it('should calculate accurate south heading (180 deg) on segment 2', () => {
      service.start(15, MOCK_TRACK);
      service.seek(60);
      expect(service.simulatedHeading()).toBeCloseTo(180, 0);
    });

    it('should calculate accurate west heading (~270 deg) on segment 3', () => {
      service.start(15, MOCK_TRACK);
      service.seek(130);
      expect(service.simulatedHeading()).toBeCloseTo(270, 0);
    });
  });

  describe('Reset and Lifecycle Cleanup', () => {
    it('should reset state to mile 0 and stop simulation on reset()', () => {
      service.start(25, MOCK_TRACK);
      service.seek(50);
      service.reset();

      expect(service.running()).toBe(false);
      expect(service.simulatedMile()).toBe(0);
      expect(service.simulatedSpeedKph()).toBe(0);
      expect(service.simulatedCoords()).toEqual([51.0, -115.0]);
    });

    it('should stop timer on ngOnDestroy()', () => {
      service.start(25, MOCK_TRACK);
      expect(service.running()).toBe(true);

      service.ngOnDestroy();
      expect(service.running()).toBe(false);
    });
  });

  describe('DeadReckoningService Synchronization', () => {
    let deadReckoning: any;

    beforeEach(() => {
      deadReckoning = {
        reset: vi.fn(),
        updateGpsFix: vi.fn(),
        stop: vi.fn()
      };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          GpsSimulatorService,
          { provide: DeadReckoningService, useValue: deadReckoning }
        ]
      });
      service = TestBed.inject(GpsSimulatorService);
      service.setTrackPoints(MOCK_TRACK);
    });

    it('should reset deadReckoning to seeked mile and coordinates when seek() is called while stopped', () => {
      service.seek(43.5);
      expect(deadReckoning.reset).toHaveBeenCalledWith(43.5, [51.0, -114.0], expect.any(Number));
    });

    it('should reset deadReckoning before starting and pass correct startMile to updateGpsFix', () => {
      service.seek(43.5);
      service.start(25);
      expect(deadReckoning.reset).toHaveBeenCalledWith(43.5, [51.0, -114.0], expect.any(Number));
      expect(deadReckoning.updateGpsFix).toHaveBeenCalledWith(
        expect.objectContaining({ projectedMile: 43.5 }),
        25
      );
    });

    it('should reset deadReckoning to final simulatedMile on stop()', () => {
      service.start(25);
      service.seek(10.0);
      service.stop();
      expect(deadReckoning.reset).toHaveBeenCalledWith(10.0, expect.any(Array), expect.any(Number));
    });
  });
});
