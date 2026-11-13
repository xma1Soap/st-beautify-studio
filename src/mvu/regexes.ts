// The character-card regexes an MVU card needs, in SillyTavern's own regex format.
import type { RegexScript } from '../lib/types';
import type { CompiledBar } from './bar';
import type { UpdateFold } from './types';
import { statusBarReplacement } from './statusbar';

const base = (id: string, scriptName: string): RegexScript => ({
  id,
  scriptName,
  findRegex: '',
  replaceString: '',
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
});

/** Names of the regexes this tool owns; on re-export they are replaced, everything else in the card is kept. */
export const REGEX_NAMES = {
  hideUpdate: '[MVU]发给AI时去掉变量更新',
  hideInitvar: '[MVU]藏起开场白里的初始值',
  foldUpdating: '[MVU]折叠变量更新中',
  foldUpdate: '[MVU]折叠变量更新',
  statusBar: '[MVU]状态栏',
} as const;

/** The fold's title made safe: no HTML, no regex group ($1), no Markdown marks (it sits in the shown message). */
const safeTitle = (t: string) =>
  t.replace(/[&<>"'$*_~`\\]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\s+/g, ' ').trim();

/**
 * What the update block becomes in the chat: a <details> (folded, or open), or nothing. The box look uses
 * SillyTavern's theme colors, so it follows whatever theme the player has. `writing`: the AI is still writing it.
 */
export function updateFoldHtml(f: UpdateFold | undefined, writing: boolean): string {
  if (f?.show === 'hide') return '';
  const custom = f?.title?.trim() ? safeTitle(f.title) : '';
  const title = custom ? (writing ? `${custom}（还在写…）` : custom) : writing ? '变量更新中…' : '变量更新';
  const look =
    f?.look === 'faint'
      ? ' style="font-size:.85em;opacity:.6"'
      : f?.look === 'box'
        ? ' style="border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:4px 10px;margin:6px 0;background-color:var(--black30a)"'
        : '';
  const sum = f?.look === 'box' ? '<summary style="color:var(--SmartThemeQuoteColor);cursor:pointer">' : '<summary>';
  return `<details class="mvu-update"${f?.show === 'open' ? ' open' : ''}${look}>${sum}${title}</summary>\n\n$1\n</details>`;
}

/**
 * `ids` gives a stable id per regex (see card.ts). `text`: the plain status bar (textbar.ts) to use instead of
 * the front-end one; it is only shown on the newest AI reply, since its values always come from the newest message.
 * `fold`: how the variable update shows (see UpdateFold).
 */
export function mvuRegexes(bar: CompiledBar, ids: (slot: string) => string, text?: string, fold?: UpdateFold): RegexScript[] {
  return [
    {
      ...base(ids('regex:hideUpdate'), REGEX_NAMES.hideUpdate),
      // a finished block, or one cut off at the end of the message
      findRegex: '/<UpdateVariable>[\\s\\S]*?(?:<\\/UpdateVariable>|$)/gi',
      placement: [1, 2],
      promptOnly: true,
    },
    {
      ...base(ids('regex:hideInitvar'), REGEX_NAMES.hideInitvar),
      // a greeting's own starting values: MVU reads them from the message, players and the AI don't need to see them
      findRegex: '/\\s*<initvar>[\\s\\S]*?<\\/initvar>/gi',
      placement: [2],
      markdownOnly: true,
      promptOnly: true,
    },
    {
      ...base(ids('regex:foldUpdating'), REGEX_NAMES.foldUpdating),
      // still being written (no closing tag yet)
      findRegex: '/<UpdateVariable>(?![\\s\\S]*<\\/UpdateVariable>)([\\s\\S]*)$/gi',
      replaceString: updateFoldHtml(fold, true),
      placement: [2],
      markdownOnly: true,
    },
    {
      ...base(ids('regex:foldUpdate'), REGEX_NAMES.foldUpdate),
      findRegex: '/<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gi',
      replaceString: updateFoldHtml(fold, false),
      placement: [2],
      markdownOnly: true,
    },
    {
      ...base(ids('regex:statusBar'), REGEX_NAMES.statusBar),
      // MVU adds this placeholder at the end of every message it has processed
      findRegex: '/<StatusPlaceHolderImpl\\/>/g',
      replaceString: text ?? statusBarReplacement(bar),
      placement: [2],
      markdownOnly: true,
      ...(text !== undefined ? { maxDepth: 1 } : {}),
    },
  ];
}
