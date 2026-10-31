// Inputs for the status bar settings: colors (theme colors, any color, see-through), gradients, sliders, segmented buttons.
import { useState } from 'react';
import { THEME_COLOR_LABEL, THEME_COLORS, type BarTheme, type Color, type Fill, type ThemeColor } from '../../mvu/bar';
import { ICON_GROUPS } from '../../mvu/icons';

/** Pick one of a few options. */
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg seg-wrap">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** A number on a slider; empty (undefined) means "default", shown as `fallback`. */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  fallback,
  unit = '',
  noReset,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  fallback?: number;
  unit?: string;
  noReset?: boolean;
}) {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={value ?? fallback ?? min} onChange={(e) => onChange(Number(e.target.value))} />
      <span className={'sval' + (value == null ? ' muted' : '')}>{value == null ? '默认' : value + unit}</span>
      {!noReset && value != null && (
        <button className="xbtn" title="恢复默认" onClick={() => onChange(undefined)}>
          ↺
        </button>
      )}
    </span>
  );
}

/** #rgb / #rgba / #rrggbb / #rrggbbaa → color without alpha + alpha 0..1 */
function splitHex(c: string): { rgb: string; a: number } {
  let h = c.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  return { rgb: '#' + h.slice(0, 6).padEnd(6, '0'), a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}
const joinHex = (rgb: string, a: number) => (a >= 0.995 ? rgb : rgb + Math.round(a * 255).toString(16).padStart(2, '0'));

/** The actual color behind a theme reference, for showing it. */
export const shownColor = (c: Color | undefined, theme: BarTheme) => (c?.startsWith('@') ? theme[c.slice(1) as ThemeColor] : c);

const colorName = (c: Color | undefined, empty: string) =>
  !c ? empty : c === 'transparent' ? '透明' : c.startsWith('@') ? THEME_COLOR_LABEL[c.slice(1) as ThemeColor] ?? c : c;

/**
 * A color: one of the status bar's theme colors (follows the theme), any color with see-through, or nothing (default).
 * `fallback`: what is shown when nothing is picked.
 */
export function ColorInput({
  value,
  onChange,
  theme,
  fallback,
  themeColors = true,
  clearable = true,
  emptyLabel = '默认',
}: {
  value: Color | undefined;
  onChange: (c: Color | undefined) => void;
  theme: BarTheme;
  fallback?: string;
  themeColors?: boolean;
  clearable?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const real = shownColor(value, theme);
  const { rgb, a } = real && real.startsWith('#') ? splitHex(real) : { rgb: '#888888', a: real === 'transparent' ? 0 : 1 };
  const swatch = real ?? fallback;
  return (
    <span className="cpick">
      <button className="cbtn" onClick={() => setOpen((o) => !o)} title="点一下换颜色">
        <span className="cswatch">
          <i style={{ background: swatch }} />
        </span>
        <span className={value ? '' : 'muted'}>{colorName(value, emptyLabel)}</span>
      </button>
      {open && (
        <>
          <div className="menu-veil" onClick={() => setOpen(false)} />
          <div className="cpop">
            {themeColors && (
              <>
                <div className="hint">跟着整体配色走：</div>
                <div className="csws">
                  {THEME_COLORS.map((k) => (
                    <button
                      key={k}
                      className={'csw' + (value === '@' + k ? ' on' : '')}
                      title={THEME_COLOR_LABEL[k]}
                      onClick={() => {
                        onChange('@' + k);
                        setOpen(false);
                      }}
                    >
                      <i style={{ background: theme[k] }} />
                      <span>{THEME_COLOR_LABEL[k]}</span>
                    </button>
                  ))}
                </div>
                <div className="hint">或者自己挑：</div>
              </>
            )}
            <div className="inline">
              <input type="color" value={rgb} onChange={(e) => onChange(joinHex(e.target.value, a || 1))} />
              <span className="hint">不透明度</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={a}
                onChange={(e) => onChange(Number(e.target.value) <= 0 ? 'transparent' : joinHex(rgb, Number(e.target.value)))}
              />
              <span className="sval">{Math.round(a * 100)}%</span>
            </div>
            <div className="inline">
              {clearable && (
                <button
                  className="small"
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                >
                  用{emptyLabel}
                </button>
              )}
              <button className="small" onClick={() => onChange('transparent')}>
                透明
              </button>
              <span className="sp" />
              <button className="small" onClick={() => setOpen(false)}>
                好了
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}

const ANGLES: [number, string][] = [
  [90, '从左到右 →'],
  [180, '从上到下 ↓'],
  [135, '斜着 ↘'],
  [45, '斜着 ↗'],
  [270, '从右到左 ←'],
  [0, '从下到上 ↑'],
];

/** A background: one color, or a gradient between two. */
export function FillInput({
  value,
  onChange,
  theme,
  fallback,
}: {
  value: Fill | undefined;
  onChange: (f: Fill | undefined) => void;
  theme: BarTheme;
  fallback?: string;
}) {
  const grad = !!value?.b;
  return (
    <span className="inline">
      <ColorInput value={value?.a} theme={theme} fallback={fallback} onChange={(a) => onChange(a ? { ...value, a } : undefined)} />
      <label className="chk">
        <input
          type="checkbox"
          checked={grad}
          onChange={(e) => onChange(e.target.checked ? { a: value?.a ?? '@accent', b: '@accent2', angle: value?.angle ?? 90 } : value && { a: value.a })}
        />
        渐变
      </label>
      {grad && (
        <>
          <span className="hint">到</span>
          <ColorInput value={value!.b} theme={theme} clearable={false} onChange={(b) => onChange({ ...value!, b })} />
          <select className="small-select" value={value!.angle ?? 90} onChange={(e) => onChange({ ...value!, angle: Number(e.target.value) })}>
            {ANGLES.map(([deg, label]) => (
              <option key={deg} value={deg}>
                {label}
              </option>
            ))}
          </select>
        </>
      )}
    </span>
  );
}

/**
 * An icon: type one, click a quick pick, or open the whole library.
 * `field` tells typing apart from picking, so each click is its own undo step.
 */
export function IconPicker({
  value,
  onChange,
  quick,
  fallback,
  placeholder = '无',
}: {
  value: string | undefined;
  onChange: (v: string | undefined, field: 'type' | 'pick') => void;
  quick: string[];
  /** shown (and picked) when nothing is set; clicking it again doesn't clear */
  fallback?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(0);
  const cur = value ?? fallback;
  const pick = (ic: string) => onChange(ic === fallback ? undefined : cur === ic && !fallback ? undefined : ic, 'pick');
  return (
    <span className="inline icons">
      <input className="num" value={value ?? fallback ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value || undefined, 'type')} />
      {quick.map((ic) => (
        <button key={ic} className={'small' + (cur === ic ? ' primary' : '')} onClick={() => pick(ic)}>
          {ic}
        </button>
      ))}
      <span className="cpick">
        <button className="small" onClick={() => setOpen((o) => !o)} title="打开图标库">
          更多…
        </button>
        {open && (
          <>
            <div className="menu-veil" onClick={() => setOpen(false)} />
            <div className="cpop icon-pop">
              <div className="seg seg-wrap">
                {ICON_GROUPS.map((g, i) => (
                  <button key={g.name} className={i === group ? 'on' : ''} onClick={() => setGroup(i)}>
                    {g.name}
                  </button>
                ))}
              </div>
              <div className="icon-grid">
                {ICON_GROUPS[group].icons.map((ic) => (
                  <button
                    key={ic}
                    className={cur === ic ? 'on' : ''}
                    title={ic}
                    onClick={() => {
                      pick(ic);
                      setOpen(false);
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
              <div className="inline">
                <span className="hint">白色的符号跟着文字颜色变，彩色的表情颜色是固定的</span>
                <span className="sp" />
                <button className="small" onClick={() => setOpen(false)}>
                  关上
                </button>
              </div>
            </div>
          </>
        )}
      </span>
    </span>
  );
}
