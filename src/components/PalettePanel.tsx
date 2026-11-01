// 换配色 for one regex: its colors as swatches to change one by one, and every hue turned at once — to a preset
// color or by a slider — plus switching dark and light. Works on front-end cards too: it only rewrites colors.
import { useEffect, useRef, useState } from 'react';
import { adjustColors, palette, swapColor, turnTo } from '../lib/palette';
import { useStore } from '../store';
import type { RegexScript } from '../lib/types';

const PRESETS = [
  { label: '赤', hue: 0 },
  { label: '橙', hue: 25 },
  { label: '金', hue: 45 },
  { label: '绿', hue: 140 },
  { label: '青', hue: 180 },
  { label: '蓝', hue: 212 },
  { label: '紫', hue: 265 },
  { label: '粉', hue: 330 },
];

export function PalettePanel({ script, onClose }: { script: RegexScript; onClose: () => void }) {
  const update = useStore((s) => s.updateScript);
  const src = script.replaceString;
  /** the slider and the dark/light switch work from the code as it was when they were first touched */
  const [base, setBase] = useState(src);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [invert, setInvert] = useState(false);
  const written = useRef(src);
  // the code changed some other way (typed, undone, a swatch): start from it
  useEffect(() => {
    if (src === written.current) return;
    written.current = src;
    setBase(src);
    setHue(0);
    setSat(1);
    setInvert(false);
  }, [src]);

  const apply = (o: { hue?: number; sat?: number; invert?: boolean }) => {
    const next = { hue, sat, invert, ...o };
    setHue(next.hue);
    setSat(next.sat);
    setInvert(next.invert);
    const out = adjustColors(base, next);
    written.current = out;
    if (out !== src) update(script.id, { replaceString: out });
  };
  const swap = (from: string, to: string) => update(script.id, { replaceString: swapColor(src, from, to) });

  const colors = palette(src);
  if (!colors.length)
    return (
      <div className="palette-panel">
        <div className="palette-head">
          <b>换配色</b>
          <span className="hint">这条正则的代码里没写颜色（可能都在别处的 CSS 里）。</span>
          <span className="sp" />
          <button className="small" onClick={onClose}>✕</button>
        </div>
      </div>
    );

  return (
    <div className="palette-panel">
      <div className="palette-head">
        <b>换配色</b>
        <span className="hint">代码里的 {colors.length} 种颜色，前端卡片里的也算</span>
        <span className="sp" />
        <button className="small" onClick={onClose} title="收起">✕</button>
      </div>
      <div className="palette-row">
        <span className="pick-label">逐个换</span>
        <div className="swatches">
          {colors.slice(0, 32).map((c, i) => (
            <label key={i} className="swatch" style={{ background: c.key }} title={`${c.key} · 用了 ${c.count} 次，点一下换`}>
              <input type="color" value={c.key} onChange={(e) => swap(c.key, e.target.value)} />
            </label>
          ))}
          {colors.length > 32 && <span className="hint">……还有 {colors.length - 32} 种</span>}
        </div>
      </div>
      <div className="palette-row">
        <span className="pick-label">整体换成</span>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.hue} className="small hue-chip" onClick={() => apply({ hue: turnTo(base, p.hue) })} title={`把主色转到${p.label}色，其他颜色跟着一起转`}>
              <i style={{ background: `hsl(${p.hue} 70% 55%)` }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="palette-row">
        <span className="pick-label">色相</span>
        <input type="range" min={-180} max={180} value={Math.round(hue)} onChange={(e) => apply({ hue: Number(e.target.value) })} />
        <span className="hint">{Math.round(hue)}°</span>
      </div>
      <div className="palette-row">
        <span className="pick-label">鲜艳度</span>
        <input type="range" min={0} max={200} value={Math.round(sat * 100)} onChange={(e) => apply({ sat: Number(e.target.value) / 100 })} />
        <span className="hint">{Math.round(sat * 100)}%</span>
      </div>
      <div className="palette-row">
        <span className="pick-label" />
        <label className="chk">
          <input type="checkbox" checked={invert} onChange={(e) => apply({ invert: e.target.checked })} />
          亮暗反转（暗色美化变亮色，反过来也行）
        </label>
      </div>
      <div className="hint">灰色、黑白不跟着转色相。改完不满意可以撤销。颜色要是写在别的正则或角色卡的 CSS 里，这里改不到。</div>
    </div>
  );
}
