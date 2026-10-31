// Middle panel, 「角色卡」 tab: card info, greetings, avatar, card settings and what an import found.
import { useMemo } from 'react';
import { pickAvatar } from '../../cardActions';
import { useCard } from '../../cardStore';
import { detectMvuParts, PART_LABEL, type MvuPart } from '../../mvu/card';
import type { CardInfo, CardSettings, Takeover } from '../../mvu/types';
import { Field } from '../common';

const TAKE_KEY: Record<MvuPart['kind'], keyof Takeover> = { entry: 'entries', regex: 'regexes', script: 'scripts' };

export function CardForm() {
  const card = useCard((s) => s.project.card);
  const settings = useCard((s) => s.project.settings);
  const avatar = useCard((s) => s.project.avatar);
  const base = useCard((s) => s.project.base);
  const takeover = useCard((s) => s.project.takeover);
  const notes = useCard((s) => s.notes);
  const { edit } = useCard.getState();

  const setCard = (patch: Partial<CardInfo>, key?: string) => edit((p) => ({ ...p, card: { ...p.card, ...patch } }), key && `card:${key}`);
  const setSettings = (patch: Partial<CardSettings>) => edit((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const greetings = card.greetings.length ? card.greetings : [''];
  const setGreeting = (i: number, text: string) => setCard({ greetings: greetings.map((g, j) => (j === i ? text : g)) }, `greet:${i}`);
  const parts = useMemo(() => (base ? detectMvuParts(base) : []), [base]);

  return (
    <div className="scroll form">
      <h3 className="sec">基本信息</h3>
      <Field label="角色名">
        <input value={card.name} onChange={(e) => setCard({ name: e.target.value }, 'name')} />
      </Field>
      <Field label="头像" note="导出的 PNG 角色卡就是这张图；不选的话用一张渐变色的图代替">
        <div className="avatar-row">
          {avatar ? <img className="avatar" src={`data:image/png;base64,${avatar}`} alt="头像" /> : <div className="avatar none">没有图片</div>}
          <div className="col">
            <button className="small" onClick={pickAvatar}>
              选择图片
            </button>
            {avatar && (
              <button className="small" onClick={() => edit((p) => ({ ...p, avatar: undefined }))}>
                去掉
              </button>
            )}
          </div>
        </div>
      </Field>
      <Field label="角色描述" note="AI 每轮都会看到。写角色的外貌、性格、经历等">
        <textarea rows={6} value={card.description} onChange={(e) => setCard({ description: e.target.value }, 'description')} />
      </Field>

      <h3 className="sec">开场白</h3>
      {greetings.map((g, i) => (
        <Field
          key={i}
          label={i === 0 ? '第一条' : `备选 ${i}`}
          note={i === 0 ? '玩家开始聊天时看到的第一条消息。状态栏会自动出现在它下面' : '玩家可以左右滑动切换开场白'}
        >
          <textarea rows={i === 0 ? 6 : 4} value={g} onChange={(e) => setGreeting(i, e.target.value)} />
          <div className="inline">
            {i > 0 && (
              <button className="small" title="设为第一条" onClick={() => setCard({ greetings: [g, ...greetings.filter((_, j) => j !== i)] })}>
                设为第一条
              </button>
            )}
            {i > 1 && (
              <button
                className="small"
                title="上移"
                onClick={() => {
                  const l = [...greetings];
                  [l[i - 1], l[i]] = [l[i], l[i - 1]];
                  setCard({ greetings: l });
                }}
              >
                ↑
              </button>
            )}
            {greetings.length > 1 && (
              <button className="small" onClick={() => setCard({ greetings: greetings.filter((_, j) => j !== i) })}>
                删掉
              </button>
            )}
          </div>
        </Field>
      ))}
      <div className="inline pad">
        <button className="small" onClick={() => setCard({ greetings: [...greetings, ''] })}>
          ＋ 加一条备选开场白
        </button>
      </div>

      <details className="more">
        <summary>更多信息（可不填）</summary>
        <Field label="性格摘要">
          <textarea rows={2} value={card.personality} onChange={(e) => setCard({ personality: e.target.value }, 'personality')} />
        </Field>
        <Field label="场景">
          <textarea rows={3} value={card.scenario} onChange={(e) => setCard({ scenario: e.target.value }, 'scenario')} />
        </Field>
        <Field label="作者">
          <input value={card.creator} onChange={(e) => setCard({ creator: e.target.value }, 'creator')} />
        </Field>
        <Field label="版本">
          <input value={card.version} onChange={(e) => setCard({ version: e.target.value }, 'version')} />
        </Field>
        <Field label="标签" note="用逗号分开">
          <input
            value={card.tags.join(', ')}
            onChange={(e) => setCard({ tags: e.target.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) }, 'tags')}
          />
        </Field>
        <Field label="作者备注" note="给玩家看的说明，AI 看不到">
          <textarea rows={4} value={card.creatorNotes} onChange={(e) => setCard({ creatorNotes: e.target.value }, 'creatorNotes')} />
        </Field>
      </details>

      <h3 className="sec">卡的设置</h3>
      <Field label="允许玩家修改变量" note="打开后，可以在每个变量里勾选「玩家可改」。状态栏上的编辑按钮在下一版加入">
        <label className="chk">
          <input type="checkbox" checked={settings.allowPlayerEdit} onChange={(e) => setSettings({ allowPlayerEdit: e.target.checked })} />
          允许
        </label>
      </Field>
      <Field label="在卡里存一份工程" note="导出的卡里会藏一份变量设置，以后把这张卡拖回工具就能接着改。不影响玩家使用">
        <label className="chk">
          <input type="checkbox" checked={settings.embedProject} onChange={(e) => setSettings({ embedProject: e.target.checked })} />
          存一份
        </label>
      </Field>

      {(notes.length > 0 || parts.length > 0) && <h3 className="sec">导入说明</h3>}
      {notes.length > 0 && (
        <div className="callout">
          {notes.map((n, i) => (
            <div key={i}>· {n}</div>
          ))}
        </div>
      )}
      {parts.length > 0 && (
        <Field label="替换掉原卡的" note="原卡里这些 MVU 相关的部分，导出时会被工具生成的新版本替换。取消勾选就保留原样（可能会和新生成的重复）">
          <div className="takeover">
            {parts.map((part) => {
              const k = TAKE_KEY[part.kind];
              const list = (takeover?.[k] ?? []) as (string | number)[];
              const on = list.includes(part.id);
              return (
                <label key={part.kind + part.id} className="chk" title={part.why}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      edit((p) => {
                        const t: Takeover = { entries: [], regexes: [], scripts: [], ...p.takeover };
                        const cur = t[k] as (string | number)[];
                        return { ...p, takeover: { ...t, [k]: e.target.checked ? [...cur, part.id] : cur.filter((x) => x !== part.id) } };
                      })
                    }
                  />
                  <span className="muted">{PART_LABEL[part.kind]}</span> {part.name || '（没名字）'}
                  {part.why && <span className="hint"> · {part.why}</span>}
                </label>
              );
            })}
          </div>
        </Field>
      )}
    </div>
  );
}
