// The variables as they are at the start, or after the AI reply pasted into the simulator,
// plus any values the author changed by hand to try the status bar out.
import { useMemo } from 'react';
import type { z } from 'zod';
import { useCard } from '../../cardStore';
import { applyOps, extractOps, type OpResult } from '../../mvu/patch';
import { buildSchema } from '../../mvu/schema';
import type { VarNode } from '../../mvu/types';
import { initialData, varKey } from '../../mvu/vars';

export interface Sim {
  data: Record<string, unknown>;
  /** problem with the variable setup itself */
  setupError: string;
  readErrors: string[];
  results: OpResult[];
}

/** Variables that can be changed by hand (not groups, tables, or anything inside a table), with where they are. */
export function tweakable(vars: VarNode[]): { v: VarNode; keys: string[]; label: string }[] {
  const out: { v: VarNode; keys: string[]; label: string }[] = [];
  const go = (list: VarNode[], keys: string[], names: string[]) => {
    for (const v of list) {
      const k = [...keys, varKey(v)];
      const n = [...names, v.name];
      if (v.kind === 'group') go(v.children ?? [], k, n);
      else if (v.kind !== 'table') out.push({ v, keys: k, label: n.join(' › ') });
    }
  };
  go(vars, [], []);
  return out;
}

/** Does a value suit the variable (it may have changed kind since)? */
function fits(v: VarNode, x: unknown): boolean {
  switch (v.kind) {
    case 'number':
      return typeof x === 'number' && isFinite(x);
    case 'bool':
      return typeof x === 'boolean';
    case 'list':
      return Array.isArray(x);
    case 'choice':
      return typeof x === 'string' && (v.options ?? []).includes(x);
    default:
      return typeof x === 'string';
  }
}

function setAt(o: Record<string, unknown>, keys: string[], x: unknown) {
  let cur = o;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = x;
}

/** Put the hand-changed values in, then let the schema clamp numbers and recompute stage names. */
function applyTweak(vars: VarNode[], data: Record<string, unknown>, schema: z.ZodType, tweak: Record<string, unknown>) {
  const list = tweakable(vars).filter((t) => t.v.id in tweak && fits(t.v, tweak[t.v.id]));
  if (!list.length) return data;
  const next = structuredClone(data);
  for (const t of list) setAt(next, t.keys, structuredClone(tweak[t.v.id]));
  const parsed = schema.safeParse(next);
  return parsed.success ? (parsed.data as Record<string, unknown>) : next;
}

export function simulate(vars: VarNode[], text: string, tweak: Record<string, unknown> = {}): Sim {
  const raw = initialData(vars);
  let schema;
  try {
    schema = buildSchema(vars);
  } catch (e) {
    return { data: raw, setupError: '变量设置有问题，没法检查：' + (e as Error).message, readErrors: [], results: [] };
  }
  const start = schema.safeParse(raw);
  if (!start.success) {
    const i = start.error.issues[0];
    return { data: raw, setupError: `初始值不符合设定（${i.path.join('.') || '变量'}：${i.message}），MVU 开局时会报错`, readErrors: [], results: [] };
  }
  const data = start.data as Record<string, unknown>;
  if (!text.trim()) return { data: applyTweak(vars, data, schema, tweak), setupError: '', readErrors: [], results: [] };
  const { ops, errors } = extractOps(text);
  const r = applyOps(data, ops, schema);
  return { data: applyTweak(vars, r.data, schema, tweak), setupError: '', readErrors: errors, results: r.results };
}

export function useSim(): Sim {
  const vars = useCard((s) => s.project.vars);
  const simText = useCard((s) => s.simText);
  const tweak = useCard((s) => s.simTweak);
  return useMemo(() => simulate(vars, simText, tweak), [vars, simText, tweak]);
}
