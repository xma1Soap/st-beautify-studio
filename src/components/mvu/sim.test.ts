import { describe, expect, it } from 'vitest';
import type { VarNode } from '../../mvu/types';
import { simulate, tweakable } from './sim';

const 好感度: VarNode = { id: 'a', name: '好感度', kind: 'number', rules: [], init: 10, min: 0, max: 100, stages: [{ from: 0, label: '陌生' }, { from: 50, label: '朋友' }] };
const 心情: VarNode = { id: 'b', name: '心情', kind: 'choice', rules: [], options: ['好', '坏'], init: '好' };
const 物品: VarNode = { id: 'c', name: '物品', kind: 'table', rules: [], init: {}, children: [{ id: 'd', name: '数量', kind: 'number', rules: [] }] };
const 人: VarNode = { id: 'e', name: '白娅', kind: 'group', rules: [], children: [好感度, 心情, 物品] };

describe('values changed by hand', () => {
  it('lists what can be changed, without tables', () => {
    expect(tweakable([人]).map((t) => t.label)).toEqual(['白娅 › 好感度', '白娅 › 心情']);
  });
  it('puts them in, keeps numbers in range and works out the stage', () => {
    const d = simulate([人], '', { a: 70, b: '坏' }).data as any;
    expect(d.白娅).toMatchObject({ 好感度: 70, $好感度阶段: '朋友', 心情: '坏' });
    expect((simulate([人], '', { a: 500 }).data as any).白娅.好感度).toBe(100);
  });
  it('goes on top of the simulated AI reply', () => {
    const reply = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/白娅/心情","value":"坏"},{"op":"replace","path":"/白娅/好感度","value":20}]</JSONPatch></UpdateVariable>';
    const d = simulate([人], reply, { a: 60 }).data as any;
    expect(d.白娅).toMatchObject({ 好感度: 60, 心情: '坏' });
  });
  it('skips values that no longer suit the variable', () => {
    const d = simulate([人], '', { a: 'x', b: '没这个', zz: 1 }).data as any;
    expect(d.白娅).toMatchObject({ 好感度: 10, 心情: '好' });
  });
});
