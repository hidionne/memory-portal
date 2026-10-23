import type { Point, Rect, Size } from './geometry';

/**
 * The single source of truth for where the camera image lands in the output
 * frame. The compositor draws the video with it and the hand tracker maps
 * landmarks with it, so the two can never disagree.
 *
 * Camera landmarks are normalised to the *unmirrored* camera frame (0..1).
 * Output coordinates are canvas pixels of the composited frame.
 */
export interface CoverTransform {
  /** Uniform scale from camera pixels to output pixels. */
  scale: number;
  /** Where the (unmirrored) scaled video's left/top edge sits in output pixels. */
  offsetX: number;
  offsetY: number;
  /** Drawn size of the full video in output pixels (overflows the frame when cropping). */
  drawWidth: number;
  drawHeight: number;
  mirror: boolean;
  output: Size;
}

export function computeCoverTransform(source: Size, output: Size, mirror: boolean): CoverTransform {
  const sw = Math.max(1, source.width);
  const sh = Math.max(1, source.height);
  const scale = Math.max(output.width / sw, output.height / sh);
  const drawWidth = sw * scale;
  const drawHeight = sh * scale;
  return {
    scale,
    offsetX: (output.width - drawWidth) / 2,
    offsetY: (output.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
    mirror,
    output: { width: output.width, height: output.height },
  };
}

/** Normalised camera coordinate → output pixel. */
export function cameraToOutput(p: Point, t: CoverTransform): Point {
  const x = t.offsetX + p.x * t.drawWidth;
  const y = t.offsetY + p.y * t.drawHeight;
  return { x: t.mirror ? t.output.width - x : x, y };
}

/** Output pixel → normalised camera coordinate (inverse of cameraToOutput). */
export function outputToCamera(p: Point, t: CoverTransform): Point {
  const x = t.mirror ? t.output.width - p.x : p.x;
  return { x: (x - t.offsetX) / t.drawWidth, y: (p.y - t.offsetY) / t.drawHeight };
}

/**
 * Draws a video/image into a 2D context using the transform. Mirroring flips
 * the whole frame about the output's vertical centre line, which is exactly
 * what cameraToOutput does to points.
 */
export function drawWithCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, t: CoverTransform) {
  ctx.save();
  if (t.mirror) {
    ctx.translate(t.output.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, t.offsetX, t.offsetY, t.drawWidth, t.drawHeight);
  ctx.restore();
}

/**
 * Output pixels → CSS pixels of an element that displays the output canvas.
 * The canvas element is always sized to the output's exact aspect ratio, so
 * this is a uniform scale; devicePixelRatio does not enter into it.
 */
export function outputToElement(p: Point, output: Size, element: Size): Point {
  return { x: (p.x / output.width) * element.width, y: (p.y / output.height) * element.height };
}

export function elementToOutput(p: Point, output: Size, element: Size): Point {
  return { x: (p.x / element.width) * output.width, y: (p.y / element.height) * output.height };
}

export function rectOutputToElement(r: Rect, output: Size, element: Size): Rect {
  const sx = element.width / output.width;
  const sy = element.height / output.height;
  return { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy };
}

/** Largest box of the given aspect that fits inside the container. */
export function fitAspect(container: Size, aspect: number): Size {
  if (container.width / Math.max(1, container.height) > aspect) {
    return { width: container.height * aspect, height: container.height };
  }
  return { width: container.width, height: container.width / aspect };
}
