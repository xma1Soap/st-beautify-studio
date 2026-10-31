// Ready-made status bars: layouts built from the variables, and skins that restyle whatever is laid out
// (colors, font and the look of every kind of component) without moving anything.
import { defaultBar, nodesForVar, THEME_PRESETS, type BarNode, type BarStyle, type BarTheme } from './bar';
import { newId } from '../lib/id';
import type { VarNode } from './types';

/* ---------- layouts ---------- */

export interface Layout {
  key: string;
  name: string;
  hint: string;
  make: (vars: VarNode[]) => BarNode;
}

const ROOT_STYLE: BarStyle = { bg: { a: '@bg' }, borderW: 1, borderColor: '@line', radius: 12, pad: 12 };
const isGroup = (v: VarNode) => v.kind === 'group' || v.kind === 'table';
const root = (children: BarNode[], gap = 10): BarNode => ({ id: newId(), type: 'box', dir: 'col', gap, style: { ...ROOT_STYLE }, children });

/** The components of a group without its own card and title (they go into a page or a fold instead). */
function inside(v: VarNode): BarNode[] {
  const card = nodesForVar(v);
  return (card.children ?? []).slice(1);
}

/** Loose top-level variables in one column. */
const loose = (vars: VarNode[]) => vars.filter((v) => !isGroup(v)).map((v) => nodesForVar(v));

export const LAYOUTS: Layout[] = [
  {
    key: 'tabs',
    name: '分页',
    hint: '每个分组一页，上面一排标签切换',
    make: (vars) => {
      const pages: BarNode[] = [];
      const rest = loose(vars);
      if (rest.length) pages.push({ id: newId(), type: 'box', title: '概况', dir: 'col', gap: 8, children: rest });
      for (const v of vars.filter(isGroup)) pages.push({ id: newId(), type: 'box', title: v.name, dir: 'col', gap: 8, children: inside(v) });
      if (pages.length < 2) return defaultLayout(vars);
      return root([{ id: newId(), type: 'tabs', tabLook: 'pill', children: pages }]);
    },
  },
  {
    key: 'folds',
    name: '折叠',
    hint: '每个分组一个能收起来的块，只展开第一个',
    make: (vars) =>
      root([
        ...loose(vars),
        ...vars.filter(isGroup).map(
          (v, i): BarNode => ({
            id: newId(),
            type: 'fold',
            text: v.name,
            closed: i > 0 || undefined,
            dir: 'col',
            gap: 6,
            style: { bg: { a: '@card' }, radius: 10, pad: 10 },
            children: inside(v),
          }),
        ),
      ]),
  },
  {
    key: 'compact',
    name: '紧凑',
    hint: '两列排开，省地方',
    make: (vars) => {
      const two = (kids: BarNode[]): BarNode => ({ id: newId(), type: 'box', dir: 'grid', cols: 2, gap: 6, children: kids });
      const rest = loose(vars);
      return root(
        [
          ...(rest.length ? [two(rest)] : []),
          ...vars.filter(isGroup).map((v) => {
            const card = nodesForVar(v);
            const [title, ...kids] = card.children ?? [];
            return { ...card, gap: 4, style: { ...card.style, pad: 8 }, children: v.kind === 'table' ? card.children : [title, two(kids)] };
          }),
        ],
        8,
      );
    },
  },
  {
    key: 'portrait',
    name: '头像加信息',
    hint: '左边一张圆头像（自己换图），右边是变量',
    make: (vars) => {
      const top = loose(vars);
      return root([
        {
          id: newId(),
          type: 'box',
          dir: 'row',
          gap: 12,
          children: [
            { id: newId(), type: 'image', circle: true, imgW: 72, style: { width: 'auto', borderW: 2, borderColor: '@accent' } },
            { id: newId(), type: 'box', dir: 'col', gap: 4, children: top.length ? top : [{ id: newId(), type: 'text', text: '角色名', style: { color: '@accent', bold: true, size: 18 } }] },
          ],
        },
        ...vars.filter(isGroup).map((v) => nodesForVar(v)),
      ]);
    },
  },
  {
    key: 'folded',
    name: '收成一行',
    hint: '平时只有一行「状态」，点开才看到全部',
    make: (vars) => ({
      id: newId(),
      type: 'box',
      dir: 'col',
      gap: 8,
      style: { ...ROOT_STYLE, pad: 10 },
      children: [{ id: newId(), type: 'fold', text: '状态', icon: '📋', closed: true, dir: 'col', gap: 10, children: vars.map((v) => nodesForVar(v)) }],
    }),
  },
];

function defaultLayout(vars: VarNode[]): BarNode {
  const auto = defaultBar(vars).root;
  // fresh ids: a laid-out bar must not share the automatic one's
  const fresh = (n: BarNode): BarNode => ({ ...n, id: newId(), children: n.children?.map(fresh) });
  return fresh(auto);
}

/* ---------- skins ---------- */

type NodePatch = Partial<BarNode>;

export interface Skin {
  name: string;
  hint: string;
  theme: Partial<BarTheme>;
  /** the outermost box */
  root?: BarStyle;
  /** boxes with a background or border right inside the root, folds, tabs */
  card?: BarStyle;
  /** framed boxes further in */
  inner?: BarStyle;
  /** words that stand out (bold or colored text) */
  title?: BarStyle;
  button?: BarStyle;
  /** each row of a 每项一张 */
  item?: BarStyle;
  foldHead?: BarStyle;
  tabLook?: BarNode['tabLook'];
  /** progress bars that span a range */
  bar?: NodePatch;
  value?: NodePatch;
  divider?: NodePatch;
}

const preset = (name: string) => ({ preset: name, ...THEME_PRESETS.find((p) => p.name === name)!.colors });

export const SKINS: Skin[] = [
  {
    name: '简洁',
    hint: '没有框，细线分开，配色不变',
    theme: {},
    root: { pad: 4 },
    card: { borderW: 1, borderColor: '@line', borderSide: 'bottom', pad: 6 },
    inner: { pad: 4 },
    title: { color: '@dim', bold: true, size: 12, ls: 1 },
    item: { pad: 2 },
    bar: { height: 4 },
    value: {},
    divider: { line: 'solid' },
    tabLook: 'line',
  },
  {
    name: '古风',
    hint: '羊皮纸配色、楷体、双线边框',
    theme: { ...preset('羊皮纸'), font: 'kai' },
    root: { bg: { a: '@bg', b: '@card', angle: 180 }, borderW: 3, borderStyle: 'double', borderColor: '@accent', radius: 4, pad: 14, enter: 'fade' },
    card: { borderW: 3, borderColor: '@accent', borderSide: 'left', pad: 8, bg: { a: '#ffffff33' } },
    inner: { borderW: 1, borderColor: '@line', borderSide: 'left', pad: 6 },
    title: { color: '@accent', bold: true, ls: 2 },
    item: { bg: { a: '#ffffff40' }, radius: 2, pad: 4 },
    button: { bg: { a: '@accent' }, color: '@bg', radius: 2 },
    foldHead: { color: '@accent', ls: 2 },
    tabLook: 'line',
    bar: { barLook: 'seg', count: 10, height: 6 },
    divider: { line: 'fade' },
  },
  {
    name: '赛博',
    hint: '深色霓虹、渐变发光边框、等宽字',
    theme: { ...preset('赛博'), font: 'mono' },
    root: { bg: { a: '@bg' }, borderW: 1, borderGrad: { a: '@accent', b: '@accent2', angle: 90 }, radius: 4, pad: 12, shadow: 'glow', enter: 'zoom' },
    card: { bg: { a: '@card' }, borderW: 1, borderColor: '@line', radius: 2, pad: 10 },
    inner: { borderW: 1, borderColor: '@line', borderSide: 'left', pad: 6 },
    title: { textGrad: { a: '@accent', b: '@accent2', angle: 90 }, color: '@accent', bold: true, ls: 1, textFx: 'glow' },
    item: { bg: { a: '#00e5ff0d' }, borderW: 1, borderColor: '@line', radius: 2, pad: 4 },
    button: { bg: { a: 'transparent' }, color: '@accent', borderW: 1, borderColor: '@accent', radius: 2 },
    foldHead: { color: '@accent', ls: 1 },
    tabLook: 'line',
    bar: { height: 6, grow: true },
    value: { valColor: '@accent' },
    divider: { line: 'dashed' },
  },
  {
    name: '可爱',
    hint: '樱花粉、圆体、大圆角、爱心进度',
    theme: { ...preset('樱花'), font: 'round' },
    root: { bg: { a: '@bg', b: '@card', angle: 135 }, borderW: 2, borderColor: '@line', radius: 20, pad: 14, enter: 'up' },
    card: { bg: { a: '#ffffffaa' }, radius: 16, pad: 10, shadow: 'soft' },
    inner: { bg: { a: '@card' }, radius: 12, pad: 8 },
    title: { color: '@accent', bold: true },
    item: { bg: { a: '@bg' }, radius: 12, pad: 6 },
    button: { bg: { a: '@accent', b: '@accent2', angle: 90 }, radius: 99, hover: 'grow' },
    foldHead: { color: '@accent' },
    tabLook: 'pill',
    bar: { barLook: 'icons', sym: '❤️', count: 5 },
    value: { pill: true },
    divider: { line: 'dotted' },
  },
  {
    name: '暗金',
    hint: '黑底金字、渐变金边、宋体',
    theme: { preset: '', bg: '#14110c', card: '#1f1a12', line: '#3a3020', text: '#f1e6cc', dim: '#a8987a', accent: '#d4a64a', accent2: '#f5dd9a', font: 'serif' },
    root: { bg: { a: '@bg', b: '@card', angle: 160 }, borderW: 1, borderGrad: { a: '@accent', b: '@accent2', angle: 135 }, radius: 6, pad: 14, shadow: 'float', enter: 'fade' },
    card: { bg: { a: '@card' }, borderW: 1, borderColor: '@line', radius: 4, pad: 10 },
    inner: { borderW: 1, borderColor: '@line', borderSide: 'left', pad: 6 },
    title: { textGrad: { a: '@accent2', b: '@accent', angle: 180 }, color: '@accent', bold: true, ls: 1 },
    item: { bg: { a: '#ffffff08' }, radius: 4, pad: 4 },
    button: { bg: { a: '@accent', b: '@accent2', angle: 135 }, color: '@bg', radius: 4 },
    foldHead: { color: '@accent' },
    tabLook: 'line',
    bar: { height: 6, fill: { a: '@accent', b: '@accent2' }, grow: true },
    value: { valColor: '@accent2' },
    divider: { line: 'fade' },
  },
  {
    name: '玻璃',
    hint: '深海蓝、半透明卡片、圆环进度',
    theme: { ...preset('深海'), font: 'sans' },
    root: { bg: { a: '@bg', b: '@card', angle: 160 }, radius: 16, pad: 14, shadow: 'float', enter: 'up' },
    card: { bg: { a: '#ffffff12' }, borderW: 1, borderColor: '#ffffff26', radius: 12, pad: 10 },
    inner: { bg: { a: '#ffffff0a' }, radius: 8, pad: 6 },
    title: { color: '@accent2', bold: true },
    item: { bg: { a: '#ffffff0d' }, radius: 8, pad: 6 },
    button: { bg: { a: '#ffffff1f' }, color: '@text', borderW: 1, borderColor: '#ffffff33', radius: 10, hover: 'lift' },
    foldHead: { color: '@accent2' },
    tabLook: 'pill',
    bar: { barLook: 'ring', grow: true },
    divider: { line: 'fade' },
  },
];

/** Bar fields a skin decides (anything it leaves out goes back to the default). */
const BAR_KEYS = ['barLook', 'height', 'count', 'sym', 'whole', 'fill', 'track', 'grow'] as const;
const VALUE_KEYS = ['pill', 'valColor', 'valGrad'] as const;
const DIVIDER_KEYS = ['line', 'lineColor', 'lineW'] as const;

const framed = (s: BarStyle | undefined) => !!(s?.bg || s?.borderW || s?.shadow);
const standsOut = (s: BarStyle | undefined) => !!(s?.bold || s?.color || s?.textGrad);
/** Keep where it sits (width in a row); the rest is the skin's. */
const restyle = (old: BarStyle | undefined, next: BarStyle | undefined): BarStyle | undefined => {
  const out: BarStyle = { ...(old?.width !== undefined ? { width: old.width } : {}), ...next };
  return Object.keys(out).length ? out : undefined;
};
const pick = <K extends keyof BarNode>(keys: readonly K[], patch: NodePatch | undefined): Partial<BarNode> =>
  Object.fromEntries(keys.map((k) => [k, patch?.[k]])) as Partial<BarNode>;

/** The same bar in another skin: theme, and the look of every component it knows. */
export function applySkin(rootNode: BarNode, theme: BarTheme, skin: Skin): { root: BarNode; theme: BarTheme } {
  const go = (n: BarNode, depth: number, parent: BarNode | null): BarNode => {
    const out: BarNode = { ...n };
    if (depth === 0) out.style = restyle(n.style, skin.root);
    else
      switch (n.type) {
        case 'box':
          // pages of a tabs and plain rows stay see-through
          if (parent?.type !== 'tabs' && framed(n.style)) out.style = restyle(n.style, depth === 1 ? skin.card : skin.inner);
          break;
        case 'fold':
          out.style = restyle(n.style, depth === 1 ? skin.card : skin.inner);
          out.headStyle = skin.foldHead && { ...skin.foldHead };
          break;
        case 'tabs':
          out.style = restyle(n.style, depth === 1 ? skin.card : undefined);
          if (skin.tabLook) out.tabLook = skin.tabLook;
          break;
        case 'repeat':
          out.itemStyle = skin.item && { ...skin.item };
          break;
        case 'text':
          if (standsOut(n.style)) out.style = restyle(n.style, { ...skin.title, ...(n.style?.size ? { size: n.style.size } : {}) });
          break;
        case 'button':
        case 'menu':
          out.style = restyle(n.style, skin.button);
          break;
        case 'bar':
          Object.assign(out, pick(BAR_KEYS, skin.bar));
          break;
        case 'value':
          Object.assign(out, pick(VALUE_KEYS, skin.value));
          break;
        case 'divider':
          Object.assign(out, pick(DIVIDER_KEYS, skin.divider));
          break;
      }
    if (n.children) out.children = n.children.map((c) => go(c, depth + 1, n));
    // drop keys set to undefined so the saved project stays clean
    for (const k of Object.keys(out) as (keyof BarNode)[]) if (out[k] === undefined) delete out[k];
    return out;
  };
  return { root: go(rootNode, 0, null), theme: { ...theme, ...skin.theme, preset: skin.theme.preset ?? theme.preset } };
}

/* ---------- format painter ---------- */

/** The look of one component, to paste onto others. */
export interface Look {
  type: BarNode['type'];
  style?: BarStyle;
  /** the type's own look fields (bar colors, value colors…) */
  extra: Partial<BarNode>;
}

const LOOK_KEYS: Partial<Record<BarNode['type'], readonly (keyof BarNode)[]>> = {
  box: ['stagger'],
  repeat: ['itemStyle', 'inner', 'stagger'],
  bar: ['fill', 'track', 'height', 'barLook', 'count', 'sym', 'whole', 'grow', 'valColor', 'valGrad', 'valSize', 'valBold', 'labelColor', 'num', 'colon', 'stack', 'showMax'],
  value: ['valColor', 'valGrad', 'valSize', 'valBold', 'pill', 'labelColor', 'stack', 'colon'],
  divider: ['line', 'lineColor', 'lineW'],
  tabs: ['tabLook', 'tabColor'],
  fold: ['headStyle', 'arrow'],
  menu: ['popStyle', 'arrow'],
  image: ['imgW', 'imgH', 'fit', 'circle'],
};

export function copyLook(n: BarNode): Look {
  const { width: _w, ...style } = n.style ?? {};
  const extra = Object.fromEntries((LOOK_KEYS[n.type] ?? []).map((k) => [k, structuredClone(n[k])])) as Partial<BarNode>;
  return { type: n.type, style: Object.keys(style).length ? style : undefined, extra };
}

/** `n` with the copied look; between different kinds only the common part (colors, border, text…) goes over. */
export function pasteLook(n: BarNode, look: Look): BarNode {
  const out: BarNode = { ...n, style: restyle(n.style, look.style && structuredClone(look.style)) };
  if (look.type === n.type) Object.assign(out, structuredClone(look.extra));
  for (const k of Object.keys(out) as (keyof BarNode)[]) if (out[k] === undefined) delete out[k];
  return out;
}
