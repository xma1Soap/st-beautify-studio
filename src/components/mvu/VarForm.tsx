// Middle panel, 「变量」 tab: everything about the selected variable, in plain words.
import { useEffect, useState } from 'react';
import { useCard } from '../../cardStore';
import { changeKind, findVar, locate, patchField, uniqueName, updateVar, wrapInGroup } from '../../mvu/tree';
import type { Stage, VarKind, VarNode } from '../../mvu/types';
import { defaultValue, stageKey, varKey } from '../../mvu/vars';
import { Field, LinesInput, NumberInput } from '../common';
import { KIND_LABEL } from './VarTree';
import { ask } from '../dialog';

const KIND_NOTE: Record<VarKind, string> = {
  number: '好感度、金钱、生命值这类数字，可以设范围和阶段',
  text: '一段文字，比如地点、当前想法',
  bool: '只有「是」和「否」，比如是否结婚',
  choice: '只能从几个固定的词里选一个，比如心情',
  list: '一串文字，比如身上的状态、学会的技能',
  group: '把相关的变量放在一起，比如一个角色的所有数值',
  table: '可以随剧情增加新行的表，比如物品栏、人物表',
};

export function VarForm() {
  const vars = useCard((s) => s.project.vars);
  const selected = useCard((s) => s.selectedVarId);
  const allowPlayerEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const { editVars, selectVar } = useCard.getState();
  const at = selected ? locate(vars, selected) : null;
  if (!at) return <div className="empty big">左边选一个变量来设置它，或者先加一个</div>;

  const v = at.node;
  const parent = at.parent;
  const inTable = parent?.kind === 'table';
  const key = (f: string) => `var:${v.id}:${f}`;

  /** Change this variable (a table field goes through its table so the starting rows stay in step). */
  const set = (patch: Partial<VarNode>, field?: string) =>
    editVars((l) => {
      if (inTable) {
        const t = findVar(l, parent!.id);
        return t ? updateVar(l, t.id, patchField(t, v.id, patch)) : l;
      }
      return updateVar(l, v.id, patch);
    }, field && key(field));

  /** 玩家可改 on or off for everything in this group (a table counts as one) */
  const markAll = (on: boolean) =>
    editVars((l) => {
      const mark = (n: VarNode): VarNode => (n.kind === 'group' ? { ...n, children: (n.children ?? []).map(mark) } : { ...n, playerEditable: on || undefined });
      const g = findVar(l, v.id);
      return g ? updateVar(l, v.id, { children: (g.children ?? []).map(mark) }) : l;
    }, key('editable-all'));

  const kinds = (Object.keys(KIND_LABEL) as VarKind[]).filter((k) => !inTable || (k !== 'group' && k !== 'table'));

  return (
    <div className="scroll form">
      {inTable && (
        <div className="callout">
          这是表格「{parent!.name}」每一行里的一个字段。下面的初始值是<b>新加一行时的默认值</b>。
        </div>
      )}
      <Field label="名字" note={<>状态栏和 AI 都用这个名字找它；不能有 . / ~ \ 符号{v.readonly && <>，存的时候会写成 <code>{varKey(v)}</code></>}</>}>
        <input value={v.name} onChange={(e) => set({ name: e.target.value }, 'name')} />
      </Field>
      <Field label="类型" note={KIND_NOTE[v.kind]}>
        <select
          value={v.kind}
          onChange={async (e) => {
            const k = e.target.value as VarKind;
            if (v.children?.length && k !== v.kind && !(await ask(`改成「${KIND_LABEL[k]}」会去掉里面的 ${v.children.length} 项，继续吗？（可以撤销）`, { ok: '改', danger: true }))) return;
            const patch = changeKind(v, k);
            if (inTable && patch.init === undefined) patch.init = defaultValue({ ...v, ...patch } as VarNode);
            set(patch);
          }}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>

      {v.kind === 'number' && <NumberFields v={v} set={set} />}
      {v.kind === 'number' && !inTable && (
        <Field label="阶段" note="给数字的范围起名字，比如好感度 0 起叫「陌生」、40 起叫「朋友」。AI 和状态栏都能看到当前阶段">
          {parent?.kind === 'group' ? (
            <StageEditor v={v} set={set} />
          ) : (
            <div className="inline">
              <span className="hint">阶段要放在分组里的数字上才能用（会多出一个自动算的 {stageKey(v)}）。</span>
              <button
                className="small"
                onClick={() => {
                  const r = wrapInGroup(vars, v.id, uniqueName('新分组', at.siblings.map((x) => x.name)));
                  editVars(() => r.vars);
                  selectVar(v.id);
                }}
              >
                放进一个新分组
              </button>
            </div>
          )}
        </Field>
      )}
      {v.kind === 'text' && (
        <Field label={inTable ? '默认值' : '初始值'}>
          <textarea rows={2} value={String(v.init ?? '')} onChange={(e) => set({ init: e.target.value }, 'init')} />
        </Field>
      )}
      {v.kind === 'bool' && (
        <Field label={inTable ? '默认值' : '初始值'}>
          <label className="chk">
            <input type="checkbox" checked={!!v.init} onChange={(e) => set({ init: e.target.checked })} />
            一开始是「是」
          </label>
        </Field>
      )}
      {v.kind === 'choice' && (
        <>
          <Field label="可选的词" note="每行一个">
            <LinesInput value={v.options ?? []} onChange={(options) => set({ options, init: options.includes(String(v.init)) ? v.init : options[0] }, 'options')} rows={4} />
          </Field>
          <Field label={inTable ? '默认值' : '初始值'}>
            <select value={String(v.init ?? v.options?.[0] ?? '')} onChange={(e) => set({ init: e.target.value })}>
              {(v.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
        </>
      )}
      {v.kind === 'list' && (
        <Field label={inTable ? '默认内容' : '初始内容'} note="每行一项，可以空着">
          <LinesInput value={(v.init as string[]) ?? []} onChange={(init) => set({ init }, 'init')} />
        </Field>
      )}
      {v.kind === 'group' && (
        <div className="callout">分组本身没有值。选中它再点左边的类型按钮，就能往里面加变量；状态栏里一个分组显示成一块。</div>
      )}
      {v.kind === 'table' && <TableFields v={v} set={set} />}

      {v.kind !== 'group' && (
        <Field adv label="AI 不能改" note="勾上后会告诉 AI 不要改它，比如角色的基础属性、玩家自己定的设定">
          <label className="chk">
            <input type="checkbox" checked={!!v.readonly} onChange={(e) => set({ readonly: e.target.checked || undefined })} />
            只读
          </label>
        </Field>
      )}
      {v.kind !== 'group' && !inTable && (
        <Field label="什么时候变" note="写给 AI 看的规则，每行一条。写得越具体，AI 改得越准">
          <LinesInput value={v.rules} onChange={(rules) => set({ rules }, 'rules')} rows={4} placeholder={'比如：\n友善互动时 +1~3\n每轮最多变化 10'} />
        </Field>
      )}
      {v.kind !== 'group' && !inTable && (
        <Field
          label="玩家可改"
          note={
            !allowPlayerEdit
              ? '要先在「角色卡」页打开「允许玩家修改变量」'
              : v.kind === 'table'
                ? '玩家能在状态栏的修改面板里加行、删行、改每一行'
                : '玩家能用状态栏上的「修改按钮」改这一项。想一次勾一大批：选中它所在的分组，点「全部可改」'
          }
        >
          <label className="chk">
            <input type="checkbox" disabled={!allowPlayerEdit} checked={!!v.playerEditable} onChange={(e) => set({ playerEditable: e.target.checked || undefined })} />
            允许
          </label>
        </Field>
      )}
      {inTable && allowPlayerEdit && <div className="hint pad">表格里的字段跟着整张表走：给表格「{parent!.name}」勾上「玩家可改」，玩家就能改每一行。</div>}
      {v.kind === 'group' && allowPlayerEdit && (
        <Field label="玩家可改" note="一次给这一组里的全部变量勾上或取消">
          <span className="inline">
            <button className="small" onClick={() => markAll(true)}>
              全部可改
            </button>
            <button className="small" onClick={() => markAll(false)}>
              全部不可改
            </button>
          </span>
        </Field>
      )}
    </div>
  );
}

type Setter = (patch: Partial<VarNode>, field?: string) => void;

function NumberFields({ v, set }: { v: VarNode; set: Setter }) {
  return (
    <>
      <Field label="初始值">
        <NumberInput value={v.init as number} onChange={(n) => n !== undefined && set({ init: n }, 'init')} />
      </Field>
      <Field label="范围" note="AI 改出范围时会被自动拉回来；空着表示不限">
        <div className="inline">
          最小 <NumberInput optional value={v.min} onChange={(min) => set({ min }, 'min')} />
          最大 <NumberInput optional value={v.max} onChange={(max) => set({ max }, 'max')} />
          <label className="chk">
            <input type="checkbox" checked={!!v.integer} onChange={(e) => set({ integer: e.target.checked || undefined })} />
            只用整数
          </label>
        </div>
      </Field>
    </>
  );
}

function StageEditor({ v, set }: { v: VarNode; set: Setter }) {
  const stages = v.stages ?? [];
  const put = (next: Stage[]) => set({ stages: next.length ? next : undefined }, 'stages');
  const sorted = [...stages].sort((a, b) => a.from - b.from);
  return (
    <div className="stages">
      {stages.map((s, i) => (
        <div className="inline" key={i}>
          从 <NumberInput value={s.from} onChange={(n) => n !== undefined && put(stages.map((x, j) => (j === i ? { ...x, from: n } : x)))} /> 起叫
          <input className="stage-label" value={s.label} onChange={(e) => put(stages.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button className="small" title="删掉这个阶段" onClick={() => put(stages.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="inline">
        <button
          className="small"
          onClick={() => {
            const last = sorted[sorted.length - 1];
            const from = last ? last.from + 20 : (v.min ?? 0);
            put([...stages, { from, label: `阶段${stages.length + 1}` }]);
          }}
        >
          ＋ 加一个阶段
        </button>
        {sorted.length > 0 && (
          <span className="hint">
            {sorted.map((s, i) => `${i === 0 && v.min != null && v.min < s.from ? v.min : s.from}${i + 1 < sorted.length ? `~${sorted[i + 1].from - (v.integer ? 1 : 0)}` : ' 以上'}：${s.label}`).join('　')}
          </span>
        )}
      </div>
    </div>
  );
}

function TableFields({ v, set }: { v: VarNode; set: Setter }) {
  const fields = v.children ?? [];
  const numbers = fields.filter((f) => f.kind === 'number');
  return (
    <>
      <Field label="每一行叫" note="一行代表什么，比如「物品名」「人物」。会告诉 AI 用它当这一行的名字">
        <input value={v.rowName ?? ''} onChange={(e) => set({ rowName: e.target.value }, 'rowName')} />
      </Field>
      <Field label="字段" note="在左边点字段来改它；先选中这个表格，再点左边的类型按钮就能加字段">
        <div className="chips">
          {fields.map((f) => (
            <span key={f.id} className="chip">
              {f.name}
              <span className="muted">（{KIND_LABEL[f.kind]}）</span>
            </span>
          ))}
          {!fields.length && <span className="warn">还没有字段</span>}
        </div>
      </Field>
      <Field adv label="为 0 时删掉" note="这个数字降到 0 时，整行自动删掉，比如物品用完了">
        <select value={v.dropRowWhenZero ?? ''} onChange={(e) => set({ dropRowWhenZero: e.target.value || undefined })}>
          <option value="">不删</option>
          {numbers.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="一开始的行" note="开局时表格里已经有的内容，可以空着">
        <RowsEditor v={v} set={set} />
      </Field>
    </>
  );
}

type Row = Record<string, unknown>;

function RowsEditor({ v, set }: { v: VarNode; set: Setter }) {
  return <RowsInput v={v} value={v.init} onChange={(init) => set({ init }, 'rows')} />;
}

/** The rows of a table, editable: `value` is { row name: { field: value } }. */
export function RowsInput({ v, value, onChange }: { v: VarNode; value: unknown; onChange: (rows: Record<string, Row>) => void }) {
  const fields = v.children ?? [];
  const rows = Object.entries((value ?? {}) as Record<string, Row>);
  const put = (next: [string, Row][]) => onChange(Object.fromEntries(next));
  const cell = (f: VarNode, row: Row, i: number) => {
    const k = varKey(f);
    const val = row[k] ?? f.init ?? defaultValue(f);
    const setCell = (x: unknown) => put(rows.map(([n, r], j) => [n, j === i ? { ...r, [k]: x } : r]));
    switch (f.kind) {
      case 'number':
        return <NumberInput value={val as number} onChange={(n) => n !== undefined && setCell(n)} />;
      case 'bool':
        return <input type="checkbox" checked={!!val} onChange={(e) => setCell(e.target.checked)} />;
      case 'choice':
        return (
          <select value={String(val)} onChange={(e) => setCell(e.target.value)}>
            {(f.options ?? []).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      case 'list':
        return (
          <input
            value={Array.isArray(val) ? val.join('、') : ''}
            placeholder="用顿号分开"
            onChange={(e) => setCell(e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))}
          />
        );
      default:
        return <input value={String(val ?? '')} onChange={(e) => setCell(e.target.value)} />;
    }
  };
  return (
    <div className="rows">
      {rows.length > 0 && (
        <table className="rows-table">
          <thead>
            <tr>
              <th>{v.rowName || '名字'}</th>
              {fields.map((f) => (
                <th key={f.id}>{f.name}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, row], i) => (
              <tr key={i}>
                <td>
                  <RowName name={name} taken={rows.map(([n]) => n).filter((_, j) => j !== i)} onChange={(n) => put(rows.map(([o, r], j) => [j === i ? n : o, r]))} />
                </td>
                {fields.map((f) => (
                  <td key={f.id}>{cell(f, row ?? {}, i)}</td>
                ))}
                <td>
                  <button className="small" title="删掉这一行" onClick={() => put(rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        className="small"
        disabled={!fields.length}
        onClick={() => {
          const row: Row = {};
          for (const f of fields) row[varKey(f)] = f.init ?? defaultValue(f);
          put([...rows, [uniqueName(`新${v.rowName || '一行'}`, rows.map(([n]) => n)), row]]);
        }}
      >
        ＋ 加一行
      </button>
    </div>
  );
}

/** A value for a variable (not a group), as the starting value of one greeting. */
export function ValueInput({ v, value, onChange }: { v: VarNode; value: unknown; onChange: (x: unknown) => void }) {
  switch (v.kind) {
    case 'number':
      return <NumberInput value={value as number} onChange={(n) => n !== undefined && onChange(n)} />;
    case 'bool':
      return (
        <label className="chk">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />是
        </label>
      );
    case 'choice':
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(v.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'list':
      return <LinesInput value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} rows={2} placeholder="每行一项" />;
    case 'table':
      return <RowsInput v={v} value={value} onChange={onChange} />;
    default:
      return <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Row name: only saved when it is not empty and not taken, so typing never merges or loses rows. */
function RowName({ name, taken, onChange }: { name: string; taken: string[]; onChange: (n: string) => void }) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const bad = !text.trim() || taken.includes(text.trim());
  return (
    <input
      className={bad ? 'bad' : ''}
      title={bad ? '名字不能为空，也不能和别的行重复' : ''}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        if (t && !taken.includes(t)) onChange(t);
      }}
    />
  );
}
