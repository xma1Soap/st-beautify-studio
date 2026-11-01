// What the AI can do, as OpenAI "tools". Every tool works on a draft copy of the project and returns
// the changed draft; nothing reaches the real project until the user applies the draft.
import { parseRegex, processText } from '../lib/engine';
import { newScript } from '../lib/defaults';
import type { RegexScript, Settings } from '../lib/types';
import type { ToolDef } from './client';
import { lintReplace } from './lint';

export interface ToolOut<P> {
  /** the draft after this call (missing = unchanged) */
  p?: P;
  /** what the AI gets back */
  result: unknown;
  /** short words for the chat, e.g. 改了正则「状态栏」的替换内容 */
  label: string;
}

export interface Tool<P> {
  def: ToolDef;
  run: (p: P, args: any) => ToolOut<P>;
}

/** A tool's error, said to the AI (it usually fixes the call and tries again). */
export class ToolError extends Error {}

export function tool<P>(name: string, description: string, properties: Record<string, object>, required: string[], run: Tool<P>['run']): Tool<P> {
  return { def: { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }, run };
}

export const str = (description: string) => ({ type: 'string', description });
export const num = (description: string) => ({ type: 'number', description });
export const bool = (description: string) => ({ type: 'boolean', description });
export const obj = (description: string) => ({ type: 'object', description, additionalProperties: true });

/** At most this much text goes back to the AI from one call. */
export const RESULT_MAX = 16000;

export function resultText(r: unknown): string {
  const s = typeof r === 'string' ? r : JSON.stringify(r, null, 1);
  return s.length > RESULT_MAX ? s.slice(0, RESULT_MAX) + `\n…（太长，后面 ${s.length - RESULT_MAX} 个字省略了）` : s;
}

/** Replace one exact piece of text (or all of them). */
export function replaceText(text: string, oldText: string, newText: string, all: boolean): { text: string; n: number } {
  if (!oldText) throw new ToolError('old_text 不能是空的');
  const n = text.split(oldText).length - 1;
  if (!n) {
    const loose = text.replace(/\s+/g, ' ').includes(oldText.replace(/\s+/g, ' '));
    throw new ToolError('没找到 old_text。' + (loose ? '空格或换行和原文不一样，先读出原文再照抄。' : '先读出原文，照原样复制要改的那段。'));
  }
  if (n > 1 && !all) throw new ToolError(`old_text 出现了 ${n} 次。多带一点前后文让它只出现一次，或者设 replace_all: true`);
  return { text: all ? text.split(oldText).join(newText) : text.replace(oldText, () => newText), n: all ? n : 1 };
}

/** Snippets around each place `needle` appears. */
export function around(text: string, needle: string, width = 300, max = 10) {
  const out: { at: number; text: string }[] = [];
  let i = text.indexOf(needle);
  while (i >= 0 && out.length < max) {
    out.push({ at: i, text: text.slice(Math.max(0, i - width), i + needle.length + width) });
    i = text.indexOf(needle, i + needle.length);
  }
  return out;
}

/* ---------- regexes: the regex project's list, or the regexes inside an imported card ---------- */

export interface RegexHost<P> {
  list: (p: P) => RegexScript[];
  save: (p: P, list: RegexScript[]) => P;
  /** settings and text to count hits with (missing = no hit counts) */
  test?: (p: P) => { settings: Settings; text: string };
  /** extra facts per regex in the list */
  extra?: (p: P, s: RegexScript) => Record<string, unknown>;
}

const PLACEMENT = { type: 'array', items: { type: 'number' }, description: '作用范围：1 用户输入，2 AI 输出，3 快捷命令，5 世界书，6 推理' };
const FIELDS = {
  scriptName: str('名称'),
  findRegex: str('查找正则，写成 /…/flags'),
  replaceString: str('替换内容（整段换掉；只改一小处请用按原文替换的工具）'),
  trimStrings: { type: 'array', items: { type: 'string' }, description: '从捕获内容里删掉的文字' },
  placement: PLACEMENT,
  disabled: bool('禁用'),
  markdownOnly: bool('仅格式显示（美化一般要开）'),
  promptOnly: bool('仅格式提示词'),
  runOnEdit: bool('编辑消息时运行'),
  substituteRegex: num('正则里的宏：0 不替换，1 原样替换，2 转义后替换'),
  minDepth: { type: ['number', 'null'], description: '最小楼层深度，null 不限' },
  maxDepth: { type: ['number', 'null'], description: '最大楼层深度，null 不限' },
};

/** Takes the regex fields the AI sent, checked. */
function regexPatch(a: any): Partial<RegexScript> {
  const out: Partial<RegexScript> = {};
  for (const k of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    if (!(k in a)) continue;
    const v = a[k];
    if (k === 'placement') {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) throw new ToolError('placement 要是数字列表');
      out.placement = [...new Set(v as number[])].sort();
    } else if (k === 'trimStrings') {
      if (!Array.isArray(v)) throw new ToolError('trimStrings 要是文字列表');
      out.trimStrings = v.map(String);
    } else if (k === 'minDepth' || k === 'maxDepth') out[k] = v === null || v === '' ? null : Number(v);
    else if (k === 'substituteRegex') out.substituteRegex = Number(v) || 0;
    else if ((FIELDS as any)[k].type === 'boolean') (out as any)[k] = !!v;
    else (out as any)[k] = String(v ?? '');
  }
  if (out.findRegex !== undefined) {
    const { err } = parseRegex(out.findRegex);
    if (err) throw new ToolError('查找正则有错：' + err);
  }
  return out;
}

export function regexTools<P>(h: RegexHost<P>, names: { list: string; read: string; update: string; edit: string; add: string; remove: string; move: string }, what: string): Tool<P>[] {
  const get = (p: P, id: string) => {
    const s = h.list(p).find((x) => x.id === id);
    if (!s) throw new ToolError(`没有 id 为 ${id} 的正则，先用 ${names.list} 看看有哪些`);
    return s;
  };
  const hitsOf = (p: P, list: RegexScript[]) => {
    if (!h.test) return null;
    const t = h.test(p);
    return t.text.trim() ? processText(list, t.text, t.settings).stats : {};
  };
  const set = (p: P, id: string, patch: Partial<RegexScript>) => h.save(p, h.list(p).map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const after = (p: P, id: string) => {
    const s = get(p, id);
    const stats = hitsOf(p, h.list(p));
    const warn = lintReplace(s.replaceString);
    return { ok: true, ...(stats ? { hits: stats[s.id]?.hits ?? 0, ...(stats[s.id]?.err ? { error: stats[s.id].err } : {}) } : {}), ...(warn.length ? { warnings: warn } : {}) };
  };

  return [
    tool<P>(names.list, `列出${what}：id、名称、查找正则、开关、替换内容长度${h.test ? '、在测试消息里命中几处' : ''}`, {}, [], (p) => {
      const list = h.list(p);
      const stats = hitsOf(p, list);
      return {
        label: `看了${what}`,
        result: list.length
          ? list.map((s, i) => ({
              index: i,
              id: s.id,
              name: s.scriptName,
              find: s.findRegex.length > 240 ? s.findRegex.slice(0, 240) + '…' : s.findRegex,
              disabled: s.disabled,
              markdownOnly: s.markdownOnly,
              promptOnly: s.promptOnly,
              placement: s.placement,
              replace_chars: s.replaceString.length,
              frontend_card: /```html/i.test(s.replaceString),
              ...(stats ? { hits: stats[s.id]?.hits ?? 0 } : {}),
              ...(h.extra?.(p, s) ?? {}),
            }))
          : `还没有${what}`,
      };
    }),
    tool<P>(
      names.read,
      '读一条正则的全部设置和替换内容。替换内容很长时分段读：start 是从第几个字开始；也可以给 find，只看这段文字出现的地方和前后文',
      { id: str('正则 id'), start: num('从替换内容的第几个字开始读（默认 0）'), find: str('只看替换内容里这段文字出现的地方') },
      ['id'],
      (p, a) => {
        const s = get(p, a.id);
        const { replaceString, ...rest } = s;
        const total = replaceString.length;
        let replace: unknown;
        if (a.find) replace = { total_chars: total, matches: around(replaceString, String(a.find)) };
        else {
          const from = Math.max(0, Math.min(Number(a.start) || 0, total));
          const to = Math.min(total, from + 12000);
          replace = { total_chars: total, from, to, text: replaceString.slice(from, to), ...(to < total ? { more: `还有 ${total - to} 个字，用 start: ${to} 接着读` } : {}) };
        }
        return { label: `读了正则「${s.scriptName}」`, result: { ...rest, replace, warnings: lintReplace(replaceString) } };
      },
    ),
    tool<P>(names.update, '改一条正则的设置或整段替换内容（只给要改的字段）', { id: str('正则 id'), ...FIELDS }, ['id'], (p, a) => {
      const s = get(p, a.id);
      const patch = regexPatch(a);
      if (!Object.keys(patch).length) throw new ToolError('没有给要改的字段');
      const next = set(p, s.id, patch);
      const names_ = { scriptName: '名称', findRegex: '查找正则', replaceString: '替换内容', placement: '作用范围', markdownOnly: '仅格式显示', promptOnly: '仅格式提示词', disabled: '开关' } as Record<string, string>;
      return { p: next, label: `改了正则「${s.scriptName}」的${Object.keys(patch).map((k) => names_[k] ?? '设置').filter((x, i, l) => l.indexOf(x) === i).join('、')}`, result: after(next, s.id) };
    }),
    tool<P>(
      names.edit,
      '按原文替换：把替换内容（或查找正则）里的一段原文换成新的。old_text 要和原文一字不差，而且只出现一次（或设 replace_all）',
      { id: str('正则 id'), old_text: str('原文，一字不差'), new_text: str('换成什么'), replace_all: bool('出现多次时全部替换'), field: { type: 'string', enum: ['replaceString', 'findRegex'], description: '改哪一项，默认替换内容' } },
      ['id', 'old_text', 'new_text'],
      (p, a) => {
        const s = get(p, a.id);
        const field: 'replaceString' | 'findRegex' = a.field === 'findRegex' ? 'findRegex' : 'replaceString';
        const r = replaceText(s[field], String(a.old_text ?? ''), String(a.new_text ?? ''), !!a.replace_all);
        if (field === 'findRegex') {
          const { err } = parseRegex(r.text);
          if (err) throw new ToolError('改完的查找正则有错：' + err);
        }
        const next = set(p, s.id, { [field]: r.text });
        return { p: next, label: `改了正则「${s.scriptName}」的${field === 'findRegex' ? '查找正则' : '替换内容'}`, result: { ...after(next, s.id), replaced: r.n } };
      },
    ),
    tool<P>(
      names.add,
      '新建一条正则（默认：仅格式显示、作用于 AI 输出），返回它的 id',
      { ...FIELDS, scriptName: str('名称'), findRegex: str('查找正则，写成 /…/flags'), replaceString: str('替换内容'), after_id: str('放在这条正则后面（默认放最后）') },
      ['scriptName', 'findRegex', 'replaceString'],
      (p, a) => {
        const s: RegexScript = { ...newScript(String(a.scriptName || '新美化')), markdownOnly: true, placement: [2], ...regexPatch(a) };
        const list = h.list(p);
        const at = a.after_id ? list.findIndex((x) => x.id === a.after_id) : -1;
        const next = h.save(p, at < 0 ? [...list, s] : [...list.slice(0, at + 1), s, ...list.slice(at + 1)]);
        return { p: next, label: `新建了正则「${s.scriptName}」`, result: { id: s.id, ...after(next, s.id) } };
      },
    ),
    tool<P>(names.remove, '删掉一条正则', { id: str('正则 id') }, ['id'], (p, a) => {
      const s = get(p, a.id);
      return { p: h.save(p, h.list(p).filter((x) => x.id !== s.id)), label: `删了正则「${s.scriptName}」`, result: { ok: true } };
    }),
    tool<P>(names.move, '调整正则的顺序（它们从上到下依次执行）', { id: str('正则 id'), to_index: num('移到第几个（从 0 数）') }, ['id', 'to_index'], (p, a) => {
      const s = get(p, a.id);
      const list = h.list(p).filter((x) => x.id !== s.id);
      const i = Math.max(0, Math.min(list.length, Math.round(Number(a.to_index) || 0)));
      list.splice(i, 0, s);
      return { p: h.save(p, list), label: `调整了正则「${s.scriptName}」的顺序`, result: { ok: true, order: list.map((x) => x.scriptName) } };
    }),
  ];
}
