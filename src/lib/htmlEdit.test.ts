import { describe, expect, it } from 'vitest';
import { annotate, getStyle, leafText, moveEl, parseStyle, parseTags, setLeafText, setStyle, siblings } from './htmlEdit';

const card = `<style>
.box > p { color: red }
</style>
<div class="box" style="padding: 8px">
  <b>时间：</b><span>$1</span>
  <p>第一行</p>
  <p>第二行<br>还有</p>
  <img src="a.png">
</div>`;

describe('reading the code', () => {
  it('finds every element, what closes it and what is inside it', () => {
    const els = parseTags(card);
    expect(els.map((e) => e.name)).toEqual(['style', 'div', 'b', 'span', 'p', 'p', 'br', 'img']);
    const div = els[1];
    expect(card.slice(div.start, div.end)).toMatch(/^<div[\s\S]*<\/div>$/);
    expect(div.children).toEqual([2, 3, 4, 5, 7]);
    expect(els[6].parent).toBe(5);
    // a style block is text: the > in it is not a tag
    expect(card.slice(els[0].openEnd, els[0].closeStart)).toContain('.box > p');
  });
  it('closes tags nobody closed where their parent ends', () => {
    const els = parseTags('<ul><li>a<li>b</ul><p>c');
    expect(els.map((e) => [e.name, e.parent])).toEqual([['ul', -1], ['li', 0], ['li', 1], ['p', -1]]);
    expect(els[2].end).toBe('<ul><li>a<li>b'.length);
    expect(els[3].end).toBe('<ul><li>a<li>b</ul><p>c'.length);
  });
  it('is not fooled by > in attribute values or comments', () => {
    const els = parseTags(`<div title="a > b" data-x='<i>'><!-- <span> --><i>x</i></div>`);
    expect(els.map((e) => e.name)).toEqual(['div', 'i']);
  });
});

describe('numbering for the preview', () => {
  it('marks what can be picked and leaves <style> alone (ST only knows a bare one)', () => {
    const out = annotate(card);
    expect(out).toContain('<style>\n');
    expect(out).toContain('<div class="box" style="padding: 8px" data-stbs-e="1">');
    expect(out).toContain('<span data-stbs-e="3">$1</span>');
    expect(out).toContain('<br>');
    expect(out).toContain('<img src="a.png" data-stbs-e="7">');
    // nothing else changes
    expect(out.replace(/ data-stbs-e="\d+"/g, '')).toBe(card);
  });
  it('keeps self-closing tags closed', () => {
    expect(annotate('<hr/><img src=x />')).toBe('<hr data-stbs-e="0"/><img src=x data-stbs-e="1" />');
  });
});

describe('style', () => {
  it('reads and changes the style attribute, keeping the rest', () => {
    expect(getStyle(card, 1)).toEqual({ padding: '8px' });
    const out = setStyle(card, 1, { color: '#fff', padding: '12px 4px' });
    expect(out).toContain('<div class="box" style="padding: 12px 4px; color: #fff">');
    expect(setStyle(out, 1, { padding: undefined, color: '' })).toContain('<div class="box">');
  });
  it('adds one where there is none', () => {
    expect(setStyle(card, 2, { 'font-size': '18px' })).toContain('<b style="font-size: 18px">时间：</b>');
    expect(setStyle('<hr/>', 0, { border: '0' })).toBe('<hr style="border: 0"/>');
  });
  it('keeps values with ; and quotes in one piece', () => {
    expect(parseStyle(`background: url("data:a;b"); font-family: 'A; B', serif`)).toEqual([
      ['background', 'url("data:a;b")'],
      ['font-family', `'A; B', serif`],
    ]);
    const out = setStyle(`<p style="color: red">x</p>`, 0, { 'font-family': '"Kai", serif' });
    expect(out).toBe(`<p style="color: red; font-family: 'Kai', serif">x</p>`);
  });
});

describe('text', () => {
  it('changes the text of an element that only holds text', () => {
    expect(leafText(card, 4)).toBe('第一行');
    expect(leafText(card, 3)).toBe('$1');
    expect(leafText(card, 5)).toBeNull();
    expect(leafText(card, 1)).toBeNull();
    expect(leafText(card, 7)).toBeNull();
    const out = setLeafText(card, 4, '换 <b>');
    expect(out).toContain('<p>换 &lt;b></p>');
    expect(parseTags(out)).toHaveLength(parseTags(card).length);
  });
});

describe('moving', () => {
  it('knows the siblings it can trade places with', () => {
    expect(siblings(card, 4)).toEqual({ prev: 3, next: 5 });
    expect(siblings(card, 1)).toEqual({});
  });
  it('moves whole lines when the element has them to itself', () => {
    const r = moveEl(card, 5, 4, false)!;
    expect(r.src).toContain('  <p>第二行<br>还有</p>\n  <p>第一行</p>\n');
    expect(parseTags(r.src)[r.n].name).toBe('p');
    expect(leafText(r.src, r.n + 2)).toBe('第一行');
    const back = moveEl(r.src, r.n, r.n + 2, true)!;
    expect(back.src).toBe(card);
  });
  it('moves just the element when it shares the line', () => {
    const r = moveEl(card, 3, 2, false)!;
    expect(r.src).toContain('  <span>$1</span><b>时间：</b>\n');
    expect(r.n).toBe(2);
  });
  it('moves to the end of the code without losing the line break', () => {
    const src = '<p>a</p>\n<p>b</p>';
    expect(moveEl(src, 0, 1, true)!.src).toBe('<p>b</p>\n<p>a</p>');
  });
  it('only among siblings', () => {
    expect(moveEl(card, 6, 4, true)).toBeNull();
    expect(moveEl(card, 4, 4, true)).toBeNull();
  });
});
