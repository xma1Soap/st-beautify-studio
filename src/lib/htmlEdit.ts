// Changing a regex's HTML by clicking it in the preview. The code is read as a list of tags (where each one is,
// which closes it, which is inside which); the preview gets the same code with each tag numbered, so a click
// leads back to its place in the code. Changes are made to the code: the element's own style="", the text of
// an element with nothing else inside, and its place among its siblings.

/** Read as plain text up to their closing tag. */
const RAW = new Set(['style', 'script', 'textarea', 'title', 'xmp']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Not worth picking (nothing to see), or numbering would break them (ST only knows a bare <style>). */
const SKIP = new Set(['style', 'script', 'template', 'br', 'wbr', 'meta', 'link', 'base', 'source', 'track', 'col', 'param', 'html', 'head', 'body', 'title']);

export interface El {
  /** its number among the opening tags (what the preview marks it with) */
  n: number;
  name: string;
  /** '<' of the opening tag */
  start: number;
  /** where its attributes end (before '>' or '/>') */
  attrEnd: number;
  /** just after the opening tag */
  openEnd: number;
  /** where the closing tag starts (= openEnd when there is none) */
  closeStart: number;
  /** just after the closing tag (= openEnd when there is none) */
  end: number;
  parent: number;
  children: number[];
}

const TAG =
  /<!--[\s\S]*?(?:-->|$)|<![a-zA-Z][^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/g;

/** Every element of the code, in order. Tags nobody closed end where their parent does. */
export function parseTags(src: string): El[] {
  const els: El[] = [];
  const open: El[] = [];
  const re = new RegExp(TAG.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) {
      const name = m[1].toLowerCase();
      const i = open.map((e) => e.name).lastIndexOf(name);
      if (i < 0) continue;
      const closed = open.splice(i);
      // the one this tag closes; any left open inside it end here too
      closed[0].closeStart = m.index;
      closed[0].end = m.index + m[0].length;
      for (const e of closed.slice(1)) e.closeStart = e.end = m.index;
      continue;
    }
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    const openEnd = m.index + m[0].length;
    const parent = open.length ? open[open.length - 1].n : -1;
    const el: El = { n: els.length, name, start: m.index, attrEnd: m.index + 1 + m[2].length + m[3].length, openEnd, closeStart: openEnd, end: openEnd, parent, children: [] };
    els.push(el);
    if (parent >= 0) els[parent].children.push(el.n);
    if (VOID.has(name) || m[4]) continue;
    if (RAW.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'ig');
      close.lastIndex = openEnd;
      const c = close.exec(src);
      el.closeStart = c ? c.index : src.length;
      el.end = c ? c.index + c[0].length : src.length;
      re.lastIndex = el.end;
      continue;
    }
    open.push(el);
  }
  for (const e of open) e.closeStart = e.end = src.length;
  return els;
}

/** Can it be picked in the preview? */
export const pickable = (el: El | undefined) => !!el && !SKIP.has(el.name);

/** The code with every element numbered (data-stbs-e), for the preview only. */
export function annotate(src: string): string {
  let out = src;
  for (const el of parseTags(src).reverse()) if (pickable(el)) out = out.slice(0, el.attrEnd) + ` data-stbs-e="${el.n}"` + out.slice(el.attrEnd);
  return out;
}

/* ---------- style="" ---------- */

interface Attr {
  name: string;
  start: number;
  end: number;
  value: string;
  quote: string;
}

function attrs(src: string, el: El): Attr[] {
  const from = el.start + 1 + el.name.length;
  const text = src.slice(from, el.attrEnd);
  const re = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  const out: Attr[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : '';
    out.push({ name: m[1].toLowerCase(), start: from + m.index, end: from + m.index + m[0].length, value: m[2] ?? m[3] ?? m[4] ?? '', quote });
  }
  return out;
}

/** Declarations of a style="" (split at ; outside brackets and quotes). */
export function parseStyle(css: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let q = '';
  let cur = '';
  const push = () => {
    const i = cur.indexOf(':');
    if (i > 0) out.push([cur.slice(0, i).trim().toLowerCase(), cur.slice(i + 1).trim()]);
    cur = '';
  };
  for (const ch of css) {
    if (q) {
      if (ch === q) q = '';
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && !depth) {
      push();
      continue;
    }
    cur += ch;
  }
  push();
  return out;
}

/** The element's own style, property → value. */
export function getStyle(src: string, n: number): Record<string, string> {
  const el = parseTags(src)[n];
  const a = el && attrs(src, el).find((x) => x.name === 'style');
  return Object.fromEntries(a ? parseStyle(a.value) : []);
}

/** Change properties of the element's own style (undefined or '' takes one away). */
export function setStyle(src: string, n: number, patch: Record<string, string | undefined>): string {
  const el = parseTags(src)[n];
  if (!el) return src;
  const a = attrs(src, el).find((x) => x.name === 'style');
  const decls = a ? parseStyle(a.value) : [];
  for (const [k, v] of Object.entries(patch)) {
    const i = decls.findIndex(([p]) => p === k);
    const val = v?.trim();
    if (!val) {
      if (i >= 0) decls.splice(i, 1);
    } else if (i >= 0) decls[i] = [k, val];
    else decls.push([k, val]);
  }
  const q = a?.quote || '"';
  // written the way the author wrote it: with or without spaces, with or without a last ;
  const old = a?.value ?? '';
  const colon = !old || /:\s/.test(old) ? ': ' : ':';
  // with one declaration there is no ; between two to go by: follow the colon
  const semi = /;\s*\S/.test(old) ? (/;\s/.test(old) ? '; ' : ';') : colon === ': ' ? '; ' : ';';
  const end = /;\s*$/.test(old) && decls.length ? ';' : '';
  // a quote like the one around the attribute would end it early
  const css = decls.map(([k, v]) => `${k}${colon}${v.split(q).join(q === '"' ? "'" : '"')}`).join(semi) + end;
  const attr = css ? ` style=${q}${css}${q}` : '';
  return a ? src.slice(0, a.start) + attr + src.slice(a.end) : src.slice(0, el.attrEnd) + attr + src.slice(el.attrEnd);
}

/** #rrggbb for a color a color box can show ('' when it can't, or it's fully see-through). */
export function toHex(c: string | undefined): string {
  const s = (c ?? '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})[0-9a-f]?$/.exec(s);
  if (m) return '#' + [...m[1]].map((x) => x + x).join('');
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return '#' + m[1];
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return '';
  return '#' + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, '0')).join('');
}

/* ---------- text ---------- */

/** The text inside an element that holds nothing but text (null otherwise). */
export function leafText(src: string, n: number): string | null {
  const el = parseTags(src)[n];
  if (!el || el.children.length || VOID.has(el.name) || RAW.has(el.name) || el.closeStart < el.openEnd) return null;
  // closed by a tag of its own (not cut off by its parent's end)
  if (!/^<\//.test(src.slice(el.closeStart, el.end)) && el.closeStart !== src.length) return null;
  return src.slice(el.openEnd, el.closeStart);
}

export function setLeafText(src: string, n: number, text: string): string {
  const el = parseTags(src)[n];
  if (leafText(src, n) === null) return src;
  // a < would start a tag and change what is where
  return src.slice(0, el.openEnd) + text.replace(/</g, '&lt;') + src.slice(el.closeStart);
}

/* ---------- moving ---------- */

/** The element's siblings it can trade places with, before and after it. */
export function siblings(src: string, n: number): { prev?: number; next?: number } {
  const els = parseTags(src);
  const el = els[n];
  if (!el) return {};
  const list = (el.parent >= 0 ? els[el.parent].children : els.filter((e) => e.parent === -1).map((e) => e.n)).filter((i) => pickable(els[i]));
  const i = list.indexOf(n);
  return { prev: list[i - 1], next: list[i + 1] };
}

/** The element's whole lines when it has them to itself, else just the element. */
function piece(src: string, el: El) {
  let a = el.start;
  while (a > 0 && (src[a - 1] === ' ' || src[a - 1] === '\t')) a--;
  let b = el.end;
  while (b < src.length && (src[b] === ' ' || src[b] === '\t')) b++;
  if ((a === 0 || src[a - 1] === '\n') && (b === src.length || src[b] === '\n' || src[b] === '\r')) {
    if (src[b] === '\r') b++;
    if (src[b] === '\n') b++;
    return { a, b, lines: true };
  }
  return { a: el.start, b: el.end, lines: false };
}

/**
 * Move element `n` before or after its sibling `ref`. Gives the new code and the element's new number, or null when
 * they aren't siblings in the code.
 */
export function moveEl(src: string, n: number, ref: number, after: boolean): { src: string; n: number } | null {
  const els = parseTags(src);
  const el = els[n];
  const to = els[ref];
  if (!el || !to || n === ref || el.parent !== to.parent) return null;
  const from = piece(src, el);
  const at = piece(src, to);
  // whole lines go between lines; otherwise just the element, right next to the other one
  const lines = from.lines && at.lines;
  const cut = lines ? from : { a: el.start, b: el.end };
  let text = src.slice(cut.a, cut.b);
  if (lines && !/\n$/.test(text)) text += '\n';
  let pos = lines ? (after ? at.b : at.a) : after ? to.end : to.start;
  if (lines && after && at.b === src.length && !/\n$/.test(src)) text = '\n' + text.replace(/\n$/, '');
  const rest = src.slice(0, cut.a) + src.slice(cut.b);
  if (pos > cut.a) pos -= cut.b - cut.a;
  const out = rest.slice(0, pos) + text + rest.slice(pos);
  const startAt = pos + text.indexOf('<');
  const moved = parseTags(out).find((e) => e.start === startAt);
  return moved ? { src: out, n: moved.n } : null;
}
