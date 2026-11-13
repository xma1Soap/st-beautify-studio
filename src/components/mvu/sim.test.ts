import { describe, expect, it } from 'vitest';
import type { VarNode } from '../../mvu/types';
import { extremeTweak, LONG_TEXT, simulate, tweakable } from './sim';

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

describe('several replies in a row', () => {
  const set = (v: number) => `<UpdateVariable><JSONPatch>[{"op":"replace","path":"/白娅/好感度","value":${v}}]</JSONPatch></UpdateVariable>`;
  const bad = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/白娅/心情","value":"没这个"}]</JSONPatch></UpdateVariable>';
  it('goes on from the reply before, comparing with it', () => {
    const s = simulate([人], [set(30), set(60)]);
    expect((s.data as any).白娅.好感度).toBe(60);
    expect((s.before as any).白娅.好感度).toBe(30);
    expect(s.results).toHaveLength(1);
  });
  it('an empty reply changes nothing, so there is nothing to compare', () => {
    const s = simulate([人], [set(30), '']);
    expect((s.data as any).白娅.好感度).toBe(30);
    expect(s.before).toEqual(s.data);
    expect(simulate([人], ['']).before).toBeUndefined();
  });
  it('counts what went wrong earlier', () => {
    expect(simulate([人], [bad, set(40)]).earlierBad).toBe(1);
    expect(simulate([人], [bad]).earlierBad).toBe(0);
  });
});

describe('the variables of every message', () => {
  const set = (v: number) => `<UpdateVariable><JSONPatch>[{"op":"replace","path":"/白娅/好感度","value":${v}}]</JSONPatch></UpdateVariable>`;
  it('keeps the start and what each reply left, without the hand-changed values', () => {
    const s = simulate([人], [set(30), '', set(60)], { a: 90 });
    expect((s.start as any).白娅.好感度).toBe(10);
    expect(s.after!.map((d: any) => d.白娅.好感度)).toEqual([30, 30, 60]);
    expect((s.data as any).白娅.好感度).toBe(90);
  });
});

describe('one click to the edge cases', () => {
  const 钱: VarNode = { id: 'm', name: '钱', kind: 'number', rules: [], init: 5 };
  const 名: VarNode = { id: 'n', name: '外号', kind: 'text', rules: [], init: '小白' };
  const 事: VarNode = { id: 'l', name: '经历', kind: 'list', rules: [], init: ['初遇'] };
  const list = [人, 钱, 名, 事];
  const row = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/白娅/物品/伞","value":{"数量":1}}]</JSONPatch></UpdateVariable>';
  const run = (k: Parameters<typeof extremeTweak>[1]) => simulate(list, row, extremeTweak(list, k)).data as any;
  it('puts every number at 0 or full (a big number without a top)', () => {
    expect(run('zero')).toMatchObject({ 钱: 0, 白娅: { 好感度: 0, $好感度阶段: '陌生' } });
    expect(run('full')).toMatchObject({ 钱: 99999999, 白娅: { 好感度: 100, $好感度阶段: '朋友' } });
  });
  it('empties lists and tables', () => {
    expect(simulate(list, row).data).toMatchObject({ 白娅: { 物品: { 伞: { 数量: 1 } } } });
    expect(run('empty')).toMatchObject({ 经历: [], 白娅: { 物品: {} } });
  });
  it('makes text very long', () => {
    const d = run('long');
    expect(d.外号).toBe(LONG_TEXT);
    expect(d.经历.length).toBe(3);
    expect(d.白娅.心情).toBe('好');
  });
});
