import { DEFAULT_FRAMING } from '../lib/photoFraming';
import type { PhotoSource } from './compositor';
import { getGrainTile } from './textures';

export interface Photo extends PhotoSource {
  name: string;
  thumbUrl: string;
  sample: boolean;
}

/**
 * Working resolution cap (long edge). 2560px keeps a 9:16 1080×1920 export
 * sharp at zoom 1 and acceptable up to ~1.3× zoom, at ~20 MB per photo.
 */
export const MAX_WORKING_EDGE = 2560;
const THUMB_EDGE = 240;

// Random rather than a module counter, which restarts if the module is re-evaluated.
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class PhotoDecodeError extends Error {}

const ACCEPTED = /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i;

export function isProbablyImage(file: File) {
  return file.type.startsWith('image/') || ACCEPTED.test(file.name);
}

function isHeic(file: File) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function makeThumb(source: HTMLCanvasElement): Promise<string> {
  const s = THUMB_EDGE / Math.max(source.width, source.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * s));
  c.height = Math.max(1, Math.round(source.height * s));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
  c.width = c.height = 0;
  return blob ? URL.createObjectURL(blob) : '';
}

function toWorkingCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const s = Math.min(1, MAX_WORKING_EDGE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Decodes a local file entirely in the browser. Uses an <img> so EXIF
 * orientation from phone photos is honoured, then downsamples to a working
 * canvas and releases the decoded original.
 */
export async function loadPhotoFile(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    try {
      // onload rather than img.decode(): decode() can stall for detached images.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 30000);
        img.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timer);
          reject(new Error('decode'));
        };
        img.src = url;
      });
    } catch {
      if (isHeic(file)) {
        throw new PhotoDecodeError(
          `“${file.name}” is HEIC, which this browser can’t decode. Export it as JPEG (Photos › File › Export) or open the site in Safari.`,
        );
      }
      throw new PhotoDecodeError(`“${file.name}” couldn’t be decoded. Try JPEG, PNG or WebP.`);
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new PhotoDecodeError(`“${file.name}” has no image data.`);
    const canvas = toWorkingCanvas(img, w, h);
    img.src = '';
    return {
      id: newId(),
      name: file.name.replace(/\.[^.]+$/, ''),
      image: canvas,
      width: canvas.width,
      height: canvas.height,
      framing: { ...DEFAULT_FRAMING },
      thumbUrl: await makeThumb(canvas),
      sample: false,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function releasePhoto(photo: Photo) {
  if (photo.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
  if (photo.image instanceof HTMLCanvasElement) {
    photo.image.width = 0;
    photo.image.height = 0;
  }
}

// ---------------------------------------------------------------------------
// Sample memories: original illustrations painted procedurally, so the tool
// can be tried immediately without any third-party images.
// ---------------------------------------------------------------------------

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function filmFinish(ctx: CanvasRenderingContext2D, w: number, h: number, stamp: string) {
  ctx.save();
  // Faded, warm print: lift blacks, warm the mids, soft vignette.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255, 176, 110, 0.35)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(52, 40, 34, 0.32)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(150,120,100,1)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.28;
  const pattern = ctx.createPattern(getGrainTile(), 'repeat');
  if (pattern) {
    pattern.setTransform(new DOMMatrix([1.5, 0, 0, 1.5, 0, 0]));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();

  // Orange date-back stamp, clearly marking the image as a sample.
  ctx.save();
  const size = Math.round(Math.min(w, h) * 0.04);
  ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(255, 120, 40, 0.8)';
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = 'rgba(255, 150, 70, 0.92)';
  ctx.fillText(stamp, w - size * 1.4, h - size * 1.4);
  ctx.restore();
}

const paintKite: Painter = (ctx, w, h) => {
  const r = rng(7);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.66);
  sky.addColorStop(0, '#8fb6cc');
  sky.addColorStop(0.65, '#d9dccb');
  sky.addColorStop(1, '#f2d7b0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(w * 0.74, h * 0.24, 0, w * 0.74, h * 0.24, w * 0.5);
  sun.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
  sun.addColorStop(0.15, 'rgba(255, 228, 180, 0.55)');
  sun.addColorStop(1, 'rgba(255, 220, 170, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  // Soft clouds.
  for (let i = 0; i < 7; i++) {
    const cx = r() * w;
    const cy = h * (0.08 + r() * 0.3);
    const cr = w * (0.12 + r() * 0.12);
    const c = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    c.addColorStop(0, 'rgba(255,255,250,0.35)');
    c.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr, cr * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const hill = (y: number, amp: number, color: string, phase: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, y);
    for (let x = 0; x <= w; x += w / 40) {
      ctx.lineTo(x, y - Math.sin(x / w * Math.PI * 1.3 + phase) * amp - Math.sin(x / w * 7 + phase) * amp * 0.15);
    }
    ctx.lineTo(w, h);
    ctx.fill();
  };
  hill(h * 0.64, h * 0.05, '#93a07a', 0.4);
  hill(h * 0.7, h * 0.06, '#7c8d5c', 2.1);
  const meadow = ctx.createLinearGradient(0, h * 0.72, 0, h);
  meadow.addColorStop(0, '#a49a55');
  meadow.addColorStop(1, '#6b6a38');
  ctx.fillStyle = meadow;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.78);
  ctx.quadraticCurveTo(w * 0.5, h * 0.7, w, h * 0.8);
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60, 64, 30, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 260; i++) {
    const x = r() * w;
    const y = h * (0.8 + r() * 0.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y - 14, x + (r() - 0.5) * 16, y - 20 - r() * 24);
    ctx.stroke();
  }
  // Kite + string + tail.
  const kx = w * 0.36;
  const ky = h * 0.27;
  const ks = w * 0.085;
  ctx.strokeStyle = 'rgba(250, 245, 235, 0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(kx, ky + ks * 1.3);
  ctx.bezierCurveTo(kx + w * 0.1, h * 0.55, kx + w * 0.4, h * 0.6, w * 0.82, h * 1.02);
  ctx.stroke();
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(-0.25);
  ctx.fillStyle = '#c4473a';
  ctx.beginPath();
  ctx.moveTo(0, -ks);
  ctx.lineTo(ks * 0.75, 0);
  ctx.lineTo(0, ks * 1.35);
  ctx.lineTo(-ks * 0.75, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e3b04b';
  ctx.beginPath();
  ctx.moveTo(0, -ks);
  ctx.lineTo(ks * 0.75, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(70, 30, 20, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -ks);
  ctx.lineTo(0, ks * 1.35);
  ctx.moveTo(-ks * 0.75, 0);
  ctx.lineTo(ks * 0.75, 0);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(250, 245, 235, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, ks * 1.35);
  for (let i = 1; i <= 6; i++) ctx.lineTo(Math.sin(i * 1.4) * ks * 0.35, ks * 1.35 + i * ks * 0.45);
  ctx.stroke();
  for (let i = 1; i <= 6; i++) {
    ctx.fillStyle = i % 2 ? '#e3b04b' : '#c4473a';
    ctx.beginPath();
    ctx.ellipse(Math.sin(i * 1.4) * ks * 0.35, ks * 1.35 + i * ks * 0.45, ks * 0.12, ks * 0.06, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  filmFinish(ctx, w, h, "SAMPLE  8 '97");
};

const paintBirthday: Painter = (ctx, w, h) => {
  const r = rng(21);
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, w * 0.75);
  bg.addColorStop(0, '#5a3524');
  bg.addColorStop(0.5, '#2c1910');
  bg.addColorStop(1, '#120a06');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = r() * h * 0.6;
    const br = w * (0.02 + r() * 0.05);
    const g = ctx.createRadialGradient(x, y, 0, x, y, br);
    const a = 0.08 + r() * 0.16;
    g.addColorStop(0, `rgba(255, 190, 110, ${a})`);
    g.addColorStop(0.85, `rgba(255, 170, 90, ${a * 0.8})`);
    g.addColorStop(1, 'rgba(255, 170, 90, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Table.
  const table = ctx.createLinearGradient(0, h * 0.72, 0, h);
  table.addColorStop(0, '#6e4a33');
  table.addColorStop(1, '#2a1a10');
  ctx.fillStyle = table;
  ctx.fillRect(0, h * 0.74, w, h * 0.26);
  // Cake.
  const cx = w * 0.5;
  const top = h * 0.5;
  const rw = w * 0.22;
  const rh = h * 0.07;
  const body = h * 0.2;
  const side = ctx.createLinearGradient(cx - rw, 0, cx + rw, 0);
  side.addColorStop(0, '#b99a7e');
  side.addColorStop(0.45, '#f4e6cf');
  side.addColorStop(1, '#a3846b');
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.ellipse(cx, top + body, rw, rh, 0, 0, Math.PI);
  ctx.lineTo(cx - rw, top);
  ctx.ellipse(cx, top, rw, rh, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d98d93';
  ctx.beginPath();
  ctx.ellipse(cx, top, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d98d93';
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (i / 13);
    const x = cx - Math.cos(a) * rw * 0.98;
    const y = top + Math.sin(a) * rh;
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.02, w * 0.012, h * 0.03 + r() * h * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f7e9ee';
  ctx.beginPath();
  ctx.ellipse(cx, top, rw * 0.92, rh * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();
  // Candles and flames.
  const candles = 6;
  for (let i = 0; i < candles; i++) {
    const a = (i / (candles - 1)) * Math.PI;
    const x = cx - Math.cos(a) * rw * 0.62;
    const y = top - Math.sin(a) * rh * 0.5;
    const ch = h * 0.085;
    ctx.fillStyle = i % 2 ? '#8fb3c9' : '#f2c46b';
    ctx.fillRect(x - w * 0.006, y - ch, w * 0.012, ch);
    const fy = y - ch - h * 0.022;
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(x, fy, 0, x, fy, w * 0.11);
    glow.addColorStop(0, 'rgba(255, 196, 110, 0.55)');
    glow.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - w * 0.12, fy - w * 0.12, w * 0.24, w * 0.24);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath();
    ctx.ellipse(x, fy, w * 0.006, h * 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  filmFinish(ctx, w, h, "SAMPLE 11 '98");
};

const paintSeaside: Painter = (ctx, w, h) => {
  const r = rng(3);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  sky.addColorStop(0, '#b6d0da');
  sky.addColorStop(1, '#efe5d3');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sea = ctx.createLinearGradient(0, h * 0.45, 0, h * 0.6);
  sea.addColorStop(0, '#5f8fa0');
  sea.addColorStop(1, '#9cc3c3');
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.45, w, h * 0.16);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const y = h * (0.46 + r() * 0.14);
    const x = r() * w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * (0.02 + r() * 0.06), y);
    ctx.stroke();
  }
  const sand = ctx.createLinearGradient(0, h * 0.6, 0, h);
  sand.addColorStop(0, '#eadbbb');
  sand.addColorStop(1, '#d4b88b');
  ctx.fillStyle = sand;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  ctx.quadraticCurveTo(w * 0.5, h * 0.59, w, h * 0.615);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  ctx.quadraticCurveTo(w * 0.5, h * 0.59, w, h * 0.615);
  ctx.quadraticCurveTo(w * 0.5, h * 0.605, 0, h * 0.632);
  ctx.fill();
  // Towel.
  ctx.save();
  ctx.translate(w * 0.58, h * 0.8);
  ctx.rotate(-0.12);
  const tw = w * 0.36;
  const th = h * 0.1;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#f1e8da' : '#d26a4f';
    ctx.fillRect(-tw / 2 + (tw / 6) * i, -th / 2, tw / 6 + 1, th);
  }
  ctx.restore();
  // Umbrella.
  const ux = w * 0.34;
  const uy = h * 0.63;
  ctx.strokeStyle = '#efe7da';
  ctx.lineWidth = w * 0.008;
  ctx.beginPath();
  ctx.moveTo(ux, uy);
  ctx.lineTo(ux + w * 0.03, h * 0.86);
  ctx.stroke();
  const ur = w * 0.25;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#f3ecdf' : '#c95f4a';
    ctx.beginPath();
    ctx.moveTo(ux, uy - ur * 0.05);
    const a0 = Math.PI + (i / 8) * Math.PI;
    const a1 = Math.PI + ((i + 1) / 8) * Math.PI;
    ctx.ellipse(ux, uy, ur, ur * 0.5, -0.08, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(80, 60, 40, 0.16)';
  ctx.beginPath();
  ctx.ellipse(ux + w * 0.08, h * 0.88, ur * 0.9, h * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bucket.
  ctx.fillStyle = '#e1b84d';
  ctx.beginPath();
  ctx.moveTo(w * 0.16, h * 0.84);
  ctx.lineTo(w * 0.24, h * 0.84);
  ctx.lineTo(w * 0.225, h * 0.9);
  ctx.lineTo(w * 0.175, h * 0.9);
  ctx.closePath();
  ctx.fill();
  filmFinish(ctx, w, h, "SAMPLE  1 '99");
};

const paintGarden: Painter = (ctx, w, h) => {
  const r = rng(42);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#567447');
  bg.addColorStop(0.6, '#3a5530');
  bg.addColorStop(1, '#2b3d23');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 70; i++) {
    const x = r() * w;
    const y = r() * h * 0.8;
    const br = w * (0.015 + r() * 0.06);
    const g = ctx.createRadialGradient(x, y, 0, x, y, br);
    const a = 0.05 + r() * 0.18;
    g.addColorStop(0, `rgba(230, 240, 170, ${a})`);
    g.addColorStop(1, 'rgba(230, 240, 170, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - br, y - br, br * 2, br * 2);
  }
  const ray = ctx.createLinearGradient(w * 0.2, 0, w * 0.7, h);
  ray.addColorStop(0, 'rgba(255, 236, 190, 0.28)');
  ray.addColorStop(1, 'rgba(255, 236, 190, 0)');
  ctx.fillStyle = ray;
  ctx.beginPath();
  ctx.moveTo(w * 0.15, 0);
  ctx.lineTo(w * 0.45, 0);
  ctx.lineTo(w * 0.9, h);
  ctx.lineTo(w * 0.55, h);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Swing.
  const seatY = h * 0.66;
  const left = w * 0.36;
  const right = w * 0.64;
  ctx.strokeStyle = '#d8c7a0';
  ctx.lineWidth = w * 0.006;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.02, 0);
  ctx.lineTo(left, seatY);
  ctx.moveTo(right - w * 0.02, 0);
  ctx.lineTo(right, seatY);
  ctx.stroke();
  ctx.fillStyle = '#8a5a36';
  ctx.fillRect(left - w * 0.03, seatY - h * 0.005, right - left + w * 0.06, h * 0.022);
  ctx.fillStyle = 'rgba(255, 230, 190, 0.35)';
  ctx.fillRect(left - w * 0.03, seatY - h * 0.005, right - left + w * 0.06, h * 0.005);
  ctx.fillStyle = 'rgba(10, 20, 8, 0.3)';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.9, w * 0.2, h * 0.02, 0, 0, Math.PI * 2);
  ctx.fill();
  // Flowers.
  for (let i = 0; i < 120; i++) {
    const x = r() * w;
    const y = h * (0.82 + r() * 0.18);
    ctx.fillStyle = r() > 0.5 ? 'rgba(244, 214, 222, 0.85)' : 'rgba(250, 244, 226, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y, w * (0.004 + r() * 0.006), 0, Math.PI * 2);
    ctx.fill();
  }
  filmFinish(ctx, w, h, "SAMPLE  6 '96");
};

const SAMPLES: { name: string; w: number; h: number; paint: Painter }[] = [
  { name: 'Sample · kite day', w: 1200, h: 1600, paint: paintKite },
  { name: 'Sample · birthday', w: 1600, h: 1200, paint: paintBirthday },
  { name: 'Sample · seaside', w: 1200, h: 1600, paint: paintSeaside },
  { name: 'Sample · garden swing', w: 1200, h: 1600, paint: paintGarden },
];

export async function createSamplePhotos(): Promise<Photo[]> {
  const out: Photo[] = [];
  for (const s of SAMPLES) {
    const c = document.createElement('canvas');
    c.width = s.w;
    c.height = s.h;
    s.paint(c.getContext('2d')!, s.w, s.h);
    out.push({
      id: newId(),
      name: s.name,
      image: c,
      width: s.w,
      height: s.h,
      framing: { ...DEFAULT_FRAMING },
      thumbUrl: await makeThumb(c),
      sample: true,
    });
  }
  return out;
}
