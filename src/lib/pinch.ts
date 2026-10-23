import { distance, lerp, type Point } from './geometry';

/** MediaPipe hand landmark indices used by the app. */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  PINKY_MCP: 17,
} as const;

/**
 * Palm size in camera pixels: the larger of wrist→middle-knuckle length and a
 * scaled knuckle width. Each shrinks under a different rotation (tilting
 * toward the camera vs. turning sideways), so the max stays stable.
 *
 * @param lm landmarks already converted to isotropic pixel units
 */
export function palmSize(lm: Point[]): number {
  const length = distance(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
  const width = distance(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP]) * 1.3;
  return Math.max(length, width, 1e-6);
}

/** Thumb-tip ↔ index-tip distance divided by palm size. Scale-invariant. */
export function pinchRatio(lm: Point[]): number {
  return distance(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / palmSize(lm);
}

export interface PinchThresholds {
  /** Ratio at or above which a closed portal opens. */
  open: number;
  /** Ratio at or below which an open portal closes. */
  close: number;
}

/**
 * Sensitivity 0..1 → hysteresis thresholds (ratios of fingertip gap to palm size).
 *
 *   sensitivity 0.0 → open ≥ 0.55, close ≤ 0.33   (needs a wide spread)
 *   sensitivity 0.5 → open ≥ 0.42, close ≤ 0.25   (default)
 *   sensitivity 1.0 → open ≥ 0.28, close ≤ 0.17   (opens with a small gap)
 *
 * Fingertips touching measure ~0.05–0.15; a relaxed open pinch ~0.8–1.4.
 * The close threshold is 60% of the open one, so the dead band between them
 * absorbs tracking jitter and the portal never flickers near a threshold.
 */
export function thresholdsForSensitivity(sensitivity: number): PinchThresholds {
  const s = Math.min(1, Math.max(0, sensitivity));
  const open = lerp(0.55, 0.28, s);
  return { open, close: open * 0.6 };
}

/** Converts normalised camera landmarks to isotropic camera-pixel units. */
export function toCameraPixels(lm: Point[], videoWidth: number, videoHeight: number): Point[] {
  return lm.map((p) => ({ x: p.x * videoWidth, y: p.y * videoHeight }));
}
