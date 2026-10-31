import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { gradientPng, readChunks, readPngCard, writePngCard, crc32 } from '../lib/png';
import { buildCard, buildCardPng, ENTRY_NAMES, EMBED_KEY, importCard, importCardFile, inferVars, newCardProject, SCRIPT_NAMES, stableId } from './card';
import { REGEX_NAMES } from './regexes';
import type { CardProject, VarNode } from './types';
import { initialData } from './vars';

const vars: VarNode[] = [
  {
    id: 'g',
    name: '白娅',
    kind: 'group',
    rules: [],
    children: [{ id: 'f', name: '好感度', kind: 'number', init: 10, min: 0, max: 100, integer: true, stages: [{ from: 0, label: '陌生' }, { from: 50, label: '熟悉' }], rules: ['友善 +1'] }],
  },
  { id: 'm', name: '金钱', kind: 'number', init: 5, readonly: true, rules: [] },
];

const project = (): CardProject => {
  const p = newCardProject();
  p.id = 'project-1';
  p.card = { ...p.card, name: '白娅', description: '描述', greetings: ['你好', '另一个开场'], creator: '作者', tags: ['MVU'] };
  p.vars = vars;
  return p;
};

/** A card made elsewhere, with its own MVU parts and things that must survive. */
const foreignCard = () => ({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  name: '旧卡',
  data: {
    name: '旧卡',
    description: '旧描述',
    first_mes: '开场',
    alternate_greetings: ['开场二'],
    creator_notes: '说明',
    tags: ['a'],
    extensions: {
      custom_field: 42,
      regex_scripts: [
        { id: 'r1', scriptName: '隐藏变量', findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g', replaceString: '' },
        { id: 'r2', scriptName: '作者的美化', findRegex: '/<b>/g', replaceString: '' },
      ],
      tavern_helper: {
        scripts: [
          { type: 'script', id: 's1', name: 'mvu', enabled: true, content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';" },
          { type: 'folder', id: 'f1', name: '文件夹', enabled: true, scripts: [{ type: 'script', id: 's2', name: '结构', enabled: true, content: 'registerMvuSchema(Schema)' }, { type: 'script', id: 's3', name: '音乐', enabled: true, content: 'play()' }] },
        ],
        variables: { x: 1 },
      },
    },
    character_book: {
      name: '旧卡的书',
      entries: [
        { id: 0, comment: '[InitVar]初始化', content: '```yaml\n世界:\n  时间: 清晨\n_金钱: 3\n物品栏:\n  面包: {数量: 1, 描述: 软}\n  水: {数量: 2, 描述: 清}\n任务: [找钥匙]\n$阶段: x\n```', enabled: false },
        { id: 1, comment: '[mvu_update]规则', content: '...' },
        { id: 2, comment: '状态', content: '{{format_message_variable::stat_data}}' },
        { id: 7, comment: '世界观', content: '很久以前' },
      ],
    },
  },
});

describe('png', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32([new TextEncoder().encode('123456789')])).toBe(0xcbf43926);
  });
  it('writes card data that reads back, replacing old card data', async () => {
    const png = await gradientPng(4, 6, [0, 0, 0], [255, 255, 255]);
    expect(readChunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const once = writePngCard(png, { name: '一', data: { name: '一' } });
    const twice = writePngCard(once, { name: '二', data: { name: '二' } });
    expect(readChunks(twice).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'tEXt', 'tEXt', 'IEND']);
    expect(readPngCard(twice)).toEqual({ name: '二', data: { name: '二' }, spec: 'chara_card_v3', spec_version: '3.0' });
  });
});

describe('export', () => {
  const card = buildCard(project());
  const d = card.data;

  it('fills in the card info', () => {
    expect(card.spec).toBe('chara_card_v3');
    expect(d.name).toBe('白娅');
    expect(d.first_mes).toBe('你好');
    expect(d.alternate_greetings).toEqual(['另一个开场']);
    expect(card.first_mes).toBe('你好');
    expect(d.creator).toBe('作者');
  });
  it('adds the world book entries MVU needs', () => {
    const byName = Object.fromEntries(d.character_book.entries.map((e: any) => [e.comment, e]));
    const init = byName[ENTRY_NAMES.initvar];
    expect(init.enabled).toBe(false);
    expect(YAML.parse(init.content)).toEqual(initialData(vars));
    expect(byName[ENTRY_NAMES.varList].content).toContain('{{format_message_variable::stat_data}}');
    for (const name of [ENTRY_NAMES.varList, ENTRY_NAMES.rules, ENTRY_NAMES.format]) {
      expect(byName[name]).toMatchObject({ constant: true, enabled: true, extensions: { position: 4, depth: 0, role: 0 } });
    }
    expect(d.character_book.entries.map((e: any) => e.id)).toEqual([0, 1, 2, 3]);
  });
  it('adds the regexes in ST format and the two scripts', () => {
    expect(d.extensions.regex_scripts.map((r: any) => r.scriptName)).toEqual(Object.values(REGEX_NAMES));
    expect(Object.keys(d.extensions.regex_scripts[0]).sort()).toEqual(
      ['id', 'scriptName', 'findRegex', 'replaceString', 'trimStrings', 'placement', 'disabled', 'markdownOnly', 'promptOnly', 'runOnEdit', 'substituteRegex', 'minDepth', 'maxDepth'].sort(),
    );
    const scripts = d.extensions.tavern_helper.scripts;
    expect(scripts.map((s: any) => s.name)).toEqual([SCRIPT_NAMES.mvu, SCRIPT_NAMES.schema]);
    expect(scripts[0].content).toContain('MagVarUpdate/artifact/bundle.js');
    expect(scripts[1].content).toContain('registerMvuSchema(Schema)');
  });
  it('keeps ids stable between exports', () => {
    const again = buildCard(project()).data;
    expect(again.extensions.regex_scripts.map((r: any) => r.id)).toEqual(d.extensions.regex_scripts.map((r: any) => r.id));
    expect(again.extensions.tavern_helper.scripts[0].id).toBe(d.extensions.tavern_helper.scripts[0].id);
    expect(stableId('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableId('a')).not.toBe(stableId('b'));
  });
  it('round-trips through its own export, replacing instead of duplicating', async () => {
    const png = await buildCardPng(project());
    const back = importCardFile('白娅.png', png);
    expect(back.notes[0]).toContain('完整恢复');
    expect(back.project.vars).toEqual(vars);
    expect(back.project.id).toBe('project-1');
    expect(back.project.card.greetings).toEqual(['你好', '另一个开场']);
    expect(back.project.takeover).toEqual({ entries: [], regexes: [], scripts: [] });
    const again = buildCard(back.project).data;
    expect(again.character_book.entries).toHaveLength(4);
    expect(again.extensions.regex_scripts).toHaveLength(4);
    expect(again.extensions.tavern_helper.scripts).toHaveLength(2);
    expect(again.extensions.regex_scripts).toEqual(d.extensions.regex_scripts);
  });
  it('leaves the project copy out when asked', () => {
    const p = project();
    p.settings.embedProject = false;
    expect(buildCard(p).data.extensions[EMBED_KEY]).toBeUndefined();
  });
});

describe('import of a card made elsewhere', () => {
  const { project: p, notes } = importCard(foreignCard());

  it('reads the card info', () => {
    expect(p.card.name).toBe('旧卡');
    expect(p.card.greetings).toEqual(['开场', '开场二']);
    expect(p.card.creatorNotes).toBe('说明');
  });
  it('guesses the variables from [initvar] (any case, with a code fence)', () => {
    const shape = (list: VarNode[]): unknown => list.map((v) => [v.name, v.kind, v.readonly ?? false, v.children ? shape(v.children) : null]);
    expect(shape(p.vars)).toEqual([
      ['世界', 'group', false, [['时间', 'text', false, null]]],
      ['金钱', 'number', true, null],
      ['物品栏', 'table', false, [['数量', 'number', false, null], ['描述', 'text', false, null]]],
      ['任务', 'list', false, null],
    ]);
    expect(initialData(p.vars)).toEqual({ 世界: { 时间: '清晨' }, _金钱: 3, 物品栏: { 面包: { 数量: 1, 描述: '软' }, 水: { 数量: 2, 描述: '清' } }, 任务: ['找钥匙'] });
    expect(notes.join('\n')).toContain('$阶段');
  });
  it('marks the old MVU parts to be replaced and keeps everything else', () => {
    expect(p.takeover).toEqual({ entries: [0, 1, 2], regexes: ['r1'], scripts: ['s1', 's2'] });
    const out = buildCard(p);
    const d = out.data;
    expect(d.extensions.custom_field).toBe(42);
    expect(d.extensions.tavern_helper.variables).toEqual({ x: 1 });
    expect(d.character_book.name).toBe('旧卡的书');
    expect(d.character_book.entries.map((e: any) => [e.id, e.comment])).toEqual([
      [7, '世界观'],
      [8, ENTRY_NAMES.initvar],
      [9, ENTRY_NAMES.varList],
      [10, ENTRY_NAMES.rules],
      [11, ENTRY_NAMES.format],
    ]);
    expect(d.extensions.regex_scripts.map((r: any) => r.scriptName)).toEqual(['作者的美化', ...Object.values(REGEX_NAMES)]);
    const scripts = d.extensions.tavern_helper.scripts;
    expect(scripts.map((s: any) => s.name)).toEqual([SCRIPT_NAMES.mvu, SCRIPT_NAMES.schema, '文件夹']);
    expect(scripts[2].scripts.map((s: any) => s.id)).toEqual(['s3']);
  });
});

describe('inferVars', () => {
  it('treats a single nested object as a group and says so', () => {
    const notes: string[] = [];
    const v = inferVars({ 角色: { 白娅: { 好感度: 1 } }, 空: {}, 无: null, 列表: [1, 'a'] }, '', notes);
    expect(v.map((x) => x.kind)).toEqual(['group', 'table', 'text', 'list']);
    expect(notes.join('\n')).toMatch(/角色：已当作「分组」导入/);
    expect(notes.join('\n')).toMatch(/空：是空的/);
    expect(notes.join('\n')).toMatch(/列表：列表里有不是文字的内容/);
  });
});
