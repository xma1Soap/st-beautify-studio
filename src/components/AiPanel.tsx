// The AI assistant: a chat on the right side of either editor. The AI's changes wait in a draft
// with a before / after list until the user applies them (one undo step) or throws them away.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { applyDraft, discardDraft, MODES, newChat, retry, revertApplied, send, stop, useAiChat, type ModeId } from '../ai/agent';
import { chat, listModels, type ChatMsg } from '../ai/client';
import { hunks, textDiff, diffCount } from '../ai/diff';
import type { Change } from '../ai/mode';
import { parsePreset } from '../ai/preset';
import { aiSettings, configured, endpoint, useAiSettings, type Skill } from '../ai/settings';
import { BUILTIN_SKILL } from '../ai/skill';
import { inTauri, pickFiles } from '../lib/files';
import { newId } from '../lib/id';
import { useLevel } from '../mode';
import { useStore } from '../store';

/* ---------- open / closed, width ---------- */

interface Ui {
  open: boolean;
  view: 'chat' | 'settings';
  width: number;
  toggle: () => void;
  setView: (v: Ui['view']) => void;
  setWidth: (w: number) => void;
}

const UI_KEY = 'stbs-ai-ui';
const savedUi = (() => {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  } catch {
    return {};
  }
})();

export const useAiUi = create<Ui>((set) => ({
  open: !!savedUi.open,
  view: 'chat',
  width: typeof savedUi.width === 'number' ? savedUi.width : 380,
  toggle: () => set((s) => ({ open: !s.open })),
  setView: (view) => set({ view }),
  setWidth: (width) => set({ width: Math.max(300, Math.min(720, width)) }),
}));
useAiUi.subscribe((s) => {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ open: s.open, width: s.width }));
  } catch {}
});

export function AiButton() {
  const open = useAiUi((s) => s.open);
  const toggle = useAiUi((s) => s.toggle);
  return (
    <button className={'ai-btn' + (open ? ' on' : '')} onClick={toggle} title="让 AI 帮你改美化：说出想要的样子，它来改，你确认后再应用">
      ✦ AI 助手
    </button>
  );
}

export function AiPanel({ mode }: { mode: ModeId }) {
  const open = useAiUi((s) => s.open);
  const view = useAiUi((s) => s.view);
  const width = useAiUi((s) => s.width);
  const { toggle, setView, setWidth } = useAiUi.getState();
  const ready = useAiSettings((s) => configured(s));
  const [resizing, setResizing] = useState(false);
  // not set up yet: start in the settings, and stay there while the user fills them in
  useEffect(() => {
    if (open && !ready) setView('settings');
  }, [open, ready]);
  if (!open) return null;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    setResizing(true);
    const move = (ev: PointerEvent) => setWidth(w0 + (x0 - ev.clientX));
    const up = () => {
      setResizing(false);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const settings = view === 'settings' || !ready;
  return (
    <aside className={'ai-panel' + (resizing ? ' resizing' : '')} style={{ width }}>
      <div className="ai-resize" onPointerDown={startResize} title="拖动调整宽度" />
      <div className="panel-head">
        <b className="ai-title">✦ AI 助手</b>
        <span className="hint">{mode === 'regex' ? '正则美化' : 'MVU 角色卡'}</span>
        <span className="sp" />
        {!settings && (
          <button className="small ghost" onClick={() => newChat(mode)} title="清空对话，重新开始">
            新对话
          </button>
        )}
        {ready && (
          <button className="small ghost" onClick={() => setView(settings ? 'chat' : 'settings')}>
            {settings ? '回到对话' : '设置'}
          </button>
        )}
        <button className="small ghost" onClick={toggle} title="收起">
          ✕
        </button>
      </div>
      {settings ? <SettingsView /> : <ChatView mode={mode} />}
    </aside>
  );
}

/* ---------- the chat ---------- */

const IDEAS: Record<ModeId, string[]> = {
  regex: ['帮我做一个状态栏美化：时间、地点、心情，暗色玻璃风格', '手机上字太小了，调大一点', '给角色的对话加上气泡样式', '检查一下这些正则有没有问题'],
  mvu: ['把状态栏换成赛博朋克风格的配色', '好感度用一排爱心显示', '把属性排成两列', '检查一下状态栏有没有问题'],
};

/** Plain text with ``` code blocks and `code`. */
function Text({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('```') ? (
          <pre key={i} className="ai-code">
            {p.replace(/^```[\w-]*\n?/, '').replace(/```$/, '')}
          </pre>
        ) : (
          <span key={i} className="ai-text">
            {p.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((q, j) =>
              q.startsWith('`') && q.endsWith('`') && q.length > 2 ? <code key={j}>{q.slice(1, -1)}</code> : q.startsWith('**') && q.endsWith('**') && q.length > 4 ? <b key={j}>{q.slice(2, -2)}</b> : q,
            )}
          </span>
        ),
      )}
    </>
  );
}

function Calls({ msg, notes }: { msg: ChatMsg; notes: Record<string, { label: string; ok: boolean; error?: string }> }) {
  if (!msg.tool_calls?.length) return null;
  return (
    <div className="ai-calls">
      {msg.tool_calls.map((tc) => {
        const n = notes[tc.id];
        return (
          <span key={tc.id} className={'ai-call' + (n ? (n.ok ? ' ok' : ' bad') : ' wait')} title={n?.error || tc.function.name}>
            {n ? (n.ok ? '✓ ' : '✕ ') : '… '}
            {n?.label ?? tc.function.name}
          </span>
        );
      })}
    </div>
  );
}

/** The user's message; notes the app added for the AI (draft thrown away…) are shown apart. */
function UserMsg({ text }: { text: string }) {
  const m = /^（([^\n]*)）\n/.exec(text);
  return (
    <>
      {m && <div className="ai-event">告诉了 AI：{m[1]}</div>}
      <div className="ai-msg user">{m ? text.slice(m[0].length) : text}</div>
    </>
  );
}

function Elapsed() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const at = Date.now();
    const i = setInterval(() => setT(Math.floor((Date.now() - at) / 1000)), 1000);
    return () => clearInterval(i);
  }, []);
  return <span className="hint">{t ? `${t} 秒` : ''}</span>;
}

function ChatView({ mode }: { mode: ModeId }) {
  const c = useAiChat((s) => s.chats[mode]);
  const model = useAiSettings((s) => s.model);
  const builtin = useAiSettings((s) => s.builtin);
  const preset = useAiSettings((s) => (s.presetOn && s.preset ? s.preset.name : ''));
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [c.msgs.length, c.live, c.events.length, c.draft, c.error, c.running]);

  const go = (t = text) => {
    if (!t.trim() || c.running) return;
    setText('');
    stick.current = true;
    send(mode, t);
  };

  const at = (i: number) => c.events.filter((e) => e.at === i).map((e, k) => <div key={'e' + i + k} className="ai-event">{e.text}</div>);
  const shown = c.msgs.filter((x) => x.role !== 'tool');

  return (
    <>
      <div
        className="ai-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!shown.length && !c.running && (
          <div className="ai-empty">
            <p>说说你想要什么样的美化，AI 会直接帮你改。改完先给你看改了哪些地方，你点「应用」才生效。</p>
            <div className="ai-ideas">
              {IDEAS[mode].map((t) => (
                <button key={t} className="small" onClick={() => go(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {c.msgs.map((msg, i) => (
          <Fragment key={i}>
            {at(i)}
            {msg.role === 'user' && <UserMsg text={msg.content ?? ''} />}
            {msg.role === 'assistant' && (
              <div className="ai-msg bot">
                {msg.reasoning_content && (
                  <details className="ai-think">
                    <summary>思考过程</summary>
                    <div>{msg.reasoning_content}</div>
                  </details>
                )}
                {msg.content && <Text text={msg.content} />}
                <Calls msg={msg} notes={c.notes} />
              </div>
            )}
          </Fragment>
        ))}
        {at(c.msgs.length)}
        {c.running && (
          <div className="ai-msg bot live">
            {c.live?.reasoning && !c.live.content && <div className="ai-think-live">{c.live.reasoning.slice(-300)}</div>}
            {c.live?.content && <Text text={c.live.content} />}
            {c.live?.toolCalls.length ? <Calls msg={{ role: 'assistant', content: null, tool_calls: c.live.toolCalls }} notes={{}} /> : null}
            <div className="ai-wait">
              <span className="ai-dots" />
              {c.live ? '正在写…' : 'AI 正在想…'} <Elapsed />
            </div>
          </div>
        )}
        {c.error && (
          <div className="ai-error">
            {c.error}
            <div>
              <button className="small" onClick={() => retry(mode)}>
                重试
              </button>
            </div>
          </div>
        )}
        <DraftCard mode={mode} />
        {c.applied !== null && !c.draft && !c.running && (
          <div className="ai-applied">
            已应用 AI 的修改
            <button className="small" onClick={() => revertApplied(mode)}>
              撤回
            </button>
          </div>
        )}
      </div>
      <div className="ai-compose">
        <textarea
          value={text}
          rows={3}
          placeholder={c.draft ? '还想怎么改？（会接着改这份草稿）' : '想要什么样的美化？Enter 发送，Shift+Enter 换行'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              go();
            }
          }}
        />
        <div className="ai-compose-row">
          <span className="hint ai-meta" title="在「设置」里改">
            {model}
            {builtin ? ' · 内置指导' : ''}
            {preset ? ` · 预设「${preset}」` : ''}
          </span>
          <span className="sp" />
          {c.running ? (
            <button className="danger" onClick={stop}>
              停止
            </button>
          ) : (
            <button className="primary" disabled={!text.trim()} onClick={() => go()}>
              发送
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- review the draft ---------- */

function DraftCard({ mode }: { mode: ModeId }) {
  const d = useAiChat((s) => s.chats[mode].draft);
  const running = useAiChat((s) => s.chats[mode].running);
  const changes = useMemo(() => (d ? MODES[mode].changes(d.base, d.next) : []), [d, mode]);
  if (!d || !changes.length) return null;
  return (
    <div className="ai-draft">
      <div className="ai-draft-head">
        <b>AI 改了 {changes.length} 处</b>
        <span className="hint">{running ? '还在改…' : '还没生效'}</span>
      </div>
      <ul>
        {changes.map((ch, i) => (
          <ChangeRow key={i} ch={ch} />
        ))}
      </ul>
      <div className="ai-draft-btns">
        <button className="primary" disabled={running} onClick={() => applyDraft(mode)}>
          应用
        </button>
        <button disabled={running} onClick={() => discardDraft(mode)}>
          放弃
        </button>
      </div>
    </div>
  );
}

function ChangeRow({ ch }: { ch: Change }) {
  const advanced = useLevel((s) => s.level === 'advanced');
  const [open, setOpen] = useState(false);
  const count = useMemo(() => (ch.diff && advanced ? diffCount(textDiff(ch.diff.a, ch.diff.b)) : null), [ch, advanced]);
  // 简易 shows what changed; 进阶 can also open the code
  if (!ch.diff || !advanced) return <li>{ch.title}</li>;
  return (
    <li>
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {ch.title}
        {count && (
          <span className="hint">
            {' '}
            <span className="ok">+{count.add}</span> <span className="del">−{count.del}</span>
          </span>
        )}
      </button>
      {open && <DiffView a={ch.diff.a} b={ch.diff.b} />}
    </li>
  );
}

const MAX_ROWS = 400;

function DiffView({ a, b }: { a: string; b: string }) {
  const rows = useMemo(() => hunks(textDiff(a, b)), [a, b]);
  return (
    <pre className="ai-diff">
      {rows.slice(0, MAX_ROWS).map((r, i) =>
        r.t === 'gap' ? (
          <div key={i} className="gap">
            ⋯ {r.n} 行没变
          </div>
        ) : (
          <div key={i} className={r.t === '+' ? 'add' : r.t === '-' ? 'del' : ''}>
            {r.t} {r.s}
          </div>
        ),
      )}
      {rows.length > MAX_ROWS && <div className="gap">⋯ 还有 {rows.length - MAX_ROWS} 行</div>}
    </pre>
  );
}

/* ---------- settings ---------- */

function SettingsView() {
  const s = useAiSettings();
  const set = s.set;
  const ready = configured(s);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSkill, setShowSkill] = useState(false);
  const notify = useStore((st) => st.notify);
  const url = endpoint(s.url, 'chat/completions');

  const fetchModels = async () => {
    setBusy('models');
    setMsg(null);
    try {
      const l = await listModels(aiSettings(), new AbortController().signal);
      setModels(l);
      setMsg({ ok: true, text: `拿到 ${l.length} 个模型，在「模型」里选` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy('');
  };
  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const r = await chat(aiSettings(), [{ role: 'user', content: '只回复两个字：好的' }], [], AbortSignal.timeout(90000));
      setMsg({ ok: true, text: `连上了，模型回复：${(r.content || r.reasoning || '（空）').trim().slice(0, 80)}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).name === 'TimeoutError' ? '90 秒没有回复' : (e as Error).message });
    }
    setBusy('');
  };
  const importPreset = async () => {
    const [f] = await pickFiles(false, [{ name: '酒馆预设', extensions: ['json'] }]);
    if (!f) return;
    try {
      const p = parsePreset(JSON.parse(new TextDecoder().decode(f.bytes)), f.name.replace(/\.json$/i, ''));
      set({ preset: p, presetOn: true });
      notify(`导入了预设「${p.name}」：${p.before.length + p.after.length} 条启用的条目`);
    } catch (e) {
      notify('没能导入预设：' + (e as Error).message);
    }
  };
  const editSkill = (id: string, patch: Partial<Skill>) => set({ skills: s.skills.map((k) => (k.id === id ? { ...k, ...patch } : k)) });

  return (
    <div className="ai-settings scroll">
      <section>
        <h4>模型接口</h4>
        <p className="hint">OpenAI 兼容格式（大多数中转站都是）。</p>
        <label className="ai-field">
          接口地址
          <input value={s.url} placeholder="https://api.example.com/v1" spellCheck={false} onChange={(e) => set({ url: e.target.value })} />
        </label>
        {s.url.trim() && <div className="hint ai-url">{url ? `会请求 ${url}` : '地址看不懂，要以 http:// 或 https:// 开头'}</div>}
        <label className="ai-field">
          密钥
          <span className="ai-key">
            <input type={showKey ? 'text' : 'password'} value={s.key} placeholder="sk-…" spellCheck={false} autoComplete="off" onChange={(e) => set({ key: e.target.value })} />
            <button className="small ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </span>
        </label>
        <label className="ai-field">
          模型
          <span className="ai-key">
            <input value={s.model} list="ai-models" placeholder="例如 gpt-4o、claude-sonnet、deepseek-chat" spellCheck={false} onChange={(e) => set({ model: e.target.value })} />
            <button className="small" disabled={!!busy || !url} onClick={fetchModels}>
              {busy === 'models' ? '获取中…' : '获取列表'}
            </button>
          </span>
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <div className="ai-row">
          <label className="ai-field inline">
            温度
            <input
              type="number"
              className="num"
              step={0.1}
              min={0}
              max={2}
              value={s.temperature ?? ''}
              placeholder="默认"
              onChange={(e) => set({ temperature: e.target.value === '' ? null : Math.max(0, Math.min(2, Number(e.target.value))) })}
            />
          </label>
          <label className="check" title="一边生成一边显示。接口出错时可以关掉试试">
            <input type="checkbox" checked={s.stream} onChange={(e) => set({ stream: e.target.checked })} />
            流式输出
          </label>
          <span className="sp" />
          <button className="small" disabled={!!busy || !ready} onClick={test}>
            {busy === 'test' ? '测试中…' : '测试连接'}
          </button>
        </div>
        {msg && <div className={'ai-note ' + (msg.ok ? 'ok' : 'bad')}>{msg.text}</div>}
        <p className="hint">
          {inTauri()
            ? '密钥只存在这台电脑上，不会写进工程文件，也不会跟着角色卡导出。'
            : '网页版：密钥存在这个浏览器里，别在公用电脑上用；它不会写进工程文件或导出的卡。有的接口不允许网页直接访问（跨域），连不上就用桌面版。'}
        </p>
      </section>

      <section>
        <h4>给 AI 的指导</h4>
        <label className="check">
          <input type="checkbox" checked={s.builtin} onChange={(e) => set({ builtin: e.target.checked })} />
          内置指导：酒馆正则的规则、酒馆会过滤掉的写法、动效、前端卡、手机适配
          <button className="small ghost" onClick={() => setShowSkill(!showSkill)}>
            {showSkill ? '收起' : '看看'}
          </button>
        </label>
        {showSkill && <pre className="ai-code ai-skill">{BUILTIN_SKILL}</pre>}
        {s.skills.map((k) => (
          <div key={k.id} className="ai-skill-item">
            <div className="ai-row">
              <input type="checkbox" checked={k.on} onChange={(e) => editSkill(k.id, { on: e.target.checked })} title="用这条" />
              <input value={k.name} placeholder="名字" onChange={(e) => editSkill(k.id, { name: e.target.value })} />
              <button className="small ghost" onClick={() => set({ skills: s.skills.filter((x) => x.id !== k.id) })}>
                删除
              </button>
            </div>
            <textarea rows={4} value={k.text} placeholder="写给 AI 的要求，比如：我喜欢圆角、柔和的配色；动画不要太多" onChange={(e) => editSkill(k.id, { text: e.target.value })} />
          </div>
        ))}
        <button className="small" onClick={() => set({ skills: [...s.skills, { id: newId(), name: '我的指导', text: '', on: true }] })}>
          ＋ 加一条自己的指导
        </button>
      </section>

      <section>
        <h4>酒馆预设</h4>
        <p className="hint">导入酒馆的「对话补全预设」JSON：启用的条目按预设里的顺序发给 AI（聊天记录之后的条目放在对话后面），{'{{char}}'}、{'{{user}}'} 照常替换。</p>
        {s.preset ? (
          <>
            <div className="ai-row">
              <label className="check">
                <input type="checkbox" checked={s.presetOn} onChange={(e) => set({ presetOn: e.target.checked })} />
                使用「{s.preset.name}」
              </label>
              <span className="sp" />
              <button className="small" onClick={importPreset}>
                换一个
              </button>
              <button className="small ghost" onClick={() => set({ preset: null })}>
                移除
              </button>
            </div>
            <ol className="ai-preset hint">
              {s.preset.before.map((x, i) => (
                <li key={'b' + i}>
                  {x.name}（{x.role}）
                </li>
              ))}
              {s.preset.after.length > 0 && <li className="ai-preset-sep">—— 对话 ——</li>}
              {s.preset.after.map((x, i) => (
                <li key={'a' + i}>
                  {x.name}（{x.role}）
                </li>
              ))}
            </ol>
          </>
        ) : (
          <button className="small" onClick={importPreset}>
            导入预设 JSON
          </button>
        )}
      </section>
      {ready && (
        <div className="ai-row">
          <span className="sp" />
          <button className="primary" onClick={() => useAiUi.getState().setView('chat')}>
            开始对话
          </button>
        </div>
      )}
    </div>
  );
}
