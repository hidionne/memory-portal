import { describe, expect, it } from 'vitest';
import { HandSelector, type DetectedHand } from './handSelection';
import { OneEuroFilter, smoothingToParams } from './oneEuro';
import { extensionForMimeType, pickRecordingMimeType } from './recordingFormat';

function handAt(cx: number, cy: number, handedness = 'Right', size = 0.1): DetectedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  landmarks[0] = { x: cx, y: cy + size / 2 };
  landmarks[9] = { x: cx, y: cy - size / 2 };
  return { landmarks, handedness, score: 0.9 };
}

describe('HandSelector', () => {
  it('keeps following the active hand when a second hand appears', () => {
    const s = new HandSelector();
    expect(s.select([handAt(0.3, 0.5)], 0)).not.toBeNull();
    for (let t = 33; t < 1000; t += 33) {
      const x = 0.3 + t / 20000; // active hand drifts slowly right
      const chosen = s.select([handAt(0.75, 0.5, 'Left', 0.2), handAt(x, 0.5)], t);
      expect(chosen?.handedness).toBe('Right');
    }
  });

  it('reports no hand rather than jumping when the active hand vanishes', () => {
    const s = new HandSelector();
    s.select([handAt(0.3, 0.5)], 0);
    expect(s.select([handAt(0.8, 0.5, 'Left')], 33)).toBeNull();
    expect(s.select([handAt(0.8, 0.5, 'Left')], 200)).toBeNull();
  });

  it('adopts another hand only after the release period', () => {
    const s = new HandSelector();
    s.select([handAt(0.3, 0.5)], 0);
    expect(s.select([handAt(0.8, 0.5, 'Left')], 400)?.handedness).toBe('Left');
  });
});

describe('OneEuroFilter', () => {
  it('suppresses jitter at rest and follows fast motion closely', () => {
    const f = new OneEuroFilter(smoothingToParams(0.5));
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.filter(0.5 + (i % 2 ? 0.004 : -0.004), i * 33);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.003);

    const g = new OneEuroFilter(smoothingToParams(0.5));
    let y = 0;
    for (let i = 0; i <= 30; i++) y = g.filter(i * 0.03, i * 33); // ~0.9 units/s
    expect(0.9 - y).toBeLessThan(0.06);
  });
});

describe('recording format', () => {
  it('prefers MP4 when supported, else WebM', () => {
    expect(pickRecordingMimeType((t) => t.startsWith('video/mp4'))).toMatch(/^video\/mp4/);
    expect(pickRecordingMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
    expect(pickRecordingMimeType(() => false)).toBeNull();
  });

  it('never labels WebM as MP4', () => {
    expect(extensionForMimeType('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionForMimeType('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionForMimeType('VIDEO/WEBM')).toBe('webm');
    expect(extensionForMimeType('')).toBeNull();
  });
});
