// Editing the variable tree without mutating it (every change returns a new tree, so undo is just keeping old ones).
import { newId } from '../lib/id';
import type { VarKind, VarNode } from './types';
import { defaultValue } from './vars';

export interface Located {
  node: VarNode;
  /** the list the node is in */
  siblings: VarNode[];
  index: number;
  parent: VarNode | null;
}

export function locate(vars: VarNode[], id: string, parent: VarNode | null = null): Located | null {
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i];
    if (v.id === id) return { node: v, siblings: vars, index: i, parent };
    if (v.children) {
      const r = locate(v.children, id, v);
      if (r) return r;
    }
  }
  return null;
}

export const findVar = (vars: VarNode[], id: string | null) => (id ? locate(vars, id)?.node ?? null : null);

/** Replace the list that contains `id` (or the root list) by fn(list). */
function mapList(vars: VarNode[], id: string, fn: (list: VarNode[], index: number) => VarNode[]): VarNode[] {
  const i = vars.findIndex((v) => v.id === id);
  if (i >= 0) return fn(vars, i);
  let changed = false;
  const out = vars.map((v) => {
    if (changed || !v.children) return v;
    const kids = mapList(v.children, id, fn);
    if (kids === v.children) return v;
    changed = true;
    return { ...v, children: kids };
  });
  return changed ? out : vars;
}

export function updateVar(vars: VarNode[], id: string, patch: Partial<VarNode>): VarNode[] {
  return mapList(vars, id, (list, i) => list.map((v, j) => (j === i ? { ...v, ...patch } : v)));
}

export function removeVar(vars: VarNode[], id: string): VarNode[] {
  return mapList(vars, id, (list, i) => list.filter((_, j) => j !== i));
}

/** Insert after `afterId` (same level), inside `intoId` (at the end), or at the end of the root list. */
export function insertVar(vars: VarNode[], node: VarNode, where: { afterId?: string | null; intoId?: string | null } = {}): VarNode[] {
  if (where.intoId) {
    const target = findVar(vars, where.intoId);
    if (target) return updateVar(vars, where.intoId, { children: [...(target.children ?? []), node] });
  }
  if (where.afterId && locate(vars, where.afterId)) return mapList(vars, where.afterId, (list, i) => [...list.slice(0, i + 1), node, ...list.slice(i + 1)]);
  return [...vars, node];
}

export function moveVar(vars: VarNode[], id: string, delta: -1 | 1): VarNode[] {
  return mapList(vars, id, (list, i) => {
    const j = i + delta;
    if (j < 0 || j >= list.length) return list;
    const c = [...list];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
}

const canHold = (v: VarNode | null | undefined, child: VarNode) =>
  !!v && (v.kind === 'group' || (v.kind === 'table' && child.kind !== 'group' && child.kind !== 'table'));

/** Move into the group (or table) right above it. */
export function indentVar(vars: VarNode[], id: string): VarNode[] {
  const at = locate(vars, id);
  if (!at || at.index === 0) return vars;
  const prev = at.siblings[at.index - 1];
  if (!canHold(prev, at.node)) return vars;
  return insertVar(removeVar(vars, id), at.node, { intoId: prev.id });
}

/** Move out of its group, right after the group. */
export function outdentVar(vars: VarNode[], id: string): VarNode[] {
  const at = locate(vars, id);
  if (!at?.parent) return vars;
  const grand = locate(vars, at.parent.id);
  if (grand?.parent && !canHold(grand.parent, at.node)) return vars;
  return insertVar(removeVar(vars, id), at.node, { afterId: at.parent.id });
}

export const canIndent = (vars: VarNode[], id: string) => {
  const at = locate(vars, id);
  return !!at && at.index > 0 && canHold(at.siblings[at.index - 1], at.node);
};

export const canOutdent = (vars: VarNode[], id: string) => {
  const at = locate(vars, id);
  if (!at?.parent) return false;
  const grand = locate(vars, at.parent.id);
  return !grand?.parent || canHold(grand.parent, at.node);
};

/** A copy with fresh ids everywhere. */
export function cloneVar(v: VarNode): VarNode {
  return { ...structuredClone(v), id: newId(), children: v.children?.map(cloneVar) };
}

/** `name`, or `name2`, `name3`… so it doesn't clash with `taken`. */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  let n = 2;
  while (taken.includes(`${name}${n}`)) n++;
  return `${name}${n}`;
}

const KIND_DEFAULT_NAME: Record<VarKind, string> = {
  group: '新分组',
  number: '新数字',
  text: '新文字',
  bool: '新开关',
  choice: '新选项',
  list: '新列表',
  table: '新表格',
};

export function newVar(kind: VarKind, taken: string[] = []): VarNode {
  const v: VarNode = { id: newId(), name: uniqueName(KIND_DEFAULT_NAME[kind], taken), kind, rules: [] };
  if (kind === 'group') v.children = [];
  if (kind === 'number') Object.assign(v, { init: 0, integer: true });
  if (kind === 'choice') Object.assign(v, { options: ['选项一', '选项二'], init: '选项一' });
  if (kind === 'table') Object.assign(v, { rowName: '名字', init: {}, children: [{ id: newId(), name: '数量', kind: 'number', init: 1, min: 0, integer: true, rules: [] }] });
  return v;
}

/** Fields that only make sense for one kind are dropped when the kind changes. */
export function changeKind(v: VarNode, kind: VarKind): Partial<VarNode> {
  const fresh = newVar(kind);
  return {
    kind,
    init: fresh.init,
    min: undefined,
    max: undefined,
    integer: fresh.integer,
    options: fresh.options,
    stages: undefined,
    rowName: fresh.rowName,
    dropRowWhenZero: undefined,
    children: kind === 'group' || kind === 'table' ? (v.kind === kind ? v.children : fresh.children) : undefined,
  };
}

/** Change a table field; a new name or read-only setting also renames its key in the starting rows. */
export function patchField(table: VarNode, fieldId: string, patch: Partial<VarNode>): Partial<VarNode> {
  const field = table.children?.find((f) => f.id === fieldId);
  if (!field) return {};
  const next = { ...field, ...patch };
  const key = (v: VarNode) => (v.readonly ? '_' : '') + v.name;
  const [oldKey, newKey] = [key(field), key(next)];
  const out: Partial<VarNode> = { children: table.children!.map((f) => (f.id === fieldId ? next : f)) };
  const kindChanged = next.kind !== field.kind;
  if (oldKey !== newKey || kindChanged) {
    // a new kind makes the old cell values wrong, so those start over from the field's default
    const fresh = next.init ?? defaultValue(next);
    const rows = (table.init ?? {}) as Record<string, Record<string, unknown>>;
    out.init = Object.fromEntries(
      Object.entries(rows).map(([r, row]) => [
        r,
        Object.fromEntries(Object.entries(row ?? {}).map(([k, x]) => (k === oldKey ? [newKey, kindChanged ? structuredClone(fresh) : x] : [k, x]))),
      ]),
    );
  }
  if (table.dropRowWhenZero === field.name && next.name !== field.name) out.dropRowWhenZero = next.name;
  if (table.dropRowWhenZero === field.name && next.kind !== 'number') out.dropRowWhenZero = undefined;
  return out;
}

/** Put a variable into a new group in its place (numbers need a group to get stages). */
export function wrapInGroup(vars: VarNode[], id: string, groupName: string): { vars: VarNode[]; groupId: string } {
  const at = locate(vars, id);
  const group: VarNode = { id: newId(), name: groupName, kind: 'group', rules: [], children: at ? [at.node] : [] };
  if (!at) return { vars, groupId: group.id };
  return { vars: mapList(vars, id, (list, i) => list.map((v, j) => (j === i ? group : v))), groupId: group.id };
}

/** Names already used next to `id` (or inside `intoId`), for picking a new unique name. */
export function namesNear(vars: VarNode[], where: { afterId?: string | null; intoId?: string | null }): string[] {
  if (where.intoId) return findVar(vars, where.intoId)?.children?.map((v) => v.name) ?? [];
  if (where.afterId) return locate(vars, where.afterId)?.siblings.map((v) => v.name) ?? vars.map((v) => v.name);
  return vars.map((v) => v.name);
}
