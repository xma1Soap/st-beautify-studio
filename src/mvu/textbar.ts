// The plain status bar: one line of HTML with TavernHelper's variable macros in it, put in place of MVU's
// <StatusPlaceHolderImpl/> by the status bar regex. No front-end page and no script.
//
// When a message is shown, TavernHelper fills the macros from the newest message that has variables, and only
// when that message is drawn. So the regex only shows it on the newest AI reply (depth 0 or 1: the newest message,
// or the one before it when the newest is the player's); older replies would show the newest values after a reload.
import { barOf, cssColor, defaultTheme, FONTS, type BarTheme, type ThemeColor } from './bar';
import type { CardProject, TextBar, VarNode } from './types';
import { stageKey, varKey } from './vars';

export const TEXT_BAR_TITLE = '状态';

/** Characters a name can't have inside a macro (SillyTavern's formatting or the regex would change them). */
const BAD_NAME = /[{}*"`<>&\\$~]/;

/** Text shown as it is: escaped, and the characters Markdown would act on turned into entities. */
const shown = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[*"_$`{}~|\\]/g, (c) => `&#${c.charCodeAt(0)};`);

const macro = (kind: 'get' | 'format', keys: string[]) => `{{${kind}_message_variable::stat_data.${keys.join('.')}}}`;

export interface TextBarOut {
  html: string;
  /** variables that could not go in, and why */
  problems: string[];
  /** how many variables are shown */
  count: number;
}

export function textBarHtml(vars: VarNode[], theme: Partial<BarTheme> | undefined, tb: TextBar): TextBarOut {
  const base = defaultTheme();
  const raw = { ...base, ...theme };
  // only plain colors: the style sits inside the message, where a stray quote would break it
  const c = (k: ThemeColor) => {
    const x = cssColor(raw[k]);
    return x && !x.startsWith('var(') ? x : base[k];
  };
  const t = { ...raw, card: c('card'), line: c('line'), text: c('text'), dim: c('dim'), accent: c('accent'), accent2: c('accent2') };
  const size = typeof t.size === 'number' && isFinite(t.size) ? Math.round(Math.min(24, Math.max(10, t.size))) : base.size;
  const hide = new Set(tb.hide ?? []);
  const problems: string[] = [];
  let count = 0;
  const label = (name: string) => `<span style="color:${t.dim}">${shown(name)}：</span>`;

  const rows = (list: VarNode[], keys: string[]): string =>
    list
      .map((v) => {
        if (hide.has(v.id)) return '';
        const key = varKey(v);
        if (BAD_NAME.test(key)) {
          problems.push(`「${v.name}」的名字里有 { } * " \` < > & \\ $ ~ 这类符号，放不进纯文字状态栏，已跳过`);
          return '';
        }
        const k = [...keys, key];
        if (v.kind === 'group') {
          const inner = rows(v.children ?? [], k);
          if (!inner) return '';
          return `<div style="margin-top:4px"><div style="color:${t.accent2};font-weight:bold">${shown(v.name)}</div><div style="padding-left:0.8em">${inner}</div></div>`;
        }
        count++;
        if (v.kind === 'list' || v.kind === 'table') {
          // YAML lines; the indentation TavernHelper adds is dropped by pre-line
          return `<div>${label(v.name)}<div style="white-space:pre-line;padding-left:0.8em">${macro('format', k)}</div></div>`;
        }
        let value = macro('get', k);
        if (v.kind === 'number') {
          if (v.max !== undefined) value += ` / ${v.max}`;
          // the stage name sits next to the number in its group; $ followed by a digit or < means something to the regex
          if (v.stages?.length && keys.length && !/^[\d<]/.test(v.name)) value += `（${macro('get', [...keys, stageKey(v)])}）`;
        }
        return `<div>${label(v.name)}${value}</div>`;
      })
      .join('');

  const body = rows(vars, []);
  if (!count) problems.push('纯文字状态栏里一个变量都没有');
  const title = tb.title ?? TEXT_BAR_TITLE;
  const head = title.trim() ? `<div style="color:${t.accent};font-weight:bold;margin-bottom:2px">${shown(title.trim())}</div>` : '';
  const font = (FONTS[t.font] ?? FONTS.sans).css;
  const html =
    `<div class="mvu-text-bar" style="margin-top:8px;padding:8px 12px;border-radius:8px;background:${t.card};color:${t.text};` +
    `border:1px solid ${t.line};font-family:${font};font-size:${size}px;line-height:1.7">${head}${body}</div>`;
  return { html, problems, count };
}

/** The plain status bar of a project, or undefined when it uses the one from the canvas. */
export function textBarOf(p: Pick<CardProject, 'vars' | 'bar' | 'textBar'>): TextBarOut | undefined {
  if (!p.textBar?.on) return undefined;
  return textBarHtml(p.vars, barOf(p).theme, p.textBar);
}

/** The plain status bar settings kept in a card or project file. */
export function readTextBar(x: any): TextBar | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const out: TextBar = { on: x.on === true };
  if (typeof x.title === 'string') out.title = x.title.slice(0, 60);
  if (Array.isArray(x.hide)) out.hide = x.hide.filter((h: unknown) => typeof h === 'string');
  return out;
}
