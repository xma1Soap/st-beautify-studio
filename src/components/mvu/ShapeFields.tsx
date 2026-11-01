// Settings for a block's shape (presets, how deep the points are, editing the points on the canvas), its top line
// and glow, and the colors it switches to while a player has it picked.
import { create } from 'zustand';
import type { BarStyle, BarTheme, SelStyle } from '../../mvu/bar';
import { at, cleanShape, place, SHAPE_DEPTH, SHAPE_PRESETS, type ShapePt } from '../../mvu/shape';
import { Field } from '../common';
import { ColorInput, FillInput, Slider } from './barInputs';

interface ShapeUi {
  /** component whose shape is being edited on the canvas */
  editing: string | null;
  /** the point picked in it */
  point: number | null;
  /** its size on the canvas, px (to turn a point between fixed and proportional without it jumping) */
  size: { w: number; h: number } | null;
  /** component shown picked on the canvas */
  showSel: string | null;
  set: (p: Partial<Omit<ShapeUi, 'set'>>) => void;
}

export const useShapeUi = create<ShapeUi>((set) => ({ editing: null, point: null, size: null, showSel: null, set: (p) => set(p) }));

/** Small drawing of a shape for its button. */
export function ShapeThumb({ pts }: { pts: ShapePt[] }) {
  const d = pts.map((p) => at(p, 120, 48)).map((q) => `${q.x},${q.y}`).join(' ');
  return (
    <svg className="shape-thumb" viewBox="-4 -4 128 56" aria-hidden>
      <polygon points={d} />
    </svg>
  );
}

/** Deepest fixed cut or point, px. */
const depthOf = (pts: ShapePt[]) => Math.max(0, ...pts.flatMap((p) => (p.p ? [] : [Math.abs(p.x.o), Math.abs(p.y.o)])));

const scaled = (p: ShapePt, k: number): ShapePt => (p.p ? p : { x: { f: p.x.f, o: Math.round(p.x.o * k) }, y: { f: p.y.f, o: Math.round(p.y.o * k) } });

type SetStyle = (patch: Partial<BarStyle>, field: string) => void;

export function ShapeFields({ style: s, set, canvasId }: { style: BarStyle; set: SetStyle; canvasId?: string }) {
  const pts = cleanShape(s.shape);
  const ui = useShapeUi();
  const editing = !!canvasId && ui.editing === canvasId;
  const depth = pts ? depthOf(pts) : 0;
  const pi = editing && ui.point != null && pts && ui.point < pts.length ? ui.point : null;
  const pt = pi != null ? pts![pi] : null;
  const setPts = (shape: ShapePt[] | undefined, field = 'shape') => set({ shape }, field);
  /** the picked point keeps its place but moves with the width (or stays a fixed distance from a side) */
  const toggleShare = (share: boolean) => {
    const { w, h } = ui.size ?? { w: 240, h: 72 };
    const q = at(pt!, w, h);
    setPts(pts!.map((p, i) => (i === pi ? place(q.x, q.y, w, h, share) : p)));
  };
  return (
    <>
      <Field label="形状" note={pts ? '尖角附近的字可能露到外面，可以把内边距调大' : undefined}>
        <div className="chips shape-chips">
          <button
            className={'small shape-chip' + (!pts ? ' on' : '')}
            onClick={() => {
              setPts(undefined);
              if (editing) ui.set({ editing: null, point: null });
            }}
          >
            <svg className="shape-thumb" viewBox="-4 -4 128 56" aria-hidden>
              <rect x="0" y="0" width="120" height="48" rx="8" />
            </svg>
            方块
          </button>
          {SHAPE_PRESETS.map((p) => (
            <button key={p.key} className="small shape-chip" onClick={() => setPts(p.make(depth || SHAPE_DEPTH))}>
              <ShapeThumb pts={p.make(SHAPE_DEPTH)} />
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      {pts && (
        <>
          {depth > 0 && (
            <Field label="尖角深度" note="手机上和电脑上一样深">
              <Slider value={depth} min={2} max={60} unit="px" noReset onChange={(d) => d && setPts(pts.map((p) => scaled(p, d / depth)), 'shape.depth')} />
            </Field>
          )}
          {canvasId && (
            <Field label="">
              <button className={'small' + (editing ? ' primary' : '')} onClick={() => ui.set({ editing: editing ? null : canvasId, point: null })}>
                {editing ? '改好了' : '在画布上改形状'}
              </button>
            </Field>
          )}
          {editing && (
            <div className="hint pad">
              鼠标移到边上会出现「＋」，点一下加一个点；拖点改形状，靠近别的点、中线或旁边组件的边时会吸过去（按住 Alt 不吸）；双击一个点删掉它。
            </div>
          )}
          {pt && (
            <Field label={`第 ${pi! + 1} 个点`}>
              <span className="inline">
                <label className="chk" title="不勾：离最近的边固定几像素，宽窄变了尖角深度不变">
                  <input type="checkbox" checked={!!pt.p} onChange={(e) => toggleShare(e.target.checked)} />
                  跟着宽度按比例移动
                </label>
                <button
                  className="small"
                  disabled={pts.length <= 3}
                  onClick={() => {
                    setPts(pts.filter((_, i) => i !== pi));
                    ui.set({ point: null });
                  }}
                >
                  删掉这个点
                </button>
              </span>
            </Field>
          )}
        </>
      )}
    </>
  );
}

/** The light line along the top and the glow around it. */
export function LightFields({ style: s, set, theme }: { style: BarStyle; set: SetStyle; theme: BarTheme }) {
  return (
    <>
      <Field label="顶部高光" note={s.hl ? undefined : '上边缘一条亮线，让块看起来有立体感'}>
        <span className="inline">
          <ColorInput value={s.hl} theme={theme} emptyLabel="没有" onChange={(hl) => set({ hl, ...(hl ? {} : { hlW: undefined }) }, 'hl')} />
          {s.hl && <Slider value={s.hlW} fallback={2} min={1} max={8} unit="px" onChange={(hlW) => set({ hlW }, 'hlW')} />}
        </span>
      </Field>
      <Field label="发光">
        <span className="inline">
          <ColorInput value={s.glow} theme={theme} emptyLabel="没有" onChange={(glow) => set({ glow, ...(glow ? {} : { glowR: undefined }) }, 'glow')} />
          {s.glow && <Slider value={s.glowR} fallback={8} min={2} max={40} unit="px" onChange={(glowR) => set({ glowR }, 'glowR')} />}
        </span>
      </Field>
    </>
  );
}

/**
 * Whether players can pick it, and the colors it has while picked.
 * `pick`: the switch (missing: the colors only, e.g. a repeat's items are switched on the repeat).
 */
export function SelFields({
  style: s,
  set,
  theme,
  pick,
  canvasId,
  noText,
}: {
  style: BarStyle;
  set: SetStyle;
  theme: BarTheme;
  pick?: { on: boolean; set: (on: boolean) => void; label: string };
  canvasId?: string;
  noText?: boolean;
}) {
  const sl = s.sel ?? {};
  const showSel = useShapeUi((u) => u.showSel);
  const setUi = useShapeUi((u) => u.set);
  const used = !!pick?.on || !!s.sel;
  const put = (patch: Partial<SelStyle>, field: string) => {
    const next = Object.fromEntries(Object.entries({ ...sl, ...patch }).filter(([, v]) => v !== undefined && v !== false)) as SelStyle;
    set({ sel: Object.keys(next).length ? next : undefined }, 'sel.' + field);
  };
  const showing = !!canvasId && showSel === canvasId;
  return (
    <details className="more" open={used || undefined}>
      <summary>选中时{used ? '（已设）' : ''}</summary>
      {pick && (
        <label className="chk pad">
          <input type="checkbox" checked={pick.on} onChange={(e) => pick.set(e.target.checked)} />
          {pick.label}
        </label>
      )}
      <div className="hint pad">
        {pick ? '玩家点一下就选中它，同一层里一次只选一个，再点一下取消；选了哪个会记在这条消息上。' : ''}
        没设颜色时，选中的会加一圈主色的边和光。
      </div>
      <Field label="填充">
        <FillInput value={sl.bg} theme={theme} onChange={(bg) => put({ bg }, 'bg')} />
      </Field>
      <Field label="描边">
        <ColorInput value={sl.border} theme={theme} emptyLabel="不变" onChange={(border) => put({ border }, 'border')} />
      </Field>
      <Field label="顶部高光">
        <ColorInput value={sl.hl} theme={theme} emptyLabel="不变" onChange={(hl) => put({ hl }, 'hl')} />
      </Field>
      {!noText && (
        <Field label="文字">
          <ColorInput value={sl.color} theme={theme} emptyLabel="不变" onChange={(color) => put({ color }, 'color')} />
        </Field>
      )}
      <Field label="发光">
        <ColorInput value={sl.glow} theme={theme} emptyLabel="不变" onChange={(glow) => put({ glow }, 'glow')} />
      </Field>
      <label className="chk pad">
        <input type="checkbox" checked={!!sl.hover} onChange={(e) => put({ hover: e.target.checked || undefined }, 'hover')} />
        鼠标放上去时也用这套颜色
      </label>
      {canvasId && (
        <div className="pad">
          <button className={'small' + (showing ? ' primary' : '')} onClick={() => setUi({ showSel: showing ? null : canvasId })}>
            {showing ? '看平时的样子' : '在画布上看选中的样子'}
          </button>
        </div>
      )}
    </details>
  );
}

/**
 * Keys while the selected component's shape is being edited: Delete drops the picked point (and never the
 * component), Esc stops editing.
 * True when the key was used for that.
 */
export function shapeKey(key: string, sel: string, drop: (pts: ShapePt[]) => void, pts: ShapePt[] | undefined): boolean {
  const ui = useShapeUi.getState();
  if (ui.editing !== sel) return false;
  if (key === 'escape') {
    ui.set({ editing: null, point: null });
    return true;
  }
  if (key === 'delete' || key === 'backspace') {
    // with no point picked it does nothing: the block itself is never deleted while its shape is being edited
    if (ui.point != null && pts && pts.length > 3) drop(pts.filter((_, i) => i !== ui.point));
    ui.set({ point: null });
    return true;
  }
  return false;
}
