// What the MVU card preview shows, in one place: the regexes the exported card runs in SillyTavern (the card's own
// first, then the generated ones) and the chat page for one message. The preview panel and the end-to-end checks
// against a real SillyTavern (e2e/) both use this, so they compare the same thing.
import { defaultSettings } from '../lib/defaults';
import { processText } from '../lib/engine';
import { buildChat, buildChatPage, type ChatOpts } from '../lib/render';
import type { LookSettings } from '../lib/stThemes';
import type { RunResult } from '../lib/engine';
import type { RegexScript, Settings } from '../lib/types';
import { barOf, compileBar } from './bar';
import { cardVariables, keptRegexes, PLACEHOLDER } from './card';
import { mvuRegexes } from './regexes';
import { textBarOf } from './textbar';
import type { CardProject } from './types';

/** The regexes a message goes through in SillyTavern, in order. */
export function previewRegexes(p: Pick<CardProject, 'id' | 'vars' | 'bar' | 'textBar' | 'base' | 'takeover' | 'settings'>, kept = keptRegexes(p)): RegexScript[] {
  return [
    ...kept,
    ...mvuRegexes(
      compileBar(barOf(p), p.vars, { allowEdit: p.settings.allowPlayerEdit, key: `preview-${p.id}` }),
      (slot) => slot,
      textBarOf(p)?.html,
    ),
  ];
}

/** `look`: the chat's theme, message style and font size (an old 'dark' / 'light' still works). */
export function previewSettings(name: string, device: Settings['device'], look: LookSettings | Settings['chatTheme'] = {}): Settings {
  const l = typeof look === 'string' ? { chatTheme: look } : look;
  return { ...defaultSettings(), char: name || '角色', device, chatTheme: l.chatTheme ?? 'dark', stTheme: l.stTheme, chatStyle: l.chatStyle, fontScale: l.fontScale, bg: l.bg, bgFit: l.bgFit, fastUi: l.fastUi };
}

/**
 * The message with what MVU puts at the end of a reply. `on` false: a greeting the card leaves without it, which shows
 * no status bar in SillyTavern.
 */
export const withPlaceholder = (text: string, on = true) => (on && !text.includes(PLACEHOLDER) ? `${text}\n\n${PLACEHOLDER}` : text);

/** What front-end cards get from the card itself. */
export const cardExtras = (p: Pick<CardProject, 'base' | 'card'>) => ({ charVars: cardVariables(p), card: { name: p.card.name || '角色' } });

/** The chat page for one message (the card frames load the libraries from loadFrameLibs once they are in). */
export function previewPage(
  regexes: RegexScript[],
  message: string,
  settings: Settings,
  vh: number,
  o: ChatOpts,
  placeholder = true,
): { html: string; display: string; raw: string } {
  const { raw, display } = processText(regexes, withPlaceholder(message, placeholder), settings);
  return { html: buildChat(display, raw, settings, vh, o).html, display, raw };
}

/** One message of a simulated chat. */
export interface Floor {
  /** the message as written (before MVU adds its placeholder) */
  text: string;
  /** the character's (the greeting, the AI replies); otherwise the player's */
  ai: boolean;
  /** its MVU variables; none on a message MVU keeps none for */
  stat?: unknown;
  /** MVU's status bar placeholder goes after it: every AI reply; a greeting only when the card puts it there */
  bar?: boolean;
  /** shown alone: its number in the chat, and whether it is a reply (not the greeting) */
  id?: number;
  gen?: boolean;
}

/** What the player says when the author left it empty. */
export const USER_STAND_IN = '（玩家的话）';

/**
 * The chat the simulator stands for: the greeting (its variables `start`), then for each reply what the player said
 * (the variables before it) and the reply (its variables `after[i]`). A reply still empty shows a note instead (the values stay as they were).
 * `last`: the newest variables as shown (with values changed by hand), instead of after[last].
 */
export function simFloors(o: {
  greeting: string;
  barOnGreeting: boolean;
  start: unknown;
  replies: string[];
  users: string[];
  after: unknown[];
  last?: unknown;
}): Floor[] {
  const out: Floor[] = [{ text: o.greeting.trim() ? o.greeting : '（开场白）', ai: true, stat: o.start, bar: o.barOnGreeting }];
  // nothing pasted yet: the chat is just the greeting
  if (o.replies.length === 1 && !o.replies[0].trim()) {
    if (o.last !== undefined) out[0].stat = o.last;
    return out;
  }
  o.replies.forEach((r, i) => {
    const before = i ? o.after[i - 1] : o.start;
    // MVU gives the player's message a copy of the variables before it (measured in SillyTavern 1.19 + MVU)
    out.push({ text: o.users[i]?.trim() ? o.users[i] : USER_STAND_IN, ai: false, stat: before });
    out.push({ text: r.trim() ? r : '（这一条还没贴回复，数值和上一条一样）', ai: true, stat: o.after[i] ?? before, bar: true });
  });
  if (o.last !== undefined) out[out.length - 1].stat = o.last;
  return out;
}

/** A message of the chat after the regexes: as stored, as shown, and what each regex did. */
export interface ShownFloor {
  raw: string;
  display: string;
  stats: Record<string, RunResult>;
}

/**
 * Each message of a chat through the regexes like in SillyTavern: as the character's or the player's, at its depth
 * (0 = the newest), with MVU's placeholder after the AI replies. `newest`: other regexes for the newest message only
 * (点选修改 numbers the elements there).
 */
export function processFloors(regexes: RegexScript[], floors: Floor[], settings: Settings, newest?: RegexScript[]): ShownFloor[] {
  const n = floors.length;
  return floors.map((f, i): ShownFloor => {
    const s: Settings = { ...settings, role: f.ai ? 2 : 1, depth: n - 1 - i };
    return processText(i === n - 1 && newest ? newest : regexes, f.ai ? withPlaceholder(f.text, f.bar ?? true) : f.text, s);
  });
}

/** The chat page for a whole simulated chat (see processFloors). */
export function previewChat(regexes: RegexScript[], floors: Floor[], settings: Settings, vh: number, o: ChatOpts, newest?: RegexScript[]): { html: string; floors: ShownFloor[] } {
  const shown = processFloors(regexes, floors, settings, newest);
  const page = buildChatPage(
    shown.map((x, i) => ({ display: x.display, raw: x.raw, ai: floors[i].ai, stat: floors[i].stat, id: floors[i].id, gen: floors[i].gen })),
    settings,
    vh,
    o,
  );
  return { html: page.html, floors: shown };
}
