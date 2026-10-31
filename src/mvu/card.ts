// Turns a card project into a SillyTavern character card (chara_card_v3) with everything MVU needs,
// and reads an existing card back into a project.
//
// The tool owns the parts it generates (fixed names below) and replaces them on every export. Everything else in an
// imported card (other world book entries, regexes, scripts, fields we don't edit) is kept as it was.
import YAML from 'yaml';
import { newId } from '../lib/id';
import { normalizeScript, toStExport } from '../lib/importer';
import { base64ToBytes, bytesToBase64, gradientPng, isPng, readPngCard, stripCardData, writePngCard } from '../lib/png';
import { CARD_PROJECT_TYPE, type CardInfo, type CardProject, type HandEntry, type Takeover, type VarNode } from './types';
import { initvarText, outputFormatText, updateRulesText, varListText } from './prompts';
import { mvuRegexes, REGEX_NAMES } from './regexes';
import { buildSchema, mvuScript, schemaScript } from './schema';
import { greetingData, initialData, overridesFrom, usedOverrides } from './vars';
import { barOf, compileBar } from './bar';
import { readTextBar, textBarOf } from './textbar';

export const ENTRY_NAMES = {
  initvar: '[initvar]变量初始值',
  varList: '变量列表',
  rules: '[mvu_update]变量更新规则',
  format: '[mvu_update]变量输出格式',
} as const;

export const SCRIPT_NAMES = { mvu: 'MVU', schema: '变量结构' } as const;

/** Where the tool keeps its own copy of the project inside the card. */
export const EMBED_KEY = 'st_beautify_studio';

const OWN_ENTRIES: string[] = Object.values(ENTRY_NAMES);
const OWN_REGEXES: string[] = Object.values(REGEX_NAMES);
const OWN_SCRIPTS: string[] = Object.values(SCRIPT_NAMES);

export function newCardProject(): CardProject {
  return {
    type: CARD_PROJECT_TYPE,
    version: 1,
    id: newId(),
    card: { name: '', description: '', personality: '', scenario: '', greetings: [''], creator: '', creatorNotes: '', version: '', tags: [] },
    vars: [],
    settings: { allowPlayerEdit: false, embedProject: true },
  };
}

/** Same seed, same UUID: generated regexes and scripts keep their ids between exports. */
export function stableId(seed: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193,
    h3 = 0x9e3779b9,
    h4 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h3 = Math.imul(h3 ^ c, 0x27d4eb2d);
    h4 = Math.imul(h4 ^ c, 0x165667b1);
  }
  for (const k of [h1, h2, h3, h4]) h1 = Math.imul(h1 ^ (k >>> 15), 0x2c1b3c6d) ^ k;
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/* ---------- world book entries in the character_book format ST writes into cards ---------- */

interface EntryOpts {
  enabled?: boolean;
  constant?: boolean;
  order: number;
  /** ST world info position: 0 before char, 1 after char, 4 at depth */
  position: number;
  depth?: number;
}

function bookEntry(id: number, comment: string, content: string, o: EntryOpts) {
  return {
    id,
    keys: [],
    secondary_keys: [],
    comment,
    content,
    constant: o.constant ?? true,
    selective: true,
    insertion_order: o.order,
    enabled: o.enabled ?? true,
    position: o.position === 0 ? 'before_char' : 'after_char',
    use_regex: true,
    extensions: {
      position: o.position,
      exclude_recursion: true,
      display_index: id,
      probability: 100,
      useProbability: true,
      depth: o.depth ?? 4,
      selectiveLogic: 0,
      group: '',
      group_override: false,
      group_weight: 100,
      prevent_recursion: true,
      delay_until_recursion: false,
      scan_depth: null,
      match_whole_words: null,
      use_group_scoring: false,
      case_sensitive: null,
      automation_id: '',
      role: 0,
      vectorized: false,
      sticky: 0,
      cooldown: 0,
      delay: 0,
      match_persona_description: false,
      match_character_description: false,
      match_character_personality: false,
      match_character_depth_prompt: false,
      match_scenario: false,
      match_creator_notes: false,
      triggers: [],
      ignore_budget: false,
    },
  };
}

/** What the entries the author may rewrite would say if left alone. */
export const AUTO_TEXT: Record<HandEntry, (vars: VarNode[]) => string> = { rules: updateRulesText, format: outputFormatText };

/** Text of an entry the author may rewrite: theirs when they did, otherwise the generated one. */
export const entryText = (p: Pick<CardProject, 'vars' | 'custom'>, k: HandEntry) => p.custom?.[k]?.text ?? AUTO_TEXT[k](p.vars);

/** Rewritten by hand, but the variables changed since, so the generated text would now say something else. */
export const handStale = (p: Pick<CardProject, 'vars' | 'custom'>, k: HandEntry) => {
  const h = p.custom?.[k];
  return !!h && h.from !== AUTO_TEXT[k](p.vars);
};

function ownEntries(p: Pick<CardProject, 'vars' | 'custom'>, firstId: number) {
  return [
    // MVU reads every entry with [initvar] in its name for the starting values, even when the entry is off
    bookEntry(firstId, ENTRY_NAMES.initvar, initvarText(p.vars), { enabled: false, constant: false, order: 0, position: 1 }),
    bookEntry(firstId + 1, ENTRY_NAMES.varList, varListText(), { order: 100, position: 4, depth: 0 }),
    bookEntry(firstId + 2, ENTRY_NAMES.rules, entryText(p, 'rules'), { order: 101, position: 4, depth: 0 }),
    bookEntry(firstId + 3, ENTRY_NAMES.format, entryText(p, 'format'), { order: 102, position: 4, depth: 0 }),
  ];
}

/* ---------- TavernHelper scripts ---------- */

function helperScript(id: string, name: string, content: string, info: string) {
  return { type: 'script', enabled: true, name, id, content, info, button: { enabled: true, buttons: [] }, data: {} };
}

/** The card's TavernHelper data as { scripts, variables }; older cards stored it as [key, value] pairs. */
function readHelper(ext: any): { scripts: any[]; variables: Record<string, unknown> } {
  let th = ext?.tavern_helper;
  if (Array.isArray(th)) th = Object.fromEntries(th.filter((p: unknown) => Array.isArray(p) && p.length === 2));
  return { ...(th ?? {}), scripts: Array.isArray(th?.scripts) ? th.scripts : [], variables: th?.variables ?? {} };
}

/** Drops scripts (also inside folders) for which `drop` is true. */
function filterScripts(list: any[], drop: (s: any) => boolean): any[] {
  return list
    .filter((s) => s?.type === 'folder' || !drop(s))
    .map((s) => (s?.type === 'folder' && Array.isArray(s.scripts) ? { ...s, scripts: filterScripts(s.scripts, drop) } : s));
}

function eachScript(list: any[], fn: (s: any) => void) {
  for (const s of list) {
    if (s?.type === 'folder' && Array.isArray(s.scripts)) eachScript(s.scripts, fn);
    else if (s) fn(s);
  }
}

/* ---------- a greeting's own starting values ---------- */

/** An <initvar> block in a greeting, as MVU reads it (the YAML may sit in a ``` block). */
const INITVAR_BLOCK = /<initvar>(?:\s*```.*)?([\s\S]*?)(?:```\s*)?<\/initvar>/gi;

/** Greeting text as exported: with an <initvar> block when it has its own starting values. */
export function greetingText(text: string, vars: VarNode[], byId: Record<string, unknown> | undefined): string {
  const used = usedOverrides(vars, byId);
  if (!Object.keys(used).length) return text;
  return `${text.trimEnd()}\n\n<initvar>\n${YAML.stringify(greetingData(vars, used), { lineWidth: 0 }).trimEnd()}\n</initvar>`;
}

/** The text of a greeting without its <initvar> blocks, and what those blocks hold. */
export function splitGreeting(text: string): { text: string; blocks: string[] } {
  const blocks = [...text.matchAll(INITVAR_BLOCK)].map((m) => m[1]);
  if (!blocks.length) return { text, blocks };
  return { text: text.replace(INITVAR_BLOCK, '').trim(), blocks };
}

/** Problems with the <initvar> blocks written by hand into greetings (MVU skips the ones it can't read). */
export function greetingBlockProblems(greetings: string[]): string[] {
  const out: string[] = [];
  greetings.forEach((g, i) => {
    for (const b of splitGreeting(g).blocks) {
      try {
        const parsed = YAML.parse(b);
        if (!isPlainObject(parsed)) out.push(`${greetingName(i)}：<initvar> 里不是变量表`);
      } catch (e) {
        out.push(`${greetingName(i)}：<initvar> 读不出来（${e instanceof Error ? e.message.split('\n')[0] : e}）`);
      }
    }
  });
  return out;
}

export const greetingName = (i: number) => (i === 0 ? '第一条开场白' : `备选开场白 ${i}`);

/* ---------- export ---------- */

function skeleton(): any {
  return {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creatorcomment: '',
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: [],
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator: '',
      character_version: '',
      alternate_greetings: [],
      extensions: { talkativeness: '0.5', fav: false, world: '', depth_prompt: { prompt: '', depth: 4, role: 'system' } },
      group_only_greetings: [],
    },
    create_date: new Date().toISOString(),
  };
}

/** Stable ids for the generated parts of a project. */
const idsOf = (p: CardProject) => (slot: string) => stableId(`${p.id}:${slot}`);

/** The regexes the tool makes, in ST's export format. */
function ownRegexes(p: CardProject) {
  return mvuRegexes(compileBar(barOf(p), p.vars, { allowEdit: p.settings.allowPlayerEdit, key: p.id }), idsOf(p), textBarOf(p)?.html).map(toStExport);
}

/** The TavernHelper scripts the tool makes: MVU first, then the variable structure. */
function ownScripts(p: CardProject) {
  const ids = idsOf(p);
  return [
    helperScript(ids('script:mvu'), SCRIPT_NAMES.mvu, mvuScript(), '加载 MVU 变量框架'),
    helperScript(ids('script:schema'), SCRIPT_NAMES.schema, schemaScript(p.vars), '变量的类型、范围和自动算出的阶段，由酒馆美化工坊生成'),
  ];
}

/** A world book entry as ST keeps it in a world book file (cards keep another shape, see bookEntry). */
function worldInfoEntry(e: ReturnType<typeof bookEntry>, i: number) {
  const x = e.extensions;
  return {
    uid: i,
    key: e.keys,
    keysecondary: e.secondary_keys,
    comment: e.comment,
    content: e.content,
    constant: e.constant,
    vectorized: false,
    selective: e.selective,
    selectiveLogic: x.selectiveLogic,
    addMemo: true,
    order: e.insertion_order,
    position: x.position,
    disable: !e.enabled,
    excludeRecursion: x.exclude_recursion,
    preventRecursion: x.prevent_recursion,
    delayUntilRecursion: x.delay_until_recursion,
    probability: x.probability,
    useProbability: x.useProbability,
    depth: x.depth,
    group: x.group,
    groupOverride: x.group_override,
    groupWeight: x.group_weight,
    scanDepth: x.scan_depth,
    caseSensitive: x.case_sensitive,
    matchWholeWords: x.match_whole_words,
    useGroupScoring: x.use_group_scoring,
    automationId: x.automation_id,
    role: x.role,
    sticky: x.sticky,
    cooldown: x.cooldown,
    delay: x.delay,
    displayIndex: i,
  };
}

/**
 * Only the MVU parts, for authors adding them to a card they already have: a world book file (世界书 → 导入),
 * the regexes (正则 → 导入, as a list) and the TavernHelper scripts.
 */
export function mvuParts(p: CardProject) {
  const entries = ownEntries(p, 0).map(worldInfoEntry);
  return {
    book: { entries: Object.fromEntries(entries.map((e) => [String(e.uid), e])) },
    regexes: ownRegexes(p),
    scripts: ownScripts(p),
  };
}

/** The finished card JSON. */
export function buildCard(p: CardProject): any {
  const card = p.base ? structuredClone(p.base) : skeleton();
  card.spec = 'chara_card_v3';
  card.spec_version = '3.0';
  const d = (card.data ??= {});
  const c = p.card;
  const [first = '', ...alternates] = c.greetings.map((g, i) => greetingText(g, p.vars, c.greetingVars?.[i]));
  Object.assign(card, { name: c.name, description: c.description, personality: c.personality, scenario: c.scenario, first_mes: first, creatorcomment: c.creatorNotes, tags: c.tags });
  Object.assign(d, {
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: first,
    alternate_greetings: alternates,
    creator_notes: c.creatorNotes,
    creator: c.creator,
    character_version: c.version,
    tags: c.tags,
  });
  const ext = (d.extensions ??= {});
  const take: Takeover = p.takeover ?? { entries: [], regexes: [], scripts: [] };

  // world book: keep the others, put ours after them
  const book = (d.character_book ??= { name: c.name, entries: [] });
  book.name ||= c.name;
  const kept = (Array.isArray(book.entries) ? book.entries : []).filter((e: any) => !OWN_ENTRIES.includes(e?.comment) && !take.entries.includes(e?.id));
  const nextId = kept.reduce((m: number, e: any) => Math.max(m, Number(e?.id) || 0), -1) + 1;
  book.entries = [...kept, ...ownEntries(p, nextId)];
  ext.world ||= book.name;

  // regexes
  const regexes = (Array.isArray(ext.regex_scripts) ? ext.regex_scripts : []).filter((r: any) => !OWN_REGEXES.includes(r?.scriptName) && !take.regexes.includes(r?.id));
  ext.regex_scripts = [...regexes, ...ownRegexes(p)];

  // TavernHelper scripts: MVU first, then the variable structure, then the card's own scripts
  const helper = readHelper(ext);
  const others = filterScripts(helper.scripts, (s) => OWN_SCRIPTS.includes(s.name) || take.scripts.includes(s.id));
  ext.tavern_helper = { ...helper, scripts: [...ownScripts(p), ...others] };

  if (p.settings.embedProject) ext[EMBED_KEY] = { type: CARD_PROJECT_TYPE, version: p.version, id: p.id, vars: p.vars, settings: p.settings, ...(p.bar ? { bar: p.bar } : {}), ...(p.custom ? { custom: p.custom } : {}), ...(p.textBar ? { textBar: p.textBar } : {}) };
  else delete ext[EMBED_KEY];
  return card;
}

/** Card PNG: the project's avatar (or a plain one) with the card data written in. */
export async function buildCardPng(p: CardProject): Promise<Uint8Array> {
  const avatar = p.avatar ? base64ToBytes(p.avatar) : await gradientPng(400, 600, [74, 58, 120], [30, 42, 64]);
  return writePngCard(avatar, buildCard(p));
}

/* ---------- import ---------- */

/** Hand-written entries kept in a card or project file; anything that isn't a pair of texts is dropped. */
export function readCustom(x: any): CardProject['custom'] {
  if (!isPlainObject(x)) return undefined;
  const out: CardProject['custom'] = {};
  for (const k of Object.keys(AUTO_TEXT) as HandEntry[]) {
    const h = x[k];
    if (isPlainObject(h) && typeof h.text === 'string' && typeof h.from === 'string') out[k] = { text: h.text, from: h.from };
  }
  return Object.keys(out).length ? out : undefined;
}

export interface CardImport {
  project: CardProject;
  /** what was found and what will happen to it, in plain words */
  notes: string[];
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const isScalar = (x: unknown) => x === null || ['string', 'number', 'boolean'].includes(typeof x);

/** Rows of a table: two or more objects with the same keys, holding plain values or lists. */
function looksLikeTable(o: Record<string, unknown>): boolean {
  const rows = Object.values(o);
  if (rows.length < 2 || !rows.every(isPlainObject)) return false;
  const shape = (r: Record<string, unknown>) => Object.keys(r).sort().join('\n');
  const first = shape(rows[0] as Record<string, unknown>);
  return rows.every((r) => shape(r as Record<string, unknown>) === first && Object.values(r as object).every((x) => isScalar(x) || (Array.isArray(x) && x.every(isScalar))));
}

function inferNode(key: string, value: unknown, where: string, notes: string[]): VarNode | null {
  const at = where ? `${where}.${key}` : key;
  if (key.startsWith('$')) {
    notes.push(`${at}：名字以 $ 开头，是自动算出的值，没有导入（需要的话在工坊里给数字设置「阶段」）`);
    return null;
  }
  const readonly = key.startsWith('_');
  const node: VarNode = { id: newId(), name: readonly ? key.slice(1) : key, kind: 'text', rules: [] };
  if (readonly) node.readonly = true;
  if (typeof value === 'number') Object.assign(node, { kind: 'number', init: value, integer: Number.isInteger(value) || undefined });
  else if (typeof value === 'string') node.init = value;
  else if (typeof value === 'boolean') Object.assign(node, { kind: 'bool', init: value });
  else if (Array.isArray(value)) {
    node.kind = 'list';
    node.init = value.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    if (value.some((x) => typeof x !== 'string')) notes.push(`${at}：列表里有不是文字的内容，已转成文字`);
  } else if (isPlainObject(value)) {
    if (!Object.keys(value).length) {
      Object.assign(node, { kind: 'table', init: {}, children: [] });
      notes.push(`${at}：是空的，已当作「表格」导入，请给它加上字段（比如物品栏的「数量」）`);
    } else if (looksLikeTable(value)) {
      const firstRow = Object.values(value)[0] as Record<string, unknown>;
      const fields = Object.entries(firstRow)
        .map(([k, v]) => inferNode(k, v, `${at}.(每一行)`, notes))
        .filter((f): f is VarNode => !!f)
        .map((f) => ({ ...f, init: undefined }));
      Object.assign(node, { kind: 'table', init: value, children: fields });
    } else {
      Object.assign(node, { kind: 'group', children: inferVars(value, at, notes) });
      if (Object.values(value).length === 1 && isPlainObject(Object.values(value)[0]))
        notes.push(`${at}：已当作「分组」导入；如果这里可以随剧情增加新的一项（比如物品栏、人物表），请改成「表格」`);
    }
  } else {
    notes.push(`${at}：没有值，已当作空文字导入`);
    node.init = '';
  }
  return node;
}

/** A variable tree guessed from starting data (an [initvar] entry). */
export function inferVars(data: Record<string, unknown>, where = '', notes: string[] = []): VarNode[] {
  return Object.entries(data)
    .map(([k, v]) => inferNode(k, v, where, notes))
    .filter((n): n is VarNode => !!n);
}

function deepMerge(a: any, b: any): any {
  if (!isPlainObject(a) || !isPlainObject(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out;
}

const str = (x: unknown) => (typeof x === 'string' ? x : '');

const isInitvar = (e: any) => String(e?.comment ?? '').toLowerCase().includes('[initvar]');

/** The YAML inside an [initvar] entry, without the <initvar> or ``` wrapper MVU also accepts. */
function initvarBody(content: string): string {
  let t = content.trim();
  t = /.*<initvar>.*\n([\s\S]*)\n.*<\/initvar>.*/m.exec(t)?.[1] ?? t;
  t = /```.*\n([\s\S]*)\n```/m.exec(t.trim())?.[1] ?? t;
  return t;
}

export interface MvuPart {
  kind: 'entry' | 'regex' | 'script';
  id: number | string;
  name: string;
  /** extra note shown next to it */
  why?: string;
}

export const PART_LABEL: Record<MvuPart['kind'], string> = { entry: '世界书', regex: '正则', script: '酒馆助手脚本' };

/** MVU parts in a card made elsewhere (not the ones this tool generates): starting values, rules, regexes, scripts. */
export function detectMvuParts(json: any): MvuPart[] {
  const d = json?.data && typeof json.data === 'object' ? json.data : json ?? {};
  const ext = d.extensions ?? {};
  const out: MvuPart[] = [];
  for (const e of Array.isArray(d.character_book?.entries) ? d.character_book.entries : []) {
    const comment = String(e?.comment ?? '');
    if (OWN_ENTRIES.includes(comment)) continue;
    if (isInitvar(e) || comment.includes('[mvu_update]') || String(e?.content ?? '').includes('format_message_variable::stat_data'))
      out.push({ kind: 'entry', id: e.id, name: comment || String(e.id) });
  }
  for (const r of Array.isArray(ext.regex_scripts) ? ext.regex_scripts : []) {
    if (OWN_REGEXES.includes(r?.scriptName)) continue;
    if (/UpdateVariable|StatusPlaceHolderImpl/.test(String(r?.findRegex ?? ''))) out.push({ kind: 'regex', id: r.id, name: normalizeScript(r).scriptName });
  }
  eachScript(readHelper(ext).scripts, (s) => {
    if (OWN_SCRIPTS.includes(s.name)) return;
    const content = String(s.content ?? '');
    if (/MagVarUpdate|registerMvuSchema/.test(content))
      out.push({ kind: 'script', id: s.id, name: String(s.name ?? s.id), why: content.includes('registerMvuSchema') ? '原来的变量结构里如果有自定义计算，需要在工坊里重新设置' : undefined });
  });
  return out;
}

/** Reads a card (JSON object) into a project. */
export function importCard(json: any, avatarPng?: Uint8Array): CardImport {
  if (!json || typeof json !== 'object') throw new Error('不是角色卡');
  const d = json.data && typeof json.data === 'object' ? json.data : json;
  const ext = d.extensions ?? {};
  const notes: string[] = [];
  const p = newCardProject();
  p.card = {
    name: str(d.name || json.name),
    description: str(d.description ?? json.description),
    personality: str(d.personality ?? json.personality),
    scenario: str(d.scenario ?? json.scenario),
    greetings: [str(d.first_mes ?? json.first_mes), ...(Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(str) : [])],
    creator: str(d.creator),
    creatorNotes: str(d.creator_notes ?? json.creatorcomment),
    version: str(d.character_version),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
  } satisfies CardInfo;
  p.base = json;
  if (avatarPng) p.avatar = bytesToBase64(stripCardData(avatarPng));

  const take: Takeover = { entries: [], regexes: [], scripts: [] };
  const entries: any[] = Array.isArray(d.character_book?.entries) ? d.character_book.entries : [];

  const embedded = ext[EMBED_KEY];
  if (embedded?.type === CARD_PROJECT_TYPE && Array.isArray(embedded.vars)) {
    p.id = String(embedded.id || p.id);
    p.vars = embedded.vars;
    p.settings = { ...p.settings, ...(embedded.settings ?? {}) };
    if (embedded.bar && typeof embedded.bar === 'object') p.bar = embedded.bar;
    const custom = readCustom(embedded.custom);
    if (custom) p.custom = custom;
    const textBar = readTextBar(embedded.textBar);
    if (textBar) p.textBar = textBar;
    notes.push('找到了工坊保存在卡里的变量设置，已完整恢复');
  } else {
    let start: Record<string, unknown> = {};
    for (const e of entries) {
      if (!isInitvar(e)) continue;
      try {
        const parsed = YAML.parse(initvarBody(String(e.content ?? '')));
        if (isPlainObject(parsed)) start = deepMerge(start, parsed);
        else notes.push(`世界书「${e.comment}」里不是变量表，已跳过`);
      } catch (err) {
        notes.push(`世界书「${e.comment}」读不出来（${err instanceof Error ? err.message : err}），已跳过`);
      }
    }
    p.vars = inferVars(start, '', notes);
    if (!p.vars.length) notes.push('没有找到 [initvar] 世界书条目，变量需要从头建立');
    else {
      notes.push(`从 [initvar] 条目读出了 ${p.vars.length} 个变量；范围、阶段和更新规则需要在工坊里补上`);
      const check = buildSchema(p.vars).safeParse(initialData(p.vars));
      if (!check.success) notes.push(`有些初始值和推测出的类型对不上，请检查：${check.error.issues[0].path.join('.')}`);
    }
  }

  readGreetingVars(p, notes);

  // MVU parts of the card that the generated ones will replace
  const parts = detectMvuParts(json);
  for (const part of parts) {
    if (part.kind === 'entry') take.entries.push(part.id as number);
    else if (part.kind === 'regex') take.regexes.push(part.id as string);
    else take.scripts.push(part.id as string);
    notes.push(`${PART_LABEL[part.kind]}「${part.name}」会换成工坊生成的${part.why ? `（${part.why}）` : ''}`);
  }
  if (Array.isArray(ext.TavernHelper_scripts)) notes.push('这张卡还带着旧版酒馆助手脚本，导出后请在酒馆里确认脚本都在');
  p.takeover = take;
  return { project: p, notes };
}

/** Moves the <initvar> blocks out of the greetings into each greeting's own starting values. */
function readGreetingVars(p: CardProject, notes: string[]) {
  const vars: (Record<string, unknown> | undefined)[] = [];
  p.card.greetings = p.card.greetings.map((g, i) => {
    const { text, blocks } = splitGreeting(g);
    if (!blocks.length) return g;
    let start: Record<string, unknown> = {};
    try {
      for (const b of blocks) {
        const parsed = YAML.parse(b);
        if (!isPlainObject(parsed)) throw new Error('不是变量表');
        start = deepMerge(start, parsed);
      }
    } catch (e) {
      notes.push(`${greetingName(i)}里的 <initvar> 读不出来（${e instanceof Error ? e.message.split('\n')[0] : e}），原样留在开场白里`);
      return g;
    }
    if (!p.vars.length) {
      p.vars = inferVars(start, '', notes);
      if (p.vars.length) notes.push(`从${greetingName(i)}的 <initvar> 读出了 ${p.vars.length} 个变量`);
    }
    const { byId, extra } = overridesFrom(p.vars, start);
    if (Object.keys(byId).length) vars[i] = byId;
    notes.push(`${greetingName(i)}有自己的初始值（${Object.keys(byId).length} 个和平时不同），已放进「这条开场白的初始值」`);
    if (extra.length) notes.push(`${greetingName(i)}的初始值里有变量表里没有的：${extra.slice(0, 5).join('、')}${extra.length > 5 ? ' 等' : ''}，导出时不会再写进去`);
    return text;
  });
  if (vars.some(Boolean)) p.card.greetingVars = p.card.greetings.map((_, i) => vars[i] ?? {});
}

/** Reads a dropped file: a card PNG or card JSON. */
export function importCardFile(name: string, bytes: Uint8Array): CardImport {
  if (isPng(bytes) || /\.png$/i.test(name)) return importCard(readPngCard(bytes), bytes);
  return importCard(JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, '')));
}
