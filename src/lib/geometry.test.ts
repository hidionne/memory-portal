import { describe, expect, it } from 'vitest';
import { rectFromCorners } from './geometry';
import { framePhoto } from './photoFraming';
import { pinchRatio, thresholdsForSensitivity } from './pinch';

describe('rectFromCorners', () => {
  it('builds the same rect regardless of which fingertip is where', () => {
    const thumb = { x: 300, y: 900 };
    const index = { x: 700, y: 400 };
    const expected = { x: 300, y: 400, w: 400, h: 500 };
    expect(rectFromCorners(thumb, index)).toEqual(expected);
    expect(rectFromCorners(index, thumb)).toEqual(expected);
  });

  it('never produces negative sizes when fingertips cross', () => {
    // Thumb moves from left of index to right of it.
    for (let tx = 100; tx <= 900; tx += 50) {
      const r = rectFromCorners({ x: tx, y: 800 }, { x: 500, y: 300 });
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBe(500);
      expect(r.x).toBe(Math.min(tx, 500));
    }
  });

  it('collapses one dimension continuously for a horizontal finger arrangement', () => {
    const r = rectFromCorners({ x: 200, y: 500 }, { x: 600, y: 503 });
    expect(r).toEqual({ x: 200, y: 500, w: 400, h: 3 });
  });

  it('does not invent a minimum size when fingertips touch', () => {
    const r = rectFromCorners({ x: 400, y: 400 }, { x: 400, y: 400 });
    expect(r.w).toBe(0);
    expect(r.h).toBe(0);
  });
});

describe('pinchRatio', () => {
  // A synthetic hand: wrist at origin, middle knuckle 100px up, knuckles 70px apart.
  function hand(thumb: { x: number; y: number }, index: { x: number; y: number }, scale = 1) {
    const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    pts[0] = { x: 0, y: 0 };
    pts[9] = { x: 0, y: -100 };
    pts[5] = { x: -35, y: -95 };
    pts[17] = { x: 35, y: -85 };
    pts[4] = thumb;
    pts[8] = index;
    return pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  }

  it('is invariant to how far the hand is from the camera', () => {
    const near = pinchRatio(hand({ x: -60, y: -80 }, { x: -20, y: -170 }, 2));
    const far = pinchRatio(hand({ x: -60, y: -80 }, { x: -20, y: -170 }, 0.5));
    expect(near).toBeCloseTo(far);
  });

  it('is small when fingertips touch and large when spread', () => {
    expect(pinchRatio(hand({ x: -40, y: -150 }, { x: -38, y: -152 }))).toBeLessThan(0.1);
    expect(pinchRatio(hand({ x: -80, y: -60 }, { x: -20, y: -190 }))).toBeGreaterThan(1);
  });
});

describe('thresholdsForSensitivity', () => {
  it('always keeps a hysteresis band (close < open)', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const t = thresholdsForSensitivity(s);
      expect(t.close).toBeLessThan(t.open);
    }
  });

  it('opens more easily at higher sensitivity', () => {
    expect(thresholdsForSensitivity(1).open).toBeLessThan(thresholdsForSensitivity(0).open);
  });
});

describe('framePhoto', () => {
  const frame = { x: 0, y: 0, w: 1080, h: 1920 };

  it('covers the frame without stretching', () => {
    const r = framePhoto(4000, 3000, frame, 'cover', { zoom: 1, panX: 0, panY: 0 });
    expect(r.w / r.h).toBeCloseTo(4000 / 3000);
    expect(r.h).toBeCloseTo(1920);
    expect(r.x).toBeLessThanOrEqual(0);
    expect(r.x + r.w).toBeGreaterThanOrEqual(1080);
  });

  it('contains the whole photo without stretching', () => {
    const r = framePhoto(4000, 3000, frame, 'contain', { zoom: 1, panX: 0, panY: 0 });
    expect(r.w).toBeCloseTo(1080);
    expect(r.w / r.h).toBeCloseTo(4000 / 3000);
  });

  it('never reveals empty space when panning a covering image to the limit', () => {
    for (const panX of [-1, 1]) {
      for (const panY of [-1, 1]) {
        const r = framePhoto(3000, 4000, frame, 'cover', { zoom: 1.6, panX, panY });
        expect(r.x).toBeLessThanOrEqual(1e-9);
        expect(r.y).toBeLessThanOrEqual(1e-9);
        expect(r.x + r.w).toBeGreaterThanOrEqual(1080 - 1e-9);
        expect(r.y + r.h).toBeGreaterThanOrEqual(1920 - 1e-9);
      }
    }
  });
});
