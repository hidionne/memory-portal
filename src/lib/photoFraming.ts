import type { Rect } from './geometry';

export interface Framing {
  /** 1 = fit (cover or contain); up to 3. */
  zoom: number;
  /** -1..1: 0 is centred, ±1 aligns the image edge with the frame edge. */
  panX: number;
  panY: number;
}

export const DEFAULT_FRAMING: Framing = { zoom: 1, panX: 0, panY: 0 };

export type FitMode = 'cover' | 'contain';

/**
 * Where to draw an image of size (iw, ih) so it fills `frame` with the given
 * fit, zoom and pan. Always uniform scale, so photographs are never stretched.
 * Pan moves the image by at most half its overflow, so a covering image never
 * reveals empty space.
 */
export function framePhoto(iw: number, ih: number, frame: Rect, fit: FitMode, framing: Framing): Rect {
  const base =
    fit === 'cover'
      ? Math.max(frame.w / iw, frame.h / ih)
      : Math.min(frame.w / iw, frame.h / ih);
  const scale = base * Math.max(0.1, framing.zoom);
  const w = iw * scale;
  const h = ih * scale;
  const overflowX = (w - frame.w) / 2;
  const overflowY = (h - frame.h) / 2;
  return {
    x: frame.x - overflowX - framing.panX * overflowX,
    y: frame.y - overflowY - framing.panY * overflowY,
    w,
    h,
  };
}
