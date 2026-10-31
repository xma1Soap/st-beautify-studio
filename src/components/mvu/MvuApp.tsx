// The MVU card editor: variables on the left, settings in the middle, the status bar preview on the right.
import { useEffect } from 'react';
import { exportCardJson, exportCardPng, newCard, openCard, saveCardProject } from '../../cardActions';
import { useCard, type CardTab } from '../../cardStore';
import { ModeSwitch, ThemeButton } from '../common';
import { useSplit } from '../useSplit';
import { duplicateSelected, removeSelected } from '../../barActions';
import { AiTab } from './AiTab';
import { BarCanvas } from './BarCanvas';
import { BarPanel } from './BarPanel';
import { CardForm } from './CardForm';
import { MvuPreview } from './MvuPreview';
import { VarForm } from './VarForm';
import { VarTree } from './VarTree';

function MvuTopBar() {
  const name = useCard((s) => s.project.card.name);
  const dirty = useCard((s) => s.dirty);
  const filePath = useCard((s) => s.filePath);
  const canUndo = useCard((s) => s.past.length > 0);
  const canRedo = useCard((s) => s.future.length > 0);
  const { undo, redo, edit } = useCard.getState();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">✦</span>酒馆美化工坊
      </div>
      <ModeSwitch />
      <div className="pname" title={filePath || '还没保存过'}>
        <input
          value={name}
          placeholder="角色名"
          onChange={(e) => edit((p) => ({ ...p, card: { ...p.card, name: e.target.value } }), 'card:name')}
          spellCheck={false}
        />
        {dirty && (
          <span className="dirty" title="有未保存的修改">
            ●
          </span>
        )}
      </div>
      <div className="btn-group">
        <button onClick={newCard}>新建</button>
        <button onClick={openCard} title="打开工程文件，或导入别人做的角色卡（PNG / JSON）　Ctrl+O">
          打开
        </button>
        <button onClick={() => saveCardProject()} title="Ctrl+S">
          保存
        </button>
        <button onClick={() => saveCardProject(true)} title="Ctrl+Shift+S">
          另存为
        </button>
      </div>
      <div className="btn-group">
        <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">
          撤销
        </button>
        <button onClick={redo} disabled={!canRedo} title="Ctrl+Y">
          重做
        </button>
      </div>
      <span className="sp" />
      <div className="btn-group">
        <button onClick={exportCardJson} title="导出成 JSON 格式的角色卡">
          导出 JSON
        </button>
        <button className="primary" onClick={exportCardPng} title="导出成带图片的角色卡，酒馆里直接导入">
          导出角色卡
        </button>
      </div>
      <ThemeButton />
    </header>
  );
}

const TABS: { id: CardTab; label: string }[] = [
  { id: 'vars', label: '变量' },
  { id: 'bar', label: '状态栏' },
  { id: 'card', label: '角色卡' },
  { id: 'ai', label: '进阶' },
];

function Middle() {
  const tab = useCard((s) => s.tab);
  const setTab = useCard((s) => s.setTab);
  const noteCount = useCard((s) => s.notes.length);
  return (
    <section className="editor">
      <div className="panel-head tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'card' && noteCount > 0 && <span className="dot" title="有导入说明" />}
          </button>
        ))}
      </div>
      {tab === 'vars' && <VarForm />}
      {tab === 'bar' && <BarPanel />}
      {tab === 'card' && <CardForm />}
      {tab === 'ai' && <AiTab />}
    </section>
  );
}

export function MvuApp() {
  const split = useSplit('stbs-card-editor-w', 290, 520);
  const canvas = useCard((s) => s.tab === 'bar' && s.rightView === 'canvas' && !s.project.textBar?.on);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // leave undo inside text boxes to the browser; it only knows about that box
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]');
      const st = useCard.getState();
      // status bar page: keys for the selected component
      if (st.tab === 'bar' && !typing && st.barSel) {
        if ((k === 'delete' || k === 'backspace') && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          removeSelected();
          return;
        }
        if (k === 'escape') {
          st.selectBar(null);
          return;
        }
        if (k === 'd' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          duplicateSelected();
          return;
        }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (k === 's') {
        e.preventDefault();
        saveCardProject(e.shiftKey);
      } else if (k === 'o') {
        e.preventDefault();
        openCard();
      } else if (k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) useCard.getState().redo();
        else useCard.getState().undo();
      } else if (k === 'y' && !typing) {
        e.preventDefault();
        useCard.getState().redo();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  return (
    <div className={'app' + (split.resizing ? ' resizing' : '')}>
      <MvuTopBar />
      <div className="main" ref={split.mainRef} style={{ gridTemplateColumns: split.columns }}>
        <VarTree />
        <Middle />
        <div className="splitter" onPointerDown={split.startResize} title="拖动调整宽度" />
        {canvas ? <BarCanvas /> : <MvuPreview />}
      </div>
    </div>
  );
}
