import type { Size } from './lib/geometry';
import type { FitMode } from './lib/photoFraming';
import type { PhotoMode } from './engine/compositor';
import type { BorderStyle } from './engine/crayon';
import type { EngineSettings } from './engine/PortalEngine';

export type Aspect = '9:16' | '16:9' | '1:1';

export interface UISettings {
  mirror: boolean;
  sensitivity: number;
  smoothing: number;
  photoMode: PhotoMode;
  followFit: FitMode;
  borderStyle: BorderStyle;
  borderSize: number;
  doodles: boolean;
  garden: boolean;
  newMemoryOnReopen: boolean;
  aspect: Aspect;
  performance: boolean;
  debug: boolean;
  countdown: boolean;
}

export const DEFAULT_SETTINGS: UISettings = {
  mirror: true,
  sensitivity: 0.5,
  smoothing: 0.4,
  photoMode: 'window',
  followFit: 'cover',
  borderStyle: 'stitch',
  borderSize: 0.5,
  doodles: true,
  garden: true,
  newMemoryOnReopen: false,
  // Landscape uses the MacBook camera's full frame with no cropping.
  aspect: '16:9',
  performance: false,
  debug: false,
  countdown: true,
};

/** Output (= recording) resolution. Performance mode drops to 720p-class. */
export function outputSize(aspect: Aspect, performance: boolean): Size {
  const long = performance ? 1280 : 1920;
  const short = performance ? 720 : 1080;
  switch (aspect) {
    case '9:16':
      return { width: short, height: long };
    case '16:9':
      return { width: long, height: short };
    case '1:1':
      return { width: short, height: short };
  }
}

export function aspectValue(aspect: Aspect): number {
  const s = outputSize(aspect, false);
  return s.width / s.height;
}

export function toEngineSettings(s: UISettings): EngineSettings {
  return {
    mirror: s.mirror,
    sensitivity: s.sensitivity,
    smoothing: s.smoothing,
    photoMode: s.photoMode,
    followFit: s.followFit,
    border: { style: s.borderStyle, size: s.borderSize, doodles: s.doodles },
    garden: s.garden,
    newMemoryOnReopen: s.newMemoryOnReopen,
    output: outputSize(s.aspect, s.performance),
    performance: s.performance,
    debug: s.debug,
  };
}

const KEY = 'memory-portal:settings:v3';
const DEVICE_KEY = 'memory-portal:camera:v1';

export function loadSettings(): UISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // Debug always starts off.
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), debug: false };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: UISettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}

export function loadDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function saveDeviceId(id: string | null) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // ignore
  }
}
