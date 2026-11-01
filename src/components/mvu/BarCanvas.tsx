// Right panel on the status bar page: the status bar drawn for real (same code as in the card) inside a frame,
// with a see-through layer on top that shows what is selected and takes clicks and drags.
// The frame only runs our own drawing code and can't reach the app (no same-origin).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { addAt, drag, moveNode, nodeFor } from '../../barActions';
import { simTextOf, useCard } from '../../cardStore';
import { barOf, compileBar, describe, indexVars, isContainer, pathTo, placementProblem, type BarNode } from '../../mvu/bar';
import { editorHtml } from '../../mvu/statusbar';
import { PHONES, savedPhone, savePhone } from '../device';
import { OwnBarNote, RightSwitch, SimPanel, TweakPanel } from './MvuPreview';
import { useSim } from './sim';

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** how many menus deep: open menus are drawn over everything else */
  z?: number;
  /** a tab label, standing for its page */
  tab?: 1;
}

interface Drop {
  parentId: string;
  index: number;
  /** insertion line, or the whole box when it is empty */
  line: { x: number; y: number; w: number; h: number };
  box?: boolean;
  problem?: string;
}

interface Meta {
  node: BarNode;
  parent: BarNode | null;
  index: number;
  depth: number;
}

/** Width of the message text in SillyTavern (screen minus avatar and padding), which is what the status bar gets. */
const DESKTOP_W = 680;
const msgWidth = (phone: boolean, i: number) => (phone ? (PHONES[i] ?? PHONES[1]).w - 72 : DESKTOP_W);

/** How the children of a container are laid out. */
const childDir = (n: BarNode) => (n.type === 'repeat' ? n.inner ?? 'col' : n.dir ?? 'col');

const STAGE_BG = { dark: '#1a1a1e', light: '#e9e6e0' };

/** What the canvas opens so the selection can be seen: the menus and folds it is in, and the tab page it is on. */
function openFor(root: BarNode, sel: string | null) {
  const open: Record<string, 1> = {};
  const page: Record<string, number> = {};
  const chain = sel ? pathTo(root, sel) : [];
  chain.forEach((n, i) => {
    if (n.type === 'menu' || n.type === 'fold') open[n.id] = 1;
    const next = chain[i + 1];
    if (n.type === 'tabs' && next) page[n.id] = n.children?.findIndex((c) => c.id === next.id) ?? 0;
  });
  return { open, page };
}

/** Components you edit the words of with a double click. */
const TEXT_TYPES = new Set(['text', 'divider', 'button', 'menu', 'fold']);

export function BarCanvas() {
  const vars = useCard((s) => s.project.vars);
  const saved = useCard((s) => s.project.bar);
  const sel = useCard((s) => s.barSel);
  const preview = useCard((s) => s.preview);
  const simText = useCard(simTextOf);
  const floor = useCard((s) => s.simAt + 1);
  const tweaked = useCard((s) => Object.keys(s.simTweak).length > 0);
  const { selectBar, setPreview } = useCard.getState();
  const sim = useSim();

  const bar = useMemo(() => barOf({ bar: saved, vars }), [saved, vars]);
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const compiled = useMemo(() => compileBar(bar, vars, { edit: true, allowEdit }), [bar, vars, allowEdit]);
  const ui = useMemo(() => openFor(bar.root, sel), [bar, sel]);
  const idx = useMemo(() => indexVars(vars), [vars]);
  const meta = useMemo(() => {
    const m = new Map<string, Meta>();
    const go = (n: BarNode, parent: BarNode | null, index: number, depth: number) => {
      m.set(n.id, { node: n, parent, index, depth });
      n.children?.forEach((c, i) => go(c, n, i, depth + 1));
    };
    go(bar.root, null, 0, 0);
    return m;
  }, [bar]);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(600);
  const [layout, setLayout] = useState<{ rects: Rect[]; h: number }>({ rects: [], h: 120 });
  const [hover, setHover] = useState<string | null>(null);
  const [drop, setDropState] = useState<Drop | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const setDrop = (d: Drop | null) => {
    dropRef.current = d;
    setDropState(d);
  };
  const [phoneIdx, setPhoneIdx] = useState(savedPhone);
  const srcdoc = useMemo(() => editorHtml(), []);

  const phone = preview.device === 'phone';
  const w = msgWidth(phone, phoneIdx);
  const scale = Math.min(1, (stageW - 32) / w);

  /* send the bar and the data to the frame; it answers with where everything is */
  const css = compiled.xcss ? `${compiled.css}\n${compiled.xcss}` : compiled.css;
  const latest = useRef({ view: compiled.view, css, data: sim.data, prev: sim.before, ui });
  latest.current = { view: compiled.view, css, data: sim.data, prev: sim.before, ui };
  const post = () => frameRef.current?.contentWindow?.postMessage({ __sbc: 'set', ...latest.current }, '*');
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data;
      if (d?.__sbc === 'ready') post();
      else if (d?.__sbc === 'layout') setLayout({ rects: d.rects, h: Math.max(40, d.h) });
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  useEffect(() => {
    post();
  }, [compiled, sim.data, ui]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- geometry ---------- */

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

  /** The component under the point: inside an open menu first, then the deepest, then the smallest. */
  const hit = (x: number, y: number, exclude?: Set<string>): Rect | null => {
    let best: Rect | null = null;
    let bd = -1;
    for (const r of layout.rects) {
      const m = meta.get(r.id);
      if (!m || exclude?.has(r.id) || !inside(r, x, y)) continue;
      const bz = best?.z ?? 0;
      const z = r.z ?? 0;
      if (!best || z > bz || (z === bz && (m.depth > bd || (m.depth === bd && r.w * r.h < best.w * best.h)))) {
        best = r;
        bd = m.depth;
      }
    }
    return best;
  };

  /** Where a child of `outer` (one drawn copy of a container) is. */
  const rectIn = (id: string, outer: Rect) =>
    layout.rects.find(
      (r) => r.id === id && !r.tab && r.x >= outer.x - 1 && r.y >= outer.y - 1 && r.x + r.w <= outer.x + outer.w + 1 && r.y + r.h <= outer.y + outer.h + 1,
    );

  const lineAt = (dir: string, r: Rect, before: boolean) =>
    dir === 'col' ? { x: r.x, y: before ? r.y - 4 : r.y + r.h + 1, w: r.w, h: 3 } : { x: before ? r.x - 4 : r.x + r.w + 1, y: r.y, w: 3, h: r.h };

  const dropInside = (node: BarNode, rect: Rect, x: number, y: number, exclude?: Set<string>): Drop => {
    const kids = (node.children ?? [])
      .map((k, i) => ({ k, i, r: rectIn(k.id, rect) }))
      .filter((o): o is { k: BarNode; i: number; r: Rect } => !!o.r && !exclude?.has(o.k.id));
    if (!kids.length) {
      const index = exclude ? (node.children ?? []).filter((k) => !exclude.has(k.id)).length : node.children?.length ?? 0;
      return { parentId: node.id, index, line: { x: rect.x + 2, y: rect.y + 2, w: rect.w - 4, h: rect.h - 4 }, box: true };
    }
    const dist = (r: Rect) => {
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
      const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
      return dx * dx + dy * dy;
    };
    const near = kids.reduce((a, b) => (dist(b.r) < dist(a.r) ? b : a));
    const dir = childDir(node);
    const r = near.r;
    const before = dir === 'col' ? y < r.y + r.h / 2 : dir === 'row' ? x < r.x + r.w / 2 : y < r.y ? true : y > r.y + r.h ? false : x < r.x + r.w / 2;
    return { parentId: node.id, index: near.i + (before ? 0 : 1), line: lineAt(dir, r, before) };
  };

  /** Where something dropped at (x, y) goes. `moving`: the component being moved (it and its insides are skipped). */
  const dropAt = (x: number, y: number, moving?: string): Drop | null => {
    const exclude = new Set<string>();
    if (moving) {
      const add = (n: BarNode) => {
        exclude.add(n.id);
        n.children?.forEach(add);
      };
      const m = meta.get(moving);
      if (m) add(m.node);
    }
    const rootRect = layout.rects.find((r) => r.id === bar.root.id);
    if (!rootRect) return null;
    const h = hit(x, y, exclude);
    if (!h) return dropInside(bar.root, rootRect, x, Math.max(y, rootRect.y + rootRect.h), exclude);
    const m = meta.get(h.id)!;
    if (h.tab) {
      // on a tab label: into that page (at the end when it isn't the one showing)
      const page = layout.rects.find((r) => r.id === h.id && !r.tab);
      if (page) return dropInside(m.node, page, x, page.y + page.h, exclude);
      return { parentId: h.id, index: m.node.children?.length ?? 0, line: { x: h.x + 2, y: h.y + 2, w: h.w - 4, h: h.h - 4 }, box: true };
    }
    if (isContainer(m.node)) {
      const EDGE = 6;
      const pdir = m.parent ? childDir(m.parent) : 'col';
      const atEdge = !!m.parent && (pdir === 'col' ? y - h.y < EDGE || h.y + h.h - y < EDGE : x - h.x < EDGE || h.x + h.w - x < EDGE);
      if (!atEdge) return dropInside(m.node, h, x, y, exclude);
    }
    const parent = m.parent!;
    const dir = childDir(parent);
    const before = dir === 'col' ? y < h.y + h.h / 2 : x < h.x + h.w / 2;
    return { parentId: parent.id, index: m.index + (before ? 0 : 1), line: lineAt(dir, h, before) };
  };

  /* ---------- pointer: select, hover, move ---------- */

  const press = useRef<{ id: string; x: number; y: number; moving: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    layerRef.current?.focus();
    const p = toLocal(e);
    const h = hit(p.x, p.y);
    selectBar(h?.id ?? null);
    if (h && h.id !== bar.root.id) {
      press.current = { id: h.id, x: e.clientX, y: e.clientY, moving: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toLocal(e);
    const pr = press.current;
    if (!pr) {
      setHover(hit(p.x, p.y)?.id ?? null);
      return;
    }
    if (!pr.moving && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 5) return;
    pr.moving = true;
    setHover(null);
    const d = dropAt(p.x, p.y, pr.id);
    if (d) d.problem = placementProblem(bar.root, vars, meta.get(pr.id)!.node, d.parentId) ?? undefined;
    setDrop(d);
  };
  const endPress = () => {
    const pr = press.current;
    press.current = null;
    const d = dropRef.current;
    setDrop(null);
    if (pr?.moving && d) moveNode(pr.id, d.parentId, d.index);
  };

  /* ---------- dragging in from the palette or the variable list ---------- */

  const onDragOver = (e: React.DragEvent) => {
    const item = drag.item;
    if (!item) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const p = toLocal(e);
    const d = dropAt(p.x, p.y);
    if (d) d.problem = nodeFor(item, d.parentId).problem;
    setDrop(d);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const item = drag.item;
    drag.item = null;
    const d = dropRef.current;
    setDrop(null);
    if (item && d) addAt(item, d.parentId, d.index);
  };

  const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });
  const rectsOf = (id: string | null) => (id ? layout.rects.filter((r) => r.id === id && !r.tab) : []);
  const selRects = rectsOf(sel);
  const selNode = sel ? meta.get(sel)?.node : undefined;

  return (
    <section className="preview bar-canvas">
      <div className="panel-head">
        <RightSwitch />
        <b>状态栏画布</b>
        <span className="hint">
          {floor > 1 ? `第 ${floor} 条回复之后的数据` : simText.trim() ? '模拟回复之后的数据' : '开局时的数据'}
          {tweaked ? '（有手动改的值）' : ''}
        </span>
        <span className="sp" />
        <div className="seg" role="group" aria-label="画布宽度">
          <button className={phone ? 'on' : ''} onClick={() => setPreview({ device: 'phone' })}>
            📱 手机
          </button>
          <button className={!phone ? 'on' : ''} onClick={() => setPreview({ device: 'desktop' })}>
            🖥 电脑
          </button>
        </div>
      </div>
      <div className="preview-sub">
        {phone && (
          <select
            className="small-select"
            value={phoneIdx}
            onChange={(e) => {
              setPhoneIdx(Number(e.target.value));
              savePhone(Number(e.target.value));
            }}
            title="手机屏幕宽度"
          >
            {PHONES.map((ph, i) => (
              <option key={i} value={i}>
                {ph.label}
              </option>
            ))}
          </select>
        )}
        <span className="hint">
          消息宽 {w}
          {scale < 0.999 ? ` · 缩放 ${Math.round(scale * 100)}%` : ''}
        </span>
        <span className="sp" />
        {compiled.css.includes('@keyframes') && (
          <button className="small" onClick={() => frameRef.current?.contentWindow?.postMessage({ __sbc: 'play' }, '*')} title="画布上平时不动，点这里播一遍出现动画和循环动效（聊天预览里一直在动）">
            ▶ 播放动效
          </button>
        )}
        <select className="small-select" value={preview.chatTheme} onChange={(e) => setPreview({ chatTheme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">暗色聊天</option>
          <option value="light">亮色聊天</option>
        </select>
      </div>
      <OwnBarNote />
      <div className="cv-stage" ref={stageRef} style={{ background: STAGE_BG[preview.chatTheme] }}>
        <div className="cv-paper" style={{ width: w * scale, height: layout.h * scale }}>
          <div className="cv-scaled" style={{ width: w, height: layout.h, transform: `scale(${scale})` }}>
            <iframe ref={frameRef} srcDoc={srcdoc} sandbox="allow-scripts" title="状态栏画布" style={{ width: w, height: layout.h }} />
            <div
              className={'cv-layer' + (press.current?.moving ? ' moving' : '')}
              ref={layerRef}
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPress}
              onLostPointerCapture={endPress}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={() => {
                if (selNode && TEXT_TYPES.has(selNode.type)) dispatchEvent(new Event('stbs-edit-text'));
              }}
              onDragOver={onDragOver}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
              }}
              onDrop={onDrop}
            >
              {hover &&
                hover !== sel &&
                rectsOf(hover).map((r, i) => <div key={'h' + i} className="cv-hover" style={box(r)} />)}
              {selRects.map((r, i) => (
                <div key={'s' + i} className={'cv-sel' + (i > 0 ? ' copy' : '')} style={box(r)}>
                  {i === 0 && selNode && (
                    <span className={'cv-tag' + (r.y < 20 ? ' below' : '')} style={{ transform: `scale(${1 / scale})` }}>
                      {selNode === bar.root ? '整个状态栏' : describe(selNode, idx)}
                    </span>
                  )}
                </div>
              ))}
              {drop && <div className={'cv-drop' + (drop.box ? ' box' : '') + (drop.problem ? ' bad' : '')} style={box(drop.line)} />}
              {drop?.problem && (
                <div className="cv-drop-msg" style={{ left: drop.line.x, top: drop.line.y + drop.line.h + 4, transform: `scale(${1 / scale})` }}>
                  {drop.problem}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="cv-help hint">点一下选中，按住拖动换位置；从中间拖组件、从左边拖变量进来。Delete 删除 · Ctrl+D 复制一份 · Esc 取消选中</div>
      {sim.setupError && <div className="err-log">⚠ {sim.setupError}</div>}
      <TweakPanel />
      <SimPanel />
    </section>
  );
}
