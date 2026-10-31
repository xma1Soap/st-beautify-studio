// Which editor is open: the MVU card maker (main) or the older text/regex beautifier.
import { create } from 'zustand';

export type Mode = 'mvu' | 'regex';

const KEY = 'stbs-mode';
const saved = (): Mode => {
  try {
    return localStorage.getItem(KEY) === 'regex' ? 'regex' : 'mvu';
  } catch {
    return 'mvu';
  }
};

export const useMode = create<{ mode: Mode; setMode: (m: Mode) => void }>((set) => ({
  mode: saved(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
    set({ mode });
  },
}));
