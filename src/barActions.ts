// What the status bar page can do: add components from the palette or the variable list, move, copy, delete.
// Shared by the canvas, the settings panel and the keyboard shortcuts.
import { useCard } from './cardStore';
import { useStore } from './store';
import { barOf, cloneNode, editButton, findNode, isContainer, newNode, nodeFromVar, pathTo, placementProblem, scopeAt, type BarNode, type BarType } from './mvu/bar';
import { findVar, insertAt, locate, moveTo, moveVar, removeVar, updateVar } from './mvu/tree';
import type { VarNode } from './mvu/types';

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

/** Put a new component in; returns false (and says why) when it can't go there. */
export function addAt(item: DragItem, parentId: string, index: number): boolean {
  const { node, problem } = nodeFor(item, parentId);
  if (problem) notify(problem);
  if (!node) return false;
  st().editBar((b) => ({ ...b, root: insertAt([b.root], parentId, index, node)[0] }));
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
  st().editBar((b) => ({ ...b, root: { ...b.root, children: [...(b.root.children ?? []), ...vars.map((v) => nodeFromVar(v, all))] } }));
}

export function moveNode(id: string, parentId: string, index: number): boolean {
  const { root } = bar();
  const node = findNode(root, id);
  if (!node || id === root.id) return false;
  const problem = placementProblem(root, st().project.vars, node, parentId);
  if (problem) {
    notify(problem);
    return false;
  }
  st().editBar((b) => {
    const next = moveTo([b.root], id, parentId, index)[0];
    return next === b.root ? b : { ...b, root: next };
  });
  return true;
}

export function updateNode(id: string, patch: Partial<BarNode>, key?: string) {
  st().editBar((b) => ({ ...b, root: updateVar([b.root], id, patch)[0] }), key);
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
  const copy = cloneNode(at.node);
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
  st().edit((p) => (p.bar?.root ? { ...p, bar: { v: 1, theme: p.bar.theme } } : p));
  st().selectBar(null);
}
