// Helpers for walking the variable tree: keys, paths, starting data, stage names, problem checks.
import type { VarNode } from './types';

/** Key of the variable inside stat_data. */
export const varKey = (v: VarNode) => (v.readonly ? '_' : '') + v.name;

/** Key of the automatically computed stage name of a number, e.g. $依存度阶段. */
export const stageKey = (v: VarNode) => `$${v.name}阶段`;

/** JSON Pointer used in JSONPatch, e.g. /白娅/依存度 */
export const pointer = (keys: string[]) => '/' + keys.map((k) => k.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

/** Visit every variable with the keys leading to it. Table fields are visited with `inTable` set. */
export function walk(vars: VarNode[], fn: (v: VarNode, keys: string[], inTable: boolean) => void, keys: string[] = [], inTable = false) {
  for (const v of vars) {
    const here = [...keys, varKey(v)];
    fn(v, here, inTable);
    if (v.kind === 'group' && v.children) walk(v.children, fn, here, inTable);
    if (v.kind === 'table' && v.children) walk(v.children, fn, here, true);
  }
}

/** Default starting value when the newcomer did not set one. */
export function defaultValue(v: VarNode): unknown {
  switch (v.kind) {
    case 'number':
      return v.min ?? 0;
    case 'text':
      return '';
    case 'bool':
      return false;
    case 'choice':
      return v.options?.[0] ?? '';
    case 'list':
      return [];
    case 'table':
      return {};
    case 'group':
      return initialData(v.children ?? []);
  }
}

export function startValue(v: VarNode): unknown {
  if (v.kind === 'group') return initialData(v.children ?? []);
  return v.init === undefined ? defaultValue(v) : v.init;
}

/** The starting stat_data (what goes into the [initvar] entry). Computed stage names are not included. */
export function initialData(vars: VarNode[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of vars) out[varKey(v)] = startValue(v);
  return out;
}

/** Stage name for a value: the last stage whose `from` is not above it (the first stage below all of them). */
export function stageOf(v: VarNode, value: number): string {
  const st = [...(v.stages ?? [])].sort((a, b) => a.from - b.from);
  if (!st.length) return '';
  let label = st[0].label;
  for (const s of st) if (value >= s.from) label = s.label;
  return label;
}

/** Things that would break the card, in plain words, with where they are. */
export function problems(vars: VarNode[]): string[] {
  const out: string[] = [];
  const check = (list: VarNode[], where: string, level: 'root' | 'group' | 'table') => {
    const seen = new Set<string>();
    for (const v of list) {
      const at = where ? `${where}.${v.name || '(没名字)'}` : v.name || '(没名字)';
      if (!v.name.trim()) out.push(`${at}：名字不能为空`);
      if (/[./~\\]/.test(v.name)) out.push(`${at}：名字里不能有 . / ~ \\`);
      if (/^[_$]/.test(v.name)) out.push(`${at}：名字不能以 _ 或 $ 开头（只读请用「AI 不能改」开关）`);
      const k = varKey(v);
      if (seen.has(k)) out.push(`${at}：和同一层的另一个变量重名`);
      seen.add(k);
      if (v.kind === 'number') {
        const init = startValue(v);
        if (typeof init !== 'number' || isNaN(init)) out.push(`${at}：初始值要是数字`);
        else {
          if (v.min != null && init < v.min) out.push(`${at}：初始值 ${init} 小于最小值 ${v.min}`);
          if (v.max != null && init > v.max) out.push(`${at}：初始值 ${init} 大于最大值 ${v.max}`);
        }
        if (v.min != null && v.max != null && v.min > v.max) out.push(`${at}：最小值比最大值大`);
        if (v.stages?.length && level !== 'group') out.push(`${at}：阶段只能用在分组里的数字上，请先把它放进一个分组`);
      }
      if (v.kind === 'choice') {
        if (!v.options?.length) out.push(`${at}：至少要有一个选项`);
        else if (!v.options.includes(String(startValue(v)))) out.push(`${at}：初始值不在选项里`);
      }
      if (v.kind === 'group') check(v.children ?? [], at, 'group');
      if (v.kind === 'table') {
        if (!v.children?.length) out.push(`${at}：表格至少要有一个字段`);
        const fields = v.children ?? [];
        for (const f of fields) if (f.kind === 'group' || f.kind === 'table') out.push(`${at}.${f.name}：表格里的字段不能再是分组或表格`);
        if (v.dropRowWhenZero && !fields.some((f) => f.name === v.dropRowWhenZero && f.kind === 'number'))
          out.push(`${at}：「为 0 时删除这一行」选的字段不是这个表格里的数字`);
        check(fields, at, 'table');
      }
    }
  };
  check(vars, '', 'root');
  return out;
}
