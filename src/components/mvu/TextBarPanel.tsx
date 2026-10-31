// Status bar page, plain mode: which variables go in, the heading, colors and font. The bar itself is made by
// mvu/textbar.ts; the chat preview on the right shows it.
import { useMemo } from 'react';
import { useCard } from '../../cardStore';
import { barOf, FONTS, THEME_COLOR_LABEL, THEME_PRESETS, type BarTheme, type FontName, type ThemeColor } from '../../mvu/bar';
import { textBarHtml, TEXT_BAR_TITLE } from '../../mvu/textbar';
import type { TextBar, VarNode } from '../../mvu/types';
import { Field } from '../common';
import { ColorInput, Seg, Slider } from './barInputs';

const COLORS: ThemeColor[] = ['card', 'line', 'text', 'dim', 'accent', 'accent2'];
const COLOR_NOTE: Partial<Record<ThemeColor, string>> = { card: '底色', dim: '变量名', accent: '标题', accent2: '分组名' };

const editText = (patch: Partial<TextBar>, key?: string) =>
  useCard.getState().edit((p) => ({ ...p, textBar: { on: false, ...p.textBar, ...patch } }), key);

/** Choose between the bar from the canvas and the plain one. */
export function BarMode() {
  const on = useCard((s) => !!s.project.textBar?.on);
  return (
    <div className="bar-mode">
      <Field
        label="状态栏做成"
        note={
          on
            ? '几行字，不跑脚本，最简单。只显示在最新一条回复下面。'
            : '在画布上自由摆，能放进度条、图片、按钮和菜单。'
        }
      >
        <Seg
          value={on ? 'text' : 'ui'}
          options={[
            ['ui', '界面'],
            ['text', '纯文字'],
          ]}
          onChange={(v) => editText({ on: v === 'text' })}
        />
      </Field>
    </div>
  );
}

export function TextBarPanel() {
  const vars = useCard((s) => s.project.vars);
  const saved = useCard((s) => s.project.bar);
  const tb = useCard((s) => s.project.textBar) ?? { on: true };
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const theme = useMemo(() => barOf({ bar: saved, vars }).theme, [saved, vars]);
  const out = useMemo(() => textBarHtml(vars, theme, tb), [vars, theme, tb]);
  const hide = new Set(tb.hide ?? []);
  const setTheme = (patch: Partial<BarTheme>, field: string) =>
    useCard.getState().editBar((b) => ({ ...b, theme: { ...b.theme, ...patch } }), 'bar:theme:' + field);
  const toggle = (v: VarNode) => {
    const next = new Set(hide);
    if (next.has(v.id)) next.delete(v.id);
    else next.add(v.id);
    editText({ hide: [...next] });
  };

  return (
    <div className="text-bar-panel">
      <div className="callout">
        每个变量一行「名字：值」，由酒馆助手在显示消息时填进去（要开着酒馆助手的「宏」功能，默认是开的）。
        <br />
        数值来自最新一条有变量的消息，所以只显示在最新一条回复下面；往上翻的旧消息不显示。
      </div>
      <ul className="hint tb-notes">
        <li>数字有范围时写成「10 / 100」，有阶段时后面带上阶段名</li>
        <li>列表、表格一项一行；空的会显示成 [] 或 {'{}'}</li>
        <li>是 / 否会显示成 true / false</li>
        {allowEdit && <li>纯文字状态栏没有按钮，玩家没法从这里改变量</li>}
      </ul>
      {out.problems.length > 0 && (
        <div className="callout warn-box">
          {out.problems.map((p) => (
            <div key={p}>· {p}</div>
          ))}
        </div>
      )}

      <h4 className="sec">显示哪些变量</h4>
      <div className="tb-vars">
        <VarChecks list={vars} depth={0} hide={hide} toggle={toggle} />
      </div>

      <h4 className="sec">样子</h4>
      <Field label="标题" note="不要标题就清空">
        <input
          value={tb.title ?? TEXT_BAR_TITLE}
          maxLength={60}
          placeholder="（不要标题）"
          onChange={(e) => editText({ title: e.target.value }, 'textBar:title')}
        />
      </Field>
      <div className="presets">
        {THEME_PRESETS.map((p) => (
          <button key={p.name} className={'preset' + (theme.preset === p.name ? ' on' : '')} onClick={() => setTheme({ preset: p.name, ...p.colors }, 'preset')}>
            <span className="pv" style={{ background: p.colors.card, borderColor: p.colors.line }}>
              <i style={{ background: p.colors.dim }} />
              <b style={{ background: `linear-gradient(90deg, ${p.colors.accent}, ${p.colors.accent2})` }} />
            </span>
            {p.name}
          </button>
        ))}
      </div>
      {COLORS.map((k) => (
        <Field key={k} label={THEME_COLOR_LABEL[k]} note={COLOR_NOTE[k]}>
          <ColorInput value={theme[k]} theme={theme} themeColors={false} clearable={false} onChange={(c) => c && setTheme({ [k]: c, preset: '' }, k)} />
        </Field>
      ))}
      <Field label="字体" note="玩家电脑上没有这种字体时会用默认字体">
        <select value={theme.font} onChange={(e) => setTheme({ font: e.target.value as FontName }, 'font')}>
          {(Object.keys(FONTS) as FontName[]).map((k) => (
            <option key={k} value={k}>
              {FONTS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="字号">
        <Slider value={theme.size} min={10} max={24} unit="px" noReset onChange={(n) => n !== undefined && setTheme({ size: n }, 'size')} />
      </Field>
    </div>
  );
}

function VarChecks({ list, depth, hide, toggle }: { list: VarNode[]; depth: number; hide: Set<string>; toggle: (v: VarNode) => void }) {
  return (
    <>
      {list.map((v) => (
        <div key={v.id}>
          <label className="chk" style={{ paddingLeft: depth * 16 }}>
            <input type="checkbox" checked={!hide.has(v.id)} onChange={() => toggle(v)} />
            {v.kind === 'group' ? <b>{v.name}</b> : v.name}
          </label>
          {v.kind === 'group' && !hide.has(v.id) && <VarChecks list={v.children ?? []} depth={depth + 1} hide={hide} toggle={toggle} />}
        </div>
      ))}
    </>
  );
}
