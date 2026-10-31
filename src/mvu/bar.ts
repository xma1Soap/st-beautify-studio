// The status bar the author lays out on the canvas: a tree of components, some bound to variables.
// compileBar() turns it into what the status bar runtime draws (statusbar.ts) plus its CSS.
//
// Components point at variables by id, so renaming or moving a variable never breaks the status bar.
// Everything the author types ends up as data (JSON), never inside CSS; CSS values are checked here
// because the CSS goes through ST's message formatting too (see the top of statusbar.ts).
import { newId } from '../lib/id';
import { eachNode, findVar, locate } from './tree';
import type { VarNode } from './types';
import { defaultValue, stageKey, varKey } from './vars';

export type BarType = 'box' | 'repeat' | 'text' | 'value' | 'bar' | 'divider';

/** '#rrggbb', '#rrggbbaa', or a theme color like '@accent' */
export type Color = string;

/** A solid color, or a gradient when `b` is set. */
export interface Fill {
  a: Color;
  b?: Color;
  /** gradient direction in degrees (90 = left to right) */
  angle?: number;
}

export type Width = 'auto' | 25 | 33 | 50 | 66 | 75 | 100;

export interface BarStyle {
  color?: Color;
  bg?: Fill;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  pad?: number;
  radius?: number;
  borderW?: number;
  borderColor?: Color;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double';
  borderSide?: 'all' | 'left' | 'top' | 'bottom';
  shadow?: 'soft' | 'float' | 'glow' | 'inset';
  /** width inside a row; by default the children of a row share the space equally */
  width?: Width;
  opacity?: number;
}

/** What a component shows: a variable, the row name inside a table repeat, or the item inside a list repeat. */
export interface Binding {
  var: string;
  part?: 'name' | 'item';
}

export interface BarNode {
  id: string;
  type: BarType;
  style?: BarStyle;
  children?: BarNode[];

  /* box: how children are laid out. repeat: how the items are laid out */
  dir?: 'col' | 'row' | 'grid';
  cols?: number;
  gap?: number;

  /* repeat */
  /** layout inside each item */
  inner?: 'row' | 'col';
  itemStyle?: BarStyle;
  emptyText?: string;

  /* text, divider (text in the middle of the line) */
  text?: string;

  /* value, bar, repeat */
  bind?: Binding;
  /** undefined = the variable's name, '' = no label */
  label?: string;
  colon?: boolean;
  icon?: string;
  /** label on its own line above the value */
  stack?: boolean;
  labelColor?: Color;

  /* value */
  prefix?: string;
  suffix?: string;
  /** shown when there is nothing (default —) */
  empty?: string;
  hideEmpty?: boolean;
  yes?: string;
  no?: string;
  listAs?: 'chips' | 'text';
  sep?: string;
  /** numbers with stages: the number, the stage name, or both */
  show?: 'value' | 'stage' | 'both';
  pill?: boolean;
  valColor?: Color;
  valSize?: number;
  valBold?: boolean;

  /* bar */
  min?: number;
  max?: number;
  num?: 'after' | 'inside' | 'none';
  showMax?: boolean;
  showStage?: boolean;
  fill?: Fill;
  track?: Color;
  height?: number;

  /* divider */
  line?: 'solid' | 'dashed' | 'dotted' | 'fade';
  lineColor?: Color;
  lineW?: number;
}

export const THEME_COLORS = ['bg', 'card', 'line', 'text', 'dim', 'accent', 'accent2'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

export const THEME_COLOR_LABEL: Record<ThemeColor, string> = {
  bg: '底色',
  card: '卡片',
  line: '线条',
  text: '文字',
  dim: '淡文字',
  accent: '主色',
  accent2: '辅色',
};

export type FontName = 'sans' | 'serif' | 'kai' | 'mono';

export const FONTS: Record<FontName, { label: string; css: string }> = {
  sans: { label: '黑体（默认）', css: "system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif" },
  serif: { label: '宋体', css: "'Noto Serif SC', 'Songti SC', 'SimSun', serif" },
  kai: { label: '楷体', css: "'KaiTi', 'STKaiti', 'Kaiti SC', serif" },
  mono: { label: '等宽', css: "'Consolas', 'Courier New', 'Microsoft YaHei', monospace" },
};

export type BarTheme = Record<ThemeColor, string> & { preset: string; font: FontName; size: number };

export const THEME_PRESETS: { name: string; colors: Record<ThemeColor, string> }[] = [
  { name: '星夜', colors: { bg: '#1f1d2b', card: '#2a2838', line: '#3a3750', text: '#e8e6f0', dim: '#a9a5bf', accent: '#b48cff', accent2: '#6fc3ff' } },
  { name: '深海', colors: { bg: '#0f1e2e', card: '#16293d', line: '#23405c', text: '#e2f0ff', dim: '#8fb0cc', accent: '#4fb3ff', accent2: '#4fffd2' } },
  { name: '赛博', colors: { bg: '#0b0f1a', card: '#121a2b', line: '#1f2d4a', text: '#d6f6ff', dim: '#6f8bb0', accent: '#00e5ff', accent2: '#ff2bd6' } },
  { name: '暖炉', colors: { bg: '#2b1d14', card: '#3a281b', line: '#5a3e29', text: '#fbeee0', dim: '#c9a88a', accent: '#ff9a4d', accent2: '#ffd166' } },
  { name: '樱花', colors: { bg: '#fff5f8', card: '#ffe4ec', line: '#f6c6d4', text: '#5a3a46', dim: '#a07888', accent: '#e86a92', accent2: '#f7a5c0' } },
  { name: '薄荷', colors: { bg: '#f2fbf8', card: '#ddf3ec', line: '#b9e3d6', text: '#24463d', dim: '#6b8f85', accent: '#2fae8a', accent2: '#7fd6c0' } },
  { name: '羊皮纸', colors: { bg: '#f5ecd7', card: '#ebdfc3', line: '#d4c39c', text: '#4a3a22', dim: '#8a7550', accent: '#9c5a2c', accent2: '#c48a3a' } },
  { name: '水墨', colors: { bg: '#f7f7f4', card: '#ecece6', line: '#cfcfc6', text: '#2b2b2b', dim: '#77776f', accent: '#3d3d3d', accent2: '#8a8a80' } },
];

export const defaultTheme = (): BarTheme => ({ preset: THEME_PRESETS[0].name, ...THEME_PRESETS[0].colors, font: 'sans', size: 14 });

export interface Bar {
  v: 1;
  theme: BarTheme;
  root: BarNode;
}

/** What the project keeps: colors and, once the author has changed anything, the layout (missing = automatic). */
export interface SavedBar {
  v: 1;
  theme?: BarTheme;
  root?: BarNode;
}

export const TYPE_LABEL: Record<BarType, string> = {
  box: '框',
  repeat: '每项一张',
  text: '文字',
  value: '变量值',
  bar: '进度条',
  divider: '分隔线',
};

/* ---------- variables as seen from the status bar ---------- */

export interface VarInfo {
  v: VarNode;
  /** keys from the top of stat_data */
  keys: string[];
  /** the table this is a field of */
  table: VarNode | null;
  /** where the computed stage name is (numbers with stages inside a group) */
  stage: string[] | null;
  /** 白娅 › 好感度 */
  label: string;
}

export function indexVars(vars: VarNode[]): Map<string, VarInfo> {
  const out = new Map<string, VarInfo>();
  const go = (list: VarNode[], keys: string[], parent: VarNode | null, names: string[]) => {
    for (const v of list) {
      const here = [...keys, varKey(v)];
      const table = parent?.kind === 'table' ? parent : null;
      const stage = v.kind === 'number' && v.stages?.length && parent?.kind === 'group' ? [...keys, stageKey(v)] : null;
      out.set(v.id, { v, keys: here, table, stage, label: [...names, v.name].join(' › ') });
      if (v.children) go(v.children, here, v, [...names, v.name]);
    }
  };
  go(vars, [], null, []);
  return out;
}

const hasRange = (v: VarNode) => v.min != null && v.max != null && v.max > v.min;

/* ---------- building components ---------- */

type Ids = (slot: string) => string;
const freshIds: Ids = () => newId();

const CARD_STYLE: BarStyle = { bg: { a: '@card' }, radius: 10, pad: 10 };
const INNER_GROUP_STYLE: BarStyle = { borderW: 2, borderColor: '@line', borderSide: 'left', pad: 8 };
const TITLE_STYLE: BarStyle = { color: '@accent', bold: true };

/** The components a variable becomes when it is dropped on the canvas. */
export function nodesForVar(v: VarNode, depth = 0, ids: Ids = freshIds): BarNode {
  const id = ids(v.id);
  const bind = { var: v.id };
  switch (v.kind) {
    case 'group':
      return {
        id,
        type: 'box',
        dir: 'col',
        gap: 6,
        style: depth === 0 ? { ...CARD_STYLE } : { ...INNER_GROUP_STYLE },
        children: [
          { id: ids(v.id + ':title'), type: 'text', text: v.name, style: { ...TITLE_STYLE } },
          ...(v.children ?? []).map((c) => nodesForVar(c, depth + 1, ids)),
        ],
      };
    case 'table':
      return {
        id,
        type: 'box',
        dir: 'col',
        gap: 6,
        style: depth === 0 ? { ...CARD_STYLE } : { ...INNER_GROUP_STYLE },
        children: [
          { id: ids(v.id + ':title'), type: 'text', text: v.name, style: { ...TITLE_STYLE } },
          {
            id: ids(v.id + ':rows'),
            type: 'repeat',
            bind,
            dir: 'col',
            gap: 4,
            inner: 'row',
            emptyText: '暂无',
            children: [
              { id: ids(v.id + ':name'), type: 'value', bind: { var: v.id, part: 'name' }, label: '', valBold: true, style: { width: 'auto' } },
              ...(v.children ?? []).map((f) => fieldNode(f, ids)),
            ],
          },
        ],
      };
    case 'list':
      return { id, type: 'value', bind, listAs: 'chips', empty: '暂无' };
    case 'number':
      if (hasRange(v)) return { id, type: 'bar', bind, showStage: !!v.stages?.length };
      return { id, type: 'value', bind, show: v.stages?.length ? 'both' : 'value' };
    default:
      return { id, type: 'value', bind };
  }
}

/** A field inside a table row. */
function fieldNode(f: VarNode, ids: Ids): BarNode {
  const node = nodesForVar(f, 1, ids);
  if (node.type === 'value') Object.assign(node, { colon: true, hideEmpty: true, style: { width: 'auto' } });
  return node;
}

/** The status bar the tool makes when the author hasn't laid one out: every variable, grouped like the tree. */
export function defaultBar(vars: VarNode[], theme: BarTheme = defaultTheme()): Bar {
  const ids: Ids = (slot) => 'auto:' + slot;
  return {
    v: 1,
    theme,
    root: {
      id: 'auto:root',
      type: 'box',
      dir: 'col',
      gap: 10,
      style: { bg: { a: '@bg' }, borderW: 1, borderColor: '@line', radius: 12, pad: 12 },
      children: vars.map((v) => nodesForVar(v, 0, ids)),
    },
  };
}

/** New component from the palette. `scope` are the variables of the repeats it goes into (innermost last). */
export function newNode(type: BarType, vars: VarNode[], scope: string[] = []): BarNode {
  const id = newId();
  const idx = indexVars(vars);
  const inner = scope.length ? idx.get(scope[scope.length - 1])?.v : undefined;
  const fields = inner?.kind === 'table' ? inner.children ?? [] : [];
  const all = [...idx.values()].map((i) => i.v);
  const top = all.filter((v) => !idx.get(v.id)!.table);
  switch (type) {
    case 'box':
      return { id, type, dir: 'col', gap: 8, style: { ...CARD_STYLE }, children: [] };
    case 'repeat': {
      const t = top.find((v) => v.kind === 'table') ?? top.find((v) => v.kind === 'list');
      return { id, type, dir: 'col', gap: 4, inner: 'row', emptyText: '暂无', bind: t ? { var: t.id } : undefined, children: t ? rowNodes(t) : [] };
    }
    case 'text':
      return { id, type, text: '文字' };
    case 'value': {
      const v = fields.find((f) => f.kind !== 'number' || !hasRange(f)) ?? fields[0] ?? top.find((x) => x.kind !== 'group' && x.kind !== 'table');
      return { id, type, bind: v ? { var: v.id } : undefined, colon: !!fields.length };
    }
    case 'bar': {
      const v = fields.find((f) => f.kind === 'number' && hasRange(f)) ?? fields.find((f) => f.kind === 'number') ?? top.find((x) => x.kind === 'number' && hasRange(x)) ?? top.find((x) => x.kind === 'number');
      return { id, type, bind: v ? { var: v.id } : undefined, showStage: !!v?.stages?.length };
    }
    case 'divider':
      return { id, type, line: 'fade' };
  }
}

/** What goes inside a 每项一张 over this variable: the row name and every field (table), or the item itself (list). */
export function rowNodes(v: VarNode): BarNode[] {
  if (v.kind === 'list') return [{ id: newId(), type: 'value', bind: { var: v.id, part: 'item' }, label: '', style: { width: 'auto' } }];
  if (v.kind !== 'table') return [];
  return [
    { id: newId(), type: 'value', bind: { var: v.id, part: 'name' }, label: '', valBold: true, style: { width: 'auto' } },
    ...(v.children ?? []).map((f) => fieldNode(f, freshIds)),
  ];
}

/** A copy with fresh ids everywhere. */
export function cloneNode(n: BarNode): BarNode {
  return { ...structuredClone(n), id: newId(), children: n.children?.map(cloneNode) };
}

export const isContainer = (n: BarNode) => n.type === 'box' || n.type === 'repeat';

/* ---------- where a component may go ---------- */

/** Variables of the repeats around (and including) `parentId`, outermost first. */
export function scopeAt(root: BarNode, parentId: string): string[] {
  const out: string[] = [];
  let cur = locate([root], parentId);
  while (cur) {
    if (cur.node.type === 'repeat' && cur.node.bind) out.unshift(cur.node.bind.var);
    cur = cur.parent ? locate([root], cur.parent.id) : null;
  }
  return out;
}

interface Resolved {
  /** where the value comes from, in the runtime's terms */
  src?: Src;
  problem?: string;
}

/** p: path from the top, r: key in the current table row, nm: the row name, it: the list item */
export type Src = { p: string[] } | { r: string } | { nm: 1 } | { it: 1 };

/** Innermost repeat in `scope` over a variable of this kind. */
function innermost(scope: string[], idx: Map<string, VarInfo>, kind: 'table' | 'list'): string | undefined {
  for (let i = scope.length - 1; i >= 0; i--) if (idx.get(scope[i])?.v.kind === kind) return scope[i];
  return undefined;
}

function resolve(b: Binding | undefined, scope: string[], idx: Map<string, VarInfo>): Resolved {
  if (!b) return { problem: '还没选要显示哪个变量' };
  const info = idx.get(b.var);
  if (!info) return { problem: '绑定的变量已经删掉了' };
  const v = info.v;
  if (b.part === 'name') {
    if (v.kind !== 'table') return { problem: `「${v.name}」不是表格` };
    if (innermost(scope, idx, 'table') !== v.id) return { problem: `「${v.name}」每一行的名字只能放进「${v.name}」的「每项一张」里面` };
    return { src: { nm: 1 } };
  }
  if (b.part === 'item') {
    if (v.kind !== 'list') return { problem: `「${v.name}」不是列表` };
    if (innermost(scope, idx, 'list') !== v.id) return { problem: `「${v.name}」的每一项只能放进「${v.name}」的「每项一张」里面` };
    return { src: { it: 1 } };
  }
  if (info.table) {
    if (innermost(scope, idx, 'table') !== info.table.id)
      return { problem: `「${v.name}」是「${info.table.name}」每一行里的内容，只能放进「${info.table.name}」的「每项一张」里面` };
    return { src: { r: varKey(v) } };
  }
  return { src: { p: info.keys } };
}

/** Why `node` can't go inside `parentId` (null = it can). */
export function placementProblem(root: BarNode, vars: VarNode[], node: BarNode, parentId: string): string | null {
  const idx = indexVars(vars);
  const check = (n: BarNode, scope: string[]): string | null => {
    if (n.bind && n.type !== 'repeat') {
      const r = resolve(n.bind, scope, idx);
      if (r.problem && idx.has(n.bind.var)) return r.problem;
    }
    if (n.type === 'repeat' && n.bind) {
      const r = resolve(n.bind, scope, idx);
      if (r.problem && idx.has(n.bind.var)) return r.problem;
      scope = [...scope, n.bind.var];
    }
    for (const c of n.children ?? []) {
      const p = check(c, scope);
      if (p) return p;
    }
    return null;
  };
  return check(node, scopeAt(root, parentId));
}

/** Short description of a component for lists and messages: 进度条「好感度」 */
export function describe(n: BarNode, idx: Map<string, VarInfo>): string {
  if (n.id === 'auto:root') return '整个状态栏';
  const v = n.bind ? idx.get(n.bind.var)?.v : undefined;
  if (n.type === 'text') return `文字「${(n.text ?? '').slice(0, 12) || '空'}」`;
  if (n.type === 'divider') return '分隔线';
  const title = n.type === 'box' && n.children?.[0]?.type === 'text' ? n.children[0].text?.slice(0, 12) : '';
  if (title) return `${TYPE_LABEL[n.type]}「${title}」`;
  if (!v) return TYPE_LABEL[n.type];
  if (n.bind?.part === 'name') return `${TYPE_LABEL[n.type]}「${v.rowName || v.name + '的名字'}」`;
  if (n.bind?.part === 'item') return `${TYPE_LABEL[n.type]}「${v.name}的每一项」`;
  return `${TYPE_LABEL[n.type]}「${v.name}」`;
}

/** Variables shown nowhere on the status bar (tables count when anything shows them). */
export function unplacedVars(bar: Bar, vars: VarNode[]): VarNode[] {
  const used = new Set<string>();
  for (const n of eachNode([bar.root])) if (n.bind) used.add(n.bind.var);
  const out: VarNode[] = [];
  const go = (list: VarNode[]) => {
    for (const v of list) {
      if (v.kind === 'group') go(v.children ?? []);
      else if (v.kind === 'table') {
        if (!used.has(v.id) && !(v.children ?? []).some((f) => used.has(f.id))) out.push(v);
      } else if (!used.has(v.id)) out.push(v);
    }
  };
  go(vars);
  return out;
}

/* ---------- compiling ---------- */

/** What the runtime draws. Keys are short to keep the regex small. */
export type VNode =
  | { t: 'box'; c: string; i?: string; k: VNode[] }
  | { t: 'rep'; c: string; i?: string; s: Src | null; l: 'table' | 'list'; e: string; k: VNode[]; g?: { name?: string; row?: Record<string, unknown>; item?: unknown } }
  | { t: 'text'; c: string; i?: string; x: string }
  | { t: 'hr'; c: string; i?: string; x?: string }
  | {
      t: 'val';
      c: string;
      i?: string;
      s: Src | null;
      lb?: string;
      ic?: string;
      stk?: 1;
      pre?: string;
      suf?: string;
      em: string;
      he?: 1;
      y?: string;
      n?: string;
      la?: 'text';
      sep?: string;
      st?: Src;
      so?: 1;
      pl?: 1;
      /** editor only: shown instead of a value when the binding is broken */
      bad?: string;
    }
  | { t: 'bar'; c: string; i?: string; s: Src | null; lb?: string; ic?: string; stk?: 1; mn: number; mx: number; nm: 'after' | 'inside' | 'none'; ms?: 1; st?: Src; em: string; bad?: string };

export interface CompiledBar {
  view: VNode;
  css: string;
  /** components that can't be shown (left out of the export), in plain words */
  problems: string[];
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** A color the author picked, as CSS; anything unexpected is dropped. */
export function cssColor(c: Color | undefined): string | undefined {
  if (!c) return undefined;
  if (c === 'transparent') return c;
  if (c.startsWith('@') && (THEME_COLORS as readonly string[]).includes(c.slice(1))) return `var(--${c.slice(1)})`;
  return COLOR_RE.test(c) ? c : undefined;
}

export function cssFill(f: Fill | undefined): string | undefined {
  if (!f) return undefined;
  const a = cssColor(f.a);
  const b = cssColor(f.b);
  if (a && b) return `linear-gradient(${num(f.angle ?? 90, 0, 360)}deg, ${a}, ${b})`;
  return a ?? b;
}

const num = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100 : lo);

const SHADOWS: Record<NonNullable<BarStyle['shadow']>, string> = {
  soft: '0 2px 8px rgba(0, 0, 0, 0.25)',
  float: '0 8px 24px rgba(0, 0, 0, 0.35)',
  glow: '0 0 12px var(--accent)',
  inset: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
};

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

/** CSS declarations of a style. `flex`: the element lays out its own content in a row (align with justify-content). */
function styleDecls(s: BarStyle | undefined, flex = false): string[] {
  if (!s) return [];
  const out: string[] = [];
  const color = cssColor(s.color);
  if (color) out.push(`color: ${color}`);
  const bg = cssFill(s.bg);
  if (bg) out.push(`background: ${bg}`);
  if (s.size != null) out.push(`font-size: ${num(s.size, 8, 72)}px`);
  if (s.bold !== undefined) out.push(`font-weight: ${s.bold ? 700 : 400}`);
  if (s.italic) out.push('font-style: italic');
  if (s.align) {
    out.push(`text-align: ${s.align}`);
    if (flex) out.push(`justify-content: ${JUSTIFY[s.align]}`);
  }
  if (s.pad != null) out.push(`padding: ${num(s.pad, 0, 80)}px`);
  if (s.radius != null) out.push(`border-radius: ${num(s.radius, 0, 99)}px`);
  if (s.borderW) {
    const side = s.borderSide && s.borderSide !== 'all' ? `border-${s.borderSide}` : 'border';
    out.push(`${side}: ${num(s.borderW, 0, 20)}px ${s.borderStyle ?? 'solid'} ${cssColor(s.borderColor) ?? 'var(--line)'}`);
  }
  if (s.shadow && SHADOWS[s.shadow]) out.push(`box-shadow: ${SHADOWS[s.shadow]}`);
  if (s.opacity != null && s.opacity < 1) out.push(`opacity: ${num(s.opacity, 0, 1)}`);
  return out;
}

const rule = (sel: string, decls: string[]) => (decls.length ? `${sel} { ${decls.join('; ')}; }\n` : '');

/** Base CSS shared by every status bar, then the theme. */
function baseCss(t: BarTheme): string {
  const vars = THEME_COLORS.map((k) => `--${k}: ${cssColor(t[k]) ?? '#888888'}`).join('; ');
  return `
:root { ${vars}; --size: ${num(t.size, 10, 24)}px; --font: ${(FONTS[t.font] ?? FONTS.sans).css}; }
html, body { margin: 0; background: transparent; }
body { font: var(--size)/1.5 var(--font); color: var(--text); }
#sb { display: block; }
.sb-box { display: flex; flex-direction: column; gap: 8px; min-width: 0; box-sizing: border-box; }
.sb-box.sb-row { flex-direction: row; align-items: center; flex-wrap: wrap; }
.sb-box.sb-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.sb-row > div { flex: 1 1 0; min-width: 0; }
.sb-text { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; box-sizing: border-box; }
.sb-val { display: flex; align-items: baseline; gap: 6px; min-width: 0; box-sizing: border-box; }
.sb-val.sb-stack, .sb-barrow.sb-stack { flex-wrap: wrap; row-gap: 0; }
.sb-stack > .sb-label { flex-basis: 100%; }
.sb-label { color: var(--dim); flex: none; }
.sb-icon { flex: none; }
.sb-v { min-width: 0; overflow-wrap: anywhere; }
.sb-pill { background: var(--line); border-radius: 99px; padding: 0 8px; }
.sb-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.sb-chip { background: var(--line); border-radius: 6px; padding: 0 6px; }
.sb-barrow { display: flex; align-items: center; gap: 8px; min-width: 0; box-sizing: border-box; }
.sb-track { flex: 1; position: relative; height: 8px; min-width: 40px; background: var(--line); border-radius: 99px; overflow: hidden; }
.sb-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: inherit; }
.sb-in { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1; }
.sb-stage { font-size: 12px; padding: 0 6px; border-radius: 99px; background: var(--line); color: var(--text); flex: none; }
.sb-hr { display: flex; align-items: center; gap: 8px; color: var(--dim); font-size: 12px; min-height: 8px; }
.sb-hr::before, .sb-hr::after { content: ''; flex: 1; border-top: 1px solid var(--line); }
.sb-hr.sb-fade::before { border-top: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--line)); }
.sb-hr.sb-fade::after { border-top: 0; height: 1px; background: linear-gradient(90deg, var(--line), transparent); }
.sb-rep { display: flex; flex-direction: column; gap: 6px; min-width: 0; box-sizing: border-box; }
.sb-rep.sb-row { flex-direction: row; flex-wrap: wrap; }
.sb-rep.sb-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sb-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; background: rgba(255, 255, 255, 0.05); border-radius: 6px; padding: 4px 8px; box-sizing: border-box; }
.sb-items-row > .sb-item { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; }
.sb-empty { color: var(--dim); font-size: 12px; }
.sb-ghost { opacity: 0.45; }
`;
}

/** Width of a child inside a row. */
function widthDecls(w: Width | undefined): string[] {
  if (w === undefined) return [];
  if (w === 'auto') return ['flex: 0 1 auto'];
  return [`flex: 0 1 ${num(w, 1, 100)}%`];
}

/** Turns the status bar into the runtime's view and CSS. `edit`: for the canvas (ids, placeholders, sample rows). */
export function compileBar(bar: Bar, vars: VarNode[], opts: { edit?: boolean } = {}): CompiledBar {
  const idx = indexVars(vars);
  const problems: string[] = [];
  const css: string[] = [baseCss({ ...defaultTheme(), ...bar.theme })];
  let n = 0;
  const edit = !!opts.edit;

  const go = (node: BarNode, scope: string[], parent: BarNode | null): VNode | null => {
    const c = `n${++n}`;
    const sel = `.${c}`;
    const base = { c, ...(edit ? { i: node.id } : {}) };
    const s = node.style;
    const inRow = parent?.type === 'box' && parent.dir === 'row';
    const sized = inRow ? widthDecls(s?.width) : [];
    const lb = (): string | undefined => {
      const v = node.bind ? idx.get(node.bind.var)?.v : undefined;
      const text = node.label ?? (node.bind?.part === 'name' ? '' : node.bind?.part === 'item' ? '' : v?.name ?? '');
      return text ? text + (node.colon ? '：' : '') : undefined;
    };
    const labelCss = () => {
      const lc = cssColor(node.labelColor);
      if (lc) css.push(rule(`${sel} > .sb-label`, [`color: ${lc}`]));
    };
    const broken = (r: Resolved) => {
      if (!r.problem) return false;
      problems.push(`${describe(node, idx)}：${r.problem}`);
      return true;
    };

    switch (node.type) {
      case 'box': {
        const gridCols = node.dir === 'grid' ? [`grid-template-columns: repeat(${num(node.cols ?? 2, 1, 6)}, minmax(0, 1fr))`] : [];
        css.push(rule(sel, [...styleDecls(s, node.dir === 'row'), ...(node.gap != null ? [`gap: ${num(node.gap, 0, 60)}px`] : []), ...gridCols, ...sized]));
        const kids = (node.children ?? []).map((k) => go(k, scope, node)).filter((k): k is VNode => !!k);
        return { t: 'box', ...base, c: c + (node.dir === 'row' ? ' sb-row' : node.dir === 'grid' ? ' sb-grid' : ''), k: kids };
      }
      case 'repeat': {
        const r = resolve(node.bind, scope, idx);
        const info = node.bind ? idx.get(node.bind.var) : undefined;
        const kind = info?.v.kind === 'list' ? 'list' : 'table';
        const okKind = !info || info.v.kind === 'table' || info.v.kind === 'list';
        if (!okKind) r.problem = `「${info!.v.name}」不是表格或列表`;
        if (broken(r) && !edit) return null;
        const gridCols = node.dir === 'grid' ? [`grid-template-columns: repeat(${num(node.cols ?? 2, 1, 6)}, minmax(0, 1fr))`] : [];
        css.push(rule(sel, [...styleDecls(s), ...(node.gap != null ? [`gap: ${num(node.gap, 0, 60)}px`] : []), ...gridCols, ...sized]));
        css.push(rule(`${sel} > .sb-item`, styleDecls(node.itemStyle, node.inner === 'row')));
        const inner = r.problem ? scope : [...scope, node.bind!.var];
        const kids = (node.children ?? []).map((k) => go(k, inner, node)).filter((k): k is VNode => !!k);
        const out: VNode = {
          t: 'rep',
          ...base,
          c: c + (node.dir === 'row' ? ' sb-row' : node.dir === 'grid' ? ' sb-grid' : '') + (node.inner === 'row' ? ' sb-items-row' : ''),
          s: r.src ?? null,
          l: kind,
          e: node.emptyText ?? '暂无',
          k: kids,
        };
        if (edit) out.g = sampleItem(info?.v);
        return out;
      }
      case 'text':
        css.push(rule(sel, [...styleDecls(s), ...sized]));
        return { t: 'text', ...base, x: node.text ?? '' };
      case 'divider': {
        const lc = cssColor(node.lineColor);
        const lw = node.lineW != null ? num(node.lineW, 1, 10) : null;
        css.push(rule(sel, [...styleDecls(s), ...sized]));
        if (node.line && node.line !== 'fade') {
          const d = [`border-top-style: ${node.line}`];
          if (lc) d.push(`border-top-color: ${lc}`);
          if (lw) d.push(`border-top-width: ${lw}px`);
          css.push(rule(`${sel}::before, ${sel}::after`, d));
        } else {
          const col = lc ?? 'var(--line)';
          const h = lw ? [`height: ${lw}px`] : [];
          css.push(rule(`${sel}::before`, [`background: linear-gradient(90deg, transparent, ${col})`, ...h]));
          css.push(rule(`${sel}::after`, [`background: linear-gradient(90deg, ${col}, transparent)`, ...h]));
        }
        return { t: 'hr', ...base, c: c + (node.line === 'fade' || !node.line ? ' sb-fade' : ''), ...(node.text ? { x: node.text } : {}) };
      }
      case 'value': {
        const r = resolve(node.bind, scope, idx);
        if (broken(r) && !edit) return null;
        const info = node.bind ? idx.get(node.bind.var) : undefined;
        const v = info?.v;
        css.push(rule(sel, [...styleDecls(s, true), ...sized]));
        const vd: string[] = [];
        const vc = cssColor(node.valColor);
        if (vc) vd.push(`color: ${vc}`);
        if (node.valSize != null) vd.push(`font-size: ${num(node.valSize, 8, 72)}px`);
        if (node.valBold !== undefined) vd.push(`font-weight: ${node.valBold ? 700 : 400}`);
        css.push(rule(`${sel} .sb-v, ${sel} .sb-chip`, vd));
        labelCss();
        const staged = !node.bind?.part && info?.stage && !info.table;
        const show = staged ? node.show ?? 'value' : 'value';
        const out: VNode = { t: 'val', ...base, c: c + (node.stack ? ' sb-stack' : ''), s: r.src ?? null, em: node.empty ?? '—' };
        const label = lb();
        if (label) out.lb = label;
        if (node.icon) out.ic = node.icon;
        if (node.prefix) out.pre = node.prefix;
        if (node.suffix) out.suf = node.suffix;
        if (node.hideEmpty) out.he = 1;
        if (v?.kind === 'bool') {
          out.y = node.yes ?? '是';
          out.n = node.no ?? '否';
        }
        if (node.listAs === 'text') out.la = 'text';
        if (node.sep) out.sep = node.sep;
        if (staged && show !== 'value') out.st = { p: info!.stage! };
        if (show === 'stage') out.so = 1;
        if (node.pill) out.pl = 1;
        if (node.stack) out.stk = 1;
        if (r.problem) out.bad = r.problem;
        return out;
      }
      case 'bar': {
        const r = resolve(node.bind, scope, idx);
        const info = node.bind ? idx.get(node.bind.var) : undefined;
        if (info && info.v.kind !== 'number') r.problem = `「${info.v.name}」不是数字`;
        if (broken(r) && !edit) return null;
        const v = info?.v;
        const mn = node.min ?? v?.min ?? 0;
        let mx = node.max ?? v?.max ?? 100;
        if (!(mx > mn)) mx = mn + 100;
        css.push(rule(sel, [...styleDecls(s, true), ...sized]));
        const td: string[] = [];
        const tc = cssColor(node.track);
        if (tc) td.push(`background: ${tc}`);
        if (node.height != null) td.push(`height: ${num(node.height, 2, 40)}px`);
        css.push(rule(`${sel} .sb-track`, td));
        const fill = cssFill(node.fill);
        if (fill) css.push(rule(`${sel} .sb-fill`, [`background: ${fill}`]));
        const vd: string[] = [];
        const vc = cssColor(node.valColor);
        if (vc) vd.push(`color: ${vc}`);
        if (node.valSize != null) vd.push(`font-size: ${num(node.valSize, 8, 72)}px`);
        if (node.valBold !== undefined) vd.push(`font-weight: ${node.valBold ? 700 : 400}`);
        css.push(rule(`${sel} .sb-v, ${sel} .sb-in`, vd));
        labelCss();
        const out: VNode = { t: 'bar', ...base, c: c + (node.stack ? ' sb-stack' : ''), s: r.src ?? null, mn: num(mn, -1e9, 1e9), mx: num(mx, -1e9, 1e9), nm: node.num ?? 'after', em: '—' };
        const label = lb();
        if (label) out.lb = label;
        if (node.icon) out.ic = node.icon;
        if (node.stack) out.stk = 1;
        if (node.showMax) out.ms = 1;
        if (node.showStage && info?.stage && !info.table) out.st = { p: info.stage };
        if (r.problem) out.bad = r.problem;
        return out;
      }
    }
  };

  const view = go(bar.root, [], null) ?? { t: 'box', c: 'n0', k: [] };
  return { view, css: css.join('').trim(), problems };
}

/** Made-up row shown on the canvas while a table or list is empty, so its components can still be picked. */
function sampleItem(v: VarNode | undefined): { name?: string; row?: Record<string, unknown>; item?: unknown } {
  if (v?.kind === 'list') return { item: '（列表里的一项）' };
  const row: Record<string, unknown> = {};
  for (const f of v?.children ?? []) row[varKey(f)] = f.init ?? defaultValue(f);
  return { name: `（${v?.rowName || '名字'}）`, row };
}

/** The bar to show and export: the author's layout, or the automatic one, in the author's colors. */
export function barOf(p: { bar?: SavedBar; vars: VarNode[] }): Bar {
  const theme = { ...defaultTheme(), ...p.bar?.theme };
  return p.bar?.root ? { v: 1, theme, root: p.bar.root } : defaultBar(p.vars, theme);
}

/** What to keep after an edit: the layout only once it differs from the automatic one. */
export function saveBar(before: { bar?: SavedBar }, auto: Bar, next: Bar): SavedBar {
  const root = before.bar?.root || next.root !== auto.root ? next.root : undefined;
  return root ? { v: 1, theme: next.theme, root } : { v: 1, theme: next.theme };
}

/** Components for a variable dragged in from the variable list (a table field becomes one line of its row). */
export function nodeFromVar(v: VarNode, vars: VarNode[]): BarNode {
  return indexVars(vars).get(v.id)?.table ? fieldNode(v, freshIds) : nodesForVar(v);
}

/** Where in the tree a component is, for breadcrumbs. */
export function pathTo(root: BarNode, id: string): BarNode[] {
  const out: BarNode[] = [];
  let cur = locate([root], id);
  while (cur) {
    out.unshift(cur.node);
    cur = cur.parent ? locate([root], cur.parent.id) : null;
  }
  return out;
}

export const findNode = (root: BarNode, id: string | null) => findVar([root], id);
