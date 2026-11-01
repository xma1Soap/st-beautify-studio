// 换配色: the colors a beautification's code uses (hex, rgb(), hsl(), front-end cards included), and changing them all
// at once — one color for another, or every hue turned so the main color becomes another. Each color keeps the way
// it was written (hex stays hex, rgba keeps its see-through part); greys stay grey.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

type Kind = 'hex' | 'rgb' | 'hsl';

export interface ColorHit {
  start: number;
  end: number;
  text: string;
  kind: Kind;
  c: Rgba;
  /** written with a see-through part */
  alpha: boolean;
}

const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\([^()]*\)/g;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (s: string, scale: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));

function parse(text: string): { kind: Kind; c: Rgba; alpha: boolean } | null {
  if (text[0] === '#') {
    let h = text.slice(1);
    if (h.length <= 4) h = [...h].map((x) => x + x).join('');
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { kind: 'hex', c: { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) / 255 : 1 }, alpha: h.length === 8 };
  }
  const name = text.slice(0, text.indexOf('(')).toLowerCase();
  const parts = text.slice(text.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4 || parts.some((p) => !/^-?[\d.]+(%|deg)?$/.test(p))) return null;
  const a = parts[3] !== undefined ? clamp(num(parts[3], 1), 0, 1) : 1;
  if (name.startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => clamp(num(p, 255), 0, 255));
    return { kind: 'rgb', c: { r, g, b, a }, alpha: parts.length === 4 };
  }
  const { r, g, b } = hslToRgb(parseFloat(parts[0]), clamp(num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100), 0, 1), clamp(num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100), 0, 1));
  return { kind: 'hsl', c: { r, g, b, a }, alpha: parts.length === 4 };
}

/** Every color written in the code, in order. */
export function findColors(src: string): ColorHit[] {
  const out: ColorHit[] = [];
  for (const m of src.matchAll(COLOR)) {
    const at = m.index!;
    // &#123; is a character, not a color; a#abc is part of a word
    if (m[0][0] === '#' && at > 0 && /[&\w-]/.test(src[at - 1])) continue;
    const p = parse(m[0]);
    if (p) out.push({ start: at, end: at + m[0].length, text: m[0], ...p });
  }
  return out;
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
/** #rrggbb, without the see-through part (what a color box shows, and how colors are grouped). */
export const keyOf = (c: Rgba) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);

export function hexToRgba(hex: string): Rgba {
  return parse(hex)?.c ?? { r: 0, g: 0, b: 0, a: 1 };
}

/** The color written again the way the old one was. */
function write(hit: ColorHit, c: Rgba): string {
  const a = Math.round(c.a * 1000) / 1000;
  const commas = hit.text.includes(',');
  const name = hit.text.slice(0, hit.text.indexOf('('));
  const list = (xs: (string | number)[]) => (commas ? xs.join(', ') : xs.slice(0, 3).join(' ') + (xs[3] !== undefined ? ' / ' + xs[3] : ''));
  if (hit.kind === 'hex') return keyOf(c) + (hit.alpha ? hex2(c.a * 255) : '');
  if (hit.kind === 'rgb') return `${name}(${list([Math.round(c.r), Math.round(c.g), Math.round(c.b), ...(hit.alpha ? [a] : [])])})`;
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  return `${name}(${list([Math.round(h), Math.round(s * 100) + '%', Math.round(l * 100) + '%', ...(hit.alpha ? [a] : [])])})`;
}

/** Change every color (null leaves one as it is). */
export function mapColors(src: string, fn: (c: Rgba, hit: ColorHit) => Rgba | null): string {
  let out = '';
  let at = 0;
  for (const hit of findColors(src)) {
    const c = fn(hit.c, hit);
    // unchanged colors stay exactly as written
    if (!c || (keyOf(c) === keyOf(hit.c) && Math.abs(c.a - hit.c.a) < 0.001)) continue;
    const text = write(hit, c);
    if (text.toLowerCase() === hit.text.toLowerCase()) continue;
    out += src.slice(at, hit.start) + text;
    at = hit.end;
  }
  return out + src.slice(at);
}

export interface PaletteColor {
  key: string;
  count: number;
}

/** The colors used, most used first (the same color with different see-through parts counts as one). */
export function palette(src: string): PaletteColor[] {
  const m = new Map<string, number>();
  for (const h of findColors(src)) m.set(keyOf(h.c), (m.get(keyOf(h.c)) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** One color for another, wherever it is used (its see-through part stays). */
export function swapColor(src: string, from: string, to: string): string {
  const t = hexToRgba(to);
  return mapColors(src, (c) => (keyOf(c) === from.toLowerCase() ? { ...t, a: c.a } : null));
}

/* ---------- hue ---------- */

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Colors this grey (or close to it) keep their hue: turning it would only tint them. */
const GREY = 0.12;

/** The hue the code is mostly about: of its colorful colors, weighted by how much each is used and how colorful. */
export function mainHue(src: string): number | null {
  let x = 0;
  let y = 0;
  for (const h of findColors(src)) {
    const { h: hue, s, l } = rgbToHsl(h.c.r, h.c.g, h.c.b);
    if (s < GREY || l < 0.06 || l > 0.96) continue;
    const w = s * (1 - Math.abs(2 * l - 1));
    x += Math.cos((hue * Math.PI) / 180) * w;
    y += Math.sin((hue * Math.PI) / 180) * w;
  }
  if (Math.hypot(x, y) < 1e-6) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface Adjust {
  /** turn every hue by this much, degrees */
  hue?: number;
  /** make colors more (>1) or less (<1) colorful */
  sat?: number;
  /** dark colors light and light ones dark */
  invert?: boolean;
}

export function adjustColor(c: Rgba, o: Adjust): Rgba {
  const hsl = rgbToHsl(c.r, c.g, c.b);
  let { h, s, l } = hsl;
  if (o.hue && s >= GREY) h += o.hue;
  if (o.sat !== undefined && o.sat !== 1 && s >= GREY) s = clamp(s * o.sat, 0, 1);
  // see-through black is a shadow: it stays dark on a light design too
  if (o.invert && !(c.a < 1 && l < 0.15)) l = 1 - l;
  return { ...hslToRgb(h, s, l), a: c.a };
}

export function adjustColors(src: string, o: Adjust): string {
  if (!o.hue && (o.sat ?? 1) === 1 && !o.invert) return src;
  return mapColors(src, (c) => adjustColor(c, o));
}

/** How far to turn the hues so the main color lands on `target` (-180…180). */
export function turnTo(src: string, target: number): number {
  const h = mainHue(src);
  if (h === null) return 0;
  return ((((target - h + 180) % 360) + 360) % 360) - 180;
}
