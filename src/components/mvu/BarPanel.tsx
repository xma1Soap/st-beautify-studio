// Middle panel on the status bar page: components to add, notices, and the settings of the selected component
// (or the colors and font of the whole status bar when nothing is selected).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addFromPalette,
  addVarsAtEnd,
  drag,
  duplicateSelected,
  moveSelected,
  PALETTE,
  removeSelected,
  resetLayout,
  selectParent,
  updateNode,
} from '../../barActions';
import { useCard } from '../../cardStore';
import {
  barOf,
  compileBar,
  describe,
  findNode,
  FONTS,
  indexVars,
  pathTo,
  placementProblem,
  rowNodes,
  scopeAt,
  THEME_COLOR_LABEL,
  THEME_COLORS,
  THEME_PRESETS,
  unplacedVars,
  type Bar,
  type BarNode,
  type BarStyle,
  type BarTheme,
  type FontName,
  type ThemeColor,
  type VarInfo,
  type Width,
} from '../../mvu/bar';
import { eachNode, locate, updateVar } from '../../mvu/tree';
import type { VarNode } from '../../mvu/types';
import { Field, NumberInput } from '../common';
import { ColorInput, FillInput, Seg, Slider } from './barInputs';

const selectBar = (id: string | null) => useCard.getState().selectBar(id);

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
  const vars = useCard((s) => s.project.vars);
  const saved = useCard((s) => s.project.bar);
  const sel = useCard((s) => s.barSel);
  const bar = useMemo(() => barOf({ bar: saved, vars }), [saved, vars]);
  const idx = useMemo(() => indexVars(vars), [vars]);
  const problems = useMemo(() => compileBar(bar, vars).problems, [bar, vars]);
  const unplaced = useMemo(() => (saved?.root ? unplacedVars(bar, vars) : []), [bar, vars, saved]);
  const node = findNode(bar.root, sel);
  const custom = !!saved?.root;

  return (
    <div className="form scroll bar-panel">
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
    </div>
  );
}

/* ---------- adding components ---------- */

const PAL_ICON: Record<string, string> = { box: '▢', row: '↔', grid: '▦', repeat: '☰', text: 'T', value: '=', bar: '▬', divider: '—' };

function Palette() {
  return (
    <>
      <div className="palette">
        {PALETTE.map((p) => (
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
      {isRoot && <div className="hint pad">这是最外面那一层，状态栏的底色、边框都在这里改。</div>}
      {node.type === 'box' && <BoxFields c={c} />}
      {node.type === 'repeat' && <RepeatFields c={c} />}
      {node.type === 'text' && <TextFields c={c} />}
      {node.type === 'value' && <ValueFields c={c} />}
      {node.type === 'bar' && <BarFields c={c} />}
      {node.type === 'divider' && <DividerFields c={c} />}
      <h4 className="sec">{node.type === 'repeat' ? '整块的外观' : '外观'}</h4>
      <StyleFields style={node.style} set={setStyle} theme={bar.theme} inRow={inRow} />
    </>
  );
}

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
  return (
    <>
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
      <Field label="一张都没有时" note="清空就什么都不显示">
        <input value={n.emptyText ?? '暂无'} onChange={(e) => c.set({ emptyText: e.target.value }, 'empty')} />
      </Field>
      <h4 className="sec">每一张的外观</h4>
      <StyleFields style={n.itemStyle} set={(patch, f) => c.set({ itemStyle: tidy({ ...n.itemStyle, ...patch }) }, 'item.' + f)} theme={c.theme} />
    </>
  );
}

function TextFields({ c }: { c: Ctx }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const focus = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    addEventListener('stbs-edit-text', focus);
    return () => removeEventListener('stbs-edit-text', focus);
  }, []);
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

const ICONS = ['❤', '⭐', '💰', '📍', '⏰', '⚔', '🛡', '⚡', '💧', '🔥', '🌙', '☀', '🎒', '📜', '✦', '❀'];

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
        <span className="inline icons">
          <input className="num" value={n.icon ?? ''} placeholder="无" onChange={(e) => c.set({ icon: e.target.value || undefined }, 'icon')} />
          {ICONS.map((ic) => (
            <button key={ic} className={'small' + (n.icon === ic ? ' primary' : '')} onClick={() => c.set({ icon: n.icon === ic ? undefined : ic }, 'icon-pick')}>
              {ic}
            </button>
          ))}
        </span>
      </Field>
    </>
  );
}

/** Color, size and weight of the value itself. */
function ValueLook({ c, pill }: { c: Ctx; pill?: boolean }) {
  const n = c.node;
  return (
    <>
      <Field label="颜色">
        <ColorInput value={n.valColor} theme={c.theme} fallback={c.theme.text} onChange={(valColor) => c.set({ valColor }, 'valColor')} />
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
    </>
  );
}

function BarFields({ c }: { c: Ctx }) {
  const n = c.node;
  const info = n.bind ? c.idx.get(n.bind.var) : undefined;
  const v = info?.v;
  const staged = !!info?.stage && !info.table;
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
          value={n.num ?? 'after'}
          options={[
            ['after', '在条后面'],
            ['inside', '在条里面'],
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
      <h4 className="sec">条的样子</h4>
      <Field label="条的颜色">
        <FillInput value={n.fill} theme={c.theme} fallback={`linear-gradient(90deg, ${c.theme.accent}, ${c.theme.accent2})`} onChange={(fill) => c.set({ fill }, 'fill')} />
      </Field>
      <Field label="底槽颜色">
        <ColorInput value={n.track} theme={c.theme} fallback={c.theme.line} onChange={(track) => c.set({ track }, 'track')} />
      </Field>
      <Field label="粗细">
        <Slider value={n.height} fallback={8} min={2} max={30} unit="px" onChange={(height) => c.set({ height }, 'height')} />
      </Field>
      <h4 className="sec">数字的样子</h4>
      <ValueLook c={c} />
    </>
  );
}

function DividerFields({ c }: { c: Ctx }) {
  const n = c.node;
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
        <input value={n.text ?? ''} onChange={(e) => c.set({ text: e.target.value || undefined }, 'text')} />
      </Field>
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
}: {
  style?: BarStyle;
  set: (patch: Partial<BarStyle>, field: string) => void;
  theme: BarTheme;
  inRow?: boolean;
}) {
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
      <Field label="文字颜色">
        <ColorInput value={s.color} theme={theme} fallback={theme.text} onChange={(color) => set({ color }, 'color')} />
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
      <Field label="内边距" note="边框和里面内容之间留多少空">
        <Slider value={s.pad} min={0} max={40} unit="px" onChange={(pad) => set({ pad }, 'pad')} />
      </Field>
      <Field label="圆角">
        <Slider value={s.radius} min={0} max={40} unit="px" onChange={(radius) => set({ radius }, 'radius')} />
      </Field>
      <Field label="边框">
        <Slider value={s.borderW} min={0} max={10} unit="px" onChange={(borderW) => set({ borderW: borderW || undefined }, 'borderW')} />
        {!!s.borderW && (
          <span className="inline">
            <ColorInput value={s.borderColor} theme={theme} fallback={theme.line} onChange={(borderColor) => set({ borderColor }, 'borderColor')} />
            <select className="small-select" value={s.borderStyle ?? 'solid'} onChange={(e) => set({ borderStyle: e.target.value as BarStyle['borderStyle'] }, 'borderStyle')}>
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
              <option value="double">双线</option>
            </select>
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
    </>
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
    </>
  );
}

