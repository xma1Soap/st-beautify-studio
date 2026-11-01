import { create } from 'zustand';
import type { Project, RegexScript, Settings } from './lib/types';
import { newScript, starterProject, defaultSettings } from './lib/defaults';
import { newId } from './lib/id';
import { kvGet, kvSet } from './lib/kv';

export type EditorTab = 'settings' | 'code' | 'test';
export type PreviewTab = 'render' | 'text';
export type UiTheme = 'dark' | 'light';

interface Store {
  project: Project;
  selectedId: string | null;
  filePath: string | null;
  dirty: boolean;
  tab: EditorTab;
  previewTab: PreviewTab;
  uiTheme: UiTheme;
  toast: { msg: string; at: number } | null;
  /** earlier / undone versions of the project (preview settings are not part of undo) */
  past: Project[];
  future: Project[];

  setTab: (t: EditorTab) => void;
  setPreviewTab: (t: PreviewTab) => void;
  setUiTheme: (t: UiTheme) => void;
  notify: (msg: string) => void;

  select: (id: string | null) => void;
  updateScript: (id: string, patch: Partial<RegexScript>) => void;
  addScript: () => void;
  duplicateScript: (id: string) => void;
  removeScript: (id: string) => void;
  moveScript: (id: string, delta: number) => void;
  setAllEnabled: (on: boolean) => void;
  appendScripts: (list: RegexScript[]) => void;

  setText: (t: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setName: (n: string) => void;

  /** replace the whole project (the AI assistant's changes) as one undo step; preview settings stay as they are */
  applyProject: (p: Project) => void;
  undo: () => void;
  redo: () => void;

  loadProject: (p: Project, path: string | null) => void;
  newProject: () => void;
  markSaved: (path: string | null) => void;
}

/** Where the working project used to be kept (a few MB at most); read once and moved to IndexedDB. */
const OLD_AUTOSAVE = 'stbs-autosave-v1';
const AUTOSAVE = 'regex-autosave-v1';
const THEME = 'stbs-ui-theme';

type Saved = Pick<Store, 'project' | 'filePath' | 'dirty' | 'selectedId'>;

/** A stored working state, or null if it doesn't look like one. */
export function readSaved(s: any): Saved | null {
  if (!s?.project || !Array.isArray(s.project.scripts)) return null;
  const project: Project = { ...s.project, settings: { ...defaultSettings(), ...s.project.settings } };
  return {
    project,
    filePath: typeof s.filePath === 'string' ? s.filePath : null,
    dirty: !!s.dirty,
    selectedId: project.scripts.some((x: RegexScript) => x.id === s.selectedId) ? s.selectedId : project.scripts[0]?.id ?? null,
  };
}

function oldSave(): any {
  try {
    return JSON.parse(localStorage.getItem(OLD_AUTOSAVE) || 'null');
  } catch {
    return null;
  }
}

function startTheme(): UiTheme {
  try {
    let t = localStorage.getItem(THEME);
    if (t === null) {
      // carried over from the old autosave, which is about to be moved away
      t = oldSave()?.uiTheme === 'light' ? 'light' : 'dark';
      localStorage.setItem(THEME, t);
    }
    return t === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function fresh(): Saved {
  const project = starterProject();
  return { project, filePath: null, dirty: false, selectedId: project.scripts[0].id };
}

const HISTORY = 100;
let lastKey: string | undefined;
let lastAt = 0;

export const useStore = create<Store>((set, get) => {
  /** Change the project. Changes with the same `key` in quick succession (typing) undo as one step. */
  const change = (fn: (p: Project) => Project, key?: string) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    const now = Date.now();
    const merge = key !== undefined && key === lastKey && now - lastAt < 1500;
    lastKey = key;
    lastAt = now;
    set({ project: next, dirty: true, future: [], past: merge ? past : [...past.slice(-HISTORY + 1), project] });
  };
  const editScripts = (fn: (list: RegexScript[]) => RegexScript[], key?: string) =>
    change((p) => {
      const scripts = fn(p.scripts);
      return scripts === p.scripts ? p : { ...p, scripts };
    }, key);
  /** after undo / redo: keep the preview settings as they are now, and keep something selected */
  const travel = (to: Project, past: Project[], future: Project[]) => {
    const { project, selectedId } = get();
    lastKey = undefined;
    const p = { ...to, settings: project.settings };
    const keep = p.scripts.some((s) => s.id === selectedId);
    set({ project: p, past, future, dirty: true, selectedId: keep ? selectedId : p.scripts[0]?.id ?? null });
  };

  return {
    ...(readSaved(oldSave()) ?? fresh()),
    uiTheme: startTheme(),
    tab: 'code',
    previewTab: 'render',
    toast: null,
    past: [],
    future: [],

    setTab: (tab) => set({ tab }),
    setPreviewTab: (previewTab) => set({ previewTab }),
    setUiTheme: (uiTheme) => {
      set({ uiTheme });
      try {
        localStorage.setItem(THEME, uiTheme);
      } catch {}
    },
    notify: (msg) => set({ toast: { msg, at: Date.now() } }),

    select: (selectedId) => set({ selectedId }),
    updateScript: (id, patch) =>
      editScripts((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)), `script:${id}:${Object.keys(patch).sort().join(',')}`),
    addScript: () => {
      const s = newScript();
      const { selectedId, project } = get();
      const at = project.scripts.findIndex((x) => x.id === selectedId);
      editScripts((l) => (at < 0 ? [...l, s] : [...l.slice(0, at + 1), s, ...l.slice(at + 1)]));
      set({ selectedId: s.id, tab: 'code' });
    },
    duplicateScript: (id) => {
      const src = get().project.scripts.find((s) => s.id === id);
      if (!src) return;
      const copy = { ...src, id: newId(), scriptName: src.scriptName + ' 副本', trimStrings: [...src.trimStrings], placement: [...src.placement] };
      editScripts((l) => { const i = l.indexOf(src); return [...l.slice(0, i + 1), copy, ...l.slice(i + 1)]; });
      set({ selectedId: copy.id });
    },
    removeScript: (id) => {
      const l = get().project.scripts;
      const i = l.findIndex((s) => s.id === id);
      editScripts((l) => l.filter((s) => s.id !== id));
      if (get().selectedId === id) set({ selectedId: (l[i + 1] || l[i - 1])?.id ?? null });
    },
    moveScript: (id, delta) =>
      editScripts((l) => {
        const i = l.findIndex((s) => s.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= l.length) return l;
        const c = [...l];
        [c[i], c[j]] = [c[j], c[i]];
        return c;
      }),
    setAllEnabled: (on) => editScripts((l) => l.map((s) => ({ ...s, disabled: !on }))),
    appendScripts: (list) => {
      const have = new Set(get().project.scripts.map((s) => s.id));
      const fixed = list.map((s) => (have.has(s.id) ? { ...s, id: newId() } : s));
      editScripts((l) => [...l, ...fixed]);
      if (fixed[0]) set({ selectedId: fixed[0].id });
    },

    setText: (testText) => change((p) => (p.testText === testText ? p : { ...p, testText }), 'text'),
    setSettings: (patch) => set((st) => ({ project: { ...st.project, settings: { ...st.project.settings, ...patch } } })),
    setName: (name) => change((p) => (p.name === name ? p : { ...p, name }), 'name'),

    applyProject: (next) => {
      lastKey = undefined;
      change((p) => ({ ...next, settings: p.settings }));
      const { project, selectedId } = get();
      if (!project.scripts.some((x) => x.id === selectedId)) set({ selectedId: project.scripts[0]?.id ?? null });
    },
    undo: () => {
      const { past, future, project } = get();
      if (past.length) travel(past[past.length - 1], past.slice(0, -1), [project, ...future]);
    },
    redo: () => {
      const { past, future, project } = get();
      if (future.length) travel(future[0], [...past, project], future.slice(1));
    },

    loadProject: (project, filePath) => {
      lastKey = undefined;
      set({ project, filePath, dirty: false, past: [], future: [], selectedId: project.scripts[0]?.id ?? null });
    },
    newProject: () => {
      const project = starterProject();
      lastKey = undefined;
      set({ project, filePath: null, dirty: false, past: [], future: [], selectedId: project.scripts[0].id, tab: 'code' });
    },
    markSaved: (filePath) => set({ filePath, dirty: false }),
  };
});

/* ---------- autosave to IndexedDB so closing the app never loses edits (room for big embedded images) ---------- */
let restored = false;

export async function restoreRegex() {
  try {
    const s = readSaved(await kvGet<any>(AUTOSAVE));
    // only take it if nothing was changed while it loaded
    if (s && !useStore.getState().past.length) useStore.setState({ ...s, past: [], future: [] });
    else if (!s && readSaved(oldSave())) {
      const { project, filePath, dirty, selectedId } = useStore.getState();
      await kvSet(AUTOSAVE, { project, filePath, dirty, selectedId });
      localStorage.removeItem(OLD_AUTOSAVE);
    }
  } catch {
    /* keep what we have */
  }
  restored = true;
}

let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((st, prev) => {
  if (!restored) return;
  if (st.project === prev.project && st.filePath === prev.filePath && st.dirty === prev.dirty && st.selectedId === prev.selectedId) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { project, filePath, dirty, selectedId } = useStore.getState();
    kvSet(AUTOSAVE, { project, filePath, dirty, selectedId })
      .then(() => {
        try {
          localStorage.removeItem(OLD_AUTOSAVE);
        } catch {}
      })
      .catch(() => {});
  }, 400);
});
