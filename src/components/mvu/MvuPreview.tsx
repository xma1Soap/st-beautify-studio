// Right panel: the card's status bar as players will see it, plus a simulator for AI replies.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCard } from '../../cardStore';
import { defaultSettings } from '../../lib/defaults';
import { processText } from '../../lib/engine';
import { buildChat } from '../../lib/render';
import { applyOps, extractOps, type OpResult, type PatchOp } from '../../mvu/patch';
import { sampleReply } from '../../mvu/prompts';
import { mvuRegexes } from '../../mvu/regexes';
import { buildSchema } from '../../mvu/schema';
import { defaultView } from '../../mvu/statusbar';
import type { VarNode } from '../../mvu/types';
import { initialData } from '../../mvu/vars';
import { fitDevice, PAD, PHONES, savedPhone, savePhone } from '../device';

interface Sim {
  data: Record<string, unknown>;
  /** problem with the variable setup itself */
  setupError: string;
  readErrors: string[];
  results: OpResult[];
}

function simulate(vars: VarNode[], text: string): Sim {
  const raw = initialData(vars);
  let schema;
  try {
    schema = buildSchema(vars);
  } catch (e) {
    return { data: raw, setupError: '变量设置有问题，没法检查：' + (e as Error).message, readErrors: [], results: [] };
  }
  const start = schema.safeParse(raw);
  if (!start.success) {
    const i = start.error.issues[0];
    return { data: raw, setupError: `初始值不符合设定（${i.path.join('.') || '变量'}：${i.message}），MVU 开局时会报错`, readErrors: [], results: [] };
  }
  const data = start.data as Record<string, unknown>;
  if (!text.trim()) return { data, setupError: '', readErrors: [], results: [] };
  const { ops, errors } = extractOps(text);
  const r = applyOps(data, ops, schema);
  return { data: r.data, setupError: '', readErrors: errors, results: r.results };
}

const opText = (o: PatchOp) =>
  [o.op, o.path ?? (o.from ? `${o.from} → ${o.to ?? ''}` : ''), o.value !== undefined ? JSON.stringify(o.value) : ''].filter(Boolean).join(' ');

export function MvuPreview() {
  const vars = useCard((s) => s.project.vars);
  const name = useCard((s) => s.project.card.name);
  const greeting = useCard((s) => s.project.card.greetings[0] ?? '');
  const simText = useCard((s) => s.simText);
  const preview = useCard((s) => s.preview);
  const { setSimText, setPreview } = useCard.getState();

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState({ w: 600, h: 500 });
  const [phoneIdx, setPhoneIdx] = useState(savedPhone);
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [simOpen, setSimOpen] = useState(() => !!useCard.getState().simText);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const phone = preview.device === 'phone';
  const { w, h, scale } = fitDevice(stage, phone, phoneIdx);
  const sim = useMemo(() => simulate(vars, simText), [vars, simText]);
  const settings = useMemo(() => ({ ...defaultSettings(), char: name || '角色', device: preview.device, chatTheme: preview.chatTheme }), [name, preview]);
  const regexes = useMemo(() => mvuRegexes(defaultView(vars), (slot) => slot), [vars]);
  const vh = Math.round(h / 20) * 20;

  useEffect(() => {
    const t = setTimeout(() => {
      const f = frameRef.current;
      if (!f) return;
      setErrors([]);
      const body = simText.trim() ? simText : greeting.trim() || '（开场白）';
      const { raw, display } = processText(regexes, body + '\n\n<StatusPlaceHolderImpl/>', settings);
      f.srcdoc = buildChat(display, raw, settings, vh, sim.data).html;
    }, 300);
    return () => clearTimeout(t);
  }, [regexes, settings, simText, greeting, sim, vh, nonce]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.__stp === 'err') setErrors((l) => (l.length >= 20 || l.includes(d.msg) ? l : [...l, d.msg]));
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);

  const bad = sim.results.filter((r) => !r.ok).length;

  return (
    <section className="preview mvu-preview">
      <div className="panel-head">
        <b>状态栏预览</b>
        <span className="hint">{simText.trim() ? '模拟回复之后' : '开局时'}</span>
        <span className="sp" />
        <div className="seg" role="group" aria-label="预览设备">
          <button className={phone ? 'on' : ''} onClick={() => setPreview({ device: 'phone' })}>
            📱 手机
          </button>
          <button className={!phone ? 'on' : ''} onClick={() => setPreview({ device: 'desktop' })}>
            🖥 电脑
          </button>
        </div>
      </div>
      <div className="preview-sub">
        {phone && (
          <select
            className="small-select"
            value={phoneIdx}
            onChange={(e) => {
              setPhoneIdx(Number(e.target.value));
              savePhone(Number(e.target.value));
            }}
            title="手机屏幕宽度"
          >
            {PHONES.map((ph, i) => (
              <option key={i} value={i}>
                {ph.label}
              </option>
            ))}
          </select>
        )}
        <span className="hint">
          {Math.round(w)} × {Math.round(h)}
          {scale < 0.999 ? ` · 缩放 ${Math.round(scale * 100)}%` : ''}
        </span>
        <span className="sp" />
        <select className="small-select" value={preview.chatTheme} onChange={(e) => setPreview({ chatTheme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">暗色聊天</option>
          <option value="light">亮色聊天</option>
        </select>
        <button className="small" onClick={() => setNonce((n) => n + 1)} title="重新渲染">
          刷新
        </button>
      </div>
      <div className="stage" ref={stageRef}>
        <div className={'device ' + (phone ? 'phone' : 'desktop')} style={{ width: w, height: h, top: PAD, transform: `translateX(-50%) scale(${scale})` }}>
          <iframe ref={frameRef} title="预览" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals" />
        </div>
      </div>
      {sim.setupError && <div className="err-log">⚠ {sim.setupError}</div>}
      {errors.length > 0 && (
        <div className="err-log">
          {errors.map((m, i) => (
            <div key={i}>⚠ {m}</div>
          ))}
        </div>
      )}
      <div className={'sim' + (simOpen ? ' open' : '')}>
        <button className="sim-head" onClick={() => setSimOpen((o) => !o)}>
          {simOpen ? '▾' : '▸'} 模拟 AI 回复
          <span className="hint">
            {simText.trim() ? (bad ? `　${sim.results.length} 条更新，${bad} 条会被拒绝` : `　${sim.results.length} 条更新都能生效`) : '　贴一段 AI 回复，看变量会怎么变'}
          </span>
        </button>
        {simOpen && (
          <div className="sim-body">
            <textarea
              rows={7}
              value={simText}
              spellCheck={false}
              placeholder="把 AI 的一段回复（带 <UpdateVariable> 的）贴在这里，或者点「生成示例回复」"
              onChange={(e) => setSimText(e.target.value)}
            />
            <div className="inline">
              <button className="small" onClick={() => setSimText(sampleReply(vars))}>
                生成示例回复
              </button>
              <button className="small" disabled={!simText} onClick={() => setSimText('')}>
                清空（回到开局）
              </button>
            </div>
            {simText.trim() !== '' && (
              <ul className="results">
                {sim.readErrors.map((m, i) => (
                  <li key={'e' + i} className="bad">
                    ✗ {m}
                  </li>
                ))}
                {sim.results.map((r, i) => (
                  <li key={i} className={r.ok ? (r.msg ? 'note' : 'ok') : 'bad'}>
                    {r.ok ? '✓' : '✗'} <code>{opText(r.op)}</code>
                    {r.msg && <div className="hint">{r.msg}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
