// The conversation with the assistant: sends the chat, runs the tools the AI calls on a draft,
// and keeps going until the AI answers without calling tools. The draft waits for the user to apply it.
import { create } from 'zustand';
import { ask } from '../components/dialog';
import { useLevel } from '../mode';
import { useStore } from '../store';
import { chat, type ChatMsg, type Reply } from './client';
import { cardMode } from './cardMode';
import type { AiMode, Change } from './mode';
import { fillMacros } from './preset';
import { regexMode } from './regexMode';
import { aiSettings, configured, type AiSettings } from './settings';
import { BUILTIN_SKILL } from './skill';
import { resultText } from './tools';

export type ModeId = 'regex' | 'mvu';
export const MODES: Record<ModeId, AiMode<any>> = { regex: regexMode, mvu: cardMode };

/** How a tool call went, for the chat. */
export interface CallNote {
  label: string;
  ok: boolean;
  error?: string;
}

/** Things that happened outside the conversation (applied, discarded…), shown after message `at`. */
export interface ChatEvent {
  at: number;
  text: string;
}

export interface Chat {
  /** the conversation as sent to the endpoint (without the system part, which is rebuilt every time) */
  msgs: ChatMsg[];
  notes: Record<string, CallNote>;
  events: ChatEvent[];
  /** what the AI changed and the user hasn't applied yet */
  draft: { base: unknown; next: unknown } | null;
  /** the project right after the last apply, to take it back */
  applied: unknown | null;
  /** said to the AI with the next message (e.g. the user threw the draft away) */
  pending: string[];
  running: boolean;
  /** the reply coming in */
  live: Reply | null;
  error: string | null;
}

const empty = (): Chat => ({ msgs: [], notes: {}, events: [], draft: null, applied: null, pending: [], running: false, live: null, error: null });

interface Store {
  chats: Record<ModeId, Chat>;
}

export const useAiChat = create<Store>(() => ({ chats: { regex: empty(), mvu: empty() } }));

const get = (m: ModeId) => useAiChat.getState().chats[m];
const put = (m: ModeId, patch: Partial<Chat> | ((c: Chat) => Partial<Chat>)) =>
  useAiChat.setState((s) => {
    const c = s.chats[m];
    return { chats: { ...s.chats, [m]: { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } } };
  });
const event = (m: ModeId, text: string) => put(m, (c) => ({ events: [...c.events, { at: c.msgs.length, text }] }));

/** The draft's changes, or none when there is no draft. */
export function draftChanges(m: ModeId): Change[] {
  const d = get(m).draft;
  return d ? MODES[m].changes(d.base, d.next) : [];
}

/* ---------- the request ---------- */

const ROUNDS = 24;

const INTRO = `你是「酒馆美化工坊」里的 AI 助手，帮用户做 SillyTavern（酒馆）的美化：正则美化、MVU 角色卡和它的状态栏。你用工具读取和修改用户的工程。
- 工具改的是一份草稿。你回复完以后，用户会看到改动的前后对比，点「应用」才生效，应用后也能撤回。所以需求清楚时直接动手，不用先征求同意；需求不清楚时先问。
- 先想清楚要做什么再调用工具，能一起调用的就一次调用多个。
- 改完调用 check，看到问题就修好。
- 用简体中文回复，简短说明改了什么、去哪里看效果。`;

const LEVEL = {
  simple: '用户在「简易」模式，多半不懂代码：别贴代码，用平常话说明。',
  advanced: '用户在「进阶」模式，懂一些代码：可以提到具体的属性和写法。',
};

/** Old tool results are cut short so long conversations stay small; calls that never ran (stopped) get an answer, which endpoints require. */
function trimHistory(msgs: ChatMsg[]): ChatMsg[] {
  const keep = msgs.length - 24;
  const out: ChatMsg[] = [];
  msgs.forEach((x, i) => {
    out.push(i < keep && x.role === 'tool' && (x.content?.length ?? 0) > 1500 ? { ...x, content: x.content!.slice(0, 1500) + '\n…（较早的工具结果，后面省略了）' } : x);
    if (x.role !== 'assistant' || !x.tool_calls?.length) return;
    const answered = new Set<string>();
    for (let j = i + 1; j < msgs.length && msgs[j].role === 'tool'; j++) answered.add(msgs[j].tool_call_id!);
    for (const tc of x.tool_calls) if (!answered.has(tc.id)) out.push({ role: 'tool', tool_call_id: tc.id, content: '（没有执行：用户停止了）' });
  });
  return out;
}

function buildMessages(mode: AiMode<any>, p: unknown, msgs: ChatMsg[], s: AiSettings, drafting: boolean): ChatMsg[] {
  const m = mode.macros();
  const preset = s.presetOn ? s.preset : null;
  const own = [
    INTRO,
    LEVEL[useLevel.getState().level],
    mode.intro,
    s.builtin ? BUILTIN_SKILL : '',
    ...s.skills.filter((k) => k.on && k.text.trim()).map((k) => `# ${k.name}\n${k.text}`),
    `# 现在的状态${drafting ? '（包含你改过、用户还没应用的草稿）' : ''}\n${mode.context(p)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const head: ChatMsg[] = [...(preset?.before ?? []).map((x) => ({ role: x.role, content: fillMacros(x.content, m) })), { role: 'system', content: own }];
  // one system message at the start: some endpoints only take one
  const sys: string[] = [];
  while (head.length && head[0].role === 'system') sys.push(head.shift()!.content!);
  return [
    { role: 'system', content: sys.join('\n\n') },
    ...head,
    ...trimHistory(msgs),
    ...(preset?.after ?? []).map((x) => ({ role: x.role, content: fillMacros(x.content, m) })),
  ];
}

let ctrl: AbortController | null = null;

export function stop() {
  ctrl?.abort();
}

export async function send(m: ModeId, text: string) {
  const c = get(m);
  if (c.running || !text.trim()) return;
  if (!configured(aiSettings())) {
    put(m, { error: '先在设置里填接口地址和模型' });
    return;
  }
  const note = c.pending.length ? `（${c.pending.join('；')}）\n` : '';
  put(m, (c) => ({ msgs: [...c.msgs, { role: 'user', content: note + text.trim() }], pending: [] }));
  await run(m);
}

/** Try again after an error (the conversation is kept as it was). */
export function retry(m: ModeId) {
  const c = get(m);
  const last = c.msgs[c.msgs.length - 1];
  if (c.running || !last || (last.role === 'assistant' && !last.tool_calls?.length)) return;
  return run(m);
}

async function run(m: ModeId) {
  const mode = MODES[m];
  const s = aiSettings();
  const c = get(m);
  put(m, { running: true, error: null, live: null });

  // keep working on the draft if there is one
  let base = c.draft?.base ?? mode.current();
  let p = c.draft?.next ?? base;
  if (c.draft && !mode.same(c.draft.base, mode.current())) {
    // the user changed the project meanwhile: start over from what is in the editor now
    base = mode.current();
    p = base;
    put(m, { draft: null });
    event(m, '你在 AI 改完后又改过工程，之前没应用的草稿作废，这次从现在的工程开始');
  }
  ctrl = new AbortController();
  const signal = ctrl.signal;
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const messages = buildMessages(mode, p, get(m).msgs, s, p !== base);
      const reply = await chat(s, messages, mode.tools.map((t) => t.def), signal, (r) => put(m, { live: { ...r, toolCalls: [...r.toolCalls] } }));
      const msg: ChatMsg = {
        role: 'assistant',
        content: reply.content || null,
        ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}),
        ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
      };
      put(m, (c) => ({ msgs: [...c.msgs, msg], live: null }));
      if (!reply.toolCalls.length) {
        if (!reply.content.trim()) event(m, reply.finish === 'length' ? '回复太长被截断了（模型的输出长度上限）' : 'AI 没有说话就结束了');
        break;
      }
      for (const tc of reply.toolCalls) {
        if (signal.aborted) throw new DOMException('已停止', 'AbortError');
        const t = mode.tools.find((x) => x.def.function.name === tc.function.name);
        let content: string;
        let cn: CallNote;
        if (!t) {
          content = `没有叫 ${tc.function.name} 的工具`;
          cn = { label: `想用不存在的工具 ${tc.function.name}`, ok: false };
        } else {
          try {
            const args = tc.function.arguments.trim() ? JSON.parse(tc.function.arguments) : {};
            const out = t.run(p, args);
            if (out.p && out.p !== p) {
              p = out.p;
              put(m, { draft: { base, next: p } });
            }
            content = resultText(out.result);
            cn = { label: out.label, ok: true };
          } catch (e) {
            const why = e instanceof SyntaxError ? '参数不是合法的 JSON：' + e.message : (e as Error).message;
            content = '出错了：' + why;
            cn = { label: `${tc.function.name} 没成功`, ok: false, error: why };
          }
        }
        put(m, (c) => ({ msgs: [...c.msgs, { role: 'tool', tool_call_id: tc.id, content }], notes: { ...c.notes, [tc.id]: cn } }));
      }
      if (round === ROUNDS - 1) event(m, `连续调用了 ${ROUNDS} 轮工具，先停在这里。可以说「继续」让它接着做`);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') event(m, '已停止');
    else put(m, { error: (e as Error).message });
  } finally {
    ctrl = null;
    // nothing actually changed: no draft to review
    const d = get(m).draft;
    put(m, { running: false, live: null, ...(d && !mode.changes(d.base, d.next).length ? { draft: null } : {}) });
  }
}

/* ---------- the draft ---------- */

export async function applyDraft(m: ModeId) {
  const mode = MODES[m];
  const d = get(m).draft;
  if (!d) return;
  if (!mode.same(mode.current(), d.base) && !(await ask('AI 改完以后你又动过工程，应用会盖掉你这期间的修改。还要应用吗？', { ok: '应用', danger: true }))) return;
  mode.apply(d.next);
  put(m, { draft: null, applied: mode.current() });
  event(m, '已应用（顶栏「撤销」或这里的「撤回」可以退回）');
  useStore.getState().notify('已应用 AI 的修改');
}

export function discardDraft(m: ModeId) {
  if (!get(m).draft) return;
  put(m, (c) => ({ draft: null, pending: [...c.pending, '你上次的修改我没有采用，已经放弃了'] }));
  event(m, '已放弃这些修改');
}

export function revertApplied(m: ModeId) {
  const a = get(m).applied;
  if (!a) return;
  if (!MODES[m].revert(a)) {
    useStore.getState().notify('应用之后又改过工程，没法直接撤回了：请用顶栏的「撤销」一步步退回');
    return;
  }
  put(m, (c) => ({ applied: null, pending: [...c.pending, '你上次的修改我撤回了'] }));
  event(m, '已撤回');
}

export async function newChat(m: ModeId) {
  const c = get(m);
  if (c.running) stop();
  if (c.draft && !(await ask('还有没应用的修改，开新对话会把它们丢掉。继续吗？', { ok: '丢掉并新开', danger: true }))) return;
  put(m, empty());
}
