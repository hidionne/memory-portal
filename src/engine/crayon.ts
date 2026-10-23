import { distance, type Point } from '../lib/geometry';
import { quadPoints, type Quad } from '../lib/quad';

/**
 * Kid-drawing borders: waxy crayon strokes that wobble a little and "boil"
 * (re-draw slightly differently a few times a second) like hand-drawn
 * animation. Every stroke runs between the actual fingertip corners, so the
 * border twists into an X together with the portal.
 */
export type BorderStyle = 'stitch' | 'crayon' | 'rainbow' | 'scribble' | 'none';

export interface BorderOptions {
  style: BorderStyle;
  /** 0..1 thickness control. */
  size: number;
  /** Little crayon flowers at the fingertips. */
  doodles: boolean;
}

export const CRAYONS = {
  pink: '#f0559c',
  orange: '#ff8f2e',
  yellow: '#ffcf1f',
  blue: '#3b86de',
  purple: '#9653d3',
  green: '#47a84a',
  red: '#e4463a',
  grass: '#5dbb57',
  leaf: '#3f9a45',
  teal: '#4fc3d9',
  sky: '#6aa7e6',
  cloud: '#fbfcff',
} as const;

export type Crayon = keyof typeof CRAYONS;

// ------------------------------------------------------------------ textures

const tileCache = new Map<string, HTMLCanvasElement>();
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Waxy texture: solid colour with speckled paper showing through, slightly streaky. */
function crayonTile(color: string): HTMLCanvasElement {
  const cached = tileCache.get(color);
  if (cached) return cached;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const r = rng(color.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const streak = 0.5 + 0.5 * Math.sin((x + y * 0.35) * 0.9);
      const n = r();
      let a = 0.72 + 0.28 * n * streak;
      if (n < 0.2) a *= 0.2; // paper tooth showing through
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tileCache.set(color, c);
  return c;
}

export function crayonPaint(ctx: CanvasRenderingContext2D, crayon: Crayon): CanvasPattern | string {
  let map = patternCache.get(ctx);
  if (!map) {
    map = new Map();
    patternCache.set(ctx, map);
  }
  let p = map.get(crayon);
  if (!p) {
    p = ctx.createPattern(crayonTile(CRAYONS[crayon]), 'repeat') ?? undefined;
    if (!p) return CRAYONS[crayon];
    map.set(crayon, p);
  }
  return p;
}

// -------------------------------------------------------------------- paths

/** Smooth seeded wobble in roughly [-1, 1] as a function of distance along a stroke. */
function wobbler(seed: number) {
  const r = rng(seed * 9973 + 17);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const p3 = r() * 6.28;
  const f1 = 0.018 + r() * 0.01;
  const f2 = 0.05 + r() * 0.03;
  const f3 = 0.13 + r() * 0.05;
  return (s: number) => 0.55 * Math.sin(s * f1 + p1) + 0.3 * Math.sin(s * f2 + p2) + 0.15 * Math.sin(s * f3 + p3);
}

/**
 * Points along a→b, pushed sideways by a wobble plus a constant offset, and
 * overshooting the ends a touch the way children's lines do.
 */
export function wobblyLine(a: Point, b: Point, seed: number, amp: number, offset: number, overshoot: number): Point[] {
  const len = distance(a, b);
  if (len < 0.5) return [a, b];
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  const nx = -dy;
  const ny = dx;
  const w = wobbler(seed);
  const ext = Math.min(overshoot, len * 0.15);
  const step = 10;
  const n = Math.max(2, Math.ceil((len + ext * 2) / step));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const s = -ext + ((len + ext * 2) * i) / n;
    const off = offset + amp * w(s) * Math.min(1, (s + ext + 1) / 24, (len + ext - s + 1) / 24 + 0.3);
    pts.push({ x: a.x + dx * s + nx * off, y: a.y + dy * s + ny * off });
  }
  return pts;
}

/** A coil of little loops along a→b — the "scribble" border. */
export function loopyLine(a: Point, b: Point, seed: number, radius: number, pitch: number): Point[] {
  const len = distance(a, b);
  if (len < 0.5) return [a, b];
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  const nx = -dy;
  const ny = dx;
  const w = wobbler(seed);
  const pts: Point[] = [];
  const n = Math.max(8, Math.ceil(len / (pitch / 8)));
  for (let i = 0; i <= n; i++) {
    const s = (len * i) / n;
    const th = (s / pitch) * Math.PI * 2 + seed;
    const r = radius * (1 + 0.25 * w(s));
    pts.push({
      x: a.x + dx * (s + Math.cos(th) * r * 0.8) + nx * Math.sin(th) * r,
      y: a.y + dy * (s + Math.cos(th) * r * 0.8) + ny * Math.sin(th) * r,
    });
  }
  return pts;
}

export function strokeCrayon(ctx: CanvasRenderingContext2D, pts: Point[], crayon: Crayon, width: number, alpha: number) {
  if (pts.length < 2 || width <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = crayonPaint(ctx, crayon);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ doodles

export function flower(ctx: CanvasRenderingContext2D, c: Point, size: number, petal: Crayon, middle: Crayon, seed: number, alpha: number) {
  const r = rng(seed);
  const petals = 5;
  const rot = r() * 6.28;
  for (let i = 0; i < petals; i++) {
    const a = rot + (i / petals) * Math.PI * 2;
    const pc = { x: c.x + Math.cos(a) * size * 0.62, y: c.y + Math.sin(a) * size * 0.62 };
    const loop: Point[] = [];
    const pr = size * (0.42 + r() * 0.08);
    for (let k = 0; k <= 14; k++) {
      const t = (k / 14) * Math.PI * 2.15;
      loop.push({ x: pc.x + Math.cos(t + a) * pr * (1 + (r() - 0.5) * 0.18), y: pc.y + Math.sin(t + a) * pr * 0.75 });
    }
    strokeCrayon(ctx, loop, petal, size * 0.22, alpha);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = crayonPaint(ctx, middle);
  ctx.beginPath();
  ctx.arc(c.x, c.y, size * 0.33, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const CORNER_FLOWERS: [Crayon, Crayon][] = [
  ['pink', 'yellow'],
  ['orange', 'red'],
  ['blue', 'yellow'],
  ['purple', 'orange'],
];

/** Thread sewn in a dashed running stitch, with a soft blue shadow under each stitch. */
export function runningStitch(ctx: CanvasRenderingContext2D, pts: Point[], color: Crayon, k: number, alpha: number) {
  if (pts.length < 2 || alpha <= 0.01) return;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.setLineDash([10 * k, 7 * k]);
  ctx.lineWidth = 3.4 * k;
  ctx.strokeStyle = 'rgba(40, 70, 140, 0.28)';
  ctx.translate(0.8 * k, 1.2 * k);
  trace();
  ctx.stroke();
  ctx.translate(-0.8 * k, -1.2 * k);
  ctx.strokeStyle = CRAYONS[color];
  ctx.lineWidth = 2.6 * k;
  trace();
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------- public

/** Frame counter for the hand-drawn "boil" (changes ~7 times a second, cycling through 3 drawings). */
export function boilFrame(now: number) {
  return Math.floor(now / 140) % 3;
}

export function drawBorder(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
  opts: BorderOptions,
  scale: number,
  now: number,
  alpha: number,
) {
  if (alpha <= 0.01) return;
  const k = scale * (0.7 + opts.size * 1.6);
  const boil = boilFrame(now);
  const pts = quadPoints(quad);
  const edges = pts.map((p, i) => [p, pts[(i + 1) % 4]] as const);

  if (opts.style === 'stitch') {
    // Mixed media: a crayon line with running stitches sewn just inside it.
    const main: Crayon[] = ['pink', 'orange', 'blue', 'purple'];
    const thread: Crayon[] = ['yellow', 'teal', 'pink', 'orange'];
    edges.forEach(([a, b], i) => {
      strokeCrayon(ctx, wobblyLine(a, b, i * 7 + boil, 4.5 * k, 0, 12 * k), main[i], 8 * k, alpha);
      strokeCrayon(ctx, wobblyLine(a, b, i * 7 + boil + 20, 4.5 * k, -2 * k, 8 * k), main[i], 4.5 * k, alpha * 0.65);
      runningStitch(ctx, wobblyLine(a, b, i * 11 + 300, 1.2 * k, 12 * k, 0), thread[i], k, alpha);
    });
  } else if (opts.style === 'crayon') {
    const main: Crayon[] = ['pink', 'orange', 'blue', 'purple'];
    const accent: Crayon[] = ['yellow', 'blue', 'pink', 'green'];
    edges.forEach(([a, b], i) => {
      // Gone over twice, like a child pressing hard, plus a thinner line in another colour.
      strokeCrayon(ctx, wobblyLine(a, b, i * 7 + boil, 5 * k, 0, 14 * k), main[i], 9 * k, alpha);
      strokeCrayon(ctx, wobblyLine(a, b, i * 7 + boil + 20, 5 * k, -2 * k, 10 * k), main[i], 5 * k, alpha * 0.7);
      strokeCrayon(ctx, wobblyLine(a, b, i * 7 + boil + 40, 6 * k, 9 * k, 8 * k), accent[i], 4 * k, alpha * 0.95);
    });
  } else if (opts.style === 'rainbow') {
    const bands: Crayon[] = ['red', 'orange', 'yellow', 'blue'];
    edges.forEach(([a, b], i) => {
      bands.forEach((c, j) => {
        strokeCrayon(ctx, wobblyLine(a, b, i * 13 + j * 3 + boil, 3.5 * k, (j - 1.5) * 7 * k, 10 * k), c, 7 * k, alpha);
      });
    });
  } else if (opts.style === 'scribble') {
    const colors: Crayon[] = ['blue', 'pink', 'orange', 'purple'];
    edges.forEach(([a, b], i) => {
      strokeCrayon(ctx, wobblyLine(a, b, i * 5 + boil, 4 * k, 0, 8 * k), 'yellow', 7 * k, alpha * 0.85);
      strokeCrayon(ctx, loopyLine(a, b, i * 3 + boil * 0.7, 10 * k, 30 * k), colors[i], 4 * k, alpha);
    });
  }

  if (opts.doodles) {
    pts.forEach((p, i) => {
      const [petal, middle] = CORNER_FLOWERS[i];
      flower(ctx, p, 24 * k, petal, middle, i * 101 + boil, alpha);
    });
  }
}

/** One hand only: a crayon line between its index fingertip and thumb tip. */
export function drawFingerLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  opts: BorderOptions,
  scale: number,
  now: number,
  alpha: number,
) {
  if (alpha <= 0.01) return;
  const k = scale * (0.7 + opts.size * 1.6);
  const boil = boilFrame(now);
  const style = opts.style === 'none' ? 'crayon' : opts.style;
  if (style === 'rainbow') {
    (['red', 'orange', 'yellow', 'blue'] as Crayon[]).forEach((c, j) =>
      strokeCrayon(ctx, wobblyLine(a, b, j * 3 + boil, 3.5 * k, (j - 1.5) * 7 * k, 10 * k), c, 7 * k, alpha),
    );
  } else if (style === 'scribble') {
    strokeCrayon(ctx, loopyLine(a, b, boil * 0.7, 10 * k, 30 * k), 'blue', 4 * k, alpha);
  } else if (style === 'stitch') {
    strokeCrayon(ctx, wobblyLine(a, b, boil, 4.5 * k, 0, 12 * k), 'pink', 8 * k, alpha);
    runningStitch(ctx, wobblyLine(a, b, 300, 1.2 * k, 12 * k, 0), 'yellow', k, alpha);
  } else {
    strokeCrayon(ctx, wobblyLine(a, b, boil, 5 * k, 0, 14 * k), 'pink', 9 * k, alpha);
    strokeCrayon(ctx, wobblyLine(a, b, boil + 40, 6 * k, 9 * k, 8 * k), 'yellow', 4 * k, alpha * 0.95);
  }
  if (opts.doodles) {
    flower(ctx, a, 22 * k, 'pink', 'yellow', 7 + boil, alpha);
    flower(ctx, b, 22 * k, 'blue', 'orange', 11 + boil, alpha);
  }
}
