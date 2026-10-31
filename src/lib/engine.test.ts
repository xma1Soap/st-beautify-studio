import { describe, expect, it } from 'vitest';
import { genSample, groupCount, parseRegex, processText, runScript, skipReason } from './engine';
import { newScript, defaultSettings } from './defaults';
import type { RegexScript } from './types';

const m = { user: 'User', char: 'Char' };
const script = (p: Partial<RegexScript>): RegexScript => ({ ...newScript(), ...p });

describe('parseRegex', () => {
  it('reads /source/flags like SillyTavern', () => {
    const { re } = parseRegex('/a(b)c/gi');
    expect(re?.source).toBe('a(b)c');
    expect(re?.flags).toBe('gi');
  });
  it('reports invalid patterns', () => {
    expect(parseRegex('/(/g').err).toBeTruthy();
  });
});

describe('runScript', () => {
  it('fills $1, {{match}} and macros', () => {
    const sc = script({ findRegex: '/<b>(.*?)<\\/b>/g', replaceString: '[$1|{{match}}|{{char}}]' });
    expect(runScript(sc, 'x<b>hi</b>y', m).out).toBe('x[hi|<b>hi</b>|Char]y');
  });
  it('applies trim strings to captured text only', () => {
    const sc = script({ findRegex: '/<b>(.*?)<\\/b>/g', replaceString: '[$1]', trimStrings: ['"'] });
    expect(runScript(sc, '<b>"hi"</b>', m).out).toBe('[hi]');
  });
  it('turns a missing group into an empty string', () => {
    const sc = script({ findRegex: '/<b>(x)?(.*?)<\\/b>/g', replaceString: '[$1|$2]' });
    expect(runScript(sc, '<b>hi</b>', m).out).toBe('[|hi]');
  });
  it('counts groups', () => {
    expect(groupCount(script({ findRegex: '/(a)(?:b)(c)/' }), m)).toBe(2);
  });
});

describe('processText', () => {
  it('runs display-only scripts on the shown text but not the stored text', () => {
    const sc = script({ findRegex: '/a/g', replaceString: 'b', markdownOnly: true });
    const r = processText([sc], 'aa', defaultSettings());
    expect(r.raw).toBe('aa');
    expect(r.display).toBe('bb');
  });
  it('skips prompt-only scripts and scripts outside their depth', () => {
    const s = defaultSettings();
    expect(skipReason(script({ promptOnly: true, markdownOnly: false }), s)).not.toBe('');
    expect(skipReason(script({ minDepth: 2 }), { ...s, depth: 0 })).not.toBe('');
    expect(skipReason(script({ minDepth: 2 }), { ...s, depth: 3 })).toBe('');
  });
});

describe('genSample', () => {
  it('produces text the regex matches', () => {
    const sc = newScript();
    const t = genSample(sc, m);
    expect(runScript(sc, t, m).hits).toBe(1);
  });
});

// The pattern the visual builder will generate for a block with fields (see PLAN.md):
// fields may come in any order and any of them may be missing without the whole block failing to match.
describe('field pattern for the builder', () => {
  const tag = '状态栏';
  const end = `<\\/${tag}>`;
  const body = `(?:(?!${end})[\\s\\S])*?`;
  const field = (f: string) =>
    `(?=(?:${body}(?:^|\\n|(?<=<${tag}>))\\s*(?:[-*]\\s*)?(?:\\*\\*)?${f}(?:\\*\\*)?\\s*[:：]\\s*([^\\n<]*?)\\s*(?=\\n|${end}))?)`;
  const find = `/<${tag}>${['时间', '地点', '好感'].map(field).join('')}${body}${end}/gm`;
  const sc = script({ findRegex: find, replaceString: '[$1|$2|$3]' });

  it('reads fields in any order, with list marks and bold names', () => {
    expect(runScript(sc, `<${tag}>\n- **地点**：酒馆\n好感: 80\n时间：黄昏\n</${tag}>`, m).out).toBe('[黄昏|酒馆|80]');
  });
  it('leaves a missing field empty instead of failing', () => {
    expect(runScript(sc, `<${tag}>\n时间：黄昏\n</${tag}>`, m).out).toBe('[黄昏||]');
  });
  it('handles several blocks in one message separately', () => {
    expect(runScript(sc, `<${tag}>时间：早</${tag}>x<${tag}>地点：林</${tag}>`, m).out).toBe('[早||]x[|林|]');
  });

  it('splits a list field into chips', () => {
    const chips = script({ findRegex: '/(?<=<span class="x-items">[^<]*)、/g', replaceString: '</span><span class="x-items">' });
    expect(runScript(chips, '<span class="x-items">剑、盾、药</span>', m).out).toBe(
      '<span class="x-items">剑</span><span class="x-items">盾</span><span class="x-items">药</span>',
    );
  });
});
