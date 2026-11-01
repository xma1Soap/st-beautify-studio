// Settings of the AI assistant: the endpoint, the guidance it gets, an optional SillyTavern preset.
// Kept on this computer only (localStorage) and never written into projects or exported cards.
import { create } from 'zustand';

export interface Skill {
  id: string;
  name: string;
  text: string;
  on: boolean;
}

export interface PresetMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** the entry's name in the preset, shown in the settings */
  name?: string;
}

/** The enabled entries of a SillyTavern chat completion preset, before and after the chat history. */
export interface AiPreset {
  name: string;
  before: PresetMsg[];
  after: PresetMsg[];
}

export interface AiSettings {
  /** what the user typed: a base like https://host/v1, or the full …/chat/completions */
  url: string;
  key: string;
  model: string;
  /** null = the endpoint's default */
  temperature: number | null;
  /** get the reply bit by bit (turn off for endpoints that break on it) */
  stream: boolean;
  /** the guidance that comes with the tool */
  builtin: boolean;
  skills: Skill[];
  preset: AiPreset | null;
  presetOn: boolean;
}

const KEY = 'stbs-ai-v1';

const defaults = (): AiSettings => ({ url: '', key: '', model: '', temperature: null, stream: true, builtin: true, skills: [], preset: null, presetOn: true });

function load(): AiSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object') return { ...defaults(), ...s, skills: Array.isArray(s.skills) ? s.skills : [] };
  } catch {}
  return defaults();
}

interface Store extends AiSettings {
  set: (patch: Partial<AiSettings>) => void;
}

export const useAiSettings = create<Store>((set) => ({
  ...load(),
  set: (patch) => set(patch),
}));

useAiSettings.subscribe((s) => {
  const { set: _, ...rest } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {}
});

/** The settings without the store's own function. */
export const aiSettings = (): AiSettings => {
  const { set: _, ...rest } = useAiSettings.getState();
  return rest;
};

/** Full address for a path of the API ('chat/completions' or 'models'), from what the user typed. */
export function endpoint(url: string, path: 'chat/completions' | 'models'): string {
  let u = url.trim().replace(/\/+$/, '');
  if (!u) return '';
  // no scheme: local and LAN addresses (a local proxy, one-api at home…) are usually plain http
  if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(u) ? 'http://' : 'https://') + u;
  u = u.replace(/\/(chat\/completions|models)$/, '');
  try {
    // just a host: OpenAI-style APIs live under /v1
    if (new URL(u).pathname.replace(/\/+$/, '') === '') u += '/v1';
  } catch {
    return '';
  }
  return `${u}/${path}`;
}

export const configured = (s: Pick<AiSettings, 'url' | 'model'>) => !!endpoint(s.url, 'chat/completions') && !!s.model.trim();
