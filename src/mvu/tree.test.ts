import { describe, expect, it } from 'vitest';
import { applyOps, extractOps } from './patch';
import { buildSchema } from './schema';
import { TEMPLATES, starterVars } from './templates';
import {
  canIndent,
  canOutdent,
  changeKind,
  cloneVar,
  findVar,
  indentVar,
  insertVar,
  locate,
  moveVar,
  newVar,
  outdentVar,
  patchField,
  removeVar,
  uniqueName,
  updateVar,
  wrapInGroup,
} from './tree';
import type { VarNode } from './types';
import { initialData, problems } from './vars';
import { sampleReply } from './prompts';

const v = (id: string, kind: VarNode['kind'], extra: Partial<VarNode> = {}): VarNode => ({ id, name: id, kind, rules: [], ...extra });
const names = (l: VarNode[]) => l.map((x) => x.name);

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`「${t.name}」 has no problems and its starting values pass the schema`, () => {
      const vars = t.build();
      expect(problems(vars)).toEqual([]);
      expect(buildSchema(vars).safeParse(initialData(vars)).success).toBe(true);
    });
  }
  it('builds fresh ids every time', () => {
    const a = TEMPLATES[0].build();
    const b = TEMPLATES[0].build();
    expect(a[0].id).not.toBe(b[0].id);
  });
  it('starter set works, and the sample reply it suggests is accepted', () => {
    const vars = starterVars();
    expect(problems(vars)).toEqual([]);
    const schema = buildSchema(vars);
    const start = schema.parse(initialData(vars)) as Record<string, unknown>;
    const { ops, errors } = extractOps(sampleReply(vars));
    expect(errors).toEqual([]);
    expect(ops.length).toBeGreaterThan(0);
    const r = applyOps(start, ops, schema);
    expect(r.results.every((x) => x.ok)).toBe(true);
  });
  it('sample replies of every template are accepted', () => {
    for (const t of TEMPLATES) {
      const vars = t.build();
      const schema = buildSchema(vars);
      const r = applyOps(schema.parse(initialData(vars)) as Record<string, unknown>, extractOps(sampleReply(vars)).ops, schema);
      expect(r.results.filter((x) => !x.ok).map((x) => `${t.name}: ${x.msg}`)).toEqual([]);
    }
  });
});

describe('tree editing', () => {
  const tree = () => [v('a', 'number'), v('g', 'group', { children: [v('b', 'text'), v('c', 'bool')] }), v('t', 'table', { children: [v('f', 'number')], init: {} })];

  it('finds nodes anywhere with their parent', () => {
    const at = locate(tree(), 'c')!;
    expect(at.parent?.id).toBe('g');
    expect(at.index).toBe(1);
    expect(findVar(tree(), 'zz')).toBeNull();
    expect(findVar(tree(), null)).toBeNull();
  });

  it('never changes the old tree', () => {
    const old = tree();
    const snapshot = structuredClone(old);
    updateVar(old, 'b', { name: 'x' });
    removeVar(old, 'c');
    insertVar(old, v('n', 'text'), { intoId: 'g' });
    moveVar(old, 'b', 1);
    indentVar(old, 'g');
    outdentVar(old, 'b');
    expect(old).toEqual(snapshot);
  });

  it('keeps untouched branches as the same objects', () => {
    const old = tree();
    const next = updateVar(old, 'b', { name: 'x' });
    expect(next[0]).toBe(old[0]);
    expect(next[2]).toBe(old[2]);
    expect(next[1]).not.toBe(old[1]);
  });

  it('inserts after, into, or at the end', () => {
    expect(names(insertVar(tree(), v('n', 'text'), { afterId: 'a' }))).toEqual(['a', 'n', 'g', 't']);
    expect(names(findVar(insertVar(tree(), v('n', 'text'), { afterId: 'b' }), 'g')!.children!)).toEqual(['b', 'n', 'c']);
    expect(names(findVar(insertVar(tree(), v('n', 'text'), { intoId: 'g' }), 'g')!.children!)).toEqual(['b', 'c', 'n']);
    expect(names(insertVar(tree(), v('n', 'text'), { afterId: 'missing' }))).toEqual(['a', 'g', 't', 'n']);
  });

  it('moves within its own level only', () => {
    expect(names(moveVar(tree(), 'a', 1))).toEqual(['g', 'a', 't']);
    expect(names(moveVar(tree(), 'a', -1))).toEqual(['a', 'g', 't']);
    expect(names(findVar(moveVar(tree(), 'c', -1), 'g')!.children!)).toEqual(['c', 'b']);
  });

  it('indents into the group above and outdents after it', () => {
    const l = [v('g', 'group', { children: [] }), v('x', 'text')];
    expect(canIndent(l, 'x')).toBe(true);
    const inside = indentVar(l, 'x');
    expect(names(inside)).toEqual(['g']);
    expect(names(inside[0].children!)).toEqual(['x']);
    expect(canOutdent(inside, 'x')).toBe(true);
    expect(names(outdentVar(inside, 'x'))).toEqual(['g', 'x']);
  });

  it('does not put groups or tables into a table', () => {
    const l = [v('t', 'table', { children: [] }), v('g', 'group', { children: [] }), v('n', 'number')];
    const l2 = [l[0], l[2], l[1]];
    expect(canIndent(l, 'g')).toBe(false);
    expect(indentVar(l, 'g')).toBe(l);
    expect(canIndent(l2, 'n')).toBe(true);
    // anything can move out to the root
    const nested = [v('t', 'table', { children: [v('t2', 'table', { children: [] })] })];
    expect(canOutdent(nested, 't2')).toBe(true);
  });

  it('copies with fresh ids, including children', () => {
    const g = tree()[1];
    const c = cloneVar(g);
    expect(c.id).not.toBe(g.id);
    expect(c.children!.map((x) => x.id)).not.toContain('b');
    expect(names(c.children!)).toEqual(['b', 'c']);
  });

  it('picks unique names', () => {
    expect(uniqueName('好感度', [])).toBe('好感度');
    expect(uniqueName('好感度', ['好感度', '好感度2'])).toBe('好感度3');
    expect(newVar('number', ['新数字']).name).toBe('新数字2');
  });

  it('changing kind drops what no longer fits', () => {
    const n = v('n', 'number', { min: 0, max: 10, stages: [{ from: 0, label: 'x' }], init: 5 });
    const p = changeKind(n, 'choice');
    expect(p.kind).toBe('choice');
    expect(p.min).toBeUndefined();
    expect(p.stages).toBeUndefined();
    expect(p.options?.length).toBeGreaterThan(0);
    expect(p.init).toBe(p.options![0]);
    // a group stays a group with its children
    const g = tree()[1];
    expect(changeKind(g, 'group').children).toBe(g.children);
  });

  it('wraps a variable into a new group in its place', () => {
    const r = wrapInGroup(tree(), 'a', '新分组');
    expect(names(r.vars)).toEqual(['新分组', 'g', 't']);
    expect(r.vars[0].id).toBe(r.groupId);
    expect(names(r.vars[0].children!)).toEqual(['a']);
  });
});

describe('table fields', () => {
  const table = (): VarNode =>
    v('t', 'table', {
      rowName: '物品',
      dropRowWhenZero: '数量',
      children: [v('q', 'number', { name: '数量', init: 1 }), v('d', 'text', { name: '描述', init: '' })],
      init: { 面包: { 数量: 2, 描述: '香' } },
    });

  it('renaming a field renames it in the starting rows and the drop setting', () => {
    const p = patchField(table(), 'q', { name: '个数' });
    expect(p.init).toEqual({ 面包: { 个数: 2, 描述: '香' } });
    expect(p.dropRowWhenZero).toBe('个数');
    expect(p.children![0].name).toBe('个数');
  });

  it('making a field read-only adds the _ to its key in the rows', () => {
    expect(patchField(table(), 'd', { readonly: true }).init).toEqual({ 面包: { 数量: 2, _描述: '香' } });
  });

  it('changing a field kind resets its cells and the drop setting', () => {
    const p = patchField(table(), 'q', { kind: 'text', init: '' });
    expect(p.init).toEqual({ 面包: { 数量: '', 描述: '香' } });
    expect(p.dropRowWhenZero).toBeUndefined();
    const t = { ...table(), ...p };
    expect(problems([t])).toEqual([]);
    expect(buildSchema([t]).safeParse(initialData([t])).success).toBe(true);
  });

  it('other changes leave the rows alone', () => {
    const t = table();
    const p = patchField(t, 'q', { max: 99 });
    expect(p.init).toBeUndefined();
    expect(p.children![0].max).toBe(99);
  });
});

describe('simulator notes', () => {
  const run = (vars: VarNode[], ops: object[], seed?: (d: any) => void) => {
    const schema = buildSchema(vars);
    const d = schema.parse(initialData(vars)) as any;
    seed?.(d);
    return applyOps(d, ops as any, schema).results;
  };
  it('says when a number is pulled back into range', () => {
    const vars = TEMPLATES.find((t) => t.name === '角色好感')!.build();
    const [r] = run(vars, [{ op: 'replace', path: '/角色名/好感度', value: 500 }]);
    expect(r.ok).toBe(true);
    expect(r.msg).toContain('100');
  });
  it('says when a row is dropped at zero, and when a key is unknown', () => {
    const vars = TEMPLATES.find((t) => t.name === '物品栏')!.build();
    const rs = run(vars, [
      { op: 'insert', path: '/物品栏/面包', value: { 描述: '', 数量: 2 } },
      { op: 'delta', path: '/物品栏/面包/数量', value: -2 },
      { op: 'insert', path: '/物品栏/钥匙', value: { 描述: '', 数量: 1, 颜色: '红' } },
      { op: 'replace', path: '/物品栏/钥匙/颜色', value: '蓝' },
    ]);
    expect(rs.map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(rs[0].msg).toBe('');
    expect(rs[1].msg).toContain('自动删掉');
    expect(rs[3].msg).toContain('没有这一项');
  });
});

it('zod explains rejections in Chinese', () => {
  const vars = TEMPLATES.find((t) => t.name === '角色好感')!.build();
  const r = buildSchema(vars).safeParse({ 角色名: { 好感度: 1, 心情: '狂喜', 当前想法: '' } });
  expect(r.success).toBe(false);
  expect(r.error!.issues[0].message).toMatch(/[一-龥]/);
  expect(r.error!.issues[0].message).not.toMatch(/Invalid/);
});
