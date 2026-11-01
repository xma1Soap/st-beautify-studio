import { useState } from 'react';
import { useStore } from '../store';
import { isBuilt } from '../lib/builder';
import { newBuilderScript, openBuilder } from '../regexBuilder';
import { isPanel } from '../lib/panel';
import { newPanelScript } from '../panelScript';
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
  const [menu, setMenu] = useState(false);

  return (
    <aside className="list-panel">
      <div className="panel-head">
        正则 <span className="count">{scripts.length}</span>
        <span className="sp" />
        <button className="small" onClick={() => setAllEnabled(!allOn)} disabled={!scripts.length}>{allOn ? '全部停用' : '全部启用'}</button>
        <div className="menu-wrap">
          <button className="small primary" onClick={() => setMenu((m) => !m)}>＋ 新建</button>
          {menu && (
            <>
              <div className="menu-veil" onClick={() => setMenu(false)} />
              <div className="menu from-left">
                <button onClick={() => { setMenu(false); addScript(); }}>
                  <b>手写代码</b>
                  <span className="hint">自己写查找正则和替换成的 HTML</span>
                </button>
                <button onClick={() => { setMenu(false); newBuilderScript(); }}>
                  <b>在画布上做</b>
                  <span className="hint">拖组件排版，AI 写的内容自动填进去</span>
                </button>
                <button onClick={() => { setMenu(false); newPanelScript(); }}>
                  <b>解析型面板</b>
                  <span className="hint">AI 分段写的战况、结算，变成能折叠的彩色面板：血条、标签、骰子</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <ul className="slist">
        {scripts.map((s, i) => {
          const stt = status(s, stats[s.id], settings);
          return (
            <li
              key={s.id}
              className={'sitem' + (s.id === selectedId ? ' on' : '') + (stt.cls === 'muted' ? ' dim' : '')}
              onClick={() => select(s.id)}
              onDoubleClick={() => isBuilt(s.replaceString) && void openBuilder(s.id)}
              title={isBuilt(s.replaceString) ? '双击回画布上改' : undefined}
            >
              <input
                type="checkbox"
                checked={!s.disabled}
                title={s.disabled ? '启用' : '停用'}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateScript(s.id, { disabled: !e.target.checked })}
              />
              <div className="sbody">
                <div className="sname">
                  {s.scriptName || '(未命名)'}
                  {isBuilt(s.replaceString) && <span className="vflag">画布</span>}
                  {isPanel(s.replaceString) && <span className="vflag">面板</span>}
                </div>
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
