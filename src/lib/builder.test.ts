import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BarNode } from '../mvu/bar';
import { newVar } from '../mvu/tree';
import type { VarNode } from '../mvu/types';
import { builderFind, builderPrompt, builderSample, cleanTag, compileBuilder, isBuilt, newBuilder, readBuilder, type RegexBuilder } from './builder';
import { newScript } from './defaults';
import { runScript } from './engine';
import { fixMarkdown } from './stformat';

const m = { user: 'User', char: 'Char' };
const field = (name: string, kind: VarNode['kind'], p: Partial<VarNode> = {}): VarNode => ({ ...newVar(kind), name, ...p });

const fields = [
  field('时间', 'text', { init: '黄昏' }),
  field('好感', 'number', { init: 40, min: 0, max: 100 }),
  field('心情', 'choice', { options: ['平静', '开心'], init: '平静' }),
  field('受伤', 'bool', { init: false }),
  field('物品', 'list', { init: ['剑'] }),
];
const value = (id: string, f: VarNode): BarNode => ({ id, type: 'value', bind: { var: f.id } });
const b: RegexBuilder = {
  v: 1,
  key: 'k',
  tag: '状态栏',
  fields,
  bar: {
    v: 1,
    root: {
      id: 'root',
      type: 'box',
      dir: 'col',
      children: [
        value('t', fields[0]),
        { id: 'h', type: 'bar', bind: { var: fields[1].id } },
        value('x', fields[2]),
        value('y', fields[3]),
        value('z', fields[4]),
      ],
    },
  },
};

/** The regex run on a message, like ST does. */
const run = (text: string, bb = b) => {
  const c = compileBuilder(bb);
  return runScript({ ...newScript(), findRegex: c.findRegex, replaceString: c.replaceString }, text, m);
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  localStorage.clear();
});

/** Runs a card the regex made (as TavernHelper would) and returns what it drew. */
function draw(out: string) {
  const html = out.slice(out.indexOf('```html\n') + 8, out.lastIndexOf('\n```'));
  vi.useFakeTimers();
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>'));
  new Function(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')))();
  return document.getElementById('sb')!;
}

describe('finding the fields', () => {
  const groups = (text: string) => run(text).matches[0]?.groups;
  it('reads them in any order, with bold names, list marks and either colon', () => {
    expect(groups('<状态栏>\n- **好感**：80\n物品: 剑、盾\n时间：黄昏\n</状态栏>')).toEqual(['黄昏', '80', undefined, undefined, '剑、盾']);
    expect(groups('<状态栏>\n**时间：**清晨\n心情：**开心**\n受伤：是\n</状态栏>')).toEqual(['清晨', undefined, '开心', '是', undefined]);
  });
  it('leaves a missing field empty and finds each block of a message on its own', () => {
    const r = run('a<状态栏>时间：早</状态栏>b<状态栏>\n好感：3\n</状态栏>');
    expect(r.hits).toBe(2);
    expect(r.matches.map((x) => x.groups[0] ?? null)).toEqual(['早', null]);
  });
  it('does not take a field that only starts the same', () => {
    const r = runScript({ ...newScript(), findRegex: builderFind('s', [field('好感', 'number')]), replaceString: '[$1]' }, '<s>\n好感度：9\n</s>', m);
    expect(r.out).toBe('[]');
  });
  it('keeps the tag usable', () => {
    expect(cleanTag(' 状 态/栏<> ')).toBe('状态栏');
    expect(cleanTag('')).toBe('状态栏');
  });
});

describe('the card it makes', () => {
  it('shows what the AI wrote, numbers taken out of words', () => {
    const sb = draw(run('<状态栏>\n时间：深夜\n好感：约 80 点\n心情：开心\n受伤：是\n物品：剑、盾\n</状态栏>').out);
    const text = sb.textContent!;
    for (const s of ['深夜', '80', '开心', '剑', '盾']) expect(text).toContain(s);
    expect((sb.querySelector('.sb-fill') as HTMLElement).style.width).toBe('80%');
  });
  it('survives ST formatting, also with what the AI wrote in it', () => {
    const c = compileBuilder(b);
    expect(fixMarkdown(c.replaceString)).toBe(c.replaceString);
    expect(c.replaceString.replace(/\$[1-5]/g, '')).not.toMatch(/\$\d|\$<|\{\{/);
    expect(c.replaceString.slice(3, -3)).not.toContain('`');
    // an odd quote in a value: ST adds one at the end of that line, which must not show up
    const out = fixMarkdown(run('<状态栏>\n时间：他说"走\n</状态栏>').out);
    const sb = draw(out);
    expect(sb.textContent).toContain('他说"走');
    expect(document.body.textContent).not.toMatch(/^\s*"/);
  });
  it('reports parts that need MVU', () => {
    const withEdit: RegexBuilder = { ...b, bar: { v: 1, root: { id: 'r', type: 'box', children: [{ id: 'e', type: 'button', text: '改', action: { do: 'edit' } }] } } };
    expect(compileBuilder(withEdit).problems.length).toBeGreaterThan(0);
  });
});

describe('opening it again', () => {
  it('keeps the layout in the regex', () => {
    const c = compileBuilder(b);
    expect(isBuilt(c.replaceString)).toBe(true);
    const r = readBuilder(c);
    expect(r?.edited).toBe(false);
    expect(r?.b.tag).toBe('状态栏');
    expect(r?.b.fields.map((f) => f.name)).toEqual(fields.map((f) => f.name));
    expect(r?.b.bar).toEqual(b.bar);
  });
  it('notices code changed by hand', () => {
    const c = compileBuilder(b);
    expect(readBuilder({ ...c, replaceString: c.replaceString.replace('<div id="sb">', '<div id="sb" class="x">') })?.edited).toBe(true);
    expect(readBuilder({ ...c, findRegex: c.findRegex.replace('gm', 'g') })?.edited).toBe(true);
  });
  it('ignores regexes made by hand', () => {
    expect(readBuilder(newScript())).toBeNull();
    expect(readBuilder({ findRegex: '', replaceString: '<!--stbs-builder:x:@@@-->' })).toBeNull();
  });
});

describe('telling the AI', () => {
  it('lists every field with what it holds, and a sample', () => {
    const p = builderPrompt(b);
    expect(p).toContain('<状态栏>');
    expect(p).toContain('好感：（数字（0～100），整数）');
    expect(p).toContain('心情：（从这几个里选一个：平静 / 开心）');
    expect(builderSample(b)).toBe('<状态栏>\n时间：黄昏\n好感：40\n心情：平静\n受伤：否\n物品：剑\n</状态栏>');
  });
  it('starts a new one that already works', () => {
    const nb = newBuilder();
    const r = run(builderSample(nb), nb);
    expect(r.hits).toBe(1);
    expect(draw(r.out).textContent).toContain('月影酒馆');
  });
});
