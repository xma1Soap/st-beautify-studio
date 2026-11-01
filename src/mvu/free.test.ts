import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixMarkdown } from '../lib/stformat';
import { compileBar, defaultBar, type Bar, type BarNode } from './bar';
import { cleanAt, dropAt, fitHeight, freeSize, isFree, partsBottom, snap1, toFree, underAll } from './free';
import { statusBarHtml, statusBarReplacement } from './statusbar';

const bar = (children: BarNode[]): Bar => ({ ...defaultBar([]), root: { id: 'root', type: 'box', dir: 'col', children } });
const box = (p: Partial<BarNode> = {}): BarNode => ({ id: 'f', type: 'box', dir: 'free', children: [], ...p });
const text = (id: string, at?: BarNode['at']): BarNode => ({ id, type: 'text', text: id, ...(at ? { at } : {}) });

describe('free layout sizes and positions', () => {
  it('has a default size and keeps sizes within reason', () => {
    expect(freeSize(box())).toEqual({ w: 600, h: 200, stack: 0 });
    expect(freeSize(box({ freeW: 10, freeH: 99999, stackBelow: 50 }))).toEqual({ w: 40, h: 4000, stack: 100 });
    expect(freeSize(box({ freeW: 333.6, freeH: 120.2, stackBelow: 420 }))).toEqual({ w: 334, h: 120, stack: 420 });
  });
  it('knows a free box', () => {
    expect(isFree(box())).toBe(true);
    expect(isFree({ ...box(), dir: 'row' })).toBe(false);
    expect(isFree({ id: 'r', type: 'repeat', dir: 'free' } as BarNode)).toBe(false);
    expect(isFree(null)).toBe(false);
  });
  it('keeps whole px and only real sizes', () => {
    expect(cleanAt({ x: 1.4, y: 2.6, w: 3, h: 0 })).toEqual({ x: 1, y: 3, w: 8 });
    expect(cleanAt({ x: -5, y: 0, w: 120.4, h: 30.5 })).toEqual({ x: -5, y: 0, w: 120, h: 31 });
  });
  it('drops a new part inside the box, at a width unless it has its own', () => {
    const b = box();
    expect(dropAt(text('t'), 500, 190, b)).toEqual({ x: 400, y: 180, w: 200 });
    expect(dropAt({ id: 'b', type: 'button', text: 'b' }, 590, 5, b)).toEqual({ x: 560, y: 5 });
    expect(dropAt(text('t'), -20, 10, b, { w: 120, h: 30 })).toEqual({ x: 0, y: 10, w: 120 });
  });
  it('turns a box free without moving anything, even when it is drawn smaller', () => {
    const b: BarNode = { id: 'b', type: 'box', dir: 'col', gap: 4, children: [text('a'), text('b'), text('c')] };
    const out = toFree(b, { x: 100, y: 50, w: 300, h: 100 }, 600, [
      { x: 100, y: 50, w: 300, h: 20 },
      { x: 250, y: 80, w: 100, h: 10 },
      undefined,
    ]);
    expect(out.dir).toBe('free');
    expect(out.freeW).toBe(600);
    expect(out.freeH).toBe(200);
    expect(out.children.map((k) => k.at)).toEqual([
      { x: 0, y: 0, w: 600 },
      { x: 300, y: 60, w: 200 },
      // not drawn (hidden): under the rest
      { x: 0, y: 88, w: 200 },
    ]);
    expect(out.children[0].text).toBe('a');
  });
  it('fits the height to the parts', () => {
    const b = box({ freeW: 600 });
    expect(fitHeight(b, { x: 0, y: 10, w: 300, h: 100 }, [{ x: 0, y: 50, w: 50, h: 20 }, undefined])).toBe(124);
    expect(fitHeight(b, { x: 0, y: 0, w: 600, h: 100 }, [])).toBe(40);
  });
  it('puts parts added without a point under what is there, growing the box to fit', () => {
    const b = box({ freeH: 100, children: [text('a', { x: 0, y: 0, h: 30 }), text('b', { x: 300, y: 40 })] });
    // not drawn: from where the parts are put (24 px when they have no height)
    expect(partsBottom(b)).toBe(64);
    // drawn at half size
    expect(partsBottom(b, { x: 10, y: 10, w: 300, h: 50 }, [{ x: 10, y: 10, w: 100, h: 15 }, { x: 160, y: 30, w: 50, h: 20 }])).toBe(80);
    expect(underAll([text('c')], b, 64)).toEqual({ nodes: [{ ...text('c'), at: { x: 0, y: 72, w: 200 } }], freeH: 104 });
    expect(underAll([text('c')], { ...b, freeH: 200 }, 64).freeH).toBeUndefined();
    const two = underAll([text('c'), { id: 'd', type: 'button', text: 'd' }], b, 64);
    expect(two.nodes.map((n) => n.at)).toEqual([{ x: 0, y: 72, w: 200 }, { x: 0, y: 104 }]);
    expect(two.freeH).toBe(136);
    // an empty box: from the top
    expect(underAll([text('c')], box(), 0).nodes[0].at).toEqual({ x: 0, y: 0, w: 200 });
  });
  it('snaps to the nearest line within reach', () => {
    expect(snap1([0, 50, 100], [52, 300], 6)).toEqual({ d: 2, at: 52 });
    expect(snap1([0, 50, 100], [96, 53], 6)).toEqual({ d: 3, at: 53 });
    expect(snap1([0], [10], 6)).toBeNull();
  });
});

const parts = (): BarNode =>
  box({ freeW: 400, freeH: 120, stackBelow: 300, gap: 12, children: [text('甲', { x: 200, y: 10, w: 100 }), text('乙', { x: 0, y: 0 }), text('丙', { x: 20, y: 60, w: 80, h: 30 })] });

describe('free layout CSS', () => {
  it('sizes the stage and places every part', () => {
    const { css, problems } = compileBar(bar([parts()]), []);
    expect(problems).toEqual([]);
    expect(css).toContain('.n2 > .sb-fs { width: 400px; height: 120px; }');
    expect(css).toContain('.n2 > .sb-fs > .n3 { position: absolute; left: 200px; top: 10px; width: 100px; }');
    expect(css).toContain('.n2 > .sb-fs > .n4 { position: absolute; left: 0px; top: 0px; }');
    expect(css).toContain('.n2 > .sb-fs > .n5 { position: absolute; left: 20px; top: 60px; width: 80px; height: 30px; }');
    expect(css).toContain('.n2.sb-stack > .sb-fs { gap: 12px; }');
  });
  it('stacks the parts top to bottom in the order they are on the box', () => {
    const { css } = compileBar(bar([parts()]), []);
    expect(css).toContain('.n2.sb-stack > .sb-fs > .n3 { order: 1; }');
    expect(css).toContain('.n2.sb-stack > .sb-fs > .n4 { order: 0; }');
    // already in place: no rule
    expect(css).not.toContain('.n2.sb-stack > .sb-fs > .n5');
  });
  it('keeps a stray position from taking the part far away', () => {
    const { css } = compileBar(bar([box({ children: [text('x', { x: 99999, y: -99999 })] })]), []);
    expect(css).toContain('.n2 > .sb-fs > .n3 { position: absolute; left: 1200px; top: -200px; }');
  });
  it('survives ST formatting', () => {
    const rep = statusBarReplacement(compileBar(bar([parts()]), [], { key: 'k' }));
    expect(fixMarkdown(rep)).toBe(rep);
    expect(rep).not.toMatch(/\$\d|\$<|\{\{/);
  });
});

describe('free layout in the card', () => {
  let width = 0;
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as any).clientWidth;
  });
  function draw(b: Bar) {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('sb-free') ? width : 0;
      },
    });
    const html = statusBarHtml(compileBar(b, [], { key: 'k' }));
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    document.body.innerHTML = '<div id="sb"></div>';
    const g = globalThis as any;
    g.getCurrentMessageId = () => 0;
    g.getLastMessageId = () => 0;
    g.getVariables = () => ({ stat_data: {} });
    new Function(js)();
    return document.getElementById('sb')!;
  }

  it('draws the parts on a stage and scales it evenly to the width', () => {
    width = 500;
    const sb = draw(bar([parts()]));
    const f = sb.querySelector('.sb-free') as HTMLElement;
    const stage = f.firstChild as HTMLElement;
    expect(stage.className).toBe('sb-fs');
    expect(Array.from(stage.children).map((e) => e.textContent)).toEqual(['甲', '乙', '丙']);
    expect(f.classList.contains('sb-stack')).toBe(false);
    expect(stage.style.transform).toBe('scale(1.25)');
    expect(stage.style.marginRight).toBe('100px');
    expect(stage.style.marginBottom).toBe('30px');
    // a phone: smaller than where it stacks
    width = 200;
    dispatchEvent(new Event('resize'));
    expect(f.classList.contains('sb-stack')).toBe(true);
    expect(stage.style.transform).toBe('');
    width = 350;
    dispatchEvent(new Event('resize'));
    expect(f.classList.contains('sb-stack')).toBe(false);
    expect(stage.style.transform).toBe('scale(0.875)');
  });
});
