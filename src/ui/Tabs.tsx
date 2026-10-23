import type { ActiveCameraSettings, CameraInfo } from '../engine/camera';
import type { Photo } from '../engine/photos';
import type { InputMode, SourceKind } from '../engine/PortalEngine';
import type { RecordingSupport } from '../engine/recorder';
import { DEFAULT_FRAMING, type Framing } from '../lib/photoFraming';
import { outputSize, type UISettings } from '../settings';
import { Icon, Section, Segmented, Slider, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}%`;

interface SettingsProps {
  settings: UISettings;
  update: (patch: Partial<UISettings>) => void;
}

// ------------------------------------------------------------------- photos

interface PhotosTabProps extends SettingsProps {
  photos: Photo[];
  selectedId: string | null;
  selected: Photo | null;
  loading: number;
  onSelect: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onFraming: (f: Framing) => void;
  onRemoveSamples: () => void;
}

export function PhotosTab(p: PhotosTabProps) {
  const { settings: s, update } = p;
  const framing = p.selected?.framing ?? DEFAULT_FRAMING;
  const setFraming = (patch: Partial<Framing>) => p.onFraming({ ...framing, ...patch });
  const many = p.photos.length > 1;
  return (
    <>
      <Section title="my photos">
        <div className="btn-row">
          <button type="button" className="btn btn-accent" onClick={p.onAdd}>
            + add photos
          </button>
          {p.photos.some((x) => x.sample) && (
            <button type="button" className="btn btn-quiet" onClick={p.onRemoveSamples}>
              remove samples
            </button>
          )}
        </div>
        <p className="tiny">…or drop pictures anywhere on the page.</p>
        <ol className="photo-grid" aria-label="Photographs">
          {p.photos.map((ph, i) => {
            const selected = ph.id === p.selectedId;
            return (
              <li key={ph.id} className={`snap ${selected ? 'is-selected' : ''}`}>
                <button
                  type="button"
                  className="snap-img"
                  onClick={() => p.onSelect(ph.id)}
                  aria-pressed={selected}
                  aria-label={`${ph.name}${selected ? ' (showing)' : ''}, ${i + 1} of ${p.photos.length}`}
                  title={ph.name}
                >
                  <img src={ph.thumbUrl} alt="" draggable={false} />
                  {ph.sample && <span className="snap-tag">sample</span>}
                </button>
                <div className="snap-tools">
                  <button type="button" onClick={() => p.onMove(ph.id, -1)} disabled={i === 0} aria-label={`Move ${ph.name} earlier`} title="earlier">
                    <Icon name="left" />
                  </button>
                  <button type="button" onClick={() => p.onMove(ph.id, 1)} disabled={i === p.photos.length - 1} aria-label={`Move ${ph.name} later`} title="later">
                    <Icon name="right" />
                  </button>
                  <button type="button" onClick={() => p.onRemove(ph.id)} aria-label={`Remove ${ph.name}`} title="remove">
                    <Icon name="close" />
                  </button>
                </div>
              </li>
            );
          })}
          {Array.from({ length: p.loading }, (_, i) => (
            <li key={`loading-${i}`} className="snap is-loading" aria-label="Loading photo" />
          ))}
        </ol>
        <div className="btn-row">
          <button type="button" className="btn btn-small" onClick={p.onPrev} disabled={!many}>
            ← back
          </button>
          <button type="button" className="btn btn-small" onClick={p.onNext} disabled={!many}>
            next →
          </button>
        </div>
        <Toggle
          label="new memory on reopen"
          hint="Close the frame for a moment, then open it again to see the next photo."
          checked={s.newMemoryOnReopen}
          onChange={(newMemoryOnReopen) => update({ newMemoryOnReopen })}
        />
      </Section>
      <Section title="how it sits">
        <Segmented
          label="photo"
          value={s.photoMode}
          onChange={(photoMode) => update({ photoMode })}
          options={[
            { value: 'window', label: 'window', title: 'The photo stays still behind the camera; the portal peeks at part of it' },
            { value: 'follow', label: 'follow', title: 'The whole photo stretches between your four fingertips' },
          ]}
        />
        {s.photoMode === 'follow' && (
          <Segmented
            label="fit"
            value={s.followFit}
            onChange={(followFit) => update({ followFit })}
            options={[
              { value: 'cover', label: 'fill' },
              { value: 'contain', label: 'whole photo' },
            ]}
          />
        )}
        <Slider label="zoom" value={framing.zoom} min={1} max={3} step={0.01} format={(v) => `${v.toFixed(1)}×`} onChange={(zoom) => setFraming({ zoom })} disabled={!p.selected} />
        <Slider label="left ↔ right" value={framing.panX} min={-1} max={1} step={0.01} format={(v) => (v === 0 ? 'middle' : v.toFixed(2))} onChange={(panX) => setFraming({ panX })} disabled={!p.selected} />
        <Slider label="up ↕ down" value={framing.panY} min={-1} max={1} step={0.01} format={(v) => (v === 0 ? 'middle' : v.toFixed(2))} onChange={(panY) => setFraming({ panY })} disabled={!p.selected} />
        <button type="button" className="btn btn-quiet btn-small" onClick={() => p.onFraming({ ...DEFAULT_FRAMING })} disabled={!p.selected}>
          reset framing
        </button>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- portal

interface PortalTabProps extends SettingsProps {
  source: SourceKind;
  inputMode: InputMode;
  onInputMode: (m: InputMode) => void;
}

export function PortalTab({ settings: s, update, source, inputMode, onInputMode }: PortalTabProps) {
  return (
    <>
      <Section title="doodles">
        <Segmented
          label="border"
          value={s.borderStyle}
          onChange={(borderStyle) => update({ borderStyle })}
          options={[
            { value: 'stitch', label: 'stitch', title: 'Crayon line with running stitches' },
            { value: 'crayon', label: 'crayon', title: 'Two wobbly crayon lines' },
            { value: 'rainbow', label: 'rainbow', title: 'Crayon rainbow bands' },
            { value: 'scribble', label: 'scribble', title: 'Loopy scribbles' },
            { value: 'none', label: 'none' },
          ]}
        />
        <Slider label="border size" value={s.borderSize} min={0} max={1} step={0.01} format={pct} onChange={(borderSize) => update({ borderSize })} disabled={s.borderStyle === 'none'} />
        <Toggle label="flowers on fingertips" checked={s.doodles} onChange={(doodles) => update({ doodles })} />
        <Toggle label="flower garden" hint="Crayon flowers grow along the bottom." checked={s.garden} onChange={(garden) => update({ garden })} />
      </Section>
      <Section title="hands">
        <Segmented
          label="control with"
          value={inputMode}
          onChange={onInputMode}
          disabled={source !== 'camera'}
          options={[
            { value: 'hand', label: 'hands' },
            { value: 'mouse', label: 'mouse' },
          ]}
        />
        <Slider label="sensitivity" value={s.sensitivity} min={0} max={1} step={0.01} format={pct} onChange={(sensitivity) => update({ sensitivity })} hint="How far apart fingers must be to count as “open” (for new memory on reopen)." />
        <Slider label="smoothing" value={s.smoothing} min={0} max={1} step={0.01} format={pct} onChange={(smoothing) => update({ smoothing })} hint="Lower follows faster; higher is steadier." />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- camera

interface CameraTabProps extends SettingsProps {
  source: SourceKind;
  cameraBusy: boolean;
  cameras: CameraInfo[];
  cameraInfo: ActiveCameraSettings | null;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onSelectCamera: (id: string) => void;
  onStartDemo: () => void;
  recording: boolean;
  recordSupport: RecordingSupport;
  onFullscreen: () => void;
  fullscreenSupported: boolean;
}

export function CameraTab(p: CameraTabProps) {
  const { settings: s, update } = p;
  const out = outputSize(s.aspect, s.performance);
  const cameraOn = p.source === 'camera';
  return (
    <>
      <Section title="camera">
        <div className="btn-row">
          {cameraOn ? (
            <button type="button" className="btn" onClick={p.onStopCamera}>
              stop camera
            </button>
          ) : (
            <button type="button" className="btn btn-accent" onClick={p.onStartCamera} disabled={p.cameraBusy}>
              {p.cameraBusy ? 'starting…' : 'start camera'}
            </button>
          )}
          {p.source !== 'backdrop' && (
            <button type="button" className="btn btn-quiet" onClick={p.onStartDemo} disabled={p.cameraBusy}>
              mouse demo
            </button>
          )}
        </div>
        {cameraOn && p.cameras.length > 0 && (
          <label className="select-row">
            <span>which camera</span>
            <select value={p.cameraInfo?.deviceId ?? ''} onChange={(e) => p.onSelectCamera(e.target.value)}>
              {p.cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {cameraOn && p.cameraInfo && (
          <p className="tiny">
            {p.cameraInfo.width}×{p.cameraInfo.height}
            {p.cameraInfo.frameRate ? ` · ${Math.round(p.cameraInfo.frameRate)} fps` : ''}
          </p>
        )}
        <Toggle label="mirror" checked={s.mirror} onChange={(mirror) => update({ mirror })} />
      </Section>
      <Section title="picture">
        <Segmented
          label="shape"
          value={s.aspect}
          onChange={(aspect) => update({ aspect })}
          disabled={p.recording}
          options={[
            { value: '16:9', label: 'wide' },
            { value: '9:16', label: 'tall' },
            { value: '1:1', label: 'square' },
          ]}
        />
        <Toggle
          label="go faster"
          hint={`Saves at ${out.width}×${out.height}${s.performance ? ' with lighter drawing' : ''}.`}
          checked={s.performance}
          onChange={(performance) => update({ performance })}
          disabled={p.recording}
        />
        <Toggle label="countdown before recording" checked={s.countdown} onChange={(countdown) => update({ countdown })} />
        {!p.recordSupport.supported && (
          <p className="note">
            This browser can’t record by itself ({p.recordSupport.reason}) Hide everything with H and use macOS screen
            recording (⇧⌘5).
          </p>
        )}
        <Toggle label="show tracking dots" shortcut="D" checked={s.debug} onChange={(debug) => update({ debug })} />
        <button type="button" className="btn btn-quiet btn-small" onClick={p.onFullscreen} disabled={!p.fullscreenSupported}>
          fullscreen <kbd>F</kbd>
        </button>
      </Section>
      <p className="tiny drawer-foot">Everything stays on this computer — nothing is uploaded.</p>
    </>
  );
}
