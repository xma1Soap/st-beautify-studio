import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../lib/defaults';
import { processText } from '../lib/engine';
import { fixMarkdown, formatMessage } from '../lib/stformat';
import { fillVarMacros } from '../lib/thmacros';
import { simulate } from '../components/mvu/sim';
import { compileBar, defaultBar } from './bar';
import { buildCard, importCard, newCardProject } from './card';
import { mvuRegexes } from './regexes';
import { TEMPLATES } from './templates';
import { readTextBar, textBarHtml } from './textbar';
import type { VarNode } from './types';

const 好感度: VarNode = { id: 'a', name: '好感度', kind: 'number', rules: [], init: 10, min: 0, max: 100, stages: [{ from: 0, label: '陌生' }, { from: 50, label: '朋友' }] };
const 心情: VarNode = { id: 'b', name: '心情', kind: 'choice', rules: [], options: ['好', '坏'], init: '好' };
const 金钱: VarNode = { id: 'c', name: '金钱', kind: 'number', rules: [], init: 30, readonly: true };
const 经历: VarNode = { id: 'd', name: '重要经历', kind: 'list', rules: [], init: ['初遇', '下雨天'] };
const 人: VarNode = { id: 'e', name: '白娅', kind: 'group', rules: [], children: [好感度, 心情] };
const vars = [人, 金钱, 经历];

/** What a player sees: the regex, SillyTavern's formatting, then TavernHelper filling in the macros. */
function shown(list: VarNode[], html: string, reply = '') {
  const regexes = mvuRegexes(compileBar(defaultBar(list), list), (s) => s, html);
  const p = processText(regexes, 'hi\n\n<StatusPlaceHolderImpl/>', defaultSettings());
  const f = formatMessage(p.display, { charName: 'Char', isUser: false, blockExternalMedia: true });
  return fillVarMacros(f.html, { stat_data: simulate(list, reply, {}).data });
}

describe('plain status bar', () => {
  it('is left alone by SillyTavern and fills in every value', () => {
    const { html, problems, count } = textBarHtml(vars, undefined, { on: true });
    expect(problems).toEqual([]);
    expect(count).toBe(4);
    expect(html).not.toContain('\n');
    expect(fixMarkdown(html)).toBe(html);
    const out = shown(vars, html);
    expect(out).not.toContain('{{');
    expect(out).toContain('10 / 100（陌生）');
    expect(out).toContain('好');
    expect(out).toContain('30');
    expect(out).toMatch(/- 初遇\s*\n\s*- 下雨天/);
  });

  it('shows the values after a reply', () => {
    const { html } = textBarHtml(vars, undefined, { on: true });
    const out = shown(vars, html, '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/白娅/好感度","value":60}]</JSONPatch></UpdateVariable>');
    expect(out).toContain('60 / 100（朋友）');
  });

  it('works for every variable template', () => {
    for (const t of TEMPLATES) {
      const list = t.build();
      const { html, problems } = textBarHtml(list, undefined, { on: true });
      expect(problems, t.name).toEqual([]);
      expect(fixMarkdown(html), t.name).toBe(html);
      expect(shown(list, html), t.name).not.toContain('{{');
    }
  });

  it('leaves out hidden variables and empty groups, and can drop the heading', () => {
    const { html, count } = textBarHtml(vars, undefined, { on: true, title: '', hide: ['a', 'b'] });
    expect(count).toBe(2);
    expect(html).not.toContain('白娅');
    expect(html).not.toContain('状态');
    expect(textBarHtml(vars, undefined, { on: true, hide: ['a', 'b', 'c', 'd'] }).problems).toEqual(['纯文字状态栏里一个变量都没有']);
  });

  it('skips names the macros or the formatting would break', () => {
    const bad: VarNode = { id: 'x', name: '攻*击', kind: 'number', rules: [], init: 1 };
    const { html, problems } = textBarHtml([bad, 金钱], undefined, { on: true, title: '我的"状态"_*' });
    expect(problems.length).toBe(1);
    expect(fixMarkdown(html)).toBe(html);
    expect(html).not.toContain('攻');
  });

  it('only goes on the newest reply', () => {
    const r = mvuRegexes(compileBar(defaultBar(vars), vars), (s) => s, '<div>x</div>').find((x) => x.id === 'regex:statusBar');
    expect(r?.maxDepth).toBe(1);
    expect(mvuRegexes(compileBar(defaultBar(vars), vars), (s) => s).find((x) => x.id === 'regex:statusBar')?.maxDepth).toBeNull();
  });

  it('goes into the exported card and comes back on import', () => {
    const p = { ...newCardProject(), vars, textBar: { on: true, title: '白娅', hide: ['c'] } };
    const card = buildCard(p);
    const bar = card.data.extensions.regex_scripts.find((r: any) => r.replaceString.includes('mvu-text-bar'));
    expect(bar.maxDepth).toBe(1);
    expect(bar.replaceString).toContain('{{get_message_variable::stat_data.白娅.好感度}}');
    expect(bar.replaceString).not.toContain('金钱');
    expect(importCard(card).project.textBar).toEqual({ on: true, title: '白娅', hide: ['c'] });
    // switched off: the regular status bar again
    const off = buildCard({ ...p, textBar: { on: false } }).data.extensions.regex_scripts;
    expect(off.some((r: any) => r.replaceString.includes('mvu-text-bar'))).toBe(false);
  });

  it('keeps colors it can put in a style, and the size in range', () => {
    const { html } = textBarHtml(vars, { card: 'red"><script>', size: 99 }, { on: true });
    expect(html).not.toContain('script');
    expect(html).toContain('font-size:24px');
  });

  it('reads its settings back, dropping junk', () => {
    expect(readTextBar({ on: true, title: 'x', hide: ['a', 3] })).toEqual({ on: true, title: 'x', hide: ['a'] });
    expect(readTextBar('x')).toBeUndefined();
    expect(readTextBar({})).toEqual({ on: false });
  });
});

describe('TavernHelper variable macros in the preview', () => {
  const data = { stat_data: { a: { b: 5, $c: 1 }, s: '字', l: ['x', 'y'] } };
  it('fills get_ with text as it is and the rest as JSON, without $ keys', () => {
    expect(fillVarMacros('{{get_message_variable::stat_data.s}}|{{get_message_variable::stat_data.a}}|{{get_message_variable::stat_data.no}}', data)).toBe('字|{"b":5}|null');
  });
  it('fills format_ as YAML, indented as far as the macro sat on its line', () => {
    expect(fillVarMacros('ab{{format_message_variable::stat_data.l}}', data)).toBe('ab- x\n  - y');
    expect(fillVarMacros('{{format_message_variable::stat_data.l.1}}', data)).toBe('y');
  });
});
