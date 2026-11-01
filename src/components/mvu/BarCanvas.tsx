// Right panel on the status bar page: the status bar drawn for real (same code as in the card) inside a frame,
// with a see-through layer on top that shows what is selected and takes clicks and drags.
// The frame only runs our own drawing code and can't reach the app (no same-origin).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { addAt, drag, moveNode, nodeFor, placeNode, updateNode, type FreePoint } from '../../barActions';
import { canvasLayout, type CanvasRect } from '../../canvasLayout';
import { simTextOf, useCard } from '../../cardStore';
import { barOf, compileBar, describe, findNode, indexVars, isContainer, pathTo, placementProblem, type BarNode, type FreeAt } from '../../mvu/bar';
import { freeSize, isFree, snap1 } from '../../mvu/free';
import { cleanShape, type ShapePt } from '../../mvu/shape';
import { editorHtml } from '../../mvu/statusbar';
import { PHONES, savedPhone, savePhone } from '../device';
import { OwnBarNote, RightSwitch, SimPanel, TweakPanel } from './MvuPreview';
import { ShapeEditor } from './ShapeEditor';
import { useShapeUi } from './ShapeFields';
import { useSim } from './sim';

type Rect = CanvasRect;

interface Drop {
  parentId: string;
  index: number;
  /** insertion line, or the whole box when it is empty */
  line: { x: number; y: number; w: number; h: number };
  box?: boolean;
  problem?: string;
  /** into a free box: where */
  at?: FreePoint;
}

/** A free box as drawn: its stage on the canvas and how much it is scaled. */
interface Stage {
  box: BarNode;
  r: Rect;
  k: number;
}

/** Moving or resizing a part of a free box: where it started (the box's own px) and which sides move. */
interface FreeDrag {
  st: Stage;
  at: FreeAt & { w: number; h: number };
  /** the pointer at the start, canvas px */
  px: number;
  py: number;
  /** resizing: -1 left/top side, 1 right/bottom side, 0 that way stays; missing: moving */
  sx?: number;
  sy?: number;
  /** what the part had (only sizes it had, or that get changed, are kept) */
  hadW: boolean;
  hadH: boolean;
}

const HANDLES: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

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

/** A new shape for a component (dragging a point is one undo step, like dragging a slider). */
function setShape(id: string, shape: ShapePt[]) {
  const p = useCard.getState().project;
  const n = findNode(barOf({ bar: p.bar, vars: p.vars }).root, id);
  updateNode(id, { style: { ...n?.style, shape } }, `bar:${id}:style.shape`);
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
  const showSel = useShapeUi((u) => u.showSel);
  const shaping = useShapeUi((u) => u.editing);
  const ui = useMemo(() => ({ ...openFor(bar.root, sel), ...(showSel ? { sel: showSel } : {}) }), [bar, sel, showSel]);
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
      else if (d?.__sbc === 'layout') {
        canvasLayout.rects = d.rects;
        setLayout({ rects: d.rects, h: Math.max(40, d.h) });
      }
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
      if (!m || r.stage || exclude?.has(r.id) || !inside(r, x, y)) continue;
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
      (r) => r.id === id && !r.tab && !r.stage && r.x >= outer.x - 1 && r.y >= outer.y - 1 && r.x + r.w <= outer.x + outer.w + 1 && r.y + r.h <= outer.y + outer.h + 1,
    );

  /** The free box `box` as drawn around (x, y) (it can be drawn more than once, in a repeat); null when it is stacked. */
  const stageAt = (box: BarNode, x: number, y: number): Stage | null => {
    if (!isFree(box)) return null;
    const all = layout.rects.filter((r) => r.id === box.id && r.stage);
    const r = all.find((q) => x >= q.x - 40 && x <= q.x + q.w + 40 && y >= q.y - 40 && y <= q.y + q.h + 400) ?? all[0];
    return r ? { box, r, k: r.w / freeSize(box).w || 1 } : null;
  };
  /** (x, y) on the canvas in the free box's own px */
  const inStage = (st: Stage, x: number, y: number) => ({ x: (x - st.r.x) / st.k, y: (y - st.r.y) / st.k });
  /** Dropping into a free box: where the pointer is, less where the part was grabbed. */
  const freeDrop = (st: Stage, x: number, y: number, exclude?: Set<string>): Drop => {
    const g = grab.current;
    const p = inStage(st, x - (g?.dx ?? 0), y - (g?.dy ?? 0));
    const index = exclude ? (st.box.children ?? []).filter((k) => !exclude.has(k.id)).length : st.box.children?.length ?? 0;
    const size = g ? { w: Math.round(g.w / st.k), h: Math.round(g.h / st.k) } : undefined;
    const w = (size?.w ?? 120) * st.k;
    const h = (size?.h ?? 32) * st.k;
    return { parentId: st.box.id, index, at: { x: p.x, y: p.y, size }, line: { x: st.r.x + p.x * st.k, y: st.r.y + p.y * st.k, w, h }, box: true };
  };

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
      if (!atEdge) {
        const st = stageAt(m.node, x, y);
        return st ? freeDrop(st, x, y, exclude) : dropInside(m.node, h, x, y, exclude);
      }
    }
    const parent = m.parent!;
    const pst = stageAt(parent, x, y);
    if (pst) return freeDrop(pst, x, y, exclude);
    const dir = childDir(parent);
    const before = dir === 'col' ? y < h.y + h.h / 2 : x < h.x + h.w / 2;
    return { parentId: parent.id, index: m.index + (before ? 0 : 1), line: lineAt(dir, h, before) };
  };

  /* ---------- pointer: select, hover, move ---------- */

  /** `then`: picked when it turns out to be a click */
  const press = useRef<{ id: string; x: number; y: number; moving: boolean; free?: FreeDrag; then?: string } | null>(null);
  /** where the part being moved was grabbed (canvas px from its corner) and its size */
  const grab = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});

  /** Moving or resizing a part of a free box: start from where it is drawn. */
  const freeStart = (id: string, r: Rect, px: number, py: number, sx?: number, sy?: number): FreeDrag | undefined => {
    const m = meta.get(id);
    const st = m?.parent ? stageAt(m.parent, r.x, r.y) : null;
    if (!m || !st) return undefined;
    const a = m.node.at;
    const p = inStage(st, r.x, r.y);
    return {
      st,
      at: { x: a?.x ?? p.x, y: a?.y ?? p.y, w: r.w / st.k, h: r.h / st.k },
      px,
      py,
      sx,
      sy,
      hadW: a?.w != null,
      hadH: a?.h != null,
    };
  };

  /** A part of a free box dragged by (dx, dy) canvas px: snapped to the box's sides and middle and to the other parts. */
  const freeMove = (id: string, fd: FreeDrag, dx: number, dy: number, free: boolean) => {
    const { st, at } = fd;
    const W = freeSize(st.box).w;
    const H = freeSize(st.box).h;
    const ux = dx / st.k;
    const uy = dy / st.k;
    let { x, y, w, h } = at;
    if (fd.sx === undefined) {
      x += ux;
      y += uy;
    } else {
      if (fd.sx < 0) {
        x += Math.min(ux, w - 16);
        w -= Math.min(ux, w - 16);
      } else if (fd.sx > 0) w = Math.max(16, w + ux);
      if (fd.sy! < 0) {
        y += Math.min(uy, h - 16);
        h -= Math.min(uy, h - 16);
      } else if (fd.sy! > 0) h = Math.max(16, h + uy);
    }
    const g: { x?: number; y?: number } = {};
    if (!free) {
      const xs = [0, W / 2, W];
      const ys = [0, H / 2, H];
      for (const k of st.box.children ?? []) {
        if (k.id === id) continue;
        const r = rectIn(k.id, { ...st.r, x: st.r.x - 4000, w: 8000, h: 8000 });
        if (!r) continue;
        const q = inStage(st, r.x, r.y);
        const kw = r.w / st.k;
        const kh = r.h / st.k;
        xs.push(q.x, q.x + kw / 2, q.x + kw);
        ys.push(q.y, q.y + kh / 2, q.y + kh);
      }
      const t = 6 / (scale * st.k);
      const moving = fd.sx === undefined;
      const sxL = snap1(moving ? [x, x + w / 2, x + w] : fd.sx! < 0 ? [x] : fd.sx! > 0 ? [x + w] : [], xs, t);
      const syL = snap1(moving ? [y, y + h / 2, y + h] : fd.sy! < 0 ? [y] : fd.sy! > 0 ? [y + h] : [], ys, t);
      if (sxL) {
        if (moving) x += sxL.d;
        else if (fd.sx! < 0) {
          x += sxL.d;
          w -= sxL.d;
        } else w += sxL.d;
        g.x = st.r.x + sxL.at * st.k;
      }
      if (syL) {
        if (moving) y += syL.d;
        else if (fd.sy! < 0) {
          y += syL.d;
          h -= syL.d;
        } else h += syL.d;
        g.y = st.r.y + syL.at * st.k;
      }
    }
    setGuides(g);
    const keepW = fd.hadW || (fd.sx !== undefined && fd.sx !== 0);
    const keepH = fd.hadH || (fd.sy !== undefined && fd.sy !== 0);
    placeNode(id, { x, y, ...(keepW ? { w } : {}), ...(keepH ? { h } : {}) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    layerRef.current?.focus();
    const p = toLocal(e);
    const h = hit(p.x, p.y);
    // inside the selected part of a free box, a drag moves that part (a click still picks what is under the pointer)
    if (h && sizeRect && sel && h.id !== sel && inside(sizeRect, p.x, p.y) && pathTo(bar.root, h.id).some((n) => n.id === sel)) {
      press.current = { id: sel, x: e.clientX, y: e.clientY, moving: false, free: freeStart(sel, sizeRect, p.x, p.y), then: h.id };
      grab.current = { dx: p.x - sizeRect.x, dy: p.y - sizeRect.y, w: sizeRect.w, h: sizeRect.h };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    selectBar(h?.id ?? null);
    if (h && h.id !== bar.root.id) {
      press.current = { id: h.id, x: e.clientX, y: e.clientY, moving: false, free: freeStart(h.id, h, p.x, p.y) };
      grab.current = { dx: p.x - h.x, dy: p.y - h.y, w: h.w, h: h.h };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  /** A resize handle of the selected part of a free box. */
  const onHandleDown = (e: React.PointerEvent, r: Rect, sx: number, sy: number) => {
    if (e.button !== 0 || !sel) return;
    e.stopPropagation();
    const p = toLocal(e);
    const fd = freeStart(sel, r, p.x, p.y, sx, sy);
    if (!fd) return;
    press.current = { id: sel, x: e.clientX, y: e.clientY, moving: true, free: fd };
    layerRef.current?.setPointerCapture(e.pointerId);
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
    const fd = pr.free;
    if (fd) {
      // inside its free box it just moves; dragged well out of it, it goes somewhere else like any part
      const b = fd.st.r;
      const out = fd.sx === undefined && (p.x < b.x - 30 || p.y < b.y - 30 || p.x > b.x + b.w + 30 || p.y > b.y + b.h + 30);
      if (!out) {
        setDrop(null);
        freeMove(pr.id, fd, p.x - fd.px, p.y - fd.py, e.altKey);
        return;
      }
      setGuides({});
    }
    const d = dropAt(p.x, p.y, pr.id);
    if (d) d.problem = placementProblem(bar.root, vars, meta.get(pr.id)!.node, d.parentId) ?? undefined;
    setDrop(d);
  };
  const endPress = () => {
    const pr = press.current;
    press.current = null;
    grab.current = null;
    const d = dropRef.current;
    setDrop(null);
    setGuides({});
    if (pr?.moving && d) moveNode(pr.id, d.parentId, d.index, d.at);
    else if (pr && !pr.moving && pr.then) selectBar(pr.then);
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
    if (item && d) addAt(item, d.parentId, d.index, d.at);
  };

  const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });
  const rectsOf = (id: string | null) => (id ? layout.rects.filter((r) => r.id === id && !r.tab && !r.stage) : []);
  const selRects = rectsOf(sel);
  const selNode = sel ? meta.get(sel)?.node : undefined;
  const shapePts = selNode && shaping === sel ? cleanShape(selNode.style?.shape) : undefined;
  const shapeRect = shapePts ? selRects[0] : undefined;
  // a part of a free box can be resized from its edges and corners
  const selParent = sel ? meta.get(sel)?.parent : undefined;
  const sizeRect = !shapeRect && selParent && isFree(selParent) && selRects[0] && stageAt(selParent, selRects[0].x, selRects[0].y) ? selRects[0] : undefined;
  // the panel needs the block's size to turn a point between fixed and proportional
  useEffect(() => {
    if (shapeRect) {
      const cur = useShapeUi.getState().size;
      if (cur?.w !== shapeRect.w || cur?.h !== shapeRect.h) useShapeUi.getState().set({ size: { w: shapeRect.w, h: shapeRect.h } });
    }
  }, [shapeRect?.w, shapeRect?.h]);

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
              {shapeRect && shapePts && (
                <ShapeEditor
                  rect={shapeRect}
                  pts={shapePts}
                  scale={scale}
                  others={layout.rects.filter((r) => r.id !== sel && !r.tab && !r.stage)}
                  stage={{ w, h: layout.h }}
                  toLocal={toLocal}
                  onChange={(next) => setShape(sel!, next)}
                />
              )}
              {sizeRect &&
                HANDLES.map(([sx, sy]) => (
                  <div
                    key={sx + ',' + sy}
                    className={'cv-handle' + (sx && sy ? ' corner' : '')}
                    style={{
                      left: sizeRect.x + ((sx + 1) / 2) * sizeRect.w,
                      top: sizeRect.y + ((sy + 1) / 2) * sizeRect.h,
                      transform: `translate(-50%, -50%) scale(${1 / scale})`,
                      cursor: sx && sy ? (sx === sy ? 'nwse-resize' : 'nesw-resize') : sx ? 'ew-resize' : 'ns-resize',
                    }}
                    onPointerDown={(e) => onHandleDown(e, sizeRect, sx, sy)}
                  />
                ))}
              {guides.x !== undefined && <div className="cv-gline v" style={{ left: guides.x, borderLeftWidth: 1 / scale }} />}
              {guides.y !== undefined && <div className="cv-gline h" style={{ top: guides.y, borderTopWidth: 1 / scale }} />}
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
      <div className="cv-help hint">
        点一下选中，按住拖动换位置；从中间拖组件、从左边拖变量进来。Delete 删除 · Ctrl+D 复制一份 · Esc 取消选中
        {sizeRect ? ' · 自由摆放：拖边角改大小，方向键挪 1 像素（Shift 挪 10），按住 Alt 不吸附' : ''}
      </div>
      {sim.setupError && <div className="err-log">⚠ {sim.setupError}</div>}
      <TweakPanel />
      <SimPanel />
    </section>
  );
}
