// Middle panel, 「AI 看到的」 tab: everything the tool writes into the card, read-only, for the curious.
import { useMemo } from 'react';
import { useCard } from '../../cardStore';
import { ENTRY_NAMES, SCRIPT_NAMES } from '../../mvu/card';
import { initvarText, outputFormatText, updateRulesText, varListText } from '../../mvu/prompts';
import { REGEX_NAMES } from '../../mvu/regexes';
import { schemaScript } from '../../mvu/schema';
import { CopyButton } from '../common';

export function AiTab() {
  const vars = useCard((s) => s.project.vars);
  const blocks = useMemo(
    () => [
      { title: `世界书「${ENTRY_NAMES.initvar}」`, about: '开局时变量的值。这个条目不发给 AI，只给 MVU 读', text: initvarText(vars) },
      { title: `世界书「${ENTRY_NAMES.varList}」`, about: '每轮把变量的当前值发给 AI', text: varListText() },
      { title: `世界书「${ENTRY_NAMES.rules}」`, about: '每个变量是什么、什么时候变（来自「什么时候变」）', text: updateRulesText(vars) },
      { title: `世界书「${ENTRY_NAMES.format}」`, about: '教 AI 在回复最后写变量更新', text: outputFormatText(vars) },
      { title: `酒馆助手脚本「${SCRIPT_NAMES.schema}」`, about: '变量的结构和范围。AI 改错时 MVU 会拒绝或拉回范围', text: schemaScript(vars) },
    ],
    [vars],
  );
  return (
    <div className="scroll form ai-tab">
      <div className="callout">
        下面这些都由工具根据你的变量自动生成，导出时会写进角色卡，<b>不需要手动复制</b>。想知道 AI 实际看到了什么，或者想拿去别处用，可以在这里看。
        <br />
        另外还会加入脚本「{SCRIPT_NAMES.mvu}」和 {Object.keys(REGEX_NAMES).length} 条正则：{Object.values(REGEX_NAMES).join('、')}。
      </div>
      {blocks.map((b) => (
        <section key={b.title} className="ai-block">
          <div className="ai-head">
            <b>{b.title}</b>
            <span className="sp" />
            <CopyButton text={b.text} />
          </div>
          <div className="hint">{b.about}</div>
          <pre className="code-view">{b.text}</pre>
        </section>
      ))}
    </div>
  );
}
