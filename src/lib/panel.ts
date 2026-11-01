// 解析型面板: the AI writes a block of sections — a {标题} line, then rows — and a front-end card splits it into
// collapsible panels, each with its own icon and color, turning what is in the rows into meters, tags and colored
// words by rules. Made from scratch here, or recognized from a card like that someone already wrote.
//
// The card is generated code. The settings are kept in a comment inside it (like a canvas-made regex), with a
// checksum to tell when the code was changed by hand afterwards.
import { cleanTag, fromB64, hash, toB64 } from './builder';
import { newId } from './id';
import { findColors, keyOf, type Rgba } from './palette';

export interface PanelSection {
  name: string;
  /** other names the AI may write for it (繁体, a shorter name…) */
  aliases: string[];
  icon: string;
  color: string;
  open: boolean;
}

export type RuleKind = 'meter' | 'field' | 'stat' | 'words' | 'dice' | 'number';

export interface PanelRule {
  kind: RuleKind;
  /** meter / stat: the name before the numbers (HP, 力); field: the field names, | between; words: the words, 、 between */
  name: string;
  color: string;
  /** meter: at or below this % it turns lowColor */
  low?: number;
  lowColor?: string;
  /** stat: shown instead of the name (力 → 力量) */
  label?: string;
}

export interface PanelTheme {
  /** panel background */
  bg: string;
  border: string;
  /** section header background */
  head: string;
  /** section titles */
  title: string;
  text: string;
  /** row background */
  row: string;
}

export interface PanelDef {
  v: 1;
  tag: string;
  /** how a section starts: {标题} or 【标题】 */
  title: 'brace' | 'bracket';
  /** what a row is: a line between | and |, or any line */
  rows: 'pipe' | 'line';
  sections: PanelSection[];
  rules: PanelRule[];
  theme: PanelTheme;
  key?: string;
}

export const RULE_KINDS: { kind: RuleKind; label: string; note: string }[] = [
  { kind: 'meter', label: '数值条', note: '「HP 30/100」显示成一条血条，低了变色' },
  { kind: 'field', label: '字段', note: '「回合: 3」把值显示成彩色标签' },
  { kind: 'stat', label: '属性', note: '「力12」显示成属性小块' },
  { kind: 'words', label: '关键词', note: '列出的词（敌人名字、物品……）上色' },
  { kind: 'dice', label: '骰子', note: '「🎲 15」「1d20+3」上色' },
  { kind: 'number', label: '其他数字', note: '前面的规则没认出的数字上色' },
];

export const DEFAULT_THEME: PanelTheme = { bg: '#1e1e32', border: '#8b7355', head: '#2d2d44', title: '#ffd700', text: '#e8d5b7', row: '#0000004d' };

export function newPanel(): PanelDef {
  return {
    v: 1,
    tag: '战况',
    title: 'brace',
    rows: 'pipe',
    sections: [
      { name: '战况总览', aliases: [], icon: '📜', color: '#ffd166', open: true },
      { name: '行动', aliases: [], icon: '⚔️', color: '#ff7b7b', open: true },
      { name: '结算', aliases: [], icon: '🏁', color: '#6bd69a', open: false },
    ],
    rules: [
      { kind: 'meter', name: 'HP', color: '#d64545', low: 30, lowColor: '#e8892b' },
      { kind: 'meter', name: 'MP', color: '#3d7fd6', low: 30, lowColor: '#1f9e8f' },
      { kind: 'field', name: '回合|环境|目标', color: '#6b5fd6' },
      { kind: 'dice', name: '', color: '#63b3ed' },
      { kind: 'number', name: '', color: '#fbd38d' },
    ],
    theme: { ...DEFAULT_THEME },
    key: newId(),
  };
}

/* ---------- reading settings back (anything missing or wrong gets a sensible value) ---------- */

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && v.trim() && v.length < 60 ? v.trim() : d);

export function cleanPanel(o: any): PanelDef {
  const d = newPanel();
  const sections: PanelSection[] = Array.isArray(o?.sections)
    ? o.sections.slice(0, 60).map((s: any) => ({
        name: str(s?.name).trim().slice(0, 30),
        aliases: Array.isArray(s?.aliases) ? s.aliases.map((a: unknown) => str(a).trim()).filter(Boolean).slice(0, 10) : [],
        icon: str(s?.icon, '◆').slice(0, 8),
        color: color(s?.color, '#ffd166'),
        open: s?.open !== false,
      }))
    : d.sections;
  const kinds = RULE_KINDS.map((k) => k.kind);
  const rules: PanelRule[] = Array.isArray(o?.rules)
    ? o.rules
        .filter((r: any) => kinds.includes(r?.kind))
        .slice(0, 80)
        .map((r: any) => ({
          kind: r.kind,
          name: str(r.name).slice(0, 2000),
          color: color(r.color, '#ffd166'),
          ...(r.kind === 'meter' ? { low: Math.min(100, Math.max(0, Number(r.low) || 0)), lowColor: color(r.lowColor, '#e8892b') } : {}),
          ...(r.kind === 'stat' && str(r.label) ? { label: str(r.label).slice(0, 12) } : {}),
        }))
    : d.rules;
  const t = o?.theme ?? {};
  const theme: PanelTheme = Object.fromEntries((Object.keys(DEFAULT_THEME) as (keyof PanelTheme)[]).map((k) => [k, color(t[k], DEFAULT_THEME[k])])) as unknown as PanelTheme;
  return {
    v: 1,
    tag: cleanTag(str(o?.tag, d.tag)),
    title: o?.title === 'bracket' ? 'bracket' : 'brace',
    rows: o?.rows === 'line' ? 'line' : 'pipe',
    sections,
    rules,
    theme,
    ...(typeof o?.key === 'string' && o.key ? { key: o.key } : {}),
  };
}

/* ---------- the card ---------- */

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const list = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);
export const fieldNames = (r: PanelRule) => list(r.name, /[|｜]/);
export const wordList = (r: PanelRule) => list(r.name, /[、,，\n]/);

/** The pattern a rule finds in a row (empty: it has nothing to look for yet). */
export function rulePattern(r: PanelRule): string {
  const N = '(\\d+(?:\\.\\d+)?)';
  switch (r.kind) {
    case 'meter':
      return r.name.trim() ? `${reEsc(r.name.trim())}\\s{0,3}[:：]?\\s{0,3}\\[?${N}\\s{0,3}\\/\\s{0,3}${N}\\]?` : '';
    case 'field': {
      const names = fieldNames(r).sort((a, b) => b.length - a.length).map(reEsc).join('|');
      // the value ends at | , ; or where the next field or an arrow starts (攻方: 艾琳 -> 守方: 哥布林)
      return names ? `(${names})\\s{0,3}[:：]\\s{0,3}((?:(?!\\s{0,3}(?:(?:${names})\\s{0,3}[:：]|->|→))[^|｜,，;；])+)` : '';
    }
    case 'stat':
      return r.name.trim() ? `${reEsc(r.name.trim())}\\s{0,2}\\[?(\\d+)\\]?` : '';
    case 'words': {
      const words = wordList(r).sort((a, b) => b.length - a.length).map(reEsc);
      return words.length ? `(?:${words.join('|')})` : '';
    }
    case 'dice':
      return '(?:🎲|骰子?)\\s{0,3}[:：]?\\s{0,3}\\d+|\\d{0,3}[dD]\\d+(?:\\s{0,2}[+-]\\s{0,2}\\d+)?(?:\\s{0,2}=\\s{0,2}\\d+)?';
    case 'number':
      return '\\d+(?:\\.\\d+)?%?';
  }
}

/**
 * Settings as a JSON literal that is safe inside a regex replacement, a <script> and ST's markdown fix: no $1 / $<…>
 * for the regex to fill in, no {{…}} for macros, no < to end the script, no backtick to end the fence, and no * " or _
 * inside strings (ST adds a * or " to a line with an odd number of them). Those only ever appear inside strings, and
 * \u escapes there mean the same.
 */
export function safeJson(v: unknown): string {
  const u = (c: string) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  return JSON.stringify(v).replace(/"((?:[^"\\]|\\.)*)"/g, (_, s: string) => '"' + s.replace(/\\(.)|([$<>*_`{])/g, (m, esc, c) => (c ? u(c) : esc === '"' ? u('"') : m)) + '"');
}

// Lines of the AI's text can end in a * or " ST added (see above): after a closing | } or 】 it is never the AI's.
// Runs in the card. ES5, single quotes, and none of * " < ` {{ or $ followed by a digit or <: the code sits inside a
// regex replacement (which fills in $1) shown by ST (which fills in {{macros}} and evens out * and " on each line).
const RUNTIME = String.raw`
(function () {
  var root = document.getElementById('sp');
  var box = document.getElementById('spd');
  var ta = box ? (box.content || box).querySelector('textarea') : null;
  var src = ta ? ta.value : '';
  var KEY = 'stbs-panel-' + C.key;
  var OPEN = {};
  try { OPEN = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { OPEN = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(OPEN)); } catch (e) {} }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function findSec(name) {
    for (var i = 0; C.sections.length > i; i++) {
      var s = C.sections[i];
      if (s.name === name || s.aliases.indexOf(name) >= 0) return s;
    }
    return null;
  }
  var TITLE = C.title === 'bracket' ? /^【(.+)】$/ : /^\{(.+)\}$/;
  var secs = [];
  var cur = null;
  var lines = src.split('\n');
  for (var i = 0; lines.length > i; i++) {
    var line = lines[i].trim().replace(/([|｜}】])[\u0022\u002a]$/, function (s, end) { return end; });
    if (!line) continue;
    var m = TITLE.exec(line);
    if (m) { cur = { name: m[1].trim(), rows: [] }; secs.push(cur); continue; }
    if (C.rows === 'pipe') {
      if (line.charAt(0) !== '|' && line.charAt(0) !== '｜') continue;
      line = line.replace(/^[|｜]/, '').replace(/[|｜]$/, '').trim();
      if (!line) continue;
    }
    if (!cur) { cur = { name: '', rows: [] }; secs.push(cur); }
    cur.rows.push(line);
  }
  var RULES = [];
  for (var r = 0; C.rules.length > r; r++) {
    if (!C.rules[r].re) continue;
    try { RULES.push({ rule: C.rules[r], re: new RegExp(C.rules[r].re, 'g') }); } catch (e) {}
  }
  function paint(e, c) { e.style.setProperty('--c', c); return e; }
  function piece(rule, m) {
    var k = rule.kind;
    if (k === 'meter') {
      var now = parseFloat(m[1]);
      var max = parseFloat(m[2]);
      var pct = max > 0 ? Math.max(0, Math.min(100, now / max / 0.01)) : 0;
      var low = rule.low > 0 && rule.low >= pct;
      var w = paint(el('span', 'sp-meter' + (low ? ' low' : '')), low ? rule.lowColor : rule.color);
      w.appendChild(el('b', '', rule.name));
      var bar = el('i');
      var fill = el('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      w.appendChild(bar);
      w.appendChild(el('span', 'sp-num', m[1] + '/' + m[2]));
      return w;
    }
    if (k === 'field') {
      var f = el('span', 'sp-field');
      f.appendChild(el('span', 'sp-label', m[1]));
      f.appendChild(paint(el('span', 'sp-tag', m[2].trim()), rule.color));
      return f;
    }
    if (k === 'stat') return paint(el('span', 'sp-stat', (rule.label || rule.name) + ' ' + m[1]), rule.color);
    return paint(el('span', 'sp-hl' + (k === 'dice' ? ' sp-dice' : ''), m[0]), rule.color);
  }
  function plain(d, s) {
    if (!s) return;
    var parts = s.split(/\s{0,9}[|｜]\s{0,9}/);
    for (var i = 0; parts.length > i; i++) {
      if (i) d.appendChild(el('span', 'sp-sep', '｜'));
      if (parts[i]) d.appendChild(document.createTextNode(parts[i]));
    }
  }
  function row(text) {
    var d = el('div', 'sp-row');
    var p = 0;
    for (var guard = 0; text.length > p && 400 > guard; guard++) {
      var best = null;
      for (var j = 0; RULES.length > j; j++) {
        RULES[j].re.lastIndex = p;
        var mm = RULES[j].re.exec(text);
        if (mm && mm[0] && (!best || best.m.index > mm.index)) best = { rule: RULES[j].rule, m: mm };
      }
      if (!best) break;
      plain(d, text.slice(p, best.m.index));
      d.appendChild(piece(best.rule, best.m));
      p = best.m.index + best.m[0].length;
    }
    plain(d, text.slice(p));
    return d;
  }
  function section(sc) {
    var cfg = findSec(sc.name) || { name: sc.name, icon: C.icon, color: C.color, open: true };
    var id = cfg.name || sc.name;
    var open = OPEN[id] !== undefined ? OPEN[id] : cfg.open;
    var pn = paint(el('div', 'sp-panel' + (open ? '' : ' shut')), cfg.color);
    if (sc.name) {
      var hd = el('div', 'sp-head');
      hd.appendChild(el('span', 'sp-icon', cfg.icon));
      hd.appendChild(el('span', 'sp-title', sc.name));
      hd.appendChild(el('span', 'sp-arrow', '▾'));
      hd.addEventListener('click', function () {
        OPEN[id] = !pn.classList.toggle('shut');
        save();
      });
      pn.appendChild(hd);
    }
    var body = el('div', 'sp-body');
    for (var z = 0; sc.rows.length > z; z++) body.appendChild(row(sc.rows[z]));
    pn.appendChild(body);
    return pn;
  }
  root.replaceChildren();
  for (var q = 0; secs.length > q; q++) root.appendChild(section(secs[q]));
  if (!secs.length && src.trim()) root.appendChild(el('div', 'sp-row', src.trim()));
})();`;

/** A color with some see-through added (for lines that should be quieter than the border). */
function soften(c: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(c) ? c + alpha : c;
}

function css(t: PanelTheme): string {
  return [
    'html,body{margin:0;padding:0;background:transparent}',
    `body{font-family:'Noto Serif SC','Songti SC','SimSun',serif;color:${t.text};font-size:14px;line-height:1.5}`,
    '#sp{display:flex;flex-direction:column;gap:10px}',
    `.sp-panel{background:${t.bg};border:1px solid ${t.border};border-radius:8px;overflow:hidden;box-shadow:inset 3px 0 0 var(--c)}`,
    `.sp-head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:${t.head};border-bottom:1px solid ${t.border};cursor:pointer;user-select:none}`,
    '.sp-icon{color:var(--c);width:1.4em;text-align:center;font-size:1.1em}',
    `.sp-title{flex:1;font-weight:700;letter-spacing:2px;color:${t.title}}`,
    `.sp-arrow{color:${t.border};transition:transform .2s}`,
    '.sp-panel.shut .sp-arrow{transform:rotate(-90deg)}',
    '.sp-panel.shut .sp-body{display:none}',
    '.sp-panel.shut .sp-head{border-bottom-color:transparent}',
    '.sp-body{padding:10px;display:flex;flex-direction:column;gap:6px}',
    `.sp-row{background:${t.row};border:1px solid ${soften(t.border, '4d')};border-radius:4px;padding:7px 10px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;word-break:break-word}`,
    '.sp-sep{opacity:.35;padding:0 2px}',
    '.sp-field{display:inline-flex;align-items:center;gap:5px}',
    '.sp-label{opacity:.85}',
    '.sp-tag{display:inline-block;padding:1px 8px;border-radius:3px;background:var(--c);color:#fff;font-weight:600;font-size:.9em}',
    '.sp-meter{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:4px;border:1px solid var(--c);background:color-mix(in srgb,var(--c) 20%,transparent);font-size:.9em}',
    '.sp-meter b{color:var(--c)}',
    '.sp-meter > i{display:inline-block;width:64px;height:6px;border-radius:3px;background:rgba(0,0,0,.4);overflow:hidden}',
    '.sp-meter > i > i{display:block;height:100%;background:var(--c)}',
    '.sp-stat{display:inline-block;padding:1px 6px;border-radius:3px;border:1px solid var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);font-weight:600;font-size:.9em}',
    '.sp-hl{color:var(--c);font-weight:700}',
  ].join('\n');
}

const MARK = '<!--stbs-panel:';

export const panelFind = (tag: string) => `/<${reEsc(cleanTag(tag))}>([\\s\\S]*?)<\\/${reEsc(cleanTag(tag))}>/g`;

/** The regex for a panel. */
export function compilePanel(p0: PanelDef): { findRegex: string; replaceString: string } {
  const p = cleanPanel(p0);
  const key = p.key || 'sp';
  const C = {
    key,
    title: p.title,
    rows: p.rows,
    icon: '◆',
    color: p.theme.title,
    sections: p.sections.filter((s) => s.name).map((s) => ({ name: s.name, aliases: s.aliases, icon: s.icon, color: s.color, open: s.open })),
    rules: p.rules.map((r) => ({ ...r, re: rulePattern(r) })).filter((r) => r.re),
  };
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<style>',
    css(p.theme),
    '</style>',
    '</head>',
    '<body>',
    '<template id="spd"><textarea>$1</textarea></template>',
    '<div id="sp"></div>',
    `<script>var C = ${safeJson(C)};${RUNTIME}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
  const findRegex = panelFind(p.tag);
  const body = '```html\n' + html + '\n```';
  const saved: PanelDef = { ...p, key };
  const mark = `${MARK}${hash(findRegex + '\n' + body)}:${toB64(JSON.stringify(saved))}-->`;
  return { findRegex, replaceString: body.replace(/\n```$/, () => '\n' + mark + '\n```') };
}

/** The panel kept in a regex, and whether its code was changed by hand since. Null: not a panel made here. */
export function readPanel(s: { findRegex: string; replaceString: string }): { p: PanelDef; edited: boolean } | null {
  const i = s.replaceString.indexOf(MARK);
  if (i < 0) return null;
  const j = s.replaceString.indexOf('-->', i);
  const [sum, data] = s.replaceString.slice(i + MARK.length, j < 0 ? undefined : j).split(':');
  try {
    const o = JSON.parse(fromB64(data));
    if (o?.v !== 1 || !Array.isArray(o.sections)) return null;
    const rest = s.replaceString.slice(0, i).replace(/\n$/, '') + (j < 0 ? '' : s.replaceString.slice(j + 3));
    return { p: cleanPanel(o), edited: hash(s.findRegex + '\n' + rest) !== sum };
  } catch {
    return null;
  }
}

export const isPanel = (replace: string) => replace.includes(MARK);

/* ---------- for the AI and for trying it out ---------- */

const open = (p: PanelDef, name: string) => (p.title === 'bracket' ? `【${name}】` : `{${name}}`);
const rowOf = (p: PanelDef, items: string[]) => (p.rows === 'pipe' ? `|${items.join(' | ')}|` : items.join('  '));

/** A block written the way the AI should write it, using every rule once. */
export function panelSample(p0: PanelDef): string {
  const p = cleanPanel(p0);
  const values = ['3', '月影森林', '哥布林斥候', '顺利'];
  // a long list read from a card goes 简体, 繁体, 简体…: every other one, so the sample doesn't say 回合 twice
  const someFields = (r: PanelRule) => {
    const all = fieldNames(r);
    return all.filter((_, i) => i % (all.length >= 4 ? 2 : 1) === 0).slice(0, 2);
  };
  const fields = p.rules.filter((r) => r.kind === 'field').flatMap(someFields).slice(0, 3).map((n, i) => `${n}: ${values[i % values.length]}`);
  const meters = p.rules.filter((r) => r.kind === 'meter' && r.name.trim()).map((r, i) => `${r.name.trim()} ${['72/100', '18/60', '9/40'][i % 3]}`);
  const stats = p.rules.filter((r) => r.kind === 'stat' && r.name.trim()).slice(0, 5).map((r, i) => `${r.name.trim()}${12 + i}`);
  const words = p.rules.filter((r) => r.kind === 'words').map((r) => wordList(r)[0]).filter(Boolean);
  const dice = p.rules.some((r) => r.kind === 'dice') ? ['🎲 15'] : [];
  const named = p.sections.filter((s) => s.name);
  const rows: string[][] = [[], [], []];
  if (fields.length) rows[0].push(rowOf(p, fields));
  if (meters.length) rows[0].push(rowOf(p, meters));
  if (stats.length) rows[1].push(rowOf(p, stats));
  if (dice.length || words.length) rows[1].push(rowOf(p, [...words.slice(0, 2).map((w) => `${w} 出手`), ...dice.map((d) => `${d} → 命中`)]));
  rows[2].push(rowOf(p, ['结果: 击退敌人，获得 120 经验']));
  const out: string[] = [`<${p.tag}>`];
  if (!named.length) out.push(...rows.flat());
  else {
    // fewer sections than groups of rows: the rest go into the last one
    named.forEach((s, i) => {
      out.push(open(p, s.name));
      const mine = i === named.length - 1 ? rows.slice(i).flat() : rows[i] ?? [];
      out.push(...(mine.length ? mine : [rowOf(p, ['……'])]));
    });
  }
  out.push(`</${p.tag}>`);
  return out.join('\n');
}

/** What to tell the AI so it writes the panel this way. */
export function panelPrompt(p0: PanelDef): string {
  const p = cleanPanel(p0);
  const named = p.sections.filter((s) => s.name);
  const lines = [
    `在回复的最后，按下面的格式输出面板，放在 <${p.tag}> 和 </${p.tag}> 之间：`,
    `- 每个分段先单独写一行 ${open(p, '分段名')}，下面一行一条内容` + (p.rows === 'pipe' ? '，每行用 | 开头、用 | 结尾，同一行里的几项用 | 隔开' : ''),
  ];
  if (named.length) lines.push(`- 分段（用得上的才写）：${named.map((s) => s.name).join('、')}`);
  const meters = p.rules.filter((r) => r.kind === 'meter' && r.name.trim()).map((r) => r.name.trim());
  if (meters.length) lines.push(`- ${meters.join('、')} 写成「名字 当前/最大」，比如 ${meters[0]} 72/100`);
  const fields = p.rules.filter((r) => r.kind === 'field').flatMap(fieldNames);
  if (fields.length) lines.push(`- 这些项写成「名字: 值」：${fields.slice(0, 30).join('、')}${fields.length > 30 ? ' 等' : ''}`);
  const stats = p.rules.filter((r) => r.kind === 'stat' && r.name.trim()).map((r) => r.name.trim());
  if (stats.length) lines.push(`- 属性写成名字加数字：${stats.map((s, i) => s + (12 + i)).join('、')}`);
  if (p.rules.some((r) => r.kind === 'dice')) lines.push('- 掷骰写成「🎲 数字」或「1d20+3」');
  lines.push('例子：', panelSample(p));
  return lines.join('\n');
}

/* ---------- recognizing a card someone else wrote ---------- */

const FA_EMOJI: [RegExp, string][] = [
  [/scroll|book/, '📜'],
  [/hourglass|clock|time/, '⏳'],
  [/crosshairs|bullseye|target/, '🎯'],
  [/calculator/, '🧮'],
  [/list|check/, '✅'],
  [/chess|knight/, '♞'],
  [/heart-crack|heart-broken/, '💔'],
  [/heart/, '❤️'],
  [/flag/, '🏁'],
  [/chart|line/, '📈'],
  [/hammer|wrench|tool/, '🔨'],
  [/flask|vial|potion/, '⚗️'],
  [/box|chest|gift/, '📦'],
  [/sword|khanda|fist|gavel/, '⚔️'],
  [/shield/, '🛡️'],
  [/star/, '⭐'],
  [/skull/, '💀'],
  [/user|person|people/, '👤'],
  [/map|location|compass/, '🧭'],
  [/fire|flame/, '🔥'],
  [/bolt|lightning/, '⚡'],
  [/dice/, '🎲'],
  [/coins?|money|gem/, '💰'],
];

/** An emoji for an icon written as a Font Awesome class (cards loading Font Awesome can't count on it in ST). */
function iconOf(icon: string): string {
  if (!/fa-|^fa/.test(icon)) return icon.trim().slice(0, 8) || '◆';
  const name = icon.toLowerCase();
  return FA_EMOJI.find(([re]) => re.test(name))?.[1] ?? '◆';
}

const cssText = (code: string) => [...code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');

const toCss = (c: Rgba) => keyOf(c) + (c.a < 0.999 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');

/** The first color set for a property by a CSS rule whose selector passes the test (linear-gradient(#a, #b) → #a). */
function cssColor(sheet: string, sel: RegExp, prop: RegExp): string | undefined {
  for (const r of sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!r[1].split(',').some((x) => sel.test(x.trim()))) continue;
    for (const m of r[2].matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      if (!prop.test(m[1])) continue;
      const c = findColors(m[2])[0];
      if (c) return toCss(c.c);
    }
  }
  return undefined;
}
const BG = /^background(-color)?$/;
const FG = /^color$/;

const unRe = (s: string) => s.replace(/\\(.)/g, '$1');

/**
 * Settings for a panel read out of a card like the battle panel: its section table (name → icon, color), how titles
 * and rows are written, the HP/MP-style meters with their thresholds, field names, stats, and its colors. Null when
 * no section table is found.
 */
export function recognizePanel(s: { findRegex: string; replaceString: string }): PanelDef | null {
  const code = s.replaceString;
  const sheet = cssText(code);
  // sections: 'name': { icon: '…', color: '#…' } (either order), one after another in a table; a card can have
  // other tables like that (icons for each craft…), so the longest one is taken
  const runs: PanelSection[][] = [];
  let sections: PanelSection[] = [];
  let prev = '';
  let end = -1;
  for (const m of code.matchAll(/(['"])([^'"\n{}]{1,24})\1\s*:\s*\{([^{}]{0,200})\}/g)) {
    const body = m[3];
    const icon = /icon\s*:\s*(['"])(.*?)\1/.exec(body)?.[2];
    const col = /colou?r\s*:\s*(['"])(.*?)\1/.exec(body)?.[2];
    if (!icon && !col) continue;
    if (end < 0 || !/^(?:\s|,|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*$/.test(code.slice(end, m.index))) {
      sections = [];
      runs.push(sections);
      prev = '';
    }
    end = m.index! + m[0].length;
    const look = `${icon}|${col}`;
    const last = sections[sections.length - 1];
    // the same icon and color right after: the same section written another way (繁体)
    if (last && look === prev) last.aliases.push(m[2].trim());
    else sections.push({ name: m[2].trim(), aliases: [], icon: iconOf(icon ?? ''), color: col && findColors(col)[0] ? toCss(findColors(col)[0].c) : '#ffd166', open: true });
    prev = look;
  }
  const size = (r: PanelSection[]) => r.reduce((n, x) => n + 1 + x.aliases.length, 0);
  sections = runs.reduce<PanelSection[]>((a, b) => (size(b) > size(a) ? b : a), []);
  if (!sections.length) return null;

  const tag = /<\\?\/?([^\s<>\\/()[\]|?*+.]+)/.exec(s.findRegex)?.[1] ?? '面板';
  const title = /【\s*\(|\\u3010|【\(/.test(code) && !/\\\{\(/.test(code) ? 'bracket' : 'brace';
  const rows = /startsWith\(\s*\w+\s*,\s*['"]\|['"]\)|charAt\(0\)\s*===?\s*['"]\|['"]|\[0\]\s*===?\s*['"]\|['"]|\^\\\|/.test(code) ? 'pipe' : 'line';

  const rules: PanelRule[] = [];
  // meters: HP\s*\[?(\d+)\/(\d+) and what % turns them to the "low" look
  const seen = new Set<string>();
  for (const m of code.matchAll(/\b([A-Z]{1,4})\\s\*\\\[\?\(\\d\+\)\\\/\(\\d\+\)/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const after = code.slice(m.index!, m.index! + 400);
    const low = Number(/>=?\s*(\d{1,3})\s*\?/.exec(after)?.[1] ?? 30);
    const cls = name.toLowerCase();
    rules.push({
      kind: 'meter',
      name,
      color: cssColor(sheet, new RegExp(`\\.tag-${cls}$`), BG) ?? '#d64545',
      low,
      lowColor: cssColor(sheet, new RegExp(`\\.tag-${cls}-low$`), BG) ?? '#e8892b',
    });
  }
  // field names: key: '(?:回合|回合數)' in a table of labels (a JS string holding a regex: unescaped twice)
  const names: string[] = [];
  for (const m of code.matchAll(/\w+\s*:\s*'\(\?:((?:[^'\\]|\\.)+)\)'/g)) for (const n of unRe(unRe(m[1])).split('|')) if (n.trim() && !names.includes(n.trim())) names.push(n.trim());
  if (names.length) {
    const tagColor = ['type', 'env', 'round', 'field'].map((c) => cssColor(sheet, new RegExp(`\\.tag-${c}$`), BG)).find(Boolean);
    rules.push({ kind: 'field', name: names.join('|'), color: tagColor ?? '#6b5fd6' });
  }
  // stats: (力)\[?(\d+)\]? … class="stat stat-str" … 力量
  for (const m of code.matchAll(/\((\S{1,4})\)\\\[\?\(\\d\+\)\\\]\?[\s\S]{0,240}?class="stat (stat-[\w-]+)"[\s\S]{0,120}?<\/i>\s*([^\s$<{'"+]{1,6})/g)) {
    rules.push({ kind: 'stat', name: m[1], label: m[3], color: cssColor(sheet, new RegExp(`\\.${m[2]}$`), FG) ?? '#ffd700' });
  }
  const dice = cssColor(sheet, /\.dice$/, FG);
  if (dice) rules.push({ kind: 'dice', name: '', color: dice });
  const arrow = cssColor(sheet, /\.arrow[\w-]*$/, FG);
  if (arrow && /->|→/.test(code)) rules.push({ kind: 'words', name: '->、→', color: arrow });
  const num = cssColor(sheet, /\.highlight-num$|\.num(ber)?$/, FG);
  if (num) rules.push({ kind: 'number', name: '', color: num });

  const theme: PanelTheme = {
    text: cssColor(sheet, /^body$/, FG) ?? DEFAULT_THEME.text,
    bg: cssColor(sheet, /panel$|card$|container$/, BG) ?? DEFAULT_THEME.bg,
    border: cssColor(sheet, /panel$|card$|container$/, /^border(-color)?$/) ?? DEFAULT_THEME.border,
    head: cssColor(sheet, /head(er)?$/, BG) ?? DEFAULT_THEME.head,
    title: cssColor(sheet, /title$/, FG) ?? DEFAULT_THEME.title,
    row: cssColor(sheet, /row$/, BG) ?? DEFAULT_THEME.row,
  };

  return cleanPanel({ v: 1, tag, title, rows, sections, rules, theme, key: newId() });
}
