import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { processText, runScript } from '../lib/engine';
import { defaultSettings } from '../lib/defaults';
import { fixMarkdown, formatMessage } from '../lib/stformat';
import type { VarNode } from './types';
import { initialData, pointer, problems, stageOf } from './vars';
import { buildSchema, schemaScript, MVU_ZOD_URL } from './schema';
import { initvarText, outputFormatText, updateRulesText, varListText } from './prompts';
import { safeJson, statusBarHtml, statusBarReplacement } from './statusbar';
import { compileBar, defaultBar } from './bar';
import { mvuRegexes, REGEX_NAMES } from './regexes';
import { applyOps, extractOps } from './patch';

let n = 0;
const v = (p: Partial<VarNode> & Pick<VarNode, 'name' | 'kind'>): VarNode => ({ id: `v${++n}`, rules: [], ...p });

const vars: VarNode[] = [
  v({
    name: '世界',
    kind: 'group',
    children: [
      v({ name: '时间', kind: 'text', init: '第一天 清晨', rules: ['每轮按剧情推进'] }),
      v({ name: '地点', kind: 'text', init: '酒馆' }),
    ],
  }),
  v({
    name: '白娅',
    kind: 'group',
    children: [
      v({
        name: '好感度',
        kind: 'number',
        init: 10,
        min: 0,
        max: 100,
        integer: true,
        stages: [
          { from: 30, label: '熟悉' },
          { from: 0, label: '陌生' },
          { from: 70, label: '亲密' },
        ],
        rules: ['友善互动时 +1~3', '被冒犯时 -5~-10'],
      }),
      v({ name: '心情', kind: 'choice', options: ['平静', '开心', '生气'] }),
      v({ name: '已婚', kind: 'bool' }),
    ],
  }),
  v({ name: '金钱', kind: 'number', init: 100, min: 0, readonly: true }),
  v({ name: '任务', kind: 'list', init: ['找到钥匙'] }),
  v({
    name: '物品栏',
    kind: 'table',
    rowName: '物品名',
    dropRowWhenZero: '数量',
    init: { 面包: { 描述: '普通的面包', 数量: 2 } },
    children: [v({ name: '描述', kind: 'text', init: '' }), v({ name: '数量', kind: 'number', init: 1, min: 0, integer: true })],
  }),
];

const schema = buildSchema(vars);
const start = () => schema.parse(initialData(vars)) as any;

describe('variables', () => {
  it('has no problems in a well-formed tree', () => {
    expect(problems(vars)).toEqual([]);
  });
  it('reports problems in plain words', () => {
    const bad = [
      v({ name: '', kind: 'text' }),
      v({ name: 'a/b', kind: 'text' }),
      v({ name: '_x', kind: 'text' }),
      v({ name: '血量', kind: 'number', init: 200, min: 0, max: 100 }),
      v({ name: '血量', kind: 'number' }),
      v({ name: '阶段数', kind: 'number', stages: [{ from: 0, label: 'a' }] }),
      v({ name: '状态', kind: 'choice', options: ['a'], init: 'b' }),
      v({ name: '表', kind: 'table', dropRowWhenZero: '数量', children: [v({ name: '子', kind: 'group' })] }),
    ];
    const p = problems(bad).join('\n');
    expect(p).toContain('名字不能为空');
    expect(p).toContain('不能有 . / ~');
    expect(p).toContain('不能以 _ 或 $ 开头');
    expect(p).toContain('大于最大值');
    expect(p).toContain('重名');
    expect(p).toContain('阶段只能用在分组里的数字上');
    expect(p).toContain('初始值不在选项里');
    expect(p).toContain('不能再是分组或表格');
    expect(p).toContain('不是这个表格里的数字');
  });
  it('builds starting data with read-only keys prefixed', () => {
    expect(initialData(vars)).toEqual({
      世界: { 时间: '第一天 清晨', 地点: '酒馆' },
      白娅: { 好感度: 10, 心情: '平静', 已婚: false },
      _金钱: 100,
      任务: ['找到钥匙'],
      物品栏: { 面包: { 描述: '普通的面包', 数量: 2 } },
    });
  });
  it('picks stages and escapes pointers', () => {
    const fav = vars[1].children![0];
    expect([stageOf(fav, -5), stageOf(fav, 29), stageOf(fav, 30), stageOf(fav, 100)]).toEqual(['陌生', '陌生', '熟悉', '亲密']);
    expect(pointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
  });
});

describe('zod schema', () => {
  it('accepts the starting data and fills in stage names', () => {
    expect(start().白娅.$好感度阶段).toBe('陌生');
  });
  it('clamps and rounds numbers, then recomputes the stage', () => {
    const d = structuredClone(initialData(vars)) as any;
    d.白娅.好感度 = 150.4;
    d._金钱 = -20;
    const out = schema.parse(d) as any;
    expect(out.白娅.好感度).toBe(100);
    expect(out.白娅.$好感度阶段).toBe('亲密');
    expect(out._金钱).toBe(0);
  });
  it('rejects values of the wrong kind', () => {
    const d = structuredClone(initialData(vars)) as any;
    d.白娅.心情 = '狂喜';
    expect(schema.safeParse(d).success).toBe(false);
  });
  it('fills defaults in new table rows and drops rows that reach 0', () => {
    const d = structuredClone(initialData(vars)) as any;
    d.物品栏.钥匙 = { 数量: 1 };
    d.物品栏.面包.数量 = 0;
    const out = schema.parse(d) as any;
    expect(out.物品栏).toEqual({ 钥匙: { 描述: '', 数量: 1 } });
  });
  it('writes a script that imports the helper and registers the schema', () => {
    const s = schemaScript(vars);
    expect(s).toContain(`import { registerMvuSchema } from '${MVU_ZOD_URL}';`);
    expect(s).toContain('registerMvuSchema(Schema);');
    expect(s).toContain('_金钱: z.coerce.number().transform(v => Math.max(v, 0))');
  });
  it('quotes names that are not plain identifiers', () => {
    const odd = [v({ name: 'HP max', kind: 'number', init: 1 }), v({ name: '"引号"', kind: 'text' })];
    expect(buildSchema(odd).parse({ 'HP max': '3', '"引号"': 'x' })).toEqual({ 'HP max': 3, '"引号"': 'x' });
  });
});

describe('world book texts', () => {
  it('[initvar] is YAML of the starting data', () => {
    expect(YAML.parse(initvarText(vars))).toEqual(initialData(vars));
  });
  it('variable list sends the current stat_data', () => {
    expect(varListText()).toContain('{{format_message_variable::stat_data}}');
  });
  it('update rules describe ranges, stages and read-only variables', () => {
    const r = YAML.parse(updateRulesText(vars)).变量更新规则;
    expect(r.白娅.好感度.范围).toBe('0~100');
    expect(r.白娅.好感度.阶段).toEqual(['0~29：陌生', '30~69：熟悉', '70 以上：亲密']);
    expect(r.白娅.好感度.何时更新).toEqual(['友善互动时 +1~3', '被冒犯时 -5~-10']);
    expect(r.白娅.$好感度阶段).toContain('不要修改');
    expect(r.白娅.心情.类型).toBe('只能是其中之一：平静 / 开心 / 生气');
    expect(r._金钱).toBe('只读，不要修改');
    expect(r.物品栏.删除).toContain('数量降到 0');
  });
  it('output format is valid YAML with examples on real paths', () => {
    const f = YAML.parse(outputFormatText(vars)).变量输出格式;
    expect(f.规则.length).toBeGreaterThan(3);
    expect(f.格式).toContain('<JSONPatch>');
    expect(f.示例).toContain('"path":"/白娅/好感度"');
    expect(f.示例).toContain('"path":"/任务/-"');
    expect(f.示例).not.toContain('_金钱');
    // the example itself must be something the simulator accepts
    const { ops, errors } = extractOps(f.示例);
    expect(errors).toEqual([]);
    expect(applyOps(start(), ops, schema).results.every((r) => r.ok)).toBe(true);
  });
});

describe('simulator', () => {
  const reply = `她笑了笑。
<UpdateVariable>
<Analysis>好感上升，买了钥匙</Analysis>
<JSONPatch>
\`\`\`json
[
  { "op": "delta", "path": "/白娅/好感度", "value": 25 }, // 好感
  { "op": "replace", "path": "/白娅/心情", "value": "狂喜" },
  { "op": "insert", "path": "/任务/-", "value": "去城堡" },
  { "op": "insert", "path": "/物品栏/钥匙", "value": { "数量": 1 } },
  { "op": "delta", "path": "/物品栏/面包/数量", "value": -2 },
  { "op": "replace", "path": "/_金钱", "value": 80 },
  { "op": "jump", "path": "/世界/地点" },
  { "op": "remove", "path": "/不存在" },
]
\`\`\`
</JSONPatch>
</UpdateVariable>`;

  it('reads lenient JSON (fences, comments, trailing commas)', () => {
    const { ops, errors } = extractOps(reply);
    expect(errors).toEqual([]);
    expect(ops).toHaveLength(8);
  });
  it('reports a missing block or broken JSON', () => {
    expect(extractOps('只有正文').errors[0]).toContain('没有找到');
    expect(extractOps('<UpdateVariable><JSONPatch>[{oops</JSONPatch></UpdateVariable>').errors[0]).toContain('不是有效的 JSON');
  });
  it('reads a block cut off at the end of the message', () => {
    expect(extractOps('<UpdateVariable><JSONPatch>[{"op":"delta","path":"/a","value":1}]').ops).toHaveLength(1);
  });
  it('applies each operation, keeps the valid ones and explains the rest', () => {
    const { ops } = extractOps(reply);
    const { data, results } = applyOps(start(), ops, schema) as { data: any; results: ReturnType<typeof applyOps>['results'] };
    expect(results.map((r) => r.ok)).toEqual([true, false, true, true, true, true, false, false]);
    expect(results[1].msg).toContain('MVU 会拒绝');
    expect(results[5].msg).toContain('只读');
    expect(results[6].msg).toContain('不认识的操作');
    expect(results[7].msg).toContain('删不掉');
    expect(data.白娅).toEqual({ 好感度: 35, 心情: '平静', 已婚: false, $好感度阶段: '熟悉' });
    expect(data.任务).toEqual(['找到钥匙', '去城堡']);
    expect(data.物品栏).toEqual({ 钥匙: { 描述: '', 数量: 1 } });
    expect(data._金钱).toBe(80);
  });
  it('handles remove and move', () => {
    const small = [v({ name: '任务', kind: 'list' }), v({ name: '世界', kind: 'group', children: [v({ name: '时间', kind: 'text' }), v({ name: '备注', kind: 'list' })] })];
    const { data, results } = applyOps(
      { 任务: ['a', 'b'], 世界: { 时间: '清晨', 备注: ['x'] } },
      [
        { op: 'remove', path: '/任务/0' },
        { op: 'move', from: '/任务/0', path: '/世界/备注/-' },
        { op: 'move', from: '/世界/时间', path: '/世界/地点' },
      ],
      buildSchema(small),
    ) as any;
    expect(results.map((r: any) => r.ok)).toEqual([true, true, false]);
    expect(results[2].msg).toContain('MVU 会拒绝');
    expect(data).toEqual({ 任务: [], 世界: { 时间: '清晨', 备注: ['x', 'b'] } });
  });
});

describe('regexes', () => {
  const view = compileBar(defaultBar(vars), vars);
  const regexes = mvuRegexes(view, (slot) => `id-${slot}`);
  const byName = (name: string) => regexes.find((r) => r.scriptName === name)!;
  const m = { user: 'User', char: 'Char' };
  const msg = '正文\n<UpdateVariable>\n<Analysis>x</Analysis>\n<JSONPatch>[]</JSONPatch>\n</UpdateVariable>\n\n<StatusPlaceHolderImpl/>';

  it('removes the update block from what the AI sees', () => {
    expect(runScript(byName(REGEX_NAMES.hideUpdate), msg, m).out).toBe('正文\n\n\n<StatusPlaceHolderImpl/>');
    expect(runScript(byName(REGEX_NAMES.hideUpdate), '正文<UpdateVariable>写到一半', m).out).toBe('正文');
  });
  it('folds the block and shows the status bar when displayed', () => {
    const { raw, display } = processText(regexes, msg, defaultSettings());
    expect(raw).toBe(msg);
    expect(display).toContain('<summary>变量更新</summary>');
    expect(display.endsWith(statusBarReplacement(view))).toBe(true);
  });
  it('shows a block that is still being written as in progress', () => {
    const { display } = processText(regexes, '正文\n<UpdateVariable>\n<Analysis>分析中', defaultSettings());
    expect(display).toContain('<summary>变量更新中…</summary>');
    expect(display).not.toContain('<summary>变量更新</summary>');
  });
  it('gives every regex a stable id', () => {
    expect(regexes.map((r) => r.id)).toEqual(['id-regex:hideUpdate', 'id-regex:foldUpdating', 'id-regex:foldUpdate', 'id-regex:statusBar']);
  });
});

describe('status bar', () => {
  // names that would be damaged by ST if they were not escaped
  const nasty = [v({ name: 'a*b"c $1 {{char}} `x` _y_ <b>', kind: 'text' }), ...vars];
  const view = compileBar(defaultBar(nasty), nasty);
  const rep = statusBarReplacement(view);

  it('survives the markdown auto-fix unchanged', () => {
    expect(fixMarkdown(rep)).toBe(rep);
  });
  it('contains nothing the regex replacement or the fence would change', () => {
    const inner = rep.slice('```html\n'.length, -'\n```'.length);
    expect(inner).not.toMatch(/\$\d|\$</);
    expect(inner).not.toContain('{{');
    expect(inner).not.toContain('`');
    expect(JSON.parse(safeJson({ a: 'x"*$_`{{<>' }))).toEqual({ a: 'x"*$_`{{<>' });
  });
  it('reaches the front-end exactly as written after ST formatting', () => {
    const rx = mvuRegexes(view, (s) => s);
    const { display } = processText(rx, '正文\n\n<StatusPlaceHolderImpl/>', defaultSettings());
    const { html } = formatMessage(display, { charName: 'Char', isUser: false, blockExternalMedia: true });
    const box = document.createElement('div');
    box.innerHTML = html;
    expect(box.querySelector('pre code')!.textContent!.trim()).toBe(statusBarHtml(view));
  });

  describe('runtime', () => {
    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    });
    const run = (statData: unknown) => {
      vi.useFakeTimers();
      const html = statusBarHtml(view);
      const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
      document.body.innerHTML = '<div id="sb"></div>';
      const g = globalThis as any;
      g.getCurrentMessageId = () => 3;
      g.getVariables = (o: any) => (o.type === 'message' && o.message_id === 3 && statData ? { stat_data: statData } : {});
      new Function(js)();
      return document.getElementById('sb')!;
    };

    it('draws the variables of this message', () => {
      const d = start();
      d.白娅.好感度 = 50;
      d.白娅.$好感度阶段 = '熟悉';
      const sb = run(d);
      const text = sb.textContent!;
      expect(text).toContain('好感度');
      expect(text).toContain('熟悉');
      expect(text).toContain('第一天 清晨');
      expect(text).toContain('面包');
      expect(text).toContain('找到钥匙');
      expect(text).toContain('a*b"c $1 {{char}} `x` _y_ <b>');
      expect((sb.querySelector('.sb-fill') as HTMLElement).style.width).toBe('50%');
    });
    it('says so when the variables are not there yet', () => {
      expect(run(null).textContent).toContain('变量还没有准备好');
    });
  });
});
