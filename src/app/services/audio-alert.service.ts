import { Injectable, OnDestroy, signal, computed } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AudioAlertService implements OnDestroy {
  static readonly OFF_COURSE_THRESHOLD_METERS = 35;
  static readonly HYSTERESIS_RESET_THRESHOLD_METERS = 25;
  static readonly DEFAULT_FREQUENCY_HZ = 880;
  static readonly DEFAULT_DURATION_SECONDS = 0.2;

  private readonly _hasAlerted = signal<boolean>(false);
  readonly isAlerted = computed(() => this._hasAlerted());

  private audioCtx: AudioContext | null = null;

  /**
   * Evaluates rider deviation against corridor thresholds.
   * - If deviation > 35m and not yet alerted: plays 880Hz chime and latches true.
   * - If deviation <= 25m: resets the latch (corridor hysteresis).
   * - In deadband (25m < deviation <= 35m): state is preserved without repeat chimes.
   *
   * @param deviationMeters Perpendicular deviation distance from route polyline in meters
   * @returns true if an alert was newly triggered on this call, false otherwise
   */
  async processDistance(deviationMeters: number): Promise<boolean> {
    if (deviationMeters > AudioAlertService.OFF_COURSE_THRESHOLD_METERS) {
      if (!this._hasAlerted()) {
        await this.playOffCourseBeep();
        return true;
      }
    } else if (deviationMeters <= AudioAlertService.HYSTERESIS_RESET_THRESHOLD_METERS) {
      this.resetOffCourseLatch();
    }
    return false;
  }

  /**
   * Plays a single 880 Hz off-course alert tone, gated by the alert latch.
   * If already alerted, no sound is generated (prevents continuous alarms).
   */
  async playOffCourseBeep(): Promise<void> {
    if (this._hasAlerted()) {
      return;
    }
    this._hasAlerted.set(true);
    await this.generateTone(AudioAlertService.DEFAULT_FREQUENCY_HZ, AudioAlertService.DEFAULT_DURATION_SECONDS);
  }

  /**
   * Resets off-course alert latch, allowing future alerts when leaving corridor.
   */
  resetOffCourseLatch(): void {
    this._hasAlerted.set(false);
  }

  /**
   * Returns whether an off-course alert is currently latched.
   */
  hasAlerted(): boolean {
    return this._hasAlerted();
  }

  /**
   * Web Audio API tone generator with exponential envelope to prevent clicks.
   * Gracefully handles suspended AudioContext, user gesture constraints, and JSDOM.
   */
  async generateTone(
    frequency = AudioAlertService.DEFAULT_FREQUENCY_HZ,
    duration = AudioAlertService.DEFAULT_DURATION_SECONDS
  ): Promise<void> {
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) {
      return;
    }

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      if (ctx.state !== 'running') {
        return;
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now);

      const attack = 0.02;
      const decay = Math.max(0.02, duration - attack);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Ignore cleanup errors
        }
      };
    } catch {
      // Graceful fallback: audio hardware error or autoplay policy
    }
  }

  /**
   * Testing hook: injects a mock AudioContext or clears instance.
   */
  setAudioContextForTesting(ctx: AudioContext | null): void {
    this.audioCtx = ctx;
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) {
        return null;
      }
      try {
        this.audioCtx = new AudioCtxClass();
      } catch {
        return null;
      }
    }
    return this.audioCtx;
  }

  ngOnDestroy(): void {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close().catch(() => {});
      } catch {
        // Ignore
      }
    }
    this.audioCtx = null;
  }
}
