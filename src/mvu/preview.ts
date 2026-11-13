// What the MVU card preview shows, in one place: the regexes the exported card runs in SillyTavern (the card's own
// first, then the generated ones) and the chat page for one message. The preview panel and the end-to-end checks
// against a real SillyTavern (e2e/) both use this, so they compare the same thing.
import { defaultSettings } from '../lib/defaults';
import { processText } from '../lib/engine';
import { buildChat, type ChatOpts } from '../lib/render';
import type { LookSettings } from '../lib/stThemes';
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
  return { ...defaultSettings(), char: name || '角色', device, chatTheme: l.chatTheme ?? 'dark', stTheme: l.stTheme, chatStyle: l.chatStyle, fontScale: l.fontScale };
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
