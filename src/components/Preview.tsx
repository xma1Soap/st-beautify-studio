import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { buildChat, emptyPage } from '../lib/render';
import type { Processed } from '../lib/engine';

const PHONES = [
  { w: 360, h: 780, label: '360 宽' },
  { w: 390, h: 844, label: '390 宽' },
  { w: 430, h: 932, label: '430 宽' },
];
const DESKTOP_MAX = 1000;
const DESKTOP_MIN = 480;
const PAD = 24;

export function Preview({ processed }: { processed: Processed }) {
  const settings = useStore((s) => s.project.settings);
  const hasText = useStore((s) => !!s.project.testText.trim());
  const scriptCount = useStore((s) => s.project.scripts.length);
  const previewTab = useStore((s) => s.previewTab);
  const { setPreviewTab, setSettings } = useStore.getState();

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 600 });
  const [phoneIdx, setPhoneIdx] = useState(() => Number(localStorage.getItem('stbs-phone') ?? 1) || 0);
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* logical screen size, then scale it down if the panel is smaller */
  const phone = settings.device === 'phone';
  const p = PHONES[phoneIdx] || PHONES[1];
  const availW = Math.max(stage.w - PAD * 2, 100);
  const availH = Math.max(stage.h - PAD * 2, 100);
  let w: number, h: number, scale: number;
  if (phone) {
    const bezel = 20;
    w = p.w; h = p.h;
    scale = Math.min(1, availW / (w + bezel), availH / (h + bezel));
  } else {
    w = Math.max(DESKTOP_MIN, Math.min(DESKTOP_MAX, availW));
    scale = Math.min(1, availW / w);
    h = availH / scale;
  }

  /* rebuild the page a moment after edits stop */
  useEffect(() => {
    const t = setTimeout(() => {
      const f = frameRef.current;
      if (!f) return;
      setErrors([]);
      f.srcdoc = !hasText
        ? emptyPage(scriptCount ? '去「测试消息」写一段 AI 回复，或点「按全部正则生成示例」' : '先新建或导入一条正则', settings)
        : buildChat(processed.display, processed.raw, settings, Math.round(h));
    }, 300);
    return () => clearTimeout(t);
    // h only matters in whole pixels; avoid rebuilding on sub-pixel resize noise
  }, [processed, settings, hasText, scriptCount, nonce, Math.round(h / 20)]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.__stp === 'err') setErrors((l) => (l.length >= 30 || l.includes(d.msg) ? l : [...l, d.msg]));
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);

  const pickPhone = (i: number) => { setPhoneIdx(i); try { localStorage.setItem('stbs-phone', String(i)); } catch {} };

  return (
    <section className="preview">
      <div className="panel-head tabs">
        <button className={'tab' + (previewTab === 'render' ? ' on' : '')} onClick={() => setPreviewTab('render')}>渲染效果</button>
        <button className={'tab' + (previewTab === 'text' ? ' on' : '')} onClick={() => setPreviewTab('text')}>替换后文本</button>
        <span className="sp" />
        <div className="seg" role="group" aria-label="预览设备">
          <button className={phone ? 'on' : ''} onClick={() => setSettings({ device: 'phone' })}>📱 手机</button>
          <button className={!phone ? 'on' : ''} onClick={() => setSettings({ device: 'desktop' })}>🖥 电脑</button>
        </div>
      </div>
      <div className="preview-sub">
        {phone && (
          <select className="small-select" value={phoneIdx} onChange={(e) => pickPhone(Number(e.target.value))} title="手机屏幕宽度">
            {PHONES.map((ph, i) => <option key={i} value={i}>{ph.label}</option>)}
          </select>
        )}
        <span className="hint">{Math.round(w)} × {Math.round(h)}{scale < 0.999 ? ` · 缩放 ${Math.round(scale * 100)}%` : ''}</span>
        <span className="sp" />
        <label className="chk"><input type="checkbox" checked={settings.frontend} onChange={(e) => setSettings({ frontend: e.target.checked })} />渲染前端卡（```html）</label>
        <select className="small-select" value={settings.chatTheme} onChange={(e) => setSettings({ chatTheme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">暗色聊天</option><option value="light">亮色聊天</option>
        </select>
        <button className="small" onClick={() => setNonce((n) => n + 1)} title="重新渲染，卡片脚本会重置">刷新</button>
      </div>
      <div className="stage" ref={stageRef} hidden={previewTab !== 'render'}>
        <div
          className={'device ' + (phone ? 'phone' : 'desktop')}
          style={{ width: w, height: h, top: PAD, transform: `translateX(-50%) scale(${scale})` }}
        >
          {/* same-origin like real SillyTavern, so cards that touch window.parent still run */}
          <iframe
            ref={frameRef}
            title="预览"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads"
          />
        </div>
      </div>
      {previewTab === 'text' && <pre className="out-text">{processed.display || '（空）'}</pre>}
      {errors.length > 0 && previewTab === 'render' && (
        <div className="err-log">
          {errors.map((m, i) => <div key={i}>⚠ {m}</div>)}
          <div className="hint">卡片脚本报错。用到酒馆助手 / MVU 接口的卡片在这里只有简单模拟，报错不一定是正则的问题。</div>
        </div>
      )}
    </section>
  );
}
