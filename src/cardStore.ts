// State of the MVU card editor: the card project, what is selected, undo/redo, the simulator, autosave.
import { create } from 'zustand';
import { kvGet, kvSet } from './lib/kv';
import { barOf, saveBar, type Bar } from './mvu/bar';
import type { Look } from './mvu/barTemplates';
import { newCardProject } from './mvu/card';
import { starterVars } from './mvu/templates';
import type { CardProject, VarNode } from './mvu/types';

export type CardTab = 'vars' | 'bar' | 'card' | 'ai';

export interface CardPreview {
  device: 'phone' | 'desktop';
  chatTheme: 'dark' | 'light';
}

interface CardStore {
  project: CardProject;
  /** what the last import found, shown on the card page */
  notes: string[];
  selectedVarId: string | null;
  /** selected status bar component */
  barSel: string | null;
  /** format painter: the look copied from a component */
  barClip: Look | null;
  /** right panel on the status bar page: the canvas or the chat preview */
  rightView: 'canvas' | 'chat';
  tab: CardTab;
  filePath: string | null;
  dirty: boolean;
  past: CardProject[];
  future: CardProject[];
  /** an AI reply pasted into the simulator ('' = show the starting values) */
  simText: string;
  /** values changed by hand to try the status bar out (variable id → value); never saved into the card */
  simTweak: Record<string, unknown>;
  preview: CardPreview;

  /** Change the project. Edits with the same `key` in quick succession (typing) undo as one step. */
  edit: (fn: (p: CardProject) => CardProject, key?: string) => void;
  editVars: (fn: (vars: VarNode[]) => VarNode[], key?: string) => void;
  /** Change the status bar (the automatic one is used until the layout is changed). */
  editBar: (fn: (bar: Bar) => Bar, key?: string) => void;
  undo: () => void;
  redo: () => void;
  selectVar: (id: string | null) => void;
  selectBar: (id: string | null) => void;
  setBarClip: (look: Look | null) => void;
  setRightView: (v: 'canvas' | 'chat') => void;
  setTab: (t: CardTab) => void;
  setSimText: (t: string) => void;
  /** undefined = back to the real value */
  setSimTweak: (id: string, v: unknown) => void;
  clearSimTweak: () => void;
  setPreview: (p: Partial<CardPreview>) => void;
  load: (p: CardProject, path: string | null, notes?: string[]) => void;
  reset: () => void;
  markSaved: (path: string | null) => void;
}

export function starterCard(): CardProject {
  const p = newCardProject();
  p.card = { ...p.card, name: '新角色', greetings: ['（在这里写第一条开场白）'] };
  p.vars = starterVars();
  return p;
}

const HISTORY = 100;
let lastKey: string | undefined;
let lastAt = 0;

export const useCard = create<CardStore>((set, get) => ({
  project: starterCard(),
  notes: [],
  selectedVarId: null,
  barSel: null,
  barClip: null,
  rightView: 'canvas',
  tab: 'vars',
  filePath: null,
  dirty: false,
  past: [],
  future: [],
  simText: '',
  simTweak: {},
  preview: { device: 'desktop', chatTheme: 'dark' },

  edit: (fn, key) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    const now = Date.now();
    const merge = key !== undefined && key === lastKey && now - lastAt < 1500;
    lastKey = key;
    lastAt = now;
    set({ project: next, dirty: true, future: [], past: merge ? past : [...past.slice(-HISTORY + 1), project] });
  },
  editVars: (fn, key) => get().edit((p) => {
    const vars = fn(p.vars);
    return vars === p.vars ? p : { ...p, vars };
  }, key),
  editBar: (fn, key) =>
    get().edit((p) => {
      const bar = barOf(p);
      const next = fn(bar);
      return next === bar ? p : { ...p, bar: saveBar(p, bar, next) };
    }, key),
  undo: () => {
    const { past, future, project } = get();
    if (!past.length) return;
    lastKey = undefined;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },
  redo: () => {
    const { past, future, project } = get();
    if (!future.length) return;
    lastKey = undefined;
    set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true });
  },
  selectVar: (selectedVarId) => set({ selectedVarId }),
  selectBar: (barSel) => set({ barSel }),
  setBarClip: (barClip) => set({ barClip }),
  setRightView: (rightView) => set({ rightView }),
  setTab: (tab) => set({ tab }),
  setSimText: (simText) => set({ simText }),
  setSimTweak: (id, v) =>
    set((st) => {
      const simTweak = { ...st.simTweak };
      if (v === undefined) delete simTweak[id];
      else simTweak[id] = v;
      return { simTweak };
    }),
  clearSimTweak: () => set({ simTweak: {} }),
  setPreview: (p) => set((st) => ({ preview: { ...st.preview, ...p } })),
  load: (project, filePath, notes = []) => {
    lastKey = undefined;
    set({ project, filePath, notes, dirty: false, past: [], future: [], selectedVarId: project.vars[0]?.id ?? null, barSel: null, simText: '', simTweak: {} });
  },
  reset: () => get().load(starterCard(), null),
  markSaved: (filePath) => set({ filePath, dirty: false }),
}));

/* ---------- autosave: keeps the working card across restarts ---------- */
const AUTOSAVE = 'card-autosave-v1';
let restored = false;

export async function restoreCard() {
  try {
    const s = await kvGet<any>(AUTOSAVE);
    if (s?.project?.vars) {
      useCard.setState({
        project: s.project,
        filePath: s.filePath ?? null,
        dirty: !!s.dirty,
        notes: s.notes ?? [],
        selectedVarId: s.selectedVarId ?? null,
        simText: s.simText ?? '',
        simTweak: s.simTweak ?? {},
        preview: { ...useCard.getState().preview, ...(s.preview ?? {}) },
      });
    } else {
      useCard.setState({ selectedVarId: useCard.getState().project.vars[0]?.id ?? null });
    }
  } catch {
    /* start fresh */
  }
  restored = true;
}

let timer: ReturnType<typeof setTimeout> | undefined;
useCard.subscribe((st) => {
  if (!restored) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { project, filePath, dirty, notes, selectedVarId, simText, simTweak, preview } = st;
    kvSet(AUTOSAVE, { project, filePath, dirty, notes, selectedVarId, simText, simTweak, preview }).catch(() => {});
  }, 500);
});
