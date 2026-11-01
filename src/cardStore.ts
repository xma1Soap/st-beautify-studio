// State of the MVU card editor: the card project, what is selected, undo/redo, the simulator, autosave.
import { create } from 'zustand';
import { kvGet, kvSet } from './lib/kv';
import { barOf, saveBar, type Bar } from './mvu/bar';
import type { Look } from './mvu/barTemplates';
import { newCardProject } from './mvu/card';
import { starterVars } from './mvu/templates';
import type { CardProject, VarNode } from './mvu/types';

export type CardTab = 'vars' | 'bar' | 'card' | 'ai';

/** A regex beautification being laid out with the card editor (its fields are the variables, its tag the name). */
export interface BuilderSession {
  scriptId: string;
  /** the regex's name, to show where it goes back to */
  name: string;
  /** what the card it makes keeps the player's clicks under */
  key: string;
}

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
  /** AI replies pasted into the simulator, one per message, each going on from the one before ('' = no change) */
  simSteps: string[];
  /** which of them the preview shows (the status bar compares it with the one before) */
  simAt: number;
  /** values changed by hand to try the status bar out (variable id → value); never saved into the card */
  simTweak: Record<string, unknown>;
  /** which greeting the preview starts from (0 = the first one) */
  simGreeting: number;
  preview: CardPreview;
  /** on while a regex beautification is open here instead of the card */
  builder: BuilderSession | null;

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
  /** text of the reply being shown */
  setSimText: (t: string) => void;
  setSimAt: (i: number) => void;
  /** a new empty reply after the last one, and show it */
  addSimStep: () => void;
  removeSimStep: (i: number) => void;
  /** back to the start: one empty reply */
  clearSim: () => void;
  /** undefined = back to the real value */
  setSimTweak: (id: string, v: unknown) => void;
  clearSimTweak: () => void;
  setSimGreeting: (i: number) => void;
  setPreview: (p: Partial<CardPreview>) => void;
  load: (p: CardProject, path: string | null, notes?: string[]) => void;
  /** Put the card aside and edit a regex beautification (as `project`) instead; nothing of it is autosaved here. */
  openBuilder: (s: BuilderSession, project: CardProject) => void;
  /** Back to the card, as it was. */
  closeBuilder: () => void;
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

/** What a builder session puts aside, and gives back when it ends. */
const ASIDE = ['project', 'notes', 'selectedVarId', 'barSel', 'rightView', 'tab', 'filePath', 'dirty', 'past', 'future', 'simSteps', 'simAt', 'simTweak', 'simGreeting'] as const;
let aside: Partial<CardStore> | null = null;

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
  builder: null,
  simSteps: [''],
  simAt: 0,
  simTweak: {},
  simGreeting: 0,
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
  setSimText: (t) => set((st) => ({ simSteps: st.simSteps.map((x, i) => (i === st.simAt ? t : x)) })),
  setSimAt: (i) => set((st) => ({ simAt: Math.max(0, Math.min(i, st.simSteps.length - 1)) })),
  addSimStep: () => set((st) => ({ simSteps: [...st.simSteps, ''], simAt: st.simSteps.length })),
  removeSimStep: (i) =>
    set((st) => {
      const simSteps = st.simSteps.filter((_, j) => j !== i);
      if (!simSteps.length) return { simSteps: [''], simAt: 0 };
      return { simSteps, simAt: Math.min(st.simAt > i ? st.simAt - 1 : st.simAt, simSteps.length - 1) };
    }),
  clearSim: () => set({ simSteps: [''], simAt: 0 }),
  setSimTweak: (id, v) =>
    set((st) => {
      const simTweak = { ...st.simTweak };
      if (v === undefined) delete simTweak[id];
      else simTweak[id] = v;
      return { simTweak };
    }),
  clearSimTweak: () => set({ simTweak: {} }),
  setSimGreeting: (simGreeting) => set({ simGreeting }),
  setPreview: (p) => set((st) => ({ preview: { ...st.preview, ...p } })),
  load: (project, filePath, notes = []) => {
    lastKey = undefined;
    set({ project, filePath, notes, dirty: false, past: [], future: [], selectedVarId: project.vars[0]?.id ?? null, barSel: null, simSteps: [''], simAt: 0, simTweak: {}, simGreeting: 0 });
  },
  reset: () => get().load(starterCard(), null),
  openBuilder: (builder, project) => {
    const st = get();
    if (!st.builder) aside = Object.fromEntries(ASIDE.map((k) => [k, st[k]])) as Partial<CardStore>;
    lastKey = undefined;
    set({ builder, project, notes: [], filePath: null, dirty: false, past: [], future: [], selectedVarId: project.vars[0]?.id ?? null, barSel: null, rightView: 'canvas', tab: 'bar', simSteps: [''], simAt: 0, simTweak: {}, simGreeting: 0 });
  },
  closeBuilder: () => {
    if (!get().builder) return;
    lastKey = undefined;
    set({ ...aside, builder: null });
    aside = null;
  },
  markSaved: (filePath) => set({ filePath, dirty: false }),
}));

/* ---------- autosave: keeps the working card across restarts ---------- */
const AUTOSAVE = 'card-autosave-v1';
let restored = false;

/** The simulator replies from what was stored (older versions kept just one). */
function readSim(s: any): { simSteps: string[]; simAt: number } {
  const steps = Array.isArray(s?.simSteps) ? s.simSteps.filter((x: unknown) => typeof x === 'string') : typeof s?.simText === 'string' ? [s.simText] : [];
  if (!steps.length) return { simSteps: [''], simAt: 0 };
  const at = Number.isInteger(s.simAt) ? Math.max(0, Math.min(s.simAt, steps.length - 1)) : 0;
  return { simSteps: steps, simAt: at };
}

/** The reply being shown in the simulator. */
export const simTextOf = (s: { simSteps: string[]; simAt: number }) => s.simSteps[s.simAt] ?? '';

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
        ...readSim(s),
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
  // a builder session is the regex's (it keeps itself there); the card waits as it was
  if (!restored || st.builder) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { project, filePath, dirty, notes, selectedVarId, simSteps, simAt, simTweak, preview } = st;
    kvSet(AUTOSAVE, { project, filePath, dirty, notes, selectedVarId, simSteps, simAt, simTweak, preview }).catch(() => {});
  }, 500);
});
