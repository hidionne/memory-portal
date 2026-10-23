import type { Point } from '../lib/geometry';
import { boilFrame, crayonPaint, rng, strokeCrayon, wobblyLine, type Crayon } from './crayon';

/**
 * A row of crayon flowers and grass that grows up from the bottom of the
 * frame. Drawn straight onto the composited frame (no background fill), so the
 * camera shows through everywhere except the crayon marks themselves.
 */
type Kind = 'daisy' | 'rose' | 'tulip' | 'star';

interface Bloom {
  x: number;
  /** Stem height as a fraction of frame height. */
  height: number;
  lean: number;
  kind: Kind;
  petal: Crayon;
  middle: Crayon;
  delay: number;
  seed: number;
}

const KINDS: Kind[] = ['daisy', 'rose', 'tulip', 'daisy', 'star', 'rose'];
const PETALS: [Crayon, Crayon][] = [
  ['red', 'purple'],
  ['teal', 'yellow'],
  ['yellow', 'purple'],
  ['purple', 'red'],
  ['orange', 'pink'],
  ['pink', 'yellow'],
  ['blue', 'orange'],
];
const GROW_MS = 1700;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class Garden {
  private start = 0;
  private blooms: Bloom[] = [];
  private layoutKey = '';
  private cache = new Map<string, HTMLCanvasElement>();

  /** Start the growing animation again (camera started, garden switched on…). */
  regrow(now: number) {
    this.start = now;
    this.cache.clear();
  }

  private layout(W: number, H: number, scale: number) {
    const key = `${W}x${H}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.cache.clear();
    const r = rng(42);
    const n = Math.max(5, Math.round(W / (165 * scale)));
    this.blooms = Array.from({ length: n }, (_, i) => {
      const [petal, middle] = PETALS[i % PETALS.length];
      return {
        x: ((i + 0.5) / n) * W + (r() - 0.5) * (W / n) * 0.35,
        height: 0.12 + r() * 0.11,
        lean: (r() - 0.5) * 0.06,
        kind: KINDS[i % KINDS.length],
        petal,
        middle,
        delay: r() * 700 + i * 60,
        seed: i * 31 + 7,
      };
    });
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, scale: number) {
    this.layout(W, H, scale);
    const elapsed = now - this.start;
    const grown = elapsed > 900 + this.blooms.length * 60 + GROW_MS;
    const boil = boilFrame(now);
    const stripH = Math.ceil(H * 0.36);

    if (grown) {
      // Fully grown: reuse one cached strip per boil frame.
      const key = `${boil}`;
      let strip = this.cache.get(key);
      if (!strip) {
        strip = document.createElement('canvas');
        strip.width = W;
        strip.height = stripH;
        const c = strip.getContext('2d')!;
        c.translate(0, stripH - H);
        this.paint(c, W, H, Infinity, boil, scale);
        this.cache.set(key, strip);
      }
      ctx.drawImage(strip, 0, H - stripH);
    } else {
      this.paint(ctx, W, H, elapsed, boil, scale);
    }
  }

  private paint(ctx: CanvasRenderingContext2D, W: number, H: number, elapsed: number, boil: number, scale: number) {
    const k = scale;
    // Grass first, so stems grow up out of it.
    const grassGrow = easeOut(clamp01(elapsed / 900));
    if (grassGrow > 0) {
      const r = rng(9 + boil);
      const step = 11 * k;
      for (let x = -step; x < W + step; x += step * (0.6 + r() * 0.8)) {
        const h = H * (0.035 + r() * 0.05) * grassGrow;
        const lean = (r() - 0.5) * 18 * k;
        strokeCrayon(
          ctx,
          [
            { x, y: H + 6 * k },
            { x: x + lean * 0.4, y: H - h * 0.5 },
            { x: x + lean, y: H - h },
          ],
          r() > 0.4 ? 'grass' : 'leaf',
          (3.5 + r() * 2) * k,
          0.9,
        );
      }
    }

    for (const b of this.blooms) {
      const g = clamp01((elapsed - b.delay) / GROW_MS);
      if (g <= 0) continue;
      const stemH = H * b.height * easeOut(Math.min(1, g / 0.7));
      const base = { x: b.x, y: H + 8 * k };
      const top = { x: b.x + b.lean * H, y: H - stemH };
      strokeCrayon(ctx, wobblyLine(base, top, b.seed + boil, 3 * k, 0, 0), 'leaf', 5 * k, 1);

      // Leaves.
      const leafT = clamp01((g - 0.35) / 0.3);
      if (leafT > 0) {
        const at = (f: number): Point => ({ x: base.x + (top.x - base.x) * f, y: base.y + (top.y - base.y) * f });
        leaf(ctx, at(0.32), -1, 26 * k * easeOut(leafT), b.seed + boil);
        leaf(ctx, at(0.5), 1, 22 * k * easeOut(leafT), b.seed + 3 + boil);
      }

      // Flower head pops open at the end.
      const headT = clamp01((g - 0.62) / 0.38);
      if (headT > 0) head(ctx, b, top, 30 * k * Math.max(0, easeOutBack(headT)), boil);
    }
  }
}

function leaf(ctx: CanvasRenderingContext2D, at: Point, side: number, size: number, seed: number) {
  if (size < 1) return;
  const r = rng(seed);
  const tip = { x: at.x + side * size, y: at.y - size * 0.55 };
  const pts: Point[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const bulge = Math.sin(t * Math.PI) * size * 0.3 * (i < 6 ? 1 : -1);
    pts.push({
      x: at.x + (tip.x - at.x) * (i <= 6 ? t * 2 : 2 - t * 2) - bulge * 0.4 * side,
      y: at.y + (tip.y - at.y) * (i <= 6 ? t * 2 : 2 - t * 2) + bulge + (r() - 0.5) * 2,
    });
  }
  ctx.save();
  ctx.fillStyle = crayonPaint(ctx, 'grass');
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.fill();
  ctx.restore();
  strokeCrayon(ctx, pts, 'leaf', Math.max(2, size * 0.12), 1);
}

function blob(ctx: CanvasRenderingContext2D, c: Point, rx: number, ry: number, rot: number, color: Crayon, seed: number) {
  const r = rng(seed);
  const pts: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    const j = 1 + (r() - 0.5) * 0.18;
    const x = Math.cos(t) * rx * j;
    const y = Math.sin(t) * ry * j;
    pts.push({ x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  ctx.save();
  ctx.fillStyle = crayonPaint(ctx, color);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.fill();
  ctx.restore();
  strokeCrayon(ctx, pts, color, Math.max(2, rx * 0.16), 1);
}

function head(ctx: CanvasRenderingContext2D, b: Bloom, c: Point, size: number, boil: number) {
  if (size < 1) return;
  const r = rng(b.seed * 3 + boil);
  if (b.kind === 'daisy') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + b.seed;
      blob(ctx, { x: c.x + Math.cos(a) * size * 0.55, y: c.y + Math.sin(a) * size * 0.55 }, size * 0.42, size * 0.34, a, b.petal, b.seed + i + boil);
    }
    blob(ctx, c, size * 0.3, size * 0.3, 0, b.middle, b.seed + 9 + boil);
  } else if (b.kind === 'rose') {
    // A scribbled spiral, round and round like a child colouring in a circle.
    const pts: Point[] = [];
    const turns = 4;
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2 * turns;
      const rr = size * (0.95 - (i / 64) * 0.75) * (1 + (r() - 0.5) * 0.12);
      pts.push({ x: c.x + Math.cos(t) * rr, y: c.y + Math.sin(t) * rr * 0.92 });
    }
    strokeCrayon(ctx, pts, b.petal, size * 0.16, 1);
    blob(ctx, c, size * 0.22, size * 0.2, 0, b.middle, b.seed + boil);
  } else if (b.kind === 'tulip') {
    const w = size * 0.8;
    const pts: Point[] = [
      { x: c.x - w, y: c.y - size * 0.6 },
      { x: c.x - w * 0.4, y: c.y - size * 0.15 },
      { x: c.x, y: c.y - size * 0.75 },
      { x: c.x + w * 0.4, y: c.y - size * 0.15 },
      { x: c.x + w, y: c.y - size * 0.6 },
      { x: c.x + w * 0.85, y: c.y + size * 0.25 },
      { x: c.x, y: c.y + size * 0.5 },
      { x: c.x - w * 0.85, y: c.y + size * 0.25 },
      { x: c.x - w, y: c.y - size * 0.6 },
    ];
    ctx.save();
    ctx.fillStyle = crayonPaint(ctx, b.petal);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.fill();
    ctx.restore();
    strokeCrayon(ctx, pts, b.petal, size * 0.14, 1);
  } else {
    // Spiky starburst flower.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (r() - 0.5) * 0.2;
      const len = size * (0.8 + r() * 0.35);
      strokeCrayon(ctx, [c, { x: c.x + Math.cos(a) * len, y: c.y + Math.sin(a) * len }], i % 2 ? b.petal : 'purple', size * 0.1, 1);
    }
    blob(ctx, c, size * 0.24, size * 0.24, 0, b.middle, b.seed + boil);
  }
}
