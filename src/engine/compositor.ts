import { clamp, type Point, type Size } from '../lib/geometry';
import { drawWithCover, type CoverTransform } from '../lib/mapping';
import { framePhoto, type FitMode, type Framing } from '../lib/photoFraming';
import { bilinear, quadPoints, quadSpans, type Quad } from '../lib/quad';
import { drawBorder, drawFingerLine, type BorderOptions } from './crayon';
import type { Garden } from './garden';

export interface PhotoSource {
  id: string;
  image: CanvasImageSource;
  width: number;
  height: number;
  framing: Framing;
}

export type PhotoMode = 'window' | 'follow';

export interface FrameState {
  now: number;
  /** Background: camera video (with its cover transform) or a still backdrop. */
  background:
    | { kind: 'video'; video: HTMLVideoElement; transform: CoverTransform }
    | { kind: 'image'; image: CanvasImageSource; transform: CoverTransform }
    | null;
  /** 0..1 darkening over the background (used for the idle preview). */
  dim: number;
  /** Portal corners in output pixels. */
  quad: Quad | null;
  /** Photo opacity inside the portal (open/close + tracking-loss fades). */
  portalAlpha: number;
  /** Border opacity; the border also traces the fingers while the portal is closed. */
  borderAlpha: number;
  /** One hand only: index↔thumb line. */
  line: { a: Point; b: Point } | null;
  lineAlpha: number;
  photo: PhotoSource | null;
  /** Previous photo while a crossfade is running. */
  fromPhoto: PhotoSource | null;
  /** Crossfade progress 0..1 (1 = only `photo`). */
  crossfade: number;
  photoMode: PhotoMode;
  followFit: FitMode;
  border: BorderOptions;
  /** Crayon flowers growing along the bottom, drawn over everything. */
  garden: Garden | null;
  performance: boolean;
}

/** Behind the camera before it's ready, and behind "whole photo" fits: crayon-sky blue, never black. */
const BACKING = '#6ea8e8';
const CARD_MAX = 1280;

/**
 * The one Canvas 2D compositor. It draws the visible preview, and the same
 * canvas is what the recorder captures, so exports match the screen.
 *
 *   1. mirrored webcam (or backdrop)
 *   2. photo inside the four-corner portal (clipped, or warped in Follow mode)
 *   3. crayon border along the corners / finger line for a single hand
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Follow mode: the photo is laid out on this card, then warped onto the quad. */
  private card: HTMLCanvasElement;
  private cctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.card = document.createElement('canvas');
    this.card.width = this.card.height = CARD_MAX;
    this.cctx = this.card.getContext('2d')!;
  }

  setSize(size: Size) {
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
  }

  get size(): Size {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  render(s: FrameState) {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scale = Math.min(W, H) / 1080;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingQuality = s.performance ? 'medium' : 'high';

    // 1. Background.
    ctx.fillStyle = BACKING;
    ctx.fillRect(0, 0, W, H);
    if (s.background) {
      const src = s.background.kind === 'video' ? s.background.video : s.background.image;
      const ready =
        s.background.kind === 'image' || (s.background.video.readyState >= 2 && s.background.video.videoWidth > 0);
      if (ready) drawWithCover(ctx, src, s.background.transform);
    }
    if (s.dim > 0) {
      ctx.fillStyle = `rgba(40, 70, 130, ${s.dim})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Photograph.
    const q = s.quad;
    // No minimum size and no fading as it shrinks: the photo stays exactly as big as the fingers make it.
    if (q && s.photo && s.portalAlpha > 0.002) {
      const alpha = clamp(s.portalAlpha, 0, 1);
      if (s.photoMode === 'window') this.drawWindow(s, q, alpha, W, H);
      else this.drawFollow(s, q, alpha);
    }

    // 3. Kid-drawing border and single-hand line.
    if (q && s.border.style !== 'none') drawBorder(ctx, q, s.border, scale, s.now, s.borderAlpha);
    if (s.line) drawFingerLine(ctx, s.line.a, s.line.b, s.border, scale, s.now, s.lineAlpha);
    ctx.globalAlpha = 1;
    if (s.garden) s.garden.draw(ctx, W, H, s.now, scale);
  }

  /** Photo fixed to the frame; the portal reveals part of it. Non-zero fill keeps both lobes of an X. */
  private drawWindow(s: FrameState, q: Quad, alpha: number, W: number, H: number) {
    const { ctx } = this;
    ctx.save();
    tracePolygon(ctx, quadPoints(q));
    ctx.clip('nonzero');
    const draw = (p: PhotoSource, a: number) => {
      const d = framePhoto(p.width, p.height, { x: 0, y: 0, w: W, h: H }, 'cover', p.framing);
      ctx.globalAlpha = alpha * a;
      ctx.drawImage(p.image, d.x, d.y, d.w, d.h);
    };
    if (s.fromPhoto && s.crossfade < 1) draw(s.fromPhoto, 1);
    draw(s.photo!, s.fromPhoto ? s.crossfade : 1);
    ctx.restore();
  }

  /**
   * Photo pinned to the four corners: lay it out on a card with the portal's
   * proportions, then warp the card onto the quad with a mesh of affine
   * triangles (Canvas 2D has no perspective transform).
   */
  private drawFollow(s: FrameState, q: Quad, alpha: number) {
    const spans = quadSpans(q);
    const cap = s.performance ? 720 : CARD_MAX;
    const k = Math.min(1, cap / Math.max(spans.width, spans.height, 1));
    const cw = Math.max(8, Math.round(spans.width * k));
    const ch = Math.max(8, Math.round(spans.height * k));

    const c = this.cctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.imageSmoothingQuality = s.performance ? 'medium' : 'high';
    c.clearRect(0, 0, cw + 2, ch + 2);
    c.fillStyle = BACKING;
    c.fillRect(0, 0, cw, ch);
    const frame = { x: 0, y: 0, w: cw, h: ch };
    c.save();
    c.beginPath();
    c.rect(0, 0, cw, ch);
    c.clip();
    const draw = (p: PhotoSource, a: number) => {
      const d = framePhoto(p.width, p.height, frame, s.followFit, p.framing);
      c.globalAlpha = a;
      c.drawImage(p.image, d.x, d.y, d.w, d.h);
    };
    if (s.fromPhoto && s.crossfade < 1) draw(s.fromPhoto, 1);
    draw(s.photo!, s.fromPhoto ? s.crossfade : 1);
    c.restore();

    const n = s.performance ? 4 : 7;
    this.ctx.globalAlpha = alpha;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u0 = i / n;
        const u1 = (i + 1) / n;
        const v0 = j / n;
        const v1 = (j + 1) / n;
        const d00 = bilinear(q, u0, v0);
        const d10 = bilinear(q, u1, v0);
        const d11 = bilinear(q, u1, v1);
        const d01 = bilinear(q, u0, v1);
        const s00 = { x: u0 * cw, y: v0 * ch };
        const s10 = { x: u1 * cw, y: v0 * ch };
        const s11 = { x: u1 * cw, y: v1 * ch };
        const s01 = { x: u0 * cw, y: v1 * ch };
        this.drawTriangle(s00, s10, s11, d00, d10, d11);
        this.drawTriangle(s00, s11, s01, d00, d11, d01);
      }
    }
    this.ctx.globalAlpha = 1;
  }

  private drawTriangle(s0: Point, s1: Point, s2: Point, d0: Point, d1: Point, d2: Point) {
    const m = affineFromTriangles(s0, s1, s2, d0, d1, d2);
    if (!m) return;
    const { ctx } = this;
    ctx.save();
    // Grow the clip slightly so neighbouring triangles overlap and no seams show.
    const cx = (d0.x + d1.x + d2.x) / 3;
    const cy = (d0.y + d1.y + d2.y) / 3;
    const grow = (p: Point) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * 0.9, y: p.y + (dy / len) * 0.9 };
    };
    tracePolygon(ctx, [grow(d0), grow(d1), grow(d2)]);
    ctx.clip();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(this.card, 0, 0);
    ctx.restore();
  }
}

function tracePolygon(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/**
 * The affine transform [a, b, c, d, e, f] (canvas order) mapping source
 * triangle s0 s1 s2 onto destination triangle d0 d1 d2. Null if degenerate.
 */
export function affineFromTriangles(
  s0: Point,
  s1: Point,
  s2: Point,
  d0: Point,
  d1: Point,
  d2: Point,
): [number, number, number, number, number, number] | null {
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return null;
  const ux = s1.x - s0.x;
  const uy = s1.y - s0.y;
  const vx = s2.x - s0.x;
  const vy = s2.y - s0.y;
  // Solve [a c; b d] · [ux vx; uy vy] = [d1-d0, d2-d0].
  const a = ((d1.x - d0.x) * vy - (d2.x - d0.x) * uy) / det;
  const c = ((d2.x - d0.x) * ux - (d1.x - d0.x) * vx) / det;
  const b = ((d1.y - d0.y) * vy - (d2.y - d0.y) * uy) / det;
  const d = ((d2.y - d0.y) * ux - (d1.y - d0.y) * vx) / det;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  return [a, b, c, d, e, f];
}
