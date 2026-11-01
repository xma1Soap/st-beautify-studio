// Regex beautifications made on the canvas. The AI writes a block of 「name：value」 lines (<状态栏>…</状态栏>);
// the find regex picks each field out wherever it is in the block (any order, missing ones left empty); the
// replacement is a front-end card (drawn by TavernHelper) showing them with the MVU status bar's components.
// What was laid out rides along in the replacement as a comment, so the regex opens on the canvas again, also
// after it has been exported and imported somewhere else.
import { barOf, compileBar, type SavedBar } from '../mvu/bar';
import { fieldBarHtml, type FieldSlot } from '../mvu/statusbar';
import { newVar } from '../mvu/tree';
import type { VarKind, VarNode } from '../mvu/types';
import { varKey } from '../mvu/vars';
import { newId } from './id';

export interface RegexBuilder {
  v: 1;
  /** the block's tag: <状态栏>…</状态栏> */
  tag: string;
  /** what the AI fills in, one line each (flat: no groups or tables) */
  fields: VarNode[];
  bar: SavedBar;
  /** the player's clicks (tabs, folds) are kept under it, apart from other cards */
  key?: string;
}

/** What a field can be. */
export const FIELD_KINDS: VarKind[] = ['text', 'number', 'choice', 'bool', 'list'];

const SLOT: Partial<Record<VarKind, FieldSlot[1]>> = { number: 'n', bool: 'b', list: 'l' };

/** A tag the regex and ST can both live with: no spaces, brackets or slashes. */
export function cleanTag(s: string): string {
  return s.replace(/[\s<>/\\"'`=&]/g, '').slice(0, 30) || '状态栏';
}

/** Only the kinds of fields a block line can hold; nested parts are dropped. */
export function cleanFields(list: VarNode[]): VarNode[] {
  return list.map((f) => {
    const { children: _, ...rest } = f;
    return FIELD_KINDS.includes(f.kind) ? rest : { ...rest, kind: 'text', init: '' };
  });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The find regex: one lookahead per field, each looking through the whole block (so the order doesn't matter),
 * the optional part inside it (outside, JS would drop it as an empty match). Bold names, list marks and half-width
 * colons are all fine. One capture group per field, in order.
 */
export function builderFind(tag: string, fields: VarNode[]): string {
  const t = esc(cleanTag(tag));
  const end = `<\\/${t}>`;
  const body = `(?:(?!${end})[\\s\\S])*?`;
  const field = (name: string) =>
    `(?=(?:${body}(?:^|\\n|(?<=<${t}>))\\s*(?:[-*]\\s*)?(?:\\*\\*)?${esc(name)}(?:\\*\\*)?\\s*[:：]\\s*(?:\\*\\*)?\\s*([^\\n<]*?)\\s*(?:\\*\\*)?\\s*(?=\\n|${end}))?)`;
  return `/<${t}>${fields.map((f) => field(varKey(f))).join('')}${body}${end}/gm`;
}

/* ---------- the layout, kept in the replacement ---------- */

const MARK = '<!--stbs-builder:';

/** A short checksum, to tell when the generated code was changed by hand afterwards. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

const stripMark = (replace: string) => {
  const i = replace.indexOf(MARK);
  if (i < 0) return replace;
  const j = replace.indexOf('-->', i);
  return replace.slice(0, i) + (j < 0 ? '' : replace.slice(j + 3));
};

export interface Compiled {
  findRegex: string;
  replaceString: string;
  problems: string[];
}

/** The regex for a builder. */
export function compileBuilder(b: RegexBuilder): Compiled {
  const key = b.key || 'rb';
  const fields = cleanFields(b.fields);
  const bar = compileBar(barOf({ bar: b.bar, vars: fields }), fields, { key, regex: true });
  const slots: FieldSlot[] = fields.map((f) => [varKey(f), SLOT[f.kind] ?? 't']);
  const findRegex = builderFind(b.tag, fields);
  const html = fieldBarHtml(bar, slots);
  const saved: RegexBuilder = { v: 1, tag: cleanTag(b.tag), fields, bar: b.bar, key };
  const body = '```html\n' + html + '\n```';
  const mark = `${MARK}${hash(findRegex + '\n' + body)}:${toB64(JSON.stringify(saved))}-->`;
  // the comment goes inside the card, where the player never sees it
  const replaceString = body.replace(/\n```$/, () => '\n' + mark + '\n```');
  return { findRegex, replaceString, problems: bar.problems };
}

/** The layout kept in a regex, and whether its code was changed by hand since. Null: not made on the canvas. */
export function readBuilder(s: { findRegex: string; replaceString: string }): { b: RegexBuilder; edited: boolean } | null {
  const i = s.replaceString.indexOf(MARK);
  if (i < 0) return null;
  const j = s.replaceString.indexOf('-->', i);
  const [sum, data] = s.replaceString.slice(i + MARK.length, j < 0 ? undefined : j).split(':');
  try {
    const o = JSON.parse(fromB64(data));
    if (o?.v !== 1 || !Array.isArray(o.fields)) return null;
    const b: RegexBuilder = { v: 1, tag: cleanTag(String(o.tag ?? '')), fields: cleanFields(o.fields), bar: o.bar && typeof o.bar === 'object' ? o.bar : { v: 1 }, ...(typeof o.key === 'string' ? { key: o.key } : {}) };
    const rest = stripMark(s.replaceString).replace(/\n\n```$/, '\n```');
    return { b, edited: hash(s.findRegex + '\n' + rest) !== sum };
  } catch {
    return null;
  }
}

/** Is this regex made on the canvas? (Cheap: for lists.) */
export const isBuilt = (replace: string) => replace.includes(MARK);

/* ---------- for the AI and for trying it out ---------- */

const show = (f: VarNode, v: unknown): string => {
  if (f.kind === 'bool') return v ? '是' : '否';
  if (Array.isArray(v)) return v.join('、');
  return v == null ? '' : String(v);
};

/** What each field should hold, for the instructions. */
function about(f: VarNode): string {
  const own = f.rules.filter((r) => r.trim()).join('；');
  const kind =
    f.kind === 'number'
      ? `数字${f.min != null && f.max != null ? `（${f.min}～${f.max}）` : f.min != null ? `（不小于 ${f.min}）` : f.max != null ? `（不大于 ${f.max}）` : ''}${f.integer ? '，整数' : ''}`
      : f.kind === 'bool'
        ? '是 / 否'
        : f.kind === 'choice'
          ? `从这几个里选一个：${(f.options ?? []).join(' / ')}`
          : f.kind === 'list'
            ? '几项，用顿号隔开'
            : '';
  return [kind, own].filter(Boolean).join('；') || '一句话';
}

/** The block filled in with the sample values. */
export function builderSample(b: RegexBuilder): string {
  const t = cleanTag(b.tag);
  return [`<${t}>`, ...cleanFields(b.fields).map((f) => `${varKey(f)}：${show(f, f.init)}`), `</${t}>`].join('\n');
}

/** Instructions to put in the preset or the character card, so the AI writes the block. */
export function builderPrompt(b: RegexBuilder): string {
  const t = cleanTag(b.tag);
  const fields = cleanFields(b.fields);
  return [
    `在每次回复的最后，另起一行输出 <${t}> 块，记录当前状态。格式固定：一行一项，「名字：内容」，名字照抄，不要加别的标记：`,
    `<${t}>`,
    ...fields.map((f) => `${varKey(f)}：（${about(f)}）`),
    `</${t}>`,
    '',
    '例如：',
    builderSample(b),
  ].join('\n');
}

/** A new beautification: a status block with three text fields, laid out automatically. */
export function newBuilder(): RegexBuilder {
  const field = (name: string, init: string) => ({ ...newVar('text'), name, init });
  const fields = [field('时间', '黄昏'), field('地点', '月影酒馆'), field('心情', '期待')];
  return { v: 1, tag: '状态栏', fields, bar: { v: 1 }, key: newId() };
}
