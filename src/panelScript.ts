// 解析型面板 regexes: starting a new one, putting a sample block into the test message, and turning a front-end card
// someone wrote into one.
import { ask } from './components/dialog';
import { newScript } from './lib/defaults';
import { cleanTag } from './lib/builder';
import { newId } from './lib/id';
import { compilePanel, newPanel, panelSample, recognizePanel, type PanelDef } from './lib/panel';
import { useStore } from './store';

/** Put a sample block into the test message, when no block with this tag is there yet (or always). */
export function addPanelSample(p: PanelDef, always = false) {
  const st = useStore.getState();
  const t = st.project.testText;
  const sample = panelSample(p);
  if (t.includes(sample) || (!always && t.includes(`<${cleanTag(p.tag)}>`))) return false;
  st.setText(t.trim() ? t.replace(/\s*$/, '\n\n') + sample : sample);
  return true;
}

/** A tag no other regex looks for yet, so the new panel shows in the preview instead of being taken by another. */
function freeTag(): string {
  const used = (t: string) => useStore.getState().project.scripts.some((s) => s.findRegex.includes(`<${t}>`) || s.findRegex.includes(`<${t}\\>`));
  const tag = ['战况', '面板', '信息'].find((t) => !used(t));
  if (tag) return tag;
  let i = 2;
  while (used('战况' + i)) i++;
  return '战况' + i;
}

/** A new panel with a few sections and rules, already working on a sample in the test message. */
export function newPanelScript() {
  const p = { ...newPanel(), tag: freeTag() };
  const c = compilePanel(p);
  const st = useStore.getState();
  st.appendScripts([{ ...newScript('解析面板'), findRegex: c.findRegex, replaceString: c.replaceString }]);
  st.setTab('code');
  addPanelSample(p);
}

/**
 * Make a panel from a card like the battle panel: a new regex next to it with what was recognized, the old one
 * turned off so they don't both show. False: nothing to recognize, or the user would rather not.
 */
export async function panelFromCard(id: string): Promise<boolean> {
  const st = useStore.getState();
  const s = st.project.scripts.find((x) => x.id === id);
  const p = s && recognizePanel(s);
  if (!s || !p) return false;
  const named = p.sections.length;
  const ok = await ask(
    `认出了 ${named} 个分段、${p.rules.length} 条行规则（数值条、字段、属性……）。\n会新建一条「解析型面板」正则，之后分段和规则都能直接改；原来这条会先停用（不删）。\n\n原卡里特别的排版、动画新面板里没有。想对比的话，把原来那条重新勾上就行。`,
    { ok: '做成面板' },
  );
  if (!ok) return false;
  const c = compilePanel(p);
  st.appendScripts([
    {
      ...s,
      id: newId(),
      scriptName: `${s.scriptName}（面板）`,
      findRegex: c.findRegex,
      replaceString: c.replaceString,
      trimStrings: [...s.trimStrings],
      placement: [...s.placement],
      disabled: false,
    },
  ]);
  useStore.getState().updateScript(id, { disabled: true });
  useStore.getState().setTab('code');
  addPanelSample(p);
  useStore.getState().notify('已做成面板，原来那条停用了');
  return true;
}
