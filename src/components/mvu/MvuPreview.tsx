// Right panel: the card's status bar as players will see it, plus a simulator for AI replies.
import { previewLog } from '../../ai/mode';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { simTextOf, useCard } from '../../cardStore';
import { loadPreviewAssets } from '../../lib/previewAssets';
import { barOnGreeting, cardRegexes, detectMvuParts, drawsStatusBar, keptBarRegexes, keptRegexes, PLACEHOLDER, updateCardRegex } from '../../mvu/card';
import { cardExtras, previewChat, previewRegexes, previewSettings, processFloors, simFloors, USER_STAND_IN, type Floor } from '../../mvu/preview';
import { annotate, moveEl, noPickReason } from '../../lib/htmlEdit';
import { PickPanel, type PickInfo } from '../PickPanel';
import { ColorsPanel } from '../PalettePanel';
import type { PatchOp } from '../../mvu/patch';
import { sampleReply } from '../../mvu/prompts';
import { DeviceSwitch, LookSelect, PAD, ScreenPickers, useDevices } from '../device';
import { lookOf } from '../../lib/stThemes';
import { EXTREMES, extremeTweak, simulate, tweakable, useSim } from './sim';
import { leaves } from '../../mvu/vars';
import type { CardProject, VarNode } from '../../mvu/types';
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
  const users = useCard(useShallow((s) => s.simSteps.slice(0, s.simAt + 1).map((_, i) => s.simUsers[i] ?? '')));
  const simText = steps[steps.length - 1] ?? '';
  const floor = steps.length;
  const tweak = useCard((s) => s.simTweak);
  const preview = useCard((s) => s.preview);
  const { setPreview, setSimGreeting } = useCard.getState();

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** side by side: the other device's frame (only to look at; 点选修改 works in the first) */
  const frame2Ref = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState({ w: 600, h: 500 });
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => void (previewLog.mvu = errors), [errors]);
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
  const both = !!preview.both;
  const look = useMemo(() => lookOf(preview), [preview]);
  // one device in the middle, or the phone and the computer side by side
  const devices = useDevices(stage, phone, both, look);
  const { main, other } = devices;
  const { w, h, scale } = main;
  const sim = useMemo(() => simulate(vars, steps, tweak, own), [vars, steps, tweak, own]);
  const settings = useMemo(() => previewSettings(name, preview.device, preview), [name, preview]);
  const settings2 = useMemo(() => (both ? previewSettings(name, phone ? 'desktop' : 'phone', preview) : null), [both, name, phone, preview]);
  const textBar = useCard((s) => s.project.textBar);
  const base = useCard((s) => s.project.base);
  const takeover = useCard((s) => s.project.takeover);
  // what the exported card runs in SillyTavern: the card's own regexes first, then the generated ones
  const kept = useMemo(() => keptRegexes({ base, takeover }), [base, takeover]);
  const fold = useCard((s) => s.project.settings.updateFold);
  const regexes = useMemo(
    () => previewRegexes({ id: pid, vars, bar: customBar, textBar, base, takeover, settings: { allowPlayerEdit: allowEdit, updateFold: fold } as CardProject['settings'] }, kept),
    [kept, vars, customBar, allowEdit, fold, pid, textBar, base, takeover],
  );
  const extra = useMemo(() => cardExtras({ base, card: { name } as CardProject['card'] }), [base, name]);
  // the chat's height when the page is built; later sizes reach the cards without building it again (see buildChat)
  const vhRef = useRef(0);
  vhRef.current = Math.round(h);
  const vh2Ref = useRef(0);
  vh2Ref.current = Math.round(other?.h ?? 0);
  const body = simText.trim() ? simText : floor > 1 ? '（这一条还没贴回复，数值和上一条一样）' : greeting.trim() || '（开场白）';
  /* the card's own regexes (its status bar, its beautify) can be changed right here: by clicking, or their colors */
  const [tool, setTool] = useState<'' | 'pick' | 'colors'>('');
  // MVU puts its placeholder after replies only: under a greeting the bar shows when the card writes it there itself.
  // While its look is being changed, the bar is shown anyway (as under a reply), or there would be nothing to change.
  const onGreeting = useCard((s) => barOnGreeting(s.project));
  const atStart = !simText.trim() && floor <= 1;
  const noBar = atStart && !onGreeting && !greeting.includes(PLACEHOLDER);
  const onlyLast = !!preview.onlyLast;
  // the chat: the greeting, then what the player said and each reply (or only the newest message)
  const floors = useMemo((): Floor[] => {
    if (onlyLast) return [{ text: body, ai: true, stat: sim.data, bar: !noBar || tool !== '', id: atStart ? 0 : steps.length * 2, gen: !atStart }];
    return simFloors({ greeting, barOnGreeting: onGreeting || (tool !== '' && atStart), start: sim.start ?? sim.data, replies: steps, users, after: sim.after ?? [], last: sim.data });
  }, [onlyLast, body, sim, noBar, tool, greeting, onGreeting, atStart, steps, users]);
  const chatOpts = useMemo(() => ({ ...extra, ...(onlyLast ? { prev: sim.before } : {}), bottom: true }), [extra, onlyLast, sim.before]);
  const shownFloors = useMemo(() => processFloors(regexes, floors, settings), [regexes, floors, settings]);
  // the newest message: what the regex tools look at
  const plain = shownFloors[shownFloors.length - 1];
  const [targetId, setTargetId] = useState('');
  const editable = useMemo(() => kept.filter((r) => !r.promptOnly && r.replaceString.trim()), [kept]);
  const target = editable.find((r) => r.id === targetId) ?? editable.find((r) => plain.stats[r.id]?.hits && drawsStatusBar(r)) ?? editable.find((r) => plain.stats[r.id]?.hits) ?? editable[0];
  const targetRef = useRef<string | undefined>(undefined);
  targetRef.current = target?.id;
  const why = !target ? '' : target.disabled ? '这条正则关着，打开它才看得到' : noPickReason(target.replaceString);
  const picking = tool === 'pick' && !!target && !why;
  const missed = picking && !plain.stats[target.id]?.hits;
  // 点选修改: the elements of the newest message's status bar get numbers to click
  const newest = useMemo(() => (picking && target ? regexes.map((r) => (r.id === target.id ? { ...r, replaceString: annotate(r.replaceString) } : r)) : undefined), [picking, target, regexes]);
  const [picked, setPicked] = useState<{ n: number; info: PickInfo | null } | null>(null);
  const pickRef = useRef(-1);
  useEffect(() => {
    setPicked(null);
    pickRef.current = -1;
  }, [target?.id, picking]);
  const repick = (n: number) => {
    pickRef.current = n;
    setPicked((p) => ({ n, info: p?.info ?? null }));
  };
  const saveTarget = (src: string) => {
    const id = targetRef.current;
    if (id) useCard.getState().edit((p) => updateCardRegex(p, id, { replaceString: src }), 'card-regex:' + id);
  };

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      // the libraries cards expect ($, _, z, YAML), highlight.js and SillyTavern's fonts are loaded once; without the
      // libraries the CDN copies are used
      void loadPreviewAssets().then((missing) => {
          const f = frameRef.current;
          if (!f || !live) return;
          setErrors(missing);
          f.srcdoc = previewChat(regexes, floors, settings, vhRef.current, { ...chatOpts, ...(picking ? { pick: pickRef.current } : {}) }, newest).html;
          const f2 = frame2Ref.current;
          if (f2 && settings2) f2.srcdoc = previewChat(regexes, floors, settings2, vh2Ref.current, chatOpts).html;
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [regexes, floors, newest, picking, settings, settings2, nonce, chatOpts]);

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
      // 点选修改: only from the chat page itself (it passes on what its cards tell it)
      if (!d || e.source !== frameRef.current?.contentWindow) return;
      if (d.__stp === 'pick') {
        const n = Number(d.n);
        pickRef.current = n;
        setPicked(n < 0 ? null : { n, info: (d.info as PickInfo) ?? null });
      } else if (d.__stp === 'move') {
        const id = targetRef.current;
        const r = cardRegexes(useCard.getState().project).find((x) => x.id === id);
        if (!r) return;
        const m = moveEl(r.replaceString, Number(d.n), Number(d.ref), !!d.after);
        if (!m) return setNote('只能在同一层里挪：拖到和它并排的元素之间');
        repick(m.n);
        saveTarget(m.src);
      }
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
          {noBar
            ? tool
              ? '：酒馆里这张卡的开场白下面不显示状态栏，改的时候先按回复后的样子显示'
              : '：这张卡的开场白下面不显示状态栏（「角色卡」页的「卡的设置」里可以打开），贴一段模拟回复就能看到'
            : ''}
        </span>
        <span className="sp" />
        <DeviceSwitch phone={phone} both={both} onChange={setPreview} />
      </div>
      <div className="preview-sub">
        <ScreenPickers d={devices} phone={phone} both={both} />
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
        {(steps.length > 1 || simText.trim() !== '') && (
          <select className="small-select" value={onlyLast ? 'last' : 'all'} onChange={(e) => setPreview({ onlyLast: e.target.value === 'last' })} title="预览里显示整段聊天（开场白、玩家的话、每条模拟回复），还是只看最新一条">
            <option value="all">整段聊天（{1 + steps.length * 2} 楼）</option>
            <option value="last">只看最新一条</option>
          </select>
        )}
        <LookSelect value={preview} onChange={setPreview} />
        <button className="small" onClick={() => setNonce((n) => n + 1)} title="重新渲染">
          刷新
        </button>
      </div>
      {editable.length > 0 && (
        <div className="preview-sub card-regex-tools">
          <span className="hint">卡自带的美化：</span>
          {editable.length > 1 && (
            <select className="small-select" value={target?.id} onChange={(e) => setTargetId(e.target.value)} title="改哪一条（卡自带的正则）">
              {editable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.scriptName}
                  {drawsStatusBar(r) ? '（状态栏）' : ''}
                  {plain.stats[r.id]?.hits ? '' : '（这里没用上）'}
                </option>
              ))}
            </select>
          )}
          {editable.length === 1 && <span className="hint">「{target?.scriptName}」</span>}
          <button className={'small pick-toggle' + (tool === 'pick' ? ' on' : '')} onClick={() => setTool((t) => (t === 'pick' ? '' : 'pick'))} title="点预览里的元素，直接改它的颜色、字号、文字、边距和形状，改动写回卡自己的正则">
            ✎ 点选修改
          </button>
          <button className={'small pick-toggle' + (tool === 'colors' ? ' on' : '')} onClick={() => setTool((t) => (t === 'colors' ? '' : 'colors'))} title="列出这条正则用到的颜色，逐个换或者整体换色">
            🎨 换配色
          </button>
        </div>
      )}
      {tool === 'colors' && target && <ColorsPanel src={target.replaceString} onChange={saveTarget} onClose={() => setTool('')} where={`「${target.scriptName}」`} />}
      <OwnBarNote />
      <div className="stage" ref={stageRef}>
        <div className={'device ' + (phone ? 'phone' : 'desktop')} style={{ width: w, height: h, top: PAD, left: main.x, transform: `translateX(-50%) scale(${scale})` }}>
          <iframe ref={frameRef} title="预览" sandbox="allow-scripts allow-popups allow-forms allow-modals" />
        </div>
        {other && (
          <div className={'device ' + (phone ? 'desktop' : 'phone')} style={{ width: other.w, height: other.h, top: PAD, left: other.x, transform: `translateX(-50%) scale(${other.scale})` }}>
            <iframe ref={frame2Ref} title={phone ? '电脑上的样子' : '手机上的样子'} sandbox="allow-scripts allow-popups allow-forms allow-modals" />
          </div>
        )}
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
      {tool === 'pick' && target && (why || missed || !picked) && (
        <div className="pick-hint">
          {why ||
            (missed
              ? `「${target.scriptName}」在这条消息里没匹配到，换一条开场白或模拟回复试试`
              : `点预览里的元素来修改「${target.scriptName}」；按住元素拖动能换位置；按住 Alt 点击就是平常的点（切页、展开）`)}
        </div>
      )}
      {picking && picked && target && (
        <PickPanel
          src={target.replaceString}
          n={picked.n}
          info={picked.info}
          onChange={(src, n) => {
            if (n !== undefined) repick(n);
            saveTarget(src);
          }}
          onSelect={(n) => frameRef.current?.contentWindow?.postMessage({ __stp: 'sel', n }, '*')}
          onClose={() => {
            repick(-1);
            setPicked(null);
            frameRef.current?.contentWindow?.postMessage({ __stp: 'sel', n: -1 }, '*');
          }}
        />
      )}
      {!picking && <TweakPanel />}
      {!picking && <SimPanel />}
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
  const builder = useCard((s) => !!s.builder);
  if (tab !== 'bar' || plain || builder) return null;
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
  const userText = useCard((s) => s.simUsers[s.simAt] ?? '');
  const { setSimText, setSimUser, setSimAt, addSimStep, removeSimStep, clearSim } = useCard.getState();
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
          <label className="sim-user" title="聊天预览里这条回复前面玩家说的话（只在预览里显示，不影响变量）">
            玩家说
            <input value={userText} placeholder={`不写就显示「${USER_STAND_IN}」`} onChange={(e) => setSimUser(e.target.value)} />
          </label>
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
  const { setSimTweak, addSimTweaks, clearSimTweak } = useCard.getState();
  const sim = useSim();
  const [open, setOpen] = useState(false);
  const list = useMemo(() => tweakable(vars), [vars]);
  // tables can't be changed here, only emptied (一键：列表表格清空)
  const emptied = useMemo(() => leaves(vars, true).filter((l) => l.v.kind === 'table' && l.v.id in tweak), [vars, tweak]);
  const changed = list.filter((t) => t.v.id in tweak).length + emptied.length;
  const tables = useMemo(() => countTables(vars), [vars]);
  const extremes = useMemo(() => EXTREMES.map((e) => ({ ...e, values: extremeTweak(vars, e.key) })).filter((e) => Object.keys(e.values).length), [vars]);
  return (
    <div className={'sim tweak' + (open ? ' open' : '')}>
      <button className="sim-head" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} 试试不同数值
        <span className="hint">{changed ? `　手动改了 ${changed} 个，只在这里看看，不会存进卡里` : '　拖一拖，看状态栏在别的数值下是什么样'}</span>
      </button>
      {open && (
        <div className="sim-body">
          {!list.length && <div className="hint">还没有能改的变量。</div>}
          {extremes.length > 0 && (
            <div className="inline tw-extremes">
              <span className="hint">一键试试：</span>
              {extremes.map((e) => (
                <button key={e.key} className="small" title={e.title + '，看状态栏会不会撑坏'} onClick={() => addSimTweaks(e.values)}>
                  {e.label}
                </button>
              ))}
            </div>
          )}
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
            {emptied.map((t) => (
              <div key={t.v.id} className="tw-row on">
                <span className="tw-name" title={t.label}>
                  {t.label}
                </span>
                <span className="hint">清空了</span>
                <button className="xbtn" title="回到原来的内容" onClick={() => setSimTweak(t.v.id, undefined)}>
                  ↺
                </button>
              </div>
            ))}
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
