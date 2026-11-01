// 「给 AI」 tab of a regex beautification made on the canvas: the block's tag, what to tell the AI so it writes the
// block, a sample to try it with, and what the player needs to see it.
import { useMemo } from 'react';
import { useCard } from '../../cardStore';
import { builderPrompt, builderSample, cleanTag, compileBuilder, type RegexBuilder } from '../../lib/builder';
import { addSample } from '../../regexBuilder';
import { useStore } from '../../store';
import { CopyButton, Field } from '../common';

export function BuilderTab() {
  const p = useCard((s) => s.project);
  const key = useCard((s) => s.builder?.key);
  const edit = useCard((s) => s.edit);
  const b: RegexBuilder = useMemo(() => ({ v: 1, tag: p.card.name, fields: p.vars, bar: p.bar ?? { v: 1 }, key }), [p, key]);
  const tag = cleanTag(b.tag);
  const prompt = useMemo(() => builderPrompt(b), [b]);
  const sample = useMemo(() => builderSample(b), [b]);
  const problems = useMemo(() => compileBuilder(b).problems, [b]);

  return (
    <div className="scroll form">
      <Field
        label="块的标签"
        note={
          <>
            AI 把状态写在 <code>&lt;{tag}&gt;</code> …… <code>&lt;/{tag}&gt;</code> 之间，正则认的就是它。不能有空格和 &lt; &gt; / 这些符号
          </>
        }
      >
        <input value={p.card.name} placeholder="状态栏" spellCheck={false} onChange={(e) => edit((x) => ({ ...x, card: { ...x.card, name: e.target.value } }), 'card:name')} />
      </Field>
      <Field label="给 AI 的格式说明" note="放进预设、角色卡的描述或常驻的世界书条目里，AI 每次回复的最后就会写出这个块。左边每个字段的「给 AI 的说明」也会写进去">
        <textarea className="mono" readOnly rows={Math.min(16, prompt.split('\n').length + 1)} value={prompt} />
        <div className="inline">
          <CopyButton text={prompt} />
        </div>
      </Field>
      <Field label="例子" note="用每个字段的示例值写出来的块。放进测试消息，回到正则以后预览里就能看到效果">
        <pre className="mono builder-sample">{sample}</pre>
        <div className="inline">
          <button
            className="small"
            onClick={() => useStore.getState().notify(addSample(b, true) ? '已放进测试消息' : '测试消息里已经有这一段了')}
          >
            放进测试消息
          </button>
        </div>
      </Field>
      <div className="callout">
        换出来的是一张<b>前端卡片</b>（<code>```html</code> 代码块）：玩家要装<b>酒馆助手</b>才能看到画出来的样子，没装的话只会显示一段代码。
        <br />
        正则设置里保持勾着「仅格式显示」，卡片就只给人看，不会发给 AI。
      </div>
      {problems.length > 0 && (
        <div className="callout bad-box">
          这些组件在正则美化里用不了，会被跳过：
          {problems.map((x) => (
            <div key={x}>· {x}</div>
          ))}
        </div>
      )}
    </div>
  );
}
