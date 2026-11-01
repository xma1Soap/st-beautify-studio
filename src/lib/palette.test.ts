import { describe, expect, it } from 'vitest';
import { adjustColors, findColors, mainHue, palette, swapColor, turnTo } from './palette';

const card = `<div style="background:linear-gradient(135deg,#2b2440,#1E2A3A);border:1px solid #5b4b8a;color:#e8e4ff;box-shadow:0 4px 14px rgba(0,0,0,.25)">
<b style="color: #c9b8ff">✦</b> &#123; <a href="#top">x</a>
<span style="color:hsl(260, 80%, 70%)">A</span><i style="background:rgb(91 75 138 / 50%)">B</i><u style="color:#5b4b8a80">C</u>
</div>`;

describe('finding colors', () => {
  it('finds hex, rgb() and hsl(), and nothing that only looks like one', () => {
    expect(findColors(card).map((h) => h.text)).toEqual([
      '#2b2440',
      '#1E2A3A',
      '#5b4b8a',
      '#e8e4ff',
      'rgba(0,0,0,.25)',
      '#c9b8ff',
      'hsl(260, 80%, 70%)',
      'rgb(91 75 138 / 50%)',
      '#5b4b8a80',
    ]);
  });
  it('lists them most used first, the same color counted once', () => {
    const p = palette(card);
    expect(p[0]).toEqual({ key: '#5b4b8a', count: 3 });
    expect(p.map((c) => c.key)).toContain('#1e2a3a');
    expect(p).toHaveLength(7);
  });
  it('finds what a front-end card writes in its script too', () => {
    expect(findColors("```html\n<script>el.style.color='#ff0000'</script>\n```").map((h) => h.text)).toEqual(['#ff0000']);
  });
});

describe('changing them', () => {
  it('swaps one color everywhere, keeping how each was written', () => {
    const out = swapColor(card, '#5b4b8a', '#336699');
    expect(out).toContain('border:1px solid #336699;');
    expect(out).toContain('rgb(51 102 153 / 0.5)');
    expect(out).toContain('color:#33669980');
    expect(out).toContain('#2b2440');
  });
  it('turns hues and leaves greys alone', () => {
    expect(adjustColors('a{color:#ff0000;background:#808080;border-color:rgba(255,0,0,.5)}', { hue: 120 })).toBe(
      'a{color:#00ff00;background:#808080;border-color:rgba(0, 255, 0, 0.5)}',
    );
    expect(adjustColors('#ff0000 hsl(0, 100%, 50%)', { hue: 240 })).toBe('#0000ff hsl(240, 100%, 50%)');
  });
  it('turns dark into light', () => {
    expect(adjustColors('#000000 #ffffff #1a1a1a', { invert: true })).toBe('#ffffff #000000 #e5e5e5');
    // shadows stay shadows, and what doesn't change keeps how it was written
    expect(adjustColors('box-shadow:0 4px 14px rgba(0,0,0,.25);color:#fff', { invert: true })).toBe('box-shadow:0 4px 14px rgba(0,0,0,.25);color:#000000');
  });
  it('knows the main hue, and how far to turn it to reach another', () => {
    expect(Math.round(mainHue(card)!)).toBeGreaterThan(240);
    expect(Math.round(mainHue(card)!)).toBeLessThan(275);
    expect(mainHue('#000 #fff #888')).toBeNull();
    expect(turnTo('#ff0000', 120)).toBe(120);
    expect(turnTo('#ff0000', 300)).toBe(-60);
  });
  it('leaves the code alone when nothing changes', () => {
    expect(adjustColors(card, {})).toBe(card);
    expect(swapColor(card, '#123456', '#000000')).toBe(card);
  });
});
