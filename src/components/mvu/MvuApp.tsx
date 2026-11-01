// The MVU card editor: variables on the left, settings in the middle, the status bar preview on the right.
import { useEffect } from 'react';
import { exportCardJson, exportCardPng, newCard, openCard, saveCardProject } from '../../cardActions';
import { useCard, type CardTab } from '../../cardStore';
import { AiButton, AiPanel } from '../AiPanel';
import { LevelSwitch, ModeSwitch, ThemeButton } from '../common';
import { useLevel } from '../../mode';
import { useSplit } from '../useSplit';
import { duplicateSelected, placeNode, removeSelected, updateNode } from '../../barActions';
import { barOf, findNode } from '../../mvu/bar';
import { isFree } from '../../mvu/free';
import { locate } from '../../mvu/tree';
import { cleanShape } from '../../mvu/shape';
import { shapeKey } from './ShapeFields';
import { closeBuilder } from '../../regexBuilder';
import { AiTab } from './AiTab';
import { BuilderTab } from './BuilderTab';
import { BarCanvas } from './BarCanvas';
import { BarPanel } from './BarPanel';
import { CardForm } from './CardForm';
import { MvuPreview } from './MvuPreview';
import { VarForm } from './VarForm';
import { VarTree } from './VarTree';

/** Top bar while a regex beautification is laid out here: the way back instead of the card's files. */
function BuilderTopBar() {
  const name = useCard((s) => s.builder?.name ?? '');
  const canUndo = useCard((s) => s.past.length > 0);
  const canRedo = useCard((s) => s.future.length > 0);
  const { undo, redo } = useCard.getState();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">✦</span>酒馆美化工坊
      </div>
      <button className="primary" onClick={closeBuilder} title="回到正则美化，在测试消息里看看效果（改动已经自动写进正则了）">
        ← 回到正则「{name || '(未命名)'}」
      </button>
      <span className="hint">在画布上做正则美化：改动会自动写进这条正则</span>
      <div className="btn-group">
        <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">
          撤销
        </button>
        <button onClick={redo} disabled={!canRedo} title="Ctrl+Y">
          重做
        </button>
      </div>
      <span className="sp" />
      <AiButton />
      <LevelSwitch />
      <ThemeButton />
    </header>
  );
}

function MvuTopBar() {
  const builder = useCard((s) => !!s.builder);
  return builder ? <BuilderTopBar /> : <CardTopBar />;
}

function CardTopBar() {
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
      <AiButton />
      <LevelSwitch />
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
/** a regex beautification: its fields, the layout, and what to tell the AI (on the card tab's place) */
const BUILDER_TABS: { id: CardTab; label: string }[] = [
  { id: 'vars', label: '字段' },
  { id: 'bar', label: '状态栏' },
  { id: 'card', label: '给 AI' },
];

function Middle() {
  const tab = useCard((s) => s.tab);
  const setTab = useCard((s) => s.setTab);
  const noteCount = useCard((s) => s.notes.length);
  const simple = useLevel((s) => s.level === 'simple');
  const builder = useCard((s) => !!s.builder);
  // 简易 has no 进阶 tab; if it was open, show the variables instead
  useEffect(() => {
    if ((simple || builder) && tab === 'ai') setTab('vars');
  }, [simple, builder, tab, setTab]);
  return (
    <section className="editor">
      <div className="panel-head tabs">
        {(builder ? BUILDER_TABS : TABS).filter((t) => !(simple && t.id === 'ai')).map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'card' && noteCount > 0 && <span className="dot" title="有导入说明" />}
          </button>
        ))}
      </div>
      {tab === 'vars' && <VarForm />}
      {tab === 'bar' && <BarPanel />}
      {tab === 'card' && (builder ? <BuilderTab /> : <CardForm />)}
      {tab === 'ai' && <AiTab />}
    </section>
  );
}

const NUDGE: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };

export function MvuApp() {
  const split = useSplit('stbs-card-editor-w', 290, 520);
  // a regex beautification has no chat to try it in (the regex page has that): always the canvas
  const canvas = useCard((s) => !!s.builder || (s.tab === 'bar' && s.rightView === 'canvas' && !s.project.textBar?.on));

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // leave undo inside text boxes to the browser; it only knows about that box
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]');
      const st = useCard.getState();
      // status bar page: keys for the selected component
      if (st.tab === 'bar' && !typing && st.barSel) {
        // editing a shape: Delete drops the picked point instead of the component, Esc stops editing
        const id = st.barSel;
        const root = barOf({ bar: st.project.bar, vars: st.project.vars }).root;
        const node = findNode(root, id);
        // a part of a free box: the arrow keys nudge it (Shift: 10 px)
        const nudge = NUDGE[k];
        if (nudge && node && isFree(locate([root], id)?.parent)) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const a = node.at ?? { x: 0, y: 0 };
          placeNode(id, { ...a, x: a.x + nudge[0] * step, y: a.y + nudge[1] * step });
          return;
        }
        if (shapeKey(k, id, (shape) => updateNode(id, { style: { ...node?.style, shape } }, `bar:${id}:style.shape`), cleanShape(node?.style?.shape))) {
          e.preventDefault();
          return;
        }
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
      // a regex beautification is kept in its regex, not in a card file
      if ((k === 's' || k === 'o') && st.builder) {
        e.preventDefault();
        return;
      }
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

  const level = useLevel((s) => s.level);
  return (
    <div className={'app lv-' + level + (split.resizing ? ' resizing' : '')}>
      <MvuTopBar />
      <div className="workarea">
        <div className="main" ref={split.mainRef} style={{ gridTemplateColumns: split.columns }}>
          <VarTree />
          <Middle />
          <div className="splitter" onPointerDown={split.startResize} title="拖动调整宽度" />
          {canvas ? <BarCanvas /> : <MvuPreview />}
        </div>
        <AiPanel mode="mvu" />
      </div>
    </div>
  );
}
