import { distance, lerp, type Point, type Rect } from './geometry';

/**
 * The portal is the quadrilateral through four fingertips:
 *
 *   tl = left index    tr = right index
 *   bl = left thumb    br = right thumb
 *
 * The corners are taken literally — no sorting — so if one hand twists
 * (thumb above index) the edges cross and the portal becomes an X.
 */
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface FingerPair {
  index: Point;
  thumb: Point;
}

export function quadFromHands(left: FingerPair, right: FingerPair): Quad {
  return { tl: left.index, tr: right.index, br: right.thumb, bl: left.thumb };
}

/** Corners in drawing order (a closed loop tl → tr → br → bl). */
export function quadPoints(q: Quad): Point[] {
  return [q.tl, q.tr, q.br, q.bl];
}

export function quadBounds(q: Quad): Rect {
  const pts = quadPoints(q);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rectToQuad(r: Rect): Quad {
  return {
    tl: { x: r.x, y: r.y },
    tr: { x: r.x + r.w, y: r.y },
    br: { x: r.x + r.w, y: r.y + r.h },
    bl: { x: r.x, y: r.y + r.h },
  };
}

export function mapQuad(q: Quad, f: (p: Point) => Point): Quad {
  return { tl: f(q.tl), tr: f(q.tr), br: f(q.br), bl: f(q.bl) };
}

export function quadCentroid(q: Quad): Point {
  return {
    x: (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4,
    y: (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4,
  };
}

export function scaleQuad(q: Quad, k: number): Quad {
  const c = quadCentroid(q);
  return mapQuad(q, (p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

/**
 * Average spans of the portal: width = mean of top and bottom edges
 * (index↔index, thumb↔thumb), height = mean of left and right edges (each
 * hand's index↔thumb gap).
 */
export function quadSpans(q: Quad): { width: number; height: number } {
  return {
    width: (distance(q.tl, q.tr) + distance(q.bl, q.br)) / 2,
    height: (distance(q.tl, q.bl) + distance(q.tr, q.br)) / 2,
  };
}

/**
 * How open the portal is, independent of distance from the camera: the
 * narrower span divided by palm size. It collapses whether you pinch each
 * hand closed or bring both hands together.
 */
export function quadOpenness(q: Quad, palm: number): number {
  const s = quadSpans(q);
  return Math.min(s.width, s.height) / Math.max(palm, 1e-6);
}

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when opposite edges cross, i.e. the portal is twisted into an X (bow-tie). */
export function isTwisted(q: Quad): boolean {
  return segmentsCross(q.tl, q.tr, q.br, q.bl) || segmentsCross(q.tr, q.br, q.bl, q.tl);
}

/** Non-zero winding test, so both lobes of a twisted X count as inside. */
export function pointInQuad(p: Point, q: Quad): boolean {
  const pts = quadPoints(q);
  let winding = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (a.y <= p.y) {
      if (b.y > p.y && cross(a, b, p) > 0) winding++;
    } else if (b.y <= p.y && cross(a, b, p) < 0) {
      winding--;
    }
  }
  return winding !== 0;
}

/** Bilinear point inside the quad for (u, v) in [0,1]²; (0,0) = tl, (1,1) = br. */
export function bilinear(q: Quad, u: number, v: number): Point {
  const top = { x: lerp(q.tl.x, q.tr.x, u), y: lerp(q.tl.y, q.tr.y, u) };
  const bottom = { x: lerp(q.bl.x, q.br.x, u), y: lerp(q.bl.y, q.br.y, u) };
  return { x: lerp(top.x, bottom.x, v), y: lerp(top.y, bottom.y, v) };
}
