// Talking to an OpenAI-compatible endpoint. The desktop app sends the request from Rust (no CORS limits,
// and only …/chat/completions and …/models are allowed there); the web version uses fetch.
import { inTauri } from '../lib/files';
import { endpoint, type AiSettings } from './settings';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** thinking text some endpoints send (DeepSeek and others want it back with tool calls) */
  reasoning_content?: string;
  name?: string;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface Reply {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finish?: string;
}

let nextJob = 1;
const aborted = () => new DOMException('已停止', 'AbortError');

/** Send one request; `onText` gets the reply body as it arrives. Returns the HTTP status. */
async function send(url: string, key: string, body: string | undefined, onText: (t: string) => void, signal: AbortSignal): Promise<number> {
  if (signal.aborted) throw aborted();
  if (inTauri()) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const id = nextJob++;
    let status = 0;
    let ended!: () => void;
    const end = new Promise<void>((r) => (ended = r));
    const ch = new Channel<{ t: 'status'; code: number } | { t: 'data'; text: string } | { t: 'end' }>();
    ch.onmessage = (ev) => {
      if (ev.t === 'status') status = ev.code;
      else if (ev.t === 'data') onText(ev.text);
      else ended();
    };
    const stop = () => void invoke('ai_cancel', { id });
    signal.addEventListener('abort', stop);
    try {
      await invoke('ai_fetch', { id, url, key, body: body ?? null, onEvent: ch });
      // the last pieces can arrive a moment after the command returns
      await Promise.race([end, new Promise((r) => setTimeout(r, 3000))]);
    } catch (e) {
      const m = String(e);
      if (m === 'CANCELLED' || signal.aborted) throw aborted();
      if (m === 'BAD_URL') throw new Error('接口地址不对：要以 http(s):// 开头，以 /v1 或 /chat/completions 结尾');
      throw new Error('连不上接口：' + m);
    } finally {
      signal.removeEventListener('abort', stop);
    }
    return status;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(key.trim() ? { Authorization: 'Bearer ' + key.trim() } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body,
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw aborted();
    throw new Error('连不上接口（网页版常见原因：这个接口不允许网页直接访问，也就是跨域被拦。换桌面版，或换一个允许跨域的地址）：' + String(e));
  }
  const reader = res.body?.getReader();
  if (reader) {
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onText(dec.decode(value, { stream: true }));
    }
    onText(dec.decode());
  }
  return res.status;
}

/** What went wrong, from an error reply body. */
function errorText(status: number, body: string): string {
  let msg = body.trim().slice(0, 600);
  try {
    const o = JSON.parse(body);
    msg = o?.error?.message || o?.message || (typeof o?.error === 'string' ? o.error : '') || msg;
  } catch {}
  const hint =
    status === 401 || status === 403 ? '（密钥不对或没有权限）' : status === 404 ? '（地址或模型名不对）' : status === 429 ? '（请求太频繁或额度用完了）' : status >= 500 ? '（接口那边出错了，可以重试）' : '';
  return `接口返回 ${status}${hint}：${msg || '没有说明'}`;
}

/** The model list of the endpoint. */
export async function listModels(s: AiSettings, signal: AbortSignal): Promise<string[]> {
  const url = endpoint(s.url, 'models');
  if (!url) throw new Error('先填接口地址');
  let body = '';
  const status = await send(url, s.key, undefined, (t) => (body += t), signal);
  if (status >= 400 || status === 0) throw new Error(errorText(status, body));
  const o = JSON.parse(body);
  const list: unknown[] = Array.isArray(o?.data) ? o.data : Array.isArray(o) ? o : Array.isArray(o?.models) ? o.models : [];
  return list.map((m: any) => (typeof m === 'string' ? m : String(m?.id ?? m?.name ?? ''))).filter(Boolean).sort();
}

/** Merge one streamed (or whole) tool call into the list. */
function addToolCall(list: ToolCall[], tc: any) {
  let at = typeof tc.index === 'number' ? tc.index : tc.id ? list.findIndex((x) => x.id === tc.id) : -1;
  if (at < 0) at = list.length;
  const slot = (list[at] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
  if (tc.id) slot.id = tc.id;
  const name = tc.function?.name;
  // some endpoints repeat the whole name in every piece, others split it
  if (name) slot.function.name = slot.function.name && !name.startsWith(slot.function.name) ? slot.function.name + name : name;
  const args = tc.function?.arguments;
  if (typeof args === 'string') slot.function.arguments += args;
  else if (args && typeof args === 'object') slot.function.arguments = JSON.stringify(args);
}

/** One chat completion. `onProgress` is called as the reply comes in. */
export async function chat(s: AiSettings, messages: ChatMsg[], tools: ToolDef[], signal: AbortSignal, onProgress?: (r: Reply) => void): Promise<Reply> {
  const url = endpoint(s.url, 'chat/completions');
  if (!url) throw new Error('先在设置里填接口地址');
  const body = JSON.stringify({
    model: s.model.trim(),
    messages,
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    ...(s.temperature !== null ? { temperature: s.temperature } : {}),
    stream: s.stream,
  });
  const r: Reply = { content: '', reasoning: '', toolCalls: [] };
  let all = '';
  let buf = '';
  let sse = false;
  let streamErr = '';

  const take = (o: any) => {
    if (o?.error) {
      streamErr = o.error.message || JSON.stringify(o.error);
      return;
    }
    const c = o?.choices?.[0];
    if (!c) return;
    const d = c.delta ?? c.message ?? {};
    if (typeof d.content === 'string') r.content += d.content;
    else if (Array.isArray(d.content)) r.content += d.content.map((p: any) => p?.text ?? '').join('');
    const think = d.reasoning_content ?? d.reasoning;
    if (typeof think === 'string') r.reasoning += think;
    for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) addToolCall(r.toolCalls, tc);
    if (c.finish_reason) r.finish = c.finish_reason;
  };
  const line = (l: string) => {
    l = l.trim();
    if (!l.startsWith('data:')) return;
    sse = true;
    const d = l.slice(5).trim();
    if (!d || d === '[DONE]') return;
    try {
      take(JSON.parse(d));
    } catch {}
  };

  const status = await send(
    url,
    s.key,
    body,
    (t) => {
      if (all.length < 4_000_000) all += t;
      buf += t;
      let i;
      let got = false;
      while ((i = buf.indexOf('\n')) >= 0) {
        line(buf.slice(0, i));
        buf = buf.slice(i + 1);
        got = true;
      }
      if (got && onProgress) onProgress(r);
    },
    signal,
  );
  if (buf) line(buf);
  if (status >= 400 || status === 0) throw new Error(errorText(status, all));
  if (!sse) {
    // a whole JSON reply (stream off, or the endpoint ignored it)
    try {
      take(JSON.parse(all));
    } catch {
      throw new Error('接口的回复看不懂：' + all.trim().slice(0, 300));
    }
  }
  if (streamErr) throw new Error('接口报错：' + streamErr);
  r.toolCalls = r.toolCalls.filter((x) => x.function.name).map((x, i) => (x.id ? x : { ...x, id: `call_${Date.now().toString(36)}_${i}` }));
  return r;
}
