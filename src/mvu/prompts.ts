// Text of the world book entries MVU needs: starting values, current variables, update rules, output format.
// Written for this tool (not copied from any template); the structure follows how MVU cards are usually set up.
import YAML from 'yaml';
import type { VarNode } from './types';
import { initialData, pointer, stageKey, varKey } from './vars';

const yaml = (o: unknown) => YAML.stringify(o, { lineWidth: 0 }).trimEnd();

/** [initvar] entry: starting values. MVU reads every entry whose name contains [initvar], even a disabled one. */
export const initvarText = (vars: VarNode[]) => yaml(initialData(vars)) + '\n';

/** 变量列表 entry: the current variables, sent every turn. */
export const varListText = () => '<status_current_variable>\n{{format_message_variable::stat_data}}\n</status_current_variable>\n';

const KIND_NAME: Record<string, string> = { number: '数字', text: '文字', bool: '是或否（true / false）', choice: '选项', list: '文字列表', group: '分组', table: '表格' };

function typeText(v: VarNode): string {
  switch (v.kind) {
    case 'choice':
      return `只能是其中之一：${(v.options ?? []).join(' / ')}`;
    case 'table': {
      const fields = (v.children ?? []).map((f) => `${varKey(f)}（${KIND_NAME[f.kind]}${f.init !== undefined ? `，默认 ${JSON.stringify(f.init)}` : ''}）`);
      return `表格：每一行的名字是「${v.rowName || '名字'}」，内容是 ${fields.join('、')}`;
    }
    default:
      return KIND_NAME[v.kind];
  }
}

function ruleNode(v: VarNode): Record<string, unknown> | string {
  if (v.kind === 'group') {
    const o: Record<string, unknown> = {};
    for (const c of v.children ?? []) o[varKey(c)] = ruleNode(c);
    for (const c of v.children ?? []) if (c.kind === 'number' && c.stages?.length) o[stageKey(c)] = '自动根据' + varKey(c) + '算出，不要修改';
    return o;
  }
  if (v.readonly) return '只读，不要修改';
  const o: Record<string, unknown> = { 类型: typeText(v) };
  if (v.kind === 'number') {
    if (v.min != null && v.max != null) o['范围'] = `${v.min}~${v.max}`;
    else if (v.min != null) o['范围'] = `不小于 ${v.min}`;
    else if (v.max != null) o['范围'] = `不大于 ${v.max}`;
    if (v.integer) o['取整'] = '只用整数';
    if (v.stages?.length) {
      const st = [...v.stages].sort((a, b) => a.from - b.from);
      o['阶段'] = st.map((s, i) => (i + 1 < st.length ? `${s.from}~${st[i + 1].from - (v.integer ? 1 : 0)}：${s.label}` : `${s.from} 以上：${s.label}`));
    }
  }
  if (v.kind === 'table' && v.dropRowWhenZero) o['删除'] = `${v.dropRowWhenZero}降到 0 时这一行会被自动删除`;
  if (v.rules.length) o['何时更新'] = v.rules;
  return o;
}

/** [mvu_update]变量更新规则 entry: what each variable means and when it changes. */
export function updateRulesText(vars: VarNode[]): string {
  const o: Record<string, unknown> = {};
  for (const v of vars) o[varKey(v)] = ruleNode(v);
  return yaml({ 变量更新规则: o }) + '\n';
}

/** A few example operations built from the card's own variables, so the AI sees real paths. */
export function exampleOps(vars: VarNode[]): object[] {
  const ops: object[] = [];
  let num: object | null = null;
  let text: object | null = null;
  let row: object | null = null;
  let item: object | null = null;
  const visit = (list: VarNode[], keys: string[]) => {
    for (const v of list) {
      if (v.readonly) continue;
      const k = [...keys, varKey(v)];
      if (v.kind === 'group') visit(v.children ?? [], k);
      else if (v.kind === 'number' && !num) num = { op: 'delta', path: pointer(k), value: v.integer === false ? 1.5 : 3 };
      else if (v.kind === 'text' && !text) text = { op: 'replace', path: pointer(k), value: `${v.name}的新内容` };
      else if (v.kind === 'list' && !item) item = { op: 'insert', path: pointer([...k, '-']), value: `新的一项` };
      else if (v.kind === 'table' && !row) {
        const value: Record<string, unknown> = {};
        for (const f of v.children ?? []) value[varKey(f)] = f.init ?? (f.kind === 'number' ? 1 : f.kind === 'bool' ? false : f.kind === 'list' ? [] : `${f.name}`);
        row = { op: 'insert', path: pointer([...k, `新的${v.rowName || '名字'}`]), value };
      }
    }
  };
  visit(vars, []);
  for (const o of [num, text, item, row]) if (o) ops.push(o);
  return ops;
}

/** [mvu_update]变量输出格式 entry: how the AI writes its variable changes. */
export function outputFormatText(vars: VarNode[]): string {
  const example = exampleOps(vars)
    .map((o) => '  ' + JSON.stringify(o))
    .join(',\n');
  return [
    '变量输出格式:',
    '  规则:',
    '    - 每次回复的最后，输出一个 <UpdateVariable> 块：先简短分析，再写更新命令',
    '    - 更新命令是一个 JSON 数组，写法参照 JSON Patch（RFC 6902），可用的操作有：',
    '      - replace：把已有的变量改成新值',
    '      - delta：给数字变量加上一个数，减少就写负数',
    '      - insert：给表格加一行（路径最后一段是这一行的名字），或在列表末尾加一项（路径最后一段写 -）',
    '      - remove：删掉表格的一行或列表的一项',
    '      - move：把一个值从 from 路径移到 path 路径',
    '    - 路径用 / 分隔变量名，从最外层写起，例如 /分组/变量',
    '    - 名字以 _ 开头的变量是只读的，名字以 $ 开头的是自动算出来的，都不要修改',
    '    - 只写这一轮真正变化了的变量，没有变化就输出空数组 []',
    '  格式: |-',
    '    <UpdateVariable>',
    '    <Analysis>',
    '    - 这一轮过去了多少时间',
    '    - 逐个检查变量：按它的更新规则，这一轮是否需要变化',
    '    </Analysis>',
    '    <JSONPatch>',
    '    [',
    '      { "op": "replace", "path": "/路径", "value": 新值 },',
    '      ...',
    '    ]',
    '    </JSONPatch>',
    '    </UpdateVariable>',
    ...(example
      ? ['  示例: |-', '    <UpdateVariable>', '    <Analysis>', '    - ...', '    </Analysis>', '    <JSONPatch>', '    [', ...example.split('\n').map((l) => '    ' + l), '    ]', '    </JSONPatch>', '    </UpdateVariable>']
      : []),
    '',
  ].join('\n');
}
