// 新手引导: the first time the MVU card page opens, a few steps point at where things are (variables, status bar,
// preview, card, export). Shown once (remembered on this computer); the ？ button in the top bar shows it again.
import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';
import { useCard, type CardTab } from '../cardStore';

const DONE_KEY = 'stbs-tour-done';

interface Step {
  /** where it points (nothing found: the bubble sits in the middle) */
  at: () => Element | null;
  title: string;
  text: string;
  /** the page to show for it */
  tab?: CardTab;
}

const byText = (sel: string, text: string) => [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text) ?? null;

const STEPS: Step[] = [
  {
    at: () => document.querySelector('.var-panel'),
    title: '① 先定好变量',
    text: '左边是变量：好感度、心情、地点、物品栏……点上面的「数字」「文字」这些按钮加一个，或者点「＋ 模板」一下加一组现成的。每个变量写清楚「什么时候变」，工坊会整理成给 AI 的规则。',
    tab: 'vars',
  },
  {
    at: () => byText('.editor .tabs .tab', '状态栏'),
    title: '② 摆状态栏',
    text: '「状态栏」页里把组件（卡片、进度条、按钮……）拖到右边画布上，点中哪个就改哪个的颜色、大小、样子。不想摆的话，工坊会按变量自动排好。',
    tab: 'bar',
  },
  {
    at: () => document.querySelector('.bar-canvas, .mvu-preview'),
    title: '③ 右边就是酒馆里的样子',
    text: '右边的画布和预览按真酒馆的样子画（主题、字号、手机电脑都能选）。下面「模拟 AI 回复」贴一段回复，就能看到变量怎么变、状态栏怎么跟着变。',
    tab: 'bar',
  },
  {
    at: () => byText('.editor .tabs .tab', '角色卡'),
    title: '④ 写角色卡',
    text: '「角色卡」页填名字、放头像、写开场白；「卡的设置」里能决定玩家能不能改变量、开场白下面显示不显示状态栏。',
    tab: 'card',
  },
  {
    at: () => byText('.topbar button', '导出角色卡'),
    title: '⑤ 导出',
    text: '做好了点这里，得到一张 PNG 角色卡，在酒馆「导入角色」里直接用（要装酒馆助手）。世界书、正则、脚本都已经写进去了。记得也点「保存」存一份工程，以后接着改。',
  },
  {
    at: () => document.querySelector('.level-switch'),
    title: '⑥ 还有',
    text: '「简易 / 进阶」切换显示多少设置；旁边的「✦ AI 助手」能用说话的方式帮你改。想再看一遍这个引导，点顶栏的「？」。',
  },
];

export const useTour = create<{ step: number | null; open: () => void; close: () => void; go: (i: number) => void }>((set) => ({
  step: null,
  open: () => set({ step: 0 }),
  close: () => {
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      /* fine */
    }
    set({ step: null });
  },
  go: (i) => set({ step: i }),
}));

/** Opens the guide on a first visit. */
export function useFirstTour() {
  useEffect(() => {
    let seen = false;
    try {
      seen = !!localStorage.getItem(DONE_KEY);
    } catch {
      seen = true;
    }
    // (not when it was opened by hand meanwhile)
    if (!seen) setTimeout(() => useTour.getState().step === null && useTour.getState().open(), 600);
  }, []);
}

export function TourButton() {
  return (
    <button className="ghost tour-btn" onClick={() => useTour.getState().open()} title="新手引导：带你认一遍这个页面">
      ？
    </button>
  );
}

export function Tour() {
  const step = useTour((t) => t.step);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = step === null ? null : STEPS[step];
  useEffect(() => {
    if (s?.tab) useCard.getState().setTab(s.tab);
  }, [s]);
  useLayoutEffect(() => {
    if (!s) return;
    let live = true;
    // follow the spot while the page settles (a tab switching, panels resizing)
    const track = () => {
      if (!live) return;
      const e = s.at();
      setRect(e ? e.getBoundingClientRect() : null);
      setTimeout(track, 250);
    };
    track();
    return () => {
      live = false;
    };
  }, [s]);
  useEffect(() => {
    if (step === null) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useTour.getState().close();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [step]);
  if (!s || step === null) return null;
  const last = step === STEPS.length - 1;
  // the bubble: under the spot when there is room, else above it, else beside it; inside the window
  const W = 340;
  const vw = innerWidth;
  const vh = innerHeight;
  let left = vw / 2 - W / 2;
  let top = vh / 2 - 90;
  if (rect) {
    left = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), vw - W - 12);
    if (rect.bottom + 200 < vh) top = rect.bottom + 12;
    else if (rect.top - 200 > 0) top = rect.top - 200;
    else {
      top = Math.min(Math.max(12, rect.top + 20), vh - 220);
      left = rect.right + W + 24 < vw ? rect.right + 12 : Math.max(12, rect.left - W - 12);
    }
  }
  return (
    <div className="tour" role="dialog" aria-label="新手引导">
      {rect ? <div className="tour-spot" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="tour-veil" />}
      <div className="tour-bubble" style={{ left, top, width: W }}>
        <div className="tour-title">{s.title}</div>
        <div className="tour-text">{s.text}</div>
        <div className="inline">
          <span className="hint">
            {step + 1} / {STEPS.length}
          </span>
          <span className="sp" />
          <button className="small" onClick={() => useTour.getState().close()}>
            跳过
          </button>
          {step > 0 && (
            <button className="small" onClick={() => useTour.getState().go(step - 1)}>
              上一步
            </button>
          )}
          <button className="small primary" onClick={() => (last ? useTour.getState().close() : useTour.getState().go(step + 1))}>
            {last ? '知道了' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
