// Simulator: reads the <UpdateVariable> block of an AI reply and applies its JSONPatch the way MVU does
// (replace / delta / insert / remove / move), then checks the result with the card's own zod schema.
// Each operation is checked on its own, so the newcomer sees exactly which line the card would reject and why.
// (MVU's zod helper also checks commands one by one before applying them; see PLAN.md 0.9 for what is still to verify.)
import JSON5 from 'json5';
import YAML from 'yaml';
import type * as z from 'zod';

export interface PatchOp {
  op: string;
  path?: string;
  from?: string;
  to?: string;
  value?: unknown;
}

export interface OpResult {
  op: PatchOp;
  ok: boolean;
  /** plain-language reason when not ok, or a note */
  msg: string;
}

export interface Extracted {
  ops: PatchOp[];
  /** problems reading the block itself (no block, broken JSON) */
  errors: string[];
}

/** Read the patch the way MVU does: strip a ``` fence, try JSON5 (comments, trailing commas), then YAML. */
function parseLoose(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json5?|ya?ml)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON5.parse(t);
  } catch (e) {
    try {
      return YAML.parse(t);
    } catch {
      throw e;
    }
  }
}

/** Finds every <UpdateVariable> block (also one cut off at the end) and the JSONPatch inside. */
export function extractOps(text: string): Extracted {
  const out: Extracted = { ops: [], errors: [] };
  const blocks = [...text.matchAll(/<UpdateVariable>([\s\S]*?)(?:<\/UpdateVariable>|$)/gi)];
  if (!blocks.length) {
    out.errors.push('没有找到 <UpdateVariable> 块');
    return out;
  }
  for (const b of blocks) {
    const patch = /<JSONPatch>([\s\S]*?)(?:<\/JSONPatch>|$)/i.exec(b[1]);
    if (!patch) {
      out.errors.push('<UpdateVariable> 里没有 <JSONPatch>');
      continue;
    }
    try {
      const ops = parseLoose(patch[1]);
      if (!Array.isArray(ops)) throw new Error('不是数组');
      out.ops.push(...(ops as PatchOp[]));
    } catch (e) {
      out.errors.push(`<JSONPatch> 里的内容不是有效的 JSON 数组：${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

const keysOf = (pointer: string) =>
  pointer
    .replace(/^\//, '')
    .split('/')
    .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'));

function getAt(data: any, keys: string[]): any {
  let cur = data;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

const isContainer = (x: unknown): x is any => x !== null && typeof x === 'object';

/** Applies one operation in place. Throws a plain-language error when it cannot. */
function applyOne(data: any, op: PatchOp) {
  const path = op.path ?? op.to;
  if (!path) throw new Error('缺少 path');
  const keys = keysOf(path);
  const last = keys[keys.length - 1];
  const parent = getAt(data, keys.slice(0, -1));
  if (!isContainer(parent)) throw new Error(`路径 ${path} 的上一层不存在`);
  switch (op.op) {
    case 'replace':
      if (!(last in parent) && Array.isArray(parent)) throw new Error(`列表里没有第 ${last} 项`);
      parent[last] = op.value;
      return;
    case 'delta': {
      const old = Number(parent[last]);
      const add = Number(op.value);
      if (!(last in parent) || isNaN(old)) throw new Error(`${path} 不是数字变量`);
      if (isNaN(add)) throw new Error(`delta 的值 ${JSON.stringify(op.value)} 不是数字`);
      parent[last] = old + add;
      return;
    }
    case 'insert':
    case 'add':
      if (Array.isArray(parent)) {
        if (last === '-') parent.push(op.value);
        else if (/^\d+$/.test(last)) parent.splice(Number(last), 0, op.value);
        else throw new Error(`往列表里加时，路径最后一段要写 - 或数字`);
      } else parent[last] = op.value;
      return;
    case 'remove':
      if (!(last in parent)) throw new Error(`${path} 不存在，删不掉`);
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
      return;
    case 'move': {
      if (!op.from) throw new Error('move 缺少 from');
      const fk = keysOf(op.from);
      const fp = getAt(data, fk.slice(0, -1));
      const fl = fk[fk.length - 1];
      if (!isContainer(fp) || !(fl in fp)) throw new Error(`${op.from} 不存在`);
      const value = fp[fl];
      if (Array.isArray(fp)) fp.splice(Number(fl), 1);
      else delete fp[fl];
      if (Array.isArray(parent) && last === '-') parent.push(value);
      else parent[last] = value;
      return;
    }
    default:
      throw new Error(`不认识的操作「${op.op}」，只能用 replace / delta / insert / remove / move`);
  }
}

function zodMessage(err: z.ZodError): string {
  const i = err.issues[0];
  const where = i.path.length ? i.path.join('.') : '变量';
  return `${where}：${i.message}`;
}

/**
 * Applies the operations one by one; each one is kept only if the result still passes the schema.
 * Returns the new data (with computed values such as stage names filled in) and one result per operation.
 */
export function applyOps(data: Record<string, unknown>, ops: PatchOp[], schema: z.ZodType): { data: Record<string, unknown>; results: OpResult[] } {
  let cur: Record<string, unknown> = structuredClone(data);
  const results: OpResult[] = [];
  for (const op of ops) {
    const next = structuredClone(cur);
    try {
      applyOne(next, op);
    } catch (e) {
      results.push({ op, ok: false, msg: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const parsed = schema.safeParse(next);
    if (!parsed.success) {
      results.push({ op, ok: false, msg: `结果不符合变量设定，MVU 会拒绝：${zodMessage(parsed.error)}` });
      continue;
    }
    cur = parsed.data as Record<string, unknown>;
    const keys = keysOf(op.path ?? op.to ?? '');
    const [written, kept] = [getAt(next, keys), getAt(cur, keys)];
    const note = keys.some((k) => k.startsWith('_'))
      ? '改了只读变量（名字以 _ 开头），规则里要求 AI 不要这样做'
      : keys.some((k) => k.startsWith('$'))
        ? '改了自动算出的变量（名字以 $ 开头），会被重新算'
        : typeof written === 'number' && typeof kept === 'number' && written !== kept
          ? `算出来是 ${written}，超出范围或不是整数，MVU 会改成 ${kept}`
          : kept === undefined && written !== undefined && op.op !== 'remove'
            ? getAt(cur, keys.slice(0, -1)) === undefined
              ? '这一行被自动删掉了（数量降到 0 或以下）'
              : '变量设定里没有这一项，MVU 会把它丢掉'
            : '';
    results.push({ op, ok: true, msg: note });
  }
  return { data: cur, results };
}
