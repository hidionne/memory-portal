import { extensionForMimeType, pickRecordingMimeType } from '../lib/recordingFormat';

export interface RecordingResult {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: string;
  filename: string;
  durationMs: number;
}

export interface RecordingSupport {
  supported: boolean;
  mimeType: string | null;
  reason?: string;
}

export function recordingSupport(): RecordingSupport {
  if (typeof MediaRecorder === 'undefined') {
    return { supported: false, mimeType: null, reason: 'MediaRecorder is not available in this browser.' };
  }
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { supported: false, mimeType: null, reason: 'Canvas capture is not available in this browser.' };
  }
  const mimeType = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) {
    return { supported: false, mimeType: null, reason: 'No supported video format for recording.' };
  }
  return { supported: true, mimeType };
}

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Records the compositor canvas (video only, no audio). Only the canvas is
 * captured, so UI, debug overlays and demo handles never appear in exports.
 */
export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  get recording() {
    return this.recorder?.state === 'recording';
  }

  start(canvas: HTMLCanvasElement, fps: number, bitsPerSecond: number) {
    const support = recordingSupport();
    if (!support.supported || !support.mimeType) throw new Error(support.reason);
    this.stream = canvas.captureStream(fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: support.mimeType,
      videoBitsPerSecond: bitsPerSecond,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  stop(): Promise<RecordingResult> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('Not recording'));
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        // Label the file by what the recorder actually produced.
        const mimeType = recorder.mimeType || this.chunks[0]?.type || '';
        const extension = extensionForMimeType(mimeType) ?? extensionForMimeType(this.chunks[0]?.type ?? '');
        this.cleanup();
        if (!extension) {
          reject(new Error(`Unrecognised recording format "${mimeType}".`));
          return;
        }
        const blob = new Blob(this.chunks, { type: mimeType.split(';')[0] });
        this.chunks = [];
        resolve({
          blob,
          url: URL.createObjectURL(blob),
          mimeType,
          extension,
          filename: `memory-portal-${timestamp()}.${extension}`,
          durationMs: performance.now() - this.startedAt,
        });
      };
      recorder.onerror = () => {
        this.cleanup();
        reject(new Error('Recording failed.'));
      };
      recorder.stop();
    });
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }

  dispose() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.cleanup();
    this.chunks = [];
  }
}
