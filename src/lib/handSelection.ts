import { distance, type Point } from './geometry';

export interface DetectedHand {
  /** Normalised camera landmarks (21 points). */
  landmarks: Point[];
  /** 'Left' | 'Right' as reported by the model; used only as a consistency label. */
  handedness: string;
  score: number;
}

export interface HandSelectorOptions {
  /** Max centroid jump (normalised camera units) still treated as the same hand. */
  maxJump: number;
  /** Extra cost when handedness label differs from the active hand. */
  handednessPenalty: number;
  /** After this long without a match, the active hand is released and any hand may be adopted. */
  releaseAfterMs: number;
}

export const DEFAULT_SELECTOR_OPTIONS: HandSelectorOptions = {
  maxJump: 0.25,
  handednessPenalty: 0.12,
  releaseAfterMs: 350,
};

const KEY_POINTS = [0, 4, 5, 8, 9, 17];

export function handCentroid(lm: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const i of KEY_POINTS) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / KEY_POINTS.length, y: y / KEY_POINTS.length };
}

function apparentSize(lm: Point[]): number {
  return distance(lm[0], lm[9]);
}

/**
 * Keeps one active hand across frames. While the active hand is tracked, a
 * second hand entering the frame is ignored; a different hand is only adopted
 * after the active one has been gone for `releaseAfterMs` (i.e. after the
 * portal has finished fading out).
 */
export class HandSelector {
  private active: { centroid: Point; handedness: string; lastSeen: number } | null = null;

  constructor(private opts: HandSelectorOptions = DEFAULT_SELECTOR_OPTIONS) {}

  reset() {
    this.active = null;
  }

  get hasActive() {
    return this.active !== null;
  }

  select(hands: DetectedHand[], now: number): DetectedHand | null {
    if (this.active && now - this.active.lastSeen > this.opts.releaseAfterMs) {
      this.active = null;
    }

    let chosen: DetectedHand | null = null;
    if (this.active) {
      let best = Infinity;
      for (const hand of hands) {
        const jump = distance(handCentroid(hand.landmarks), this.active.centroid);
        if (jump > this.opts.maxJump) continue;
        const cost = jump + (hand.handedness === this.active.handedness ? 0 : this.opts.handednessPenalty);
        if (cost < best) {
          best = cost;
          chosen = hand;
        }
      }
    } else {
      // Adopt the most prominent hand: biggest on screen, weighted by confidence.
      let best = -Infinity;
      for (const hand of hands) {
        const value = apparentSize(hand.landmarks) * (0.5 + 0.5 * hand.score);
        if (value > best) {
          best = value;
          chosen = hand;
        }
      }
    }

    if (chosen) {
      this.active = { centroid: handCentroid(chosen.landmarks), handedness: chosen.handedness, lastSeen: now };
    }
    return chosen;
  }
}
