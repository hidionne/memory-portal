import { distance, type Point } from './geometry';
import { handCentroid, type DetectedHand } from './handSelection';

export type Side = 'left' | 'right';

export interface Sides {
  /** The hand that owns the left corners (index = top-left, thumb = bottom-left). */
  left: DetectedHand | null;
  right: DetectedHand | null;
}

export interface TwoHandOptions {
  /** Max centroid jump (normalised camera units) still treated as the same hand. */
  maxJump: number;
  /** Forget a side after it has been unseen this long. */
  releaseAfterMs: number;
  /** Extra matching cost when a hand's handedness label differs from the track's (breaks ties when hands cross). */
  labelPenalty: number;
}

export const DEFAULT_TWO_HAND_OPTIONS: TwoHandOptions = { maxJump: 0.22, releaseAfterMs: 350, labelPenalty: 0.08 };

/** Horizontal position of a hand as it appears on screen (0 = left edge). */
export function screenX(hand: DetectedHand, mirror: boolean): number {
  const x = handCentroid(hand.landmarks).x;
  return mirror ? 1 - x : x;
}

interface Track {
  centroid: Point;
  label: string;
  lastSeen: number;
  /** Set once the side was decided with both hands visible. */
  confirmed: boolean;
}

/**
 * Assigns up to two detected hands to the left/right corners of the portal.
 *
 *  - Fresh pair: by on-screen position — the hand on the left of the screen
 *    owns the left corners. (MediaPipe's Left/Right labels flip depending on
 *    whether the input is treated as mirrored, so they aren't trusted for this.)
 *  - Afterwards: by spatial continuity, so if you cross or twist your hands
 *    the corners follow the actual fingers (and the portal can become an X)
 *    rather than flipping sides.
 *  - A single hand is placed by which half of the screen it is in; if a second
 *    hand arrives while the first was only guessed, both are re-decided together.
 *  - Handedness labels are only used as a tie-breaker for continuity (they stay
 *    consistent for a given hand even when the meaning of Left/Right is unclear).
 */
export class TwoHandAssigner {
  private tracks: Record<Side, Track | null> = { left: null, right: null };

  constructor(private opts: TwoHandOptions = DEFAULT_TWO_HAND_OPTIONS) {}

  reset() {
    this.tracks = { left: null, right: null };
  }

  assign(hands: DetectedHand[], mirror: boolean, now: number): Sides {
    for (const side of ['left', 'right'] as Side[]) {
      const t = this.tracks[side];
      if (t && now - t.lastSeen > this.opts.releaseAfterMs) this.tracks[side] = null;
    }

    const out: Sides = { left: null, right: null };
    const remaining = hands.slice(0, 2);

    // A guessed single hand gets re-decided when its partner shows up.
    const anyUnconfirmed =
      (this.tracks.left && !this.tracks.left.confirmed) || (this.tracks.right && !this.tracks.right.confirmed);
    const bothTracked = this.tracks.left && this.tracks.right;
    if (remaining.length === 2 && anyUnconfirmed && !bothTracked) this.reset();

    // 1. Continuity: match existing tracks to the nearest hands (cheapest pairs first).
    const pairs: { side: Side; hand: DetectedHand; cost: number }[] = [];
    for (const side of ['left', 'right'] as Side[]) {
      const t = this.tracks[side];
      if (!t) continue;
      for (const hand of remaining) {
        const jump = distance(handCentroid(hand.landmarks), t.centroid);
        if (jump > this.opts.maxJump) continue;
        pairs.push({ side, hand, cost: jump + (hand.handedness === t.label ? 0 : this.opts.labelPenalty) });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    for (const p of pairs) {
      if (out[p.side] || !remaining.includes(p.hand)) continue;
      out[p.side] = p.hand;
      remaining.splice(remaining.indexOf(p.hand), 1);
    }

    // 2. Fresh hands.
    const free = (['left', 'right'] as Side[]).filter((s) => !out[s] && !this.tracks[s]);
    if (remaining.length === 2 && free.length === 2) {
      const [a, b] = remaining;
      const aLeft = screenX(a, mirror) <= screenX(b, mirror);
      out.left = aLeft ? a : b;
      out.right = aLeft ? b : a;
    } else {
      for (const hand of remaining) {
        const open = (['left', 'right'] as Side[]).filter((s) => !out[s]);
        if (!open.length) break;
        out[open.length === 1 ? open[0] : screenX(hand, mirror) < 0.5 ? 'left' : 'right'] = hand;
      }
    }

    const both = !!(out.left && out.right);
    for (const side of ['left', 'right'] as Side[]) {
      const hand = out[side];
      if (!hand) continue;
      const prev = this.tracks[side];
      this.tracks[side] = {
        centroid: handCentroid(hand.landmarks),
        label: hand.handedness,
        lastSeen: now,
        confirmed: both || (prev?.confirmed ?? false),
      };
    }
    return out;
  }
}
