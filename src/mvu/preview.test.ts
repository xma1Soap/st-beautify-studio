import { describe, expect, it } from 'vitest';
import { newScript } from '../lib/defaults';
import { simulate } from '../components/mvu/sim';
import { newCardProject, PLACEHOLDER } from './card';
import { previewRegexes, previewSettings, processFloors, simFloors, USER_STAND_IN } from './preview';
import type { VarNode } from './types';

const 好感度: VarNode = { id: 'a', name: '好感度', kind: 'number', rules: [], init: 10, min: 0, max: 100 };
const vars = [好感度];
const set = (v: number) => `回复\n<UpdateVariable><JSONPatch>[{"op":"replace","path":"/好感度","value":${v}}]</JSONPatch></UpdateVariable>`;

describe('the simulated chat', () => {
  it('is the greeting, then what the player said and each reply, each with its own variables', () => {
    const replies = [set(30), set(60)];
    const sim = simulate(vars, replies);
    const f = simFloors({ greeting: '你好', barOnGreeting: false, start: sim.start, replies, users: ['我来了', ''], after: sim.after! });
    expect(f.map((x) => [x.ai, x.text.slice(0, 4), (x.stat as any)?.好感度])).toEqual([
      [true, '你好', 10],
      [false, '我来了', 10],
      [true, '回复\n<', 30],
      [false, USER_STAND_IN.slice(0, 4), 30],
      [true, '回复\n<', 60],
    ]);
    expect(f[0].bar).toBe(false);
    expect(f[2].bar).toBe(true);
  });
  it('is just the greeting before anything is pasted', () => {
    const sim = simulate(vars, ['']);
    expect(simFloors({ greeting: '你好', barOnGreeting: true, start: sim.start, replies: [''], users: [''], after: sim.after!, last: { 好感度: 5 } })).toEqual([
      { text: '你好', ai: true, stat: { 好感度: 5 }, bar: true },
    ]);
  });
});

describe('each message through the regexes', () => {
  const s = previewSettings('白娅', 'desktop');
  it('puts MVU’s placeholder only after AI replies, and shows the plain status bar only on the newest reply', () => {
    const p = { ...newCardProject(), vars, textBar: { on: true, title: '状态' } };
    const replies = [set(30), set(60)];
    const sim = simulate(vars, replies);
    const floors = simFloors({ greeting: '你好', barOnGreeting: true, start: sim.start, replies, users: ['我来了', '再见'], after: sim.after! });
    const out = processFloors(previewRegexes(p), floors, s);
    expect(out.map((x) => x.raw.includes(PLACEHOLDER))).toEqual([true, false, true, false, true]);
    // depth 4, 3, 2, 1, 0: the plain bar's regex works at depth 0–1 only
    expect(out.map((x) => x.display.includes('get_message_variable') || x.display.includes('format_message_variable'))).toEqual([false, false, false, false, true]);
  });
  it('runs a regex only on the messages it is for (whose, and how deep)', () => {
    const user = { ...newScript('玩家'), findRegex: '/我/g', replaceString: '[我]', placement: [1] };
    const old = { ...newScript('旧'), findRegex: '/回复/g', replaceString: '旧回复', minDepth: 2 };
    const floors = [
      { text: '回复', ai: true },
      { text: '我说', ai: false },
      { text: '回复', ai: true },
    ];
    const out = processFloors([user, old], floors, s);
    expect(out.map((x) => x.display)).toEqual([`旧回复\n\n${PLACEHOLDER}`, '[我]说', `回复\n\n${PLACEHOLDER}`]);
  });
});
