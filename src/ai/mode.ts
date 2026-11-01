// What the assistant needs to know about each editor (regex beautifier, MVU card).
import type { Tool } from './tools';

/** One change in the review list. `diff` is shown as before / after. */
export interface Change {
  title: string;
  diff?: { a: string; b: string };
}

export interface AiMode<P> {
  id: 'regex' | 'mvu';
  /** what this editor is and how its data looks, for the system prompt */
  intro: string;
  tools: Tool<P>[];
  /** the state right now, sent with every request (the draft, once the AI has changed something) */
  context: (p: P) => string;
  /** the project in the editor */
  current: () => P;
  /** nothing the AI could have changed differs (preview settings don't count) */
  same: (a: P, b: P) => boolean;
  /** put the draft into the editor as one undo step */
  apply: (next: P) => void;
  /** take an applied draft back; false when the project changed since */
  revert: (applied: P) => boolean;
  changes: (a: P, b: P) => Change[];
  macros: () => { user: string; char: string };
}

/** Errors the preview reported last time it drew (scripts in front-end cards etc.), per editor. */
export const previewLog: Record<'regex' | 'mvu', string[]> = { regex: [], mvu: [] };

export const quote = (s: string, max = 2000) => (s.length > max ? s.slice(0, max) + `…（共 ${s.length} 字，后面省略）` : s);
