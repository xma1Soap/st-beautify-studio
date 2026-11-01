// Changing the element picked in the preview: how it looks (its own style=""), its text, and its place among the
// elements next to it. Every change goes straight into the regex's code.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getStyle, leafText, moveEl, parseTags, pickable, setLeafText, setStyle, siblings, toHex } from '../lib/htmlEdit';
import { fillClip, SHAPE_DEPTH, SHAPE_PRESETS } from '../mvu/shape';
import { ShapeThumb } from './mvu/ShapeFields';

/** How the element looks in the preview right now (what the browser worked out). */
export interface PickInfo {
  tag: string;
  text: string;
  color: string;
  bg: string;
  bgImage: string;
  fontSize: string;
  fontWeight: string;
  padding: string;
  margin: string;
  radius: string;
  border: string;
  clip: string;
}

const RADII = [
  { label: '方角', v: '0' },
  { label: '圆角', v: '12px' },
  { label: '胶囊', v: '999px' },
  { label: '圆形', v: '50%' },
];
const SHAPES = SHAPE_PRESETS.map((p) => ({ ...p, clip: fillClip(p.make(SHAPE_DEPTH), 0) }));

/** A text box that keeps what is typed even while the code under it is rewritten. */
function TextBox({ value, onCommit, placeholder, multiline, live }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean; live?: boolean }) {
  const [v, setV] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    setV(value);
  }, [value]);
  const commit = (x: string) => {
    if (x === last.current) return;
    last.current = x;
    onCommit(x);
  };
  const props = {
    value: v,
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      setV(e.target.value);
      if (live) commit(e.target.value);
    },
    onBlur: () => commit(v),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) {
        e.preventDefault();
        commit(v);
      }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="pick-row">
    <span className="pick-label">{label}</span>
    <div className="pick-ctl">{children}</div>
  </div>
);

const seeThrough = (c: string | undefined) => !c || c === 'transparent' || /rgba\([^)]*[,/]\s*0\s*\)$/.test(c);

/** Color: the box to pick one, and the value as written (empty = what the code's CSS gives it). */
function ColorRow({ label, own, shown, onChange }: { label: string; own: string | undefined; shown: string | undefined; onChange: (v: string) => void }) {
  const now = seeThrough(shown) ? '透明' : shown;
  return (
    <Row label={label}>
      <input type="color" value={toHex(own) || toHex(shown) || '#000000'} onChange={(e) => onChange(e.target.value)} title="点一下换颜色" />
      <TextBox value={own ?? ''} placeholder={now ? '现在：' + now : '没设'} onCommit={onChange} />
    </Row>
  );
}

export function PickPanel({
  src,
  n,
  info,
  onChange,
  onSelect,
  onClose,
}: {
  src: string;
  n: number;
  info: PickInfo | null;
  /** new code (and the element's new number, when it moved) */
  onChange: (src: string, n?: number) => void;
  /** pick another element without changing the code */
  onSelect: (n: number) => void;
  onClose: () => void;
}) {
  const els = parseTags(src);
  const el = els[n];
  if (!el) return null;
  const own = getStyle(src, n);
  const text = leafText(src, n);
  const sib = siblings(src, n);
  let up = el.parent;
  while (up >= 0 && !pickable(els[up])) up = els[up].parent;
  const set = (patch: Record<string, string | undefined>) => onChange(setStyle(src, n, patch));
  const move = (ref: number | undefined, after: boolean) => {
    if (ref === undefined) return;
    const r = moveEl(src, n, ref, after);
    if (r) onChange(r.src, r.n);
  };
  const size = parseFloat(own['font-size'] ?? info?.fontSize ?? '');
  const weight = own['font-weight'] ?? info?.fontWeight ?? '';
  const bold = weight === 'bold' || weight === 'bolder' || parseInt(weight) >= 600;
  const radius = own['border-radius'];
  const clip = own['clip-path'];

  return (
    <div className="pick-panel">
      <div className="pick-head">
        <code>&lt;{el.name}&gt;</code>
        <span className="pick-text">{info?.text}</span>
        <span className="sp" />
        <button className="small" disabled={up < 0} onClick={() => onSelect(up)} title="选中包住它的那一层">外层</button>
        <button className="small" disabled={sib.prev === undefined} onClick={() => move(sib.prev, false)} title="和前一个换位置">↑</button>
        <button className="small" disabled={sib.next === undefined} onClick={() => move(sib.next, true)} title="和后一个换位置">↓</button>
        <button className="small" onClick={onClose} title="取消选中">✕</button>
      </div>
      <div className="pick-body" key={n}>
        {text !== null && (
          <Row label="文字">
            <TextBox value={text} multiline live onCommit={(t) => onChange(setLeafText(src, n, t))} />
          </Row>
        )}
        <ColorRow label="文字颜色" own={own.color} shown={info?.color} onChange={(v) => set({ color: v })} />
        <ColorRow
          label="背景"
          own={own.background ?? own['background-color']}
          shown={info?.bgImage && info.bgImage !== 'none' ? info.bgImage : info?.bg}
          onChange={(v) => set({ background: v, 'background-color': undefined })}
        />
        <Row label="字号">
          <input
            type="number"
            min={6}
            max={120}
            value={Number.isFinite(size) ? Math.round(size * 10) / 10 : ''}
            onChange={(e) => set({ 'font-size': e.target.value ? e.target.value + 'px' : undefined })}
          />
          <span className="hint">px</span>
          <label className="chk">
            <input type="checkbox" checked={bold} onChange={(e) => set({ 'font-weight': e.target.checked ? 'bold' : 'normal' })} />
            加粗
          </label>
        </Row>
        <Row label="内边距">
          <TextBox value={own.padding ?? ''} placeholder={info ? '现在：' + info.padding : ''} onCommit={(v) => set({ padding: v })} />
        </Row>
        <Row label="外边距">
          <TextBox value={own.margin ?? ''} placeholder={info ? '现在：' + info.margin : ''} onCommit={(v) => set({ margin: v })} />
        </Row>
        <Row label="边框">
          <TextBox value={own.border ?? ''} placeholder={info ? '现在：' + info.border : '例如 1px solid #888'} onCommit={(v) => set({ border: v })} />
        </Row>
        <Row label="圆角">
          <div className="chips">
            {RADII.map((r) => (
              <button key={r.v} className={'small' + (radius === r.v ? ' on' : '')} onClick={() => set({ 'border-radius': radius === r.v ? undefined : r.v })}>
                {r.label}
              </button>
            ))}
          </div>
          <TextBox value={radius ?? ''} placeholder={info ? '现在：' + info.radius : ''} onCommit={(v) => set({ 'border-radius': v })} />
        </Row>
        <Row label="形状">
          <div className="chips shape-chips">
            <button className={'small shape-chip' + (!clip ? ' on' : '')} onClick={() => set({ 'clip-path': undefined })}>
              <svg className="shape-thumb" viewBox="-4 -4 128 56" aria-hidden>
                <rect x="0" y="0" width="120" height="48" rx="8" />
              </svg>
              不切
            </button>
            {SHAPES.map((p) => (
              <button key={p.key} className={'small shape-chip' + (clip === p.clip ? ' on' : '')} onClick={() => set({ 'clip-path': p.clip })}>
                <ShapeThumb pts={p.make(SHAPE_DEPTH)} />
                {p.label}
              </button>
            ))}
          </div>
        </Row>
        <div className="hint">改动直接写进这条正则的代码（元素自己的 style），可以撤销。按住元素上下拖能换位置。空着的框 = 用代码里原来的样式。</div>
      </div>
    </div>
  );
}
