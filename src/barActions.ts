// What the status bar page can do: add components from the palette or the variable list, move, copy, delete.
// Shared by the canvas, the settings panel and the keyboard shortcuts.
import { canvasLayout, rectInside } from './canvasLayout';
import { useCard } from './cardStore';
import { useStore } from './store';
import { barOf, cloneNode, editButton, findNode, isContainer, newNode, nodeFromVar, pathTo, placementProblem, scopeAt, type BarNode, type BarType, type FreeAt } from './mvu/bar';
import { cleanAt, dropAt as freeDropAt, FREE_W, fitHeight, isFree, partsBottom, toFree, underAll } from './mvu/free';
import { findVar, insertAt, locate, moveTo, moveVar, removeVar, updateVar } from './mvu/tree';
import type { VarNode } from './mvu/types';
import { applySkin, copyLook, LAYOUTS, pasteLook, SKINS } from './mvu/barTemplates';
import { eachNode } from './mvu/tree';

const notify = (m: string) => useStore.getState().notify(m);

export interface PaletteItem {
  key: string;
  label: string;
  hint: string;
  group: 'layout' | 'content' | 'act';
  make: (vars: VarNode[], scope: string[]) => BarNode;
}

const plain = (type: BarType) => (vars: VarNode[], scope: string[]) => newNode(type, vars, scope);

export const PALETTE: PaletteItem[] = [
  { key: 'box', group: 'layout', label: '卡片', hint: '一块带底色的区域，把几样东西放在一起', make: plain('box') },
  { key: 'row', group: 'layout', label: '横排', hint: '里面的东西从左到右排成一行', make: (v, s) => ({ ...newNode('box', v, s), dir: 'row', style: undefined }) },
  { key: 'grid', group: 'layout', label: '网格', hint: '里面的东西排成两列（列数可改）', make: (v, s) => ({ ...newNode('box', v, s), dir: 'grid', cols: 2, style: undefined }) },
  { key: 'repeat', group: 'layout', label: '每项一张', hint: '表格的每一行、列表的每一项各画一张，比如物品栏', make: plain('repeat') },
  { key: 'tabs', group: 'layout', label: '标签页', hint: '分成几页，点上面的标签切换，比如「状态 / 物品 / 关系」', make: plain('tabs') },
  { key: 'fold', group: 'layout', label: '折叠块', hint: '点标题展开或收起里面的东西，平时不占地方', make: plain('fold') },
  { key: 'text', group: 'content', label: '文字', hint: '标题、说明这类固定的字', make: plain('text') },
  { key: 'value', group: 'content', label: '变量值', hint: '显示一个变量，比如「地点 酒馆」', make: plain('value') },
  { key: 'bar', group: 'content', label: '进度条', hint: '按数字长短画一条，比如好感度', make: plain('bar') },
  { key: 'divider', group: 'content', label: '分隔线', hint: '一条线，中间可以加字或符号', make: plain('divider') },
  { key: 'image', group: 'content', label: '图片', hint: '放一张图，可以用链接或从电脑选；也能跟着变量换图，比如不同表情', make: plain('image') },
  { key: 'button', group: 'act', label: '按钮', hint: '点了能打开修改面板、显示或藏起别的组件、切换标签页、往输入框里填字', make: plain('button') },
  { key: 'menu', group: 'act', label: '菜单', hint: '点开是一列按钮，里面还能再放子菜单', make: plain('menu') },
  { key: 'edit', group: 'act', label: '修改按钮', hint: '玩家点了能直接改变量（要先在「角色卡」页允许玩家修改变量）', make: () => editButton() },
];

export const PALETTE_GROUPS: [PaletteItem['group'], string][] = [
  ['layout', '排版'],
  ['content', '内容'],
  ['act', '互动'],
];

/** What is being dragged onto the canvas from outside it (HTML drag and drop can't carry objects). */
export type DragItem = { kind: 'new'; key: string } | { kind: 'var'; id: string };
export const drag: { item: DragItem | null } = { item: null };

const st = () => useCard.getState();
const bar = () => barOf(st().project);

/** Where a new component goes: inside the selected box, or right after the selected component, or at the end. */
export function insertPlace(): { parentId: string; index: number } {
  const { root } = bar();
  let sel = findNode(root, st().barSel);
  // a selected 标签页 shows its first page: things go in there
  if (sel?.type === 'tabs' && sel.children?.length) sel = sel.children[Math.min(sel.start ?? 0, sel.children.length - 1)];
  if (sel && isContainer(sel)) return { parentId: sel.id, index: sel.children?.length ?? 0 };
  const at = sel ? locate([root], sel.id) : null;
  if (at?.parent) return { parentId: at.parent.id, index: at.index + 1 };
  return { parentId: root.id, index: root.children?.length ?? 0 };
}

/** The component a drag item becomes at that place, or why it can't go there. */
export function nodeFor(item: DragItem, parentId: string): { node?: BarNode; problem?: string } {
  const { vars } = st().project;
  const { root } = bar();
  if (item.kind === 'new') {
    const p = PALETTE.find((x) => x.key === item.key);
    return p ? { node: p.make(vars, scopeAt(root, parentId)) } : {};
  }
  const v = findVar(vars, item.id);
  if (!v) return {};
  const node = nodeFromVar(v, vars);
  const problem = placementProblem(root, vars, node, parentId);
  return problem ? { problem } : { node };
}

/** A point in a free box (its own px), and the size the part had before (moving it in from elsewhere). */
export interface FreePoint {
  x: number;
  y: number;
  size?: { w: number; h: number };
}

/** How far down the parts of a free box reach (its own px), from the canvas when it is drawn there. */
function freeBottom(box: BarNode): number {
  const rects = canvasLayout.rects;
  const stage = rects.find((r) => r.id === box.id && r.stage);
  if (!stage) return partsBottom(box);
  const all = { x: stage.x - 4000, y: stage.y - 4000, w: 8000, h: 8000 };
  return partsBottom(box, stage, (box.children ?? []).map((k) => rectInside(rects, k.id, all)));
}

/**
 * Where a part goes in the free box `parentId`: where it was dropped (`p`), or else under what is there, the box
 * growing to fit (`freeH`). Nothing when the box isn't free, or the part is only changing places among its siblings.
 */
function freeAt(node: BarNode, parentId: string, p: FreePoint | undefined): { at: FreeAt; freeH?: number } | undefined {
  const { root } = bar();
  const box = findNode(root, parentId);
  if (!box || !isFree(box)) return undefined;
  if (p) return { at: freeDropAt(node, p.x, p.y, box, p.size) };
  if (locate([root], node.id)?.parent?.id === parentId) return undefined;
  const u = underAll([node], box, freeBottom(box));
  return { at: u.nodes[0].at!, freeH: u.freeH };
}

/** The free box grown to fit what was put in it (one step with the putting in). */
const grow = (root: BarNode, parentId: string, freeH?: number) => (freeH ? updateVar([root], parentId, { freeH })[0] : root);

/** Put a new component in; returns false (and says why) when it can't go there. `at`: dropped in a free box. */
export function addAt(item: DragItem, parentId: string, index: number, at?: FreePoint): boolean {
  const { node: made, problem } = nodeFor(item, parentId);
  if (problem) notify(problem);
  if (!made) return false;
  const pos = freeAt(made, parentId, at);
  const node = pos ? { ...made, at: pos.at } : made;
  st().editBar((b) => ({ ...b, root: grow(insertAt([b.root], parentId, index, node)[0], parentId, pos?.freeH) }));
  st().selectBar(node.id);
  return true;
}

export const addFromPalette = (key: string) => {
  let { parentId, index } = insertPlace();
  if (key === 'repeat') {
    // a 每项一张 inside another one is rarely what's wanted: put it after the outermost one instead (dragging can still nest)
    const { root } = bar();
    const outer = pathTo(root, parentId).find((n) => n.type === 'repeat');
    const at = outer ? locate([root], outer.id) : null;
    if (at?.parent) ({ parentId, index } = { parentId: at.parent.id, index: at.index + 1 });
  }
  addAt({ kind: 'new', key }, parentId, index);
};

/** Variables that aren't on the status bar yet, added at the end. */
export function addVarsAtEnd(vars: VarNode[]) {
  const all = st().project.vars;
  const { root } = bar();
  let made = vars.map((v) => nodeFromVar(v, all));
  let freeH: number | undefined;
  if (isFree(root)) ({ nodes: made, freeH } = underAll(made, root, freeBottom(root)));
  st().editBar((b) => ({ ...b, root: { ...b.root, ...(freeH ? { freeH } : {}), children: [...(b.root.children ?? []), ...made] } }));
}

export function moveNode(id: string, parentId: string, index: number, at?: FreePoint): boolean {
  const { root } = bar();
  const node = findNode(root, id);
  if (!node || id === root.id) return false;
  const problem = placementProblem(root, st().project.vars, node, parentId);
  if (problem) {
    notify(problem);
    return false;
  }
  const pos = freeAt(node, parentId, at);
  st().editBar((b) => {
    let next = moveTo([b.root], id, parentId, index)[0];
    if (pos) next = grow(updateVar([next], id, { at: pos.at })[0], parentId, pos.freeH);
    return next === b.root ? b : { ...b, root: next };
  });
  return true;
}

export function updateNode(id: string, patch: Partial<BarNode>, key?: string) {
  st().editBar((b) => ({ ...b, root: updateVar([b.root], id, patch)[0] }), key);
}

/** A part of a free box put somewhere else in it (dragging it is one undo step). */
export function placeNode(id: string, at: FreeAt) {
  updateNode(id, { at: cleanAt(at) }, `bar:${id}:at`);
}

/** Lay a box out freely, with everything staying where it is on the canvas now. */
export function makeFree(id: string) {
  const box = findNode(bar().root, id);
  if (!box || box.type !== 'box') return;
  const rects = canvasLayout.rects;
  const br = rects.find((r) => r.id === id && !r.tab && !r.stage && r.cb);
  const patch = br?.cb
    ? toFree(box, br.cb, br.cb.u, (box.children ?? []).map((k) => rectInside(rects, k.id, br)))
    : toFree(box, { x: 0, y: 0, w: FREE_W, h: 0 }, FREE_W, []);
  updateNode(id, patch, `bar:${id}:dir`);
}

/** A free box just as tall as what is in it (as drawn on the canvas now). */
export function fitFreeHeight(id: string) {
  const box = findNode(bar().root, id);
  const stage = canvasLayout.rects.find((r) => r.id === id && r.stage);
  if (!box || !stage) return;
  const kids = (box.children ?? []).map((k) => rectInside(canvasLayout.rects, k.id, { x: stage.x - 4000, y: stage.y, w: 8000, h: 8000 }));
  updateNode(id, { freeH: fitHeight(box, stage, kids) }, `bar:${id}:freeH`);
}

export function removeSelected() {
  const { root } = bar();
  const id = st().barSel;
  const at = id ? locate([root], id) : null;
  if (!at?.parent) return;
  st().editBar((b) => ({ ...b, root: removeVar([b.root], at.node.id)[0] }));
  const next = at.siblings[at.index + 1] ?? at.siblings[at.index - 1] ?? at.parent;
  st().selectBar(next.id);
}

export function duplicateSelected() {
  const { root } = bar();
  const at = st().barSel ? locate([root], st().barSel!) : null;
  if (!at?.parent) return;
  const made = cloneNode(at.node);
  // in a free box the copy would sit right on top of the original
  const copy = isFree(at.parent) && made.at ? { ...made, at: { ...made.at, x: made.at.x + 12, y: made.at.y + 12 } } : made;
  st().editBar((b) => ({ ...b, root: insertAt([b.root], at.parent!.id, at.index + 1, copy)[0] }));
  st().selectBar(copy.id);
}

export function moveSelected(delta: -1 | 1) {
  const id = st().barSel;
  if (!id) return;
  st().editBar((b) => {
    const next = moveVar([b.root], id, delta)[0];
    return next === b.root ? b : { ...b, root: next };
  });
}

export function selectParent() {
  const at = st().barSel ? locate([bar().root], st().barSel!) : null;
  if (at?.parent) st().selectBar(at.parent.id);
}

/** First component that shows this variable (to jump there from the variable list). */
export function nodeShowing(varId: string): string | null {
  const find = (n: BarNode): string | null => {
    if (n.bind?.var === varId) return n.id;
    for (const c of n.children ?? []) {
      const r = find(c);
      if (r) return r;
    }
    return null;
  };
  return find(bar().root);
}

/** Back to the automatic layout (colors stay). */
export function resetLayout() {
  st().edit((p) => (p.bar?.root ? { ...p, bar: { v: 1, theme: p.bar.theme, ...(p.bar.css ? { css: p.bar.css } : {}) } } : p));
  st().selectBar(null);
}

/* ---------- ready-made layouts and skins ---------- */

/** Lay the bar out again from the variables (colors stay). */
export function pickLayout(key: string) {
  const l = LAYOUTS.find((x) => x.key === key);
  if (!l) return;
  const root = l.make(st().project.vars);
  st().editBar((b) => ({ ...b, root }));
  // a picture to fill in: show its settings right away
  const pic = [...eachNode([root])].find((n) => n.type === 'image');
  st().selectBar(pic?.id ?? null);
  notify(pic ? `换成了「${l.name}」排版，在右边放上图片就好（可以撤销）` : `换成了「${l.name}」排版，可以撤销`);
}

/** Restyle everything in one go (nothing moves). */
export function pickSkin(name: string) {
  const skin = SKINS.find((x) => x.name === name);
  if (!skin) return;
  st().editBar((b) => ({ ...b, ...applySkin(b.root, b.theme, skin) }));
  notify(`换成了「${skin.name}」风格，可以撤销`);
}

/* ---------- format painter ---------- */

export function copyStyle() {
  const n = findNode(bar().root, st().barSel);
  if (!n) return;
  st().setBarClip(copyLook(n));
  notify('样式已复制，选中别的组件点「粘贴样式」');
}

/** Paste the copied look onto the selection, or onto every component of the copied kind. */
export function pasteStyle(all = false) {
  const look = st().barClip;
  const sel = st().barSel;
  if (!look) return;
  const root = bar().root;
  const targets = all ? [...eachNode([root])].filter((n) => n.type === look.type && n.id !== root.id).map((n) => n.id) : sel ? [sel] : [];
  if (!targets.length) return;
  st().editBar((b) => {
    let r = b.root;
    for (const id of targets) {
      const n = findNode(r, id);
      if (!n) continue;
      // keys the look doesn't have are cleared, not kept
      const next = pasteLook(n, look);
      const patch = Object.fromEntries([...new Set([...Object.keys(n), ...Object.keys(next)])].map((k) => [k, next[k as keyof BarNode]]));
      r = updateVar([r], id, patch)[0];
    }
    return { ...b, root: r };
  });
  if (all) notify(`已经粘贴到 ${targets.length} 个组件上`);
}
