// Middle panel, 「进阶」 tab: everything the tool writes into the card. The update rules and the output format can be
// rewritten by hand; the rest is shown read-only, for the curious and for copying elsewhere.
import { useMemo, useState } from 'react';
import { useCard } from '../../cardStore';
import { AUTO_TEXT, ENTRY_NAMES, handStale, SCRIPT_NAMES } from '../../mvu/card';
import { barOf, compileBar } from '../../mvu/bar';
import { initvarText, varListText } from '../../mvu/prompts';
import { mvuRegexes } from '../../mvu/regexes';
import { mvuScript, schemaScript } from '../../mvu/schema';
import type { HandEntry } from '../../mvu/types';
import { CodeBox } from '../CodeBox';
import { CopyButton } from '../common';

const REGEX_ABOUT: Record<string, string> = {
  hideUpdate: 'AI 写的变量更新只给 MVU 读，下一轮发给 AI 时去掉，省字数',
  hideInitvar: '开场白里自带的初始值，玩家和 AI 都不用看到',
  foldUpdating: 'AI 还在写变量更新时，在聊天里折叠成一行',
  foldUpdate: '写完的变量更新折叠起来，点开能看',
  statusBar: '把 MVU 放在每条消息末尾的占位换成状态栏',
};

export function AiTab() {
  const vars = useCard((s) => s.project.vars);
  const bar = useCard((s) => s.project.bar);
  const allowEdit = useCard((s) => s.project.settings.allowPlayerEdit);
  const pid = useCard((s) => s.project.id);
  const regexes = useMemo(
    () => mvuRegexes(compileBar(barOf({ bar, vars }), vars, { allowEdit, key: pid }), (slot) => slot.replace('regex:', '')),
    [bar, vars, allowEdit, pid],
  );
  return (
    <div className="scroll form ai-tab">
      <div className="callout">
        这一页是给想看、想改细节的作者准备的，<b>平时不用管</b>：下面的内容都由工具根据你的变量和状态栏自动生成，导出时写进角色卡。
        <br />
        「变量更新规则」和「输出格式」可以手动改；状态栏的样式可以在「状态栏」页的整体配色最下面自己写 CSS。
      </div>

      <h3 className="sec">世界书（发给 AI 的）</h3>
      <ReadBlock title={ENTRY_NAMES.initvar} about="开局时变量的值。这个条目不发给 AI，只给 MVU 读" text={initvarText(vars)} />
      <ReadBlock title={ENTRY_NAMES.varList} about="每轮把变量的当前值发给 AI" text={varListText()} />
      <HandBlock k="rules" about="每个变量是什么、什么时候变（来自变量里的「什么时候变」）" />
      <HandBlock k="format" about="教 AI 在回复最后写变量更新" />

      <h3 className="sec">酒馆助手脚本</h3>
      <ReadBlock title={SCRIPT_NAMES.mvu} about="加载 MVU 本体" text={mvuScript()} />
      <ReadBlock title={SCRIPT_NAMES.schema} about="变量的结构和范围。AI 改错时 MVU 会拒绝或拉回范围" text={schemaScript(vars)} />

      <h3 className="sec">正则（{regexes.length} 条）</h3>
      {regexes.map((r) => (
        <section key={r.id} className="ai-block">
          <div className="ai-head">
            <b>{r.scriptName}</b>
          </div>
          <div className="hint">{REGEX_ABOUT[r.id] ?? ''}</div>
          <div className="ai-find">
            <span className="muted">查找</span>
            <code>{r.findRegex}</code>
            <span className="sp" />
            <CopyButton text={r.findRegex} />
          </div>
          {r.replaceString ? <Long label="替换成" text={r.replaceString} open={r.replaceString.length < 400} /> : <div className="hint">替换成空（直接去掉）</div>}
        </section>
      ))}
    </div>
  );
}

function ReadBlock({ title, about, text }: { title: string; about: string; text: string }) {
  return (
    <section className="ai-block">
      <div className="ai-head">
        <b>{title}</b>
        <span className="sp" />
        <CopyButton text={text} />
      </div>
      <div className="hint">{about}</div>
      <pre className="code-view">{text}</pre>
    </section>
  );
}

/** Long code, folded until asked for. */
function Long({ label, text, open }: { label: string; text: string; open?: boolean }) {
  return (
    <details className="more" open={open || undefined}>
      <summary>
        {label}（{text.length} 字）
      </summary>
      <div className="inline">
        <span className="sp" />
        <CopyButton text={text} />
      </div>
      <pre className="code-view">{text}</pre>
    </details>
  );
}

/** A world book entry the author may rewrite. */
function HandBlock({ k, about }: { k: HandEntry; about: string }) {
  const vars = useCard((s) => s.project.vars);
  const hand = useCard((s) => s.project.custom?.[k]);
  const custom = useCard((s) => s.project.custom);
  const auto = useMemo(() => AUTO_TEXT[k](vars), [k, vars]);
  const stale = handStale({ vars, custom }, k);
  const [seeNew, setSeeNew] = useState(false);
  const put = (h: { text: string; from: string } | undefined, key?: string) =>
    useCard.getState().edit((p) => {
      const next = { ...p.custom };
      if (h) next[k] = h;
      else delete next[k];
      return { ...p, custom: Object.keys(next).length ? next : undefined };
    }, key);
  const title = ENTRY_NAMES[k];
  return (
    <section className={'ai-block' + (hand ? ' hand' : '')}>
      <div className="ai-head">
        <b>{title}</b>
        {hand && <span className="badge">已手改</span>}
        <span className="sp" />
        <CopyButton text={hand?.text ?? auto} />
        {hand ? (
          <button
            className="small"
            onClick={() => {
              if (confirm(`把「${title}」改回自动生成吗？手改的内容会丢掉。（可以撤销）`)) put(undefined);
            }}
          >
            改回自动生成
          </button>
        ) : (
          <button className="small" onClick={() => put({ text: auto, from: auto })} title="以现在自动生成的为底稿，自己改">
            手动改
          </button>
        )}
      </div>
      <div className="hint">
        {about}
        {hand && '。现在用的是你改过的版本；以后改变量，这里不会再自动跟着变'}
      </div>
      {hand && stale && (
        <div className="callout warn-box">
          你手改之后，变量又改过了，自动生成的内容已经不一样了。手改的版本可能少了新变量，或者还写着删掉的变量。
          <div className="inline">
            <button className="small" onClick={() => setSeeNew(!seeNew)}>
              {seeNew ? '收起' : '看看现在自动生成的'}
            </button>
            <button className="small" onClick={() => put({ text: hand.text, from: auto })} title="我已经对过了，不用再提醒">
              我对过了，不再提醒
            </button>
          </div>
          {seeNew && <pre className="code-view">{auto}</pre>}
        </div>
      )}
      {hand ? (
        <CodeBox value={hand.text} onChange={(text) => put({ ...hand, text }, `custom:${k}`)} minHeight="160px" maxHeight="520px" />
      ) : (
        <pre className="code-view">{auto}</pre>
      )}
      {hand && !hand.text.trim() && <div className="warn">⚠ 内容是空的，AI 会什么都看不到</div>}
    </section>
  );
}
