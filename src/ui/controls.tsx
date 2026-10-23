import { useId, type ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={`slider ${props.disabled ? 'is-disabled' : ''}`}>
      <div className="slider-head">
        <label htmlFor={id}>{props.label}</label>
        <output htmlFor={id}>{props.format ? props.format(props.value) : props.value.toFixed(2)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ '--fill': `${((props.value - props.min) / (props.max - props.min)) * 100}%` } as React.CSSProperties}
      />
      {props.hint && <div className="slider-hint">{props.hint}</div>}
    </div>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
  shortcut?: string;
}) {
  const id = useId();
  return (
    <div className={`toggle-row ${props.disabled ? 'is-disabled' : ''}`}>
      <label htmlFor={id} className="toggle-label">
        <span>
          {props.label}
          {props.shortcut && <kbd>{props.shortcut}</kbd>}
        </span>
        {props.hint && <span className="row-hint">{props.hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        className="switch"
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented-wrap ${props.disabled ? 'is-disabled' : ''}`}>
      <div className="segmented-label" id={`seg-${props.label}`}>
        {props.label}
      </div>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${props.label}`}>
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            title={o.title}
            disabled={props.disabled}
            className={props.value === o.value ? 'is-active' : ''}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Icon({ name }: { name: 'prev' | 'next' | 'left' | 'right' | 'close' | 'plus' | 'panel' | 'expand' | 'eye' }) {
  const paths: Record<string, ReactNode> = {
    prev: <path d="M10 3 5 8l5 5" />,
    next: <path d="m6 3 5 5-5 5" />,
    left: <path d="M9.5 4.5 6 8l3.5 3.5" />,
    right: <path d="M6.5 4.5 10 8l-3.5 3.5" />,
    close: <path d="m4.5 4.5 7 7m0-7-7 7" />,
    plus: <path d="M8 3.5v9M3.5 8h9" />,
    panel: (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <path d="M10 3v10" />
      </>
    ),
    expand: <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />,
    eye: (
      <>
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
        <circle cx="8" cy="8" r="2" />
      </>
    ),
  };
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
