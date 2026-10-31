// The status bar the author lays out on the canvas: a tree of components, some bound to variables.
// compileBar() turns it into what the status bar runtime draws (statusbar.ts) plus its CSS.
//
// Components point at variables by id, so renaming or moving a variable never breaks the status bar.
// Everything the author types ends up as data (JSON), never inside CSS; CSS values are checked here
// because the CSS goes through ST's message formatting too (see the top of statusbar.ts).
import { newId } from '../lib/id';
import { eachNode, findVar, locate } from './tree';
import type { VarKind, VarNode } from './types';
import { defaultValue, stageKey, varKey } from './vars';

export type BarType = 'box' | 'repeat' | 'text' | 'value' | 'bar' | 'divider' | 'image' | 'button' | 'menu' | 'tabs' | 'fold';

/** What a button (or a menu entry) does when clicked. */
export type Action =
  /** open the form where players change variables; `vars`: only these (default: every player-editable one) */
  | { do: 'edit'; vars?: string[]; title?: string }
  /** show / hide a component, or open / close a fold */
  | { do: 'toggle'; target?: string }
  /** switch a tabs component to one of its pages */
  | { do: 'page'; target?: string; page?: number }
  /** put words into the chat input, or send them */
  | { do: 'say'; text?: string; send?: boolean };

export type Place = 'left' | 'center' | 'right' | 'full';

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
  /** padding left and right, when it should differ from top and bottom */
  padX?: number;
  /** text in a gradient (text, buttons, menus, fold titles) */
  textGrad?: Fill;
  /** font of this part (default: the whole status bar's) */
  font?: FontName;
  /** space between letters, px */
  ls?: number;
  textFx?: TextFx;
  /** border in a gradient (all four sides) */
  borderGrad?: Fill;
  /** keeps moving */
  anim?: LoopAnim;
  /** seconds per round of `anim` */
  animSec?: number;
  /** how it comes in when the message shows up */
  enter?: EnterAnim;
  /** when the mouse is over it */
  hover?: HoverFx;
}

export type TextFx = 'shadow' | 'glow' | 'outline' | 'lift';
export type LoopAnim = 'breathe' | 'float' | 'beat' | 'blink' | 'spin' | 'flow';
export type EnterAnim = 'fade' | 'up' | 'zoom' | 'left';
export type HoverFx = 'grow' | 'lift' | 'bright';

/** What a component shows: a variable, the row name inside a table repeat, or the item inside a list repeat. */
export interface Binding {
  var: string;
  part?: 'name' | 'item';
}

/**
 * A look that depends on the value. Numbers: from `at` up (below the first one, the first one applies).
 * Other values: when the value is exactly `at`.
 */
export interface ValueCase {
  at: number | string;
  color?: Color;
  icon?: string;
  /** words shown after the value, e.g. 「危险」 */
  text?: string;
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
  /** value, repeat: nothing at all is shown when there is nothing */
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
  /** line: thickness; segments: their height; ring: its size; icons: their size */
  height?: number;
  /** a line (default), separate segments, a ring, or a row of icons like ★★★☆☆ */
  barLook?: 'line' | 'seg' | 'ring' | 'icons';
  /** how many segments or icons */
  count?: number;
  /** the icon (icons look) */
  sym?: string;
  /** icons: only whole ones light up */
  whole?: boolean;

  /* image */
  /** the picture: a link (http/https) or a picture put inside the card (data:image/…); with `bind`, used when nothing matches */
  src?: string;
  /** with `bind`: which picture for which value (no map = the variable holds the link itself) */
  imgMap?: Record<string, string>;
  /** width in px (default: as wide as there is room) */
  imgW?: number;
  /** height in px (default: keeps the picture's shape) */
  imgH?: number;
  /** when the height is set: crop to fill, or show all of it */
  fit?: 'cover' | 'contain';
  /** round, like an avatar (as tall as it is wide) */
  circle?: boolean;

  /* divider */
  line?: 'solid' | 'dashed' | 'dotted' | 'fade';
  lineColor?: Color;
  lineW?: number;

  /* any component: starts hidden (a button can show it) */
  hidden?: boolean;
  /** containers: what is inside comes in one after another */
  stagger?: boolean;
  /** value, bar: the number in a gradient */
  valGrad?: Fill;
  /** bar: grows from 0 when the message shows up */
  grow?: boolean;
  /** value, bar: color, icon and words that depend on the value */
  cases?: ValueCase[];
  /** number cases: colors blend smoothly from one point to the next */
  smooth?: boolean;
  /** value, bar (numbers): compare with the previous message: an arrow, the difference, or both */
  diff?: 'arrow' | 'num' | 'both';
  /** going up is bad (e.g. stress): up in red, down in green */
  diffBad?: boolean;

  /* button, menu (the button that opens it), fold (the header): `text` and `icon` are what they show */
  action?: Action;
  /** where a button sits when it is not in a row */
  place?: Place;
  /** menu: little ▾ after the words; fold: arrow in front of the title (default on) */
  arrow?: boolean;
  /** menu: the list that pops up */
  popStyle?: BarStyle;

  /* tabs */
  tabLook?: 'line' | 'pill' | 'card';
  tabColor?: Color;
  /** page shown first */
  start?: number;
  /** box inside tabs: the name on its tab */
  title?: string;

  /* fold */
  /** starts closed */
  closed?: boolean;
  headStyle?: BarStyle;
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

export type FontName = 'sans' | 'serif' | 'kai' | 'mono' | 'round' | 'fang' | 'li' | 'xing';

/** Fonts that come with Windows / macOS (a player without one sees the next in the list). */
export const FONTS: Record<FontName, { label: string; css: string }> = {
  sans: { label: '黑体（默认）', css: "system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif" },
  serif: { label: '宋体', css: "'Noto Serif SC', 'Songti SC', 'SimSun', serif" },
  kai: { label: '楷体', css: "'KaiTi', 'STKaiti', 'Kaiti SC', serif" },
  fang: { label: '仿宋', css: "'FangSong', 'STFangsong', 'FangSong SC', serif" },
  round: { label: '圆体', css: "'Yuanti SC', 'YouYuan', 'Microsoft YaHei', sans-serif" },
  li: { label: '隶书', css: "'LiSu', 'STLiti', 'Baoli SC', 'KaiTi', serif" },
  xing: { label: '行楷', css: "'STXingkai', 'Xingkai SC', 'KaiTi', serif" },
  mono: { label: '等宽', css: "'Consolas', 'Courier New', 'Microsoft YaHei', monospace" },
};

export type BarTheme = Record<ThemeColor, string> & {
  preset: string;
  font: FontName;
  size: number;
  /** turn every animation off */
  noAnim?: boolean;
};

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
  image: '图片',
  button: '按钮',
  menu: '菜单',
  tabs: '标签页',
  fold: '折叠块',
};

/** Components that hold other components. */
export const isContainer = (n: BarNode) => n.type === 'box' || n.type === 'repeat' || n.type === 'menu' || n.type === 'tabs' || n.type === 'fold';

/* ---------- variables as seen from the status bar ---------- */

export interface VarInfo {
  v: VarNode;
  /** keys from the top of stat_data */
  keys: string[];
  /** the table this is a field of */
  table: VarNode | null;
  /** where the computed stage name is (numbers with stages, outside tables) */
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
      const stage = v.kind === 'number' && v.stages?.length && parent?.kind !== 'table' ? [...keys, stageKey(v)] : null;
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
    case 'image':
      return { id, type, imgH: 120, fit: 'cover', style: { radius: 8 } };
    case 'button':
      return { id, type, text: '按钮' };
    case 'menu':
      return { id, type, text: '菜单', icon: '☰', children: [{ id: newId(), type: 'button', text: '选项一' }] };
    case 'tabs':
      return { id, type, tabLook: 'line', children: [newPage('第一页'), newPage('第二页')] };
    case 'fold':
      return { id, type, text: '详情', dir: 'col', gap: 6, style: { bg: { a: '@card' }, radius: 10, pad: 10 }, children: [] };
  }
}

/** A page inside a tabs component. */
export const newPage = (title: string): BarNode => ({ id: newId(), type: 'box', title, dir: 'col', gap: 8, children: [] });

/** The button that opens the players' edit form. */
export const editButton = (): BarNode => ({ id: newId(), type: 'button', text: '修改', icon: '✎', action: { do: 'edit' } });

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

/** Why `node` can't go directly inside `parent` (null = it can). */
export function childProblem(parent: BarNode | null, node: BarNode): string | null {
  if (parent?.type === 'menu' && node.type !== 'button' && node.type !== 'menu') return '菜单里只能放按钮和子菜单';
  if (parent?.type === 'tabs' && node.type !== 'box') return '标签页里只能直接放「页」，内容要放进某一页里';
  return null;
}

/** Why `node` can't go inside `parentId` (null = it can). */
export function placementProblem(root: BarNode, vars: VarNode[], node: BarNode, parentId: string): string | null {
  const direct = childProblem(findNode(root, parentId), node);
  if (direct) return direct;
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
  if (n.type === 'image' && !v) return '图片';
  if (n.type === 'button') return `${n.action?.do === 'edit' ? '修改按钮' : '按钮'}「${(n.text || n.icon || '').slice(0, 12)}」`;
  if (n.type === 'menu' || n.type === 'fold') return `${TYPE_LABEL[n.type]}「${(n.text || n.icon || '').slice(0, 12)}」`;
  if (n.type === 'box' && n.title !== undefined) return `页「${n.title.slice(0, 12)}」`;
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

/** What a button does, in the runtime's terms: edit form, toggle, page, say. */
export type VAct =
  | { ed: 1; vs?: number[]; tt?: string }
  | { tg: string; f?: 1 }
  | { pg: string; n: number }
  | { say: string; send?: 1 };

/** c: CSS class, i: component id (canvas only), h: starts hidden */
interface VBase {
  c: string;
  i?: string;
  h?: 1;
}

/** What the runtime draws. Keys are short to keep the regex small. */
export type VNode = VBase &
  (
  | { t: 'box'; k: VNode[] }
  | { t: 'rep'; s: Src | null; l: 'table' | 'list'; e: string; he?: 1; k: VNode[]; g?: { name?: string; row?: Record<string, unknown>; item?: unknown } }
  | { t: 'text'; x: string }
  | { t: 'hr'; x?: string }
  | { t: 'btn'; x: string; ic?: string; a?: VAct }
  | { t: 'menu'; x: string; ic?: string; ar?: 1; k: VNode[] }
  | { t: 'tabs'; tl: string[]; st: number; k: VNode[] }
  | { t: 'fold'; x: string; ic?: string; cl?: 1; bc: string; k: VNode[] }
  | {
      t: 'val';
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
    } & ByValue
  | {
      t: 'bar';
      s: Src | null;
      lb?: string;
      ic?: string;
      stk?: 1;
      mn: number;
      mx: number;
      nm: 'after' | 'inside' | 'none';
      ms?: 1;
      st?: Src;
      em: string;
      bad?: string;
      /** look: segments, ring, icons (none = a line); sc: how many, sy: the icon, wh: whole icons only */
      lk?: 'seg' | 'ring' | 'sym';
      sc?: number;
      sy?: string;
      wh?: 1;
    } & ByValue
  /** u: the fixed picture (or the one used when nothing matches), s: the variable, m: value → picture */
  | { t: 'img'; u?: string; s?: Src | null; m?: Record<string, string>; bad?: string }
  );

/** cs: looks by value (a: from / equal to, c: color, i: icon, x: words), sm: blend colors, df/db: compare with the previous message */
interface ByValue {
  cs?: { a: number | string; c?: string; i?: string; x?: string }[];
  sm?: 1;
  df?: 'a' | 'n' | 'b';
  db?: 1;
}

/**
 * A value in the players' edit form. k: key, n: name, t: kind, mn/mx: range, int: whole numbers, o: choices, d: default,
 * sg/sn: stages and the key of the stage name next to the number (MVU computes it, but writing skips MVU, so the form does)
 */
export interface EdField {
  k: string;
  n: string;
  t: VarKind;
  mn?: number;
  mx?: number;
  int?: 1;
  o?: string[];
  d?: unknown;
  sg?: { f: number; l: string }[];
  sn?: string;
}

/** A variable in the edit form. p: where it is, f: table fields, rn: row name, dz: drop rows when this field is 0 or less */
export interface EdVar extends EdField {
  p: string[];
  f?: EdField[];
  rn?: string;
  dz?: string;
}

export interface CompiledBar {
  view: VNode;
  css: string;
  /** components that can't be shown (left out of the export), in plain words */
  problems: string[];
  /** variables players may change (only when the card allows it) */
  ed: EdVar[];
  /** some button opens the edit form */
  hasEdit: boolean;
  /** where the runtime remembers folds, tabs and toggles the player clicked */
  key?: string;
}

export interface CompileOpts {
  /** for the canvas: component ids, placeholders, sample rows */
  edit?: boolean;
  /** the card allows players to change variables */
  allowEdit?: boolean;
  /** project id: the runtime remembers the player's clicks under it */
  key?: string;
}

/** Variables players may change with the edit button, in the order of the variable list. Table fields go with their table. */
export function editableVars(vars: VarNode[]): { list: EdVar[]; ids: string[] } {
  const field = (v: VarNode): EdField => {
    const f: EdField = { k: varKey(v), n: v.name, t: v.kind };
    if (v.kind === 'number') {
      if (v.min != null) f.mn = v.min;
      if (v.max != null) f.mx = v.max;
      if (v.integer) f.int = 1;
    }
    if (v.kind === 'choice') f.o = v.options ?? [];
    if (v.kind !== 'group' && v.kind !== 'table') f.d = v.init === undefined ? defaultValue(v) : v.init;
    if (v.kind === 'number' && v.stages?.length) {
      f.sg = [...v.stages].sort((a, b) => a.from - b.from).map((s) => ({ f: s.from, l: s.label }));
      f.sn = stageKey(v);
    }
    return f;
  };
  const list: EdVar[] = [];
  const ids: string[] = [];
  for (const info of indexVars(vars).values()) {
    const v = info.v;
    if (!v.playerEditable || v.kind === 'group' || info.table) continue;
    const m: EdVar = { ...field(v), p: info.keys, n: info.label };
    delete m.d;
    if (v.kind === 'table') {
      m.f = (v.children ?? []).map(field);
      m.rn = v.rowName || '名字';
      const dz = (v.children ?? []).find((f) => f.name === v.dropRowWhenZero && f.kind === 'number');
      if (dz) m.dz = varKey(dz);
    }
    list.push(m);
    ids.push(v.id);
  }
  return { list, ids };
}

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** A picture the status bar may show: a web link, or a picture inside the card. */
export const imageUrlOk = (u: string) => /^(https?:\/\/\S|data:image\/)/i.test(u.trim());

/** Variables whose value can pick a picture. */
export const IMAGE_KINDS = new Set<VarKind>(['text', 'choice', 'bool']);

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

/** Kinds of value a look-by-value can follow. */
export const CASE_KINDS = new Set<VarKind>(['number', 'text', 'choice', 'bool']);

/** Looks by value and the comparison with the previous message, in the runtime's terms (only checked colors get in). */
function byValue(node: BarNode, numeric: boolean): ByValue {
  const out: ByValue = {};
  const list = (node.cases ?? [])
    .filter((k) => (numeric ? typeof k.at === 'number' && isFinite(k.at) : typeof k.at === 'string'))
    .map((k) => {
      const o: NonNullable<ByValue['cs']>[number] = { a: numeric ? num(k.at, -1e9, 1e9) : String(k.at) };
      const c = cssColor(k.color);
      if (c) o.c = c;
      if (k.icon) o.i = Array.from(k.icon).slice(0, 6).join('');
      if (k.text) o.x = k.text.slice(0, 40);
      return o;
    })
    .filter((o) => o.c || o.i || o.x);
  if (numeric) list.sort((a, b) => (a.a as number) - (b.a as number));
  if (list.length) out.cs = list;
  if (numeric && node.smooth && list.filter((o) => o.c).length > 1) out.sm = 1;
  if (numeric && node.diff) {
    out.df = node.diff === 'num' ? 'n' : node.diff === 'both' ? 'b' : 'a';
    if (node.diffBad) out.db = 1;
  }
  return out;
}

const SHADOWS: Record<NonNullable<BarStyle['shadow']>, string> = {
  soft: '0 2px 8px rgba(0, 0, 0, 0.25)',
  float: '0 8px 24px rgba(0, 0, 0, 0.35)',
  glow: '0 0 12px var(--accent)',
  inset: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
};

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

/** A gradient border is drawn by a ring laid over a see-through border (works with rounded corners). */
const gradBorder = (s: BarStyle | undefined) => !!s?.borderW && !!s.borderGrad?.b && (!s.borderSide || s.borderSide === 'all') && !!cssFill(s.borderGrad);

const TEXT_FX: Record<TextFx, string[]> = {
  shadow: ['0 1px 3px rgba(0, 0, 0, 0.6)'],
  glow: ['0 0 4px currentColor', '0 0 10px var(--accent)'],
  outline: ['-1px -1px 0 var(--bg)', '1px -1px 0 var(--bg)', '-1px 1px 0 var(--bg)', '1px 1px 0 var(--bg)'],
  lift: ['1px 1px 0 var(--line)', '2px 2px 0 var(--line)', '3px 3px 2px rgba(0, 0, 0, 0.35)'],
};

type DeclOpts = {
  /** lays out its own content in a row (align with justify-content) */
  flex?: boolean;
  /** already positioned (a gradient border needs that) */
  positioned?: boolean;
  /** can't draw a gradient border (pictures, dividers): a plain one instead */
  solid?: boolean;
};

/** CSS declarations of a style. */
function styleDecls(s: BarStyle | undefined, o: DeclOpts = {}): string[] {
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
    if (o.flex) out.push(`justify-content: ${JUSTIFY[s.align]}`);
  }
  if (s.pad != null && s.padX != null) out.push(`padding: ${num(s.pad, 0, 80)}px ${num(s.padX, 0, 80)}px`);
  else if (s.pad != null) out.push(`padding: ${num(s.pad, 0, 80)}px`);
  else if (s.padX != null) out.push(`padding-left: ${num(s.padX, 0, 80)}px`, `padding-right: ${num(s.padX, 0, 80)}px`);
  if (s.radius != null) out.push(`border-radius: ${num(s.radius, 0, 99)}px`);
  if (gradBorder(s) && !o.solid) {
    out.push(`border: ${num(s.borderW, 0, 20)}px solid transparent`);
    if (!o.positioned) out.push('position: relative');
  } else if (s.borderW) {
    const side = s.borderSide && s.borderSide !== 'all' ? `border-${s.borderSide}` : 'border';
    out.push(`${side}: ${num(s.borderW, 0, 20)}px ${s.borderStyle ?? 'solid'} ${cssColor(s.borderGrad?.a ?? s.borderColor) ?? 'var(--line)'}`);
  }
  if (s.shadow && SHADOWS[s.shadow]) out.push(`box-shadow: ${SHADOWS[s.shadow]}`);
  if (s.opacity != null && s.opacity < 1) out.push(`opacity: ${num(s.opacity, 0, 1)}`);
  if (s.font && FONTS[s.font]) out.push(`font-family: ${FONTS[s.font].css}`);
  if (s.ls) out.push(`letter-spacing: ${num(s.ls, -2, 20)}px`);
  if (s.textFx && TEXT_FX[s.textFx]) out.push(`text-shadow: ${TEXT_FX[s.textFx].join(', ')}`);
  return out;
}

/** Text drawn with a gradient (its shadow then has to be a filter, or it covers the gradient). */
const gradTextDecls = (f: Fill | undefined, fx: TextFx | undefined): string[] => {
  const g = f?.b ? cssFill(f) : undefined;
  if (!g) return [];
  const out = [`background: ${g}`, '-webkit-background-clip: text', 'background-clip: text', '-webkit-text-fill-color: transparent', 'text-shadow: none'];
  if (fx && TEXT_FX[fx]) out.push(`filter: ${TEXT_FX[fx].map((x) => `drop-shadow(${x})`).join(' ')}`);
  return out;
};

/** Default seconds per round of each loop. */
export const LOOP_SEC: Record<LoopAnim, number> = { breathe: 2.4, float: 3, beat: 1.6, blink: 1.4, spin: 8, flow: 6 };
const LOOP_EASE: Record<LoopAnim, string> = { breathe: 'ease-in-out', float: 'ease-in-out', beat: 'ease-in-out', blink: 'ease-in-out', spin: 'linear', flow: 'ease' };

/** Keyframes, added only when something uses them. */
const KEYFRAMES: Record<string, string> = {
  breathe: '50% { box-shadow: 0 0 14px var(--accent); }',
  float: '50% { transform: translateY(-4px); }',
  beat: '0%, 40%, 100% { transform: scale(1); } 10% { transform: scale(1.08); } 25% { transform: scale(1.04); }',
  blink: '50% { opacity: 0.35; }',
  spin: 'to { transform: rotate(360deg); }',
  flow: '0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; }',
  'in-fade': 'from { opacity: 0; }',
  'in-up': 'from { opacity: 0; transform: translateY(10px); }',
  'in-zoom': 'from { opacity: 0; transform: scale(0.92); }',
  'in-left': 'from { opacity: 0; transform: translateX(-14px); }',
  grow: 'from { width: 0; }',
  'ring-in': 'from { opacity: 0; transform: rotate(-120deg) scale(0.8); }',
};

const ENTER_SEC = 0.5;

const HOVER: Record<HoverFx, string[]> = {
  grow: ['transform: scale(1.04)'],
  lift: ['transform: translateY(-3px)', 'box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35)'],
  bright: ['filter: brightness(1.15)'],
};

/** Everything in the status bar that can move (written out: a lone asterisk would upset ST's formatting). */
export const STILL = '#sb, #sb div, #sb span, #sb button, #sb img, #sb div::after, #sb button::after';

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
:where(.sb-row) > div { flex: 1 1 0; min-width: 0; }
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
.sb-barrow { --fa: var(--accent); --fb: var(--accent2); --tk: var(--line); display: flex; align-items: center; gap: 8px; min-width: 0; box-sizing: border-box; }
.sb-track { flex: 1; position: relative; height: 8px; min-width: 40px; background: var(--tk); border-radius: 99px; overflow: hidden; }
.sb-fill { height: 100%; background: linear-gradient(90deg, var(--fa), var(--fb)); border-radius: inherit; }
.sb-in { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1; }
.sb-segs { flex: 1; position: relative; display: flex; gap: 3px; min-width: 40px; }
.sb-seg { flex: 1; height: 8px; background: var(--tk); border-radius: 2px; }
.sb-seg.sb-on { background: linear-gradient(90deg, var(--fa), var(--fb)); }
.sb-ringw { position: relative; flex: none; width: 44px; height: 44px; }
.sb-ring { position: absolute; inset: 0; border-radius: 50%; -webkit-mask: radial-gradient(farthest-side, transparent 70%, #000 72%); mask: radial-gradient(farthest-side, transparent 70%, #000 72%); }
.sb-ringw > .sb-in { font-size: 12px; }
.sb-sym { position: relative; display: inline-block; flex: none; font-size: 18px; line-height: 1.2; letter-spacing: 2px; white-space: nowrap; }
.sb-syme { color: var(--tk); filter: grayscale(1); }
.sb-symf { position: absolute; left: 0; top: 0; overflow: hidden; color: var(--fa); }
.sb-img { display: block; max-width: 100%; object-fit: cover; box-sizing: border-box; }
.sb-imgph { display: flex; align-items: center; justify-content: center; max-width: 100%; min-height: 48px; border: 1px dashed var(--line); border-radius: 8px; color: var(--dim); font-size: 12px; box-sizing: border-box; }
.sb-stage { font-size: 12px; padding: 0 6px; border-radius: 99px; background: var(--line); color: var(--text); flex: none; }
.sb-diff { font-size: 0.85em; font-weight: 700; flex: none; }
.sb-good { color: #3fbf7f; }
.sb-bad { color: #f0686a; }
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
.sb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; align-self: flex-start; max-width: 100%; padding: 4px 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; line-height: 1.4; cursor: pointer; box-sizing: border-box; }
.sb-btn:hover { filter: brightness(1.12); }
.sb-btn:active { transform: scale(0.97); }
.sb-arrow { font-size: 0.75em; opacity: 0.8; }
.sb-menu { position: relative; display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
.sb-pop { position: absolute; top: 100%; left: 0; z-index: 20; display: flex; flex-direction: column; gap: 2px; min-width: 150px; max-width: 92vw; margin-top: 4px; padding: 4px; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); box-sizing: border-box; }
.sb-pop .sb-btn { align-self: stretch; justify-content: flex-start; padding: 6px 10px; border-radius: 6px; background: transparent; color: var(--text); }
.sb-pop .sb-btn:hover { background: var(--line); filter: none; }
.sb-pop .sb-menu { position: static; align-items: stretch; }
.sb-pop .sb-pop { position: static; min-width: 0; margin: 2px 0 2px 12px; box-shadow: none; }
.sb-tabs { display: flex; flex-direction: column; gap: 8px; min-width: 0; box-sizing: border-box; }
.sb-tabbar { display: flex; flex-wrap: wrap; gap: 4px; }
.sb-tab { padding: 4px 12px; border: 0; background: transparent; color: var(--dim); font: inherit; cursor: pointer; }
.sb-tl-line > .sb-tabbar { gap: 0; border-bottom: 1px solid var(--line); }
.sb-tl-line > .sb-tabbar > .sb-tab { margin-bottom: -1px; border-bottom: 2px solid transparent; }
.sb-tl-line > .sb-tabbar > .sb-on { color: var(--tab, var(--accent)); border-bottom-color: var(--tab, var(--accent)); }
.sb-tl-pill > .sb-tabbar > .sb-tab { border-radius: 99px; }
.sb-tl-pill > .sb-tabbar > .sb-on { background: var(--tab, var(--accent)); color: #fff; }
.sb-tl-card { gap: 0; }
.sb-tl-card > .sb-tabbar { gap: 2px; }
.sb-tl-card > .sb-tabbar > .sb-tab { background: var(--line); border-radius: 8px 8px 0 0; }
.sb-tl-card > .sb-tabbar > .sb-on { background: var(--card); color: var(--tab, var(--accent)); }
.sb-tl-card > .sb-box { background: var(--card); border-radius: 0 8px 8px 8px; padding: 10px; }
.sb-fold { display: flex; flex-direction: column; min-width: 0; box-sizing: border-box; }
.sb-fhead { display: flex; align-items: center; gap: 6px; color: var(--accent); font-weight: 700; cursor: pointer; user-select: none; }
.sb-fhead::before { content: '▾'; font-size: 0.8em; transition: transform 0.15s; }
.sb-closed > .sb-fhead::before { transform: rotate(-90deg); }
.sb-noarrow > .sb-fhead::before { content: none; }
.sb-fbody { margin-top: 8px; }
.sb-fold.sb-closed { gap: 0; }
.sb-ed { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; }
.sb-ed-title { color: var(--accent); font-weight: 700; }
.sb-ed-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.sb-ed-row > .sb-ed-name { flex: 0 0 7em; }
.sb-ed-wide { align-items: flex-start; }
.sb-ed-name { color: var(--dim); font-size: 0.9em; overflow-wrap: anywhere; }
.sb-ed input, .sb-ed select { min-width: 0; padding: 3px 6px; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 6px; font: inherit; box-sizing: border-box; }
.sb-ed input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); }
.sb-ed input[type=range] { flex: 1; min-width: 80px; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
.sb-ed input[type=number] { width: 6em; }
.sb-ed-num, .sb-ed-list, .sb-ed-table { display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.sb-ed-list, .sb-ed-table { flex-direction: column; align-items: stretch; }
.sb-ed-add { display: flex; gap: 6px; }
.sb-ed-add > input, .sb-ed-list .sb-ed-cell > input { flex: 1; }
.sb-ed-note { color: var(--dim); font-size: 0.85em; }
.sb-ed-trow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px; background: var(--card); border-radius: 8px; }
.sb-ed-cell { display: flex; align-items: center; gap: 4px; }
.sb-ed-rname { width: 8em; font-weight: 700; }
.sb-ed-b { padding: 4px 12px; background: var(--line); color: var(--text); border: 0; border-radius: 8px; font: inherit; cursor: pointer; }
.sb-ed-ok { background: var(--accent); color: #fff; }
.sb-ed-x { padding: 0 4px; background: transparent; color: var(--dim); border: 0; font: inherit; cursor: pointer; }
.sb-ed-btns { display: flex; justify-content: flex-end; gap: 8px; }
.sb-ed-msg { color: var(--accent2); font-size: 0.9em; }
.sb-ed-msg:empty { display: none; }
@media (prefers-reduced-motion: reduce) { ${STILL} { animation: none !important; transition: none !important; } }
`;
}

const ALIGN_SELF: Record<Place, string> = { left: 'flex-start', center: 'center', right: 'flex-end', full: 'stretch' };
const GRID_SELF: Record<Place, string> = { left: 'start', center: 'center', right: 'end', full: 'stretch' };

/** Where a button sits in a column or a grid (in a row, its width decides). */
function placeDecls(p: Place | undefined, parent: BarNode | null): string[] {
  if (!p || (parent?.type === 'box' && parent.dir === 'row')) return [];
  if (parent?.dir === 'grid') return [`justify-self: ${GRID_SELF[p]}`];
  return [`align-self: ${ALIGN_SELF[p]}`];
}

/** Width of a child inside a row. */
function widthDecls(w: Width | undefined): string[] {
  if (w === undefined) return [];
  if (w === 'auto') return ['flex: 0 1 auto'];
  return [`flex: 0 1 ${num(w, 1, 100)}%`];
}

/** Turns the status bar into the runtime's view and CSS. `edit`: for the canvas (ids, placeholders, sample rows). */
export function compileBar(bar: Bar, vars: VarNode[], opts: CompileOpts = {}): CompiledBar {
  const idx = indexVars(vars);
  const problems: string[] = [];
  const theme = { ...defaultTheme(), ...bar.theme };
  const css: string[] = [baseCss(theme)];
  const moving = !theme.noAnim;
  const frames = new Set<string>();
  const edit = !!opts.edit;
  const ed = opts.allowEdit ? editableVars(vars) : { list: [], ids: [] };
  let hasEdit = false;
  // class names first, so buttons can point at components that come later
  const cls = new Map<string, string>();
  for (const nd of eachNode([bar.root])) if (!cls.has(nd.id)) cls.set(nd.id, `n${cls.size + 1}`);

  /** A button's action in the runtime's terms, or why it can't work. */
  const action = (node: BarNode): { a?: VAct; problem?: string } => {
    const a = node.action;
    if (!a) return {};
    switch (a.do) {
      case 'edit': {
        if (!opts.allowEdit) return { problem: '要先在「角色卡」页打开「允许玩家修改变量」' };
        if (!ed.list.length) return { problem: '还没有变量设成「玩家可改」（在「变量」页里勾选）' };
        const vs = a.vars?.length ? a.vars.map((id) => ed.ids.indexOf(id)).filter((i) => i >= 0) : undefined;
        if (vs && !vs.length) return { problem: '选的变量都已经不能让玩家改了' };
        return { a: { ed: 1, ...(vs ? { vs } : {}), ...(a.title ? { tt: a.title } : {}) } };
      }
      case 'toggle': {
        const t = a.target ? findNode(bar.root, a.target) : null;
        if (!t) return { problem: a.target ? '要控制的组件已经删掉了' : '还没选要控制哪个组件' };
        if (t.id === bar.root.id) return { problem: '不能藏起整个状态栏，请选里面的组件' };
        if (t.type !== 'fold' && pathTo(bar.root, node.id).some((x) => x.id === t.id)) return { problem: '按钮在它要藏的组件里面，藏起来以后就点不回来了' };
        return { a: { tg: cls.get(t.id)!, ...(t.type === 'fold' ? { f: 1 as const } : {}) } };
      }
      case 'page': {
        const t = a.target ? findNode(bar.root, a.target) : null;
        if (!t || t.type !== 'tabs') return { problem: a.target ? '要切换的标签页已经删掉了' : '还没选要切到哪个标签页' };
        return { a: { pg: cls.get(t.id)!, n: Math.round(num(a.page ?? 0, 0, Math.max(0, (t.children?.length ?? 1) - 1))) } };
      }
      case 'say':
        if (!a.text?.trim()) return { problem: '还没写点了要说的话' };
        return { a: { say: a.text, ...(a.send ? { send: 1 as const } : {}) } };
    }
  };

  type Styled = DeclOpts & {
    /** the element holding this part's own text (for gradient text) */
    text?: string;
    /** more declarations for the main rule */
    more?: string[];
    /** containers: how many children come in one after another (0: none) */
    kids?: number;
  };

  /** Rule for one part, plus what plain declarations can't do: gradient border and text, motion, hover. */
  const styled = (sel: string, s: BarStyle | undefined, o: Styled = {}) => {
    css.push(rule(sel, [...styleDecls(s, o), ...(o.more ?? [])]));
    if (!s) return;
    const ring = !o.solid && gradBorder(s);
    if (ring) {
      const w = num(s.borderW, 0, 20);
      css.push(
        rule(`${sel}::after`, [
          "content: ''",
          'position: absolute',
          `inset: -${w}px`,
          `padding: ${w}px`,
          'border-radius: inherit',
          `background: ${cssFill(s.borderGrad)}`,
          '-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          '-webkit-mask-composite: xor',
          'mask-composite: exclude',
          'pointer-events: none',
        ]),
      );
    }
    const textGrad = o.text ? gradTextDecls(s.textGrad, s.textFx) : [];
    if (textGrad.length) css.push(rule(o.text!, textGrad));
    if (!moving) return;
    // a part that comes in starts its loop once the entrance is over (the runtime drops .sb-intro then)
    if (s.anim && LOOP_SEC[s.anim]) {
      frames.add(s.anim);
      const loop = `sb-${s.anim} ${num(s.animSec ?? LOOP_SEC[s.anim], 0.3, 60)}s ${LOOP_EASE[s.anim]} infinite`;
      if (s.anim === 'flow') {
        // moves the gradients: background, text, border
        const on: string[] = [];
        if (s.bg?.b && cssFill(s.bg)) on.push(sel);
        if (textGrad.length) on.push(o.text!);
        if (ring) on.push(`${sel}::after`);
        for (const x of on) css.push(rule(x, ['background-size: 200% 200%', `animation: ${loop}`]));
      } else css.push(rule(sel, [`animation: ${loop}`]));
    }
    if (o.kids) {
      const name = `in-${s.enter ?? 'up'}`;
      frames.add(name);
      for (let k = 1; k <= Math.min(o.kids, 20); k++) {
        css.push(rule(`.sb-intro ${sel} > :nth-child(${k})`, [`animation: sb-${name} ${ENTER_SEC}s ease ${Math.round((k - 1) * 8) / 100}s both`]));
      }
    } else if (s.enter) {
      frames.add(`in-${s.enter}`);
      css.push(rule(`.sb-intro ${sel}`, [`animation: sb-in-${s.enter} ${ENTER_SEC}s ease both`]));
    }
    if (s.hover && HOVER[s.hover]) {
      css.push(rule(sel, ['transition: transform 0.2s, box-shadow 0.2s, filter 0.2s']));
      css.push(rule(`${sel}:hover`, HOVER[s.hover]));
    }
  };

  /** The number of a value or a bar in a gradient. */
  const numGrad = (sels: string, node: BarNode) => {
    const d = gradTextDecls(node.valGrad, node.style?.textFx);
    if (d.length) css.push(rule(sels, d));
  };

  const go = (node: BarNode, scope: string[], parent: BarNode | null): VNode | null => {
    const out = build(node, scope, parent);
    if (out && node.hidden && parent) out.h = 1;
    return out;
  };

  const build = (node: BarNode, scope: string[], parent: BarNode | null): VNode | null => {
    const c = cls.get(node.id)!;
    const sel = `.${c}`;
    const base = { c, ...(edit ? { i: node.id } : {}) };
    const s = node.style;
    const inRow = parent?.type === 'box' && parent.dir === 'row';
    const sized = inRow ? widthDecls(s?.width) : [];
    const gapDecls = node.gap != null ? [`gap: ${num(node.gap, 0, 60)}px`] : [];
    const gridDecls = node.dir === 'grid' ? [`grid-template-columns: repeat(${num(node.cols ?? 2, 1, 6)}, minmax(0, 1fr))`] : [];
    const dirClass = node.dir === 'row' ? ' sb-row' : node.dir === 'grid' ? ' sb-grid' : '';
    const kidsOf = (sc: string[]) => (node.children ?? []).map((k) => go(k, sc, node)).filter((k): k is VNode => !!k);
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
      case 'box':
        styled(sel, s, { flex: node.dir === 'row', more: [...gapDecls, ...gridDecls, ...sized], kids: node.stagger ? node.children?.length : 0 });
        return { t: 'box', ...base, c: c + dirClass, k: kidsOf(scope) };
      case 'button': {
        const r = action(node);
        if (r.problem) {
          problems.push(`${describe(node, idx)}：${r.problem}`);
          if (!edit) return null;
        }
        if (r.a && 'ed' in r.a) hasEdit = true;
        // doubled class: wins over the menu-entry look of .sb-pop .sb-btn
        styled(`.sb-btn${sel}`, s, { flex: true, more: [...placeDecls(node.place, parent), ...sized], text: `.sb-btn${sel} > .sb-tx` });
        const out: VNode = { t: 'btn', ...base, x: node.text ?? '' };
        if (node.icon) out.ic = node.icon;
        if (r.a) out.a = r.a;
        return out;
      }
      case 'menu': {
        const wrap = node.place && !inRow ? [`align-items: ${ALIGN_SELF[node.place]}`] : [];
        css.push(rule(sel, [...wrap, ...sized]));
        styled(`${sel} > .sb-mbtn`, s, { flex: true, text: `${sel} > .sb-mbtn > .sb-tx` });
        styled(`${sel} > .sb-pop`, node.popStyle, { positioned: true, more: node.place === 'right' ? ['left: auto', 'right: 0'] : [] });
        if (gradBorder(node.popStyle)) css.push(rule(`.sb-pop ${sel} > .sb-pop`, ['position: relative']));
        const out: VNode = { t: 'menu', ...base, x: node.text ?? '', k: kidsOf(scope) };
        if (node.icon) out.ic = node.icon;
        if (node.arrow !== false) out.ar = 1;
        return out;
      }
      case 'tabs': {
        const tc = cssColor(node.tabColor);
        styled(sel, s, { more: [...sized, ...(tc ? [`--tab: ${tc}`] : [])] });
        const pages = node.children ?? [];
        const kids = pages.map((p) => go(p, scope, node) ?? { t: 'box' as const, c: '', k: [] });
        const st = Math.round(num(node.start ?? 0, 0, Math.max(0, pages.length - 1)));
        return { t: 'tabs', ...base, c: c + ' sb-tl-' + (node.tabLook ?? 'line'), tl: pages.map((p, i) => p.title || `第${i + 1}页`), st, k: kids };
      }
      case 'fold': {
        styled(sel, s, { more: sized });
        styled(`${sel} > .sb-fhead`, node.headStyle, { flex: true, text: `${sel} > .sb-fhead > .sb-tx` });
        css.push(rule(`${sel} > .sb-fbody`, [...gapDecls, ...gridDecls]));
        const out: VNode = { t: 'fold', ...base, c: c + (node.arrow === false ? ' sb-noarrow' : ''), x: node.text ?? '', bc: dirClass, k: kidsOf(scope) };
        if (node.icon) out.ic = node.icon;
        if (node.closed) out.cl = 1;
        return out;
      }
      case 'repeat': {
        const r = resolve(node.bind, scope, idx);
        const info = node.bind ? idx.get(node.bind.var) : undefined;
        const kind = info?.v.kind === 'list' ? 'list' : 'table';
        const okKind = !info || info.v.kind === 'table' || info.v.kind === 'list';
        if (!okKind) r.problem = `「${info!.v.name}」不是表格或列表`;
        if (broken(r) && !edit) return null;
        styled(sel, s, { more: [...gapDecls, ...gridDecls, ...sized], kids: node.stagger ? 12 : 0 });
        styled(`${sel} > .sb-item`, node.itemStyle, { flex: node.inner === 'row' });
        const inner = r.problem ? scope : [...scope, node.bind!.var];
        const out: VNode = {
          t: 'rep',
          ...base,
          c: c + dirClass + (node.inner === 'row' ? ' sb-items-row' : ''),
          s: r.src ?? null,
          l: kind,
          e: node.emptyText ?? '暂无',
          k: kidsOf(inner),
        };
        if (node.hideEmpty) out.he = 1;
        if (edit) out.g = sampleItem(info?.v);
        return out;
      }
      case 'text':
        styled(sel, s, { more: sized, text: `${sel} > .sb-tx` });
        return { t: 'text', ...base, x: node.text ?? '' };
      case 'divider': {
        const lc = cssColor(node.lineColor);
        const lw = node.lineW != null ? num(node.lineW, 1, 10) : null;
        styled(sel, s, { solid: true, more: sized });
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
        styled(sel, s, { flex: true, more: sized });
        const vd: string[] = [];
        const vc = cssColor(node.valColor);
        if (vc) vd.push(`color: ${vc}`);
        if (node.valSize != null) vd.push(`font-size: ${num(node.valSize, 8, 72)}px`);
        if (node.valBold !== undefined) vd.push(`font-weight: ${node.valBold ? 700 : 400}`);
        css.push(rule(`${sel} .sb-v, ${sel} .sb-chip`, vd));
        numGrad(`${sel} .sb-v:not(.sb-pill)`, node);
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
        const part = node.bind?.part;
        if (part === 'name' || part === 'item') Object.assign(out, byValue(node, false));
        else if (v && CASE_KINDS.has(v.kind)) Object.assign(out, byValue(node, v.kind === 'number'));
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
        styled(sel, s, { flex: true, more: sized });
        const look = node.barLook ?? 'line';
        const tc = cssColor(node.track);
        const fa = cssColor(node.fill?.a);
        const fb = cssColor(node.fill?.b);
        const colors: string[] = [];
        if (fa || fb) colors.push(`--fa: ${fa ?? fb}`, `--fb: ${fb ?? fa}`);
        if (tc) colors.push(`--tk: ${tc}`);
        css.push(rule(sel, colors));
        const h = node.height;
        if (look === 'line') {
          if (h != null) css.push(rule(`${sel} .sb-track`, [`height: ${num(h, 2, 40)}px`]));
          const fill = cssFill(node.fill);
          if (fill) css.push(rule(`${sel} .sb-fill`, [`background: ${fill}`]));
        } else if (h != null) {
          if (look === 'seg') css.push(rule(`${sel} .sb-seg`, [`height: ${num(h, 2, 40)}px`]));
          if (look === 'ring') css.push(rule(`${sel} .sb-ringw`, [`width: ${num(h, 20, 160)}px`, `height: ${num(h, 20, 160)}px`]));
          if (look === 'icons') css.push(rule(`${sel} .sb-sym`, [`font-size: ${num(h, 10, 60)}px`]));
        }
        const vd: string[] = [];
        const vc = cssColor(node.valColor);
        if (vc) vd.push(`color: ${vc}`);
        if (node.valSize != null) vd.push(`font-size: ${num(node.valSize, 8, 72)}px`);
        if (node.valBold !== undefined) vd.push(`font-weight: ${node.valBold ? 700 : 400}`);
        css.push(rule(`${sel} .sb-v, ${sel} .sb-in`, vd));
        numGrad(`${sel} .sb-v, ${sel} .sb-in`, node);
        if (node.grow && moving) {
          const into = (x: string, f: string, sec: number) => {
            frames.add(f);
            css.push(rule(`.sb-intro ${sel} ${x}`, [`animation: sb-${f} ${sec}s ease-out both`]));
          };
          if (look === 'line') into('.sb-fill', 'grow', 1);
          if (look === 'icons') into('.sb-symf', 'grow', 1);
          if (look === 'seg') into('.sb-seg.sb-on', 'in-fade', 0.8);
          if (look === 'ring') into('.sb-ring', 'ring-in', 0.9);
        }
        labelCss();
        const out: VNode = { t: 'bar', ...base, c: c + (node.stack ? ' sb-stack' : ''), s: r.src ?? null, mn: num(mn, -1e9, 1e9), mx: num(mx, -1e9, 1e9), nm: node.num ?? 'after', em: '—' };
        const label = lb();
        if (label) out.lb = label;
        if (node.icon) out.ic = node.icon;
        if (node.stack) out.stk = 1;
        if (node.showMax) out.ms = 1;
        if (node.showStage && info?.stage && !info.table) out.st = { p: info.stage };
        if (r.problem) out.bad = r.problem;
        if (look === 'seg') Object.assign(out, { lk: 'seg', sc: Math.round(num(node.count ?? 10, 2, 30)) });
        if (look === 'ring') out.lk = 'ring';
        if (look === 'icons') {
          Object.assign(out, { lk: 'sym', sc: Math.round(num(node.count ?? 5, 1, 20)), sy: Array.from(node.sym || '★').slice(0, 4).join('') });
          if (out.nm === 'inside') out.nm = 'after';
          if (node.whole) out.wh = 1;
        }
        Object.assign(out, byValue(node, true));
        return out;
      }
      case 'image': {
        const out: VNode = { t: 'img', ...base };
        const bad: string[] = [];
        const pic = (u: string | undefined, what: string) => {
          if (!u?.trim()) return undefined;
          if (imageUrlOk(u)) return u.trim();
          bad.push(`${what}的链接要以 https:// 或 http:// 开头`);
          return undefined;
        };
        out.u = pic(node.src, node.bind ? '对不上时的图片' : '图片');
        if (node.bind) {
          const r = resolve(node.bind, scope, idx);
          const v = idx.get(node.bind.var)?.v;
          if (v && !node.bind.part && !IMAGE_KINDS.has(v.kind)) r.problem = `「${v.name}」不能用来换图片（只能用文字、选项、是否）`;
          if (r.problem) {
            problems.push(`${describe(node, idx)}：${r.problem}`);
            if (!edit) return null;
            out.bad = r.problem;
          }
          out.s = r.src ?? null;
          const map = node.imgMap ?? (v && !node.bind.part && v.kind !== 'text' ? {} : undefined);
          if (map) {
            out.m = {};
            for (const [k, u] of Object.entries(map)) {
              const ok = pic(u, `「${k}」`);
              if (ok) out.m[k] = ok;
            }
          }
        } else if (!out.u && !bad.length) {
          problems.push(`${describe(node, idx)}：还没放图片`);
          if (!edit) return null;
        }
        if (bad.length) problems.push(`${describe(node, idx)}：${bad.join('；')}`);
        if (!out.u) delete out.u;
        const d = [...placeDecls(node.place, parent), ...sized];
        const w = node.circle ? node.imgW ?? 64 : node.imgW;
        if (w != null) d.push(`width: ${num(w, 16, 1200)}px`, 'flex: none');
        else if (inRow) {
          if (!s?.width) d.push('flex: 1 1 0', 'min-width: 0');
        } else d.push('width: 100%');
        if (node.circle) d.push(`height: ${num(w, 16, 1200)}px`, 'border-radius: 50%');
        else if (node.imgH != null) d.push(`height: ${num(node.imgH, 16, 1200)}px`);
        if (node.fit === 'contain') d.push('object-fit: contain');
        styled(sel, s, { solid: true, more: d });
        return out;
      }
    }
  };

  const view = go(bar.root, [], null) ?? { t: 'box', c: 'n0', k: [] };
  for (const f of frames) css.push(`@keyframes sb-${f} { ${KEYFRAMES[f]} }\n`);
  return { view, css: css.join('').trim(), problems, ed: hasEdit ? ed.list : [], hasEdit, ...(opts.key ? { key: opts.key } : {}) };
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
