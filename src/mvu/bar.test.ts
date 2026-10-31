import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixMarkdown } from '../lib/stformat';
import {
  barOf,
  compileBar,
  cssColor,
  defaultBar,
  describe as describeNode,
  indexVars,
  newNode,
  nodesForVar,
  placementProblem,
  scopeAt,
  unplacedVars,
  saveBar,
  type Bar,
  type BarNode,
  type SavedBar,
} from './bar';
import { buildCard, importCard, newCardProject } from './card';
import { buildSchema } from './schema';
import { editorHtml, statusBarHtml, statusBarReplacement } from './statusbar';
import { TEMPLATES } from './templates';
import { eachNode, findVar, insertAt, moveTo, updateVar } from './tree';
import type { VarNode } from './types';
import { initialData } from './vars';

let n = 0;
const v = (p: Partial<VarNode> & Pick<VarNode, 'name' | 'kind'>): VarNode => ({ id: `v${++n}`, rules: [], ...p });

const 好感度 = v({ name: '好感度', kind: 'number', init: 45, min: 0, max: 100, stages: [{ from: 0, label: '陌生' }, { from: 40, label: '朋友' }] });
const 已婚 = v({ name: '已婚', kind: 'bool', init: true });
const 想法 = v({ name: '想法', kind: 'text', init: '' });
const 白娅 = v({ name: '白娅', kind: 'group', children: [好感度, 已婚, 想法] });
const 任务 = v({ name: '任务', kind: 'list', init: ['找钥匙', '见老板'] });
const 数量 = v({ name: '数量', kind: 'number', init: 1, min: 0 });
const 描述 = v({ name: '描述', kind: 'text', init: '' });
const 物品栏 = v({ name: '物品栏', kind: 'table', rowName: '物品', init: { 面包: { 数量: 2, 描述: '香' } }, children: [数量, 描述] });
const 空表 = v({ name: '技能', kind: 'table', init: {}, children: [v({ name: '等级', kind: 'number', init: 1 })] });
const vars = [白娅, 任务, 物品栏, 空表];

const data = () => buildSchema(vars).parse(initialData(vars)) as Record<string, any>;
const bar = (children: BarNode[]): Bar => ({ ...defaultBar([]), root: { id: 'root', type: 'box', dir: 'col', children } });

/** Runs the exported runtime in jsdom and returns what it drew. */
function draw(b: Bar, statData: unknown) {
  vi.useFakeTimers();
  const html = statusBarHtml(compileBar(b, vars));
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  document.body.innerHTML = '<div id="sb"></div>';
  const g = globalThis as any;
  g.getCurrentMessageId = () => 0;
  g.getVariables = () => ({ stat_data: statData });
  new Function(js)();
  return document.getElementById('sb')!;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('default status bar', () => {
  it('compiles every template without problems', () => {
    for (const t of TEMPLATES) {
      const vs = t.build();
      expect(compileBar(defaultBar(vs), vs).problems, t.name).toEqual([]);
    }
  });
  it('has the same ids every time, so the selection survives until the author changes something', () => {
    expect(defaultBar(vars)).toEqual(defaultBar(vars));
    expect(barOf({ vars })).toEqual(defaultBar(vars));
  });
  it('shows a number with a range as a bar, with its stage', () => {
    const node = nodesForVar(好感度);
    expect(node).toMatchObject({ type: 'bar', bind: { var: 好感度.id }, showStage: true });
    expect(draw(bar([node]), data()).textContent).toBe('好感度45朋友');
    const sb2 = draw(defaultBar(vars), data());
    expect(sb2.textContent).toContain('朋友');
    expect((sb2.querySelector('.sb-fill') as HTMLElement).style.width).toBe('45%');
  });
  it('lists table rows with their fields', () => {
    const text = draw(defaultBar(vars), data()).textContent!;
    expect(text).toContain('面包');
    expect(text).toContain('数量：2');
    expect(text).toContain('暂无');
    expect(text).toContain('找钥匙');
  });
});

describe('bindings', () => {
  it('follows a renamed variable', () => {
    const renamed = vars.map((x) => (x.id === 任务.id ? { ...x, name: '待办' } : x));
    const view = JSON.stringify(compileBar(bar([nodesForVar(任务)]), renamed).view);
    expect(view).toContain('待办');
    expect(view).not.toContain('任务');
  });
  it('drops components whose variable is gone, and says so', () => {
    const c = compileBar(bar([{ id: 'x', type: 'value', bind: { var: 'gone' } }]), vars);
    expect(c.problems).toEqual(['变量值：绑定的变量已经删掉了']);
    expect((c.view as any).k).toEqual([]);
    // the canvas still shows it, so it can be picked and fixed
    const e = compileBar(bar([{ id: 'x', type: 'value', bind: { var: 'gone' } }]), vars, { edit: true });
    expect((e.view as any).k[0]).toMatchObject({ i: 'x', bad: '绑定的变量已经删掉了' });
  });
  it('only lets table fields and row names inside a repeat of their table', () => {
    const field: BarNode = { id: 'f', type: 'value', bind: { var: 数量.id } };
    const rows: BarNode = { id: 'rep', type: 'repeat', bind: { var: 物品栏.id }, children: [] };
    const b = bar([rows]);
    expect(placementProblem(b.root, vars, field, 'root')).toContain('只能放进「物品栏」的「每项一张」里面');
    expect(placementProblem(b.root, vars, field, 'rep')).toBeNull();
    expect(placementProblem(b.root, vars, { id: 'n', type: 'value', bind: { var: 物品栏.id, part: 'name' } }, 'root')).not.toBeNull();
    expect(placementProblem(b.root, vars, { id: 'n', type: 'value', bind: { var: 任务.id, part: 'item' } }, 'rep')).not.toBeNull();
    // a whole block (table title + repeat) can go anywhere
    expect(placementProblem(b.root, vars, nodesForVar(物品栏), 'root')).toBeNull();
    expect(scopeAt(b.root, 'rep')).toEqual([物品栏.id]);
  });
  it('picks variables that fit when a component comes from the palette', () => {
    expect(newNode('bar', vars).bind?.var).toBe(好感度.id);
    expect(newNode('value', vars, [物品栏.id]).bind?.var).toBe(数量.id);
    expect(newNode('bar', vars, [物品栏.id]).bind?.var).toBe(数量.id);
    expect(newNode('repeat', vars).bind?.var).toBe(物品栏.id);
  });
  it('knows which variables are not on the status bar yet', () => {
    expect(unplacedVars(defaultBar(vars), vars)).toEqual([]);
    expect(unplacedVars(bar([nodesForVar(好感度)]), vars).map((x) => x.name)).toEqual(['已婚', '想法', '任务', '物品栏', '技能']);
  });
  it('describes components in plain words', () => {
    const idx = indexVars(vars);
    expect(describeNode(nodesForVar(好感度), idx)).toBe('进度条「好感度」');
    expect(describeNode({ id: 'x', type: 'value', bind: { var: 物品栏.id, part: 'name' } }, idx)).toBe('变量值「物品」');
    expect(describeNode(nodesForVar(物品栏), idx)).toBe('框「物品栏」');
    expect(idx.get(数量.id)!.label).toBe('物品栏 › 数量');
  });
});

describe('components in the card', () => {
  const custom = bar([
    { id: 't', type: 'text', text: '— 状态 —', style: { align: 'center', color: '@accent', size: 16 } },
    { id: 'hr', type: 'divider', text: '✦', line: 'dashed', lineColor: '#ff000080' },
    { id: 'm', type: 'value', bind: { var: 已婚.id }, yes: '已婚 💍', no: '单身', icon: '❤' },
    { id: 's', type: 'value', bind: { var: 好感度.id }, show: 'stage', label: '关系', colon: true },
    { id: 'h', type: 'value', bind: { var: 想法.id }, hideEmpty: true },
    { id: 'b', type: 'bar', bind: { var: 好感度.id }, num: 'inside', showMax: true, label: '' },
    {
      id: 'r',
      type: 'repeat',
      bind: { var: 任务.id },
      dir: 'row',
      children: [{ id: 'i', type: 'value', bind: { var: 任务.id, part: 'item' }, prefix: '□ ' }],
    },
  ]);

  it('draws them with the message data', () => {
    const sb = draw(custom, data());
    expect([...sb.querySelectorAll('.sb-text')].map((e) => e.textContent)).toEqual(['— 状态 —']);
    expect(sb.querySelector('.sb-hr')!.textContent).toBe('✦');
    const vals = [...sb.querySelectorAll('.sb-val')].map((e) => e.textContent);
    expect(vals).toEqual(['❤已婚已婚 💍', '关系：朋友', '□ 找钥匙', '□ 见老板']);
    expect(sb.querySelector('.sb-in')!.textContent).toBe('45 / 100');
  });
  it('hides an empty value only when asked', () => {
    const d = data();
    d.白娅.想法 = '想回家';
    expect(draw(custom, d).textContent).toContain('想法想回家');
  });
  it('writes styles as CSS that ST leaves alone', () => {
    const c = compileBar(custom, vars);
    expect(c.css).toContain('color: var(--accent)');
    expect(c.css).toContain('border-top-color: #ff000080');
    const rep = statusBarReplacement(c);
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{/);
  });
  it('lets nothing unexpected into the CSS', () => {
    expect(cssColor('red; } body { display: none')).toBeUndefined();
    expect(cssColor('@nope')).toBeUndefined();
    expect(cssColor('@accent2')).toBe('var(--accent2)');
    const c = compileBar(bar([{ id: 'x', type: 'text', text: '"}*', style: { color: 'url(http://x)', size: 9999, bg: { a: '#fff', b: 'javascript:' } } }]), vars);
    expect(c.css).not.toContain('url(');
    expect(c.css).not.toContain('javascript');
    expect(c.css).toContain('font-size: 72px');
    expect(c.css).not.toContain('"}');
  });
});

describe('canvas', () => {
  it('marks every component and shows a made-up row for empty tables', async () => {
    const html = editorHtml();
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    document.body.innerHTML = '<style id="sbcss"></style><div id="sb"></div>';
    const posted: any[] = [];
    const g = globalThis as any;
    g.parent = { postMessage: (m: any) => posted.push(m) };
    try {
      new Function('parent', js)(g.parent);
      expect(posted[0]).toEqual({ __sbc: 'ready' });
      const c = compileBar(defaultBar(vars), vars, { edit: true });
      window.dispatchEvent(new MessageEvent('message', { data: { __sbc: 'set', view: c.view, css: c.css, data: data() } }));
      const ids = [...document.querySelectorAll('[data-node]')].map((e) => e.getAttribute('data-node'));
      expect(ids).toContain('auto:root');
      expect(ids).toContain(`auto:${空表.id}:rows`);
      expect(document.querySelector('.sb-ghost')!.textContent).toContain('（名字）');
      expect(document.getElementById('sbcss')!.textContent).toContain('--accent');
      const layout = posted.find((m) => m.__sbc === 'layout');
      expect(layout.rects.length).toBe(ids.length);
    } finally {
      delete g.parent;
    }
  });
});

describe('tree moves', () => {
  interface T {
    id: string;
    children?: T[];
  }
  const list = (): T[] => [{ id: 'r', children: [{ id: 'a' }, { id: 'b' }, { id: 'c', children: [] }] }];
  it('moves to an index counted before the node is taken out', () => {
    const ids = (l: T[]) => l[0].children!.map((x) => x.id);
    expect(ids(moveTo(list(), 'a', 'r', 2))).toEqual(['b', 'a', 'c']);
    expect(ids(moveTo(list(), 'a', 'r', 3))).toEqual(['b', 'c', 'a']);
    expect(ids(moveTo(list(), 'c', 'r', 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveTo(list(), 'a', 'r', 0))).toEqual(['a', 'b', 'c']);
    expect(findVar(moveTo(list(), 'a', 'c', 0), 'c')!.children!.map((x) => x.id)).toEqual(['a']);
    // never into itself
    const l = list();
    expect(moveTo(l, 'r', 'c', 0)).toBe(l);
  });
  it('inserts at a position', () => {
    expect(insertAt(list(), 'r', 1, { id: 'n' })[0].children!.map((x) => x.id)).toEqual(['a', 'n', 'b', 'c']);
  });
});

describe('saved in the card', () => {
  it('keeps the laid-out status bar through export and import', () => {
    const p = newCardProject();
    p.vars = vars;
    const b = defaultBar(vars);
    const root = updateVar([b.root], `auto:${任务.id}`, { label: '待办' })[0];
    p.bar = { v: 1, theme: { ...b.theme, accent: '#ff0000' }, root };
    const card = buildCard(p);
    const back = importCard(card).project;
    expect(back.bar).toEqual(p.bar);
    const regex = card.data.extensions.regex_scripts.find((r: any) => r.scriptName === '[MVU]状态栏');
    expect(regex.replaceString).toContain('待办');
    expect(regex.replaceString).toContain('--accent: #ff0000');
    expect([...eachNode([back.bar!.root!])].length).toBe([...eachNode([root])].length);
  });
  it('keeps following the variables while only the colors were changed', () => {
    const p = { vars, bar: undefined as SavedBar | undefined };
    const auto = barOf(p);
    p.bar = saveBar(p, auto, { ...auto, theme: { ...auto.theme, accent: '#00ff00' } });
    expect(p.bar.root).toBeUndefined();
    expect(barOf(p).theme.accent).toBe('#00ff00');
    const moved = { ...auto, root: { ...auto.root, gap: 4 } };
    expect(saveBar(p, auto, moved).root).toBe(moved.root);
  });
});
