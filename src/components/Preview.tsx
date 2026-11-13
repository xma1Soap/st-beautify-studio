import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { previewLog } from '../ai/mode';
import { useStore } from '../store';
import { buildChat, emptyPage } from '../lib/render';
import { loadPreviewAssets } from '../lib/previewAssets';
import { processText, type Processed } from '../lib/engine';
import { isBuilt } from '../lib/builder';
import { isPanel } from '../lib/panel';
import { annotate, moveEl, noPickReason } from '../lib/htmlEdit';
import type { RegexScript } from '../lib/types';
import { fitDevice, LookSelect, PAD, ScreenSelect, useScreen } from './device';
import { lookOf } from '../lib/stThemes';
import { PickPanel, type PickInfo } from './PickPanel';

/** Why the selected regex can't be changed by clicking the preview ('' when it can). */
function cantPick(s: RegexScript | undefined): string {
  if (!s) return '先在左边选一条正则';
  if (isBuilt(s.replaceString)) return '这条是在画布上做的，去画布上改';
  if (isPanel(s.replaceString)) return '这条是解析型面板：分段、规则和颜色在「替换内容」里改';
  if (s.disabled) return '这条正则关着，打开它才看得到';
  return noPickReason(s.replaceString);
}

export function Preview({ processed }: { processed: Processed }) {
  const settings = useStore((s) => s.project.settings);
  const hasText = useStore((s) => !!s.project.testText.trim());
  const scriptCount = useStore((s) => s.project.scripts.length);
  const previewTab = useStore((s) => s.previewTab);
  const scripts = useStore((s) => s.project.scripts);
  const testText = useStore((s) => s.project.testText);
  const selectedId = useStore((s) => s.selectedId);
  const { setPreviewTab, setSettings } = useStore.getState();
  const sel = scripts.find((s) => s.id === selectedId);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 600 });
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => void (previewLog.regex = errors), [errors]);
  const [blocked, setBlocked] = useState<string[]>([]);

  /* 点选修改: the selected regex's elements are numbered in the preview, so a click leads back to the code */
  const [pickOn, setPickOn] = useState(false);
  const why = cantPick(sel);
  const picking = pickOn && !why && previewTab === 'render';
  const missed = picking && sel ? !processed.stats[sel.id]?.hits : false;
  const shown = useMemo(
    () => (picking && sel ? processText(scripts.map((s) => (s.id === sel.id ? { ...s, replaceString: annotate(s.replaceString) } : s)), testText, settings) : processed),
    [picking, sel, scripts, testText, settings, processed],
  );
  const [pick, setPick] = useState<{ n: number; info: PickInfo | null } | null>(null);
  /** the picked element's number, for the next page build */
  const pickRef = useRef(-1);
  useEffect(() => {
    setPick(null);
    pickRef.current = -1;
  }, [selectedId, picking]);
  const repick = (n: number) => {
    pickRef.current = n;
    setPick((p) => ({ n, info: p?.info ?? null }));
  };

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* logical screen size, then scale it down if the panel is smaller */
  const phone = settings.device === 'phone';
  const [screen, setScreen] = useScreen(phone);
  const look = useMemo(() => lookOf(settings), [settings]);
  const { w, h, scale } = fitDevice(stage, phone, screen, look);
  // the chat's height when the page is built; later sizes reach the cards without building it again (see buildChat)
  const vhRef = useRef(0);
  vhRef.current = Math.round(h);

  /* rebuild the page a moment after edits stop */
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const f = frameRef.current;
      if (!f) return;
      setErrors([]);
      if (!hasText) {
        setBlocked([]);
        f.srcdoc = emptyPage(scriptCount ? '去「测试消息」写一段 AI 回复，或点「按全部正则生成示例」' : '先新建或导入一条正则', settings);
        return;
      }
      // front-end cards get jQuery, lodash, zod and YAML like in TavernHelper; code blocks highlight.js; the chat
      // SillyTavern's fonts (loaded once, then kept)
      void loadPreviewAssets().then((missing) => {
          if (!live) return;
          if (missing.length) setErrors(missing);
          const page = buildChat(shown.display, shown.raw, settings, vhRef.current, picking ? { pick: pickRef.current } : {});
          setBlocked(page.blocked);
          f.srcdoc = page.html;
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // a new size isn't a reason to build the page again: the chat page tells its cards (like TavernHelper on resize)
  }, [shown, picking, settings, hasText, scriptCount, nonce]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.__stp === 'err') setErrors((l) => (l.length >= 30 || l.includes(d.msg) ? l : [...l, d.msg]));
      // from the page itself (the click-to-edit script), not from a card inside it
      if (!d || e.source !== frameRef.current?.contentWindow) return;
      if (d.__stp === 'pick') {
        const n = Number(d.n);
        pickRef.current = n;
        setPick(n < 0 ? null : { n, info: (d.info as PickInfo) ?? null });
      } else if (d.__stp === 'move') {
        const st = useStore.getState();
        const s = st.project.scripts.find((x) => x.id === st.selectedId);
        if (!s) return;
        const r = moveEl(s.replaceString, Number(d.n), Number(d.ref), !!d.after);
        if (!r) return st.notify('只能在同一层里挪：拖到和它并排的元素之间');
        repick(r.n);
        st.updateScript(s.id, { replaceString: r.src });
      }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);

  return (
    <section className="preview">
      <div className="panel-head tabs">
        <button className={'tab' + (previewTab === 'render' ? ' on' : '')} onClick={() => setPreviewTab('render')}>渲染效果</button>
        <button className={'tab' + (previewTab === 'text' ? ' on' : '')} onClick={() => setPreviewTab('text')}>替换后文本</button>
        <span className="sp" />
        {previewTab === 'render' && (
          <button className={'small pick-toggle' + (pickOn ? ' on' : '')} onClick={() => setPickOn((o) => !o)} title="点预览里的元素，直接改它的颜色、字号、文字、边距和形状">
            ✎ 点选修改
          </button>
        )}
        <div className="seg" role="group" aria-label="预览设备">
          <button className={phone ? 'on' : ''} onClick={() => setSettings({ device: 'phone' })}>📱 手机</button>
          <button className={!phone ? 'on' : ''} onClick={() => setSettings({ device: 'desktop' })}>🖥 电脑</button>
        </div>
      </div>
      <div className="preview-sub">
        <ScreenSelect phone={phone} value={screen} onChange={setScreen} />
        <span className="hint">{Math.round(w)} × {Math.round(h)}{scale < 0.999 ? ` · 缩放 ${Math.round(scale * 100)}%` : ''}</span>
        <span className="sp" />
        <label className="chk" title="酒馆默认开启「禁止外部媒体」：消息里的外链图片、样式里的 http 链接都会被去掉，需要用户给这个角色单独放行"><input type="checkbox" checked={settings.blockExternalMedia} onChange={(e) => setSettings({ blockExternalMedia: e.target.checked })} />拦截外链（酒馆默认）</label>
        <label className="chk" title="酒馆「用户设置」里的「自动修复 Markdown」：一行里 * 或 &quot; 没配对时，在行尾补一个。新装的酒馆默认是关的，开了它的玩家看到的会不一样"><input type="checkbox" checked={!!settings.fixMarkdown} onChange={(e) => setSettings({ fixMarkdown: e.target.checked })} />自动修复 Markdown</label>
        <label className="chk"><input type="checkbox" checked={settings.frontend} onChange={(e) => setSettings({ frontend: e.target.checked })} />渲染前端卡（```html）</label>
        <LookSelect value={settings} onChange={setSettings} />
        <button className="small" onClick={() => setNonce((n) => n + 1)} title="重新渲染，卡片脚本会重置">刷新</button>
      </div>
      <div className="stage" ref={stageRef} hidden={previewTab !== 'render'}>
        <div
          className={'device ' + (phone ? 'phone' : 'desktop')}
          style={{ width: w, height: h, top: PAD, transform: `translateX(-50%) scale(${scale})` }}
        >
          {/* no allow-same-origin: card scripts can't reach the tool's saved projects or the desktop shell.
              Cards talk to the chat page by postMessage; localStorage is swapped for an in-memory stand-in. */}
          <iframe
            ref={frameRef}
            title="预览"
            sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads"
          />
        </div>
      </div>
      {pickOn && previewTab === 'render' && (why || missed || !pick) && (
        <div className="pick-hint">
          {why ||
            (missed
              ? '这条正则在测试消息里没匹配到，先让它匹配上才有东西可点'
              : `点预览里的元素来修改「${sel?.scriptName}」；按住元素拖动能换位置；按住 Alt 点击就是平常的点（切页、展开折叠）`)}
        </div>
      )}
      {picking && pick && sel && (
        <PickPanel
          src={sel.replaceString}
          n={pick.n}
          info={pick.info}
          onChange={(src, n) => {
            if (n !== undefined) repick(n);
            useStore.getState().updateScript(sel.id, { replaceString: src });
          }}
          onSelect={(n) => frameRef.current?.contentWindow?.postMessage({ __stp: 'sel', n }, '*')}
          onClose={() => {
            repick(-1);
            setPick(null);
            frameRef.current?.contentWindow?.postMessage({ __stp: 'sel', n: -1 }, '*');
          }}
        />
      )}
      {previewTab === 'text' && <pre className="out-text">{processed.display || '（空）'}</pre>}
      {blocked.length > 0 && previewTab === 'render' && (
        <div className="warn-log">
          <div>酒馆默认会拦下这些外链，用户看不到：</div>
          {blocked.slice(0, 8).map((u, i) => <div key={i} className="mono">{u.length > 120 ? u.slice(0, 120) + '…' : u}</div>)}
          {blocked.length > 8 && <div>……还有 {blocked.length - 8} 个</div>}
          <div className="hint">解决办法：把图片内嵌进美化，或者提醒用户在酒馆里给这个角色放行外部媒体。</div>
        </div>
      )}
      {errors.length > 0 && previewTab === 'render' && (
        <div className="err-log">
          {errors.map((m, i) => <div key={i}>⚠ {m}</div>)}
          <div className="hint">卡片脚本报错。用到酒馆助手 / MVU 接口的卡片在这里只有简单模拟，报错不一定是正则的问题。</div>
        </div>
      )}
    </section>
  );
}
