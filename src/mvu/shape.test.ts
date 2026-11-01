import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixMarkdown } from '../lib/stformat';
import { compileBar, defaultBar, type Bar, type BarNode } from './bar';
import { at, cleanShape, fillClip, insetOffsets, nearestOnSegment, place, ringClip, SHAPE_PRESETS, topOf, type ShapePt } from './shape';
import { statusBarHtml, statusBarReplacement } from './statusbar';
import type { VarNode } from './types';

const preset = (key: string, d = 14) => SHAPE_PRESETS.find((p) => p.key === key)!.make(d);
const rect: ShapePt[] = [
  { x: { f: 0, o: 0 }, y: { f: 0, o: 0 } },
  { x: { f: 1, o: 0 }, y: { f: 0, o: 0 } },
  { x: { f: 1, o: 0 }, y: { f: 1, o: 0 } },
  { x: { f: 0, o: 0 }, y: { f: 1, o: 0 } },
];

describe('shape points', () => {
  it('has presets that are all valid shapes', () => {
    for (const p of SHAPE_PRESETS) expect(cleanShape(p.make(14)), p.key).toHaveLength(p.make(14).length);
  });
  it('drops anything odd and needs three points', () => {
    expect(cleanShape('x')).toBeUndefined();
    expect(cleanShape(rect.slice(0, 2))).toBeUndefined();
    const s = cleanShape([...rect, null, { x: 1 }, { x: { f: 5, o: 'a' }, y: { f: -1, o: 99999 } }]);
    expect(s).toHaveLength(5);
    expect(s![4]).toEqual({ x: { f: 1, o: 0 }, y: { f: 0, o: 2000 } });
    expect(cleanShape(Array.from({ length: 60 }, () => rect[0]))).toHaveLength(40);
  });
  it('keeps a dragged point a fixed depth from the nearest side, or as a share', () => {
    expect(place(230, 80, 240, 72, false)).toEqual({ x: { f: 1, o: -10 }, y: { f: 1, o: 0 } });
    expect(place(118, 50, 240, 72, false)).toEqual({ x: { f: 0.5, o: -2 }, y: { f: 0.5, o: 14 } });
    expect(place(60, 18, 240, 72, true)).toEqual({ x: { f: 0.25, o: 0 }, y: { f: 0.25, o: 0 }, p: 1 });
    // the depth stays the same on a wider block
    const p = place(230, 36, 240, 72, false);
    expect(at(p, 600, 72)).toEqual({ x: 590, y: 36 });
  });
  it('finds the nearest point on an edge', () => {
    expect(nearestOnSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 3)).toEqual({ x: 4, y: 0, t: 0.4, d: 3 });
    expect(nearestOnSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, -5, 0).t).toBe(0);
  });
});

describe('shape CSS', () => {
  it('moves every corner inwards for an outline, either way round', () => {
    expect(insetOffsets(rect, 2)).toEqual([
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
      { x: 2, y: -2 },
    ]);
    const back = insetOffsets([...rect].reverse(), 2);
    expect(back[0]).toEqual({ x: 2, y: -2 });
    // a sharp point moves in further, but never without limit
    for (const o of insetOffsets(preset('diamond'), 2)) expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(6.01);
  });
  it('writes the polygon with fixed depths in px', () => {
    expect(fillClip(preset('shield'), 0)).toBe('polygon(0% 0%, 100% 0%, 100% calc(100% - 14px), 50% 100%, 0% calc(100% - 14px))');
    expect(fillClip(rect, 2)).toBe('polygon(2px 2px, calc(100% - 2px) 2px, calc(100% - 2px) calc(100% - 2px), 2px calc(100% - 2px))');
    const ring = ringClip(rect, 2);
    expect(ring.startsWith('polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 2px 2px,')).toBe(true);
    expect(topOf(rect, 2)).toBe(2);
    expect(topOf(preset('diamond'), 0)).toBe(0);
  });
});

let n = 0;
const v = (p: Partial<VarNode> & Pick<VarNode, 'name' | 'kind'>): VarNode => ({ id: `v${++n}`, rules: [], ...p });
const 等级 = v({ name: '等级', kind: 'number', init: 1 });
const 技能 = v({ name: '技能', kind: 'table', rowName: '技能', init: { 火球: { 等级: 2 }, 冰箭: { 等级: 1 } }, children: [等级] });
const vars = [技能];
const bar = (children: BarNode[]): Bar => ({ ...defaultBar([]), root: { id: 'root', type: 'box', dir: 'row', children } });

describe('shaped and picked parts in the status bar', () => {
  const gem = preset('gem');
  const blocks: BarNode[] = [
    {
      id: 'a',
      type: 'text',
      text: '精',
      pick: true,
      style: { shape: gem, bg: { a: '#203040' }, borderW: 2, borderColor: '#88aaff', hl: '#ffffff55', glow: '#88aaff', sel: { bg: { a: '#405060' }, border: '#ffffff', glow: '#ffdd88' } },
    },
    { id: 'b', type: 'text', text: '气', pick: true, style: { shape: gem, hover: 'bright', anim: 'breathe' } },
    { id: 'c', type: 'button', text: '按', style: { shape: preset('cut'), bg: { a: '@accent', b: '@accent2' }, hl: '#ffffff80', anim: 'flow' } },
    { id: 'd', type: 'box', dir: 'col', style: { hl: '#ffffff40', glow: '#ff0000', radius: 8, sel: { glow: '#00ff00', hover: true } }, children: [] },
    { id: 'e', type: 'image', src: 'https://a.example/x.png', pick: true, style: { shape: gem } },
  ];

  it('draws the outline and the fill as layers cut to the polygon', () => {
    const { css, problems } = compileBar(bar(blocks), vars);
    expect(problems).toEqual([]);
    // the part itself has nothing square left, and its glow is a filter that follows the shape
    expect(css).toMatch(/\.n2 \{[^}]*background: none; border: 0; box-shadow: none; isolation: isolate; position: relative;[^}]*filter: drop-shadow\(0 0 8px #88aaff\)/);
    expect(css).toContain(`.n2::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: linear-gradient(180deg, transparent 2px, #ffffff55 2px, #ffffff55 4px, transparent 4px), #203040; clip-path: polygon(`);
    expect(css).toContain(`.n2::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: #88aaff; clip-path: polygon(evenodd, `);
    // padding keeps the words clear of the cut corners
    expect(css).toMatch(/\.n2 \{[^}]*padding: 13px 17px 6px 17px/);
    // picked colors
    expect(css).toContain('.n2.sb-sel::after { background: linear-gradient(180deg, transparent 2px, #ffffff55 2px');
    expect(css).toContain('.n2.sb-sel::before { background: #ffffff; }');
    expect(css).toContain('.n2.sb-sel { filter: drop-shadow(0 0 8px #ffdd88); }');
  });

  it('gives a picked part without colors of its own an outline and a glow', () => {
    const { css } = compileBar(bar(blocks), vars);
    // no outline normally: the picked one gets one, and the fill moves inside it
    expect(css).toMatch(/\.n3\.sb-sel::after \{ background: var\(--card\); clip-path: polygon\(/);
    expect(css).toMatch(/\.n3\.sb-sel::before \{ content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: var\(--accent\); clip-path: polygon\(evenodd/);
    expect(css).toContain('.n3.sb-sel { filter: drop-shadow(0 0 8px var(--accent)); }');
    // a picture can't take a shape: a square outline and glow instead
    expect(css).toContain('.n6.sb-sel { box-shadow: 0 0 8px var(--accent), inset 0 0 0 2px var(--accent); }');
    expect(css).not.toContain('.n6::after');
  });

  it('keeps motion and hover working with a shape', () => {
    const { css } = compileBar(bar(blocks), vars);
    expect(css).toContain('.n3 { animation: sb-breathe-f 2.4s ease-in-out infinite; }');
    expect(css).toContain('@keyframes sb-breathe-f { 50% { filter: drop-shadow(0 0 10px var(--accent)); } }');
    expect(css).toContain('.n3:hover { filter: brightness(1.15); }');
    // the moving gradient is the fill layer's; the top line over it stays put
    expect(css).toContain('.sb-btn.n4::after { background-size: 100% 100%, 200% 200%; animation: sb-flow');
    expect(css).toContain('background: linear-gradient(180deg, transparent 0px, #ffffff80 0px, #ffffff80 2px, transparent 2px), linear-gradient(90deg, var(--accent), var(--accent2))');
  });

  it('adds the top line and glow to a part without a shape', () => {
    const { css } = compileBar(bar(blocks), vars);
    expect(css).toMatch(/\.n5 \{[^}]*border-radius: 8px; box-shadow: inset 0 2px 0 #ffffff40, 0 0 8px #ff0000/);
    expect(css).toContain('.n5.sb-sel, .n5:hover { box-shadow: inset 0 2px 0 #ffffff40, 0 0 8px #00ff00; }');
  });

  it('survives ST formatting', () => {
    const rep = statusBarReplacement(compileBar(bar(blocks), vars));
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{/);
  });
});

describe('picking in the card', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    localStorage.clear();
  });
  function draw(b: Bar) {
    vi.useFakeTimers();
    const html = statusBarHtml(compileBar(b, vars, { key: 'k' }));
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    document.body.innerHTML = '<div id="sb"></div>';
    const g = globalThis as any;
    g.getCurrentMessageId = () => 3;
    g.getLastMessageId = () => 3;
    g.getVariables = () => ({ stat_data: { 技能: { 火球: { 等级: 2 }, 冰箭: { 等级: 1 } } } });
    new Function(js)();
    return document.getElementById('sb')!;
  }
  const picked = (sb: HTMLElement) => Array.from(sb.querySelectorAll('.sb-sel')).map((e) => e.textContent);

  it('picks one sibling at a time, and a second click lets go', () => {
    const sb = draw(bar([
      { id: 'a', type: 'text', text: '精', pick: true },
      { id: 'b', type: 'text', text: '气', pick: true },
      { id: 'c', type: 'text', text: '神' },
    ]));
    expect(sb.querySelectorAll('.sb-pk')).toHaveLength(2);
    (sb.querySelector('.n2') as HTMLElement).click();
    expect(picked(sb)).toEqual(['精']);
    (sb.querySelector('.n3') as HTMLElement).click();
    expect(picked(sb)).toEqual(['气']);
    (sb.querySelector('.n3') as HTMLElement).click();
    expect(picked(sb)).toEqual([]);
    (sb.querySelector('.n4') as HTMLElement).click();
    expect(picked(sb)).toEqual([]);
  });

  it('picks items of a repeat and remembers the pick', () => {
    const b = bar([{ id: 'r', type: 'repeat', bind: { var: 技能.id }, pick: true, children: [{ id: 'nm', type: 'value', bind: { var: 技能.id, part: 'name' }, label: '' }] }]);
    let sb = draw(b);
    const items = sb.querySelectorAll('.sb-item');
    expect(items).toHaveLength(2);
    (items[1] as HTMLElement).click();
    expect(picked(sb)).toEqual(['冰箭']);
    sb = draw(b);
    expect(picked(sb)).toEqual(['冰箭']);
  });

  it('still runs a picked button’s action', () => {
    const sb = draw(bar([
      { id: 'x', type: 'button', text: '显示', pick: true, action: { do: 'toggle', target: 't' } },
      { id: 't', type: 'text', text: '藏', hidden: true },
    ]));
    expect(sb.textContent).not.toContain('藏');
    (sb.querySelector('.sb-btn') as HTMLElement).click();
    expect(sb.textContent).toContain('藏');
    expect(picked(sb)).toEqual(['显示']);
  });
});
