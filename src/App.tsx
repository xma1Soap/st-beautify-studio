import { useEffect, useMemo, useRef, useState } from 'react';
import { restoreRegex, useStore } from './store';
import { useLevel, useMode } from './mode';
import { processText } from './lib/engine';
import { TopBar } from './components/TopBar';
import { ScriptList } from './components/ScriptList';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { MvuApp } from './components/mvu/MvuApp';
import { useSplit } from './components/useSplit';
import { importFiles, openProject, saveProject } from './actions';
import { openCardFiles } from './cardActions';
import { restoreCard } from './cardStore';
import { filesToPicked } from './lib/files';
import { DialogHost } from './components/dialog';

export default function App() {
  const mode = useMode((s) => s.mode);
  const uiTheme = useStore((s) => s.uiTheme);

  useEffect(() => { document.documentElement.dataset.theme = uiTheme; }, [uiTheme]);
  useEffect(() => { restoreCard(); restoreRegex(); }, []);

  /* drop files anywhere; what they become depends on the mode */
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
      const files = await filesToPicked([...(e.dataTransfer?.files || [])]);
      if (useMode.getState().mode === 'mvu') openCardFiles(files);
      else importFiles(files);
    };
    addEventListener('dragenter', enter); addEventListener('dragover', over);
    addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter); removeEventListener('dragover', over);
      removeEventListener('dragleave', leave); removeEventListener('drop', drop);
    };
  }, []);

  return (
    <>
      {mode === 'mvu' ? <MvuApp /> : <RegexApp />}
      {dragging && (
        <div className="drop-overlay">
          {mode === 'mvu' ? '松手打开（角色卡 PNG / JSON，或 MVU 卡工程）' : '松手导入（正则 / 预设 / 角色卡 / 工程文件）'}
        </div>
      )}
      <Toast />
      <DialogHost />
    </>
  );
}

/** The text beautifier: regex list | regex editor | preview. */
function RegexApp() {
  const scripts = useStore((s) => s.project.scripts);
  const text = useStore((s) => s.project.testText);
  const settings = useStore((s) => s.project.settings);
  const processed = useMemo(() => processText(scripts, text, settings), [scripts, text, settings]);
  const split = useSplit('stbs-editor-w', 260, 560);
  const level = useLevel((s) => s.level);

  /* keyboard shortcuts */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      // inside a text box or the code editor, undo belongs to that box
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable], [contenteditable] *');
      if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openProject(); }
      else if (k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) useStore.getState().redo(); else useStore.getState().undo(); }
      else if (k === 'y' && !typing) { e.preventDefault(); useStore.getState().redo(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  return (
    <div className={'app lv-' + level + (split.resizing ? ' resizing' : '')}>
      <TopBar />
      <div className="main" ref={split.mainRef} style={{ gridTemplateColumns: split.columns }}>
        <ScriptList stats={processed.stats} />
        <Editor stats={processed.stats} />
        <div className="splitter" onPointerDown={split.startResize} title="拖动调整宽度" />
        <Preview processed={processed} />
      </div>
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
