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

/** 简易: fewer settings for people who just want something that works; 进阶: everything. Nothing is lost either way. */
export type Level = 'simple' | 'advanced';

const LEVEL_KEY = 'stbs-level';
const savedLevel = (): Level => {
  try {
    return localStorage.getItem(LEVEL_KEY) === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
};

export const useLevel = create<{ level: Level; setLevel: (l: Level) => void }>((set) => ({
  level: savedLevel(),
  setLevel: (level) => {
    try {
      localStorage.setItem(LEVEL_KEY, level);
    } catch {
      /* ignore */
    }
    set({ level });
  },
}));
