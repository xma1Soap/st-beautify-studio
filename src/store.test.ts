import { beforeEach, describe, expect, it } from 'vitest';
import { readSaved, useStore } from './store';
import { starterProject } from './lib/defaults';

const st = () => useStore.getState();

describe('regex mode undo / redo', () => {
  beforeEach(() => st().loadProject(starterProject(), null));

  it('undoes and redoes a change to a regex', () => {
    const id = st().project.scripts[0].id;
    const before = st().project.scripts[0].findRegex;
    st().updateScript(id, { findRegex: '/a/g' });
    expect(st().project.scripts[0].findRegex).toBe('/a/g');
    st().undo();
    expect(st().project.scripts[0].findRegex).toBe(before);
    st().redo();
    expect(st().project.scripts[0].findRegex).toBe('/a/g');
  });

  it('counts quick typing in one field as one step', () => {
    const id = st().project.scripts[0].id;
    const before = st().project.scripts[0].scriptName;
    for (const t of ['a', 'ab', 'abc']) st().updateScript(id, { scriptName: t });
    expect(st().past.length).toBe(1);
    st().undo();
    expect(st().project.scripts[0].scriptName).toBe(before);
  });

  it('brings back a deleted regex and selects something that exists', () => {
    const id = st().project.scripts[0].id;
    const n = st().project.scripts.length;
    st().removeScript(id);
    expect(st().project.scripts.length).toBe(n - 1);
    st().undo();
    expect(st().project.scripts.length).toBe(n);
    st().addScript();
    const added = st().selectedId;
    st().undo();
    expect(st().project.scripts.some((s) => s.id === added)).toBe(false);
    expect(st().project.scripts.some((s) => s.id === st().selectedId)).toBe(true);
  });

  it('leaves the preview settings alone', () => {
    st().setName('新名字');
    st().setSettings({ device: 'phone' });
    st().undo();
    expect(st().project.name).not.toBe('新名字');
    expect(st().project.settings.device).toBe('phone');
  });

  it('starts a fresh history when a project is opened', () => {
    st().setName('x');
    expect(st().past.length).toBe(1);
    st().loadProject(starterProject(), null);
    expect(st().past.length).toBe(0);
    expect(st().future.length).toBe(0);
  });

  it('reads back what was autosaved, and ignores junk', () => {
    const p = starterProject();
    const s = readSaved({ project: p, selectedId: 'gone', filePath: 3 });
    expect(s?.selectedId).toBe(p.scripts[0].id);
    expect(s?.filePath).toBeNull();
    expect(readSaved({ project: {} })).toBeNull();
    expect(readSaved(null)).toBeNull();
  });
});
