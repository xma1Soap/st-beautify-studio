import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixMarkdown } from '../lib/stformat';
import {
  barOf,
  compileBar,
  cssColor,
  cssProblems,
  numFmt,
  okTag,
  splitUnits,
  unitSizes,
  defaultBar,
  describe as describeNode,
  indexVars,
  newNode,
  nodesForVar,
  placementProblem,
  scopeAt,
  unplacedVars,
  saveBar,
  STILL,
  type Bar,
  type BarNode,
  type CompileOpts,
  type SavedBar,
} from './bar';
import { applySkin, copyLook, LAYOUTS, pasteLook, SKINS } from './barTemplates';
import { buildCard, importCard, newCardProject } from './card';
import { ICON_GROUPS } from './icons';
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
function draw(b: Bar, statData: unknown, opts: CompileOpts = {}, list: VarNode[] = vars) {
  vi.useFakeTimers();
  const html = statusBarHtml(compileBar(b, list, opts));
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  document.body.innerHTML = '<div id="sb"></div>';
  const g = globalThis as any;
  g.getCurrentMessageId = () => 0;
  g.getLastMessageId = () => 0;
  g.getVariables = () => ({ stat_data: statData });
  new Function(js)();
  return document.getElementById('sb')!;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  const g = globalThis as any;
  delete g.Mvu;
  delete g.triggerSlash;
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

describe('buttons, menus, tabs and folds', () => {
  const texts = (sb: HTMLElement, sel: string) => [...sb.querySelectorAll(sel)].map((e) => e.textContent);
  const click = (e: Element | null) => (e as HTMLElement).click();
  const page = (id: string, title: string, text: string): BarNode => ({ id, type: 'box', title, children: [{ id: id + 't', type: 'text', text }] });

  it('switches tabs and remembers the page for the next message', () => {
    const b = bar([{ id: 'tb', type: 'tabs', start: 1, children: [page('p1', '状态', '一'), page('p2', '物品', '二'), page('p3', '', '三')] }]);
    let sb = draw(b, data(), { key: 'k' });
    expect(texts(sb, '.sb-tab')).toEqual(['状态', '物品', '第3页']);
    expect(texts(sb, '.sb-text')).toEqual(['二']);
    click(sb.querySelectorAll('.sb-tab')[2]);
    expect(texts(sb, '.sb-text')).toEqual(['三']);
    expect(sb.querySelector('.sb-on')!.textContent).toBe('第3页');
    sb = draw(b, data(), { key: 'k' });
    expect(texts(sb, '.sb-text')).toEqual(['三']);
    // another card keeps its own
    expect(texts(draw(b, data(), { key: 'other' }), '.sb-text')).toEqual(['二']);
  });

  it('opens and closes folds', () => {
    const b = bar([{ id: 'f', type: 'fold', text: '详情', closed: true, children: [{ id: 'x', type: 'text', text: '里面' }] }]);
    let sb = draw(b, data(), { key: 'k' });
    expect(sb.querySelector('.sb-fold')!.className).toContain('sb-closed');
    expect(sb.textContent).not.toContain('里面');
    click(sb.querySelector('.sb-fhead'));
    expect(sb.textContent).toContain('里面');
    sb = draw(b, data(), { key: 'k' });
    expect(sb.textContent).toContain('里面');
  });

  it('opens menus, keeps the outer one open for a submenu, and closes on a click elsewhere', () => {
    const b = bar([
      {
        id: 'm',
        type: 'menu',
        text: '菜单',
        children: [
          { id: 'a', type: 'button', text: '甲' },
          { id: 'sub', type: 'menu', text: '更多', children: [{ id: 'c', type: 'button', text: '丙' }] },
        ],
      },
      { id: 't', type: 'text', text: '别处' },
    ]);
    const sb = draw(b, data());
    expect(sb.querySelector('.sb-pop')).toBeNull();
    click(sb.querySelector('.sb-mbtn'));
    expect(texts(sb, '.sb-pop > .sb-btn')).toEqual(['甲']);
    click(sb.querySelector('.sb-pop .sb-mbtn'));
    expect(sb.querySelectorAll('.sb-pop').length).toBe(2);
    expect(sb.textContent).toContain('丙');
    click(sb.querySelector('.sb-text'));
    expect(sb.querySelector('.sb-pop')).toBeNull();
  });

  it('shows and hides components, and turns pages, with buttons', () => {
    const b = bar([
      { id: 'secret', type: 'text', text: '秘密', hidden: true },
      { id: 'show', type: 'button', text: '看看', action: { do: 'toggle', target: 'secret' } },
      { id: 'go', type: 'button', text: '去物品', action: { do: 'page', target: 'tb', page: 1 } },
      { id: 'tb', type: 'tabs', children: [page('p1', '状态', '一'), page('p2', '物品', '二')] },
    ]);
    const sb = draw(b, data(), { key: 'k' });
    expect(sb.textContent).not.toContain('秘密');
    click(sb.querySelector('.sb-btn'));
    expect(texts(sb, '.sb-text')).toContain('秘密');
    click(sb.querySelector('.sb-btn'));
    expect(sb.textContent).not.toContain('秘密');
    click(sb.querySelectorAll('.sb-btn')[1]);
    expect(texts(sb, '.sb-text')).toEqual(['二']);
  });

  it('fills the input box or sends, with | escaped', () => {
    const g = globalThis as any;
    g.triggerSlash = vi.fn();
    const b = bar([
      { id: 'a', type: 'button', text: '问', action: { do: 'say', text: '你好|再见' } },
      { id: 'b', type: 'button', text: '发', action: { do: 'say', text: '出发', send: true } },
    ]);
    const sb = draw(b, data());
    click(sb.querySelectorAll('.sb-btn')[0]);
    click(sb.querySelectorAll('.sb-btn')[1]);
    expect(g.triggerSlash.mock.calls).toEqual([['/setinput 你好\\|再见'], ['/send 出发 | /trigger']]);
  });

  it('reports buttons that can not work and leaves them out', () => {
    const b = bar([
      { id: 'e', type: 'button', text: '改', action: { do: 'edit' } },
      { id: 't', type: 'button', text: '藏', action: { do: 'toggle' } },
      { id: 'p', type: 'button', text: '翻', action: { do: 'page', target: 'gone' } },
      { id: 's', type: 'button', text: '说', action: { do: 'say', text: ' ' } },
      { id: 'box', type: 'box', children: [{ id: 'self', type: 'button', text: '自己', action: { do: 'toggle', target: 'box' } }] },
      { id: 'ok', type: 'button', text: '好的' },
    ]);
    const c = compileBar(b, vars);
    expect(c.problems).toHaveLength(5);
    expect(c.problems[0]).toContain('允许玩家修改变量');
    expect(c.hasEdit).toBe(false);
    expect(texts(draw(b, data()), '.sb-btn')).toEqual(['好的']);
  });

  it('keeps menus to buttons and tabs to pages', () => {
    const b = bar([
      { id: 'm', type: 'menu', text: '菜单', children: [] },
      { id: 'tb', type: 'tabs', children: [page('p1', '一', '一')] },
    ]);
    expect(placementProblem(b.root, vars, { id: 'x', type: 'text', text: 'a' }, 'm')).toContain('按钮');
    expect(placementProblem(b.root, vars, { id: 'x', type: 'button', text: 'a' }, 'm')).toBeNull();
    expect(placementProblem(b.root, vars, { id: 'x', type: 'text', text: 'a' }, 'tb')).toContain('页');
    expect(placementProblem(b.root, vars, { id: 'x', type: 'text', text: 'a' }, 'p1')).toBeNull();
  });

  it('survives ST formatting with every part in', () => {
    const b = bar([
      { id: 'm', type: 'menu', text: '菜单', children: [{ id: 'e', type: 'button', text: '改', action: { do: 'edit', title: '改改' } }] },
      { id: 'tb', type: 'tabs', children: [page('p1', '一', '一')] },
      { id: 'f', type: 'fold', text: '折', children: [] },
      { id: 's', type: 'button', text: '说', action: { do: 'say', text: '{{user}} 你好 $1 `x` *a*' } },
    ]);
    const ev = [{ ...好感度, playerEditable: true }];
    const c = compileBar(b, [v({ name: '白娅', kind: 'group', children: ev })], { allowEdit: true, key: 'p-1' });
    expect(c.hasEdit).toBe(true);
    const rep = statusBarReplacement(c);
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{/);
    expect(rep.slice(3, -3)).not.toContain('`');
  });
});

describe('pictures and bar looks', () => {
  const 表情 = v({ name: '表情', kind: 'choice', options: ['开心', '生气'], init: '开心' });
  const 头像 = v({ name: '头像', kind: 'text', init: 'https://a.example/x.png' });
  const 生命 = v({ name: '生命', kind: 'number', init: 37, min: 0, max: 100 });
  const pv = [表情, 头像, 生命];
  const pd = { 表情: '开心', 头像: 'https://a.example/x.png', 生命: 37 };

  it('shows a fixed picture, and leaves out pictures without one or with a bad link', () => {
    const b = bar([
      { id: 'a', type: 'image', src: 'https://a.example/p.png', imgW: 80, circle: true },
      { id: 'b', type: 'image' },
      { id: 'c', type: 'image', src: 'javascript:alert(1)' },
    ]);
    const c = compileBar(b, pv);
    expect(c.problems).toEqual(['图片：还没放图片', '图片：图片的链接要以 https:// 或 http:// 开头']);
    expect(c.css).toContain('width: 80px; flex: none; height: 80px; border-radius: 50%');
    const root = draw(b, pd, {}, pv);
    const imgs = root.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute('src')).toBe('https://a.example/p.png');
  });

  it('changes the picture with a variable, falling back when nothing matches', () => {
    const map = { 开心: 'https://a.example/happy.png', 生气: 'data:image/png;base64,AAAA' };
    const b = bar([
      { id: 'a', type: 'image', bind: { var: 表情.id }, imgMap: map },
      { id: 'b', type: 'image', bind: { var: 表情.id }, imgMap: { 开心: map.开心 }, src: 'https://a.example/else.png' },
      { id: 'c', type: 'image', bind: { var: 表情.id }, imgMap: { 开心: map.开心 } },
      { id: 'd', type: 'image', bind: { var: 头像.id } },
      { id: 'e', type: 'image', bind: { var: 生命.id } },
    ]);
    expect(compileBar(b, pv).problems).toEqual(['图片「生命」：「生命」不能用来换图片（只能用文字、选项、是否）']);
    const srcs = (d: object) => [...draw(b, d, {}, pv).querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs(pd)).toEqual([map.开心, map.开心, map.开心, 'https://a.example/x.png']);
    expect(srcs({ ...pd, 表情: '生气', 头像: 'javascript:alert(1)' })).toEqual([map.生气, 'https://a.example/else.png']);
    // values that happen to be object keys don't count
    expect(srcs({ ...pd, 表情: 'toString', 头像: '' })).toEqual(['https://a.example/else.png']);
  });

  it('draws segments, a ring and a row of icons', () => {
    const b = bar([
      { id: 's', type: 'bar', bind: { var: 生命.id }, barLook: 'seg', count: 10, height: 12 },
      { id: 'r', type: 'bar', bind: { var: 生命.id }, barLook: 'ring', num: 'inside', fill: { a: '#ff0000' } },
      { id: 'i', type: 'bar', bind: { var: 生命.id }, barLook: 'icons', sym: '♥', count: 5, num: 'inside' },
      { id: 'w', type: 'bar', bind: { var: 生命.id }, barLook: 'icons', count: 5, whole: true },
    ]);
    const c = compileBar(b, pv);
    expect(c.problems).toEqual([]);
    expect(c.css).toContain('.sb-seg { height: 12px; }');
    expect(c.css).toContain('--fa: #ff0000; --fb: #ff0000');
    const root = draw(b, pd, {}, pv);
    const [seg, ring, icons, whole] = [...root.querySelectorAll('.sb-barrow')] as HTMLElement[];
    expect(seg.querySelectorAll('.sb-seg').length).toBe(10);
    expect(seg.querySelectorAll('.sb-seg.sb-on').length).toBe(4);
    expect((ring.querySelector('.sb-ring') as HTMLElement).style.background).toContain('conic-gradient');
    expect(ring.querySelector('.sb-ringw > .sb-in')!.textContent).toBe('37');
    expect(icons.querySelector('.sb-syme')!.textContent).toBe('♥♥♥♥♥');
    expect(parseFloat((icons.querySelector('.sb-symf') as HTMLElement).style.width)).toBeCloseTo(37);
    // icons have no room inside them for the number
    expect(icons.querySelector(':scope > .sb-v')!.textContent).toBe('37');
    expect(parseFloat((whole.querySelector('.sb-symf') as HTMLElement).style.width)).toBeCloseTo(40);
  });

  it('survives ST formatting with pictures and every bar look', () => {
    const b = bar([
      { id: 'a', type: 'image', bind: { var: 表情.id }, imgMap: { 开心: 'https://a.example/a_b*c$1.png' }, src: 'data:image/png;base64,AA+/==' },
      { id: 's', type: 'bar', bind: { var: 生命.id }, barLook: 'seg' },
      { id: 'r', type: 'bar', bind: { var: 生命.id }, barLook: 'ring' },
      { id: 'i', type: 'bar', bind: { var: 生命.id }, barLook: 'icons', sym: '*"' },
    ]);
    const rep = statusBarReplacement(compileBar(b, pv));
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{/);
    expect(rep.slice(3, -3)).not.toContain('`');
  });
});

describe('players changing variables', () => {
  const 好感 = v({ name: '好感度', kind: 'number', init: 45, min: 0, max: 100, integer: true, playerEditable: true, stages: [{ from: 0, label: '陌生' }, { from: 40, label: '朋友' }, { from: 80, label: '恋人' }] });
  const 心情 = v({ name: '心情', kind: 'choice', options: ['好', '坏'], init: '好', playerEditable: true });
  const 秘密 = v({ name: '秘密', kind: 'text', init: '' });
  const 人 = v({ name: '白娅', kind: 'group', children: [好感, 心情, 秘密] });
  const 待办 = v({ name: '待办', kind: 'list', init: ['a'], playerEditable: true });
  const 数 = v({ name: '数量', kind: 'number', init: 1, min: 0 });
  const 包 = v({ name: '背包', kind: 'table', rowName: '物品', dropRowWhenZero: '数量', init: { 剑: { 数量: 1 } }, children: [数], playerEditable: true });
  const ev = [人, 待办, 包];
  const start = () => buildSchema(ev).parse(initialData(ev)) as Record<string, any>;
  const b = bar([
    { id: 'v', type: 'value', bind: { var: 好感.id } },
    { id: 'e', type: 'button', text: '修改', action: { do: 'edit' } },
    { id: 'e2', type: 'button', text: '只改心情', action: { do: 'edit', vars: [心情.id], title: '心情' } },
  ]);

  function setup() {
    let cur = start();
    const g = globalThis as any;
    const replaceMvuData = vi.fn(async (d: any) => {
      cur = d.stat_data;
    });
    g.Mvu = { getMvuData: () => ({ stat_data: cur, initialized_lorebooks: {} }), replaceMvuData, events: {} };
    const sb = draw(b, cur, { allowEdit: true }, ev);
    g.getVariables = () => ({ stat_data: cur });
    return { sb, replaceMvuData, now: () => cur };
  }
  const change = (e: HTMLInputElement | HTMLSelectElement, value: string, ev = 'change') => {
    e.value = value;
    e.dispatchEvent(new Event(ev));
  };

  it('lists only what players may change', () => {
    const c = compileBar(b, ev, { allowEdit: true });
    expect(c.ed.map((m) => m.n)).toEqual(['白娅 › 好感度', '白娅 › 心情', '待办', '背包']);
    expect(c.ed[0]).toMatchObject({ mn: 0, mx: 100, int: 1, sn: '$好感度阶段' });
    expect(compileBar(b, ev).hasEdit).toBe(false);
  });

  it('saves numbers in range, with the stage worked out', async () => {
    const { sb, replaceMvuData, now } = setup();
    sb.querySelector<HTMLElement>('.sb-btn')!.click();
    expect(sb.querySelector('.sb-ed-title')!.textContent).toBe('修改变量');
    const num = sb.querySelector<HTMLInputElement>('.sb-ed input[type=number]')!;
    expect(num.value).toBe('45');
    change(num, '150.4');
    expect(num.value).toBe('100');
    change(sb.querySelector('.sb-ed select')!, '坏');
    sb.querySelector<HTMLElement>('.sb-ed-ok')!.click();
    await flush();
    expect(replaceMvuData).toHaveBeenCalledOnce();
    expect(replaceMvuData.mock.calls[0][0].initialized_lorebooks).toEqual({});
    expect(now().白娅).toMatchObject({ 好感度: 100, $好感度阶段: '恋人', 心情: '坏' });
    expect(sb.querySelector('.sb-ed')).toBeNull();
    expect(sb.querySelector('.sb-val')!.textContent).toContain('100');
  });

  it('edits lists and table rows, and drops rows that hit zero', async () => {
    const { sb, now } = setup();
    sb.querySelector<HTMLElement>('.sb-btn')!.click();
    const list = sb.querySelector('.sb-ed-list')!;
    const add = list.querySelector<HTMLInputElement>('.sb-ed-add input')!;
    add.value = 'b';
    list.querySelector<HTMLElement>('.sb-ed-add button')!.click();
    expect([...list.querySelectorAll<HTMLInputElement>('.sb-ed-cell input')].map((e) => e.value)).toEqual(['a', 'b']);
    const table = sb.querySelector('.sb-ed-table')!;
    [...table.querySelectorAll<HTMLElement>('button')].find((e) => e.textContent!.includes('添加一行'))!.click();
    const rows = table.querySelectorAll('.sb-ed-trow');
    expect(rows.length).toBe(2);
    expect(rows[1].querySelector<HTMLInputElement>('.sb-ed-rname')!.value).toBe('新物品');
    change(rows[1].querySelector<HTMLInputElement>('.sb-ed-rname')!, '盾');
    change(rows[1].querySelector<HTMLInputElement>('input[type=number]')!, '3');
    change(rows[0].querySelector<HTMLInputElement>('input[type=number]')!, '0');
    sb.querySelector<HTMLElement>('.sb-ed-ok')!.click();
    await flush();
    expect(now().待办).toEqual(['a', 'b']);
    expect(now().背包).toEqual({ 盾: { 数量: 3 } });
  });

  it('can show only some variables, and cancel', () => {
    const { sb, replaceMvuData } = setup();
    sb.querySelectorAll<HTMLElement>('.sb-btn')[1].click();
    expect(sb.querySelector('.sb-ed-title')!.textContent).toBe('心情');
    expect([...sb.querySelectorAll('.sb-ed-row > .sb-ed-name')].map((e) => e.textContent)).toEqual(['白娅 › 心情']);
    [...sb.querySelectorAll<HTMLElement>('.sb-ed-b')].find((e) => e.textContent === '取消')!.click();
    expect(sb.querySelector('.sb-ed')).toBeNull();
    expect(replaceMvuData).not.toHaveBeenCalled();
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

describe('text looks and motion', () => {
  const grad = { a: '@accent', b: '#ff00aa', angle: 90 };
  const fancy: BarNode[] = [
    {
      id: 'box',
      type: 'box',
      dir: 'col',
      stagger: true,
      style: { borderW: 2, borderGrad: grad, radius: 8, anim: 'breathe', enter: 'up', hover: 'lift', font: 'li', ls: 2 },
      children: [
        { id: 't', type: 'text', text: 'a*b"c$1', style: { textGrad: grad, textFx: 'glow', anim: 'flow', bg: grad } },
        { id: 'b', type: 'bar', bind: { var: 好感度.id }, grow: true, valGrad: grad },
        { id: 'v', type: 'value', bind: { var: 想法.id }, valGrad: grad, style: { textFx: 'outline', enter: 'zoom' } },
        { id: 'btn', type: 'button', text: '按钮', style: { textGrad: grad, anim: 'beat', animSec: 3 } },
        { id: 'f', type: 'fold', text: '折叠', headStyle: { textGrad: grad, borderW: 1, borderGrad: grad }, children: [] },
        { id: 'm', type: 'menu', text: '菜单', popStyle: { borderW: 1, borderGrad: grad }, children: [] },
        { id: 'i', type: 'image', src: 'https://a.example/x.png', style: { borderW: 2, borderGrad: grad, anim: 'spin' } },
      ],
    },
  ];

  it('writes gradient text, gradient borders, fonts and motion as CSS', () => {
    const { css, problems } = compileBar(bar(fancy), vars);
    expect(problems).toEqual([]);
    // gradient text on the words only, with its shadow turned into a filter
    expect(css).toMatch(/\.n3 > \.sb-tx \{ background: linear-gradient\(90deg, var\(--accent\), #ff00aa\); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; text-shadow: none; filter: drop-shadow\(0 0 4px currentColor\)/);
    expect(css).toContain('.sb-btn.n6 > .sb-tx {');
    expect(css).toContain('.n7 > .sb-fhead > .sb-tx {');
    expect(css).toContain('.n4 .sb-v, .n4 .sb-in { background: linear-gradient');
    expect(css).toContain('.n5 .sb-v:not(.sb-pill) { background: linear-gradient');
    // gradient border: see-through border plus a masked ring
    expect(css).toMatch(/\.n2 \{[^}]*border: 2px solid transparent; position: relative/);
    expect(css).toMatch(/\.n2::after \{ content: ''; position: absolute; inset: -2px; padding: 2px; border-radius: inherit; background: linear-gradient/);
    expect(css).toContain('.n7 > .sb-fhead::after {');
    expect(css).toContain('.sb-pop .n8 > .sb-pop { position: relative; }');
    expect(css).not.toMatch(/^\.n8 > \.sb-pop \{[^}]*position: relative/m);
    // pictures can't: a plain border in the first color
    expect(css).toContain('border: 2px solid var(--accent)');
    expect(css).not.toContain('.n9::after');
    expect(css).toContain(`font-family: 'LiSu'`);
    expect(css).toContain('letter-spacing: 2px');
    // motion
    expect(css).toContain('.n2 { animation: sb-breathe 2.4s ease-in-out infinite; }');
    expect(css).toContain('.sb-intro .n2 > :nth-child(1) { animation: sb-in-up 0.5s ease 0s both; }');
    expect(css).toContain('.sb-intro .n2 > :nth-child(7) { animation: sb-in-up 0.5s ease 0.48s both; }');
    expect(css).not.toContain('.sb-intro .n2 {');
    expect(css).toContain('.n2:hover { transform: translateY(-3px)');
    expect(css).toContain('.n3 > .sb-tx { background-size: 200% 200%; animation: sb-flow 6s ease infinite; }');
    expect(css).toContain('.n3 { background-size: 200% 200%; animation: sb-flow');
    expect(css).toContain('.sb-intro .n4 .sb-fill { animation: sb-grow 1s ease-out both; }');
    expect(css).toContain('.sb-intro .n5 { animation: sb-in-zoom 0.5s ease both; }');
    expect(css).toContain('.sb-btn.n6 { animation: sb-beat 3s ease-in-out infinite; }');
    for (const k of ['breathe', 'in-up', 'flow', 'grow', 'in-zoom', 'beat', 'spin']) expect(css).toContain(`@keyframes sb-${k} {`);
    expect(css).not.toContain('@keyframes sb-float');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('leaves all motion out when it is turned off', () => {
    const b = bar(fancy);
    const { css } = compileBar({ ...b, theme: { ...b.theme, noAnim: true } }, vars);
    expect(css).not.toMatch(/@keyframes|animation: sb-|\.n\d+:hover|sb-intro|transition: transform 0.2s/);
    expect(css).toContain('.n3 > .sb-tx { background: linear-gradient');
  });

  it('survives ST formatting with every look and motion', () => {
    const rep = statusBarReplacement(compileBar(bar(fancy), vars));
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{/);
    expect(rep.slice(3, -3)).not.toContain('`');
  });

  it('puts words in their own span and plays the entrance only on the first drawing', () => {
    const root = draw(bar(fancy), { 白娅: { 好感度: 45, 想法: 'x', $好感度阶段: '朋友' } });
    expect(root.querySelector('.n3 > .sb-tx')?.textContent).toBe('a*b"c$1');
    expect(root.querySelector('.sb-btn.n6 > .sb-tx')?.textContent).toBe('按钮');
    expect(root.querySelector('.n7 > .sb-fhead > .sb-tx')?.textContent).toBe('折叠');
    expect(root.classList.contains('sb-intro')).toBe(true);
    vi.advanceTimersByTime(2500);
    expect(root.classList.contains('sb-intro')).toBe(false);
  });

  it('turns motion off on the canvas until asked to play it', () => {
    const html = editorHtml();
    expect(html).toContain('<style id="sbstill">' + STILL + ' { animation: none !important; transition: none !important; }</style>');
    expect(STILL).toContain('#sb div::before');
    expect(html).toContain("d.__sbc === 'play'");
  });
});

describe('ready-made layouts, skins and the format painter', () => {
  const all = [白娅, 任务, 物品栏];

  it('lays out every variable in each layout without problems', () => {
    for (const l of LAYOUTS) {
      const root = l.make(all);
      const b: Bar = { ...defaultBar(all), root };
      expect(unplacedVars(b, all), l.name).toEqual([]);
      const problems = compileBar(b, all).problems.filter((p) => !p.startsWith('图片'));
      expect(problems, l.name).toEqual([]);
      const ids = [...eachNode([root])].map((x) => x.id);
      expect(new Set(ids).size, l.name).toBe(ids.length);
      expect(ids.some((id) => id.startsWith('auto:')), l.name).toBe(false);
    }
    const tabs = LAYOUTS.find((l) => l.key === 'tabs')!.make(all);
    expect(tabs.children?.[0].children?.map((p) => p.title)).toEqual(['概况', '白娅', '物品栏']);
  });

  it('restyles without moving anything, and survives ST formatting in every skin', () => {
    const base = defaultBar(all);
    for (const skin of SKINS) {
      const { root, theme } = applySkin(base.root, base.theme, skin);
      const shape = (n: BarNode): unknown => [n.id, n.type, n.bind, n.children?.map(shape)];
      expect(shape(root), skin.name).toEqual(shape(base.root));
      const c = compileBar({ v: 1, theme, root }, all);
      expect(c.problems, skin.name).toEqual([]);
      const rep = statusBarReplacement(c);
      expect(fixMarkdown(rep), skin.name).toBe(rep);
    }
    const cute = applySkin(base.root, base.theme, SKINS.find((s) => s.name === '可爱')!);
    expect(cute.theme.font).toBe('round');
    const bars = [...eachNode([cute.root])].filter((x) => x.type === 'bar');
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every((x) => x.barLook === 'icons' && x.sym === '❤️')).toBe(true);
    // back to plain: what the last skin set is cleared
    const plain = applySkin(cute.root, cute.theme, SKINS[0]);
    expect([...eachNode([plain.root])].filter((x) => x.type === 'bar').every((x) => x.barLook === undefined && !('sym' in x))).toBe(true);
  });

  it('copies a look onto the same kind fully and onto other kinds partly', () => {
    const from: BarNode = { id: 'a', type: 'bar', bind: { var: 好感度.id }, barLook: 'seg', fill: { a: '#ff0000' }, style: { width: 50, bg: { a: '@card' }, radius: 6 } };
    const look = copyLook(from);
    expect(look.style).toEqual({ bg: { a: '@card' }, radius: 6 });
    const to = pasteLook({ id: 'b', type: 'bar', bind: { var: 好感度.id }, style: { width: 'auto', color: '#00ff00' } }, look);
    expect(to).toMatchObject({ id: 'b', barLook: 'seg', fill: { a: '#ff0000' }, style: { width: 'auto', bg: { a: '@card' }, radius: 6 } });
    expect(to.style?.color).toBeUndefined();
    const txt = pasteLook({ id: 'c', type: 'text', text: 'x' }, look);
    expect(txt).toEqual({ id: 'c', type: 'text', text: 'x', style: { bg: { a: '@card' }, radius: 6 } });
  });

  it('lets a width set on a component win inside a row', () => {
    const { css } = compileBar(bar([{ id: 'r', type: 'box', dir: 'row', children: [{ id: 'a', type: 'value', bind: { var: 想法.id }, style: { width: 'auto' } }] }]), vars);
    expect(css).toContain(':where(.sb-row) > div { flex: 1 1 0; min-width: 0; }');
    expect(css).toContain('.n3 { flex: 0 1 auto; }');
  });

  it('has no icon twice in a group', () => {
    for (const g of ICON_GROUPS) expect(new Set(g.icons).size, g.name).toBe(g.icons.length);
  });
});

describe('looks by value and changes since the previous message', () => {
  /** like draw(), but the message is the second one and the first holds `prev` */
  function drawWithPrev(b: Bar, cur: unknown, prev: unknown, list: VarNode[] = vars) {
    vi.useFakeTimers();
    const html = statusBarHtml(compileBar(b, list));
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    document.body.innerHTML = '<div id="sb"></div>';
    const g = globalThis as any;
    g.getCurrentMessageId = () => 1;
    g.getLastMessageId = () => 1;
    g.getVariables = (o: any) => ({ stat_data: o?.message_id === 0 ? prev : cur });
    new Function(js)();
    return document.getElementById('sb')!;
  }
  const love = (x: number) => ({ 白娅: { 好感度: x, 已婚: true, 想法: '', $好感度阶段: '朋友' } });

  it('picks color, icon and words for a number by steps', () => {
    const node: BarNode = {
      id: 'a',
      type: 'value',
      bind: { var: 好感度.id },
      icon: '♡',
      cases: [
        { at: 50, color: '#ff0000', text: '喜欢' },
        { at: 0, color: '#888888' },
        { at: 80, icon: '❤' },
      ],
    };
    const view = compileBar(bar([node]), vars).view as any;
    expect(view.k[0].cs.map((k: any) => k.a)).toEqual([0, 50, 80]);
    let root = draw(bar([node]), love(10));
    expect((root.querySelector('.sb-v') as HTMLElement).style.color).toBe('rgb(136, 136, 136)');
    expect(root.querySelector('.sb-icon')?.textContent).toBe('♡');
    expect(root.querySelector('.sb-stage')).toBeNull();
    root = draw(bar([node]), love(90));
    expect((root.querySelector('.sb-v') as HTMLElement).style.color).toBe('rgb(255, 0, 0)');
    expect(root.querySelector('.sb-icon')?.textContent).toBe('❤');
    expect(root.querySelector('.sb-stage')?.textContent).toBe('喜欢');
  });

  it('blends colors smoothly and colors the bar fill', () => {
    const node: BarNode = { id: 'a', type: 'bar', bind: { var: 好感度.id }, smooth: true, cases: [{ at: 0, color: '#000000' }, { at: 100, color: '#ffffff' }] };
    const view = compileBar(bar([node]), vars).view as any;
    expect(view.k[0].sm).toBe(1);
    const root = draw(bar([node]), love(25));
    expect((root.querySelector('.sb-barrow') as HTMLElement).style.getPropertyValue('--fa')).toBe('color-mix(in srgb, #ffffff 25%, #000000)');
  });

  it('matches words exactly for choices and yes / no', () => {
    const node: BarNode = { id: 'a', type: 'value', bind: { var: 已婚.id }, cases: [{ at: 'true', icon: '💍' }, { at: 'false', icon: '✖' }] };
    const root = draw(bar([node]), love(1));
    expect(root.querySelector('.sb-icon')?.textContent).toBe('💍');
    // only checked colors get in
    const bad: BarNode = { ...node, cases: [{ at: 'true', color: 'red;background:url(x)' }] };
    expect((compileBar(bar([bad]), vars).view as any).k[0].cs).toBeUndefined();
  });

  it('shows how a number changed since the previous message', () => {
    const node: BarNode = { id: 'a', type: 'value', bind: { var: 好感度.id }, diff: 'both' };
    let root = drawWithPrev(bar([node]), love(50), love(45));
    expect(root.querySelector('.sb-diff')?.textContent).toBe('↑5');
    expect(root.querySelector('.sb-diff')?.classList.contains('sb-good')).toBe(true);
    root = drawWithPrev(bar([{ ...node, diff: 'num', diffBad: true }]), love(40), love(45));
    expect(root.querySelector('.sb-diff')?.textContent).toBe('-5');
    expect(root.querySelector('.sb-diff')?.classList.contains('sb-good')).toBe(true);
    root = drawWithPrev(bar([{ ...node, type: 'bar', diff: 'arrow', diffBad: true }]), love(50), love(45));
    expect(root.querySelector('.sb-diff')?.textContent).toBe('↑');
    expect(root.querySelector('.sb-diff')?.classList.contains('sb-bad')).toBe(true);
    // nothing to compare with, or no change: nothing shown
    expect(drawWithPrev(bar([node]), love(50), love(50)).querySelector('.sb-diff')).toBeNull();
    expect(draw(bar([node]), love(50)).querySelector('.sb-diff')).toBeNull();
  });

  it('compares table rows with the same row in the previous message', () => {
    const items: BarNode = { id: 'r', type: 'repeat', bind: { var: 物品栏.id }, children: [{ id: 'q', type: 'value', bind: { var: 数量.id }, diff: 'num' }] };
    const stock = (x: number) => ({ 物品栏: { 面包: { 数量: x, 描述: '' } } });
    const root = drawWithPrev(bar([items]), stock(5), stock(2));
    expect(root.querySelector('.sb-diff')?.textContent).toBe('+3');
  });

  it('only reads the previous message when something compares with it, and survives ST formatting', () => {
    const plain = statusBarHtml(compileBar(bar([{ id: 'a', type: 'value', bind: { var: 好感度.id } }]), vars));
    expect(plain).toContain('var NEED_PREV = 0;');
    const c = compileBar(bar([{ id: 'a', type: 'value', bind: { var: 好感度.id }, diff: 'arrow', smooth: true, cases: [{ at: 0, color: '#000' }, { at: 9, color: '@accent' }] }]), vars);
    expect(statusBarHtml(c)).toContain('var NEED_PREV = 1;');
    const rep = statusBarReplacement(c);
    expect(fixMarkdown(rep)).toBe(rep);
  });
});

describe('hiding an empty list', () => {
  it('leaves the whole block out when there is nothing in it', () => {
    const rep: BarNode = { id: 'r', type: 'repeat', bind: { var: 任务.id }, hideEmpty: true, children: [{ id: 'i', type: 'value', bind: { var: 任务.id, part: 'item' } }] };
    expect(draw(bar([rep]), { 任务: [] }).querySelector('.sb-rep')).toBeNull();
    expect(draw(bar([rep]), { 任务: ['a'] }).querySelector('.sb-rep')).not.toBeNull();
    expect(draw(bar([{ ...rep, hideEmpty: undefined }]), { 任务: [] }).querySelector('.sb-rep .sb-empty')?.textContent).toBe('暂无');
  });
});

describe('CSS written by hand', () => {
  it('goes in as a string, so ST leaves it alone whatever it holds', () => {
    const b: Bar = { ...bar([{ id: 't', type: 'text', text: '你好', tag: 'hello' }]), css: '#sb * { margin: 0 } .hello::after { content: "$1 `x` {{user}}" } /* 注释 */' };
    const c = compileBar(b, vars);
    expect(c.xcss).toContain('#sb *');
    const rep = statusBarReplacement(c);
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{|`x`/);
    const sb = draw(b, data());
    expect(sb.querySelector('.hello')!.textContent).toBe('你好');
    const styles = [...document.head.querySelectorAll('style')].map((e) => e.textContent);
    expect(styles.some((t) => t === b.css)).toBe(true);
    document.head.innerHTML = '';
  });
  it('only takes plain class names', () => {
    expect(okTag('hp-line')).toBe(true);
    expect(okTag('sb-val')).toBe(false);
    expect(okTag('n3')).toBe(false);
    expect(okTag('a b')).toBe(false);
    expect(okTag('1x')).toBe(false);
    const c = compileBar(bar([{ id: 't', type: 'text', text: 'x', tag: 'bad tag' }]), vars);
    expect(JSON.stringify(c.view)).not.toContain('bad tag');
  });
  it('points out unclosed braces and comments', () => {
    expect(cssProblems('.a { color: red; }')).toEqual([]);
    expect(cssProblems('.a { color: red;')).toEqual(['少了 1 个 }']);
    expect(cssProblems('.a { } }')).toEqual(['第 1 行多了一个 }']);
    expect(cssProblems('.a { content: "}" }')).toEqual([]);
    expect(cssProblems('/* x')).toContain('有一段 /* 注释没有用 */ 结束');
  });
  it('is kept when the layout changes', () => {
    const auto = barOf({ vars });
    const saved = saveBar({}, auto, { ...auto, css: '.x{}' });
    expect(saved).toEqual({ v: 1, theme: auto.theme, css: '.x{}' });
    expect(barOf({ bar: saved, vars }).css).toBe('.x{}');
  });
});

describe('how numbers are written', () => {
  const 钱 = v({ name: '钱', kind: 'number', init: 0, min: 0, max: 1000000 });
  const 时间 = v({ name: '时间', kind: 'number', init: 0 });
  const list = [钱, 时间];
  const one = (fmt: BarNode['fmt'], val: number, extra: Partial<BarNode> = {}) =>
    draw(bar([{ id: 'x', type: 'value', bind: { var: 钱.id }, label: '', fmt, ...extra }]), { 钱: val, 时间: 0 }, {}, list).querySelector('.sb-v')!.textContent;
  it('splits into units', () => {
    const units = [{ name: '金', per: 100 }, { name: '银', per: 100 }, { name: '铜' }];
    expect(unitSizes(units)).toEqual([[10000, '金'], [100, '银'], [1, '铜']]);
    expect(one({ units }, 10507)).toBe('1金 5银 7铜');
    expect(one({ units }, 20000)).toBe('2金');
    expect(one({ units }, 0)).toBe('0铜');
    expect(splitUnits(-130, [[60, '分'], [1, '秒']])).toBe('-2分 10秒');
    expect(unitSizes([{ name: '金' }])).toBeUndefined();
  });
  it('writes decimals, commas, divisions and percents', () => {
    expect(one({ dp: 2 }, 3)).toBe('3.00');
    expect(one({ comma: true }, 1234567)).toBe('1,234,567');
    expect(one({ div: 10000, dp: 1 }, 123456, { suffix: '万' })).toBe('12.3万');
    expect(one({ pct: true }, 250000)).toBe('25%');
    // no range: written as it is
    expect(numFmt({ pct: true }, [0, null])).toBeUndefined();
  });
  it('writes the bar number and the change the same way', () => {
    const b = bar([{ id: 'b', type: 'bar', bind: { var: 钱.id }, min: 0, max: 200, showMax: true, fmt: { pct: true }, diff: 'num' }]);
    const c = compileBar(b, list);
    const html = statusBarHtml(c);
    expect(fixMarkdown(statusBarReplacement(c))).toBe(statusBarReplacement(c));
    expect(html).not.toContain('*');
    const sb = draw(b, { 钱: 50, 时间: 0 }, {}, list);
    expect(sb.querySelector('.sb-v')!.textContent).toBe('25%');
  });
});
