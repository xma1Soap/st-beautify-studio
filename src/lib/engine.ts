// Regex engine that follows SillyTavern's public/scripts/extensions/regex/engine.js
import type { RegexScript, Settings } from './types';

export interface Macros { user: string; char: string }
export interface MatchInfo { text: string; groups: (string | undefined)[] }
export interface RunResult { out: string; hits: number; err?: string; matches: MatchInfo[] }

export function parseRegex(input: string): { re?: RegExp; err?: string } {
  try {
    const m = input.match(/(\/?)(.+)\1([a-z]*)/i);
    if (!m) return { err: '正则为空' };
    if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return { re: new RegExp(input) };
    return { re: new RegExp(m[2], m[3]) };
  } catch (e) {
    return { err: (e as Error).message };
  }
}

const fixed = (v: string) => () => v;
export function subst(s: string, m: Macros): string {
  return String(s)
    .replace(/\{\{user\}\}|<USER>/gi, fixed(m.user))
    .replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, fixed(m.char))
    .replace(/\{\{newline\}\}/gi, '\n')
    .replace(/\{\{trim\}\}/gi, '');
}
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function substEscaped(s: string, m: Macros): string {
  return s
    .replace(/\{\{user\}\}|<USER>/gi, fixed(reEsc(m.user)))
    .replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, fixed(reEsc(m.char)));
}
export function findString(sc: RegexScript, m: Macros): string {
  if (sc.substituteRegex === 1) return subst(sc.findRegex, m);
  if (sc.substituteRegex === 2) return substEscaped(sc.findRegex, m);
  return sc.findRegex;
}
function filterString(s: string, trims: string[], m: Macros): string {
  let out = s;
  for (const t of trims) if (t) out = out.split(subst(t, m)).join('');
  return out;
}
const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

/** number of capture groups in the script's find regex (0 if invalid) */
export function groupCount(sc: RegexScript, m: Macros): number {
  const { re } = parseRegex(findString(sc, m));
  if (!re) return 0;
  try { return (new RegExp(re.source + '|').exec('')?.length ?? 1) - 1; } catch { return 0; }
}

export function runScript(sc: RegexScript, str: string, m: Macros): RunResult {
  const res: RunResult = { out: str, hits: 0, matches: [] };
  if (!sc.findRegex) return res;
  const { re, err } = parseRegex(findString(sc, m));
  if (!re) return { ...res, err: err || '无效正则' };
  if (!str) return res;
  res.out = str.replace(re, (...args: any[]) => {
    res.hits++;
    const last = args[args.length - 1];
    const hasNamed = typeof last === 'object' && last !== null;
    const end = args.length - (hasNamed ? 3 : 2);
    if (res.matches.length < 20) {
      res.matches.push({
        text: clip(String(args[0])),
        groups: args.slice(1, end).map((g) => (g === undefined ? undefined : clip(String(g)))),
      });
    }
    let match: any = args[0];
    const rep = String(sc.replaceString).replace(/{{match}}/gi, '$0');
    const withGroups = rep.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_: string, num?: string, name?: string) => {
      if (num) match = args[Number(num)];
      else if (name) match = hasNamed && last[name];
      if (!match) return '';
      return filterString(String(match), sc.trimStrings, m);
    });
    return subst(withGroups, m);
  });
  return res;
}

function depthOk(sc: RegexScript, d: number): boolean {
  if (sc.minDepth !== null && !isNaN(sc.minDepth) && sc.minDepth >= -1 && d < sc.minDepth) return false;
  if (sc.maxDepth !== null && !isNaN(sc.maxDepth) && sc.maxDepth >= 0 && d > sc.maxDepth) return false;
  return true;
}

/** Why an enabled script would not touch the displayed message; '' when it does. */
export function skipReason(sc: RegexScript, s: Settings): string {
  if (!sc.placement.includes(s.role)) return s.role === 2 ? '不作用于 AI 输出' : '不作用于用户输入';
  if (sc.promptOnly && !sc.markdownOnly) return '仅提示词，不影响显示';
  if (!depthOk(sc, s.depth)) return '当前楼层深度不生效';
  return '';
}

export interface Processed { raw: string; display: string; stats: Record<string, RunResult> }

export function processText(scripts: RegexScript[], text: string, s: Settings): Processed {
  const m = { user: s.user, char: s.char };
  const stats: Record<string, RunResult> = {};
  const active = scripts.filter((x) => !x.disabled && !skipReason(x, s));
  // chat messages are stored with {{user}}/{{char}} already filled in
  let out = subst(text, m);
  // 1) scripts with neither flag rewrite the stored message when it arrives
  for (const x of active.filter((x) => !x.markdownOnly && !x.promptOnly)) {
    const r = runScript(x, out, m); out = r.out; stats[x.id] = r;
  }
  const raw = out;
  // 2) "markdown only" scripts run when the message is displayed
  for (const x of active.filter((x) => x.markdownOnly)) {
    const r = runScript(x, out, m); out = r.out; stats[x.id] = r;
  }
  return { raw, display: out, stats };
}

/* ---------- sample text: walk the regex source and emit one string that matches ---------- */
export const SAMPLE_CONTENT = '示例内容';

export function genSample(sc: RegexScript, m: Macros): string {
  const { re } = parseRegex(findString(sc, m));
  if (!re) return '';
  const src = re.source;
  const C = SAMPLE_CONTENT;
  let i = 0, gi = 0;
  const groups: string[] = [];
  const named: Record<string, string> = {};
  const esc = (c: string) =>
    (({ s: '\n', S: 'x', d: '1', D: 'x', w: 'a', W: ' ', n: '\n', t: '\t', r: '', b: '', B: '', f: '', v: '', 0: '' }) as Record<string, string>)[c] ?? c;

  function alt(): string {
    const alts = [''];
    while (i < src.length && src[i] !== ')') {
      if (src[i] === '|') { alts.push(''); i++; continue; }
      alts[alts.length - 1] += quant(atom());
    }
    return alts[0] || alts.find((a) => a) || '';
  }
  function atom(): string {
    const c = src[i];
    if (c === '(') {
      i++;
      let cap = true, look = false, name: string | null = null;
      if (src[i] === '?') {
        i++;
        const n = src[i];
        if (n === ':') { i++; cap = false; }
        else if (n === '=' || n === '!') { i++; cap = false; look = true; }
        else if (n === '<' && (src[i + 1] === '=' || src[i + 1] === '!')) { i += 2; cap = false; look = true; }
        else if (n === '<') { const e = src.indexOf('>', i); name = src.slice(i + 1, e); i = e + 1; }
        else cap = false;
      }
      const idx = cap ? ++gi : 0;
      const t = alt();
      i++;
      if (look) return '';
      if (idx) groups[idx] = t;
      if (name) named[name] = t;
      return t;
    }
    if (c === '[') {
      i++;
      let neg = false, body = '';
      if (src[i] === '^') { neg = true; i++; }
      if (src[i] === ']') { body += ']'; i++; }
      while (i < src.length && src[i] !== ']') {
        if (src[i] === '\\') { body += src[i] + src[i + 1]; i += 2; } else body += src[i++];
      }
      i++;
      if (neg || !body) return C;
      const both = (a: string, b: string) => body.includes('\\' + a) && body.includes('\\' + b);
      if (both('s', 'S') || both('w', 'W') || both('d', 'D')) return C;
      return body[0] === '\\' ? esc(body[1]) : body[0];
    }
    if (c === '\\') {
      const n = src[i + 1];
      i += 2;
      if (/[1-9]/.test(n)) { let num = n; while (/\d/.test(src[i] ?? '')) num += src[i++]; return groups[+num] || ''; }
      if (n === 'k' && src[i] === '<') { const e = src.indexOf('>', i); const nm = src.slice(i + 1, e); i = e + 1; return named[nm] || ''; }
      if (n === 'u' && src[i] === '{') { const e = src.indexOf('}', i); const cp = parseInt(src.slice(i + 1, e), 16); i = e + 1; return String.fromCodePoint(cp); }
      if (n === 'u') { const h = src.slice(i, i + 4); i += 4; return String.fromCharCode(parseInt(h, 16)); }
      if (n === 'x') { const h = src.slice(i, i + 2); i += 2; return String.fromCharCode(parseInt(h, 16)); }
      if (n === 'p' || n === 'P') { if (src[i] === '{') i = src.indexOf('}', i) + 1; return 'a'; }
      return esc(n);
    }
    if (c === '.') { i++; return C; }
    if (c === '^' || c === '$') { i++; return ''; }
    i++;
    return c;
  }
  function quant(t: string): string {
    const c = src[i];
    let n = 1;
    if (c === '*' || c === '+' || c === '?') i++;
    else if (c === '{' && /^\{\d+(,\d*)?\}/.test(src.slice(i))) {
      const mm = src.slice(i).match(/^\{(\d+)(?:,(\d*))?\}/)!;
      i += mm[0].length;
      n = Math.max(1, Math.min(+mm[1], 3));
    } else return t;
    if (src[i] === '?' || src[i] === '+') i++;
    return t === C ? t : t.repeat(n);
  }
  try {
    let out = '';
    while (i < src.length) { out += alt(); if (src[i] === ')') i++; }
    return out.trim();
  } catch {
    return '';
  }
}

export function generateAll(scripts: RegexScript[], s: Settings): string {
  const m = { user: s.user, char: s.char };
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const x of scripts) {
    if (x.disabled || skipReason(x, s) || !x.replaceString) continue;
    const t = genSample(x, m);
    if (t && !seen.has(t)) { seen.add(t); parts.push(t); }
  }
  return parts.length ? '这是一段正文示例。\n\n' + parts.join('\n\n') : '';
}
