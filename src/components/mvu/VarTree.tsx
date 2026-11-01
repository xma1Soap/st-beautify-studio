// Left panel: the variable tree, add buttons, templates and the list of problems.
import { useMemo, useState } from 'react';
import { drag, nodeShowing } from '../../barActions';
import { useCard } from '../../cardStore';
import { TEMPLATES } from '../../mvu/templates';
import { canIndent, canOutdent, cloneVar, findVar, indentVar, insertVar, moveVar, namesNear, newVar, outdentVar, removeVar, uniqueName } from '../../mvu/tree';
import type { VarKind, VarNode } from '../../mvu/types';
import { problems } from '../../mvu/vars';
import { ask } from '../dialog';

export const KIND_LABEL: Record<VarKind, string> = { number: '数字', text: '文字', bool: '是/否', choice: '选项', list: '列表', group: '分组', table: '表格' };
const KIND_BADGE: Record<VarKind, string> = { number: '数', text: '文', bool: '是', choice: '选', list: '列', group: '组', table: '表' };
const ADD_KINDS: VarKind[] = ['number', 'text', 'bool', 'choice', 'list', 'group', 'table'];

const short = (x: unknown) => {
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  return s.length > 14 ? s.slice(0, 14) + '…' : s;
};

function summary(v: VarNode): string {
  switch (v.kind) {
    case 'number': {
      const range = v.min != null || v.max != null ? `${v.min ?? '…'}~${v.max ?? '…'}` : '';
      return [v.init ?? v.min ?? 0, range, v.stages?.length ? `${v.stages.length} 个阶段` : ''].filter((x) => x !== '').join(' · ');
    }
    case 'group':
      return `${v.children?.length ?? 0} 项`;
    case 'table':
      return `${v.children?.length ?? 0} 个字段 · ${Object.keys((v.init as object) ?? {}).length} 行`;
    case 'list':
      return `${(v.init as unknown[] | undefined)?.length ?? 0} 项`;
    case 'bool':
      return v.init ? '是' : '否';
    default:
      return v.init != null && v.init !== '' ? short(v.init) : v.kind === 'choice' ? short(v.options?.[0] ?? '') : '';
  }
}

export function VarTree() {
  const vars = useCard((s) => s.project.vars);
  const selected = useCard((s) => s.selectedVarId);
  const onBar = useCard((s) => s.tab === 'bar' && !s.project.textBar?.on);
  const { editVars, selectVar, setTab, selectBar } = useCard.getState();
  const [menu, setMenu] = useState(false);
  const list = useMemo(() => problems(vars), [vars]);

  const sel = findVar(vars, selected);

  /** Where a new variable goes: inside the selected group / table, else after the selected one. */
  const placeFor = (kind: VarKind) => {
    if (sel && (sel.kind === 'group' || (sel.kind === 'table' && kind !== 'group' && kind !== 'table'))) return { intoId: sel.id };
    return { afterId: sel?.id ?? null };
  };

  const add = (kind: VarKind) => {
    const where = placeFor(kind);
    const v = newVar(kind, namesNear(vars, where));
    editVars((l) => insertVar(l, v, where));
    selectVar(v.id);
    setTab('vars');
  };

  const addTemplate = (i: number) => {
    setMenu(false);
    const made = TEMPLATES[i].build();
    editVars((l) => {
      let out = l;
      for (const v of made) out = insertVar(out, { ...v, name: uniqueName(v.name, out.map((x) => x.name)) });
      return out;
    });
    selectVar(made[0].id);
    setTab('vars');
  };

  const row = (v: VarNode, depth: number, siblings: VarNode[], i: number, inTable: boolean) => (
    <li key={v.id}>
      <div
        className={'vitem' + (v.id === selected ? ' on' : '') + (onBar ? ' dragme' : '')}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={onBar}
        onDragStart={(e) => {
          drag.item = { kind: 'var', id: v.id };
          e.dataTransfer.setData('text/plain', v.name);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onDragEnd={() => (drag.item = null)}
        onClick={() => {
          selectVar(v.id);
          // on the status bar page, jump to where this variable is shown instead of leaving the page
          if (onBar) selectBar(nodeShowing(v.id));
          else setTab('vars');
        }}
        onDoubleClick={() => onBar && setTab('vars')}
        title={onBar ? '拖到右边画布上放进状态栏；双击去改这个变量' : undefined}
      >
        <span className={'kbadge k-' + v.kind} title={KIND_LABEL[v.kind]}>
          {KIND_BADGE[v.kind]}
        </span>
        <span className="vname">
          {v.name || <i className="muted">（没名字）</i>}
          {inTable && <span className="vflag">字段</span>}
          {v.readonly && <span className="vflag">AI 不能改</span>}
        </span>
        <span className="vsum">{summary(v)}</span>
        <span className="sact" onClick={(e) => e.stopPropagation()}>
          <button title="上移" disabled={i === 0} onClick={() => editVars((l) => moveVar(l, v.id, -1))}>↑</button>
          <button title="下移" disabled={i === siblings.length - 1} onClick={() => editVars((l) => moveVar(l, v.id, 1))}>↓</button>
          <button title="移出分组" disabled={!canOutdent(vars, v.id)} onClick={() => editVars((l) => outdentVar(l, v.id))}>←</button>
          <button title="放进上面的分组" disabled={!canIndent(vars, v.id)} onClick={() => editVars((l) => indentVar(l, v.id))}>→</button>
          <button
            title="复制一份"
            onClick={() => {
              const c = cloneVar(v);
              c.name = uniqueName(v.name, siblings.map((x) => x.name));
              editVars((l) => insertVar(l, c, { afterId: v.id }));
              selectVar(c.id);
            }}
          >
            ⧉
          </button>
          <button
            title="删除"
            onClick={async () => {
              if (v.children?.length && !(await ask(`「${v.name}」里面还有 ${v.children.length} 项，一起删掉吗？（可以撤销）`, { ok: '删除', danger: true }))) return;
              editVars((l) => removeVar(l, v.id));
              if (selected === v.id) selectVar(null);
            }}
          >
            ✕
          </button>
        </span>
      </div>
      {v.children && v.children.length > 0 && <ul className="vlist">{v.children.map((c, j) => row(c, depth + 1, v.children!, j, v.kind === 'table'))}</ul>}
    </li>
  );

  return (
    <aside className="list-panel var-panel">
      <div className="panel-head">
        变量 <span className="count">{vars.length}</span>
        <span className="sp" />
        <div className="menu-wrap">
          <button className="small primary" onClick={() => setMenu((m) => !m)}>
            ＋ 模板
          </button>
          {menu && (
            <>
              <div className="menu-veil" onClick={() => setMenu(false)} />
              <div className="menu">
                {TEMPLATES.map((t, i) => (
                  <button key={t.name} onClick={() => addTemplate(i)}>
                    <b>{t.name}</b>
                    <span className="hint">{t.about}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="add-row">
        <span className="hint">加一个：</span>
        {ADD_KINDS.map((k) => (
          <button key={k} className="small" onClick={() => add(k)} title={sel ? (placeFor(k).intoId ? `加到「${sel.name}」里面` : `加到「${sel.name}」后面`) : '加到最后'}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {onBar && <div className="drag-tip hint">按住变量拖到右边画布上，就能放进状态栏</div>}
      <ul className="vlist root">
        {vars.map((v, i) => row(v, 0, vars, i, false))}
        {!vars.length && <li className="empty">还没有变量。点上面的类型加一个，或者从「＋ 模板」里挑一组现成的</li>}
      </ul>
      <div className={'problems' + (list.length ? ' has' : '')}>
        {list.length ? (
          <>
            <div className="warn">还有 {list.length} 个问题要改：</div>
            {list.slice(0, 6).map((p) => (
              <div key={p}>· {p}</div>
            ))}
            {list.length > 6 && <div>……</div>}
          </>
        ) : (
          <span className="ok">✓ 变量设置没有问题</span>
        )}
      </div>
    </aside>
  );
}
