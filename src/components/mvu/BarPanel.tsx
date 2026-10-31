// Middle panel on the status bar page: components to add, notices, and the settings of the selected component
// (or the colors and font of the whole status bar when nothing is selected).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addAt,
  addFromPalette,
  addVarsAtEnd,
  copyStyle,
  drag,
  duplicateSelected,
  moveSelected,
  PALETTE,
  PALETTE_GROUPS,
  pasteStyle,
  pickLayout,
  pickSkin,
  removeSelected,
  resetLayout,
  selectParent,
  updateNode,
} from '../../barActions';
import { useCard } from '../../cardStore';
import { CodeBox } from '../CodeBox';
import {
  barOf,
  cssProblems,
  okTag,
  splitUnits,
  unitSizes,
  compileBar,
  describe,
  editableVars,
  findNode,
  FONTS,
  IMAGE_KINDS,
  imageUrlOk,
  LOOP_SEC,
  newPage,
  indexVars,
  pathTo,
  placementProblem,
  rowNodes,
  scopeAt,
  THEME_COLOR_LABEL,
  THEME_COLORS,
  THEME_PRESETS,
  TYPE_LABEL,
  unplacedVars,
  type Bar,
  type BarNode,
  type BarStyle,
  type BarTheme,
  type FontName,
  type Action,
  type EnterAnim,
  type HoverFx,
  type LoopAnim,
  type TextFx,
  type Place,
  type ThemeColor,
  type NumFmt,
  type NumUnit,
  type ValueCase,
  type VarInfo,
  type Width,
  CASE_KINDS,
} from '../../mvu/bar';
import { eachNode, locate, updateVar } from '../../mvu/tree';
import type { VarNode } from '../../mvu/types';
import { Field, NumberInput } from '../common';
import { ColorInput, FillInput, IconPicker, Seg, Slider } from './barInputs';
import { BarMode, TextBarPanel } from './TextBarPanel';
import { dataKb, IMAGE_SIDES, imageToDataUrl, savedSide, saveSide } from '../../lib/image';
import { LAYOUTS, SKINS } from '../../mvu/barTemplates';

const selectBar = (id: string | null) => useCard.getState().selectBar(id);

/** A text box that a double click on the canvas jumps to. */
function useEditFocus<T extends HTMLInputElement | HTMLTextAreaElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    addEventListener('stbs-edit-text', focus);
    return () => removeEventListener('stbs-edit-text', focus);
  }, []);
  return ref;
}

const allowPlayerEdit = () => useCard.getState().edit((p) => ({ ...p, settings: { ...p.settings, allowPlayerEdit: true } }), 'settings');

/** Drop undefined keys; nothing left = undefined. */
function tidy<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

interface Ctx {
  bar: Bar;
  vars: VarNode[];
  idx: Map<string, VarInfo>;
  theme: BarTheme;
  node: BarNode;
  parent: BarNode | null;
  /** change this component; `field` groups quick changes (typing, dragging a slider) into one undo step */
  set: (patch: Partial<BarNode>, field: string) => void;
}

export function BarPanel() {
  const text = useCard((s) => !!s.project.textBar?.on);
  return (
    <div className="form scroll bar-panel">
      <BarMode />
      {text ? <TextBarPanel /> : <CanvasBarPanel />}
    </div>
  );
}

function CanvasBarPanel() {
  const vars = useCard((s) => s.project.vars);
  const saved = useCard((s) => s.project.bar);
  const sel = useCard((s) => s.barSel);
  const bar = useMemo(() => barOf({ bar: saved, vars }), [saved, vars]);
  const idx = useMemo(() => indexVars(vars), [vars]);
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const problems = useMemo(() => compileBar(bar, vars, { allowEdit }).problems, [bar, vars, allowEdit]);
  const unplaced = useMemo(() => (saved?.root ? unplacedVars(bar, vars) : []), [bar, vars, saved]);
  const node = findNode(bar.root, sel);
  const custom = !!saved?.root;

  return (
    <>
      <Palette />
      {!custom ? (
        <div className="callout">
          现在是<b>自动排版</b>：状态栏按左边的变量自动排好，加了新变量也会自己出现。
          <br />
          想自己摆的话直接动手就行（拖动、改样式都可以）。一旦动过，新加的变量就要自己拖进来了。
        </div>
      ) : (
        <div className="inline pad">
          <span className="hint">这是你自己摆的排版。</span>
          <button
            className="small"
            onClick={() => {
              if (confirm('回到自动排版吗？你摆的位置和单个组件的样式都会丢掉，整体配色会保留。（可以撤销）')) resetLayout();
            }}
          >
            恢复自动排版
          </button>
        </div>
      )}
      {unplaced.length > 0 && (
        <div className="callout warn-box">
          有 {unplaced.length} 个变量还没放上状态栏：{unplaced.map((v) => v.name).join('、')}
          <div className="inline">
            <button className="small" onClick={() => addVarsAtEnd(unplaced)}>
              全部加到最后
            </button>
            <span className="hint">也可以从左边一个个拖到画布上想放的位置</span>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <div className="callout bad-box">
          这些组件有问题，导出时会被跳过：
          {problems.map((p) => (
            <div key={p}>· {p}</div>
          ))}
        </div>
      )}
      {node ? <NodePanel key={node.id} bar={bar} vars={vars} idx={idx} node={node} /> : <ThemePanel theme={bar.theme} />}
      <Outline bar={bar} idx={idx} sel={sel} />
    </>
  );
}

/* ---------- adding components ---------- */

const PAL_ICON: Record<string, string> = {
  box: '▢',
  row: '↔',
  grid: '▦',
  repeat: '☷',
  tabs: '▤',
  fold: '▸',
  text: 'T',
  value: '=',
  bar: '▬',
  divider: '—',
  image: '🖼',
  button: '◉',
  menu: '☰',
  edit: '✎',
};

function Palette() {
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  return (
    <>
      {PALETTE_GROUPS.map(([g, name]) => (
        <div key={g} className="pal-group">
          <span className="pal-name">{name}</span>
          <div className="palette">
            {PALETTE.filter((p) => p.group === g && (p.key !== 'edit' || allowEdit)).map((p) => (
              <button
                key={p.key}
                className="pal"
                draggable
                title={p.hint + '\n点一下加到选中的位置，或者按住拖到画布上'}
                onDragStart={(e) => {
                  drag.item = { kind: 'new', key: p.key };
                  e.dataTransfer.setData('text/plain', p.label);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => (drag.item = null)}
                onClick={() => addFromPalette(p.key)}
              >
                <span className="pal-ic">{PAL_ICON[p.key]}</span>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="hint pal-hint">拖到右边画布上，或者点一下加到选中的地方。变量可以直接从左边拖过去。</div>
    </>
  );
}

/* ---------- every component, as a tree ---------- */

function Outline({ bar, idx, sel }: { bar: Bar; idx: Map<string, VarInfo>; sel: string | null }) {
  const rows: ReactNode[] = [];
  const go = (n: BarNode, depth: number) => {
    rows.push(
      <div key={n.id} className={'ol-item' + (n.id === sel ? ' on' : '')} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => selectBar(n.id)}>
        {depth === 0 ? '整个状态栏' : describe(n, idx)}
        {n.hidden && <span className="muted">（开局藏着）</span>}
      </div>,
    );
    n.children?.forEach((c) => go(c, depth + 1));
  };
  go(bar.root, 0);
  return (
    <details className="more outline">
      <summary>全部组件（{rows.length}）</summary>
      {rows}
    </details>
  );
}

/* ---------- the selected component ---------- */

function NodePanel({ bar, vars, idx, node }: { bar: Bar; vars: VarNode[]; idx: Map<string, VarInfo>; node: BarNode }) {
  const at = locate([bar.root], node.id);
  const parent = at?.parent ?? null;
  const isRoot = !parent;
  const set = (patch: Partial<BarNode>, field: string) => updateNode(node.id, patch, `bar:${node.id}:${field}`);
  const c: Ctx = { bar, vars, idx, theme: bar.theme, node, parent, set };
  const setStyle = (patch: Partial<BarStyle>, field: string) => set({ style: tidy({ ...node.style, ...patch }) }, 'style.' + field);
  const path = pathTo(bar.root, node.id);
  const inRow = parent?.type === 'box' && parent.dir === 'row';

  return (
    <>
      <div className="crumbs">
        {path.map((n, i) => (
          <span key={n.id}>
            {i > 0 && <span className="muted"> › </span>}
            <button className="link" onClick={() => selectBar(n.id)} disabled={n.id === node.id}>
              {i === 0 ? '整个状态栏' : describe(n, idx)}
            </button>
          </span>
        ))}
      </div>
      <div className="node-head">
        <b>{isRoot ? '整个状态栏' : describe(node, idx)}</b>
        <span className="sp" />
        {!isRoot && at && (
          <>
            <button className="small" onClick={selectParent} title="选中外面一层">
              选外层
            </button>
            <button className="small" disabled={at.index === 0} onClick={() => moveSelected(-1)} title="往前挪一位">
              ↑
            </button>
            <button className="small" disabled={at.index === at.siblings.length - 1} onClick={() => moveSelected(1)} title="往后挪一位">
              ↓
            </button>
            <button className="small" onClick={duplicateSelected} title="复制一份（Ctrl+D）">
              复制
            </button>
            <button className="small" onClick={removeSelected} title="删除（Delete）">
              删除
            </button>
          </>
        )}
        <button className="small" onClick={() => selectBar(null)} title="取消选中，改整体配色（Esc）">
          整体配色
        </button>
      </div>
      <PaintRow node={node} />
      {isRoot && <div className="hint pad">这是最外面那一层，状态栏的底色、边框都在这里改。</div>}
      {node.type === 'box' && <BoxFields c={c} />}
      {node.type === 'repeat' && <RepeatFields c={c} />}
      {node.type === 'text' && <TextFields c={c} />}
      {node.type === 'value' && <ValueFields c={c} />}
      {node.type === 'bar' && <BarFields c={c} />}
      {node.type === 'divider' && <DividerFields c={c} />}
      {node.type === 'image' && <ImageFields c={c} />}
      {node.type === 'button' && <ButtonFields c={c} />}
      {node.type === 'menu' && <MenuFields c={c} />}
      {node.type === 'tabs' && <TabsFields c={c} />}
      {node.type === 'fold' && <FoldFields c={c} />}
      <h4 className="sec">{STYLE_TITLE[node.type] ?? '外观'}</h4>
      <StyleFields
        style={node.style}
        set={setStyle}
        theme={bar.theme}
        inRow={inRow}
        noText={node.type === 'image'}
        solidBorder={node.type === 'image' || node.type === 'divider'}
        gradText={GRAD_TEXT.has(node.type)}
        stagger={node.type === 'box' || node.type === 'repeat' ? { on: !!node.stagger, set: (on) => set({ stagger: on || undefined }, 'stagger') } : undefined}
      />
      {!isRoot && parent?.type !== 'tabs' && <HiddenFields c={c} />}
      <TagField c={c} />
    </>
  );
}

/** Advanced: an extra class name, so CSS written by hand can pick this component. */
function TagField({ c }: { c: Ctx }) {
  const n = c.node;
  const [draft, setDraft] = useState(n.tag ?? '');
  const bad = draft !== '' && !okTag(draft);
  return (
    <details className="more" open={!!n.tag || undefined}>
      <summary>进阶：类名</summary>
      <Field label="类名" note="给它起个英文名字，就能在整体配色最下面的「自己写 CSS」里用 .名字 单独改它。几个组件可以用同一个名字">
        <input
          value={draft}
          placeholder="比如 hp-line"
          onChange={(e) => {
            const t = e.target.value.trim();
            setDraft(t);
            if (t === '' || okTag(t)) c.set({ tag: t || undefined }, 'tag');
          }}
        />
      </Field>
      {bad && <div className="warn">只能用英文字母、数字、- 和 _，要以字母开头，不能用 sb- 开头</div>}
    </details>
  );
}

/** Components whose own words can be in a gradient. */
const GRAD_TEXT = new Set<BarNode['type']>(['text', 'button', 'menu']);

/** Format painter: copy this component's look, paste a copied one here or onto every component of that kind. */
function PaintRow({ node }: { node: BarNode }) {
  const clip = useCard((s) => s.barClip);
  const same = clip?.type === node.type;
  return (
    <div className="inline paint-row">
      <span className="hint">格式刷</span>
      <button className="small" onClick={copyStyle} title="记下这个组件的颜色、边框、字体、动效这些样子">
        复制样式
      </button>
      <button
        className="small"
        disabled={!clip}
        onClick={() => pasteStyle()}
        title={!clip ? '先在别的组件上点「复制样式」' : same ? '把复制的样子用到这里' : `复制的是${TYPE_LABEL[clip.type]}，不同种类只粘贴颜色、边框、字体这些通用的`}
      >
        粘贴样式
      </button>
      {clip && (
        <button
          className="small"
          onClick={() => {
            if (confirm(`把复制的样式用到所有「${TYPE_LABEL[clip.type]}」上吗？（可以撤销）`)) pasteStyle(true);
          }}
          title={`用到状态栏里所有的${TYPE_LABEL[clip.type]}`}
        >
          用到所有{TYPE_LABEL[clip.type]}
        </button>
      )}
    </div>
  );
}

const STYLE_TITLE: Partial<Record<BarNode['type'], string>> = { image: '边框和阴影', repeat: '整块的外观', button: '按钮的外观', menu: '菜单按钮的外观', tabs: '整块的外观', fold: '整块的外观' };

const BOX_LOOKS: { label: string; style?: BarStyle }[] = [
  { label: '卡片', style: { bg: { a: '@card' }, radius: 10, pad: 10 } },
  { label: '描边', style: { borderW: 1, borderColor: '@line', radius: 8, pad: 8 } },
  { label: '左边一条线', style: { borderW: 3, borderColor: '@accent', borderSide: 'left', pad: 8 } },
  { label: '渐变', style: { bg: { a: '@card', b: '@line', angle: 135 }, borderW: 1, borderColor: '@line', radius: 10, pad: 10 } },
  { label: '发光', style: { bg: { a: '@card' }, borderW: 1, borderColor: '@accent', radius: 12, pad: 10, shadow: 'glow' } },
  { label: '浮起', style: { bg: { a: '@card' }, radius: 12, pad: 12, shadow: 'float' } },
  { label: '什么都不要' },
];

function LayoutFields({ c, fallbackGap }: { c: Ctx; fallbackGap: number }) {
  const n = c.node;
  return (
    <>
      <Field label={n.type === 'repeat' ? '张与张' : '里面怎么排'}>
        <span className="inline">
          <Seg
            value={n.dir ?? 'col'}
            options={[
              ['col', '从上到下'],
              ['row', '从左到右'],
              ['grid', '网格'],
            ]}
            onChange={(dir) => c.set({ dir }, 'dir')}
          />
          {n.dir === 'grid' && (
            <>
              <span className="hint">每行</span>
              <select className="small-select" value={n.cols ?? 2} onChange={(e) => c.set({ cols: Number(e.target.value) }, 'cols')}>
                {[1, 2, 3, 4, 5, 6].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="hint">个</span>
            </>
          )}
        </span>
      </Field>
      <Field label="间距">
        <Slider value={n.gap} fallback={fallbackGap} min={0} max={40} unit="px" onChange={(gap) => c.set({ gap }, 'gap')} />
      </Field>
    </>
  );
}

function BoxFields({ c }: { c: Ctx }) {
  const n = c.node;
  const tabs = c.parent?.type === 'tabs' ? c.parent : null;
  const pageNo = tabs ? (tabs.children ?? []).findIndex((k) => k.id === n.id) : -1;
  return (
    <>
      {tabs && (
        <Field label="页名" note="显示在标签上">
          <input value={n.title ?? ''} placeholder={`第${pageNo + 1}页`} onChange={(e) => c.set({ title: e.target.value || undefined }, 'title')} />
        </Field>
      )}
      <LayoutFields c={c} fallbackGap={8} />
      <Field label="一键样式" note="套用之后，下面的「外观」还能细调">
        <div className="chips">
          {BOX_LOOKS.map((l) => (
            <button key={l.label} className="small" onClick={() => c.set({ style: tidy({ ...l.style, width: n.style?.width }) }, 'look')}>
              {l.label}
            </button>
          ))}
        </div>
      </Field>
      <div className="hint pad">
        里面有 {n.children?.length ?? 0} 样东西。{n.children?.length ? '' : '从上面拖组件、从左边拖变量放进来。'}
      </div>
    </>
  );
}

/** Components shown inside a repeat that point at `v` or its fields. */
function shownIn(n: BarNode) {
  const vars = new Set<string>();
  const parts = new Set<string>();
  for (const k of eachNode(n.children ?? [])) {
    if (!k.bind) continue;
    if (k.bind.part) parts.add(k.bind.var + '|' + k.bind.part);
    else vars.add(k.bind.var);
  }
  return { vars, parts };
}

function RepeatFields({ c }: { c: Ctx }) {
  const n = c.node;
  const v = n.bind ? c.idx.get(n.bind.var)?.v : undefined;
  const { vars: shownVars, parts } = shownIn(n);
  const missing: BarNode[] = [];
  if (v?.kind === 'table') {
    const all = rowNodes(v);
    if (!parts.has(v.id + '|name')) missing.push(all[0]);
    (v.children ?? []).forEach((f, i) => {
      if (!shownVars.has(f.id)) missing.push(all[i + 1]);
    });
  } else if (v?.kind === 'list' && !parts.has(v.id + '|item')) missing.push(...rowNodes(v));

  const rebind = (bind: BarNode['bind']) => {
    const nv = bind ? c.idx.get(bind.var)?.v : undefined;
    // keep what still works with the new table, start fresh otherwise
    const tmp = updateVar([c.bar.root], n.id, { bind, children: [] })[0];
    const keep = (n.children ?? []).filter((k) => !placementProblem(tmp, c.vars, k, n.id));
    c.set({ bind, children: keep.length ? keep : nv ? rowNodes(nv) : [] }, 'bind');
  };

  return (
    <>
      <Field label="每项来自" note="表格的每一行、列表的每一项，都照着里面摆的样子画一张">
        <BindSelect c={c} accept={(x) => x.kind === 'table' || x.kind === 'list'} onPick={rebind} />
      </Field>
      {missing.length > 0 && (
        <Field label="">
          <button className="small" onClick={() => c.set({ children: [...(n.children ?? []), ...missing] }, 'add-fields')}>
            把还没放进来的加上（{missing.map((m) => describe(m, c.idx)).join('、')}）
          </button>
        </Field>
      )}
      <Field label="每一张里">
        <Seg
          value={n.inner ?? 'col'}
          options={[
            ['row', '排成一行'],
            ['col', '从上到下'],
          ]}
          onChange={(inner) => c.set({ inner }, 'inner')}
        />
      </Field>
      <LayoutFields c={c} fallbackGap={6} />
      <Field label="一张都没有时" note={n.hideEmpty ? '整块（连同边框和底色）都不显示' : '清空就只剩一个空框'}>
        {!n.hideEmpty && <input value={n.emptyText ?? '暂无'} onChange={(e) => c.set({ emptyText: e.target.value }, 'empty')} />}
        <label className="chk">
          <input type="checkbox" checked={!!n.hideEmpty} onChange={(e) => c.set({ hideEmpty: e.target.checked || undefined }, 'hideEmpty')} />
          干脆整块藏起来
        </label>
      </Field>
      <h4 className="sec">每一张的外观</h4>
      <StyleFields style={n.itemStyle} set={(patch, f) => c.set({ itemStyle: tidy({ ...n.itemStyle, ...patch }) }, 'item.' + f)} theme={c.theme} />
    </>
  );
}

function TextFields({ c }: { c: Ctx }) {
  const ref = useEditFocus<HTMLTextAreaElement>();
  return (
    <Field label="文字" note="可以换行。在画布上双击文字也能跳到这里">
      <textarea ref={ref} rows={2} value={c.node.text ?? ''} onChange={(e) => c.set({ text: e.target.value }, 'text')} />
    </Field>
  );
}

/** Pick the variable a component shows. Choices that can't be shown at this spot are greyed out. */
function BindSelect({ c, accept, special, onPick }: { c: Ctx; accept: (v: VarNode) => boolean; special?: boolean; onPick?: (b: BarNode['bind']) => void }) {
  const n = c.node;
  const parentId = c.parent?.id;
  const root = c.bar.root;
  const problemFor = (bind: BarNode['bind']) => (parentId ? placementProblem(root, c.vars, { ...n, bind, children: [] }, parentId) : null);

  const opts: { value: string; label: string; problem: string | null }[] = [];
  if (special && parentId) {
    for (const id of scopeAt(root, parentId)) {
      const v = c.idx.get(id)?.v;
      if (v?.kind === 'table') opts.push({ value: id + '|name', label: `「${v.name}」每一行的${v.rowName || '名字'}`, problem: problemFor({ var: id, part: 'name' }) });
      if (v?.kind === 'list') opts.push({ value: id + '|item', label: `「${v.name}」里的每一项`, problem: problemFor({ var: id, part: 'item' }) });
    }
  }
  for (const info of c.idx.values()) {
    if (accept(info.v)) opts.push({ value: info.v.id, label: info.label, problem: problemFor({ var: info.v.id }) });
  }
  const cur = n.bind ? n.bind.var + (n.bind.part ? '|' + n.bind.part : '') : '';
  const gone = !!n.bind && !c.idx.has(n.bind.var);
  const curProblem = n.bind && !gone ? problemFor(n.bind) : null;

  const pick = (value: string) => {
    const [id, part] = value.split('|');
    const bind = { var: id, ...(part ? { part: part as 'name' | 'item' } : {}) };
    if (onPick) return onPick(bind);
    const v = c.idx.get(id)?.v;
    const patch: Partial<BarNode> = { bind };
    if (n.type === 'bar') patch.showStage = !!v?.stages?.length;
    if (n.type === 'value') patch.show = undefined;
    c.set(patch, 'bind');
  };

  return (
    <>
      <select value={gone ? '!' : cur} onChange={(e) => pick(e.target.value)}>
        {!n.bind && <option value="">（还没选）</option>}
        {gone && <option value="!">（原来的变量删掉了，重新选一个）</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value} disabled={!!o.problem && o.value !== cur} title={o.problem ?? ''}>
            {o.label}
            {o.problem ? '（这里放不了）' : ''}
          </option>
        ))}
      </select>
      {curProblem && <div className="err">{curProblem}</div>}
      {!opts.length && <div className="hint">还没有能选的变量，先在左边加一个。</div>}
    </>
  );
}

const ICONS = ['❤', '⭐', '💰', '📍', '⏰', '⚔', '🛡', '⚡', '💧', '🔥', '🌙', '🎒'];

/** Name in front of a value or a bar, and the icon. */
function NameFields({ c }: { c: Ctx }) {
  const n = c.node;
  const v = n.bind ? c.idx.get(n.bind.var)?.v : undefined;
  const auto = n.bind?.part ? '' : v?.name ?? '';
  const [typing, setTyping] = useState(n.label !== undefined && n.label !== '');
  const mode = typing ? 'custom' : n.label === undefined ? 'auto' : 'none';
  return (
    <>
      <Field label="名字">
        <Seg
          value={mode}
          options={[
            ['auto', auto ? `变量名（${auto}）` : '变量名'],
            ['custom', '自己写'],
            ['none', '不显示'],
          ]}
          onChange={(m) => {
            setTyping(m === 'custom');
            c.set({ label: m === 'auto' ? undefined : m === 'none' ? '' : n.label || auto || '名字' }, 'label');
          }}
        />
        {mode === 'custom' && <input value={n.label ?? ''} onChange={(e) => c.set({ label: e.target.value }, 'label')} />}
        {(mode !== 'none' && (auto || mode === 'custom')) && (
          <span className="inline">
            <label className="chk">
              <input type="checkbox" checked={!!n.colon} onChange={(e) => c.set({ colon: e.target.checked || undefined }, 'colon')} />
              后面加冒号
            </label>
            <label className="chk">
              <input type="checkbox" checked={!!n.stack} onChange={(e) => c.set({ stack: e.target.checked || undefined }, 'stack')} />
              名字单独一行
            </label>
            <span className="hint">颜色</span>
            <ColorInput value={n.labelColor} theme={c.theme} fallback={c.theme.dim} onChange={(labelColor) => c.set({ labelColor }, 'labelColor')} />
          </span>
        )}
      </Field>
      <Field label="图标" note="放在最前面的小符号，可以自己输入">
        <IconPicker value={n.icon} quick={ICONS} onChange={(icon, f) => c.set({ icon }, f === 'type' ? 'icon' : 'icon-pick')} />
      </Field>
    </>
  );
}

/** Color, size and weight of the value itself. */
function ValueLook({ c, pill }: { c: Ctx; pill?: boolean }) {
  const n = c.node;
  return (
    <>
      <Field label="颜色" note={pill && n.pill && n.valGrad ? '有圆角底时不显示渐变' : undefined}>
        <FillInput
          value={n.valGrad ?? (n.valColor ? { a: n.valColor } : undefined)}
          theme={c.theme}
          fallback={c.theme.text}
          onChange={(f) => c.set({ valColor: f?.a, valGrad: f?.b ? f : undefined }, 'valColor')}
        />
      </Field>
      <Field label="字号">
        <Slider value={n.valSize} fallback={c.theme.size} min={8} max={40} unit="px" onChange={(valSize) => c.set({ valSize }, 'valSize')} />
      </Field>
      <Field label="">
        <span className="inline">
          <label className="chk">
            <input type="checkbox" checked={!!n.valBold} onChange={(e) => c.set({ valBold: e.target.checked || undefined }, 'valBold')} />
            加粗
          </label>
          {pill && (
            <label className="chk">
              <input type="checkbox" checked={!!n.pill} onChange={(e) => c.set({ pill: e.target.checked || undefined }, 'pill')} />
              加一个圆角底
            </label>
          )}
        </span>
      </Field>
    </>
  );
}

function ValueFields({ c }: { c: Ctx }) {
  const n = c.node;
  const info = n.bind ? c.idx.get(n.bind.var) : undefined;
  const v = info?.v;
  const part = n.bind?.part;
  const staged = !part && !!info?.stage && !info.table;
  return (
    <>
      <Field label="显示哪个">
        <BindSelect c={c} accept={(x) => x.kind !== 'group'} special />
      </Field>
      <NameFields c={c} />
      {staged && (
        <Field label="显示" note="这个数字设了阶段（比如好感度的「朋友」「恋人」）">
          <Seg
            value={n.show ?? 'value'}
            options={[
              ['value', '数字'],
              ['stage', '阶段名'],
              ['both', '都显示'],
            ]}
            onChange={(show) => c.set({ show }, 'show')}
          />
        </Field>
      )}
      {v?.kind === 'bool' && !part && (
        <Field label="显示成">
          <span className="inline">
            <span className="hint">是</span>
            <input className="short" value={n.yes ?? '是'} onChange={(e) => c.set({ yes: e.target.value }, 'yes')} />
            <span className="hint">否</span>
            <input className="short" value={n.no ?? '否'} onChange={(e) => c.set({ no: e.target.value }, 'no')} />
          </span>
        </Field>
      )}
      {(v?.kind === 'list' || v?.kind === 'table') && !part && (
        <Field label="好几项时">
          <span className="inline">
            <Seg
              value={n.listAs ?? 'chips'}
              options={[
                ['chips', '一个个小标签'],
                ['text', '连成一行字'],
              ]}
              onChange={(listAs) => c.set({ listAs: listAs === 'chips' ? undefined : listAs }, 'listAs')}
            />
            {n.listAs === 'text' && (
              <>
                <span className="hint">中间用</span>
                <input className="num" value={n.sep ?? '、'} onChange={(e) => c.set({ sep: e.target.value || undefined }, 'sep')} />
                <span className="hint">隔开</span>
              </>
            )}
          </span>
        </Field>
      )}
      <Field label="前后加字" note="比如后面加「金币」「岁」">
        <span className="inline">
          <input className="short" placeholder="前面" value={n.prefix ?? ''} onChange={(e) => c.set({ prefix: e.target.value || undefined }, 'prefix')} />
          <span className="hint">值</span>
          <input className="short" placeholder="后面" value={n.suffix ?? ''} onChange={(e) => c.set({ suffix: e.target.value || undefined }, 'suffix')} />
        </span>
      </Field>
      {!part && v?.kind === 'number' && n.show !== 'stage' && <NumFmtFields c={c} range={[v.min, v.max]} />}
      <Field label="没有值时">
        <span className="inline">
          <span className="hint">显示</span>
          <input className="short" placeholder="—" value={n.empty ?? ''} onChange={(e) => c.set({ empty: e.target.value || undefined }, 'emptyVal')} />
          <label className="chk">
            <input type="checkbox" checked={!!n.hideEmpty} onChange={(e) => c.set({ hideEmpty: e.target.checked || undefined }, 'hideEmpty')} />
            干脆整个藏起来
          </label>
        </span>
      </Field>
      <h4 className="sec">值的样子</h4>
      <ValueLook c={c} pill />
      {(part === 'name' || part === 'item' || (!part && v && CASE_KINDS.has(v.kind))) && (
        <CaseFields c={c} v={part ? undefined : v} numeric={!part && v?.kind === 'number'} />
      )}
    </>
  );
}

const UNIT_PRESETS: { name: string; units: NumUnit[]; hint: string }[] = [
  { name: '金 银 铜（100 进位）', units: [{ name: '金', per: 100 }, { name: '银', per: 100 }, { name: '铜' }], hint: '变量里记的是一共多少铜' },
  { name: '金 银 铜（10 进位）', units: [{ name: '金', per: 10 }, { name: '银', per: 10 }, { name: '铜' }], hint: '变量里记的是一共多少铜' },
  { name: '天 小时 分钟', units: [{ name: '天', per: 24 }, { name: '小时', per: 60 }, { name: '分钟' }], hint: '变量里记的是一共多少分钟' },
  { name: '小时 分 秒', units: [{ name: '小时', per: 60 }, { name: '分', per: 60 }, { name: '秒' }], hint: '变量里记的是一共多少秒' },
  { name: '年 月 天（一个月 30 天）', units: [{ name: '年', per: 12 }, { name: '个月', per: 30 }, { name: '天' }], hint: '变量里记的是一共多少天' },
  { name: '斤 两', units: [{ name: '斤', per: 10 }, { name: '两' }], hint: '变量里记的是一共多少两' },
];

/** How the number is written: decimal places, commas, divided, percent, or split into units like 1金 5银. */
function NumFmtFields({ c, range, bar }: { c: Ctx; range: [number | null | undefined, number | null | undefined]; bar?: boolean }) {
  const f: NumFmt = c.node.fmt ?? {};
  const mode = f.units ? 'units' : f.pct ? 'pct' : f.div != null ? 'div' : 'plain';
  const put = (next: NumFmt | undefined, key: string) => c.set({ fmt: next && tidy(next) }, 'fmt.' + key);
  const [lo, hi] = range;
  const hasRange = typeof lo === 'number' && typeof hi === 'number' && hi > lo;
  const units = f.units ?? [];
  const setUnit = (i: number, patch: Partial<NumUnit>) => put({ units: units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }, `unit${i}`);
  const sizes = unitSizes(units);
  const sample = sizes ? sizes[0][0] + (sizes[1]?.[0] ?? 1) * 3 + 7 : 0;
  return (
    <details className="more" open={!!c.node.fmt || undefined}>
      <summary>数字怎么写{c.node.fmt ? '（改过）' : ''}</summary>
      <Field label="换算">
        <Seg
          value={mode}
          options={[
            ['plain', '原样'],
            ['div', '除以'],
            ['pct', '百分比'],
            ['units', '拆成单位'],
          ]}
          onChange={(m) =>
            put(
              m === 'plain' ? { dp: f.dp, comma: f.comma } : m === 'div' ? { dp: f.dp, comma: f.comma, div: f.div ?? 10000 } : m === 'pct' ? { dp: f.dp, pct: true } : { units: f.units ?? UNIT_PRESETS[0].units },
              'mode',
            )
          }
        />
      </Field>
      {mode === 'div' && (
        <Field label="除以" note="比如除以 10000，再在「前后加字」的后面写「万」">
          <NumberInput value={f.div} onChange={(div) => put({ ...f, div: div ?? 1 }, 'div')} />
        </Field>
      )}
      {mode === 'pct' && (
        <div className="hint pad">
          {hasRange ? `按 ${lo} 到 ${hi} 算，${lo} 是 0%，${hi} 是 100%。` : bar ? '' : '这个变量没有同时设最小值和最大值，算不出百分比，会照原样显示。'}
          {bar && '「/ 最大值」不会再显示。'}
        </div>
      )}
      {mode === 'units' ? (
        <>
          <Field label="现成的">
            <select
              value=""
              onChange={(e) => {
                const p = UNIT_PRESETS.find((x) => x.name === e.target.value);
                if (p) put({ units: structuredClone(p.units) }, 'preset');
              }}
            >
              <option value="">选一个…</option>
              {UNIT_PRESETS.map((p) => (
                <option key={p.name} value={p.name} title={p.hint}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="hint pad">从大到小写。变量里记的是最小那个单位一共有多少，显示时自动拆开，是 0 的单位不显示。{sizes && `比如 ${sample} 会写成「${splitUnits(sample, sizes)}」`}</div>
          {units.map((u, i) => (
            <div className="case-row" key={i}>
              <input className="short" value={u.name} placeholder="单位" onChange={(e) => setUnit(i, { name: e.target.value })} />
              {i < units.length - 1 ? (
                <>
                  <span className="hint">1{u.name || '个'} =</span>
                  <NumberInput value={u.per ?? 10} onChange={(per) => setUnit(i, { per })} />
                  <span className="hint">{units[i + 1]?.name || '下一个'}</span>
                </>
              ) : (
                <span className="hint">最小的单位</span>
              )}
              {units.length > 2 && (
                <button className="small" onClick={() => put({ units: units.filter((_, j) => j !== i) }, 'unitDel')}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="inline">
            <button className="small" onClick={() => put({ units: [{ name: '', per: 10 }, ...units] }, 'unitAdd')}>
              ＋ 前面加一个更大的
            </button>
          </div>
        </>
      ) : (
        <Field label="小数">
          <span className="inline">
            <select value={f.dp ?? ''} onChange={(e) => put({ ...f, dp: e.target.value === '' ? undefined : Number(e.target.value) }, 'dp')}>
              <option value="">自动（最多两位）</option>
              <option value="0">不要小数</option>
              <option value="1">一位</option>
              <option value="2">两位</option>
              <option value="3">三位</option>
            </select>
            {mode !== 'pct' && (
              <label className="chk">
                <input type="checkbox" checked={!!f.comma} onChange={(e) => put({ ...f, comma: e.target.checked || undefined }, 'comma')} />
                每三位加逗号（12,345）
              </label>
            )}
          </span>
        </Field>
      )}
    </details>
  );
}

const BAR_SYMS = ['★', '♥', '●', '◆', '❤️', '⭐', '🔥', '💧', '⚡', '🌙', '💎', '🍀'];

const LOOK_SIZE: Record<NonNullable<BarNode['barLook']>, { label: string; def: number; min: number; max: number }> = {
  line: { label: '粗细', def: 8, min: 2, max: 30 },
  seg: { label: '每格高度', def: 8, min: 2, max: 30 },
  ring: { label: '圆环大小', def: 44, min: 20, max: 160 },
  icons: { label: '符号大小', def: 18, min: 10, max: 60 },
};

function BarFields({ c }: { c: Ctx }) {
  const n = c.node;
  const info = n.bind ? c.idx.get(n.bind.var) : undefined;
  const v = info?.v;
  const staged = !!info?.stage && !info.table;
  const look = n.barLook ?? 'line';
  return (
    <>
      <Field label="显示哪个" note="只能选数字">
        <BindSelect c={c} accept={(x) => x.kind === 'number'} />
      </Field>
      <Field label="满格是多少" note="不填就用变量自己设的最小、最大值">
        <span className="inline">
          <NumberInput optional value={n.min} placeholder={String(v?.min ?? 0)} onChange={(min) => c.set({ min }, 'min')} />
          <span className="hint">到</span>
          <NumberInput optional value={n.max} placeholder={String(v?.max ?? 100)} onChange={(max) => c.set({ max }, 'max')} />
        </span>
      </Field>
      <NameFields c={c} />
      <Field label="数字">
        <Seg
          value={look === 'icons' && n.num === 'inside' ? 'after' : n.num ?? 'after'}
          options={[
            ['after', look === 'ring' ? '在圈后面' : look === 'icons' ? '在后面' : '在条后面'],
            ...(look === 'icons' ? [] : ([['inside', look === 'ring' ? '在圈中间' : '在条里面']] as [NonNullable<BarNode['num']>, string][])),
            ['none', '不显示'],
          ]}
          onChange={(num) => c.set({ num }, 'num')}
        />
        <span className="inline">
          <label className="chk">
            <input type="checkbox" checked={!!n.showMax} onChange={(e) => c.set({ showMax: e.target.checked || undefined }, 'showMax')} />
            带上「/ 最大值」
          </label>
          {staged && (
            <label className="chk">
              <input type="checkbox" checked={!!n.showStage} onChange={(e) => c.set({ showStage: e.target.checked }, 'showStage')} />
              显示阶段名
            </label>
          )}
        </span>
      </Field>
      {n.num !== 'none' && <NumFmtFields c={c} range={[n.min ?? v?.min ?? 0, n.max ?? v?.max ?? 100]} bar />}
      <h4 className="sec">条的样子</h4>
      <Field label="样式">
        <Seg
          value={look}
          options={[
            ['line', '一条'],
            ['seg', '分格'],
            ['ring', '圆环'],
            ['icons', '一排符号'],
          ]}
          onChange={(barLook) =>
            c.set(
              {
                barLook: barLook === 'line' ? undefined : barLook,
                height: undefined,
                num: barLook === 'ring' && (n.num ?? 'after') === 'after' ? 'inside' : barLook !== 'ring' && look === 'ring' && n.num === 'inside' ? undefined : n.num,
              },
              'barLook',
            )
          }
        />
      </Field>
      {look === 'seg' && (
        <Field label="分几格">
          <Slider value={n.count} fallback={10} min={2} max={30} noReset onChange={(count) => c.set({ count }, 'count')} />
        </Field>
      )}
      {look === 'icons' && (
        <>
          <Field label="符号" note="可以自己输入；彩色表情（比如 ❤️）没亮的会变灰">
            <IconPicker value={n.sym} fallback="★" quick={BAR_SYMS} onChange={(sym, f) => c.set({ sym }, f === 'type' ? 'sym' : 'sym-pick')} />
          </Field>
          <Field label="一共几个">
            <Slider value={n.count} fallback={5} min={1} max={20} noReset onChange={(count) => c.set({ count }, 'count')} />
            <label className="chk">
              <input type="checkbox" checked={!!n.whole} onChange={(e) => c.set({ whole: e.target.checked || undefined }, 'whole')} />
              只亮整个的（不显示半个）
            </label>
          </Field>
        </>
      )}
      <Field label={look === 'ring' ? '圆环颜色' : look === 'icons' ? '亮起的颜色' : '条的颜色'} note={look === 'icons' ? '符号只用第一个颜色' : undefined}>
        <FillInput value={n.fill} theme={c.theme} fallback={`linear-gradient(90deg, ${c.theme.accent}, ${c.theme.accent2})`} onChange={(fill) => c.set({ fill }, 'fill')} />
      </Field>
      <Field label={look === 'icons' ? '没亮的颜色' : '底槽颜色'}>
        <ColorInput value={n.track} theme={c.theme} fallback={c.theme.line} onChange={(track) => c.set({ track }, 'track')} />
      </Field>
      <Field label={LOOK_SIZE[look].label}>
        <Slider value={n.height} fallback={LOOK_SIZE[look].def} min={LOOK_SIZE[look].min} max={LOOK_SIZE[look].max} unit="px" onChange={(height) => c.set({ height }, 'height')} />
      </Field>
      <Field label="">
        <label className="chk">
          <input type="checkbox" checked={!!n.grow} onChange={(e) => c.set({ grow: e.target.checked || undefined }, 'grow')} />
          {look === 'ring' ? '消息出来时圆环转进来' : look === 'seg' ? '消息出来时格子渐渐亮起' : '消息出来时从 0 长到现在的值'}
        </label>
      </Field>
      <h4 className="sec">数字的样子</h4>
      <ValueLook c={c} />
      <CaseFields c={c} v={v} numeric bar />
    </>
  );
}

/** Ready-made color steps for a number from lo to hi. */
function casePresets(lo: number, hi: number): { label: string; cases: ValueCase[]; smooth?: boolean }[] {
  const at = (f: number) => Math.round(lo + (hi - lo) * f);
  return [
    { label: '低灰高粉（好感度）', cases: [{ at: lo, color: '#9e9e9e' }, { at: hi, color: '#ff5c9a' }], smooth: true },
    { label: '红黄绿（血量）', cases: [{ at: lo, color: '#e53935' }, { at: at(0.3), color: '#fbc02d' }, { at: at(0.6), color: '#43a047' }] },
    { label: '绿黄红（压力）', cases: [{ at: lo, color: '#43a047' }, { at: at(0.5), color: '#fbc02d' }, { at: at(0.8), color: '#e53935' }] },
    { label: '冷到热', cases: [{ at: lo, color: '#42a5f5' }, { at: at(0.5), color: '#ab47bc' }, { at: hi, color: '#ff7043' }], smooth: true },
  ];
}

/**
 * Color, icon and words that follow the value (e.g. 好感度 grey when low, pink when high; 心情 with its own icon),
 * and an arrow showing how the number changed since the previous message.
 */
function CaseFields({ c, v, numeric, bar }: { c: Ctx; v?: VarNode; numeric: boolean; bar?: boolean }) {
  const n = c.node;
  const cases = n.cases ?? [];
  const put = (next: ValueCase[], field: string) => c.set({ cases: next.length ? next : undefined }, field);
  const lo = n.min ?? v?.min ?? 0;
  const hi = n.max ?? v?.max ?? 100;
  const what = bar ? (n.barLook === 'icons' ? '亮起的符号' : '条') : '值';

  /** one row: color, icon, words */
  const looks = (k: ValueCase, change: (patch: Partial<ValueCase>, field: string) => void) => (
    <>
      <ColorInput value={k.color} theme={c.theme} emptyLabel="不变" onChange={(color) => change({ color }, 'color')} />
      <IconPicker value={k.icon} quick={[]} placeholder="图标" onChange={(icon, f) => change({ icon }, f === 'type' ? 'icon' : 'icon-pick')} />
      <input className="short" placeholder="后面的字" value={k.text ?? ''} onChange={(e) => change({ text: e.target.value || undefined }, 'text')} />
    </>
  );
  const changeAt = (i: number) => (patch: Partial<ValueCase>, field: string) => put(cases.map((k, j) => (j === i ? { ...k, ...patch } : k)), `case.${i}.${field}`);

  /** words: one row per known value (choices, yes / no), or rows the author adds */
  const fixed: { at: string; label: string }[] | null =
    v?.kind === 'choice' ? (v.options ?? []).map((o) => ({ at: o, label: o })) : v?.kind === 'bool' ? [{ at: 'true', label: n.yes ?? '是' }, { at: 'false', label: n.no ?? '否' }] : null;
  const changeWord = (at: string) => (patch: Partial<ValueCase>, field: string) => {
    const i = cases.findIndex((k) => k.at === at);
    const next = { ...(i >= 0 ? cases[i] : { at }), ...patch };
    const empty = !next.color && !next.icon && !next.text;
    put(i >= 0 ? (empty ? cases.filter((_, j) => j !== i) : cases.map((k, j) => (j === i ? next : k))) : empty ? cases : [...cases, next], `case.${at}.${field}`);
  };

  return (
    <>
      <h4 className="sec">按数值变</h4>
      <div className="hint pad">
        {numeric
          ? `${what}的颜色、前面的图标、后面的字跟着数字变。每一档从它的数字开始，到下一档为止；比第一档还小时按第一档。`
          : `${what}的颜色、前面的图标、后面的字跟着内容变，比如心情是「开心」时显示 😊。`}
      </div>
      {numeric && (
        <>
          {cases.map((k, i) => (
            <div className="case-row" key={i}>
              <span className="hint">从</span>
              <NumberInput value={typeof k.at === 'number' ? k.at : 0} onChange={(x) => x !== undefined && changeAt(i)({ at: x }, 'at')} />
              <span className="hint">起</span>
              {looks(k, changeAt(i))}
              <button className="small" title="删掉这一档" onClick={() => put(cases.filter((_, j) => j !== i), 'cases')}>
                ✕
              </button>
            </div>
          ))}
          <div className="inline">
            <button
              className="small"
              onClick={() => {
                const nums = cases.map((k) => (typeof k.at === 'number' ? k.at : lo));
                const at = nums.length ? Math.min(hi, Math.max(...nums) + Math.max(1, Math.round((hi - lo) / 5))) : lo;
                put([...cases, { at }], 'cases');
              }}
            >
              ＋ 加一档
            </button>
            {v?.stages?.length ? (
              <button className="small" title="每个阶段一档，之后再给它们配颜色" onClick={() => put([...v.stages!].sort((a, b) => a.from - b.from).map((st) => ({ at: st.from })), 'cases')}>
                按阶段分档
              </button>
            ) : null}
            <select
              className="small-select"
              value=""
              onChange={(e) => {
                const p = casePresets(lo, hi)[Number(e.target.value)];
                if (p) c.set({ cases: p.cases, smooth: p.smooth }, 'cases-preset');
              }}
            >
              <option value="">现成配色…</option>
              {casePresets(lo, hi).map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {cases.filter((k) => k.color).length > 1 && (
            <label className="chk">
              <input type="checkbox" checked={!!n.smooth} onChange={(e) => c.set({ smooth: e.target.checked || undefined }, 'smooth')} />
              颜色慢慢过渡（每档的颜色正好在它的数字上，中间混着变）
            </label>
          )}
        </>
      )}
      {!numeric && fixed && (
        <>
          {fixed.map((f) => {
            const k = cases.find((x) => x.at === f.at) ?? { at: f.at };
            return (
              <div className="case-row" key={f.at}>
                <span className="case-name">{f.label}</span>
                {looks(k, changeWord(f.at))}
              </div>
            );
          })}
          {!fixed.length && <div className="hint">这个变量还没有选项。</div>}
        </>
      )}
      {!numeric && !fixed && (
        <>
          {cases.map((k, i) => (
            <div className="case-row" key={i}>
              <span className="hint">是</span>
              <input className="short" value={String(k.at)} onChange={(e) => changeAt(i)({ at: e.target.value }, 'at')} />
              <span className="hint">时</span>
              {looks(k, changeAt(i))}
              <button className="small" title="删掉" onClick={() => put(cases.filter((_, j) => j !== i), 'cases')}>
                ✕
              </button>
            </div>
          ))}
          <button className="small" onClick={() => put([...cases, { at: '' }], 'cases')}>
            ＋ 加一种
          </button>
        </>
      )}
      {numeric && (
        <Field label="和上一楼比" note="数字比上一条消息时变大或变小，就在后面标出来；画布上先放一个灰色的示意">
          <Seg
            value={n.diff ?? 'off'}
            options={[
              ['off', '不显示'],
              ['arrow', '↑↓'],
              ['num', '+3 / -2'],
              ['both', '↑3 / ↓2'],
            ]}
            onChange={(d) => c.set({ diff: d === 'off' ? undefined : d }, 'diff')}
          />
          {n.diff && (
            <label className="chk">
              <input type="checkbox" checked={!!n.diffBad} onChange={(e) => c.set({ diffBad: e.target.checked || undefined }, 'diffBad')} />
              变大是坏事（比如压力、伤势：变大标红，变小标绿）
            </label>
          )}
        </Field>
      )}
    </>
  );
}

function DividerFields({ c }: { c: Ctx }) {
  const n = c.node;
  const ref = useEditFocus<HTMLInputElement>();
  return (
    <>
      <Field label="线型">
        <Seg
          value={n.line ?? 'fade'}
          options={[
            ['fade', '两头渐隐'],
            ['solid', '实线'],
            ['dashed', '虚线'],
            ['dotted', '点线'],
          ]}
          onChange={(line) => c.set({ line }, 'line')}
        />
      </Field>
      <Field label="线的颜色">
        <ColorInput value={n.lineColor} theme={c.theme} fallback={c.theme.line} onChange={(lineColor) => c.set({ lineColor }, 'lineColor')} />
      </Field>
      <Field label="粗细">
        <Slider value={n.lineW} fallback={1} min={1} max={10} unit="px" onChange={(lineW) => c.set({ lineW }, 'lineW')} />
      </Field>
      <Field label="中间的字" note="可以只放一个符号，比如 ✦ 或 ❀">
        <input ref={ref} value={n.text ?? ''} onChange={(e) => c.set({ text: e.target.value || undefined }, 'text')} />
      </Field>
    </>
  );
}

/* ---------- pictures ---------- */

/** A picture: a link typed in, or a file from the computer put inside the card. */
function ImagePick({ value, onChange, field }: { value: string | undefined; onChange: (u: string | undefined, field: string) => void; field: string }) {
  const inline = !!value?.startsWith('data:');
  const [text, setText] = useState(inline ? '' : value ?? '');
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!value?.startsWith('data:') && (value ?? '') !== text.trim()) setText(value ?? '');
    // only follow changes from outside (undo), not our own typing
  }, [value]);
  const bad = !inline && text.trim() !== '' && !imageUrlOk(text);
  return (
    <div className="img-pick">
      {value && (inline || imageUrlOk(value)) && <img className="img-thumb" src={value} alt="" />}
      <div className="img-pick-body">
        {inline ? (
          <span className="hint">放在卡里的图片 · 约 {dataKb(value!)} KB</span>
        ) : (
          <input
            className={bad ? 'bad' : ''}
            placeholder="图片链接 https://…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange(e.target.value.trim() || undefined, field);
            }}
          />
        )}
        <span className="inline">
          <button className="small" onClick={() => file.current?.click()} title="图片会放进卡里，不用另外找地方上传">
            从电脑选
          </button>
          {value && (
            <button
              className="small"
              onClick={() => {
                setText('');
                onChange(undefined, field + '-clear');
              }}
            >
              清除
            </button>
          )}
        </span>
        {bad && <div className="err">链接要以 https:// 或 http:// 开头</div>}
        {err && <div className="err">{err}</div>}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setErr('');
            setText('');
            onChange(await imageToDataUrl(f, savedSide()), field + '-file');
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      />
    </div>
  );
}

/** Size of every picture put inside the card. */
function inlineKb(root: BarNode): number {
  let kb = 0;
  for (const n of eachNode([root])) {
    for (const u of [n.src, ...Object.values(n.imgMap ?? {})]) if (u?.startsWith('data:')) kb += dataKb(u);
  }
  return kb;
}

function ImageFields({ c }: { c: Ctx }) {
  const n = c.node;
  const v = n.bind && !n.bind.part ? c.idx.get(n.bind.var)?.v : undefined;
  const [mode, setMode] = useState<'fixed' | 'var'>(n.bind || n.imgMap ? 'var' : 'fixed');
  const [side, setSide] = useState(savedSide);
  const kb = inlineKb(c.bar.root);
  const setPic = (src: string | undefined, field: string) => c.set({ src }, field);
  const map = n.imgMap ?? {};
  const setMap = (next: Record<string, string>, field: string) => c.set({ imgMap: next }, field);
  /** values with a fixed list: one picture for each */
  const fixedKeys: [string, string][] | null = v?.kind === 'choice' ? (v.options ?? []).map((o) => [o, o]) : v?.kind === 'bool' ? [['true', '是'], ['false', '否']] : null;
  const [newKey, setNewKey] = useState('');

  const pickVar = (b: BarNode['bind']) => {
    const nv = b && !b.part ? c.idx.get(b.var)?.v : undefined;
    // choices and yes/no always go through the table; text starts with the link written in the variable
    c.set({ bind: b, imgMap: nv && nv.kind !== 'text' ? n.imgMap ?? {} : n.imgMap }, 'bind');
  };

  return (
    <>
      <Field label="图片从哪来">
        <Seg
          value={mode}
          options={[
            ['fixed', '固定一张'],
            ['var', '跟着变量换'],
          ]}
          onChange={(m) => {
            setMode(m);
            if (m === 'fixed') c.set({ bind: undefined, imgMap: undefined }, 'imgMode');
            else {
              const first = [...c.idx.values()].find((i) => !i.table && i.v.kind === 'choice') ?? [...c.idx.values()].find((i) => !i.table && IMAGE_KINDS.has(i.v.kind));
              if (first) pickVar({ var: first.v.id });
            }
          }}
        />
      </Field>
      {mode === 'fixed' ? (
        <Field label="图片">
          <ImagePick value={n.src} onChange={setPic} field="src" />
        </Field>
      ) : (
        <>
          <Field label="跟着哪个变量" note="比如「表情」是开心时放一张、生气时放另一张；放进「每项一张」里还能按每一行的名字换图">
            <BindSelect c={c} accept={(x) => IMAGE_KINDS.has(x.kind)} special onPick={pickVar} />
          </Field>
          {n.bind && !fixedKeys && (
            <Field label="怎么换">
              <Seg
                value={n.imgMap ? 'map' : 'direct'}
                options={[
                  ['map', '每个值配一张图'],
                  ['direct', '变量里写的就是图片链接'],
                ]}
                onChange={(m) => c.set({ imgMap: m === 'map' ? map : undefined }, 'imgMapMode')}
              />
            </Field>
          )}
          {n.bind && (fixedKeys || n.imgMap) && (
            <div className="img-map">
              {(fixedKeys ?? Object.keys(map).map((k): [string, string] => [k, k])).map(([k, label]) => (
                <div key={k} className="img-map-row">
                  <span className="img-map-key" title={label}>
                    {label}
                  </span>
                  <ImagePick
                    value={map[k]}
                    field={'map:' + k}
                    onChange={(u, field) => {
                      const next = { ...map };
                      if (u) next[k] = u;
                      else delete next[k];
                      setMap(next, field);
                    }}
                  />
                  {!fixedKeys && (
                    <button
                      className="xbtn"
                      title="删掉这一行"
                      onClick={() => {
                        const next = { ...map };
                        delete next[k];
                        setMap(next, 'map-del');
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {!fixedKeys && (
                <span className="inline">
                  <input className="short" placeholder="变量的值，比如 开心" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
                  <button
                    className="small"
                    disabled={!newKey.trim() || newKey.trim() in map}
                    onClick={() => {
                      setMap({ ...map, [newKey.trim()]: '' }, 'map-add');
                      setNewKey('');
                    }}
                  >
                    ＋ 加一个值
                  </button>
                </span>
              )}
            </div>
          )}
          <Field label="都对不上时" note="变量的值没有配图时显示这张；不放就什么都不显示">
            <ImagePick value={n.src} onChange={setPic} field="src" />
          </Field>
        </>
      )}
      <Field label="从电脑选的图" note={kb > 300 ? `卡里的图片一共约 ${kb} KB，每条消息都会带上一份，太大可能让酒馆变卡，建议换成链接或选小一点` : '放进卡里之前先缩小，卡不会太大'}>
        <select
          value={side}
          onChange={(e) => {
            setSide(Number(e.target.value));
            saveSide(Number(e.target.value));
          }}
        >
          {IMAGE_SIDES.map(([sz, label]) => (
            <option key={sz} value={sz}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <h4 className="sec">大小</h4>
      <Field label="">
        <label className="chk">
          <input type="checkbox" checked={!!n.circle} onChange={(e) => c.set({ circle: e.target.checked || undefined }, 'circle')} />
          圆形（像头像那样）
        </label>
      </Field>
      <Field label="宽度" note={n.circle ? undefined : '不设就占满能用的宽度'}>
        <Slider value={n.imgW} fallback={n.circle ? 64 : undefined} min={16} max={600} unit="px" noReset={n.circle} onChange={(imgW) => c.set({ imgW }, 'imgW')} />
      </Field>
      {!n.circle && (
        <>
          <Field label="高度" note="不设就按图片原来的比例">
            <Slider value={n.imgH} fallback={120} min={16} max={600} unit="px" onChange={(imgH) => c.set({ imgH }, 'imgH')} />
          </Field>
          {n.imgH != null && (
            <Field label="比例不一样时">
              <Seg
                value={n.fit ?? 'cover'}
                options={[
                  ['cover', '裁掉多的部分'],
                  ['contain', '完整显示'],
                ]}
                onChange={(fit) => c.set({ fit: fit === 'cover' ? undefined : fit }, 'fit')}
              />
            </Field>
          )}
        </>
      )}
      {(n.imgW != null || n.circle) && <PlaceField c={c} />}
    </>
  );
}

/* ---------- buttons, menus, tabs, folds ---------- */

/** Words and icon on a button, a menu or a fold title. */
function FaceFields({ c, label }: { c: Ctx; label: string }) {
  const n = c.node;
  const ref = useEditFocus<HTMLInputElement>();
  return (
    <>
      <Field label={label} note="在画布上双击也能跳到这里">
        <input ref={ref} value={n.text ?? ''} onChange={(e) => c.set({ text: e.target.value }, 'text')} />
      </Field>
      <Field label="图标" note="放在字前面，可以自己输入">
        <IconPicker value={n.icon} quick={BTN_ICONS} onChange={(icon, f) => c.set({ icon }, f === 'type' ? 'icon' : 'icon-pick')} />
      </Field>
    </>
  );
}

const BTN_ICONS = ['✎', '☰', '⚙', '▾', '▸', '★', '♥', '✦', '📜', '🎒', '🗺', '💬', '🔍', '👁'];

function PlaceField({ c }: { c: Ctx }) {
  const inRow = c.parent?.type === 'box' && c.parent.dir === 'row';
  if (inRow) return null;
  return (
    <Field label="位置">
      <Seg
        value={c.node.place ?? 'left'}
        options={[
          ['left', '靠左'],
          ['center', '居中'],
          ['right', '靠右'],
          ['full', '占满一行'],
        ]}
        onChange={(place: Place) => c.set({ place: place === 'left' ? undefined : place }, 'place')}
      />
    </Field>
  );
}

const BUTTON_LOOKS: { label: string; style?: BarStyle }[] = [
  { label: '实心' },
  { label: '胶囊', style: { radius: 99, padX: 16 } },
  { label: '描边', style: { bg: { a: 'transparent' }, color: '@accent', borderW: 1, borderColor: '@accent' } },
  { label: '淡底', style: { bg: { a: '@line' }, color: '@text' } },
  { label: '渐变', style: { bg: { a: '@accent', b: '@accent2', angle: 90 }, radius: 99, padX: 16, shadow: 'glow' } },
  { label: '只有字', style: { bg: { a: 'transparent' }, color: '@accent', pad: 0 } },
];

function LookChips({ looks, c }: { looks: { label: string; style?: BarStyle }[]; c: Ctx }) {
  return (
    <Field label="一键样式" note="套用之后，下面的外观还能细调">
      <div className="chips">
        {looks.map((l) => (
          <button key={l.label} className="small" onClick={() => c.set({ style: tidy({ ...l.style, width: c.node.style?.width }) }, 'look')}>
            {l.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

const ACTIONS: [Action['do'] | '', string][] = [
  ['', '什么都不做'],
  ['edit', '打开修改变量的面板'],
  ['toggle', '显示 / 藏起别的组件'],
  ['page', '切到标签页的某一页'],
  ['say', '往输入框里填字'],
];

function ButtonFields({ c }: { c: Ctx }) {
  return (
    <>
      <FaceFields c={c} label="按钮上的字" />
      <ActionFields c={c} />
      <PlaceField c={c} />
      <LookChips looks={BUTTON_LOOKS} c={c} />
    </>
  );
}

function ActionFields({ c }: { c: Ctx }) {
  const n = c.node;
  const a = n.action;
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const setAction = (action: Action | undefined, f = 'action') => c.set({ action }, f);
  const others = [...eachNode([c.bar.root])].filter((k) => k.id !== c.bar.root.id && k.id !== n.id);
  const tabsList = others.filter((k) => k.type === 'tabs');
  const ed = useMemo(() => editableVars(c.vars), [c.vars]);

  return (
    <>
      <Field label="点了以后">
        <select
          value={a?.do ?? ''}
          onChange={(e) => {
            const d = e.target.value as Action['do'] | '';
            if (!d) return setAction(undefined);
            if (d === 'page') return setAction({ do: 'page', target: tabsList[0]?.id, page: 0 });
            setAction({ do: d } as Action);
          }}
        >
          {ACTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {a?.do === 'edit' && (
        <>
          {!allowEdit ? (
            <div className="callout warn-box">
              这张卡还没允许玩家修改变量。
              <button className="small" onClick={allowPlayerEdit}>
                现在允许
              </button>
            </div>
          ) : !ed.list.length ? (
            <div className="callout warn-box">还没有变量能让玩家改：去左边「变量」里，给想开放的变量勾上「玩家可改」。</div>
          ) : null}
          <Field label="面板标题">
            <input value={a.title ?? ''} placeholder="修改变量" onChange={(e) => setAction({ ...a, title: e.target.value || undefined }, 'action.title')} />
          </Field>
          {ed.list.length > 0 && (
            <Field label="能改哪些" note="只列出勾了「玩家可改」的变量">
              <Seg
                value={a.vars ? 'some' : 'all'}
                options={[
                  ['all', '全部'],
                  ['some', '只改这几个'],
                ]}
                onChange={(m) => setAction({ ...a, vars: m === 'all' ? undefined : [...ed.ids] })}
              />
              {a.vars && (
                <div className="checks">
                  {ed.ids.map((id, i) => (
                    <label key={id} className="chk">
                      <input
                        type="checkbox"
                        checked={a.vars!.includes(id)}
                        onChange={(e) => setAction({ ...a, vars: e.target.checked ? ed.ids.filter((x) => x === id || a.vars!.includes(x)) : a.vars!.filter((x) => x !== id) })}
                      />
                      {ed.list[i].n}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          )}
        </>
      )}
      {a?.do === 'toggle' && (
        <Field label="控制哪个" note="点一下藏起来，再点一下显示。选折叠块的话就是展开 / 收起">
          <select value={a.target ?? ''} onChange={(e) => setAction({ ...a, target: e.target.value || undefined })}>
            <option value="">（还没选）</option>
            {others.map((k) => (
              <option key={k.id} value={k.id}>
                {describe(k, c.idx)}
                {k.hidden ? '（开局藏着）' : ''}
              </option>
            ))}
          </select>
          {a.target && (
            <button className="link" onClick={() => selectBar(a.target!)}>
              去看看它
            </button>
          )}
        </Field>
      )}
      {a?.do === 'page' && (
        <>
          <Field label="哪个标签页">
            {tabsList.length ? (
              <select value={a.target ?? ''} onChange={(e) => setAction({ ...a, target: e.target.value || undefined, page: 0 })}>
                <option value="">（还没选）</option>
                {tabsList.map((k, i) => (
                  <option key={k.id} value={k.id}>
                    标签页 {i + 1}（{(k.children ?? []).map((p, j) => p.title || `第${j + 1}页`).join(' / ')}）
                  </option>
                ))}
              </select>
            ) : (
              <span className="hint">状态栏上还没有标签页，先从上面加一个。</span>
            )}
          </Field>
          {a.target && (
            <Field label="切到">
              <select value={a.page ?? 0} onChange={(e) => setAction({ ...a, page: Number(e.target.value) })}>
                {(findNode(c.bar.root, a.target)?.children ?? []).map((p, j) => (
                  <option key={p.id} value={j}>
                    {p.title || `第${j + 1}页`}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      {a?.do === 'say' && (
        <>
          <Field label="要填的字" note="可以用 {{user}}、{{char}}">
            <textarea rows={2} value={a.text ?? ''} onChange={(e) => setAction({ ...a, text: e.target.value }, 'action.text')} />
          </Field>
          <Field label="">
            <Seg
              value={a.send ? 'send' : 'fill'}
              options={[
                ['fill', '只填进输入框，玩家自己点发送'],
                ['send', '直接发出去'],
              ]}
              onChange={(m) => setAction({ ...a, send: m === 'send' || undefined })}
            />
          </Field>
        </>
      )}
    </>
  );
}

function MenuFields({ c }: { c: Ctx }) {
  const n = c.node;
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const add = (key: string) => addAt({ kind: 'new', key }, n.id, n.children?.length ?? 0);
  return (
    <>
      <div className="hint pad">在画布上选中菜单或者它里面的东西时，菜单会自己展开，方便编辑。</div>
      <FaceFields c={c} label="菜单按钮上的字" />
      <Field label="">
        <label className="chk">
          <input type="checkbox" checked={n.arrow !== false} onChange={(e) => c.set({ arrow: e.target.checked ? undefined : false }, 'arrow')} />
          字后面加个小箭头 ▾
        </label>
      </Field>
      <PlaceField c={c} />
      <Field label="里面" note={`有 ${n.children?.length ?? 0} 项；菜单里只能放按钮和子菜单`}>
        <div className="chips">
          <button className="small" onClick={() => add('button')}>
            ＋ 按钮
          </button>
          <button className="small" onClick={() => add('menu')}>
            ＋ 子菜单
          </button>
          {allowEdit && (
            <button className="small" onClick={() => add('edit')}>
              ＋ 修改按钮
            </button>
          )}
        </div>
      </Field>
      <LookChips looks={BUTTON_LOOKS} c={c} />
      <details className="more">
        <summary>弹出来那一块的外观</summary>
        <StyleFields style={n.popStyle} set={(patch, f) => c.set({ popStyle: tidy({ ...n.popStyle, ...patch }) }, 'pop.' + f)} theme={c.theme} />
      </details>
    </>
  );
}

function TabsFields({ c }: { c: Ctx }) {
  const n = c.node;
  const pages = n.children ?? [];
  const setPages = (children: BarNode[]) => c.set({ children }, 'pages');
  const title = (p: BarNode, i: number) => p.title || `第${i + 1}页`;
  const move = (i: number, d: -1 | 1) => {
    const next = [...pages];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setPages(next);
  };
  return (
    <>
      <Field label="有哪几页" note="点页名去编辑那一页；在画布上点标签也行">
        <div className="tab-pages">
          {pages.map((p, i) => (
            <div key={p.id} className="inline">
              <input
                className="short"
                value={p.title ?? ''}
                placeholder={`第${i + 1}页`}
                onChange={(e) => c.set({ children: pages.map((x) => (x.id === p.id ? { ...x, title: e.target.value || undefined } : x)) }, 'page-title')}
              />
              <button className="small" onClick={() => selectBar(p.id)}>
                编辑
              </button>
              <button className="small" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="small" disabled={i === pages.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                className="small"
                disabled={pages.length < 2}
                onClick={() => {
                  if (p.children?.length && !confirm(`「${title(p, i)}」里还有东西，一起删掉吗？（可以撤销）`)) return;
                  setPages(pages.filter((x) => x.id !== p.id));
                }}
              >
                删除
              </button>
            </div>
          ))}
          <button className="small" onClick={() => setPages([...pages, newPage(`第${pages.length + 1}页`)])}>
            ＋ 加一页
          </button>
        </div>
      </Field>
      <Field label="一开始显示">
        <select value={Math.min(n.start ?? 0, pages.length - 1)} onChange={(e) => c.set({ start: Number(e.target.value) || undefined }, 'start')}>
          {pages.map((p, i) => (
            <option key={p.id} value={i}>
              {title(p, i)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="标签的样子">
        <Seg
          value={n.tabLook ?? 'line'}
          options={[
            ['line', '下划线'],
            ['pill', '胶囊'],
            ['card', '卡片'],
          ]}
          onChange={(tabLook) => c.set({ tabLook }, 'tabLook')}
        />
      </Field>
      <Field label="选中的颜色">
        <ColorInput value={n.tabColor} theme={c.theme} fallback={c.theme.accent} onChange={(tabColor) => c.set({ tabColor }, 'tabColor')} />
      </Field>
      <div className="hint pad">玩家切到哪一页会被记住，下一条消息里还是那一页。</div>
    </>
  );
}

function FoldFields({ c }: { c: Ctx }) {
  const n = c.node;
  return (
    <>
      <FaceFields c={c} label="标题" />
      <Field label="一开始">
        <Seg
          value={n.closed ? 'closed' : 'open'}
          options={[
            ['open', '展开'],
            ['closed', '收起'],
          ]}
          onChange={(m) => c.set({ closed: m === 'closed' || undefined }, 'closed')}
        />
      </Field>
      <Field label="">
        <label className="chk">
          <input type="checkbox" checked={n.arrow !== false} onChange={(e) => c.set({ arrow: e.target.checked ? undefined : false }, 'arrow')} />
          标题前面显示 ▾
        </label>
      </Field>
      <LayoutFields c={c} fallbackGap={8} />
      <LookChips looks={BOX_LOOKS} c={c} />
      <details className="more">
        <summary>标题的外观</summary>
        <StyleFields style={n.headStyle} set={(patch, f) => c.set({ headStyle: tidy({ ...n.headStyle, ...patch }) }, 'head.' + f)} theme={c.theme} gradText />
      </details>
      <div className="hint pad">玩家展开还是收起会被记住。在画布上选中它时总是展开的，方便往里放东西。</div>
    </>
  );
}

/** Start hidden, and which buttons can bring it back. */
function HiddenFields({ c }: { c: Ctx }) {
  const n = c.node;
  const by = [...eachNode([c.bar.root])].filter((k) => k.action?.do === 'toggle' && k.action.target === n.id);
  if (!n.hidden && !by.length) {
    return (
      <details className="more">
        <summary>开局先藏起来</summary>
        <HiddenToggle c={c} by={by} />
      </details>
    );
  }
  return (
    <>
      <h4 className="sec">显示 / 藏起</h4>
      <HiddenToggle c={c} by={by} />
    </>
  );
}

function HiddenToggle({ c, by }: { c: Ctx; by: BarNode[] }) {
  const n = c.node;
  return (
    <>
      <Field label="" note="藏起来的组件要靠「显示 / 藏起」按钮点出来。画布上会半透明地画出来，方便编辑">
        <label className="chk">
          <input type="checkbox" checked={!!n.hidden} onChange={(e) => c.set({ hidden: e.target.checked || undefined }, 'hidden')} />
          开局时先藏起来
        </label>
      </Field>
      {by.length > 0 ? (
        <div className="hint pad">
          这些按钮能控制它：
          {by.map((b) => (
            <button key={b.id} className="link" onClick={() => selectBar(b.id)}>
              {describe(b, c.idx)}
            </button>
          ))}
        </div>
      ) : (
        n.hidden && <div className="callout warn-box">还没有按钮能把它点出来：加一个按钮，「点了以后」选「显示 / 藏起别的组件」，再选它。</div>
      )}
    </>
  );
}

/* ---------- looks shared by every component ---------- */

const WIDTHS: [string, string][] = [
  ['', '和旁边的平分'],
  ['auto', '按内容多少'],
  ['25', '25%'],
  ['33', '33%'],
  ['50', '50%'],
  ['66', '66%'],
  ['75', '75%'],
  ['100', '整行'],
];

function StyleFields({
  style: s = {},
  set,
  theme,
  inRow,
  noText,
  gradText,
  solidBorder,
  stagger,
}: {
  style?: BarStyle;
  set: (patch: Partial<BarStyle>, field: string) => void;
  theme: BarTheme;
  inRow?: boolean;
  /** pictures: no text settings */
  noText?: boolean;
  /** its own words can be in a gradient */
  gradText?: boolean;
  /** can't have a gradient border */
  solidBorder?: boolean;
  /** containers: what is inside comes in one after another */
  stagger?: { on: boolean; set: (on: boolean) => void };
}) {
  const allSides = !s.borderSide || s.borderSide === 'all';
  return (
    <>
      {inRow && (
        <Field label="宽度" note="外面是横排，这里定它占多宽">
          <select
            value={s.width === undefined ? '' : String(s.width)}
            onChange={(e) => set({ width: e.target.value === '' ? undefined : e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as Width) }, 'width')}
          >
            {WIDTHS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="背景">
        <FillInput value={s.bg} theme={theme} onChange={(bg) => set({ bg }, 'bg')} />
      </Field>
      {!noText && (
      <>
      <Field label="文字颜色">
        {gradText ? (
          <FillInput
            value={s.textGrad ?? (s.color ? { a: s.color } : undefined)}
            theme={theme}
            fallback={theme.text}
            onChange={(f) => set({ color: f?.a, textGrad: f?.b ? f : undefined }, 'color')}
          />
        ) : (
          <ColorInput value={s.color} theme={theme} fallback={theme.text} onChange={(color) => set({ color }, 'color')} />
        )}
      </Field>
      <Field label="字号">
        <Slider value={s.size} fallback={theme.size} min={8} max={40} unit="px" onChange={(size) => set({ size }, 'size')} />
      </Field>
      <Field label="">
        <span className="inline">
          <label className="chk">
            <input type="checkbox" checked={!!s.bold} onChange={(e) => set({ bold: e.target.checked || undefined }, 'bold')} />
            加粗
          </label>
          <label className="chk">
            <input type="checkbox" checked={!!s.italic} onChange={(e) => set({ italic: e.target.checked || undefined }, 'italic')} />
            斜体
          </label>
        </span>
      </Field>
      <Field label="对齐">
        <Seg
          value={s.align ?? ''}
          options={[
            ['', '默认'],
            ['left', '靠左'],
            ['center', '居中'],
            ['right', '靠右'],
          ]}
          onChange={(a) => set({ align: a || undefined }, 'align')}
        />
      </Field>
      <Field label="字体" note="玩家电脑上没有这种字体时会用默认字体">
        <select value={s.font ?? ''} onChange={(e) => set({ font: (e.target.value || undefined) as FontName | undefined }, 'font')}>
          <option value="">跟整体一样</option>
          {(Object.keys(FONTS) as FontName[]).map((k) => (
            <option key={k} value={k}>
              {FONTS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="字距">
        <Slider value={s.ls} fallback={0} min={0} max={10} step={0.5} unit="px" onChange={(ls) => set({ ls: ls || undefined }, 'ls')} />
      </Field>
      <Field label="文字效果">
        <select value={s.textFx ?? ''} onChange={(e) => set({ textFx: (e.target.value || undefined) as TextFx | undefined }, 'textFx')}>
          <option value="">没有</option>
          <option value="shadow">投影</option>
          <option value="glow">发光</option>
          <option value="outline">描边</option>
          <option value="lift">立体</option>
        </select>
      </Field>
      </>
      )}
      <Field label="内边距" note="边框和里面内容之间留多少空">
        <Slider value={s.pad} min={0} max={40} unit="px" onChange={(pad) => set({ pad }, 'pad')} />
      </Field>
      <Field label="左右另算" note="不填就和上面一样">
        <Slider value={s.padX} min={0} max={60} unit="px" onChange={(padX) => set({ padX }, 'padX')} />
      </Field>
      <Field label="圆角">
        <Slider value={s.radius} min={0} max={40} unit="px" onChange={(radius) => set({ radius }, 'radius')} />
      </Field>
      <Field label="边框">
        <Slider value={s.borderW} min={0} max={10} unit="px" onChange={(borderW) => set({ borderW: borderW || undefined }, 'borderW')} />
        {!!s.borderW && (
          <span className="inline">
            {allSides && !solidBorder ? (
              <FillInput
                value={s.borderGrad ?? (s.borderColor ? { a: s.borderColor } : undefined)}
                theme={theme}
                fallback={theme.line}
                onChange={(f) => set({ borderColor: f?.a, borderGrad: f?.b ? f : undefined }, 'borderColor')}
              />
            ) : (
              <ColorInput value={s.borderColor} theme={theme} fallback={theme.line} onChange={(borderColor) => set({ borderColor, borderGrad: undefined }, 'borderColor')} />
            )}
            {!s.borderGrad && <select className="small-select" value={s.borderStyle ?? 'solid'} onChange={(e) => set({ borderStyle: e.target.value as BarStyle['borderStyle'] }, 'borderStyle')}>
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
              <option value="double">双线</option>
            </select>}
            <select className="small-select" value={s.borderSide ?? 'all'} onChange={(e) => set({ borderSide: e.target.value as BarStyle['borderSide'] }, 'borderSide')}>
              <option value="all">四周</option>
              <option value="left">只在左边</option>
              <option value="top">只在上面</option>
              <option value="bottom">只在下面</option>
            </select>
          </span>
        )}
      </Field>
      <Field label="阴影">
        <select value={s.shadow ?? ''} onChange={(e) => set({ shadow: (e.target.value || undefined) as BarStyle['shadow'] }, 'shadow')}>
          <option value="">没有</option>
          <option value="soft">淡淡的</option>
          <option value="float">浮起来</option>
          <option value="glow">主色发光</option>
          <option value="inset">往里凹</option>
        </select>
      </Field>
      <Field label="不透明度">
        <Slider
          value={s.opacity != null ? Math.round(s.opacity * 100) : undefined}
          fallback={100}
          min={10}
          max={100}
          step={5}
          unit="%"
          onChange={(o) => set({ opacity: o == null || o >= 100 ? undefined : o / 100 }, 'opacity')}
        />
      </Field>
      <MotionFields s={s} set={set} theme={theme} stagger={stagger} />
    </>
  );
}

const LOOPS: [LoopAnim, string][] = [
  ['breathe', '呼吸发光'],
  ['float', '上下浮动'],
  ['beat', '心跳'],
  ['blink', '一闪一闪'],
  ['spin', '转圈'],
  ['flow', '渐变流动'],
];
const ENTERS: [EnterAnim, string][] = [
  ['fade', '淡入'],
  ['up', '从下面浮上来'],
  ['zoom', '放大出现'],
  ['left', '从左边滑进来'],
];
const HOVERS: [HoverFx, string][] = [
  ['grow', '变大一点'],
  ['lift', '浮起来'],
  ['bright', '变亮'],
];

function MotionFields({
  s,
  set,
  theme,
  stagger,
}: {
  s: BarStyle;
  set: (patch: Partial<BarStyle>, field: string) => void;
  theme: BarTheme;
  stagger?: { on: boolean; set: (on: boolean) => void };
}) {
  const used = !!(s.anim || s.enter || s.hover || stagger?.on);
  const noGrad = s.anim === 'flow' && !s.bg?.b && !s.textGrad?.b && !s.borderGrad?.b;
  return (
    <details className="more motion" open={used || undefined}>
      <summary>动效{used ? '（已设）' : ''}</summary>
      {theme.noAnim && <div className="callout warn-box">「整体配色」里关掉了所有动画，这里设的暂时都不会动。</div>}
      <Field label="一直在动" note={noGrad ? '「渐变流动」要先设渐变背景、渐变文字或渐变边框' : undefined}>
        <select value={s.anim ?? ''} onChange={(e) => set({ anim: (e.target.value || undefined) as LoopAnim | undefined, animSec: undefined }, 'anim')}>
          <option value="">不动</option>
          {LOOPS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {s.anim && (
        <Field label="一圈多久">
          <Slider value={s.animSec} fallback={LOOP_SEC[s.anim]} min={0.5} max={20} step={0.5} unit=" 秒" onChange={(animSec) => set({ animSec }, 'animSec')} />
        </Field>
      )}
      <Field label="出现时" note="消息刚出来时播一次">
        <select value={s.enter ?? ''} onChange={(e) => set({ enter: (e.target.value || undefined) as EnterAnim | undefined }, 'enter')}>
          <option value="">直接出现</option>
          {ENTERS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {stagger && (
          <label className="chk">
            <input type="checkbox" checked={stagger.on} onChange={(e) => stagger.set(e.target.checked)} />
            里面的东西一个接一个出现
          </label>
        )}
      </Field>
      <Field label="鼠标放上去">
        <select value={s.hover ?? ''} onChange={(e) => set({ hover: (e.target.value || undefined) as HoverFx | undefined }, 'hover')}>
          <option value="">没变化</option>
          {HOVERS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <div className="hint">画布上平时不动，点画布上面的「▶ 播放动效」看效果；右边切到「聊天预览」能看到一直在动的样子。玩家系统里设了「减少动态效果」时不会动。</div>
    </details>
  );
}

/* ---------- colors and font of the whole status bar ---------- */

const THEME_NOTE: Record<ThemeColor, string> = {
  bg: '整个状态栏的底',
  card: '「卡片」的底',
  line: '边框、分隔线、进度条的底槽、小标签',
  text: '正文',
  dim: '名字、说明这类不那么重要的字',
  accent: '标题、进度条',
  accent2: '进度条渐变的另一头',
};

function ThemePanel({ theme }: { theme: BarTheme }) {
  const set = (patch: Partial<BarTheme>, field: string) => useCard.getState().editBar((b) => ({ ...b, theme: { ...b.theme, ...patch } }), 'bar:theme:' + field);
  return (
    <>
      <h4 className="sec">一键换风格</h4>
      <div className="hint">配色、字体和每个组件的样子一起换，位置不动。</div>
      <div className="presets skins">
        {SKINS.map((k) => (
          <button
            key={k.name}
            className="preset"
            title={k.hint}
            onClick={() => {
              if (confirm(`换成「${k.name}」风格吗？\n${k.hint}。\n组件上自己调过的颜色、边框会被换掉，位置不变。（可以撤销）`)) pickSkin(k.name);
            }}
          >
            <span className="pv" style={{ background: k.theme.bg ?? theme.bg, borderColor: k.theme.accent ?? theme.accent }}>
              <i style={{ background: k.theme.card ?? theme.card }} />
              <b style={{ background: `linear-gradient(90deg, ${k.theme.accent ?? theme.accent}, ${k.theme.accent2 ?? theme.accent2})` }} />
            </span>
            {k.name}
          </button>
        ))}
      </div>
      <h4 className="sec">换个排版</h4>
      <div className="hint">按左边的变量重新摆一遍，配色不变。</div>
      <div className="inline wrap">
        {LAYOUTS.map((l) => (
          <button
            key={l.key}
            className="small"
            title={l.hint}
            onClick={() => {
              if (confirm(`换成「${l.name}」排版吗？\n${l.hint}。\n现在摆的位置和组件样式都会换掉。（可以撤销）`)) pickLayout(l.key);
            }}
          >
            {l.name}
          </button>
        ))}
      </div>
      <h4 className="sec">整体配色</h4>
      <div className="hint">
        没选中组件时，这里改的是整个状态栏的颜色和字体。组件里选了「主色」「卡片」这类颜色的地方会跟着一起变。点画布上的东西就能单独改它。
      </div>
      <div className="presets">
        {THEME_PRESETS.map((p) => (
          <button key={p.name} className={'preset' + (theme.preset === p.name ? ' on' : '')} onClick={() => set({ preset: p.name, ...p.colors }, 'preset')}>
            <span className="pv" style={{ background: p.colors.bg, borderColor: p.colors.line }}>
              <i style={{ background: p.colors.card }} />
              <b style={{ background: `linear-gradient(90deg, ${p.colors.accent}, ${p.colors.accent2})` }} />
            </span>
            {p.name}
          </button>
        ))}
      </div>
      {THEME_COLORS.map((k) => (
        <Field key={k} label={THEME_COLOR_LABEL[k]} note={THEME_NOTE[k]}>
          <ColorInput value={theme[k]} theme={theme} themeColors={false} clearable={false} onChange={(col) => col && set({ [k]: col, preset: '' }, k)} />
        </Field>
      ))}
      <Field label="字体" note="玩家电脑上没有这种字体时会用默认字体">
        <select value={theme.font} onChange={(e) => set({ font: e.target.value as FontName }, 'font')}>
          {(Object.keys(FONTS) as FontName[]).map((k) => (
            <option key={k} value={k}>
              {FONTS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="字号">
        <Slider value={theme.size} min={10} max={24} unit="px" noReset onChange={(size) => set({ size: size ?? 14 }, 'size')} />
      </Field>
      <Field label="动画">
        <label className="chk">
          <input type="checkbox" checked={!!theme.noAnim} onChange={(e) => set({ noAnim: e.target.checked || undefined }, 'noAnim')} />
          关掉所有动画（组件里设的动效都不播）
        </label>
      </Field>
      <HandCss />
    </>
  );
}

/** Advanced: CSS written by hand, added after everything the tool makes. */
function HandCss() {
  const text = useCard((s) => s.project.bar?.css ?? '');
  const root = useCard((s) => s.project.bar?.root);
  const tags = useMemo(() => [...new Set([...eachNode(root ? [root] : [])].map((n) => n.tag).filter(okTag))], [root]);
  const bad = useMemo(() => cssProblems(text), [text]);
  const set = (css: string) => useCard.getState().editBar((b) => ({ ...b, css: css || undefined }), 'bar:css');
  return (
    <details className="more" open={!!text || undefined}>
      <summary>进阶：自己写 CSS</summary>
      <div className="hint">
        会加在工具生成的样式后面，所以能盖掉它们。<code>#sb</code> 是整个状态栏，<code>.sb-val</code> 是所有变量值，<code>.sb-barrow</code> 是所有进度条，<code>.sb-btn</code> 是所有按钮
        {tags.length > 0 && (
          <>
            ，你起过的类名有{' '}
            {tags.map((t) => (
              <code key={t}>.{t} </code>
            ))}
          </>
        )}
        。改完在画布和右边预览里马上能看到。
      </div>
      <CodeBox value={text} onChange={set} lang="css" placeholder={'#sb .sb-val { letter-spacing: 1px; }'} />
      {bad.map((b, i) => (
        <div className="warn" key={i}>
          ⚠ {b}
        </div>
      ))}
    </details>
  );
}

