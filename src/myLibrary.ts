// 我的组件 / 我的模板, kept on this computer (IndexedDB), for every card.
import { create } from 'zustand';
import { kvGet, kvSet } from './lib/kv';
import { emptyLibrary, type Library, type MyPart, type MyTemplate } from './mvu/library';

const KEY = 'my-library-v1';

interface LibraryStore extends Library {
  loaded: boolean;
  addPart: (p: MyPart) => void;
  addTemplate: (t: MyTemplate) => void;
  rename: (kind: 'parts' | 'templates', id: string, name: string) => void;
  remove: (kind: 'parts' | 'templates', id: string) => void;
  /** add what a file holds (kept next to what is there) */
  merge: (lib: Library) => void;
}

export const useLibrary = create<LibraryStore>((set) => ({
  ...emptyLibrary(),
  loaded: false,
  addPart: (p) => set((s) => ({ parts: [p, ...s.parts] })),
  addTemplate: (t) => set((s) => ({ templates: [t, ...s.templates] })),
  rename: (kind, id, name) => set((s) => ({ [kind]: (s[kind] as (MyPart | MyTemplate)[]).map((x) => (x.id === id ? { ...x, name: name.slice(0, 40) } : x)) }) as Partial<LibraryStore>),
  remove: (kind, id) => set((s) => ({ [kind]: (s[kind] as (MyPart | MyTemplate)[]).filter((x) => x.id !== id) }) as Partial<LibraryStore>),
  merge: (lib) => set((s) => ({ parts: [...lib.parts, ...s.parts], templates: [...lib.templates, ...s.templates] })),
}));

/** Reads the library once; later changes are written back. */
export async function loadLibrary() {
  try {
    const saved = await kvGet<Library>(KEY);
    if (saved) useLibrary.setState({ parts: saved.parts ?? [], templates: saved.templates ?? [] });
  } catch {
    /* start empty */
  }
  useLibrary.setState({ loaded: true });
}

useLibrary.subscribe((s, before) => {
  if (!s.loaded || (s.parts === before.parts && s.templates === before.templates)) return;
  kvSet(KEY, { parts: s.parts, templates: s.templates }).catch(() => {});
});
