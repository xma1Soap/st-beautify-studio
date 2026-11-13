// SillyTavern draws its chat with its own copies of Noto Sans (text 500, names 700, times 400) and Noto Sans Mono
// (code), not with whatever the computer has. The preview puts the same font files into its chat page, so Latin
// letters, digits and the punctuation Chinese text uses (“ ” … —) look and wrap the same on every computer.
//
// The files (src/assets/st-fonts, made by scripts/st-fonts.py from SillyTavern's) are cut into a common part and the
// rest of each font; a page gets the faces its message can use (italic only with <em>, code only with <code>, ...)
// and a face's rest only when the message has a character from it. The preview is a sandboxed frame that can't load
// the app's files, so they go in as data: URLs: a few dozen KB for an ordinary message.
import FACES from '../assets/st-fonts/faces.json';

interface Face {
  family: string;
  weight: number;
  style: string;
  part: string;
  file: string;
  range: string;
}
const faces = FACES as Face[];

let data: Record<string, string> | null = null;
let loading: Promise<void> | undefined;

/** The font files (about 1.7 MB as text, so loaded on their own the first time a preview is built). */
export function loadStFonts(): Promise<void> {
  loading ??= import('./stFontData').then(
    (m) => {
      data = m.default;
    },
    (e) => {
      loading = undefined;
      throw e;
    },
  );
  return loading;
}

const key = (family: string, weight: number, style: string) => `${family}|${weight}|${style}`;

/** The faces a message can use, from its HTML (all of them when it brings its own styles). */
export function wantedFaces(html: string): Set<string> {
  const all = /<style|font-(weight|style)\s*:/i.test(html);
  const italic = all || /<(em|i|cite|var|dfn)[\s>]/i.test(html);
  const bold = all || /<(strong|b|h[1-6]|th)[\s>]/i.test(html);
  const code = /<(code|pre|kbd|samp)[\s>]/i.test(html);
  const want = [key('Noto Sans', 400, 'normal'), key('Noto Sans', 500, 'normal'), key('Noto Sans', 700, 'normal')];
  if (all) want.push(key('Noto Sans', 400, 'italic'));
  if (italic) want.push(key('Noto Sans', 500, 'italic'));
  if (italic && bold) want.push(key('Noto Sans', 700, 'italic'));
  if (code) {
    want.push(key('Noto Sans Mono', 500, 'normal'));
    // highlight.js makes some code bold
    if (bold || /hljs-(strong|meta)/.test(html)) want.push(key('Noto Sans Mono', 700, 'normal'));
    if (all) want.push(key('Noto Sans Mono', 400, 'normal'));
  }
  return new Set(want);
}

const sets = new Map<string, Set<number>>();
/** The characters a face file has (from its unicode-range). */
function charsOf(f: Face): Set<number> {
  let s = sets.get(f.file);
  if (!s) {
    s = new Set();
    for (const r of f.range.split(',')) {
      const [a, b] = r.trim().slice(2).split('-');
      for (let c = parseInt(a, 16), end = parseInt(b ?? a, 16); c <= end; c++) s.add(c);
    }
    sets.set(f.file, s);
  }
  return s;
}

/** Whether `text` has a character the face file has (ASCII is always in the common part). */
function needs(text: string, f: Face): boolean {
  const s = charsOf(f);
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x80 && s.has(c)) return true;
  }
  return false;
}

/** The font files a message page gets: [face, file name] in the order they are declared. */
export function pickFaces(html: string, names = ''): Face[] {
  const want = wantedFaces(html);
  const text = html + names;
  return faces.filter((f) => want.has(key(f.family, f.weight, f.style)) && (f.part === 'core' || needs(text, f)));
}

/** @font-face rules for a message page (empty until loadStFonts has finished). */
export function stFontCss(html: string, names = ''): string {
  const d = data;
  if (!d) return '';
  return pickFaces(html, names)
    .filter((f) => d[f.file])
    .map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};font-display:block;src:url(${d[f.file]}) format("woff2");unicode-range:${f.range}}`)
    .join('\n');
}
