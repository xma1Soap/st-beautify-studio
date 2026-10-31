import { create } from 'zustand';
import type { Project, RegexScript, Settings } from './lib/types';
import { newScript, starterProject, defaultSettings } from './lib/defaults';
import { newId } from './lib/id';

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

  loadProject: (p: Project, path: string | null) => void;
  newProject: () => void;
  markSaved: (path: string | null) => void;
}

const AUTOSAVE = 'stbs-autosave-v1';

function restore(): Pick<Store, 'project' | 'filePath' | 'dirty' | 'selectedId' | 'uiTheme'> {
  try {
    const s = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null');
    if (s?.project?.scripts) {
      const project: Project = { ...s.project, settings: { ...defaultSettings(), ...s.project.settings } };
      return {
        project,
        filePath: s.filePath ?? null,
        dirty: !!s.dirty,
        selectedId: project.scripts.some((x: RegexScript) => x.id === s.selectedId) ? s.selectedId : project.scripts[0]?.id ?? null,
        uiTheme: s.uiTheme === 'light' ? 'light' : 'dark',
      };
    }
  } catch {}
  const project = starterProject();
  return { project, filePath: null, dirty: false, selectedId: project.scripts[0].id, uiTheme: 'dark' };
}

export const useStore = create<Store>((set, get) => {
  const editScripts = (fn: (list: RegexScript[]) => RegexScript[]) =>
    set((st) => ({ project: { ...st.project, scripts: fn(st.project.scripts) }, dirty: true }));

  return {
    ...restore(),
    tab: 'code',
    previewTab: 'render',
    toast: null,

    setTab: (tab) => set({ tab }),
    setPreviewTab: (previewTab) => set({ previewTab }),
    setUiTheme: (uiTheme) => set({ uiTheme }),
    notify: (msg) => set({ toast: { msg, at: Date.now() } }),

    select: (selectedId) => set({ selectedId }),
    updateScript: (id, patch) => editScripts((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s))),
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

    setText: (testText) => set((st) => ({ project: { ...st.project, testText }, dirty: true })),
    setSettings: (patch) => set((st) => ({ project: { ...st.project, settings: { ...st.project.settings, ...patch } } })),
    setName: (name) => set((st) => ({ project: { ...st.project, name }, dirty: true })),

    loadProject: (project, filePath) => set({ project, filePath, dirty: false, selectedId: project.scripts[0]?.id ?? null }),
    newProject: () => {
      const project = starterProject();
      set({ project, filePath: null, dirty: false, selectedId: project.scripts[0].id, tab: 'code' });
    },
    markSaved: (filePath) => set({ filePath, dirty: false }),
  };
});

/* autosave the working state so closing the app never loses edits */
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((st) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE, JSON.stringify({
        project: st.project, filePath: st.filePath, dirty: st.dirty, selectedId: st.selectedId, uiTheme: st.uiTheme,
      }));
    } catch {}
  }, 400);
});
