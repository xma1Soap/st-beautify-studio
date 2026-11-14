// The variables as they are at the start, or after the AI reply pasted into the simulator,
// plus any values the author changed by hand to try the status bar out.
import { useMemo } from 'react';
import type { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';
import { useCard } from '../../cardStore';
import { applyOps, extractOps, type OpResult } from '../../mvu/patch';
import { buildSchema } from '../../mvu/schema';
import type { VarNode } from '../../mvu/types';
import { greetingData, leaves, withValues } from '../../mvu/vars';

export interface Sim {
  data: Record<string, unknown>;
  /** problem with the variable setup itself */
  setupError: string;
  readErrors: string[];
  results: OpResult[];
  /** with AI replies: the variables before the last one (the status bar compares with them, like with the previous message) */
  before?: Record<string, unknown>;
  /** updates in the earlier replies that were rejected */
  earlierBad: number;
  /** the variables at the start (the greeting's) and after each reply, one by one (without the hand-changed values) */
  start?: Record<string, unknown>;
  after?: Record<string, unknown>[];
}

/** Variables that can be changed by hand (not groups, tables, or anything inside a table), with where they are. */
export const tweakable = (vars: VarNode[]) => leaves(vars);

/** The edge cases a status bar should survive, one click each in 试试不同数值. */
export type Extreme = 'zero' | 'full' | 'empty' | 'long';
export const EXTREMES: { key: Extreme; label: string; title: string }[] = [
  { key: 'zero', label: '数字归零', title: '所有数字变成 0（有范围的取最接近 0 的值）' },
  { key: 'full', label: '数字拉满', title: '有范围的数字变成最大值，没范围的变成一个很大的数（99999999）' },
  { key: 'empty', label: '列表表格清空', title: '所有列表和表格变成空的' },
  { key: 'long', label: '文字超长', title: '所有文字变成很长的一段（还带一个很长的英文单词），列表变成几条很长的' },
];
const LONG_WORD = 'Supercalifragilisticexpialidocious_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
export const LONG_TEXT = '这是一段特别长的文字，用来看看状态栏会不会被撑坏：' + '很长很长的内容，'.repeat(8) + LONG_WORD;
const LONG_ITEMS = ['第一条很长很长很长很长很长很长很长很长的内容', '第二条' + LONG_WORD, '第三条也很长，' + '还在继续，'.repeat(6)];

/** Hand-changed values (by variable id) that put the variables in one of the edge cases; tables can be emptied too. */
export function extremeTweak(vars: VarNode[], kind: Extreme): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { v } of leaves(vars, true)) {
    if (v.kind === 'number' && kind === 'zero') out[v.id] = Math.min(Math.max(0, v.min ?? -Infinity), v.max ?? Infinity);
    else if (v.kind === 'number' && kind === 'full') out[v.id] = v.max ?? 99999999;
    else if (v.kind === 'list' && kind === 'empty') out[v.id] = [];
    else if (v.kind === 'table' && kind === 'empty') out[v.id] = {};
    else if (v.kind === 'text' && kind === 'long') out[v.id] = LONG_TEXT;
    else if (v.kind === 'list' && kind === 'long') out[v.id] = LONG_ITEMS;
  }
  return out;
}

/** Put the hand-changed values in (a table can be emptied), then let the schema clamp numbers and recompute stage names. */
function applyTweak(vars: VarNode[], data: Record<string, unknown>, schema: z.ZodType, tweak: Record<string, unknown>) {
  const next = withValues(vars, data, tweak, true);
  if (next === data) return data;
  const parsed = schema.safeParse(next);
  return parsed.success ? (parsed.data as Record<string, unknown>) : next;
}

/**
 * The variables after the AI replies in `steps`, one after another (a string = one reply); results are those of the last.
 * `own`: the chosen greeting's own starting values (by variable id).
 */
export function simulate(vars: VarNode[], steps: string | string[], tweak: Record<string, unknown> = {}, own?: Record<string, unknown>): Sim {
  const list = typeof steps === 'string' ? [steps] : steps.length ? steps : [''];
  const raw = greetingData(vars, own);
  let schema;
  try {
    schema = buildSchema(vars);
  } catch (e) {
    return { data: raw, setupError: '变量设置有问题，没法检查：' + (e as Error).message, readErrors: [], results: [], earlierBad: 0 };
  }
  const start = schema.safeParse(raw);
  if (!start.success) {
    const i = start.error.issues[0];
    return { data: raw, setupError: `初始值不符合设定（${i.path.join('.') || '变量'}：${i.message}），MVU 开局时会报错`, readErrors: [], results: [], earlierBad: 0 };
  }
  let data = start.data as Record<string, unknown>;
  let before = data;
  let earlierBad = 0;
  const after: Record<string, unknown>[] = [];
  let last: { errors: string[]; results: OpResult[] } = { errors: [], results: [] };
  list.forEach((text, i) => {
    before = data;
    if (!text.trim()) {
      last = { errors: [], results: [] };
      after.push(data);
      return;
    }
    const { ops, errors } = extractOps(text);
    const r = applyOps(data, ops, schema);
    data = r.data;
    after.push(data);
    last = { errors, results: r.results };
    if (i < list.length - 1) earlierBad += errors.length + r.results.filter((x) => !x.ok).length;
  });
  const any = list.some((t) => t.trim());
  return {
    data: applyTweak(vars, data, schema, tweak),
    setupError: '',
    readErrors: last.errors,
    results: last.results,
    earlierBad,
    start: start.data as Record<string, unknown>,
    after,
    ...(any ? { before } : {}),
  };
}

export function useSim(): Sim {
  const vars = useCard((s) => s.project.vars);
  const steps = useCard(useShallow((s) => s.simSteps.slice(0, s.simAt + 1)));
  const tweak = useCard((s) => s.simTweak);
  const own = useCard((s) => s.project.card.greetingVars?.[s.simGreeting]);
  return useMemo(() => simulate(vars, steps, tweak, own), [vars, steps, tweak, own]);
}
