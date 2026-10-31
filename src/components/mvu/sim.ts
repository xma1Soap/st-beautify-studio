// The variables as they are at the start, or after the AI reply pasted into the simulator.
import { useMemo } from 'react';
import { useCard } from '../../cardStore';
import { applyOps, extractOps, type OpResult } from '../../mvu/patch';
import { buildSchema } from '../../mvu/schema';
import type { VarNode } from '../../mvu/types';
import { initialData } from '../../mvu/vars';

export interface Sim {
  data: Record<string, unknown>;
  /** problem with the variable setup itself */
  setupError: string;
  readErrors: string[];
  results: OpResult[];
}

export function simulate(vars: VarNode[], text: string): Sim {
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
  if (!text.trim()) return { data, setupError: '', readErrors: [], results: [] };
  const { ops, errors } = extractOps(text);
  const r = applyOps(data, ops, schema);
  return { data: r.data, setupError: '', readErrors: errors, results: r.results };
}

export function useSim(): Sim {
  const vars = useCard((s) => s.project.vars);
  const simText = useCard((s) => s.simText);
  return useMemo(() => simulate(vars, simText), [vars, simText]);
}
