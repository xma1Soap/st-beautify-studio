// Right panel: the card's status bar as players will see it, plus a simulator for AI replies.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { simTextOf, useCard } from '../../cardStore';
import { defaultSettings } from '../../lib/defaults';
import { processText } from '../../lib/engine';
import { buildChat } from '../../lib/render';
import { loadFrameLibs } from '../../lib/frameLibs';
import { cardVariables, detectMvuParts, keptBarRegexes, keptRegexes } from '../../mvu/card';
import type { PatchOp } from '../../mvu/patch';
import { sampleReply } from '../../mvu/prompts';
import { mvuRegexes } from '../../mvu/regexes';
import { textBarOf } from '../../mvu/textbar';
import { barOf, compileBar } from '../../mvu/bar';
import { fitDevice, PAD, PHONES, savedPhone, savePhone } from '../device';
import { simulate, tweakable, useSim } from './sim';
import type { VarNode } from '../../mvu/types';
import { NumberInput } from '../common';
import { ask } from '../dialog';

/** A slash command a button ran, in plain words. */
function slashNote(cmd: string): string {
  const unescape = (t: string) => t.split('\\|').join('|');
  const send = cmd.match(/^\/send ([\s\S]*) \| \/trigger$/);
  if (send) return `按钮发出了一条消息：「${unescape(send[1])}」（预览里不会真的发送）`;
  const fill = cmd.match(/^\/setinput ([\s\S]*)$/);
  if (fill) return `按钮往输入框里填了：「${unescape(fill[1])}」`;
  return `按钮执行了：${cmd}`;
}

const opText = (o: PatchOp) =>
  [o.op, o.path ?? (o.from ? `${o.from} → ${o.to ?? ''}` : ''), o.value !== undefined ? JSON.stringify(o.value) : ''].filter(Boolean).join(' ');

export function MvuPreview() {
  const vars = useCard((s) => s.project.vars);
  const customBar = useCard((s) => s.project.bar);
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const pid = useCard((s) => s.project.id);
  const name = useCard((s) => s.project.card.name);
  const greetings = useCard((s) => s.project.card.greetings);
  const pick = useCard((s) => (s.simGreeting < s.project.card.greetings.length ? s.simGreeting : 0));
  const own = useCard((s) => s.project.card.greetingVars?.[pick]);
  const greeting = greetings[pick] ?? '';
  const steps = useCard(useShallow((s) => s.simSteps.slice(0, s.simAt + 1)));
  const simText = steps[steps.length - 1] ?? '';
  const floor = steps.length;
  const tweak = useCard((s) => s.simTweak);
  const preview = useCard((s) => s.preview);
  const { setPreview, setSimGreeting } = useCard.getState();

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState({ w: 600, h: 500 });
  const [phoneIdx, setPhoneIdx] = useState(savedPhone);
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  /** what the status bar's buttons did in the preview (they can't reach a real chat here) */
  const [note, setNote] = useState('');

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const phone = preview.device === 'phone';
  const { w, h, scale } = fitDevice(stage, phone, phoneIdx);
  const sim = useMemo(() => simulate(vars, steps, tweak, own), [vars, steps, tweak, own]);
  const settings = useMemo(() => ({ ...defaultSettings(), char: name || '角色', device: preview.device, chatTheme: preview.chatTheme }), [name, preview]);
  const textBar = useCard((s) => s.project.textBar);
  const base = useCard((s) => s.project.base);
  const takeover = useCard((s) => s.project.takeover);
  // what the exported card runs in SillyTavern: the card's own regexes first, then the generated ones
  const kept = useMemo(() => keptRegexes({ base, takeover }), [base, takeover]);
  const regexes = useMemo(
    () => [
      ...kept,
      ...mvuRegexes(
        compileBar(barOf({ bar: customBar, vars }), vars, { allowEdit, key: `preview-${pid}` }),
        (slot) => slot,
        textBarOf({ vars, bar: customBar, textBar })?.html,
      ),
    ],
    [kept, vars, customBar, allowEdit, pid, textBar],
  );
  const extra = useMemo(() => ({ charVars: cardVariables({ base }), card: { name: name || '角色' } }), [base, name]);
  const vh = Math.round(h / 20) * 20;

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      // the libraries cards expect ($, _, z, YAML) are loaded once; without them the CDN copies are used
      loadFrameLibs()
        .catch(() => setErrors(['没能载入卡片要用的 jQuery / lodash / zod，改用网上的 jQuery 和 lodash']))
        .finally(() => {
          const f = frameRef.current;
          if (!f || !live) return;
          setErrors([]);
          const body = simText.trim() ? simText : floor > 1 ? '（这一条还没贴回复，数值和上一条一样）' : greeting.trim() || '（开场白）';
          const { raw, display } = processText(regexes, body + '\n\n<StatusPlaceHolderImpl/>', settings);
          f.srcdoc = buildChat(display, raw, settings, vh, { stat: sim.data, prev: sim.before, ...extra }).html;
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [regexes, settings, simText, floor, greeting, sim, vh, nonce, extra]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 8000);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.__stp === 'err') setErrors((l) => (l.length >= 20 || l.includes(d.msg) ? l : [...l, d.msg]));
      else if (d && d.__stp === 'stat') setNote('预览里改了变量：只在这次预览里有效，点「刷新」或改动工程后会回到原来的值。');
      else if (d && d.__stp === 'slash') setNote(slashNote(String(d.cmd)));
      else if (d && d.__stp === 'toast') setNote(`卡片弹出提示：${String(d.msg)}`);
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);

  return (
    <section className="preview mvu-preview">
      <div className="panel-head">
        <RightSwitch />
        <b>状态栏预览</b>
        <span className="hint">
          {floor > 1 ? `第 ${floor} 条回复之后` : simText.trim() ? '模拟回复之后' : '开局时'}
          {Object.keys(tweak).length ? '（有手动改的值）' : ''}
        </span>
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
        {greetings.length > 1 && (
          <select className="small-select" value={pick} onChange={(e) => setSimGreeting(Number(e.target.value))} title="从哪条开场白开始（每条开场白可以有自己的初始值）">
            {greetings.map((_, i) => (
              <option key={i} value={i}>
                {i === 0 ? '第一条开场白' : `备选开场白 ${i}`}
              </option>
            ))}
          </select>
        )}
        <select className="small-select" value={preview.chatTheme} onChange={(e) => setPreview({ chatTheme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">暗色聊天</option>
          <option value="light">亮色聊天</option>
        </select>
        <button className="small" onClick={() => setNonce((n) => n + 1)} title="重新渲染">
          刷新
        </button>
      </div>
      <OwnBarNote />
      <div className="stage" ref={stageRef}>
        <div className={'device ' + (phone ? 'phone' : 'desktop')} style={{ width: w, height: h, top: PAD, transform: `translateX(-50%) scale(${scale})` }}>
          <iframe ref={frameRef} title="预览" sandbox="allow-scripts allow-popups allow-forms allow-modals" />
        </div>
        {/* floating, so they don't change the preview's size (that would reload it) */}
        <div className="pv-float">
          {note && (
            <div className="pv-note" onClick={() => setNote('')}>
              {note}
            </div>
          )}
          {sim.setupError && <div className="err-log">⚠ {sim.setupError}</div>}
          {errors.length > 0 && (
            <div className="err-log">
              {errors.map((m, i) => (
                <div key={i}>⚠ {m}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      <TweakPanel />
      <SimPanel />
    </section>
  );
}

/**
 * On the status bar page, when the imported card keeps its own status bar: the one made here won't show in
 * SillyTavern (the card's regex takes MVU's placeholder first), so say so and offer to switch.
 */
export function OwnBarNote() {
  const tab = useCard((s) => s.tab);
  const base = useCard((s) => s.project.base);
  const takeover = useCard((s) => s.project.takeover);
  const own = useMemo(() => keptBarRegexes({ base, takeover }), [base, takeover]);
  if (tab !== 'bar' || !own.length) return null;
  const replace = () =>
    useCard.getState().edit((p) => {
      const t = { entries: [], regexes: [], scripts: [], ...p.takeover };
      const ids = detectMvuParts(p.base)
        .filter((x) => x.kind === 'regex' && x.keep)
        .map((x) => x.id as string);
      return { ...p, takeover: { ...t, regexes: [...new Set([...t.regexes, ...ids])] } };
    });
  return (
    <div className="own-bar-note">
      <span>
        导出后酒馆里显示的是这张卡自己的状态栏（正则「{own.map((r) => r.scriptName).join('」「')}」），这里做的状态栏不会出现。
      </span>
      <button className="small" onClick={replace} title="导出时用这里做的状态栏替换卡自带的（在「角色卡」页可以改回来）">
        换成这里做的
      </button>
    </div>
  );
}

/** On the status bar page: switch the right panel between the canvas and the chat preview. */
export function RightSwitch() {
  const tab = useCard((s) => s.tab);
  const view = useCard((s) => s.rightView);
  const set = useCard((s) => s.setRightView);
  const plain = useCard((s) => !!s.project.textBar?.on);
  if (tab !== 'bar' || plain) return null;
  return (
    <div className="seg" role="group" aria-label="右侧显示">
      <button className={view === 'canvas' ? 'on' : ''} onClick={() => set('canvas')} title="在这里点选、拖动组件">
        画布
      </button>
      <button className={view === 'chat' ? 'on' : ''} onClick={() => set('chat')} title="放进聊天消息里看看">
        聊天里看
      </button>
    </div>
  );
}

/** Paste an AI reply and see what it would change (used by the chat preview and the canvas). */
export function SimPanel() {
  const vars = useCard((s) => s.project.vars);
  const simText = useCard(simTextOf);
  const steps = useCard((s) => s.simSteps);
  const at = useCard((s) => s.simAt);
  const { setSimText, setSimAt, addSimStep, removeSimStep, clearSim } = useCard.getState();
  const sim = useSim();
  const [simOpen, setSimOpen] = useState(() => useCard.getState().simSteps.some((t) => t.trim()));
  const bad = sim.results.filter((r) => !r.ok).length;
  const many = steps.length > 1;
  return (
    <div className={'sim' + (simOpen ? ' open' : '')}>
      <button className="sim-head" onClick={() => setSimOpen((o) => !o)}>
        {simOpen ? '▾' : '▸'} 模拟 AI 回复
        <span className="hint">
          {many && `　第 ${at + 1} / ${steps.length} 条`}
          {simText.trim() ? (bad ? `　${sim.results.length} 条更新，${bad} 条会被拒绝` : `　${sim.results.length} 条更新都能生效`) : many ? '　这条还是空的' : '　贴一段 AI 回复，看变量会怎么变'}
        </span>
      </button>
      {simOpen && (
        <div className="sim-body">
          <div className="sim-steps">
            {steps.map((t, i) => (
              <button key={i} className={'small' + (i === at ? ' on' : '')} onClick={() => setSimAt(i)} title={t.trim() ? '' : '还没贴内容'}>
                第 {i + 1} 条{t.trim() ? '' : '（空）'}
              </button>
            ))}
            <button className="small" onClick={addSimStep} title="接着上一条的结果，再贴一条回复">
              ＋ 下一条
            </button>
          </div>
          {many && (
            <div className="hint">
              每条接着前一条的结果算；预览显示第 {at + 1} 条之后的数值，状态栏的 ↑↓ 和{at ? `第 ${at} 条` : '开局'}比。
              {sim.earlierBad > 0 && ` 前面几条里有 ${sim.earlierBad} 条更新没生效。`}
            </div>
          )}
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
            {many && (
              <button className="small" onClick={() => removeSimStep(at)}>
                删掉这条
              </button>
            )}
            <button className="small" disabled={!many && !simText} onClick={() => (many ? void ask('把模拟的回复全部清掉，回到开局吗？', { ok: '全部清空', danger: true }).then((y) => y && clearSim()) : setSimText(''))}>
              {many ? '全部清空' : '清空（回到开局）'}
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
  );
}

/** Change values by hand to see how the status bar looks with them (used by the chat preview and the canvas). */
export function TweakPanel() {
  const vars = useCard((s) => s.project.vars);
  const tweak = useCard((s) => s.simTweak);
  const { setSimTweak, clearSimTweak } = useCard.getState();
  const sim = useSim();
  const [open, setOpen] = useState(false);
  const list = useMemo(() => tweakable(vars), [vars]);
  const changed = list.filter((t) => t.v.id in tweak).length;
  const tables = useMemo(() => countTables(vars), [vars]);
  return (
    <div className={'sim tweak' + (open ? ' open' : '')}>
      <button className="sim-head" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} 试试不同数值
        <span className="hint">{changed ? `　手动改了 ${changed} 个，只在这里看看，不会存进卡里` : '　拖一拖，看状态栏在别的数值下是什么样'}</span>
      </button>
      {open && (
        <div className="sim-body">
          {!list.length && <div className="hint">还没有能改的变量。</div>}
          <div className="tw-list">
            {list.map((t) => {
              let cur: unknown = sim.data;
              for (const k of t.keys) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
              const on = t.v.id in tweak;
              return (
                <div key={t.v.id} className={'tw-row' + (on ? ' on' : '')}>
                  <span className="tw-name" title={t.label}>
                    {t.label}
                  </span>
                  <TweakInput v={t.v} value={cur} onChange={(x) => setSimTweak(t.v.id, x)} />
                  <button className="xbtn" title="回到原来的值" style={{ visibility: on ? 'visible' : 'hidden' }} onClick={() => setSimTweak(t.v.id, undefined)}>
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
          <div className="inline">
            <button className="small" disabled={!changed} onClick={clearSimTweak}>
              全部复原
            </button>
            {tables > 0 && <span className="hint">表格里的内容在下面「模拟 AI 回复」里改（点「生成示例回复」会加几行）</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function countTables(vars: VarNode[]): number {
  let n = 0;
  for (const v of vars) {
    if (v.kind === 'table') n++;
    if (v.kind === 'group') n += countTables(v.children ?? []);
  }
  return n;
}

function TweakInput({ v, value, onChange }: { v: VarNode; value: unknown; onChange: (x: unknown) => void }) {
  if (v.kind === 'number') {
    const n = typeof value === 'number' ? value : 0;
    const ranged = v.min != null && v.max != null && v.max > v.min;
    const step = v.integer ? 1 : ranged ? Math.max((v.max! - v.min!) / 100, 0.01) : 1;
    return (
      <span className="tw-num">
        {ranged && <input type="range" min={v.min!} max={v.max!} step={step} value={n} onChange={(e) => onChange(Number(e.target.value))} />}
        <NumberInput value={n} onChange={(x) => x !== undefined && onChange(x)} />
      </span>
    );
  }
  if (v.kind === 'bool')
    return (
      <label className="chk">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {value ? '是' : '否'}
      </label>
    );
  if (v.kind === 'choice')
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
        {(v.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (v.kind === 'list')
    return (
      <input
        value={Array.isArray(value) ? value.join('、') : ''}
        placeholder="用 、 或逗号隔开"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/[、,，]/)
              .map((x) => x.trim())
              .filter(Boolean),
          )
        }
      />
    );
  return <input value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
}
