import { useStore } from '../store';
import { skipReason, type RunResult } from '../lib/engine';
import type { RegexScript, Settings } from '../lib/types';
import { ask } from './dialog';

function status(s: RegexScript, st: RunResult | undefined, settings: Settings): { text: string; cls: string } {
  if (s.disabled) return { text: '已停用', cls: 'muted' };
  const why = skipReason(s, settings);
  if (why) return { text: why, cls: 'muted' };
  if (st?.err) return { text: '正则有误', cls: 'err' };
  if (st?.hits) return { text: `命中 ${st.hits}`, cls: 'ok' };
  return { text: '未命中', cls: 'warn' };
}

export function ScriptList({ stats }: { stats: Record<string, RunResult> }) {
  const scripts = useStore((s) => s.project.scripts);
  const settings = useStore((s) => s.project.settings);
  const selectedId = useStore((s) => s.selectedId);
  const { select, updateScript, addScript, duplicateScript, removeScript, moveScript, setAllEnabled } = useStore.getState();
  const allOn = scripts.length > 0 && scripts.every((s) => !s.disabled);

  return (
    <aside className="list-panel">
      <div className="panel-head">
        正则 <span className="count">{scripts.length}</span>
        <span className="sp" />
        <button className="small" onClick={() => setAllEnabled(!allOn)} disabled={!scripts.length}>{allOn ? '全部停用' : '全部启用'}</button>
        <button className="small primary" onClick={addScript}>＋ 新建</button>
      </div>
      <ul className="slist">
        {scripts.map((s, i) => {
          const stt = status(s, stats[s.id], settings);
          return (
            <li key={s.id} className={'sitem' + (s.id === selectedId ? ' on' : '') + (stt.cls === 'muted' ? ' dim' : '')} onClick={() => select(s.id)}>
              <input
                type="checkbox"
                checked={!s.disabled}
                title={s.disabled ? '启用' : '停用'}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateScript(s.id, { disabled: !e.target.checked })}
              />
              <div className="sbody">
                <div className="sname">{s.scriptName || '(未命名)'}</div>
                <div className={'sstat ' + stt.cls}>{stt.text}</div>
              </div>
              <div className="sact" onClick={(e) => e.stopPropagation()}>
                <button title="上移" disabled={i === 0} onClick={() => moveScript(s.id, -1)}>↑</button>
                <button title="下移" disabled={i === scripts.length - 1} onClick={() => moveScript(s.id, 1)}>↓</button>
                <button title="复制一份" onClick={() => duplicateScript(s.id)}>⧉</button>
                <button title="删除" onClick={() => void ask(`删除「${s.scriptName}」？`, { ok: '删除', danger: true }).then((y) => y && removeScript(s.id))}>✕</button>
              </div>
            </li>
          );
        })}
        {!scripts.length && <li className="empty">还没有正则，点「＋ 新建」或把文件拖进来</li>}
      </ul>
      <div className="drop-hint">把 .json 正则 / 预设 / 角色卡 .png / 工程文件拖进窗口即可导入</div>
    </aside>
  );
}
