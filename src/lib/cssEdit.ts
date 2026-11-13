// Changing a rule in the code's own <style> blocks (「改所有同类」 in 点选修改): the preview says which rules give the
// picked element its look (by selector), this finds those rules in the code and changes one property at a time,
// keeping how the author wrote the rest (spacing, line breaks, comments, !important).
import { parseTags } from './htmlEdit';

export interface CssRule {
  /** the selector as written */
  sel: string;
  /** where the selector starts in the code */
  start: number;
  /** just after '{' */
  bodyStart: number;
  /** at '}' (or the end of the <style>) */
  bodyEnd: number;
  /** the condition of the @media / @supports … it sits in ('' at the top) */
  at: string;
}

interface Decl {
  prop: string;
  value: string;
  /** where the declaration starts (the property name) */
  start: number;
  valStart: number;
  valEnd: number;
  /** just after its ';' (= valEnd when there is none) */
  end: number;
}

/** Skips a comment or a quoted string starting at i; gives where it ends, or i when there is none. */
function skipOver(s: string, i: number, end: number): number {
  const c = s[i];
  if (c === '/' && s[i + 1] === '*') {
    const e = s.indexOf('*/', i + 2);
    return e < 0 || e + 2 > end ? end : e + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < end && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, end);
  }
  return i;
}

/** The '}' that closes the block whose '{' is just before `from`. */
function closeOf(s: string, from: number, end: number): number {
  let depth = 1;
  for (let i = from; i < end; ) {
    const j = skipOver(s, i, end);
    if (j !== i) {
      i = j;
      continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
    i++;
  }
  return end;
}

/** At-rules whose block holds more rules (the others, like @keyframes, are skipped). */
const GROUPS = /^@(media|supports|container|layer|scope|document)\b/i;

function scanRules(s: string, from: number, end: number, out: CssRule[], at = '') {
  let i = from;
  while (i < end) {
    // the prelude: up to '{' or ';' outside comments and strings
    let j = i;
    while (j < end && s[j] !== '{' && s[j] !== ';' && s[j] !== '}') {
      const k = skipOver(s, j, end);
      j = k !== j ? k : j + 1;
    }
    if (j >= end) return;
    if (s[j] !== '{') {
      i = j + 1;
      continue;
    }
    const prelude = s.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const close = closeOf(s, j + 1, end);
    if (prelude.startsWith('@')) {
      if (GROUPS.test(prelude)) scanRules(s, j + 1, close, out, prelude.replace(/^@[\w-]+\s*/, ''));
    } else if (prelude) {
      const lead = s.slice(i, j).search(/\S/);
      out.push({ sel: prelude, start: i + Math.max(0, lead), bodyStart: j + 1, bodyEnd: close, at });
    }
    i = close + 1;
  }
}

/** Every style rule in the code's <style> blocks (inside front-end cards too), in order. */
export function cssRules(src: string): CssRule[] {
  const out: CssRule[] = [];
  for (const el of parseTags(src)) if (el.name === 'style') scanRules(src, el.openEnd, el.closeStart, out);
  return out;
}

/** A rule's declarations, where each one is. Nested rules inside it are passed over. */
function decls(s: string, r: CssRule): Decl[] {
  const out: Decl[] = [];
  const end = r.bodyEnd;
  let i = r.bodyStart;
  while (i < end) {
    // to the start of the next declaration
    while (i < end) {
      const k = skipOver(s, i, end);
      if (k !== i && s[i] === '/') i = k;
      else if (/[\s;]/.test(s[i])) i++;
      else break;
    }
    if (i >= end) break;
    const start = i;
    let colon = -1;
    let depth = 0;
    let nested = false;
    while (i < end) {
      const k = skipOver(s, i, end);
      if (k !== i) {
        i = k;
        continue;
      }
      const c = s[i];
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ':' && colon < 0 && !depth) colon = i;
      else if (c === ';' && !depth) break;
      else if (c === '{') {
        nested = true;
        i = closeOf(s, i + 1, end) + 1;
        break;
      }
      i++;
    }
    const stop = Math.min(i, end);
    if (!nested && colon > start) {
      let a = colon + 1;
      while (a < stop && /\s/.test(s[a])) a++;
      let b = stop;
      while (b > a && /\s/.test(s[b - 1])) b--;
      out.push({ prop: s.slice(start, colon).trim().toLowerCase(), value: s.slice(a, b), start, valStart: a, valEnd: b, end: s[stop] === ';' ? stop + 1 : b });
    }
    if (s[stop] === ';') i = stop + 1;
  }
  return out;
}

/** The rule's properties, property → value (the last one wins, like in CSS). */
export function ruleStyle(src: string, r: CssRule): Record<string, string> {
  const o: Record<string, string> = {};
  for (const d of decls(src, r)) o[d.prop] = d.value;
  return o;
}

/** A selector written the way the browser writes it (spacing, quotes), for comparing. */
export function sameSelector(a: string): string {
  return a
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[\s*([^\]=~|^$*\s]+)\s*([~|^$*]?=)\s*(["']?)([^\]"']*)\3\s*\]/g, '[$1$2$4]')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Undoes what SillyTavern does to the <style> of a message (.mes_text before each selector, custom- on classes). */
export function unscopeSelector(sel: string): string {
  return sel
    .split(',')
    .map((p) => p.trim().replace(/^\.mes_text\s+/, '').replace(/\.custom-([\w-])/g, '.$1'))
    .join(', ');
}

const sameCond = (c: string) => c.replace(/\s+/g, '').toLowerCase();

/**
 * The rule in the code the preview's selector stands for (the last one, which wins), or -1. `at` is the condition
 * of the @media / @supports it sits in, as the browser gives it.
 */
export function findRule(src: string, sel: string, at = ''): number {
  const want = sameSelector(unscopeSelector(sel));
  const cond = sameCond(at);
  const rules = cssRules(src);
  for (let i = rules.length - 1; i >= 0; i--) if (sameSelector(rules[i].sel) === want && sameCond(rules[i].at) === cond) return i;
  return -1;
}

/** Changes one property of rule `i` ('' or undefined takes it away). */
function setOne(src: string, i: number, prop: string, value: string | undefined): string {
  const r = cssRules(src)[i];
  if (!r) return src;
  const list = decls(src, r);
  const d = [...list].reverse().find((x) => x.prop === prop);
  const v = value?.trim() ?? '';
  if (d) {
    if (!v) {
      // the declaration and the space after it; a line of its own goes as a whole
      let a = d.start;
      let b = d.end;
      while (b < r.bodyEnd && (src[b] === ' ' || src[b] === '\t')) b++;
      const lineStart = src.lastIndexOf('\n', a - 1) + 1;
      if (/^[ \t]*$/.test(src.slice(lineStart, a)) && (src[b] === '\n' || src[b] === '\r')) {
        a = lineStart;
        if (src[b] === '\r') b++;
        if (src[b] === '\n') b++;
      }
      return src.slice(0, a) + src.slice(b);
    }
    // a value marked important stays important
    const keep = /!\s*important\s*$/i.test(d.value) && !/!\s*important/i.test(v) ? ' !important' : '';
    return src.slice(0, d.valStart) + v + keep + src.slice(d.valEnd);
  }
  if (!v) return src;
  // added after the last one, written like the others
  const last = list[list.length - 1];
  const colon = !last || /^[^:]*:\s/.test(src.slice(last.start, last.valStart)) ? ': ' : ':';
  const body = src.slice(r.bodyStart, r.bodyEnd);
  if (/\n/.test(body.trim()) || (!list.length && /\n/.test(body))) {
    const at = last ? last.end : r.bodyStart;
    const ref = last ? last.start : r.bodyEnd;
    const lineStart = src.lastIndexOf('\n', ref - 1) + 1;
    const indent = last ? /^[ \t]*/.exec(src.slice(lineStart))![0] : '  ';
    const semi = last && src[last.end - 1] !== ';' ? ';' : '';
    return src.slice(0, at) + semi + '\n' + indent + prop + colon + v + ';' + src.slice(at);
  }
  if (!last) {
    const pad = /^\s/.test(body) ? ' ' : '';
    return src.slice(0, r.bodyStart) + pad + prop + colon + v + ';' + src.slice(r.bodyStart);
  }
  const semi = src[last.end - 1] !== ';' ? ';' : '';
  const gap = /;\s/.test(body) ? ' ' : '';
  return src.slice(0, last.end) + semi + gap + prop + colon + v + (semi ? '' : ';') + src.slice(last.end);
}

/** Changes properties of rule `i` (by its place in cssRules). */
export function setRuleStyle(src: string, i: number, patch: Record<string, string | undefined>): string {
  let out = src;
  for (const [k, v] of Object.entries(patch)) out = setOne(out, i, k.toLowerCase(), v);
  return out;
}
