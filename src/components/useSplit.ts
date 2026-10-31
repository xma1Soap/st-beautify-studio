// Three-column layout (list | editor | preview) with a draggable divider between editor and preview.
import { useEffect, useRef, useState } from 'react';

const MIN_EDITOR = 360;
const MIN_PREVIEW = 360;
const SPLITTER = 6;

export function useSplit(storageKey: string, listW: number, defaultW: number) {
  const mainRef = useRef<HTMLDivElement>(null);
  const [editorW, setEditorW] = useState(() => Number(localStorage.getItem(storageKey)) || defaultW);
  const [resizing, setResizing] = useState(false);
  const [mainW, setMainW] = useState(1400);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMainW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // keep the preview at least MIN_PREVIEW wide when the window shrinks
  const shownW = Math.max(300, Math.min(editorW, mainW - listW - SPLITTER - MIN_PREVIEW));
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const left = (mainRef.current?.getBoundingClientRect().left ?? 0) + listW;
    const total = mainRef.current?.clientWidth ?? 1200;
    const move = (ev: PointerEvent) => setEditorW(Math.max(MIN_EDITOR, Math.min(total - listW - SPLITTER - MIN_PREVIEW, ev.clientX - left)));
    const up = () => {
      setResizing(false);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      setEditorW((w) => {
        try {
          localStorage.setItem(storageKey, String(Math.round(w)));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return { mainRef, resizing, startResize, columns: `${listW}px ${shownW}px ${SPLITTER}px minmax(0, 1fr)` };
}
