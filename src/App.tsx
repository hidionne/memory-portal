import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CameraController, CameraError, looksBuiltIn, type CameraErrorKind } from './engine/camera';
import { isProbablyImage, loadPhotoFile, releasePhoto, type Photo } from './engine/photos';
import { PortalEngine, type HandStatus, type SourceKind } from './engine/PortalEngine';
import { CanvasRecorder, recordingSupport, type RecordingResult } from './engine/recorder';
import { nextIndex, prevIndex } from './lib/gestureMachine';
import { fitAspect } from './lib/mapping';
import { aspectValue, loadDeviceId, loadSettings, toEngineSettings } from './settings';

/**
 * Plain version: one TouchDesigner-style viewer node. A column of square
 * buttons (camera, record, photos, fullscreen), thin status bars and the node
 * name underneath. No decorations on the video.
 */

type CameraPhase = { phase: 'off' } | { phase: 'starting' } | { phase: 'on' } | { phase: 'error'; kind: CameraErrorKind; message: string };
type RecPhase = { phase: 'idle' } | { phase: 'starting' } | { phase: 'recording'; startedAt: number; withAudio: boolean };

const CAMERA_ERRORS: Record<CameraErrorKind, string> = {
  denied: 'camera blocked: allow it from the address bar, then try again',
  unavailable: 'no camera found',
  'in-use': 'camera busy: close FaceTime / Zoom / Photo Booth and try again',
  insecure: 'camera needs https or localhost',
  unknown: 'camera could not start',
};

const HAND_LABEL: Record<HandStatus, string> = {
  off: 'tracking off',
  loading: 'loading hand model…',
  failed: 'hand model failed to load',
  searching: 'hands 0',
  one: 'hands 1',
  ready: 'hands 2',
};

const fullscreenSupported =
  typeof document !== 'undefined' &&
  !!(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

export default function App() {
  const settings = useMemo(loadSettings, []);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<SourceKind>('none');
  const [camera, setCamera] = useState<CameraPhase>({ phase: 'off' });
  const [hand, setHand] = useState<HandStatus>('off');
  const [rec, setRec] = useState<RecPhase>({ phase: 'idle' });
  const [recResult, setRecResult] = useState<RecordingResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [display, setDisplay] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<PortalEngine | null>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const photosRef = useRef<Photo[]>([]);
  const noticeTimer = useRef<number | null>(null);
  photosRef.current = photos;

  const recordSupport = useMemo(recordingSupport, []);

  const notify = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 7000);
  }, []);

  // ------------------------------------------------------------- engine

  useEffect(() => {
    const engine = new PortalEngine(canvasRef.current!, toEngineSettings(settings), {
      onHandStatus: (status) => setHand(status),
      onAdvance: (id) => setSelectedId(id),
      onCameraEnded: () => {
        engine.setIdle();
        setSource('none');
        setCamera({ phase: 'error', kind: 'unavailable', message: 'The camera was disconnected.' });
      },
    });
    engine.attachOverlay(overlayRef.current);
    engineRef.current = engine;
    recorderRef.current = new CanvasRecorder();
    return () => {
      recorderRef.current?.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, [settings]);

  useEffect(() => {
    engineRef.current?.setPhotos(photos);
  }, [photos]);

  useEffect(() => {
    engineRef.current?.selectPhoto(selectedId);
  }, [selectedId, photos]);

  useEffect(() => () => photosRef.current.forEach(releasePhoto), []);

  // Size the canvas to the output aspect inside the viewer.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const box = fitAspect({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }, aspectValue(settings.aspect));
      const size = { width: Math.floor(box.width), height: Math.floor(box.height) };
      setDisplay(size);
      engineRef.current?.setDisplaySize(size);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.aspect]);

  // ------------------------------------------------------------- photos

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const images = list.filter(isProbablyImage);
      if (images.length < list.length) notify(`${list.length - images.length} file(s) skipped: not an image`);
      for (const file of images) {
        setLoadingCount((c) => c + 1);
        try {
          const photo = await loadPhotoFile(file);
          setPhotos((prev) => [...prev, photo]);
          setSelectedId((id) => id ?? photo.id);
        } catch (err) {
          notify(err instanceof Error ? err.message : `couldn’t load ${file.name}`);
        } finally {
          setLoadingCount((c) => c - 1);
        }
      }
    },
    [notify],
  );

  const clearPhotos = useCallback(() => {
    const prev = photosRef.current;
    setPhotos([]);
    setSelectedId(null);
    window.setTimeout(() => prev.forEach(releasePhoto), 500);
  }, []);

  const step = useCallback((dir: 1 | -1) => {
    const list = photosRef.current;
    if (list.length < 2) return;
    setSelectedId((sel) => {
      const i = Math.max(0, list.findIndex((p) => p.id === sel));
      return list[dir === 1 ? nextIndex(i, list.length) : prevIndex(i, list.length)].id;
    });
  }, []);

  // ------------------------------------------------------------- camera

  const startCamera = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setCamera({ phase: 'starting' });
    try {
      const remembered = loadDeviceId();
      const info = await engine.startCamera(remembered);
      // Prefer the MacBook's own camera over e.g. Continuity Camera.
      if (!remembered && !looksBuiltIn(info.label)) {
        const builtIn = (await CameraController.listCameras()).find((c) => looksBuiltIn(c.label));
        if (builtIn && builtIn.deviceId !== info.deviceId) await engine.startCamera(builtIn.deviceId);
      }
      setSource('camera');
      setCamera({ phase: 'on' });
    } catch (err) {
      engine.setIdle();
      setSource('none');
      const e = err instanceof CameraError ? err : new CameraError('unknown', String(err));
      setCamera({ phase: 'error', kind: e.kind, message: e.message });
    }
  }, []);

  const stopCamera = useCallback(() => {
    engineRef.current?.setIdle();
    setSource('none');
    setCamera({ phase: 'off' });
  }, []);

  const toggleCamera = useCallback(() => {
    if (camera.phase === 'starting') return;
    if (source === 'camera') stopCamera();
    else void startCamera();
  }, [camera.phase, source, startCamera, stopCamera]);

  // ---------------------------------------------------------- recording

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      const result = await recorder.stop();
      setRecResult((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return result;
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'recording failed');
    } finally {
      setRec({ phase: 'idle' });
    }
  }, [notify]);

  const startRecording = useCallback(async () => {
    const engine = engineRef.current;
    const recorder = recorderRef.current;
    if (!engine || !recorder) return;
    setRec({ phase: 'starting' });
    // Record your voice too; carry on without it if the mic is refused.
    let mic: MediaStream | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
    } catch {
      notify('no mic access: recording video only');
    }
    try {
      recorder.start(engine.compositor.canvas, 30, settings.performance ? 6_000_000 : 12_000_000, mic);
      setRec({ phase: 'recording', startedAt: Date.now(), withAudio: !!mic });
    } catch (err) {
      setRec({ phase: 'idle' });
      notify(`recording couldn’t start: ${err instanceof Error ? err.message : err}`);
    }
  }, [settings.performance, notify]);

  const canRecord = recordSupport.supported && source === 'camera';

  const toggleRecord = useCallback(() => {
    if (rec.phase === 'recording') void stopRecording();
    else if (rec.phase === 'idle' && canRecord) void startRecording();
  }, [rec.phase, canRecord, startRecording, stopRecording]);

  // ------------------------------------------------------- fullscreen/keys

  const toggleFullscreen = useCallback(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else if (root.requestFullscreen) {
      void root.requestFullscreen().catch(() => notify('fullscreen was blocked by the browser'));
    } else {
      root.webkitRequestFullscreen?.();
    }
  }, [notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'c') toggleCamera();
      else if (k === 'r') toggleRecord();
      else if (k === 'f' && fullscreenSupported) toggleFullscreen();
      else if (k === 'arrowright') step(1);
      else if (k === 'arrowleft') step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCamera, toggleRecord, toggleFullscreen, step]);

  // --------------------------------------------------------- drag & drop

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (e.relatedTarget === null || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };

  // ------------------------------------------------------------- render

  const cameraLabel =
    camera.phase === 'starting'
      ? 'camera starting…'
      : camera.phase === 'error'
        ? CAMERA_ERRORS[camera.kind]
        : source === 'camera'
          ? HAND_LABEL[hand]
          : 'camera off';
  const selectedIndex = photos.findIndex((p) => p.id === selectedId);
  const photoLabel = photos.length
    ? `photo ${selectedIndex + 1}/${photos.length}${loadingCount ? ` · loading ${loadingCount}` : ''}`
    : loadingCount
      ? `loading ${loadingCount}`
      : 'no photos · green screen';

  return (
    <div className="app" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="node">
        <div className="bar">
          <span className={`cell ${camera.phase === 'error' || hand === 'failed' ? 'is-bad' : ''}`}>{cameraLabel}</span>
          <span className="cell">
            {rec.phase === 'recording' ? (
              <span className="is-rec">
                ● rec <RecTimer startedAt={rec.startedAt} />
                {rec.withAudio ? ' · mic' : ''}
              </span>
            ) : (
              photoLabel
            )}
          </span>
        </div>

        <div className="body">
          <nav className="tools" aria-label="Controls">
            <ToolButton label={source === 'camera' ? 'Camera off (C)' : 'Camera on (C)'} active={source === 'camera'} onClick={toggleCamera} disabled={camera.phase === 'starting'}>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" className="fill" /></svg>
            </ToolButton>
            <ToolButton
              label={
                !recordSupport.supported
                  ? `Recording unavailable: ${recordSupport.reason}`
                  : rec.phase === 'recording'
                    ? 'Stop recording (R)'
                    : source === 'camera'
                      ? 'Record (R)'
                      : 'Turn the camera on to record'
              }
              active={rec.phase === 'recording'}
              rec
              onClick={toggleRecord}
              disabled={!canRecord && rec.phase === 'idle'}
            >
              {rec.phase === 'recording' ? (
                <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" className="fill" /></svg>
              ) : (
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" className="fill" /></svg>
              )}
            </ToolButton>
            <ToolButton label="Add photos (or drop them on the viewer)" onClick={() => fileRef.current?.click()}>
              <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" /><path d="M4 16l5-5 4 4 2-2 5 5" /></svg>
            </ToolButton>
            <ToolButton label="Clear photos" onClick={clearPhotos} disabled={!photos.length}>
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </ToolButton>
            {fullscreenSupported && (
              <ToolButton label="Fullscreen (F)" onClick={toggleFullscreen}>
                <svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
              </ToolButton>
            )}
          </nav>

          <main className="viewer" ref={stageRef}>
            <div className="canvas-box" style={{ width: display.width, height: display.height }}>
              <canvas ref={canvasRef} className="output" aria-label="Camera and portal output" />
              <canvas ref={overlayRef} className="overlay" />
              {source === 'none' && (
                <button type="button" className="viewer-msg" onClick={() => void startCamera()} disabled={camera.phase === 'starting'}>
                  {camera.phase === 'starting' ? 'waiting for camera permission…' : camera.phase === 'error' ? `${CAMERA_ERRORS[camera.kind]} · click to retry` : 'click to start camera'}
                </button>
              )}
              {hand === 'failed' && source === 'camera' && (
                <button type="button" className="viewer-msg" onClick={() => engineRef.current?.retryTracker()}>
                  hand model failed to load · click to retry
                </button>
              )}
            </div>
            {dragOver && <div className="dropzone">drop photos</div>}
          </main>
        </div>

        <div className="bar">
          <span className="cell">{notice ?? 'two hands: index fingers top, thumbs bottom · pinch shut, reopen = next photo'}</span>
          <span className="cell">
            {recResult ? (
              <>
                {(recResult.durationMs / 1000).toFixed(1)}s · {(recResult.blob.size / 1e6).toFixed(1)} MB ·{' '}
                <a href={recResult.url} download={recResult.filename}>
                  save .{recResult.extension}
                </a>
              </>
            ) : (
              'R record · C camera · F fullscreen · ←/→ photo'
            )}
          </span>
        </div>

        <div className="name">
          <span>portal</span>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function ToolButton({
  label,
  active,
  rec,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  rec?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool ${active ? 'is-active' : ''} ${rec ? 'tool-rec' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RecTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span aria-live="off">
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}
