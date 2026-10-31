// How SillyTavern turns a message into HTML for display, step by step, so the preview shows what ST shows.
// Follows messageFormatting() in public/script.js, fixMarkdown() in public/scripts/power-user.js,
// and the DOMPurify hooks + <style> handling in public/scripts/chats.js (ST release branch, 2026-10).
// Uses the same libraries ST uses: showdown 2, DOMPurify 3, @adobe/css-tools 4.
import showdown from 'showdown';
import createDOMPurify, { type DOMPurify } from 'dompurify';
import * as css from '@adobe/css-tools';

export interface FormatOptions {
  /** speaker name; ST removes a leading "Name:" from AI messages */
  charName: string;
  isUser: boolean;
  /** ST's "Forbid external media" setting, on by default */
  blockExternalMedia: boolean;
}

export interface Formatted {
  html: string;
  /** external links ST would block with the current setting */
  blocked: string[];
}

/* ---------- fixMarkdown(text, forDisplay = true); "Auto-fix Markdown" is on by default ---------- */
const countOccurrences = (s: string, ch: string) => s.split(ch).length - 1;

export function fixMarkdown(text: string): string {
  const format = /([*_]{1,2})([\s\S]*?)\1/gm;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = format.exec(text)) !== null) matches.push(m);
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const t = matches[i][0];
    const fixed = t.replace(/(\*|_)([\t    -   　﻿]+)|([\t    -   　﻿]+)(\*|_)/g, '$1$4');
    out = out.slice(0, matches[i].index) + fixed + out.slice(matches[i].index + t.length);
  }
  // a line with an odd number of * or " gets one appended at the end
  return out
    .split('\n')
    .map((line) => {
      let l = line;
      for (const ch of ['*', '"']) if (l.includes(ch) && countOccurrences(l, ch) % 2 !== 0) l = l.trimEnd() + ch;
      return l;
    })
    .join('\n');
}

/* ---------- quotes become <q> so ST can color them ---------- */
function wrapQuotes(mes: string): string {
  // keep quotes inside tags (attribute values) out of the way
  mes = mes.replace(/<([^>]+)>/g, (_, c: string) => '<' + c.replace(/"/g, '￾') + '>');
  mes = mes.replace(
    /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(“.*?”)|(«.*?»)|(「.*?」)|(『.*?』)|(＂.*?＂)/gim,
    (match, p1, p2, p3, p4, p5, p6) => {
      if (p1) return `<q>"${p1.slice(1, -1)}"</q>`;
      if (p2) return `<q>“${p2.slice(1, -1)}”</q>`;
      if (p3) return `<q>«${p3.slice(1, -1)}»</q>`;
      if (p4) return `<q>「${p4.slice(1, -1)}」</q>`;
      if (p5) return `<q>『${p5.slice(1, -1)}』</q>`;
      if (p6) return `<q>＂${p6.slice(1, -1)}＂</q>`;
      return match;
    },
  );
  return mes.replace(/￾/g, '"');
}

/* ---------- showdown with ST's options ---------- */
const underscoreExt = (): showdown.ShowdownExtension[] => [{
  type: 'output',
  regex: new RegExp('(<code(?:\\s+[^>]*)?>[\\s\\S]*?<\\/code>|<style(?:\\s+[^>]*)?>[\\s\\S]*?<\\/style>)|\\b(?<!_)_(?!_)(.*?)(?<!_)_(?!_)\\b', 'gi'),
  replace: (match: string, tag?: string, italic?: string) => (tag ? match : italic ? '<em>' + italic + '</em>' : match),
}];

let converter: showdown.Converter | null = null;
function md(): showdown.Converter {
  return (converter ??= new showdown.Converter({
    emoji: true,
    literalMidWordUnderscores: true,
    parseImgDimensions: true,
    tables: true,
    underline: true,
    simpleLineBreaks: true,
    strikethrough: true,
    disableForced4SpacesIndentedSublists: true,
    extensions: [underscoreExt()],
  }));
}

/* ---------- DOMPurify with ST's hooks ---------- */
const isExternalUrl = (url: string) => url.indexOf('://') > 0 || url.indexOf('//') === 0;

// settings for the sanitize call in progress (hooks read them)
const run = { blockMedia: true, blocked: [] as string[] };

let purifier: DOMPurify | null = null;
function purify(): DOMPurify {
  if (purifier) return purifier;
  const p = createDOMPurify(window);
  // links open in a new tab
  p.addHook('afterSanitizeAttributes', (node) => {
    if ('target' in node) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
  });
  // every class gets a custom- prefix (except fa-*, note-*, monospace)
  p.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'class' && data.attrValue) {
      data.attrValue = data.attrValue
        .split(' ')
        .map((v) => (v.startsWith('fa-') || v.startsWith('note-') || v === 'monospace' ? v : 'custom-' + v))
        .join(' ');
    }
  });
  p.addHook('uponSanitizeElement', (node) => {
    // line breaks inside unknown tags (like <状态栏>) become <br>
    if (node instanceof window.HTMLUnknownElement) {
      node.innerHTML = node.innerHTML.trim();
      const doc = node.ownerDocument;
      const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const found: Text[] = [];
      while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        if (t.data.includes('\n') && !t.parentElement?.closest('pre')) found.push(t);
      }
      for (const t of found) {
        const frag = doc.createDocumentFragment();
        t.data.split('\n').forEach((part, i, all) => {
          if (part.length) frag.appendChild(doc.createTextNode(part));
          if (i < all.length - 1) frag.appendChild(doc.createElement('br'));
        });
        t.replaceWith(frag);
      }
    }
    if (!run.blockMedia || !(node instanceof window.Element)) return;
    if (!['AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'EMBED', 'OBJECT', 'IMG'].includes(node.tagName)) return;
    const urls = [node.getAttribute('src'), node.getAttribute('data'), ...(node.getAttribute('srcset') || '').split(',').map((x) => x.trim().split(' ')[0])];
    const bad = urls.find((u) => u && isExternalUrl(u));
    if (bad) {
      run.blocked.push(bad);
      node.remove();
    }
  });
  return (purifier = p);
}

/* ---------- <style> blocks: selectors are scoped to the message and classes get custom- ---------- */
function encodeStyleTags(text: string): string {
  return text.replaceAll(/<style>(.+?)<\/style>/gims, (_, s: string) => `<custom-style>${encodeURIComponent(s)}</custom-style>`);
}

function sanitizeSimpleSelector(selector: string): string {
  return selector
    .split(/\s+/)
    .map((part) => part.replace(/\.([\w-]+)/g, (match, cls: string) => (cls.startsWith('custom-') ? match : `.custom-${cls}`)))
    .join(' ');
}
function sanitizeSelector(selector: string): string {
  const pseudo = /:(has|not|where|is|matches|any)\(([^)]+)\)/g;
  selector = selector.replace(pseudo, (_, cls: string, inner: string) => `:${cls}(${sanitizeSimpleSelector(inner)})`);
  return sanitizeSimpleSelector(selector);
}

function decodeStyleTags(text: string, prefix: string): string {
  const sanitizeRule = (rule: any) => {
    if (Array.isArray(rule.selectors)) {
      rule.selectors = rule.selectors.map((s: string) => (s ? prefix + sanitizeSelector(s) : s));
    }
    if (run.blockMedia && Array.isArray(rule.declarations) && rule.declarations.length > 0) {
      rule.declarations = rule.declarations.filter((d: any) => {
        const bad = typeof d.value === 'string' && d.value.includes('://');
        if (bad) run.blocked.push(d.value);
        return !bad;
      });
    }
  };
  const sanitizeRuleSet = (set: any) => {
    if (Array.isArray(set.selectors) || Array.isArray(set.declarations)) sanitizeRule(set);
    if (Array.isArray(set.rules)) {
      set.rules = set.rules.filter((r: any) => r.type !== 'import');
      for (const r of set.rules) sanitizeRuleSet(r);
    }
  };
  return text.replaceAll(/<custom-style>(.+?)<\/custom-style>/gms, (_, style: string) => {
    try {
      const ast = css.parse(decodeURIComponent(style).replaceAll(/<br\/>/g, ''));
      if (ast?.stylesheet) sanitizeRuleSet(ast.stylesheet);
      return `<style>${css.stringify(ast)}</style>`;
    } catch (e) {
      return `CSS ERROR: ${e}`;
    }
  });
}

const escapeRegex = (s: string) => s.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');

/** The display HTML ST would put inside .mes_text for this (already regex-processed) message. */
export function formatMessage(mes: string, o: FormatOptions): Formatted {
  run.blockMedia = o.blockExternalMedia;
  run.blocked = [];
  if (!mes) return { html: '', blocked: [] };

  mes = fixMarkdown(mes);
  mes = wrapQuotes(mes);
  mes = mes.replaceAll('\\begin{align*}', '$$').replaceAll('\\end{align*}', '$$');
  mes = md().makeHtml(mes);
  mes = mes.trim();
  mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, (m) => m.replace(/&amp;/g, '&'));

  // "Show {{char}}: in responses" is off by default
  if (o.charName && !o.isUser) mes = mes.replace(new RegExp(`(^|\n)${escapeRegex(o.charName)}:`, 'g'), '$1');

  mes = encodeStyleTags(mes);
  mes = purify().sanitize(mes, { ADD_TAGS: ['custom-style'] }) as string;
  mes = decodeStyleTags(mes, '.mes_text ');

  return { html: mes, blocked: [...new Set(run.blocked)] };
}
