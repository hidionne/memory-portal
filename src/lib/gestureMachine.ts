import { clamp } from './geometry';
import type { PinchThresholds } from './pinch';
import type { Quad } from './quad';

/**
 * Three small explicit state machines driven together:
 *
 *  Tracking   searching ─hand→ tracked ─no hand→ holding ─150ms→ fading ─200ms→ searching
 *                                 ↑______________hand_____________|_______|
 *
 *  Pinch      closed ─openness ≥ open→ open ─openness ≤ close→ closed  (hysteresis; only
 *                                                                     changes while tracked)
 *
 *  Cycle      awaitingFirstOpen ─open→ open ─closed→ closing ─held 350ms→ armed ─open→ open
 *                                         ↑______open_____|                    (emits 'advance')
 *             Losing the hand while `closing` cancels back to `open`, so tracking loss can
 *             never complete a deliberate closure. A closure that was already completed
 *             (`armed`) survives a tracking loss.
 *
 * "Tracked" means both hands are visible (all four corners known). The mouse
 * demo feeds the same machine with openness 1 (open) or 0 (closed).
 */
export type TrackingState = 'searching' | 'tracked' | 'holding' | 'fading';
export type PinchState = 'closed' | 'open';
export type CycleState = 'awaitingFirstOpen' | 'open' | 'closing' | 'armed';

export interface GestureConfig {
  thresholds: PinchThresholds;
  /** Keep the last portal fully visible this long after the hand disappears. */
  lossHoldMs: number;
  /** Then fade it out over this long. */
  lossFadeMs: number;
  /** A closure must be held this long to arm the next photograph. */
  closureHoldMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  newMemoryOnReopen: boolean;
  /**
   * Fade the portal out when the gesture closes. Off for hands: the photo
   * stays visible at whatever size the fingers make, however small; the
   * open/closed state then only drives "new memory on reopen".
   */
  hideWhenClosed: boolean;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  thresholds: { open: 0.42, close: 0.25 },
  lossHoldMs: 150,
  lossFadeMs: 200,
  closureHoldMs: 350,
  fadeInMs: 110,
  fadeOutMs: 150,
  newMemoryOnReopen: false,
  hideWhenClosed: true,
};

export interface GestureSample {
  /** Narrower portal span / palm size (see quadOpenness). */
  openness: number;
  /** Portal corners in output pixels. */
  quad: Quad;
}

export type GestureEvent =
  | { type: 'opened' }
  | { type: 'closed' }
  | { type: 'armed' }
  | { type: 'advance' }
  | { type: 'lost' }
  | { type: 'reacquired'; fresh: boolean }
  | { type: 'released' };

export class GestureMachine {
  tracking: TrackingState = 'searching';
  pinch: PinchState = 'closed';
  cycle: CycleState = 'awaitingFirstOpen';
  /** Last stable portal corners (held during tracking loss). */
  quad: Quad | null = null;
  openness = 0;
  /** Portal opacity 0..1, advanced by tick(). */
  alpha = 0;

  private lostAt = 0;
  private alphaAtFadeStart = 0;
  private closingSince = 0;
  private lastTick: number | null = null;

  constructor(public config: GestureConfig = { ...DEFAULT_GESTURE_CONFIG }) {}

  setConfig(partial: Partial<GestureConfig>) {
    const toggledMemory =
      partial.newMemoryOnReopen !== undefined && partial.newMemoryOnReopen !== this.config.newMemoryOnReopen;
    this.config = { ...this.config, ...partial };
    if (toggledMemory) this.resetCycle();
  }

  /** Full reset: camera restarted, input mode changed, etc. */
  reset() {
    this.tracking = 'searching';
    this.pinch = 'closed';
    this.cycle = 'awaitingFirstOpen';
    this.quad = null;
    this.openness = 0;
    this.alpha = 0;
    this.lastTick = null;
  }

  /** Forget any half-finished close/reopen cycle; the next opening will not advance. */
  resetCycle() {
    this.cycle = 'awaitingFirstOpen';
  }

  get isOpen() {
    return this.pinch === 'open';
  }

  /**
   * Feed one tracking result. `sample` is null when the active hand was not
   * found in this camera frame.
   */
  update(sample: GestureSample | null, now: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    this.advanceTracking(now, events);

    if (!sample) {
      if (this.tracking === 'tracked') {
        this.tracking = 'holding';
        this.lostAt = now;
        this.alphaAtFadeStart = this.alpha;
        // Tracking loss is never a deliberate closure.
        if (this.cycle === 'closing') this.cycle = 'open';
        events.push({ type: 'lost' });
      }
      return events;
    }

    const { open, close } = this.config.thresholds;
    if (this.tracking !== 'tracked') {
      const fresh = this.tracking === 'searching';
      // No hysteresis history after a full loss: start closed, so only a clear
      // spread (openness ≥ open) opens the portal below.
      if (fresh) this.pinch = 'closed';
      this.tracking = 'tracked';
      events.push({ type: 'reacquired', fresh });
    }

    this.quad = { ...sample.quad };
    this.openness = sample.openness;

    const before = this.pinch;
    if (this.pinch === 'closed' && sample.openness >= open) this.pinch = 'open';
    else if (this.pinch === 'open' && sample.openness <= close) this.pinch = 'closed';
    if (before !== this.pinch) events.push({ type: this.pinch === 'open' ? 'opened' : 'closed' });

    this.stepCycle(now, events);
    return events;
  }

  private stepCycle(now: number, events: GestureEvent[]) {
    switch (this.cycle) {
      case 'awaitingFirstOpen':
        if (this.pinch === 'open') this.cycle = 'open';
        break;
      case 'open':
        if (this.pinch === 'closed') {
          this.cycle = 'closing';
          this.closingSince = now;
        }
        break;
      case 'closing':
        if (this.pinch === 'open') {
          this.cycle = 'open'; // reopened too quickly: not a deliberate closure
        } else if (now - this.closingSince >= this.config.closureHoldMs) {
          this.cycle = 'armed';
          events.push({ type: 'armed' });
        }
        break;
      case 'armed':
        if (this.pinch === 'open') {
          this.cycle = 'open';
          if (this.config.newMemoryOnReopen) events.push({ type: 'advance' });
        }
        break;
    }
  }

  private advanceTracking(now: number, events: GestureEvent[]) {
    const { lossHoldMs, lossFadeMs } = this.config;
    if (this.tracking === 'holding' && now - this.lostAt >= lossHoldMs) {
      this.tracking = 'fading';
      this.alphaAtFadeStart = this.alpha;
    }
    if (this.tracking === 'fading' && now - this.lostAt >= lossHoldMs + lossFadeMs) {
      this.tracking = 'searching';
      this.alpha = 0;
      events.push({ type: 'released' });
    }
  }

  /** Advance time-based transitions and the opacity animation. Call every render frame. */
  tick(now: number): GestureEvent[] {
    const events: GestureEvent[] = [];
    this.advanceTracking(now, events);
    const dt = this.lastTick === null ? 0 : clamp(now - this.lastTick, 0, 100);
    this.lastTick = now;

    const { fadeInMs, fadeOutMs, lossHoldMs, lossFadeMs } = this.config;
    switch (this.tracking) {
      case 'tracked':
        this.alpha =
          this.pinch === 'open' || !this.config.hideWhenClosed
            ? Math.min(1, this.alpha + dt / fadeInMs)
            : Math.max(0, this.alpha - dt / fadeOutMs);
        break;
      case 'holding':
        break;
      case 'fading': {
        const t = clamp((now - this.lostAt - lossHoldMs) / lossFadeMs, 0, 1);
        this.alpha = this.alphaAtFadeStart * (1 - t);
        break;
      }
      case 'searching':
        this.alpha = 0;
        break;
    }
    return events;
  }
}

/** Index after `current`, wrapping after the final photograph. */
export function nextIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  return (current + 1) % count;
}

export function prevIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  return (current - 1 + count) % count;
}
