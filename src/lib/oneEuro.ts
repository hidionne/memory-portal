/**
 * One Euro filter (Casiez et al. 2012): an adaptive low-pass filter whose
 * cutoff rises with speed. Slow hands get heavy smoothing (no jitter), fast
 * hands get little (no lag). Time-aware, so uneven frame intervals are fine.
 */
export interface OneEuroParams {
  /** Cutoff (Hz) when still. Lower = smoother at rest. */
  minCutoff: number;
  /** How quickly the cutoff rises with speed. Higher = less lag when moving. */
  beta: number;
  /** Cutoff (Hz) for the derivative estimate. */
  dCutoff: number;
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(public params: OneEuroParams) {}

  reset() {
    this.x = null;
    this.dx = 0;
  }

  /** @param t timestamp in milliseconds */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.lastT = t;
      return value;
    }
    const dt = Math.max(1e-3, (t - this.lastT) / 1000);
    this.lastT = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class PointFilter {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(params: OneEuroParams) {
    this.fx = new OneEuroFilter({ ...params });
    this.fy = new OneEuroFilter({ ...params });
  }

  setParams(params: OneEuroParams) {
    this.fx.params = { ...params };
    this.fy.params = { ...params };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }

  filter(p: { x: number; y: number }, t: number) {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t) };
  }
}

/**
 * Smoothing control (0 = raw and twitchy, 1 = very smooth) → filter params.
 * Coordinates are expected in units of output-frame height, so speeds of
 * ~1 unit/s correspond to a brisk hand movement.
 */
export function smoothingToParams(smoothing: number): OneEuroParams {
  const s = Math.min(1, Math.max(0, smoothing));
  return {
    minCutoff: 3.0 + (0.35 - 3.0) * s,
    beta: 14 + (4 - 14) * s,
    dCutoff: 1.0,
  };
}
