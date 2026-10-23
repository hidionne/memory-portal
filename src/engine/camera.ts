export type CameraErrorKind = 'denied' | 'unavailable' | 'in-use' | 'insecure' | 'unknown';

export class CameraError extends Error {
  constructor(
    public kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export interface ActiveCameraSettings {
  deviceId: string;
  label: string;
  width: number;
  height: number;
  frameRate: number | null;
}

function classify(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was denied.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('unavailable', 'No camera was found.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in-use', 'The camera could not be started. It may be in use by another app.');
    default:
      return new CameraError('unknown', err instanceof Error ? err.message : String(err));
  }
}

/** Heuristic for the MacBook's own camera ("FaceTime HD Camera", "MacBook Pro Camera", …). */
export function looksBuiltIn(label: string): boolean {
  return /facetime|built-?in|macbook|integrated/i.test(label) && !/iphone|ipad|continuity|virtual/i.test(label);
}

/**
 * Owns the getUserMedia stream and the <video> element it plays in.
 * Video only — the microphone is never requested.
 */
export class CameraController {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  onEnded: (() => void) | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.autoplay = false;
    // Kept in the DOM (invisibly) so every browser keeps decoding frames; the
    // compositor canvas is what's actually shown.
    Object.assign(this.video.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    });
    this.video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.video);
  }

  destroy() {
    this.stop();
    this.video.remove();
  }

  get active() {
    return this.stream !== null;
  }

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  static async listCameras(): Promise<CameraInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async start(deviceId: string | null, lowRes: boolean): Promise<ActiveCameraSettings> {
    if (!window.isSecureContext) {
      throw new CameraError('insecure', 'Camera access needs HTTPS or localhost.');
    }
    if (!CameraController.supported()) {
      throw new CameraError('unavailable', 'This browser does not support camera access.');
    }
    this.stop();

    const video: MediaTrackConstraints = {
      width: { ideal: lowRes ? 1280 : 1920 },
      height: { ideal: lowRes ? 720 : 1080 },
      // Ask for 60 fps: cameras that support it (some external webcams, Continuity
      // Camera) halve the motion-to-photon delay; MacBook cameras fall back to 30.
      frameRate: { ideal: 60 },
    };
    if (deviceId) video.deviceId = { exact: deviceId };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      // A remembered device may have been unplugged; fall back to the default camera once.
      if (deviceId && err instanceof DOMException && err.name === 'OverconstrainedError') {
        return this.start(null, lowRes);
      }
      throw classify(err);
    }

    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (this.stream === stream) this.onEnded?.();
    });
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (err) {
      this.stop();
      throw classify(err);
    }
    await waitForDimensions(this.video);
    return this.describe();
  }

  describe(): ActiveCameraSettings {
    const track = this.stream?.getVideoTracks()[0];
    const s = track?.getSettings() ?? {};
    return {
      deviceId: s.deviceId ?? '',
      label: track?.label ?? '',
      width: this.video.videoWidth || s.width || 0,
      height: this.video.videoHeight || s.height || 0,
      frameRate: s.frameRate ?? null,
    };
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.pause();
    this.video.srcObject = null;
  }
}

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('resize', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done);
    video.addEventListener('resize', done);
    setTimeout(done, 3000);
  });
}
