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
}

/** Variables that can be changed by hand (not groups, tables, or anything inside a table), with where they are. */
export const tweakable = (vars: VarNode[]) => leaves(vars);

/** Put the hand-changed values in, then let the schema clamp numbers and recompute stage names. */
function applyTweak(vars: VarNode[], data: Record<string, unknown>, schema: z.ZodType, tweak: Record<string, unknown>) {
  const next = withValues(vars, data, tweak);
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
  let last: { errors: string[]; results: OpResult[] } = { errors: [], results: [] };
  list.forEach((text, i) => {
    before = data;
    if (!text.trim()) {
      last = { errors: [], results: [] };
      return;
    }
    const { ops, errors } = extractOps(text);
    const r = applyOps(data, ops, schema);
    data = r.data;
    last = { errors, results: r.results };
    if (i < list.length - 1) earlierBad += errors.length + r.results.filter((x) => !x.ok).length;
  });
  const any = list.some((t) => t.trim());
  return { data: applyTweak(vars, data, schema, tweak), setupError: '', readErrors: last.errors, results: last.results, earlierBad, ...(any ? { before } : {}) };
}

export function useSim(): Sim {
  const vars = useCard((s) => s.project.vars);
  const steps = useCard(useShallow((s) => s.simSteps.slice(0, s.simAt + 1)));
  const tweak = useCard((s) => s.simTweak);
  const own = useCard((s) => s.project.card.greetingVars?.[s.simGreeting]);
  return useMemo(() => simulate(vars, steps, tweak, own), [vars, steps, tweak, own]);
}
