import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  prev: () => void;
  next: () => void;
  toggleClean: () => void;
  toggleDebug: () => void;
  exitClean: () => void;
  togglePortal: () => void;
  toggleRecord: () => void;
  toggleFullscreen: () => void;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Global keyboard shortcuts; ignored while typing or adjusting a form field. */
export function useShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        ref.current.exitClean();
        return;
      }
      if (isEditable(e.target)) return;
      const h = ref.current;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          h.prev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          h.next();
          break;
        case 'h':
        case 'H':
          h.toggleClean();
          break;
        case 'd':
        case 'D':
          h.toggleDebug();
          break;
        case 'r':
        case 'R':
          h.toggleRecord();
          break;
        case 'f':
        case 'F':
          h.toggleFullscreen();
          break;
        case ' ':
          e.preventDefault();
          h.togglePortal();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
