import { beforeEach, describe, expect, it } from 'vitest';
import { rectToQuad } from './quad';
import { DEFAULT_GESTURE_CONFIG, GestureMachine, nextIndex, prevIndex, type GestureEvent } from './gestureMachine';

const QUAD = rectToQuad({ x: 100, y: 100, w: 300, h: 400 });
const OPEN = 0.9;
const CLOSED = 0.08;
const BETWEEN = 0.33; // inside the hysteresis band (close 0.25 … open 0.42)

/** Drives the machine at a fixed tracking rate, like the real camera loop. */
class Driver {
  t = 0;
  events: GestureEvent[] = [];
  constructor(public m: GestureMachine, public stepMs = 33) {}

  hand(ratio: number, ms = this.stepMs) {
    const end = this.t + ms;
    do {
      this.t += Math.min(this.stepMs, end - this.t) || this.stepMs;
      this.events.push(...this.m.update({ openness: ratio, quad: QUAD }, this.t));
      this.events.push(...this.m.tick(this.t));
    } while (this.t < end);
  }

  noHand(ms: number) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += this.stepMs;
      this.events.push(...this.m.update(null, this.t));
      this.events.push(...this.m.tick(this.t));
    }
  }

  count(type: GestureEvent['type']) {
    return this.events.filter((e) => e.type === type).length;
  }
}

describe('GestureMachine: open/close hysteresis', () => {
  let d: Driver;
  beforeEach(() => {
    d = new Driver(new GestureMachine({ ...DEFAULT_GESTURE_CONFIG }));
  });

  it('does not open inside the band, opens above it', () => {
    d.hand(CLOSED);
    d.hand(BETWEEN, 300);
    expect(d.m.pinch).toBe('closed');
    d.hand(OPEN);
    expect(d.m.pinch).toBe('open');
  });

  it('stays open inside the band, closes below it', () => {
    d.hand(OPEN);
    d.hand(BETWEEN, 300);
    expect(d.m.pinch).toBe('open');
    d.hand(CLOSED);
    expect(d.m.pinch).toBe('closed');
  });

  it('does not flicker when the ratio jitters around one threshold', () => {
    d.hand(OPEN);
    const t = DEFAULT_GESTURE_CONFIG.thresholds.open;
    for (let i = 0; i < 40; i++) d.hand(t + (i % 2 ? 0.03 : -0.03));
    expect(d.count('opened')).toBe(1);
    expect(d.count('closed')).toBe(0);
  });

  it('fades the portal in when opened and out when closed', () => {
    d.hand(OPEN, 200);
    expect(d.m.alpha).toBe(1);
    d.hand(CLOSED, 300);
    expect(d.m.alpha).toBe(0);
  });

  it('keeps the portal visible when closed if hideWhenClosed is off (hands)', () => {
    d.m.setConfig({ hideWhenClosed: false });
    d.hand(CLOSED, 300);
    expect(d.m.alpha).toBe(1);
    d.hand(OPEN, 200);
    d.hand(CLOSED, 300);
    expect(d.m.alpha).toBe(1);
    expect(d.m.pinch).toBe('closed');
  });

  it('still advances once per cycle with hideWhenClosed off', () => {
    d.m.setConfig({ hideWhenClosed: false, newMemoryOnReopen: true });
    d.hand(OPEN, 300);
    d.hand(CLOSED, 500);
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(1);
  });
});

describe('GestureMachine: tracking loss', () => {
  let d: Driver;
  beforeEach(() => {
    d = new Driver(new GestureMachine({ ...DEFAULT_GESTURE_CONFIG }), 10);
  });

  it('holds ~150ms, fades over ~200ms, then releases', () => {
    d.hand(OPEN, 300);
    const lostAt = d.t;
    d.noHand(10);
    expect(d.m.tracking).toBe('holding');
    d.noHand(130);
    expect(d.m.alpha).toBe(1);
    expect(d.m.quad).toEqual(QUAD);
    d.noHand(110); // ~250ms after loss: mid-fade
    expect(d.m.tracking).toBe('fading');
    expect(d.m.alpha).toBeGreaterThan(0.2);
    expect(d.m.alpha).toBeLessThan(0.8);
    d.noHand(200);
    expect(d.t - lostAt).toBeGreaterThanOrEqual(350);
    expect(d.m.tracking).toBe('searching');
    expect(d.m.alpha).toBe(0);
    expect(d.count('released')).toBe(1);
  });

  it('reacquires mid-fade without a fresh start', () => {
    d.hand(OPEN, 300);
    d.noHand(250);
    d.events = [];
    d.hand(OPEN);
    expect(d.events.filter((e) => e.type === 'reacquired')).toEqual([{ type: 'reacquired', fresh: false }]);
    expect(d.count('opened')).toBe(0);
    expect(d.m.tracking).toBe('tracked');
  });

  it('a closed hand that vanishes is not counted as a closure', () => {
    const m = new GestureMachine({ ...DEFAULT_GESTURE_CONFIG, newMemoryOnReopen: true });
    d = new Driver(m, 10);
    d.hand(OPEN, 100);
    d.noHand(2000);
    d.hand(OPEN, 100);
    expect(d.count('advance')).toBe(0);
  });
});

describe('GestureMachine: new memory on reopen', () => {
  let d: Driver;
  beforeEach(() => {
    d = new Driver(new GestureMachine({ ...DEFAULT_GESTURE_CONFIG, newMemoryOnReopen: true }));
  });

  it('first opening does not advance', () => {
    d.hand(OPEN, 500);
    expect(d.count('advance')).toBe(0);
  });

  it('advances exactly once per deliberate close/reopen cycle', () => {
    d.hand(OPEN, 300);
    d.hand(CLOSED, 500);
    expect(d.m.cycle).toBe('armed');
    d.hand(OPEN, 1000);
    expect(d.count('advance')).toBe(1);
    // Jitter in the band while open must not advance again.
    d.hand(BETWEEN, 300);
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(1);
    // A second full cycle advances once more.
    d.hand(CLOSED, 400);
    d.hand(OPEN, 200);
    expect(d.count('advance')).toBe(2);
  });

  it('a brief closure (< 350ms) does not advance', () => {
    d.hand(OPEN, 300);
    d.hand(CLOSED, 200);
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(0);
  });

  it('holding a closure longer does not advance more than once', () => {
    d.hand(OPEN, 300);
    d.hand(CLOSED, 5000);
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(1);
    expect(d.count('armed')).toBe(1);
  });

  it('tracking loss during a closure never completes it', () => {
    d.hand(OPEN, 300);
    d.hand(CLOSED, 200); // closing, not yet armed
    d.noHand(1000); // hand disappears; time passes well beyond 350ms
    d.hand(OPEN, 300);
    expect(d.count('armed')).toBe(0);
    expect(d.count('advance')).toBe(0);
  });

  it('tracking loss alone never advances, however many times it happens', () => {
    d.hand(OPEN, 300);
    for (let i = 0; i < 5; i++) {
      d.noHand(800);
      d.hand(OPEN, 200);
    }
    expect(d.count('advance')).toBe(0);
  });

  it('a completed closure survives a tracking loss and advances once on reopen', () => {
    d.hand(OPEN, 300);
    d.hand(CLOSED, 500);
    d.noHand(600);
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(1);
  });

  it('does not advance when the setting is off', () => {
    d.m.setConfig({ newMemoryOnReopen: false });
    d.hand(OPEN, 300);
    d.hand(CLOSED, 500);
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(0);
  });

  it('resetCycle makes the next opening a "first" opening', () => {
    d.hand(OPEN, 300);
    d.hand(CLOSED, 500);
    d.m.resetCycle();
    d.hand(OPEN, 300);
    expect(d.count('advance')).toBe(0);
  });
});

describe('photo index wrap-around', () => {
  it('wraps after the final photograph', () => {
    expect(nextIndex(2, 3)).toBe(0);
    expect(nextIndex(0, 3)).toBe(1);
    expect(prevIndex(0, 3)).toBe(2);
    expect(nextIndex(0, 0)).toBe(-1);
  });
});
