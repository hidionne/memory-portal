import { describe, expect, it } from 'vitest';
import {
  cameraToOutput,
  computeCoverTransform,
  elementToOutput,
  fitAspect,
  outputToCamera,
  outputToElement,
} from './mapping';

const CAM = { width: 1920, height: 1080 }; // MacBook camera, landscape
const PORTRAIT = { width: 1080, height: 1920 };
const LANDSCAPE = { width: 1920, height: 1080 };
const SQUARE = { width: 1080, height: 1080 };

describe('computeCoverTransform', () => {
  it('crops the sides of a landscape camera for portrait output', () => {
    const t = computeCoverTransform(CAM, PORTRAIT, false);
    expect(t.scale).toBeCloseTo(1920 / 1080);
    expect(t.drawHeight).toBeCloseTo(1920);
    expect(t.drawWidth).toBeCloseTo(3413.33, 1);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.offsetX).toBeCloseTo(-(3413.33 - 1080) / 2, 1);
  });

  it('is an identity-like fit when aspect ratios match', () => {
    const t = computeCoverTransform(CAM, LANDSCAPE, false);
    expect(t.scale).toBeCloseTo(1);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo(0);
  });

  it('crops sides for square output', () => {
    const t = computeCoverTransform(CAM, SQUARE, false);
    expect(t.drawHeight).toBeCloseTo(1080);
    expect(t.offsetX).toBeCloseTo(-420);
  });

  it('crops top/bottom when the camera is taller than the output', () => {
    const t = computeCoverTransform({ width: 1080, height: 1920 }, LANDSCAPE, false);
    expect(t.drawWidth).toBeCloseTo(1920);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeLessThan(0);
  });
});

describe('cameraToOutput', () => {
  it('maps the camera centre to the output centre for every ratio and mirror setting', () => {
    for (const out of [PORTRAIT, LANDSCAPE, SQUARE]) {
      for (const mirror of [false, true]) {
        const p = cameraToOutput({ x: 0.5, y: 0.5 }, computeCoverTransform(CAM, out, mirror));
        expect(p.x).toBeCloseTo(out.width / 2);
        expect(p.y).toBeCloseTo(out.height / 2);
      }
    }
  });

  it('mirrors horizontally: a point on the camera’s left lands on the output’s right', () => {
    const plain = computeCoverTransform(CAM, LANDSCAPE, false);
    const mirrored = computeCoverTransform(CAM, LANDSCAPE, true);
    expect(cameraToOutput({ x: 0.25, y: 0.3 }, plain)).toEqual({ x: 480, y: 324 });
    const m = cameraToOutput({ x: 0.25, y: 0.3 }, mirrored);
    expect(m.x).toBeCloseTo(1440);
    expect(m.y).toBeCloseTo(324);
  });

  it('accounts for the cover crop offset in portrait', () => {
    const t = computeCoverTransform(CAM, PORTRAIT, false);
    // The visible portrait slice is the centre 607.5px of the 1920px camera width.
    const visibleLeft = (1920 - 1080 * (1080 / 1920)) / 2 / 1920;
    const left = cameraToOutput({ x: visibleLeft, y: 0 }, t);
    expect(left.x).toBeCloseTo(0, 6);
    const right = cameraToOutput({ x: 1 - visibleLeft, y: 1 }, t);
    expect(right.x).toBeCloseTo(1080, 6);
    expect(right.y).toBeCloseTo(1920, 6);
  });

  it('places mirrored portrait points where the mirrored video pixel is drawn', () => {
    // The compositor draws the video with translate(W,0) scale(-1,1) and
    // drawImage(offsetX, offsetY, drawW, drawH). Reproduce that by hand.
    const t = computeCoverTransform(CAM, PORTRAIT, true);
    const camPx = { x: 700, y: 400 };
    const drawnUnflippedX = t.offsetX + (camPx.x / CAM.width) * t.drawWidth;
    const expectedX = PORTRAIT.width - drawnUnflippedX;
    const p = cameraToOutput({ x: camPx.x / CAM.width, y: camPx.y / CAM.height }, t);
    expect(p.x).toBeCloseTo(expectedX);
    expect(p.y).toBeCloseTo(t.offsetY + (400 / 1080) * t.drawHeight);
  });

  it('round-trips through outputToCamera', () => {
    for (const out of [PORTRAIT, LANDSCAPE, SQUARE]) {
      for (const mirror of [false, true]) {
        const t = computeCoverTransform({ width: 1280, height: 720 }, out, mirror);
        const cam = { x: 0.37, y: 0.81 };
        const back = outputToCamera(cameraToOutput(cam, t), t);
        expect(back.x).toBeCloseTo(cam.x);
        expect(back.y).toBeCloseTo(cam.y);
      }
    }
  });

  it('keeps the same point aligned when the camera resolution changes but aspect does not', () => {
    const a = cameraToOutput({ x: 0.6, y: 0.4 }, computeCoverTransform({ width: 1280, height: 720 }, PORTRAIT, true));
    const b = cameraToOutput({ x: 0.6, y: 0.4 }, computeCoverTransform({ width: 1920, height: 1080 }, PORTRAIT, true));
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
  });
});

describe('output ↔ element (CSS pixel) mapping', () => {
  it('is a uniform scale independent of device pixel ratio', () => {
    const element = fitAspect({ width: 900, height: 800 }, 9 / 16);
    expect(element.height).toBeCloseTo(800);
    expect(element.width).toBeCloseTo(450);
    const css = outputToElement({ x: 540, y: 960 }, PORTRAIT, element);
    expect(css).toEqual({ x: 225, y: 400 });
    const back = elementToOutput(css, PORTRAIT, element);
    expect(back.x).toBeCloseTo(540);
    expect(back.y).toBeCloseTo(960);
  });

  it('fits wide containers by height and tall containers by width', () => {
    expect(fitAspect({ width: 2000, height: 1000 }, 1)).toEqual({ width: 1000, height: 1000 });
    expect(fitAspect({ width: 800, height: 2000 }, 16 / 9)).toEqual({ width: 800, height: 450 });
  });
});
