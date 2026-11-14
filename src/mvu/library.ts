// 我的组件 / 我的模板: status bar pieces kept on this computer to use again in other cards. A piece remembers which
// variables it showed by their place in the variable tree (白娅 › 好感度); used in another card it gets new ids and is
// linked to that card's variables by the same place, or else by the same name.
import { newId } from '../lib/id';
import { eachNode } from './tree';
import { indexVars, type Bar, type BarNode, type BarTheme, type VarInfo } from './bar';
import type { VarNode } from './types';

export const LIBRARY_TYPE = 'st-beautify-studio-library';

export interface MyPart {
  id: string;
  name: string;
  /** when it was saved (ISO) */
  made: string;
  node: BarNode;
  /** variable id → its place in the tree it came from */
  vars: Record<string, string>;
}

export interface MyTemplate {
  id: string;
  name: string;
  made: string;
  root: BarNode;
  theme: BarTheme;
  css?: string;
  vars: Record<string, string>;
}

export interface Library {
  parts: MyPart[];
  templates: MyTemplate[];
}

export const emptyLibrary = (): Library => ({ parts: [], templates: [] });

/** Every variable id a status bar piece points at. */
function usedVars(nodes: BarNode[]): Set<string> {
  const out = new Set<string>();
  for (const n of eachNode(nodes)) {
    if (n.bind?.var) out.add(n.bind.var);
    if (n.action?.do === 'edit') for (const v of n.action.vars ?? []) out.add(v);
  }
  return out;
}

const placesOf = (nodes: BarNode[], idx: Map<string, VarInfo>) =>
  Object.fromEntries([...usedVars(nodes)].map((id) => [id, idx.get(id)?.label]).filter((x): x is [string, string] => !!x[1]));

export function savePart(node: BarNode, vars: VarNode[], name: string): MyPart {
  return { id: newId(), name: name.trim() || '我的组件', made: new Date().toISOString(), node: structuredClone(node), vars: placesOf([node], indexVars(vars)) };
}

export function saveTemplate(bar: Bar, vars: VarNode[], name: string): MyTemplate {
  return {
    id: newId(),
    name: name.trim() || '我的模板',
    made: new Date().toISOString(),
    root: structuredClone(bar.root),
    theme: structuredClone(bar.theme),
    ...(bar.css ? { css: bar.css } : {}),
    vars: placesOf([bar.root], indexVars(vars)),
  };
}

/** A copy with new ids everywhere; buttons pointing inside it point at the copies. */
export function freshCopy(node: BarNode): BarNode {
  const ids = new Map<string, string>();
  for (const n of eachNode([node])) ids.set(n.id, newId());
  const go = (n: BarNode): BarNode => {
    const out: BarNode = { ...structuredClone({ ...n, children: undefined }), id: ids.get(n.id)! };
    if (n.children) out.children = n.children.map(go);
    else delete out.children;
    const a = out.action;
    if (a && (a.do === 'toggle' || a.do === 'page') && a.target && ids.has(a.target)) out.action = { ...a, target: ids.get(a.target) };
    return out;
  };
  return go(node);
}

/**
 * The piece linked to `vars`: each variable it showed found again by its place, or by its name when only one
 * variable has it. `missing`: the places of those not found (their components show what is wrong).
 */
export function relink(node: BarNode, places: Record<string, string>, vars: VarNode[]): { node: BarNode; missing: string[] } {
  const idx = indexVars(vars);
  const infos = [...idx.values()];
  const map = new Map<string, string>();
  const missing: string[] = [];
  for (const [old, place] of Object.entries(places)) {
    if (idx.has(old) && idx.get(old)!.label === place) continue;
    const exact = infos.filter((i) => i.label === place);
    const name = place.split(' › ').pop()!;
    const byName = exact.length ? exact : infos.filter((i) => i.v.name === name);
    if (byName.length === 1) map.set(old, byName[0].v.id);
    else missing.push(place);
  }
  const go = (n: BarNode): BarNode => {
    const out: BarNode = { ...n };
    if (n.bind?.var && map.has(n.bind.var)) out.bind = { ...n.bind, var: map.get(n.bind.var)! };
    if (n.action?.do === 'edit' && n.action.vars) out.action = { ...n.action, vars: n.action.vars.map((v) => map.get(v) ?? v) };
    if (n.children) out.children = n.children.map(go);
    return out;
  };
  return { node: go(node), missing };
}

/** A saved component ready to go into a card. */
export const partForCard = (p: MyPart, vars: VarNode[]) => relink(freshCopy(p.node), p.vars, vars);

/** A saved template ready to become a card's status bar. */
export function templateForCard(t: MyTemplate, vars: VarNode[]): { bar: Bar; missing: string[] } {
  const r = relink(freshCopy(t.root), t.vars, vars);
  return { bar: { v: 1, root: r.node, theme: structuredClone(t.theme), ...(t.css ? { css: t.css } : {}) }, missing: r.missing };
}

/** The library as a file to share. */
export const libraryFile = (lib: Library) => JSON.stringify({ type: LIBRARY_TYPE, version: 1, ...lib }, null, 1);

/** A library file read back (only well-formed entries; they get new ids, so importing twice keeps both). */
export function readLibraryFile(text: string): Library {
  const j = JSON.parse(text);
  if (!j || j.type !== LIBRARY_TYPE) throw new Error('这不是「我的组件和模板」导出的文件');
  const okNode = (n: any) => n && typeof n === 'object' && typeof n.id === 'string' && typeof n.type === 'string';
  const okVars = (v: any) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) : {}) as Record<string, string>;
  const parts = (Array.isArray(j.parts) ? j.parts : [])
    .filter((p: any) => okNode(p?.node))
    .map((p: any): MyPart => ({ id: newId(), name: String(p.name ?? '我的组件').slice(0, 40), made: String(p.made ?? ''), node: p.node, vars: okVars(p.vars) }));
  const templates = (Array.isArray(j.templates) ? j.templates : [])
    .filter((t: any) => okNode(t?.root) && t.theme && typeof t.theme === 'object')
    .map(
      (t: any): MyTemplate => ({
        id: newId(),
        name: String(t.name ?? '我的模板').slice(0, 40),
        made: String(t.made ?? ''),
        root: t.root,
        theme: t.theme,
        ...(typeof t.css === 'string' ? { css: t.css } : {}),
        vars: okVars(t.vars),
      }),
    );
  return { parts, templates };
}
