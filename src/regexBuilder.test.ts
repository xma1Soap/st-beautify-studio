import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCard } from './cardStore';
import { starterProject } from './lib/defaults';
import { readBuilder } from './lib/builder';
import { newVar } from './mvu/tree';
import { useMode } from './mode';
import { closeBuilder, newBuilderScript, openBuilder } from './regexBuilder';
import { useStore } from './store';

const regex = () => useStore.getState();
const card = () => useCard.getState();
const built = () => regex().project.scripts.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  regex().loadProject(starterProject(), null);
  useMode.getState().setMode('regex');
});
afterEach(() => {
  if (card().builder) closeBuilder();
  vi.useRealTimers();
});

describe('a regex made on the canvas', () => {
  it('opens in the card editor with the card put aside, and gives the card back', () => {
    const cardName = card().project.card.name;
    newBuilderScript();
    expect(useMode.getState().mode).toBe('mvu');
    expect(card().builder?.scriptId).toBe(built().id);
    // the starter regex already looks for <状态栏>
    expect(card().project.card.name).toBe('状态');
    expect(card().project.vars.map((v) => v.name)).toEqual(['时间', '地点', '心情']);
    expect(regex().project.testText).toContain('<状态>\n时间：黄昏');
    closeBuilder();
    expect(useMode.getState().mode).toBe('regex');
    expect(card().builder).toBeNull();
    expect(card().project.card.name).toBe(cardName);
    expect(regex().selectedId).toBe(built().id);
  });

  it('writes what is changed on the canvas into the regex', async () => {
    newBuilderScript();
    card().editVars((l) => [...l, { ...newVar('number'), name: '好感', init: 60 }]);
    expect(readBuilder(built())!.b.fields).toHaveLength(3);
    vi.advanceTimersByTime(400);
    const r = readBuilder(built())!;
    expect(r.b.fields.map((f) => f.name)).toEqual(['时间', '地点', '心情', '好感']);
    expect(r.edited).toBe(false);
    // going back writes it at once
    card().edit((p) => ({ ...p, card: { ...p.card, name: '面板' } }));
    closeBuilder();
    expect(built().findRegex.startsWith('/<面板>')).toBe(true);
    expect(regex().project.testText).toContain('<面板>');
    // and it opens again as it was left
    expect(await openBuilder(built().id)).toBe(true);
    expect(card().project.vars.map((v) => v.name)).toEqual(['时间', '地点', '心情', '好感']);
    expect(card().past).toEqual([]);
  });

  it('leaves regexes written by hand alone', async () => {
    expect(await openBuilder(regex().project.scripts[0].id)).toBe(false);
    expect(card().builder).toBeNull();
  });
});
