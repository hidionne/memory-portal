import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CameraController, CameraError, looksBuiltIn, type ActiveCameraSettings, type CameraErrorKind, type CameraInfo } from './engine/camera';
import { createSamplePhotos, isProbablyImage, loadPhotoFile, releasePhoto, type Photo } from './engine/photos';
import { PortalEngine, type HandStatus, type InputMode, type SourceKind } from './engine/PortalEngine';
import { CanvasRecorder, recordingSupport, type RecordingResult } from './engine/recorder';
import { nextIndex, prevIndex } from './lib/gestureMachine';
import { fitAspect } from './lib/mapping';
import type { Framing } from './lib/photoFraming';
import { aspectValue, loadDeviceId, loadSettings, saveDeviceId, saveSettings, toEngineSettings, type UISettings } from './settings';
import { createSky } from './engine/sky';
import { Icon } from './ui/controls';
import { CameraTab, PhotosTab, PortalTab } from './ui/Tabs';
import { useShortcuts } from './ui/useShortcuts';

type CameraPhase = { phase: 'off' } | { phase: 'starting' } | { phase: 'on' } | { phase: 'error'; kind: CameraErrorKind; message: string };
type DrawerTab = 'photos' | 'portal' | 'camera';
type RecPhase = { phase: 'idle' } | { phase: 'countdown'; count: number } | { phase: 'recording'; startedAt: number };

const CAMERA_ERROR_COPY: Record<CameraErrorKind, { title: string; body: string }> = {
  denied: {
    title: 'Camera access is blocked',
    body: 'Allow the camera from the icon in the address bar (or System Settings › Privacy & Security › Camera for your browser), then try again.',
  },
  unavailable: {
    title: 'No camera found',
    body: 'Connect a camera, or check that your browser can see one. You can still use the mouse demo.',
  },
  'in-use': {
    title: 'Camera is busy',
    body: 'Another app may be using it (FaceTime, Zoom, Photo Booth). Close it and try again.',
  },
  insecure: {
    title: 'Camera needs a secure page',
    body: 'Open the site over HTTPS or on localhost.',
  },
  unknown: {
    title: 'Camera could not start',
    body: 'Something went wrong starting the camera.',
  },
};

/** The title, each letter in a different crayon. */
const WORDMARK = [...'memory portal'].map((ch, i) => [
  ch,
  ['#f0559c', '#ff8f2e', '#3b86de', '#47a84a', '#9653d3', '#e4463a'][i % 6],
]);

const fullscreenSupported =
  typeof document !== 'undefined' &&
  !!(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

export default function App() {
  const [settings, setSettings] = useState<UISettings>(loadSettings);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const [source, setSource] = useState<SourceKind>('none');
  const [inputMode, setInputMode] = useState<InputMode>('mouse');
  const [camera, setCamera] = useState<CameraPhase>({ phase: 'off' });
  const [cameraInfo, setCameraInfo] = useState<ActiveCameraSettings | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [hand, setHand] = useState<{ status: HandStatus; detail: string | null }>({ status: 'off', detail: null });
  const [clean, setClean] = useState(false);
  /** Which side drawer is open; null = just the portal. */
  const [tab, setTab] = useState<DrawerTab | null>(null);
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
  const samplesRequested = useRef(false);
  const noticeId = useRef(0);
  const countdownTimer = useRef<number | null>(null);
  photosRef.current = photos;

  const recordSupport = useMemo(recordingSupport, []);
  /** Crayon sky painted once and used as the frame around the video. */
  const skyUrl = useMemo(() => createSky(1600, 1000, 11).toDataURL('image/jpeg', 0.86), []);
  const selected = photos.find((p) => p.id === selectedId) ?? null;

  const notify = useCallback((text: string) => {
    const id = ++noticeId.current;
    setNotices((n) => [...n, { id, text }]);
    window.setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 7000);
  }, []);

  // ------------------------------------------------------------- engine

  useEffect(() => {
    const engine = new PortalEngine(canvasRef.current!, toEngineSettings(loadSettings()), {
      onHandStatus: (status, detail) => setHand({ status, detail: detail ?? null }),
      onAdvance: (id) => setSelectedId(id),
      onCameraEnded: () => {
        engine.setIdle();
        setSource('none');
        setInputMode('mouse');
        setCamera({ phase: 'error', kind: 'unavailable', message: 'The camera was disconnected.' });
      },
    });
    engine.attachOverlay(overlayRef.current);
    engineRef.current = engine;    recorderRef.current = new CanvasRecorder();
    return () => {
      recorderRef.current?.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setSettings(toEngineSettings(settings));
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    engineRef.current?.setPhotos(photos);
  }, [photos]);

  useEffect(() => {
    engineRef.current?.selectPhoto(selectedId);
  }, [selectedId, photos]);

  useEffect(() => {
    engineRef.current?.setCleanMode(clean);
  }, [clean]);

  // Sample memories so the tool can be tried immediately.
  useEffect(() => {
    if (samplesRequested.current) return;
    samplesRequested.current = true;
    void createSamplePhotos().then((samples) => {
      setPhotos((prev) => [...prev, ...samples]);
      setSelectedId((id) => id ?? samples[0]?.id ?? null);
    });
  }, []);

  // Release all photo resources on unmount.
  useEffect(() => () => photosRef.current.forEach(releasePhoto), []);

  // Size the canvas element to the exact output aspect inside the stage.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const pad = clean ? 0 : 46;
      const box = fitAspect(
        { width: Math.max(1, el.clientWidth - pad * 2), height: Math.max(1, el.clientHeight - pad * 2) },
        aspectValue(settings.aspect),
      );
      const size = { width: Math.floor(box.width), height: Math.floor(box.height) };
      setDisplay(size);
      engineRef.current?.setDisplaySize(size);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.aspect, clean]);

  const update = useCallback((patch: Partial<UISettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  // ------------------------------------------------------------- photos

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const images = list.filter(isProbablyImage);
      if (images.length < list.length) notify(`${list.length - images.length} file(s) skipped: not an image.`);
      let firstNew: string | null = null;
      for (const file of images) {
        setLoadingCount((c) => c + 1);
        try {
          const photo = await loadPhotoFile(file);
          firstNew ??= photo.id;
          setPhotos((prev) => [...prev, photo]);
        } catch (err) {
          notify(err instanceof Error ? err.message : `Couldn’t load ${file.name}.`);
        } finally {
          setLoadingCount((c) => c - 1);
        }
      }
      if (firstNew) setSelectedId(firstNew);
    },
    [notify],
  );

  const removePhoto = useCallback((id: string) => {
    const prev = photosRef.current;
    const i = prev.findIndex((p) => p.id === id);
    if (i < 0) return;
    const next = prev.filter((p) => p.id !== id);
    setPhotos(next);
    setSelectedId((sel) => (sel === id ? (next[Math.min(i, next.length - 1)]?.id ?? null) : sel));
    // Release after the engine has switched away from it (and any crossfade ends).
    window.setTimeout(() => releasePhoto(prev[i]), 500);
  }, []);

  const removeSamples = useCallback(() => {
    const prev = photosRef.current;
    const keep = prev.filter((p) => !p.sample);
    setPhotos(keep);
    setSelectedId((sel) => (keep.some((p) => p.id === sel) ? sel : (keep[0]?.id ?? null)));
    window.setTimeout(() => prev.filter((p) => p.sample).forEach(releasePhoto), 500);
  }, []);

  const movePhoto = useCallback((id: string, delta: -1 | 1) => {
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const step = useCallback((dir: 1 | -1) => {
    const list = photosRef.current;
    if (list.length < 2) return;
    setSelectedId((sel) => {
      const i = Math.max(0, list.findIndex((p) => p.id === sel));
      return list[dir === 1 ? nextIndex(i, list.length) : prevIndex(i, list.length)].id;
    });
  }, []);

  const setFraming = useCallback(
    (framing: Framing) => {
      if (!selectedId) return;
      setPhotos((prev) => prev.map((p) => (p.id === selectedId ? { ...p, framing } : p)));
    },
    [selectedId],
  );

  // ------------------------------------------------------------- camera

  const startCamera = useCallback(async (explicitId?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    setCamera({ phase: 'starting' });
    try {
      const remembered = explicitId ?? loadDeviceId();
      let info = await engine.startCamera(remembered);
      let list = await CameraController.listCameras();
      // Prefer the MacBook's own camera over e.g. Continuity Camera unless the user chose otherwise.
      if (!remembered && !looksBuiltIn(info.label)) {
        const builtIn = list.find((c) => looksBuiltIn(c.label));
        if (builtIn && builtIn.deviceId !== info.deviceId) info = await engine.startCamera(builtIn.deviceId);
        list = await CameraController.listCameras();
      }
      if (explicitId) saveDeviceId(explicitId);
      setCameras(list);
      setCameraInfo(info);
      setSource('camera');
      setInputMode('hand');
      setCamera({ phase: 'on' });
    } catch (err) {
      engine.setIdle();
      setSource('none');
      setInputMode('mouse');
      const e = err instanceof CameraError ? err : new CameraError('unknown', String(err));
      setCamera({ phase: 'error', kind: e.kind, message: e.message });
    }
  }, []);

  const stopCamera = useCallback(() => {
    engineRef.current?.setIdle();
    setSource('none');
    setInputMode('mouse');
    setCamera({ phase: 'off' });
    setCameraInfo(null);
  }, []);

  const startDemo = useCallback(() => {
    engineRef.current?.startDemo();
    setSource('backdrop');
    setInputMode('mouse');
    setCamera({ phase: 'off' });
    setCameraInfo(null);
  }, []);

  const changeInput = useCallback((mode: InputMode) => {
    engineRef.current?.setInput(mode);
    setInputMode(mode);
  }, []);

  // Restart the camera at the new resolution when performance mode changes.
  const perfRef = useRef(settings.performance);
  useEffect(() => {
    if (perfRef.current === settings.performance) return;
    perfRef.current = settings.performance;
    if (source === 'camera' && cameraInfo) void startCamera(cameraInfo.deviceId);
  }, [settings.performance, source, cameraInfo, startCamera]);

  useEffect(() => {
    if (source !== 'camera' || !navigator.mediaDevices) return;
    const refresh = () => void CameraController.listCameras().then(setCameras);
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [source]);

  // ---------------------------------------------------------- recording

  const beginRecording = useCallback(() => {
    const engine = engineRef.current;
    const recorder = recorderRef.current;
    if (!engine || !recorder) return;
    try {
      recorder.start(engine.compositor.canvas, 30, settings.performance ? 6_000_000 : 12_000_000);
      setRec({ phase: 'recording', startedAt: Date.now() });
    } catch (err) {
      setRec({ phase: 'idle' });
      notify(`Recording couldn’t start: ${err instanceof Error ? err.message : err}. Try macOS screen recording (⇧⌘5) with clean mode.`);
    }
  }, [settings.performance, notify]);

  const cancelCountdown = () => {
    if (countdownTimer.current) window.clearInterval(countdownTimer.current);
    countdownTimer.current = null;
  };

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
      notify(err instanceof Error ? err.message : 'Recording failed.');
    } finally {
      setRec({ phase: 'idle' });
    }
  }, [notify]);

  const canRecord = recordSupport.supported && source !== 'none';

  const toggleRecord = useCallback(() => {
    if (rec.phase === 'recording') {
      void stopRecording();
      return;
    }
    if (rec.phase === 'countdown') {
      cancelCountdown();
      setRec({ phase: 'idle' });
      return;
    }
    if (!canRecord) return;
    if (!settings.countdown) {
      beginRecording();
      return;
    }
    let count = 3;
    setRec({ phase: 'countdown', count });
    countdownTimer.current = window.setInterval(() => {
      count -= 1;
      if (count <= 0) {
        cancelCountdown();
        beginRecording();
      } else {
        setRec({ phase: 'countdown', count });
      }
    }, 1000);
  }, [rec.phase, canRecord, settings.countdown, beginRecording, stopRecording]);

  useEffect(() => () => cancelCountdown(), []);

  const discardRecording = () => {
    setRecResult((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  };

  // ------------------------------------------------------- clean/fullscreen

  const toggleFullscreen = useCallback(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else if (root.requestFullscreen) {
      void root.requestFullscreen().catch(() => notify('Fullscreen was blocked by the browser.'));
    } else {
      root.webkitRequestFullscreen?.();
    }
  }, [notify]);

  useShortcuts({
    prev: () => step(-1),
    next: () => step(1),
    toggleClean: () => setClean((c) => !c),
    toggleDebug: () => update({ debug: !settings.debug }),
    exitClean: () => (clean ? setClean(false) : setTab(null)),
    togglePortal: () => engineRef.current?.toggleDemoPortal(),
    toggleRecord,
    toggleFullscreen: () => fullscreenSupported && toggleFullscreen(),
  });

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

  // ------------------------------------------------------------- status

  const status = useMemo((): { label: string; tone: 'idle' | 'ok' | 'wait' | 'bad' } => {
    if (camera.phase === 'starting') return { label: 'Requesting camera…', tone: 'wait' };
    if (camera.phase === 'error') return { label: CAMERA_ERROR_COPY[camera.kind].title, tone: 'bad' };
    if (source === 'backdrop') return { label: 'Mouse demo', tone: 'ok' };
    if (source === 'camera') {
      if (inputMode === 'mouse') return { label: 'Camera · mouse control', tone: 'ok' };
      switch (hand.status) {
        case 'loading':
          return { label: 'Loading hand model…', tone: 'wait' };
        case 'failed':
          return { label: 'Hand model failed to load', tone: 'bad' };
        case 'searching':
          return { label: 'No hands yet', tone: 'idle' };
        case 'one':
          return { label: 'One hand — bring the other one in', tone: 'wait' };
        case 'ready':
          return { label: 'Both hands — ready!', tone: 'ok' };
        default:
          return { label: 'Camera on', tone: 'ok' };
      }
    }
    return { label: 'Camera not started', tone: 'idle' };
  }, [camera, source, inputMode, hand.status]);

  const hint =
    source === 'backdrop' || (source === 'camera' && inputMode === 'mouse')
      ? 'Drag the corners anywhere · drag inside to move · drag empty space to draw · Space opens/closes'
      : source === 'camera' && (hand.status === 'searching' || hand.status === 'one')
        ? 'Make a frame with both hands: index fingers on top, thumbs underneath.'
        : source === 'camera' && hand.status === 'loading'
          ? 'Loading the hand model…'
          : null;

  const hideCursor = clean && source === 'camera' && inputMode === 'hand';

  const toggleTab = (t: DrawerTab) => setTab((cur) => (cur === t ? null : t));
  const TABS: { id: DrawerTab; label: string }[] = [
    { id: 'photos', label: 'photos' },
    { id: 'portal', label: 'portal' },
    { id: 'camera', label: 'camera' },
  ];

  return (
    <div className={`app ${clean ? 'is-clean' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {!clean && (
        <header className="title">
          <span className="wordmark" aria-label="memory portal">
            {WORDMARK.map(([ch, color], i) => (
              <span key={i} aria-hidden="true" style={{ color }}>
                {ch === ' ' ? '\u00a0' : ch}
              </span>
            ))}
          </span>
          <span className={`status status-${status.tone}`} role="status" aria-live="polite">
            <span className="status-dot" />
            {status.label}
          </span>
        </header>
      )}

      <main
        className="stage"
        ref={stageRef}
        style={{ backgroundImage: `url(${skyUrl})`, cursor: hideCursor ? 'none' : undefined }}
      >
        <div className="canvas-box" style={{ width: display.width, height: display.height }}>
          <canvas ref={canvasRef} className="output" aria-label="Composited camera and portal preview" />
          <canvas ref={overlayRef} className="overlay" style={hideCursor ? { cursor: 'none' } : undefined} />

          {!clean && source === 'none' && (
            <div className="stage-card">
              {camera.phase === 'error' ? (
                <>
                  <h1 className="card-title">{CAMERA_ERROR_COPY[camera.kind].title}</h1>
                  <p className="card-body">{CAMERA_ERROR_COPY[camera.kind].body}</p>
                  {camera.kind === 'unknown' && <p className="card-detail">{camera.message}</p>}
                </>
              ) : (
                <p className="card-lede">make a little frame with both hands — pointy fingers on top, thumbs underneath — and open a memory!</p>
              )}
              <div className="card-actions">
                <button type="button" className="btn btn-accent" onClick={() => void startCamera()} disabled={camera.phase === 'starting'}>
                  {camera.phase === 'starting' ? 'waiting for permission…' : camera.phase === 'error' ? 'try again' : 'start camera'}
                </button>
                <button type="button" className="btn" onClick={startDemo}>
                  try with the mouse
                </button>
              </div>
              <p className="card-foot">your camera and photos stay on this computer</p>
            </div>
          )}

          {!clean && source === 'camera' && inputMode === 'hand' && hand.status === 'failed' && (
            <div className="stage-banner" role="alert">
              <span>The hand-tracking model couldn’t load.{hand.detail ? ` (${hand.detail})` : ''}</span>
              <button type="button" className="btn btn-small" onClick={() => engineRef.current?.retryTracker()}>
                retry
              </button>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => changeInput('mouse')}>
                use mouse
              </button>
            </div>
          )}

          {!clean && hint && <div className="stage-hint">{hint}</div>}

          {rec.phase === 'countdown' && (
            <div className="countdown" aria-live="assertive">
              <span key={rec.count}>{rec.count}</span>
            </div>
          )}
        </div>
        {clean && rec.phase === 'recording' && <span className="clean-rec-dot" aria-label="Recording" />}
      </main>

      {!clean && (
        <nav className="rail" aria-label="Tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tag tag-${t.id} ${tab === t.id ? 'is-open' : ''}`}
              aria-expanded={tab === t.id}
              aria-controls="drawer"
              onClick={() => toggleTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <div className="rail-gap" />
          <button
            type="button"
            className={`tag tag-rec ${rec.phase !== 'idle' ? 'is-open' : ''}`}
            onClick={toggleRecord}
            disabled={!canRecord && rec.phase === 'idle'}
            title={
              recordSupport.supported
                ? source === 'none'
                  ? 'Start the camera or demo to record'
                  : 'Record (R)'
                : `Recording unavailable: ${recordSupport.reason}`
            }
          >
            <span className="rec-dot" />
            {rec.phase === 'recording' ? <RecTimer startedAt={rec.startedAt} /> : rec.phase === 'countdown' ? 'cancel' : 'record'}
          </button>
          <button type="button" className="tag tag-hide" onClick={() => setClean(true)} title="Hide everything (H) — Esc to come back">
            hide
          </button>
        </nav>
      )}

      {!clean && tab && (
        <aside id="drawer" className={`drawer drawer-${tab}`} aria-label={`${tab} settings`}>
          <button type="button" className="drawer-close" onClick={() => setTab(null)} aria-label="Close">
            <Icon name="close" />
          </button>
          {tab === 'photos' && (
            <PhotosTab
              settings={settings}
              update={update}
              photos={photos}
              selectedId={selectedId}
              selected={selected}
              loading={loadingCount}
              onSelect={setSelectedId}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onMove={movePhoto}
              onRemove={removePhoto}
              onAdd={() => fileRef.current?.click()}
              onFraming={setFraming}
              onRemoveSamples={removeSamples}
            />
          )}
          {tab === 'portal' && (
            <PortalTab settings={settings} update={update} source={source} inputMode={inputMode} onInputMode={changeInput} />
          )}
          {tab === 'camera' && (
            <CameraTab
              settings={settings}
              update={update}
              source={source}
              cameraBusy={camera.phase === 'starting'}
              cameras={cameras}
              cameraInfo={cameraInfo}
              onStartCamera={() => void startCamera()}
              onStopCamera={stopCamera}
              onSelectCamera={(id) => void startCamera(id)}
              onStartDemo={startDemo}
              recording={rec.phase !== 'idle'}
              recordSupport={recordSupport}
              onFullscreen={toggleFullscreen}
              fullscreenSupported={fullscreenSupported}
            />
          )}
        </aside>
      )}

      {!clean && recResult && (
        <div className="toast toast-result" role="status">
          <span>
            your video is ready · {(recResult.durationMs / 1000).toFixed(1)} s · {(recResult.blob.size / 1e6).toFixed(1)} MB
          </span>
          <a className="btn btn-accent btn-small" href={recResult.url} download={recResult.filename}>
            save .{recResult.extension}
          </a>
          <button type="button" className="icon-btn" onClick={discardRecording} aria-label="Dismiss recording">
            <Icon name="close" />
          </button>
        </div>
      )}

      {!clean && notices.length > 0 && (
        <div className="notices" role="alert">
          {notices.map((n) => (
            <div key={n.id} className="toast">
              {n.text}
            </div>
          ))}
        </div>
      )}

      {dragOver && (
        <div className="dropzone">
          <span>drop your photos here!</span>
        </div>
      )}

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

function RecTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="rec-timer" aria-live="off">
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}
