import { describe, expect, it } from 'vitest';
import { cssRules, findRule, ruleStyle, sameSelector, setRuleStyle, unscopeSelector } from './cssEdit';

const multi = `<style>
.box {
  background: #222;
  /* 边框 */
  border: 1px solid #888;
}
.tag{color:#fff;padding:2px 8px}
@media (max-width: 500px) {
  .tag { font-size: 12px; }
}
@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }
</style>
<div class="box"><span class="tag">a</span></div>`;

describe('cssRules', () => {
  it('finds rules, also inside @media, not inside @keyframes', () => {
    expect(cssRules(multi).map((r) => r.sel)).toEqual(['.box', '.tag', '.tag']);
  });
  it('reads a rule, comments and all', () => {
    const [box, tag] = cssRules(multi);
    expect(ruleStyle(multi, box)).toEqual({ background: '#222', border: '1px solid #888' });
    expect(ruleStyle(multi, tag)).toEqual({ color: '#fff', padding: '2px 8px' });
  });
  it('reads the <style> inside a front-end card', () => {
    const card = '```html\n<html><head><style>.a{color:red}</style></head><body><div class="a">x</div></body></html>\n```';
    expect(cssRules(card).map((r) => r.sel)).toEqual(['.a']);
  });
  it('does not trip on braces in strings', () => {
    const s = '<style>.a::before{content:"}{";color:red}.b{color:blue}</style>';
    expect(cssRules(s).map((r) => r.sel)).toEqual(['.a::before', '.b']);
    expect(ruleStyle(s, cssRules(s)[0]).color).toBe('red');
  });
});

describe('setRuleStyle', () => {
  it('changes a value in place', () => {
    const out = setRuleStyle(multi, 0, { background: '#c0392b' });
    expect(out).toContain('  background: #c0392b;\n  /* 边框 */');
  });
  it('adds to a multi-line rule on a line of its own, indented like the others', () => {
    const out = setRuleStyle(multi, 0, { color: 'gold' });
    expect(out).toContain('  border: 1px solid #888;\n  color: gold;\n}');
  });
  it('adds to a one-line rule the way it is written', () => {
    expect(setRuleStyle(multi, 1, { 'border-radius': '99px' })).toContain('.tag{color:#fff;padding:2px 8px;border-radius:99px}');
    const spaced = '<style>.a { color: red; }</style>';
    expect(setRuleStyle(spaced, 0, { margin: '0' })).toBe('<style>.a { color: red; margin: 0; }</style>');
    expect(setRuleStyle('<style>.a{}</style>', 0, { color: 'red' })).toBe('<style>.a{color: red;}</style>');
  });
  it('takes a property away, with its line', () => {
    const out = setRuleStyle(multi, 0, { border: '' });
    expect(out).toContain('.box {\n  background: #222;\n  /* 边框 */\n}');
    expect(setRuleStyle(multi, 1, { color: undefined })).toContain('.tag{padding:2px 8px}');
  });
  it('keeps !important', () => {
    const s = '<style>.a{color:red !important}</style>';
    expect(setRuleStyle(s, 0, { color: 'blue' })).toBe('<style>.a{color:blue !important}</style>');
  });
  it('changes the rule inside @media', () => {
    expect(setRuleStyle(multi, 2, { 'font-size': '13px' })).toContain('.tag { font-size: 13px; }');
  });
});

describe('finding the rule the preview names', () => {
  it('compares selectors the way the browser writes them', () => {
    expect(sameSelector('.a>.b ,  .c   span')).toBe(sameSelector('.a > .b, .c span'));
    expect(sameSelector("[data-v='x']")).toBe(sameSelector('[data-v="x"]'));
  });
  it('undoes what SillyTavern does to a message <style>', () => {
    expect(unscopeSelector('.mes_text .custom-box .custom-tag')).toBe('.box .tag');
    expect(unscopeSelector('.mes_text .custom-a, .mes_text .custom-b > span')).toBe('.a, .b > span');
  });
  it('finds the rule with that selector, at the top or in the same @media', () => {
    expect(findRule(multi, '.tag')).toBe(1);
    expect(findRule(multi, '.tag', '(max-width:500px)')).toBe(2);
    expect(findRule(multi, '.mes_text .custom-box')).toBe(0);
    expect(findRule(multi, '.nope')).toBe(-1);
    // two rules with the same selector: the later one wins in CSS
    expect(findRule('<style>.a{color:red}.a{color:blue}</style>', '.a')).toBe(1);
  });
});
