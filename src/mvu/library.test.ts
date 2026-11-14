import { describe, expect, it } from 'vitest';
import { defaultBar, type BarNode } from './bar';
import { freshCopy, libraryFile, partForCard, readLibraryFile, savePart, saveTemplate, templateForCard } from './library';
import type { VarNode } from './types';

const v = (id: string, name: string, kind: VarNode['kind'], children?: VarNode[]): VarNode => ({ id, name, kind, rules: [], ...(children ? { children } : {}) });
// the card it was made in, and another card with the same variables under other ids (and one renamed group)
const here = [v('a', '白娅', 'group', [v('a1', '好感度', 'number'), v('a2', '心情', 'text')]), v('b', '金钱', 'number')];
const there = [v('x', '白娅', 'group', [v('x1', '好感度', 'number')]), v('y', '钱包', 'group', [v('y1', '金钱', 'number')])];

const part: BarNode = {
  id: 'p',
  type: 'box',
  children: [
    { id: 'p1', type: 'bar', bind: { var: 'a1' } },
    { id: 'p2', type: 'value', bind: { var: 'a2' }, hidden: true },
    { id: 'p3', type: 'value', bind: { var: 'b' } },
    { id: 'p4', type: 'button', text: '看心情', action: { do: 'toggle', target: 'p2' } },
  ],
};

describe('my components', () => {
  it('remembers which variables they showed, by their place', () => {
    expect(savePart(part, here, '好感块').vars).toEqual({ a1: '白娅 › 好感度', a2: '白娅 › 心情', b: '金钱' });
  });
  it('go into another card with new ids, linked to its variables by place or else by name', () => {
    const { node, missing } = partForCard(savePart(part, here, '好感块'), there);
    const [bar, mood, money, btn] = node.children!;
    expect(node.id).not.toBe('p');
    expect(bar.bind!.var).toBe('x1');
    expect(money.bind!.var).toBe('y1');
    expect(missing).toEqual(['白娅 › 心情']);
    // the button inside still opens its own neighbour, the copy
    expect(btn.action).toEqual({ do: 'toggle', target: mood.id });
  });
  it('copies keep nothing of the original’s ids', () => {
    const c = freshCopy(part);
    expect(c.children!.map((k) => k.id)).not.toContain('p1');
  });
});

describe('my templates and the file', () => {
  it('a whole status bar goes onto another card, palette and hand CSS too', () => {
    const b = { ...defaultBar(here), css: '.x { color: red; }' };
    const t = saveTemplate(b, here, '我的排版');
    const { bar, missing } = templateForCard(t, there);
    expect(bar.css).toBe('.x { color: red; }');
    expect(bar.theme).toEqual(b.theme);
    expect(missing).toContain('白娅 › 心情');
  });
  it('is written to a file and read back, broken entries left out', () => {
    const lib = { parts: [savePart(part, here, '好感块')], templates: [] };
    const back = readLibraryFile(libraryFile(lib));
    expect(back.parts[0].name).toBe('好感块');
    expect(back.parts[0].id).not.toBe(lib.parts[0].id);
    const odd = JSON.parse(libraryFile(lib));
    odd.parts.push({ name: 'x', node: null });
    expect(readLibraryFile(JSON.stringify(odd)).parts).toHaveLength(1);
    expect(() => readLibraryFile('{"type":"别的"}')).toThrow();
  });
});
