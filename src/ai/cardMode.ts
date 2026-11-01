// The assistant in the MVU card editor: status bar components, colors, variables, card text,
// and the regexes an imported card brings along (its own status bar / beautify, kept on export).
import { useCard } from '../cardStore';
import { normalizeScript, toStExport } from '../lib/importer';
import { newId } from '../lib/id';
import type { RegexScript } from '../lib/types';
import {
  barOf,
  compileBar,
  cssProblems,
  describe,
  FONTS,
  indexVars,
  placementProblem,
  saveBar,
  THEME_COLORS,
  THEME_PRESETS,
  TYPE_LABEL,
  unplacedVars,
  type Bar,
  type BarNode,
  type BarType,
} from '../mvu/bar';
import { drawsStatusBar, OWN_REGEXES, skeleton } from '../mvu/card';
import { eachNode, findVar, insertAt, insertVar, locate, moveTo, newVar, removeVar, updateVar } from '../mvu/tree';
import type { CardProject, VarKind, VarNode } from '../mvu/types';
import { problems as varProblems } from '../mvu/vars';
import { useStore } from '../store';
import { lintReplace } from './lint';
import { previewLog, quote, type AiMode, type Change } from './mode';
import { regexChanges } from './regexMode';
import { bool, num, obj, regexTools, str, tool, ToolError, type Tool } from './tools';

/* ---------- the card's own regexes (inside the imported card) ---------- */

const dataOf = (b: any) => (b?.data && typeof b.data === 'object' ? b.data : b);
const rawList = (p: CardProject): any[] => {
  const l = dataOf(p.base)?.extensions?.regex_scripts;
  return Array.isArray(l) ? l : [];
};
/** a regex without an id gets one from its place, so the AI can point at it */
const rawId = (r: any, i: number) => (typeof r?.id === 'string' && r.id ? r.id : `r${i}`);
const isOwn = (r: any) => OWN_REGEXES.includes(r?.scriptName);

function cardRegexes(p: CardProject): RegexScript[] {
  return rawList(p)
    .map((r, i) => [r, i] as const)
    .filter(([r]) => r && typeof r.findRegex === 'string' && !isOwn(r))
    .map(([r, i]) => ({ ...normalizeScript(r), id: rawId(r, i) }));
}

function saveCardRegexes(p: CardProject, list: RegexScript[]): CardProject {
  const b = p.base ?? skeleton();
  const nested = b.data && typeof b.data === 'object';
  const d = nested ? b.data : b;
  const raw = rawList(p);
  const byId = new Map(raw.map((r, i) => [rawId(r, i), r]));
  const regex_scripts = [...list.map((s) => ({ ...(byId.get(s.id) ?? {}), ...toStExport(s) })), ...raw.filter(isOwn)];
  const d2 = { ...d, extensions: { ...(d.extensions ?? {}), regex_scripts } };
  return { ...p, base: nested ? { ...b, data: d2 } : d2 };
}

/* ---------- status bar ---------- */

const TYPES = Object.keys(TYPE_LABEL) as BarType[];
const STYLE_KEYS = new Set(['style', 'itemStyle', 'headStyle', 'popStyle']);

function editBar(p: CardProject, fn: (b: Bar) => Bar): CardProject {
  const bar = barOf(p);
  const next = fn(bar);
  return next === bar ? p : { ...p, bar: saveBar(p, bar, next) };
}

const nodeOf = (p: CardProject, id: string) => {
  const n = findVar([barOf(p).root], id);
  if (!n) throw new ToolError(`没有 id 为 ${id} 的组件，先用 get_overview 看组件树`);
  return n;
};

/** New ids for a component and everything inside it; checks the types. */
function freshNode(n: any): BarNode {
  if (!n || typeof n !== 'object' || Array.isArray(n)) throw new ToolError('node 要是一个组件对象');
  if (!TYPES.includes(n.type)) throw new ToolError(`type 只能是 ${TYPES.join(' / ')}`);
  const { id: _, children, ...rest } = n;
  return { ...rest, id: newId(), ...(Array.isArray(children) ? { children: children.map(freshNode) } : {}) };
}

/** `set` merged into the component: null removes a key, style objects merge key by key. */
function mergeNode(n: BarNode, set: Record<string, unknown>): BarNode {
  const out: any = { ...n };
  for (const [k, v] of Object.entries(set)) {
    if (k === 'id' || k === 'children') throw new ToolError(`不能用这个工具改 ${k}（加删子组件用 add_component / remove_component / move_component）`);
    if (k === 'type' && v !== n.type) throw new ToolError('不能改组件的类型：删掉再加一个新的');
    if (v === null) delete out[k];
    else if (STYLE_KEYS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const st = { ...(out[k] ?? {}) };
      for (const [sk, sv] of Object.entries(v)) if (sv === null) delete st[sk];
        else st[sk] = sv;
      out[k] = st;
    } else out[k] = v;
  }
  return out;
}

const barProblems = (p: CardProject) => compileBar(barOf(p), p.vars, { allowEdit: p.settings.allowPlayerEdit }).problems;

/* ---------- variables ---------- */

const KINDS: VarKind[] = ['group', 'number', 'text', 'bool', 'choice', 'list', 'table'];
const KIND_LABEL: Record<VarKind, string> = { group: '分组', number: '数字', text: '文字', bool: '是/否', choice: '选项', list: '列表', table: '表格' };

const varOf = (p: CardProject, id: string) => {
  const v = findVar(p.vars, id);
  if (!v) throw new ToolError(`没有 id 为 ${id} 的变量`);
  return v;
};

function varLine(v: VarNode): string {
  const bits: string[] = [KIND_LABEL[v.kind]];
  if (v.min != null || v.max != null) bits.push(`${v.min ?? ''}~${v.max ?? ''}`);
  if (v.options?.length) bits.push(v.options.join('/'));
  if (v.init !== undefined && v.kind !== 'table' && v.kind !== 'group') bits.push(`初始 ${quote(JSON.stringify(v.init), 60)}`);
  if (v.readonly) bits.push('AI 不能改');
  return `[${v.id}] ${v.name}：${bits.join('，')}`;
}

function outline<T extends { id: string; children?: T[] }>(list: T[], line: (n: T) => string, max = 160): string[] {
  const out: string[] = [];
  const go = (l: T[], depth: number) => {
    for (const n of l) {
      if (out.length >= max) return;
      out.push('  '.repeat(depth) + '- ' + line(n));
      if (n.children) go(n.children, depth + 1);
    }
  };
  go(list, 0);
  if (out.length >= max) out.push('  …（太多了，后面的用 get_component 看）');
  return out;
}

const VAR_FIELDS = new Set(['name', 'kind', 'init', 'min', 'max', 'integer', 'options', 'stages', 'rules', 'readonly', 'playerEditable', 'rowName', 'dropRowWhenZero']);

function varPatch(set: any): Partial<VarNode> {
  if (!set || typeof set !== 'object') throw new ToolError('set 要是对象');
  const out: any = {};
  for (const [k, v] of Object.entries(set)) {
    if (!VAR_FIELDS.has(k)) throw new ToolError(`变量没有 ${k} 这一项（能改：${[...VAR_FIELDS].join('、')}）`);
    if (k === 'kind' && !KINDS.includes(v as VarKind)) throw new ToolError(`kind 只能是 ${KINDS.join(' / ')}`);
    if (k === 'rules' && !Array.isArray(v)) throw new ToolError('rules 要是文字列表，一行一条');
    out[k] = v === null ? undefined : v;
  }
  return out;
}

/* ---------- the tools ---------- */

const tools: Tool<CardProject>[] = [
  tool<CardProject>('get_overview', '看整张卡的概况：变量树、状态栏组件树（带 id）、配色、卡里自带的正则', {}, [], (p) => ({ label: '看了整张卡', result: context(p) })),
  tool<CardProject>('get_component', '读一个状态栏组件（连同里面的组件）的完整 JSON', { id: str('组件 id') }, ['id'], (p, a) => {
    const n = nodeOf(p, a.id);
    const at = locate([barOf(p).root], n.id);
    return { label: `看了组件 ${describe(n, indexVars(p.vars))}`, result: { node: n, parent_id: at?.parent?.id ?? null, index: at?.index ?? 0 } };
  }),
  tool<CardProject>(
    'update_component',
    '改一个状态栏组件的属性：set 里只写要改的项；style 等样式对象按项合并；值写 null 表示去掉这一项',
    { id: str('组件 id'), set: obj('要改的属性，例如 {"style":{"color":"@accent","radius":12},"label":"好感"}') },
    ['id', 'set'],
    (p, a) => {
      const n = nodeOf(p, a.id);
      const next = editBar(p, (b) => ({ ...b, root: updateVar([b.root], n.id, mergeNode(n, a.set ?? {}))[0] }));
      return { p: next, label: `改了组件 ${describe(n, indexVars(p.vars))}`, result: { ok: true, problems: barProblems(next) } };
    },
  ),
  tool<CardProject>(
    'add_component',
    '加一个组件（可以带 children）。id 不用写，会自动生成',
    { parent_id: str('放进哪个容器组件'), index: num('放在第几个（从 0 数，默认最后）'), node: obj('组件 JSON，例如 {"type":"bar","bind":{"var":"变量id"},"fill":{"a":"@accent"}}') },
    ['parent_id', 'node'],
    (p, a) => {
      const parent = nodeOf(p, a.parent_id);
      if (!['box', 'repeat', 'menu', 'tabs', 'fold'].includes(parent.type)) throw new ToolError(`${describe(parent, indexVars(p.vars))} 不是容器，不能往里放`);
      const node = freshNode(a.node);
      const why = placementProblem(barOf(p).root, p.vars, node, parent.id);
      if (why) throw new ToolError(why);
      const index = a.index === undefined ? parent.children?.length ?? 0 : Number(a.index);
      const next = editBar(p, (b) => ({ ...b, root: insertAt([b.root], parent.id, index, node)[0] }));
      return { p: next, label: `加了组件 ${describe(node, indexVars(p.vars))}`, result: { id: node.id, node, problems: barProblems(next) } };
    },
  ),
  tool<CardProject>('remove_component', '删掉一个组件（连同里面的）', { id: str('组件 id') }, ['id'], (p, a) => {
    const n = nodeOf(p, a.id);
    if (n.id === barOf(p).root.id) throw new ToolError('最外层的框不能删');
    const next = editBar(p, (b) => ({ ...b, root: removeVar([b.root], n.id)[0] }));
    return { p: next, label: `删了组件 ${describe(n, indexVars(p.vars))}`, result: { ok: true } };
  }),
  tool<CardProject>(
    'move_component',
    '把组件移到另一个容器里，或调整顺序',
    { id: str('组件 id'), parent_id: str('移到哪个容器'), index: num('放在第几个（从 0 数）') },
    ['id', 'parent_id', 'index'],
    (p, a) => {
      const n = nodeOf(p, a.id);
      nodeOf(p, a.parent_id);
      const why = placementProblem(barOf(p).root, p.vars, n, a.parent_id);
      if (why) throw new ToolError(why);
      const next = editBar(p, (b) => ({ ...b, root: moveTo([b.root], n.id, a.parent_id, Number(a.index) || 0)[0] }));
      if (next === p) throw new ToolError('没有移动（目标位置和现在一样，或者想移进它自己里面）');
      return { p: next, label: `移动了组件 ${describe(n, indexVars(p.vars))}`, result: { ok: true } };
    },
  ),
  tool<CardProject>(
    'set_theme',
    `改状态栏的整体配色和字体。preset 选一套现成的配色（${THEME_PRESETS.map((t) => t.name).join('、')}）；colors 单独改某几种颜色（${THEME_COLORS.join('、')}）；font 字体（${Object.keys(FONTS).join('、')}）；size 基础字号；noAnim 关掉所有动画`,
    { preset: str('现成配色的名字'), colors: obj('例如 {"accent":"#ff7a59","bg":"#1b1420"}'), font: str('字体'), size: num('基础字号 px'), noAnim: bool('关掉所有动画') },
    [],
    (p, a) => {
      const next = editBar(p, (b) => {
        let theme = { ...b.theme };
        if (a.preset) {
          const t = THEME_PRESETS.find((x) => x.name === a.preset);
          if (!t) throw new ToolError(`没有叫「${a.preset}」的配色`);
          theme = { ...theme, ...t.colors, preset: t.name };
        }
        for (const [k, v] of Object.entries(a.colors ?? {})) {
          if (!(THEME_COLORS as readonly string[]).includes(k)) throw new ToolError(`主题色只有 ${THEME_COLORS.join('、')}`);
          if (typeof v !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(v)) throw new ToolError(`颜色 ${k} 要写成 #rrggbb`);
          (theme as any)[k] = v;
          theme.preset = '自定义';
        }
        if (a.font !== undefined) {
          if (!(a.font in FONTS)) throw new ToolError(`字体只有 ${Object.keys(FONTS).join('、')}`);
          theme.font = a.font;
        }
        if (a.size !== undefined) theme.size = Math.max(10, Math.min(24, Number(a.size) || 14));
        if (a.noAnim !== undefined) theme.noAnim = !!a.noAnim;
        return { ...b, theme };
      });
      return { p: next, label: '改了状态栏的配色', result: { ok: true, theme: barOf(next).theme } };
    },
  ),
  tool<CardProject>(
    'set_custom_css',
    '整段换掉状态栏的自定义 CSS（进阶；空字符串表示去掉）。给组件设 tag 类名后可以用 .类名 选中它。组件属性能做到的先用属性',
    { css: str('CSS 全文') },
    ['css'],
    (p, a) => {
      const css = String(a.css ?? '');
      const next = editBar(p, (b) => {
        const { css: _, ...rest } = b;
        return css.trim() ? { ...rest, css } : rest;
      });
      return { p: next, label: '改了状态栏的自定义 CSS', result: { ok: true, warnings: cssProblems(css) } };
    },
  ),
  tool<CardProject>('get_variable', '读一个变量的完整设置（JSON）', { id: str('变量 id') }, ['id'], (p, a) => {
    const v = varOf(p, a.id);
    return { label: `看了变量「${v.name}」`, result: v };
  }),
  tool<CardProject>(
    'update_variable',
    '改一个变量：set 里写要改的项（name、kind、init、min、max、integer、options、stages、rules、readonly、playerEditable、rowName、dropRowWhenZero），null 表示去掉',
    { id: str('变量 id'), set: obj('要改的项') },
    ['id', 'set'],
    (p, a) => {
      const v = varOf(p, a.id);
      const vars = updateVar(p.vars, v.id, varPatch(a.set));
      const next = { ...p, vars };
      return { p: next, label: `改了变量「${v.name}」`, result: { ok: true, problems: varProblems(vars) } };
    },
  ),
  tool<CardProject>(
    'add_variable',
    '加一个变量。默认放在最外层最后；into_id 放进某个分组或表格，after_id 放在某个变量后面。状态栏是自动排版时会自动显示出来，否则要自己加组件',
    { node: obj('例如 {"name":"好感度","kind":"number","init":0,"min":0,"max":100,"rules":["对方被帮助时 +1~3"]}'), into_id: str('放进哪个分组或表格'), after_id: str('放在哪个变量后面') },
    ['node'],
    (p, a) => {
      const n = a.node ?? {};
      if (!KINDS.includes(n.kind)) throw new ToolError(`kind 只能是 ${KINDS.join(' / ')}`);
      const { children: _, ...rest } = n;
      const v: VarNode = { ...newVar(n.kind), ...varPatch(rest) };
      if (a.into_id) varOf(p, a.into_id);
      const vars = insertVar(p.vars, v, { intoId: a.into_id || null, afterId: a.after_id || null });
      return { p: { ...p, vars }, label: `加了变量「${v.name}」`, result: { id: v.id, problems: varProblems(vars) } };
    },
  ),
  tool<CardProject>('remove_variable', '删掉一个变量（连同里面的）', { id: str('变量 id') }, ['id'], (p, a) => {
    const v = varOf(p, a.id);
    return { p: { ...p, vars: removeVar(p.vars, v.id) }, label: `删了变量「${v.name}」`, result: { ok: true } };
  }),
  tool<CardProject>(
    'update_card_info',
    '改角色卡的文字：名字、描述、性格、场景、开场白（greetings 是整个列表，第一条是首条开场白）、作者备注。只给要改的项',
    { name: str('名字'), description: str('描述'), personality: str('性格'), scenario: str('场景'), greetings: { type: 'array', items: { type: 'string' }, description: '全部开场白' }, creatorNotes: str('作者备注') },
    [],
    (p, a) => {
      const card = { ...p.card };
      const done: string[] = [];
      for (const k of ['name', 'description', 'personality', 'scenario', 'creatorNotes'] as const)
        if (typeof a[k] === 'string') {
          card[k] = a[k];
          done.push(k);
        }
      if (Array.isArray(a.greetings)) {
        card.greetings = a.greetings.map(String);
        done.push('greetings');
      }
      if (!done.length) throw new ToolError('没有给要改的项');
      return { p: { ...p, card }, label: '改了角色卡的文字', result: { ok: true, changed: done } };
    },
  ),
  ...regexTools<CardProject>(
    {
      list: cardRegexes,
      save: saveCardRegexes,
      extra: (p, s) => {
        const raw = rawList(p).find((r, i) => rawId(r, i) === s.id);
        return { draws_status_bar: drawsStatusBar(raw), replaced_on_export: (p.takeover?.regexes ?? []).includes(s.id) };
      },
    },
    { list: 'list_card_regexes', read: 'read_card_regex', update: 'update_card_regex', edit: 'edit_card_regex_text', add: 'add_card_regex', remove: 'delete_card_regex', move: 'move_card_regex' },
    '卡里自带的正则',
  ),
  tool<CardProject>('check', '检查草稿：状态栏里显示不了的组件、变量设置的问题、没放上状态栏的变量、自定义 CSS 和卡里正则的问题。改完一定要调用一次', {}, [], (p) => {
    const bar = barOf(p);
    const regex = cardRegexes(p)
      .map((s) => ({ name: s.scriptName, warnings: lintReplace(s.replaceString) }))
      .filter((x) => x.warnings.length);
    return {
      label: '检查了一遍',
      result: {
        status_bar_problems: barProblems(p),
        variable_problems: varProblems(p.vars),
        not_on_status_bar: p.textBar?.on ? undefined : unplacedVars(bar, p.vars).map((v) => v.name),
        css_warnings: bar.css ? cssProblems(bar.css) : undefined,
        card_regex_warnings: regex.length ? regex : undefined,
        preview_errors: previewLog.mvu.length ? previewLog.mvu.slice(0, 10) : undefined,
      },
    };
  }),
];

/* ---------- what the AI sees ---------- */

function context(p: CardProject): string {
  const bar = barOf(p);
  const idx = indexVars(p.vars);
  const regs = cardRegexes(p);
  const sel = useCard.getState().barSel;
  const selNode = sel ? findVar([bar.root], sel) : null;
  const t = bar.theme;
  const built = useCard.getState().builder;
  const lines = [
    built
      ? `现在做的不是角色卡，而是一条正则美化「${built.name}」：AI 在回复里写一个 <${p.card.name}> 块，一行一个「名字：内容」，正则把它换成这里排出来的状态栏（一张前端卡片）。变量就是这些字段：只能是 number/text/choice/bool/list，不能嵌套，没有 MVU，玩家也不能改；init 是示例值，rules 是写给 AI 的说明。角色卡、开场白、世界书、修改按钮都用不到，标签就是角色名（card.name）。`
      : `角色卡「${p.card.name}」，开场白 ${p.card.greetings.length} 条。${p.base ? '是导入的卡（没由工坊生成的部分导出时原样保留）。' : '是在工坊里新建的。'}`,
    '',
    p.vars.length ? '变量：' : '还没有变量。',
    ...outline(p.vars, varLine),
    '',
    `状态栏：${p.bar?.root ? '作者排过版' : '自动排版（还没手动改过，改任何组件后就变成手动）'}；配色「${t.preset}」（${THEME_COLORS.map((k) => `${k} ${t[k]}`).join('，')}），字体 ${t.font}，字号 ${t.size}${t.noAnim ? '，动画已关' : ''}${bar.css ? `；自定义 CSS ${bar.css.length} 字` : ''}${p.textBar?.on ? '；现在用的是「纯文字状态栏」，组件状态栏不显示' : ''}。`,
    '组件树：',
    ...outline([bar.root], (n) => `[${n.id}] ${describe(n, idx)}${n.type === 'box' && n.dir ? `（${n.dir}）` : ''}${n.hidden ? '（开始时隐藏）' : ''}`),
    selNode ? `\n用户选中的组件：[${selNode.id}] ${describe(selNode, idx)}` : '',
    regs.length ? '\n卡里自带的正则（导出时保留，用 *_card_regex 工具改）：' : '',
    ...regs.map((r) => `- [${r.id}] ${r.scriptName}${r.disabled ? '（已禁用）' : ''}，替换内容 ${r.replaceString.length} 字${/```html/i.test(r.replaceString) ? '，是前端卡' : ''}`),
    previewLog.mvu.length ? `\n预览最近报的错：\n${previewLog.mvu.slice(0, 8).join('\n')}` : '',
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

const INTRO = `用户在「MVU 角色卡」模式：做一张带变量（MVU，AI 用 JSONPatch 更新）和状态栏的角色卡。状态栏不是手写 HTML，而是一棵组件树（JSON），工坊导出时自动生成正则和脚本，不要去改生成出来的东西，用组件工具改。

组件 { id, type, style?, children?, …其他属性 }：
- box 框：dir col/row/grid/free，cols，gap；放在 tabs 里时 title 是标签名
  dir free = 自由摆放：freeW/freeH 是设计尺寸（像素，默认 600×200），每个子组件写 at {x, y, w?, h?}（相对框左上角的像素，w/h 不写 = 按内容），整块按宽度等比缩放；stackBelow（像素）：比它窄时改成从上到下一列排
- repeat 每项一张：bind 一个表格或列表变量，children 是每一项的样子，inner row/col，emptyText
  表格的 repeat 里：bind {var: 表格id, part: "name"} 显示行名，bind {var: 字段id} 显示这一行的字段；列表的 repeat 里 bind {var: 列表id, part: "item"} 显示每一项
- text 文字：text
- value 变量值：bind {var: 变量id}，label（不写 = 变量名，"" = 不显示），colon，icon，prefix，suffix，empty，show value/stage/both，pill，valColor，valSize，valBold，listAs chips/text
- bar 进度条：bind，min，max，num after/inside/none，showMax，fill {a, b?, angle?}，track，height，barLook line/seg/ring/icons，count，sym，grow
- divider 分隔线：line solid/dashed/dotted/fade，lineColor，lineW，text
- image 图片：src（https 或 data:image），bind + imgMap {值: 图片}，imgW，imgH，fit cover/contain，circle
- button 按钮：text，icon，action，place left/center/right/full
- menu 菜单：text，icon，children 只能是 button / menu
- tabs 标签页：children 只能是 box，tabLook line/pill/card，tabColor，start
- fold 折叠块：text，icon，closed，headStyle
- 任何组件：hidden（开始时隐藏），tag（类名，给自定义 CSS 用）
- box / text / value / bar / button / image：pick true = 玩家点一下选中它（同一层一次只选一个，再点取消），选中时用 style.sel 的颜色；repeat 上的 pick 是让里面的每一项能选，颜色写在 itemStyle.sel
- value / bar：cases [{at, color?, icon?, text?}] 按值换颜色、图标、文字（数字从 at 往上生效，smooth 渐变）；diff arrow/num/both 和上一楼比；fmt {dp, comma, div, pct, units}
- action：{do:"edit"} 打开修改变量的表单；{do:"toggle", target: 组件id}；{do:"page", target: 标签页组件id, page: 序号}；{do:"say", text, send}
style：color，bg {a, b?, angle?}，size，bold，italic，align，pad，padX，radius，borderW，borderColor，borderStyle，borderSide all/left/top/bottom，shadow soft/float/glow/inset，width auto/25/33/50/66/75/100，opacity，textGrad，font，ls，textFx shadow/glow/outline/lift，borderGrad，anim breathe/float/beat/blink/spin/flow，animSec，enter fade/up/zoom/left，hover grow/lift/bright，hl（顶部高光线颜色）+ hlW，glow（发光颜色）+ glowR，sel {bg, border, hl, color, glow, hover}（选中时的颜色；hover true = 鼠标放上去也用）
style.shape 多边形：[{x:{f,o}, y:{f,o}, p?}]，按顺时针列出各个角，f 是占宽（高）的比例 0–1，o 是再加减的像素，p:1 表示这个点只按比例。比如盾牌 [{x:{f:0,o:0},y:{f:0,o:0}}, {x:{f:1,o:0},y:{f:0,o:0}}, {x:{f:1,o:0},y:{f:1,o:-14}}, {x:{f:0.5,o:0},y:{f:1,o:0}}, {x:{f:0,o:0},y:{f:1,o:-14}}]。有形状时 borderW / borderColor / borderGrad 沿着形状描边，radius 不起作用；图片和分隔线不能有形状
颜色写 #rrggbb / #rrggbbaa，或主题色 @bg @card @line @text @dim @accent @accent2（跟着整体配色变，优先用主题色）。

变量 { id, name, kind group/number/text/bool/choice/list/table, init, min, max, integer, options, stages [{from, label}], rules（一行一条，写何时怎么变）, readonly, playerEditable, children（分组的子变量 / 表格每行的字段）, rowName, dropRowWhenZero }。

导入的卡可能自带状态栏或美化（常常是 \`\`\`html 前端卡写的界面），它们在「卡里自带的正则」里，用 *_card_regex 工具改，改法和酒馆正则一样。`;

/* ---------- review ---------- */

const plain = (n: any) => {
  const { children: _, ...rest } = n ?? {};
  return JSON.stringify(rest, null, 1);
};

function byId<T extends { id: string; children?: T[] }>(list: T[]) {
  return new Map([...eachNode(list)].map((n) => [n.id, n]));
}

export function cardChanges(a: CardProject, b: CardProject): Change[] {
  const out: Change[] = [];
  for (const [k, label] of [['name', '角色名'], ['description', '描述'], ['personality', '性格'], ['scenario', '场景'], ['creatorNotes', '作者备注']] as const)
    if (a.card[k] !== b.card[k]) out.push({ title: label, diff: { a: a.card[k], b: b.card[k] } });
  if (JSON.stringify(a.card.greetings) !== JSON.stringify(b.card.greetings))
    out.push({ title: '开场白', diff: { a: a.card.greetings.join('\n\n———\n\n'), b: b.card.greetings.join('\n\n———\n\n') } });

  // variables
  const va = byId(a.vars);
  const vb = byId(b.vars);
  for (const [id, v] of vb) {
    const o = va.get(id);
    if (!o) out.push({ title: `加了变量「${v.name}」`, diff: { a: '', b: plain(v) } });
    else if (plain(o) !== plain(v)) out.push({ title: `变量「${v.name}」`, diff: { a: plain(o), b: plain(v) } });
  }
  for (const [id, v] of va) if (!vb.has(id)) out.push({ title: `删了变量「${v.name}」` });
  if (outlineIds(a.vars) !== outlineIds(b.vars) && [...vb.keys()].every((id) => va.has(id))) out.push({ title: '调整了变量的位置' });

  // status bar
  const ba = barOf(a);
  const bb = barOf(b);
  const themeKeys = Object.keys({ ...ba.theme, ...bb.theme }).filter((k) => (ba.theme as any)[k] !== (bb.theme as any)[k]);
  if (themeKeys.length) out.push({ title: `状态栏配色：${themeKeys.map((k) => `${k} ${(ba.theme as any)[k] ?? '无'} → ${(bb.theme as any)[k] ?? '无'}`).join('；')}` });
  if ((ba.css ?? '') !== (bb.css ?? '')) out.push({ title: '状态栏的自定义 CSS', diff: { a: ba.css ?? '', b: bb.css ?? '' } });
  const idx = indexVars(b.vars);
  const na = byId([ba.root]);
  const nb = byId([bb.root]);
  for (const [id, n] of nb) {
    const o = na.get(id);
    if (!o) out.push({ title: `加了组件 ${describe(n, idx)}`, diff: { a: '', b: plain(n) } });
    else if (plain(o) !== plain(n)) out.push({ title: `组件 ${describe(n, idx)}`, diff: { a: plain(o), b: plain(n) } });
  }
  for (const [id, n] of na) if (!nb.has(id)) out.push({ title: `删了组件 ${describe(n, indexVars(a.vars))}` });
  if (outlineIds([ba.root]) !== outlineIds([bb.root]) && [...nb.keys()].every((id) => na.has(id)) && [...na.keys()].every((id) => nb.has(id))) out.push({ title: '调整了组件的位置' });

  out.push(...regexChanges(cardRegexes(a), cardRegexes(b), '卡里的'));
  return out;
}

const outlineIds = <T extends { id: string; children?: T[] }>(l: T[]): string => l.map((n) => n.id + (n.children ? `(${outlineIds(n.children)})` : '')).join(',');

export const cardMode: AiMode<CardProject> = {
  id: 'mvu',
  intro: INTRO,
  tools,
  context,
  current: () => useCard.getState().project,
  same: (a, b) => a === b,
  apply: (next) => useCard.getState().edit(() => next),
  revert: (applied) => {
    const st = useCard.getState();
    if (st.project !== applied) return false;
    st.undo();
    return true;
  },
  changes: cardChanges,
  macros: () => ({ user: useStore.getState().project.settings.user, char: useCard.getState().project.card.name }),
};
