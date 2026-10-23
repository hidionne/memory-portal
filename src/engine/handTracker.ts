import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { DetectedHand } from '../lib/handSelection';

const BASE = import.meta.env.BASE_URL;
/** Served from public/ (copied by scripts/setup-assets.mjs). */
const WASM_PATH = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}models/hand_landmarker.task`;
/** Official model, used only if the local copy is missing. */
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface TrackerInfo {
  delegate: 'GPU' | 'CPU';
  modelSource: 'local' | 'remote';
}

/**
 * Thin wrapper around MediaPipe HandLandmarker in VIDEO mode. Inference is
 * synchronous on the main thread (the GPU delegate keeps it to a few ms on
 * Apple silicon), so calls can never overlap.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastTimestamp = 0;
  info: TrackerInfo | null = null;

  get ready() {
    return this.landmarker !== null;
  }

  async load(): Promise<TrackerInfo> {
    if (this.landmarker && this.info) return this.info;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

    let modelSource: TrackerInfo['modelSource'] = 'local';
    let modelAssetPath = LOCAL_MODEL;
    try {
      const head = await fetch(LOCAL_MODEL, { method: 'HEAD' });
      const type = head.headers.get('content-type') ?? '';
      if (!head.ok || type.includes('text/html')) throw new Error('missing');
    } catch {
      modelSource = 'remote';
      modelAssetPath = REMOTE_MODEL;
    }

    const create = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        // Lower presence/tracking thresholds keep hold of hands that are partly
        // out of frame or at awkward angles instead of dropping them.
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });

    let delegate: TrackerInfo['delegate'] = 'GPU';
    try {
      this.landmarker = await create('GPU');
    } catch (gpuErr) {
      console.warn('[memory portal] GPU delegate unavailable, using CPU', gpuErr);
      delegate = 'CPU';
      this.landmarker = await create('CPU');
    }
    // The first inference compiles GPU shaders and can block for seconds.
    // Do it now, while the UI says "loading", instead of on the first camera frame.
    await new Promise((r) => setTimeout(r, 30));
    const warm = document.createElement('canvas');
    warm.width = warm.height = 128;
    warm.getContext('2d')!.fillRect(0, 0, 128, 128);
    this.lastTimestamp = performance.now();
    this.landmarker.detectForVideo(warm, this.lastTimestamp);
    warm.width = warm.height = 0;

    this.info = { delegate, modelSource };
    return this.info;
  }

  detect(video: HTMLVideoElement, now: number): DetectedHand[] {
    if (!this.landmarker) return [];
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    return result.landmarks.map((landmarks, i) => ({
      landmarks: landmarks.map((p) => ({ x: p.x, y: p.y })),
      handedness: result.handedness[i]?.[0]?.categoryName ?? 'Unknown',
      score: result.handedness[i]?.[0]?.score ?? 0,
    }));
  }

  dispose() {
    this.landmarker?.close();
    this.landmarker = null;
    this.info = null;
    this.lastTimestamp = 0;
  }
}
