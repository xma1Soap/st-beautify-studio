// 解析型面板 settings: the tag, how the AI writes sections and rows, each section (icon, name, other names, color,
// open or folded), the rules for what shows as what, the colors, and what to tell the AI. Every change rebuilds the
// regex's code.
import { useState } from 'react';
import { compilePanel, panelPrompt, RULE_KINDS, type PanelDef, type PanelRule, type PanelSection, type RuleKind } from '../lib/panel';
import { toHex } from '../lib/htmlEdit';
import { useStore } from '../store';
import type { RegexScript } from '../lib/types';
import { addPanelSample } from '../panelScript';
import { TextBox } from './PickPanel';

const NAME_HINT: Record<RuleKind, string> = {
  meter: '名字，比如 HP',
  field: '字段名，用 | 隔开：回合|环境|目标',
  stat: '名字，比如 力',
  words: '词，用 、 隔开：哥布林、狼人',
  dice: '',
  number: '',
};

const THEME: { k: keyof PanelDef['theme']; label: string }[] = [
  { k: 'bg', label: '面板底色' },
  { k: 'border', label: '边框' },
  { k: 'head', label: '标题栏' },
  { k: 'title', label: '标题字' },
  { k: 'text', label: '正文字' },
  { k: 'row', label: '行底色' },
];

/** A color: the box to pick one (keeping its see-through part) and the value as written. */
function Color({ value, onChange, title }: { value: string; onChange: (v: string) => void; title?: string }) {
  const alpha = /^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : '';
  return (
    <span className="pe-color" title={title}>
      <input type="color" value={toHex(value) || '#000000'} onChange={(e) => onChange(e.target.value + alpha)} />
      <TextBox value={value} onCommit={(v) => v.trim() && onChange(v.trim())} />
    </span>
  );
}

const move = <T,>(l: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= l.length) return l;
  const c = [...l];
  [c[i], c[j]] = [c[j], c[i]];
  return c;
};

const Arrows = ({ i, n, onMove, onDel }: { i: number; n: number; onMove: (d: number) => void; onDel: () => void }) => (
  <span className="pe-acts">
    <button className="small" disabled={i === 0} onClick={() => onMove(-1)} title="上移">↑</button>
    <button className="small" disabled={i === n - 1} onClick={() => onMove(1)} title="下移">↓</button>
    <button className="small" onClick={onDel} title="删掉">✕</button>
  </span>
);

export function PanelEditor({ script, p, edited }: { script: RegexScript; p: PanelDef; edited: boolean }) {
  const update = useStore((s) => s.updateScript);
  const notify = useStore((s) => s.notify);
  const [promptOpen, setPromptOpen] = useState(false);

  const set = (patch: Partial<PanelDef>) => {
    const c = compilePanel({ ...p, ...patch });
    if (c.findRegex !== script.findRegex || c.replaceString !== script.replaceString) update(script.id, c);
  };
  const setSec = (i: number, patch: Partial<PanelSection>) => set({ sections: p.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setRule = (i: number, patch: Partial<PanelRule>) => set({ rules: p.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const setKind = (i: number, kind: RuleKind) => {
    const r = p.rules[i];
    setRule(i, { kind, ...(kind === 'meter' ? { low: r.low ?? 30, lowColor: r.lowColor ?? '#e8892b' } : {}), ...(kind === 'dice' || kind === 'number' ? { name: '' } : {}) });
  };
  const prompt = panelPrompt(p);
  const copy = () =>
    navigator.clipboard.writeText(prompt).then(
      () => notify('已复制，粘到角色卡或预设的提示词里'),
      () => notify('复制失败，手动选中复制吧'),
    );

  return (
    <div className="panel-editor scroll">
      {edited && <div className="callout warn-box">生成之后代码手动改过。在这里再改的话会按设置重新生成，手改的地方会被覆盖。</div>}

      <h4>格式</h4>
      <div className="pe-grid">
        <span className="pick-label">标签</span>
        <span className="pe-tag">
          &lt;<TextBox value={p.tag} onCommit={(tag) => set({ tag })} />&gt;
          <span className="hint">AI 把面板写在这对标签中间</span>
        </span>
        <span className="pick-label">分段标题</span>
        <select value={p.title} onChange={(e) => set({ title: e.target.value as PanelDef['title'] })}>
          <option value="brace">{'{战况总览}'}</option>
          <option value="bracket">【战况总览】</option>
        </select>
        <span className="pick-label">每一行</span>
        <select value={p.rows} onChange={(e) => set({ rows: e.target.value as PanelDef['rows'] })}>
          <option value="pipe">用 | 开头、| 结尾的行（别的行不显示）</option>
          <option value="line">每一行都显示</option>
        </select>
      </div>

      <h4>
        分段 <span className="hint">AI 写的标题对上名字或「其他写法」，就用这里的图标和颜色；对不上的照样显示</span>
      </h4>
      <div className="pe-list">
        {p.sections.map((s, i) => (
          <div key={i} className="pe-item">
            <span className="pe-icon"><TextBox value={s.icon} onCommit={(icon) => setSec(i, { icon })} /></span>
            <span className="pe-name"><TextBox value={s.name} placeholder="分段名" onCommit={(name) => setSec(i, { name })} /></span>
            <span className="pe-alias" title="繁体、简称……用 、 隔开">
              <TextBox value={s.aliases.join('、')} placeholder="其他写法（、隔开）" onCommit={(v) => setSec(i, { aliases: v.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) })} />
            </span>
            <Color value={s.color} onChange={(color) => setSec(i, { color })} title="这一段的颜色（图标和左边的线）" />
            <label className="chk" title="不勾就默认收起，玩家点标题展开">
              <input type="checkbox" checked={s.open} onChange={(e) => setSec(i, { open: e.target.checked })} />
              展开
            </label>
            <Arrows i={i} n={p.sections.length} onMove={(d) => set({ sections: move(p.sections, i, d) })} onDel={() => set({ sections: p.sections.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <button className="small" onClick={() => set({ sections: [...p.sections, { name: '新分段', aliases: [], icon: '◆', color: '#9f7aea', open: true }] })}>＋ 加分段</button>
      </div>

      <h4>
        行规则 <span className="hint">行里认出这些就换个样子显示；同一处几条都能认出时，上面的优先</span>
      </h4>
      <div className="pe-list">
        {p.rules.map((r, i) => (
          <div key={i} className="pe-item">
            <select value={r.kind} onChange={(e) => setKind(i, e.target.value as RuleKind)} title={RULE_KINDS.find((k) => k.kind === r.kind)?.note}>
              {RULE_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </select>
            {NAME_HINT[r.kind] ? (
              <span className="pe-name wide"><TextBox value={r.name} placeholder={NAME_HINT[r.kind]} onCommit={(name) => setRule(i, { name })} /></span>
            ) : (
              <span className="pe-name wide hint">{RULE_KINDS.find((k) => k.kind === r.kind)?.note}</span>
            )}
            <Color value={r.color} onChange={(color) => setRule(i, { color })} />
            {r.kind === 'meter' && (
              <span className="pe-low">
                ≤<input type="number" min={0} max={100} value={r.low ?? 0} onChange={(e) => setRule(i, { low: Number(e.target.value) })} />% 变
                <Color value={r.lowColor ?? '#e8892b'} onChange={(lowColor) => setRule(i, { lowColor })} />
              </span>
            )}
            {r.kind === 'stat' && (
              <span className="pe-label" title="显示成什么（空着就显示名字）">
                <TextBox value={r.label ?? ''} placeholder="显示成" onCommit={(label) => setRule(i, { label })} />
              </span>
            )}
            <Arrows i={i} n={p.rules.length} onMove={(d) => set({ rules: move(p.rules, i, d) })} onDel={() => set({ rules: p.rules.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <button className="small" onClick={() => set({ rules: [...p.rules, { kind: 'words', name: '', color: '#f56565' }] })}>＋ 加规则</button>
      </div>

      <h4>配色</h4>
      <div className="pe-theme">
        {THEME.map((t) => (
          <label key={t.k}>
            <span className="pick-label">{t.label}</span>
            <Color value={p.theme[t.k]} onChange={(v) => set({ theme: { ...p.theme, [t.k]: v } })} />
          </label>
        ))}
      </div>

      <h4>
        告诉 AI <span className="hint">把这段放进角色卡或预设，AI 就会按这个格式写面板</span>
      </h4>
      <div className="inline">
        <button className="small primary" onClick={copy}>复制格式说明</button>
        <button className="small" onClick={() => setPromptOpen((o) => !o)}>{promptOpen ? '收起' : '看一眼'}</button>
        <button className="small" onClick={() => notify(addPanelSample(p, true) ? '已把示例放进测试消息' : '测试消息里已经有这段示例了')}>把示例放进测试消息</button>
      </div>
      {promptOpen && <pre className="pe-prompt">{prompt}</pre>}
    </div>
  );
}
