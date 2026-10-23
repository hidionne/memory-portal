import { describe, expect, it } from 'vitest';
import type { DetectedHand } from './handSelection';
import { bilinear, isTwisted, pointInQuad, quadBounds, quadFromHands, quadOpenness, quadSpans } from './quad';
import { TwoHandAssigner } from './twoHands';

const L = { index: { x: 300, y: 200 }, thumb: { x: 320, y: 600 } };
const R = { index: { x: 900, y: 210 }, thumb: { x: 880, y: 590 } };

describe('quadFromHands', () => {
  it('uses index fingers as top corners and thumbs as bottom corners', () => {
    const q = quadFromHands(L, R);
    expect(q).toEqual({ tl: L.index, tr: R.index, br: R.thumb, bl: L.thumb });
    expect(isTwisted(q)).toBe(false);
  });

  it('twists into an X when one hand flips (thumb above index)', () => {
    const flippedRight = { index: R.thumb, thumb: R.index };
    const q = quadFromHands(L, flippedRight);
    expect(isTwisted(q)).toBe(true);
    // Both lobes of the X are inside; the crossing point region near the middle edges is too.
    expect(pointInQuad({ x: 400, y: 400 }, q)).toBe(true);
    expect(pointInQuad({ x: 800, y: 400 }, q)).toBe(true);
    // Above and below the crossing (outside both triangles) is outside.
    expect(pointInQuad({ x: 600, y: 250 }, q)).toBe(false);
    expect(pointInQuad({ x: 600, y: 560 }, q)).toBe(false);
  });

  it('flipping both hands mirrors the quad vertically but does not twist it', () => {
    const q = quadFromHands({ index: L.thumb, thumb: L.index }, { index: R.thumb, thumb: R.index });
    expect(isTwisted(q)).toBe(false);
  });

  it('bilinear interpolation hits the corners exactly', () => {
    const q = quadFromHands(L, R);
    expect(bilinear(q, 0, 0)).toEqual(q.tl);
    expect(bilinear(q, 1, 0)).toEqual(q.tr);
    expect(bilinear(q, 1, 1)).toEqual(q.br);
    expect(bilinear(q, 0, 1)).toEqual(q.bl);
  });

  it('bounds cover all four corners', () => {
    expect(quadBounds(quadFromHands(L, R))).toEqual({ x: 300, y: 200, w: 600, h: 400 });
  });
});

describe('quadOpenness', () => {
  const palm = 100;
  it('is large for an open frame', () => {
    expect(quadOpenness(quadFromHands(L, R), palm)).toBeGreaterThan(3);
  });

  it('collapses when each hand pinches closed', () => {
    const q = quadFromHands({ index: { x: 300, y: 400 }, thumb: { x: 305, y: 410 } }, { index: { x: 900, y: 400 }, thumb: { x: 902, y: 412 } });
    expect(quadOpenness(q, palm)).toBeLessThan(0.15);
  });

  it('collapses when both hands come together', () => {
    const q = quadFromHands({ index: { x: 600, y: 200 }, thumb: { x: 600, y: 600 } }, { index: { x: 610, y: 200 }, thumb: { x: 612, y: 600 } });
    expect(quadSpans(q).height).toBeGreaterThan(300);
    expect(quadOpenness(q, palm)).toBeLessThan(0.15);
  });
});

function hand(cx: number, label: string): DetectedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: cx, y: 0.5 }));
  return { landmarks, handedness: label, score: 0.95 };
}

describe('TwoHandAssigner', () => {
  it('gives a fresh pair to the side of the screen each hand is on (mirrored preview)', () => {
    const a = new TwoHandAssigner();
    // Mirrored preview: camera x 0.8 shows on the screen's left.
    const s = a.assign([hand(0.2, 'Left'), hand(0.8, 'Right')], true, 0);
    expect(s.left?.landmarks[0].x).toBe(0.8);
    expect(s.right?.landmarks[0].x).toBe(0.2);
  });

  it('uses unmirrored screen positions when the preview is not mirrored', () => {
    const a = new TwoHandAssigner();
    const s = a.assign([hand(0.2, 'Left'), hand(0.8, 'Left')], false, 0);
    expect(s.left?.landmarks[0].x).toBe(0.2);
    expect(s.right?.landmarks[0].x).toBe(0.8);
  });

  it('keeps sides by continuity when hands cross, so the corners follow the fingers', () => {
    const a = new TwoHandAssigner();
    a.assign([hand(0.3, 'Left'), hand(0.7, 'Right')], true, 0);
    let s = a.assign([hand(0.3, 'Left'), hand(0.7, 'Right')], true, 33);
    const leftLabel = s.left!.handedness;
    // Hands move towards each other and cross over, a little each frame.
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      s = a.assign([hand(0.3 + 0.4 * t, 'Left'), hand(0.7 - 0.4 * t, 'Right')], true, 33 + i * 33);
    }
    expect(s.left!.handedness).toBe(leftLabel);
  });

  it('reports a single hand on its own side and leaves the other empty', () => {
    const a = new TwoHandAssigner();
    const s = a.assign([hand(0.3, 'Left')], true, 0); // camera 0.3 → screen 0.7
    expect(s.right).not.toBeNull();
    expect(s.left).toBeNull();
  });

  it('re-decides a guessed single hand when the second hand arrives', () => {
    const a = new TwoHandAssigner();
    // A lone hand just right of centre is guessed to be the right hand…
    a.assign([hand(0.45, 'Left')], true, 0);
    // …then the real right hand appears further right, and the first hand turns out to be the left one.
    const s = a.assign([hand(0.5, 'Left'), hand(0.2, 'Right')], true, 33);
    expect(s.left?.landmarks[0].x).toBe(0.5);
    expect(s.right?.landmarks[0].x).toBe(0.2);
  });
});

describe('affineFromTriangles (photo warp)', () => {
  it('maps each source corner exactly onto its destination corner', async () => {
    const { affineFromTriangles } = await import('../engine/compositor');
    const s = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }];
    const d = [{ x: 10, y: 20 }, { x: 210, y: 60 }, { x: -30, y: 120 }];
    const m = affineFromTriangles(s[0], s[1], s[2], d[0], d[1], d[2])!;
    for (let i = 0; i < 3; i++) {
      const x = m[0] * s[i].x + m[2] * s[i].y + m[4];
      const y = m[1] * s[i].x + m[3] * s[i].y + m[5];
      expect(x).toBeCloseTo(d[i].x);
      expect(y).toBeCloseTo(d[i].y);
    }
  });

  it('returns null for a degenerate source triangle', async () => {
    const { affineFromTriangles } = await import('../engine/compositor');
    const p = { x: 0, y: 0 };
    expect(affineFromTriangles(p, p, { x: 1, y: 1 }, p, p, p)).toBeNull();
  });
});
