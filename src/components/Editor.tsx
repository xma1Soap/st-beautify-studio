import { useMemo, useRef, useState } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore, type EditorTab } from '../store';
import { genSample, groupCount, parseRegex, findString, type RunResult } from '../lib/engine';
import { PLACEMENTS, type RegexScript } from '../lib/types';
import { generateAll } from '../lib/engine';
import { ask } from './dialog';
import { readBuilder } from '../lib/builder';
import { openBuilder } from '../regexBuilder';
import { PalettePanel } from './PalettePanel';

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'code', label: '替换内容' },
  { id: 'settings', label: '正则设置' },
  { id: 'test', label: '测试消息' },
];

export function Editor({ stats }: { stats: Record<string, RunResult> }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const script = useStore((s) => s.project.scripts.find((x) => x.id === s.selectedId));

  return (
    <section className="editor">
      <div className="panel-head tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <span className="sp" />
        {script && tab !== 'test' && <span className="cur-name" title={script.scriptName}>{script.scriptName}</span>}
      </div>
      {tab === 'test' ? (
        <TestPanel />
      ) : !script ? (
        <div className="empty big">左边选一条正则来编辑，或点「＋ 新建」</div>
      ) : tab === 'code' ? (
        <CodePanel key={script.id} script={script} stat={stats[script.id]} />
      ) : (
        <ScriptForm key={script.id} script={script} stat={stats[script.id]} />
      )}
    </section>
  );
}

function FindStatus({ script, stat }: { script: RegexScript; stat?: RunResult }) {
  const settings = useStore((s) => s.project.settings);
  const m = { user: settings.user, char: settings.char };
  const { err } = parseRegex(findString(script, m));
  if (!script.findRegex) return <span className="hint warn">还没填查找正则</span>;
  if (err) return <span className="hint err">正则错误：{err}</span>;
  const n = groupCount(script, m);
  return (
    <span className="hint">
      捕获组 {n} 个 · {stat ? (stat.hits ? <b className="ok">命中 {stat.hits} 处</b> : <b className="warn">测试消息里没命中</b>) : '当前不作用于预览'}
    </span>
  );
}

function CodePanel({ script, stat }: { script: RegexScript; stat?: RunResult }) {
  const uiTheme = useStore((s) => s.uiTheme);
  const settings = useStore((s) => s.project.settings);
  const update = useStore((s) => s.updateScript);
  const view = useRef<EditorView | null>(null);
  const extensions = useMemo(() => [html(), EditorView.lineWrapping], []);
  const n = groupCount(script, { user: settings.user, char: settings.char });
  const built = useMemo(() => readBuilder(script), [script.findRegex, script.replaceString]);
  const [palOpen, setPalOpen] = useState(false);

  const insert = (text: string) => {
    const v = view.current;
    if (!v) return;
    v.dispatch(v.state.replaceSelection(text));
    v.focus();
  };

  return (
    <div className="code-panel">
      {built && (
        <div className={'callout builder-note' + (built.edited ? ' warn-box' : '')}>
          <span>
            {built.edited
              ? '这条是在画布上做的，生成之后代码又手动改过。回画布上再改的话，手改的地方会被覆盖。'
              : '这条是在画布上做的：改样子、加字段都回画布上改，下面的代码会跟着重新生成。'}
          </span>
          <button className="small primary" onClick={() => void openBuilder(script.id)}>
            去画布编辑
          </button>
        </div>
      )}
      <div className="find-row">
        <label>查找</label>
        <input
          className="mono"
          value={script.findRegex}
          spellCheck={false}
          onChange={(e) => update(script.id, { findRegex: e.target.value })}
          placeholder="/<状态栏>([\s\S]*?)<\/状态栏>/g"
        />
      </div>
      <div className="find-status"><FindStatus script={script} stat={stat} /></div>
      <div className="insert-row">
        <span>插入：</span>
        <button className="small" title="整段匹配到的文字" onClick={() => insert('{{match}}')}>整段</button>
        {Array.from({ length: n }, (_, i) => (
          <button key={i} className="small" title={`第 ${i + 1} 个捕获组`} onClick={() => insert('$' + (i + 1))}>${i + 1}</button>
        ))}
        <button className="small" onClick={() => insert('{{user}}')}>{'{{user}}'}</button>
        <button className="small" onClick={() => insert('{{char}}')}>{'{{char}}'}</button>
        <span className="sp" />
        {!built && (
          <button className={'small' + (palOpen ? ' on' : '')} onClick={() => setPalOpen((o) => !o)} title="找出这条正则用到的颜色，一个个换，或者整体换一套色调">
            🎨 换配色
          </button>
        )}
        <span className="hint">{script.replaceString.length} 字</span>
      </div>
      {palOpen && !built && <PalettePanel key={script.id} script={script} onClose={() => setPalOpen(false)} />}
      <div className="cm-wrap">
        <CodeMirror
          value={script.replaceString}
          height="100%"
          theme={uiTheme === 'dark' ? oneDark : 'light'}
          extensions={extensions}
          onChange={(v) => update(script.id, { replaceString: v })}
          onCreateEditor={(v) => { view.current = v; }}
          basicSetup={{ foldGutter: true, highlightActiveLine: true }}
        />
      </div>
    </div>
  );
}

const numIn = (v: string): number | null => (v.trim() === '' || isNaN(Number(v)) ? null : Number(v));

function ScriptForm({ script, stat }: { script: RegexScript; stat?: RunResult }) {
  const update = useStore((s) => s.updateScript);
  const settings = useStore((s) => s.project.settings);
  const setText = useStore((s) => s.setText);
  const setTab = useStore((s) => s.setTab);
  const testText = useStore((s) => s.project.testText);
  const notify = useStore((s) => s.notify);
  const up = (patch: Partial<RegexScript>) => update(script.id, patch);

  const togglePlacement = (v: number, on: boolean) =>
    up({ placement: on ? [...new Set([...script.placement, v])].sort() : script.placement.filter((p) => p !== v) });

  const addSample = () => {
    const t = genSample(script, { user: settings.user, char: settings.char });
    if (!t) { notify('这条正则生成不了示例'); return; }
    setText((testText.trim() ? testText.replace(/\s*$/, '') + '\n\n' : '') + t);
    notify('已把示例追加到测试消息');
  };

  return (
    <div className="form scroll">
      <Field label="名称">
        <input value={script.scriptName} onChange={(e) => up({ scriptName: e.target.value })} />
      </Field>
      <Field label="查找正则" note={<FindStatus script={script} stat={stat} />}>
        <textarea className="mono" rows={3} spellCheck={false} value={script.findRegex} onChange={(e) => up({ findRegex: e.target.value })} />
      </Field>
      <Field label="替换为">
        <div className="inline">
          <span className="hint">{script.replaceString.length} 字</span>
          <button className="small" onClick={() => setTab('code')}>去「替换内容」编辑</button>
        </div>
      </Field>
      <Field adv label="修剪掉" note={<span className="hint">每行一个；从捕获到的内容里删掉这些文字</span>}>
        <textarea className="mono" rows={2} spellCheck={false} value={script.trimStrings.join('\n')}
          onChange={(e) => up({ trimStrings: e.target.value.split('\n').filter((x, i, a) => x !== '' || i < a.length - 1) })} />
      </Field>
      <Field label="作用范围">
        <div className="checks">
          {PLACEMENTS.map((p) => (
            <label key={p.value}><input type="checkbox" checked={script.placement.includes(p.value)} onChange={(e) => togglePlacement(p.value, e.target.checked)} />{p.label}</label>
          ))}
        </div>
      </Field>
      <Field label="选项">
        <div className="checks">
          <label><input type="checkbox" checked={script.disabled} onChange={(e) => up({ disabled: e.target.checked })} />禁用</label>
          <label><input type="checkbox" checked={script.markdownOnly} onChange={(e) => up({ markdownOnly: e.target.checked })} />仅格式显示</label>
          <label><input type="checkbox" checked={script.promptOnly} onChange={(e) => up({ promptOnly: e.target.checked })} />仅格式提示词</label>
          <label><input type="checkbox" checked={script.runOnEdit} onChange={(e) => up({ runOnEdit: e.target.checked })} />编辑时运行</label>
        </div>
        <div className="hint">美化一般勾「仅格式显示」：只改显示效果，不改聊天记录，也不发给 AI。</div>
      </Field>
      <Field adv label="正则中的宏">
        <select value={script.substituteRegex} onChange={(e) => up({ substituteRegex: Number(e.target.value) })}>
          <option value={0}>不替换</option>
          <option value={1}>原样替换（{'{{user}}'} 等）</option>
          <option value={2}>转义后替换</option>
        </select>
      </Field>
      <Field adv label="楼层深度" note={<span className="hint">空着 = 不限。0 是最新一楼</span>}>
        <div className="inline">
          最小 <input type="number" className="num" value={script.minDepth ?? ''} onChange={(e) => up({ minDepth: numIn(e.target.value) })} />
          最大 <input type="number" className="num" value={script.maxDepth ?? ''} onChange={(e) => up({ maxDepth: numIn(e.target.value) })} />
        </div>
      </Field>
      <Field label="匹配详情">
        <div className="inline"><button className="small" onClick={addSample}>为这条生成示例文本</button></div>
        {stat?.matches.length ? (
          <ol className="matches">
            {stat.matches.map((mm, i) => (
              <li key={i}>
                <div><b>整段</b><code>{mm.text}</code></div>
                {mm.groups.map((g, k) => (
                  <div key={k}><b>${k + 1}</b>{g === undefined ? <i className="hint">（没匹配到）</i> : <code>{g}</code>}</div>
                ))}
              </li>
            ))}
          </ol>
        ) : (
          <div className="hint">测试消息里还没有命中。</div>
        )}
      </Field>
    </div>
  );
}

function Field({ label, note, children, adv }: { label: string; note?: React.ReactNode; children: React.ReactNode; adv?: boolean }) {
  return (
    <div className={'field' + (adv ? ' adv' : '')}>
      <div className="flabel">{label}</div>
      <div className="fbody">{children}{note && <div className="fnote">{note}</div>}</div>
    </div>
  );
}

function TestPanel() {
  const text = useStore((s) => s.project.testText);
  const settings = useStore((s) => s.project.settings);
  const scripts = useStore((s) => s.project.scripts);
  const { setText, setSettings, notify } = useStore.getState();

  const genAll = async () => {
    const t = generateAll(scripts, settings);
    if (!t) { notify('没有能生成示例的正则（要启用、而且会影响显示）'); return; }
    if (text.trim() && !(await ask('用生成的示例替换当前测试消息？', { ok: '替换' }))) return;
    setText(t);
  };

  return (
    <div className="test-panel">
      <div className="opts">
        <label>{'{{user}}'}<input value={settings.user} onChange={(e) => setSettings({ user: e.target.value })} /></label>
        <label>{'{{char}}'}<input value={settings.char} onChange={(e) => setSettings({ char: e.target.value })} /></label>
        <label>消息类型
          <select value={settings.role} onChange={(e) => setSettings({ role: Number(e.target.value) as 1 | 2 })}>
            <option value={2}>AI 输出</option><option value={1}>用户输入</option>
          </select>
        </label>
        <label title="0 = 最新一楼">楼层深度<input type="number" min={0} className="num" value={settings.depth} onChange={(e) => setSettings({ depth: Math.max(0, parseInt(e.target.value) || 0) })} /></label>
        <span className="sp" />
        <button className="small" onClick={genAll}>按全部正则生成示例</button>
      </div>
      <textarea
        className="mono test-text"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="在这里写 AI 回复的原文（正则替换之前的样子）……"
      />
    </div>
  );
}
