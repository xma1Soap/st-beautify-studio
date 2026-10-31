import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import { processText } from './lib/engine';
import { TopBar } from './components/TopBar';
import { ScriptList } from './components/ScriptList';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { importFiles, openProject, saveProject } from './actions';
import { filesToPicked } from './lib/files';

const MIN_EDITOR = 360;
const MIN_PREVIEW = 360;

export default function App() {
  const scripts = useStore((s) => s.project.scripts);
  const text = useStore((s) => s.project.testText);
  const settings = useStore((s) => s.project.settings);
  const uiTheme = useStore((s) => s.uiTheme);
  const processed = useMemo(() => processText(scripts, text, settings), [scripts, text, settings]);

  useEffect(() => { document.documentElement.dataset.theme = uiTheme; }, [uiTheme]);

  /* keyboard shortcuts */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openProject(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  /* drop files anywhere */
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const has = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth.current++; setDragging(true); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!has(e)) return; if (--depth.current <= 0) { depth.current = 0; setDragging(false); } };
    const drop = async (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault(); depth.current = 0; setDragging(false);
      importFiles(await filesToPicked([...(e.dataTransfer?.files || [])]));
    };
    addEventListener('dragenter', enter); addEventListener('dragover', over);
    addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter); removeEventListener('dragover', over);
      removeEventListener('dragleave', leave); removeEventListener('drop', drop);
    };
  }, []);

  /* draggable divider between editor and preview */
  const mainRef = useRef<HTMLDivElement>(null);
  const [editorW, setEditorW] = useState(() => Number(localStorage.getItem('stbs-editor-w')) || 560);
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
  const shownEditorW = Math.max(300, Math.min(editorW, mainW - 260 - 6 - MIN_PREVIEW));
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const left = (mainRef.current?.getBoundingClientRect().left ?? 0) + 260;
    const total = mainRef.current?.clientWidth ?? 1200;
    const move = (ev: PointerEvent) => setEditorW(Math.max(MIN_EDITOR, Math.min(total - 260 - 6 - MIN_PREVIEW, ev.clientX - left)));
    const up = () => {
      setResizing(false);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      setEditorW((w) => { try { localStorage.setItem('stbs-editor-w', String(Math.round(w))); } catch {} return w; });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  return (
    <div className={'app' + (resizing ? ' resizing' : '')}>
      <TopBar />
      <div className="main" ref={mainRef} style={{ gridTemplateColumns: `260px ${shownEditorW}px 6px minmax(0, 1fr)` }}>
        <ScriptList stats={processed.stats} />
        <Editor stats={processed.stats} />
        <div className="splitter" onPointerDown={startResize} title="拖动调整宽度" />
        <Preview processed={processed} />
      </div>
      {dragging && <div className="drop-overlay">松手导入（正则 / 预设 / 角色卡 / 工程文件）</div>}
      <Toast />
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), Math.min(8000, 2500 + toast.msg.length * 40));
    return () => clearTimeout(t);
  }, [toast]);
  return <div className={'toast' + (show ? ' show' : '')}>{toast?.msg}</div>;
}
