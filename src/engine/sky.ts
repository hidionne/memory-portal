import { crayonPaint, rng, strokeCrayon } from './crayon';
import type { Point } from '../lib/geometry';

/**
 * A crayon-coloured blue sky with scribbly white crayon clouds, painted once.
 * Used for the frame around the video and as the mouse-demo backdrop.
 */
export function createSky(width = 1920, height = 1200, seed = 5): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const r = rng(seed);

  // Waxy blue fill, then loose diagonal hatching in a few blues so it reads as coloured-in.
  ctx.fillStyle = '#6ea8e8';
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = crayonPaint(ctx, 'sky');
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  const blues = ['rgba(90, 150, 225, 0.18)', 'rgba(130, 185, 240, 0.2)', 'rgba(80, 135, 215, 0.14)'];
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = r() * width * 1.2 - width * 0.1;
    const y = r() * height;
    const len = 80 + r() * 220;
    ctx.strokeStyle = blues[i % 3];
    ctx.lineWidth = 6 + r() * 14;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y - len * 0.2 + r() * 20, x + len, y - len * 0.35);
    ctx.stroke();
  }

  // Clouds: clusters of overlapping looping scribbles, the way a child draws them.
  const cloudCount = Math.round((width * height) / 260000);
  for (let i = 0; i < cloudCount; i++) {
    const cx = (i + 0.5) * (width / cloudCount) + (r() - 0.5) * width * 0.12;
    const cy = height * (0.12 + r() * 0.76);
    cloud(ctx, { x: cx, y: cy }, 90 + r() * 70, r);
  }
  return c;
}

function cloud(ctx: CanvasRenderingContext2D, c: Point, size: number, r: () => number) {
  const puffs = 4 + Math.floor(r() * 3);
  for (let p = 0; p < puffs; p++) {
    const px = c.x + (p / (puffs - 1) - 0.5) * size * 1.9 + (r() - 0.5) * size * 0.2;
    const py = c.y + Math.sin((p / (puffs - 1)) * Math.PI) * -size * 0.35 + (r() - 0.5) * size * 0.2;
    const pr = size * (0.38 + r() * 0.22);
    // Two and a bit loops round each puff, radius jittering like a child's hand.
    const pts: Point[] = [];
    const turns = 2.3 + r() * 0.8;
    const steps = 46;
    const phase = r() * Math.PI * 2;
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * Math.PI * 2 * turns + phase;
      const rr = pr * (0.82 + 0.25 * Math.sin(t * 2.3 + p) + (r() - 0.5) * 0.08);
      pts.push({ x: px + Math.cos(t) * rr, y: py + Math.sin(t) * rr * 0.72 });
    }
    strokeCrayon(ctx, pts, 'cloud', 7 + r() * 4, 0.85);
    // A little scribble fill inside.
    const fill: Point[] = [];
    for (let k = 0; k <= 18; k++) {
      const t = (k / 18) * Math.PI * 4 + phase;
      fill.push({ x: px + Math.cos(t) * pr * 0.45 * r(), y: py + Math.sin(t) * pr * 0.3 * r() });
    }
    strokeCrayon(ctx, fill, 'cloud', 6, 0.55);
  }
}
