import { clamp, type Point, type Size } from '../lib/geometry';
import { DEFAULT_GESTURE_CONFIG, GestureMachine, nextIndex, type GestureEvent } from '../lib/gestureMachine';
import type { DetectedHand } from '../lib/handSelection';
import { cameraToOutput, computeCoverTransform, elementToOutput, type CoverTransform } from '../lib/mapping';
import { PointFilter, smoothingToParams } from '../lib/oneEuro';
import type { FitMode } from '../lib/photoFraming';
import { LM, palmSize, thresholdsForSensitivity, toCameraPixels } from '../lib/pinch';
import { mapQuad, pointInQuad, quadFromHands, quadOpenness, quadPoints, rectToQuad, scaleQuad, type Quad } from '../lib/quad';
import { TwoHandAssigner, type Side } from '../lib/twoHands';
import { CameraController, type ActiveCameraSettings } from './camera';
import { Compositor, type PhotoMode, type PhotoSource } from './compositor';
import type { BorderOptions } from './crayon';
import { HandTracker, type TrackerInfo } from './handTracker';
import { Garden } from './garden';
import { createSky } from './sky';

export type SourceKind = 'none' | 'camera' | 'backdrop';
export type InputMode = 'hand' | 'mouse';
/** searching = no hands, one = a single hand (line), ready = both hands (portal). */
export type HandStatus = 'off' | 'loading' | 'failed' | 'searching' | 'one' | 'ready';

export interface EngineSettings {
  mirror: boolean;
  sensitivity: number;
  smoothing: number;
  photoMode: PhotoMode;
  followFit: FitMode;
  border: BorderOptions;
  /** Crayon flowers growing along the bottom of the frame. */
  garden: boolean;
  newMemoryOnReopen: boolean;
  output: Size;
  performance: boolean;
  debug: boolean;
}

export interface EngineCallbacks {
  onHandStatus?: (status: HandStatus, detail?: string) => void;
  /** The gesture cycle advanced to a new photograph. */
  onAdvance?: (photoId: string) => void;
  onCameraEnded?: () => void;
}

const CROSSFADE_MS = 260;
const HANDLE_CSS_PX = 16;
const LINE_FADE_MS = 140;
const BORDER_FADE_IN_MS = 120;
/**
 * If one hand briefly drops out (e.g. near the frame edge), keep its corners
 * where they were for this long so the portal doesn't collapse.
 */
const SIDE_HOLD_MS = 600;
const SIDES: Side[] = ['left', 'right'];
type Corner = keyof Quad;
const CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl'];

interface SideState {
  index: PointFilter;
  thumb: PointFilter;
  lastSeen: number;
  /** Filtered fingertips in output pixels. */
  fingers: { index: Point; thumb: Point } | null;
  raw: { index: Point; thumb: Point } | null;
  /** Fingertips in camera pixels and palm size, for the openness measure. */
  cam: { index: Point; thumb: Point; palm: number } | null;
  /** True while showing held (not live) fingertips for this side. */
  held: boolean;
}

type DragMode =
  | { kind: 'move'; start: Point; quad: Quad }
  | { kind: 'corner'; corner: Corner }
  | { kind: 'draw'; anchor: Point; previous: Quad };

export class PortalEngine {
  readonly compositor: Compositor;
  readonly camera = new CameraController();
  private tracker = new HandTracker();
  private machine = new GestureMachine({ ...DEFAULT_GESTURE_CONFIG });
  private assigner = new TwoHandAssigner();
  private sides: Record<Side, SideState>;
  private backdrop: HTMLCanvasElement;
  private garden = new Garden();

  private settings: EngineSettings;
  private source: SourceKind = 'none';
  private input: InputMode = 'mouse';
  private photos: PhotoSource[] = [];
  private selectedId: string | null = null;
  private fromPhoto: PhotoSource | null = null;
  private crossfadeStart = 0;

  /** Mouse demo portal, normalised to the output frame (0..1) so it survives ratio changes. */
  private demo = { quad: rectToQuad({ x: 0.3, y: 0.25, w: 0.4, h: 0.45 }), open: true };
  private drag: DragMode | null = null;
  private clean = false;

  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private display: Size = { width: 1, height: 1 };

  private raf = 0;
  private disposed = false;
  private handStatus: HandStatus = 'off';
  private rvfcHandle = 0;
  private lastVideoTime = -1;
  private lastInference = 0;
  private trackerLoadToken = 0;
  private pendingEvents: GestureEvent[] = [];

  // Visual animation state (render-rate).
  private lastFrame = 0;
  private lineAlpha = 0;
  private line: { a: Point; b: Point } | null = null;
  private borderAlpha = 0;

  private dbg = {
    hands: 0,
    inferMs: 0,
    labels: '' as string,
    trackTimes: [] as number[],
    renderTimes: [] as number[],
    frameToRenderMs: 0,
    lastFrameAt: 0,
  };
  trackerInfo: TrackerInfo | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    settings: EngineSettings,
    private callbacks: EngineCallbacks = {},
  ) {
    this.settings = settings;
    this.compositor = new Compositor(canvas);
    this.compositor.setSize(settings.output);
    this.backdrop = createSky();
    const params = smoothingToParams(settings.smoothing);
    const side = (): SideState => ({
      index: new PointFilter(params),
      thumb: new PointFilter(params),
      lastSeen: -Infinity,
      fingers: null,
      raw: null,
      cam: null,
      held: false,
    });
    this.sides = { left: side(), right: side() };
    this.applyGestureSettings();
    this.camera.onEnded = () => this.callbacks.onCameraEnded?.();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- settings

  setSettings(next: Partial<EngineSettings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...next };
    const outputChanged =
      next.output && (next.output.width !== prev.output.width || next.output.height !== prev.output.height);
    if (outputChanged) {
      this.compositor.setSize(this.settings.output);
      if (this.machine.quad) {
        const sx = this.settings.output.width / prev.output.width;
        const sy = this.settings.output.height / prev.output.height;
        this.machine.quad = mapQuad(this.machine.quad, (p) => ({ x: p.x * sx, y: p.y * sy }));
      }
      this.resetFilters();
    }
    if (next.mirror !== undefined && next.mirror !== prev.mirror) {
      this.resetFilters();
      this.assigner.reset();
    }
    if (next.garden && !prev.garden) this.garden.regrow(performance.now());
    if (next.smoothing !== undefined) {
      const params = smoothingToParams(this.settings.smoothing);
      for (const s of SIDES) {
        this.sides[s].index.setParams(params);
        this.sides[s].thumb.setParams(params);
      }
    }
    this.applyGestureSettings();
  }

  private applyGestureSettings() {
    const hand = this.input === 'hand';
    this.machine.setConfig({
      thresholds: hand ? thresholdsForSensitivity(this.settings.sensitivity) : { open: 0.5, close: 0.5 },
      newMemoryOnReopen: this.settings.newMemoryOnReopen,
      // With hands the photo stays visible however small the frame gets.
      hideWhenClosed: !hand,
      lossHoldMs: hand ? 350 : DEFAULT_GESTURE_CONFIG.lossHoldMs,
      lossFadeMs: hand ? 250 : DEFAULT_GESTURE_CONFIG.lossFadeMs,
    });
  }

  setPhotos(photos: PhotoSource[]) {
    this.photos = photos;
    if (this.fromPhoto && !photos.some((p) => p.id === this.fromPhoto!.id)) this.fromPhoto = null;
  }

  /** Select a photograph; crossfades briefly if the portal is visible. */
  selectPhoto(id: string | null) {
    if (id === this.selectedId) return;
    const current = this.currentPhoto();
    if (current && id && this.machine.alpha > 0.05) {
      this.fromPhoto = current;
      this.crossfadeStart = performance.now();
    } else {
      this.fromPhoto = null;
    }
    this.selectedId = id;
  }

  private currentPhoto(): PhotoSource | null {
    return this.photos.find((p) => p.id === this.selectedId) ?? null;
  }

  setCleanMode(clean: boolean) {
    this.clean = clean;
  }

  // ------------------------------------------------------------ source/input

  get sourceKind() {
    return this.source;
  }

  get inputMode() {
    return this.input;
  }

  /** Show the idle preview (no camera, no demo). */
  setIdle() {
    this.stopCamera();
    this.source = 'none';
    this.setInput('mouse');
  }

  startDemo() {
    this.stopCamera();
    this.source = 'backdrop';
    this.demo.open = true;
    this.garden.regrow(performance.now());
    this.setInput('mouse');
  }

  async startCamera(deviceId: string | null): Promise<ActiveCameraSettings> {
    const settings = await this.camera.start(deviceId, this.settings.performance);
    this.source = 'camera';
    this.garden.regrow(performance.now());
    this.watchVideoFrames();
    this.setInput('hand');
    return settings;
  }

  stopCamera() {
    this.camera.stop();
    if (this.source === 'camera') this.source = 'none';
    this.resetTracking();
  }

  setInput(mode: InputMode) {
    this.input = mode;
    this.resetTracking();
    this.applyGestureSettings();
    if (mode === 'hand' && this.source === 'camera') {
      void this.ensureTracker();
    } else {
      this.setHandStatus('off');
    }
  }

  private resetTracking() {
    this.machine.reset();
    this.assigner.reset();
    this.resetFilters();
    for (const s of SIDES) {
      this.sides[s].fingers = null;
      this.sides[s].raw = null;
      this.sides[s].cam = null;
      this.sides[s].held = false;
      this.sides[s].lastSeen = -Infinity;
    }
    this.line = null;
    this.lineAlpha = 0;
    this.borderAlpha = 0;
  }

  /** Reset the close/reopen cycle (e.g. when the user changes something mid-gesture). */
  resetGestureCycle() {
    this.machine.resetCycle();
  }

  private async ensureTracker() {
    if (this.tracker.ready) {
      this.updateHandStatus();
      return;
    }
    const token = ++this.trackerLoadToken;
    this.setHandStatus('loading');
    try {
      const info = await this.tracker.load();
      if (this.disposed || token !== this.trackerLoadToken) return;
      this.trackerInfo = info;
      if (this.input === 'hand') this.setHandStatus('searching');
    } catch (err) {
      if (this.disposed || token !== this.trackerLoadToken) return;
      console.error('[memory portal] hand model failed to load', err);
      this.setHandStatus('failed', err instanceof Error ? err.message : String(err));
    }
  }

  retryTracker() {
    this.tracker.dispose();
    if (this.input === 'hand' && this.source === 'camera') void this.ensureTracker();
  }

  private setHandStatus(status: HandStatus, detail?: string) {
    if (status === this.handStatus) return;
    this.handStatus = status;
    this.callbacks.onHandStatus?.(status, detail);
  }

  private updateHandStatus() {
    if (!(this.input === 'hand' && this.tracker.ready && this.source === 'camera')) return;
    const both = this.machine.tracking === 'tracked';
    const one = !both && (this.sides.left.fingers || this.sides.right.fingers) !== null;
    this.setHandStatus(both ? 'ready' : one ? 'one' : 'searching');
  }

  /**
   * Run inference the moment a new camera frame is decoded
   * (requestVideoFrameCallback fires just before the next paint), so the
   * render that follows always uses landmarks from the newest frame.
   */
  private watchVideoFrames() {
    const video = this.camera.video;
    if (!supportsRvfc(video)) return;
    const onFrame = (now: number) => {
      if (this.disposed || !this.camera.active) return;
      this.rvfcHandle = video.requestVideoFrameCallback(onFrame);
      this.maybeTrack(now);
    };
    if (this.rvfcHandle) video.cancelVideoFrameCallback(this.rvfcHandle);
    this.rvfcHandle = video.requestVideoFrameCallback(onFrame);
  }

  private maybeTrack(now: number) {
    if (this.input !== 'hand' || this.source !== 'camera' || !this.tracker.ready) return;
    const video = this.camera.video;
    if (!video.videoWidth) return;
    const minInterval = this.settings.performance ? 38 : 0;
    if (now - this.lastInference < minInterval) return;
    this.lastInference = now;
    const transform = computeCoverTransform(
      { width: video.videoWidth, height: video.videoHeight },
      this.settings.output,
      this.settings.mirror,
    );
    this.pendingEvents.push(...this.track(video, transform, now));
    this.dbg.lastFrameAt = now;
  }

  private resetFilters() {
    for (const s of SIDES) {
      this.sides[s].index.reset();
      this.sides[s].thumb.reset();
    }
  }

  // ------------------------------------------------------------------- loop

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? clamp(now - this.lastFrame, 0, 100) : 0;
    this.lastFrame = now;

    const output = this.settings.output;
    const video = this.camera.video;
    let transform: CoverTransform | null = null;
    if (this.source === 'camera' && video.videoWidth > 0) {
      transform = computeCoverTransform({ width: video.videoWidth, height: video.videoHeight }, output, this.settings.mirror);
    }

    // Browsers without requestVideoFrameCallback: poll for new frames here.
    if (!supportsRvfc(video) && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.maybeTrack(now);
    }

    const events = this.pendingEvents;
    this.pendingEvents = [];
    if (this.input === 'mouse') {
      events.push(...this.machine.update({ openness: this.demo.open ? 1 : 0, quad: this.demoQuadPx() }, now));
    }
    events.push(...this.machine.tick(now));
    this.handleEvents(events);
    this.updateHandStatus();

    // Portal geometry and opacities for this frame.
    let quad = this.machine.quad;
    let portalAlpha = this.machine.alpha;
    let borderAlpha: number;
    if (this.source === 'none') {
      quad = this.idleTeaserQuad(now);
      portalAlpha = 1;
      borderAlpha = 1;
    } else if (this.input === 'mouse') {
      if (quad) quad = scaleQuad(quad, 0.94 + 0.06 * easeOut(portalAlpha));
      borderAlpha = portalAlpha;
    } else {
      // With hands, the border keeps tracing the fingertips while both hands are visible.
      const m = this.machine;
      if (m.tracking === 'tracked' || m.tracking === 'holding') {
        this.borderAlpha = Math.min(1, this.borderAlpha + dt / BORDER_FADE_IN_MS);
      } else if (m.tracking === 'fading') {
        this.borderAlpha = Math.max(0, this.borderAlpha - dt / m.config.lossFadeMs);
      } else {
        this.borderAlpha = 0;
      }
      borderAlpha = this.borderAlpha;
    }

    // One hand only: a line between its index and thumb.
    const lineTarget = this.input === 'hand' && this.line ? 1 : 0;
    this.lineAlpha = clamp(this.lineAlpha + (lineTarget ? 1 : -1) * (dt / LINE_FADE_MS), 0, 1);

    const photo = this.currentPhoto();
    let crossfade = 1;
    if (this.fromPhoto) {
      crossfade = clamp((now - this.crossfadeStart) / CROSSFADE_MS, 0, 1);
      if (crossfade >= 1) this.fromPhoto = null;
    }

    const background =
      this.source === 'camera'
        ? transform
          ? { kind: 'video' as const, video, transform }
          : null
        : {
            kind: 'image' as const,
            image: this.backdrop,
            transform: computeCoverTransform({ width: this.backdrop.width, height: this.backdrop.height }, output, false),
          };

    this.compositor.render({
      now,
      background,
      dim: this.source === 'none' ? 0.12 : 0,
      quad,
      portalAlpha,
      borderAlpha,
      line: this.lineAlpha > 0 ? this.line : null,
      lineAlpha: this.lineAlpha,
      photo,
      fromPhoto: this.fromPhoto,
      crossfade: easeInOut(crossfade),
      photoMode: this.settings.photoMode,
      followFit: this.settings.followFit,
      border: this.settings.border,
      garden: this.settings.garden ? this.garden : null,
      performance: this.settings.performance,
    });

    if (this.dbg.lastFrameAt) this.dbg.frameToRenderMs = now - this.dbg.lastFrameAt;
    pushRate(this.dbg.renderTimes, now);
    this.drawOverlay(quad);
  };

  private track(video: HTMLVideoElement, transform: CoverTransform, now: number): GestureEvent[] {
    const t0 = performance.now();
    let hands: DetectedHand[];
    try {
      hands = this.tracker.detect(video, now);
    } catch (err) {
      console.error('[memory portal] inference failed', err);
      return this.machine.update(null, now);
    }
    this.dbg.inferMs = performance.now() - t0;
    this.dbg.hands = hands.length;
    this.dbg.labels = hands.map((h) => `${h.handedness[0] ?? '?'}${h.score.toFixed(2)}`).join(' ');
    pushRate(this.dbg.trackTimes, now);

    const assigned = this.assigner.assign(hands, this.settings.mirror, now);
    const H = this.settings.output.height;

    for (const side of SIDES) {
      const st = this.sides[side];
      const hand = assigned[side];
      if (!hand) {
        // Briefly lost (often at the frame edge): hold this hand's corners in place.
        if (st.fingers && now - st.lastSeen < SIDE_HOLD_MS) {
          st.held = true;
          continue;
        }
        st.fingers = null;
        st.raw = null;
        st.cam = null;
        st.held = false;
        continue;
      }
      st.held = false;
      // A hand reappearing after a gap must not glide in from its old position.
      if (now - st.lastSeen > 120) {
        st.index.reset();
        st.thumb.reset();
      }
      st.lastSeen = now;
      const px = toCameraPixels(hand.landmarks, video.videoWidth, video.videoHeight);
      st.cam = { index: px[LM.INDEX_TIP], thumb: px[LM.THUMB_TIP], palm: palmSize(px) };

      const rawIndex = cameraToOutput(hand.landmarks[LM.INDEX_TIP], transform);
      const rawThumb = cameraToOutput(hand.landmarks[LM.THUMB_TIP], transform);
      // Filter in units of output height so smoothing feels the same at any resolution.
      const fi = st.index.filter({ x: rawIndex.x / H, y: rawIndex.y / H }, now);
      const ft = st.thumb.filter({ x: rawThumb.x / H, y: rawThumb.y / H }, now);
      st.raw = { index: rawIndex, thumb: rawThumb };
      st.fingers = { index: { x: fi.x * H, y: fi.y * H }, thumb: { x: ft.x * H, y: ft.y * H } };
    }

    const L = this.sides.left;
    const R = this.sides.right;
    // Need at least one live hand; two held hands means both are gone.
    if (L.fingers && R.fingers && L.cam && R.cam && !(L.held && R.held)) {
      this.line = null;
      const camQuad = quadFromHands(L.cam, R.cam);
      const palm = (L.cam.palm + R.cam.palm) / 2;
      return this.machine.update({ openness: quadOpenness(camQuad, palm), quad: quadFromHands(L.fingers, R.fingers) }, now);
    }
    const left = L.held ? null : L.fingers;
    const right = R.held ? null : R.fingers;
    const single = left ?? right;
    if (single) this.line = { a: single.index, b: single.thumb };
    else this.line = null;
    // Fewer than four fingertips: no portal (tracking loss, never a deliberate closure).
    return this.machine.update(null, now);
  }

  private handleEvents(events: GestureEvent[]) {
    for (const e of events) {
      if (e.type === 'advance' && this.photos.length > 1) {
        const i = this.photos.findIndex((p) => p.id === this.selectedId);
        const next = this.photos[nextIndex(Math.max(0, i), this.photos.length)];
        // The portal is just reopening (alpha ≈ 0), so switch instantly.
        this.fromPhoto = null;
        this.selectedId = next.id;
        this.callbacks.onAdvance?.(next.id);
      }
    }
  }

  private idleTeaserQuad(now: number): Quad {
    const { width: W, height: H } = this.settings.output;
    const t = now / 1000;
    const w = (s: number, f: number) => Math.sin(t * f + s) * Math.min(W, H) * 0.025;
    return {
      tl: { x: W * 0.3 + w(0, 0.9), y: H * 0.2 + w(1, 0.7) },
      tr: { x: W * 0.7 + w(2, 0.8), y: H * 0.22 + w(3, 1.0) },
      br: { x: W * 0.68 + w(4, 0.6), y: H * 0.62 + w(5, 0.9) },
      bl: { x: W * 0.32 + w(6, 1.1), y: H * 0.6 + w(7, 0.75) },
    };
  }

  // ------------------------------------------------------------- demo input

  private demoQuadPx(): Quad {
    const { width: W, height: H } = this.settings.output;
    return mapQuad(this.demo.quad, (p) => ({ x: p.x * W, y: p.y * H }));
  }

  private setDemoQuadPx(q: Quad) {
    const { width: W, height: H } = this.settings.output;
    this.demo.quad = mapQuad(q, (p) => ({ x: clamp(p.x, 0, W) / W, y: clamp(p.y, 0, H) / H }));
  }

  toggleDemoPortal() {
    if (this.input !== 'mouse' || this.source === 'none') return;
    this.demo.open = !this.demo.open;
  }

  get demoOpen() {
    return this.demo.open;
  }

  setDisplaySize(size: Size) {
    this.display = size;
    if (!this.overlay) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(size.width * dpr);
    this.overlay.height = Math.round(size.height * dpr);
  }

  attachOverlay(el: HTMLCanvasElement | null) {
    if (this.overlay) {
      this.overlay.removeEventListener('pointerdown', this.onPointerDown);
      this.overlay.removeEventListener('pointermove', this.onPointerMove);
      this.overlay.removeEventListener('pointerup', this.onPointerUp);
      this.overlay.removeEventListener('pointercancel', this.onPointerUp);
    }
    this.overlay = el;
    this.overlayCtx = el?.getContext('2d') ?? null;
    if (el) {
      el.addEventListener('pointerdown', this.onPointerDown);
      el.addEventListener('pointermove', this.onPointerMove);
      el.addEventListener('pointerup', this.onPointerUp);
      el.addEventListener('pointercancel', this.onPointerUp);
      this.setDisplaySize(this.display);
    }
  }

  private mouseActive() {
    return this.input === 'mouse' && this.source !== 'none';
  }

  private eventToOutput(e: PointerEvent): Point {
    const box = this.overlay!.getBoundingClientRect();
    return elementToOutput({ x: e.clientX - box.left, y: e.clientY - box.top }, this.settings.output, {
      width: box.width,
      height: box.height,
    });
  }

  private handleRadiusOutput() {
    return (HANDLE_CSS_PX * this.settings.output.width) / Math.max(1, this.display.width);
  }

  private hitCorner(p: Point, q: Quad): Corner | null {
    const rad = this.handleRadiusOutput();
    let best: Corner | null = null;
    let bestD = Infinity;
    for (const c of CORNERS) {
      const d = Math.hypot(p.x - q[c].x, p.y - q[c].y);
      if (d <= rad * 1.2 && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.mouseActive() || e.button !== 0) return;
    const p = this.eventToOutput(e);
    const q = this.demoQuadPx();
    const corner = this.demo.open ? this.hitCorner(p, q) : null;
    if (corner) this.drag = { kind: 'corner', corner };
    else if (this.demo.open && pointInQuad(p, q)) this.drag = { kind: 'move', start: p, quad: q };
    else this.drag = { kind: 'draw', anchor: p, previous: q };
    this.overlay?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.mouseActive()) {
      if (this.overlay) this.overlay.style.cursor = '';
      return;
    }
    const p = this.eventToOutput(e);
    if (!this.drag) {
      const q = this.demoQuadPx();
      this.overlay!.style.cursor =
        this.demo.open && this.hitCorner(p, q) ? 'grab' : this.demo.open && pointInQuad(p, q) ? 'move' : 'crosshair';
      return;
    }
    if (this.drag.kind === 'move') {
      const d = this.drag;
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      this.setDemoQuadPx(mapQuad(d.quad, (c) => ({ x: c.x + dx, y: c.y + dy })));
    } else if (this.drag.kind === 'corner') {
      this.setDemoQuadPx({ ...this.demoQuadPx(), [this.drag.corner]: p });
    } else {
      const a = this.drag.anchor;
      this.setDemoQuadPx(
        rectToQuad({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }),
      );
      this.demo.open = true;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag) return;
    if (this.drag.kind === 'draw') {
      const pts = quadPoints(this.demoQuadPx());
      const min = this.handleRadiusOutput() * 2;
      const w = Math.abs(pts[1].x - pts[0].x);
      const h = Math.abs(pts[3].y - pts[0].y);
      // A click without a real drag keeps the previous portal.
      if (w < min || h < min) this.setDemoQuadPx(this.drag.previous);
    }
    this.drag = null;
    this.overlay?.releasePointerCapture?.(e.pointerId);
  };

  // ---------------------------------------------------------- debug overlay

  private drawOverlay(quad: Quad | null) {
    const ctx = this.overlayCtx;
    const el = this.overlay;
    if (!ctx || !el) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    if (this.clean) return;
    const sx = el.width / this.settings.output.width;
    const sy = el.height / this.settings.output.height;
    const dpr = el.width / Math.max(1, this.display.width);
    const toEl = (p: Point) => ({ x: p.x * sx, y: p.y * sy });

    // Demo corner handles.
    if (this.mouseActive() && this.demo.open && this.machine.alpha > 0.5) {
      const q = this.demoQuadPx();
      ctx.save();
      for (const c of CORNERS) {
        const p = toEl(q[c]);
        ctx.fillStyle = 'rgba(255, 214, 64, 0.95)';
        ctx.strokeStyle = 'rgba(42, 79, 150, 0.95)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    if (!this.settings.debug) return;
    ctx.save();
    const showQuad = this.input !== 'hand' || this.machine.tracking !== 'searching';
    if (quad && showQuad) {
      const pts = quadPoints(quad).map(toEl);
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.9)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    const fs = 11 * dpr;
    ctx.font = `${fs}px ui-monospace, "SF Mono", Menlo, monospace`;
    const dot = (p: Point | undefined, color: string, r: number, label?: string) => {
      if (!p) return;
      const e = toEl(p);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * dpr, 0, Math.PI * 2);
      ctx.fill();
      if (label) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(label, e.x + 8 * dpr, e.y - 6 * dpr);
      }
    };
    if (this.input === 'hand') {
      for (const side of SIDES) {
        const st = this.sides[side];
        const tag = side === 'left' ? 'L' : 'R';
        dot(st.raw?.index, 'rgba(255,255,255,0.45)', 3);
        dot(st.raw?.thumb, 'rgba(255,255,255,0.45)', 3);
        dot(st.fingers?.index, side === 'left' ? 'rgb(255,90,140)' : 'rgb(80,170,255)', 5, `${tag} index`);
        dot(st.fingers?.thumb, side === 'left' ? 'rgb(255,170,60)' : 'rgb(120,220,120)', 5, `${tag} thumb`);
      }
    }

    const m = this.machine;
    const th = m.config.thresholds;
    const lines = [
      `source ${this.source} · input ${this.input} · hands ${this.handStatus}`,
      `tracking ${m.tracking} · portal ${m.pinch} · cycle ${m.cycle}`,
      `openness ${m.openness.toFixed(2)}  (open ≥ ${th.open.toFixed(2)}, close ≤ ${th.close.toFixed(2)})`,
      `detected ${this.dbg.hands} [${this.dbg.labels}] · alpha ${m.alpha.toFixed(2)}`,
      `render ${rate(this.dbg.renderTimes)} fps · track ${rate(this.dbg.trackTimes)} Hz · infer ${this.dbg.inferMs.toFixed(1)} ms · frame→paint ${this.dbg.frameToRenderMs.toFixed(0)} ms`,
      `output ${this.settings.output.width}×${this.settings.output.height} · camera ${this.camera.video.videoWidth}×${this.camera.video.videoHeight}` +
        (this.trackerInfo ? ` · ${this.trackerInfo.delegate}` : ''),
    ];
    const pad = 8 * dpr;
    const lh = fs * 1.45;
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    ctx.fillStyle = 'rgba(30, 55, 110, 0.78)';
    ctx.fillRect(pad, pad, boxW, lh * lines.length + pad * 1.4);
    ctx.fillStyle = 'rgba(235, 240, 235, 0.92)';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, pad * 2, pad * 1.7 + i * lh));
    ctx.restore();
  }

  // --------------------------------------------------------------- teardown

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.rvfcHandle && supportsRvfc(this.camera.video)) {
      this.camera.video.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.attachOverlay(null);
    this.camera.destroy();
    this.tracker.dispose();
  }
}

/** requestVideoFrameCallback lets us run inference exactly once per new camera frame. */
function supportsRvfc(video: HTMLVideoElement): boolean {
  return typeof video.requestVideoFrameCallback === 'function';
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function pushRate(times: number[], now: number) {
  times.push(now);
  while (times.length && now - times[0] > 1000) times.shift();
}

function rate(times: number[]) {
  return times.length;
}

