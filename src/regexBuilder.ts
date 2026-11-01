// A regex beautification laid out on the canvas: opening it in the card editor, keeping the regex in step while it is
// edited there, and going back to the regex.
import { useCard } from './cardStore';
import { builderSample, cleanTag, compileBuilder, newBuilder, readBuilder, type RegexBuilder } from './lib/builder';
import { newScript } from './lib/defaults';
import { newId } from './lib/id';
import { newCardProject } from './mvu/card';
import type { CardProject } from './mvu/types';
import { useMode } from './mode';
import { useStore } from './store';
import { ask } from './components/dialog';

/** The beautification being edited, as the card editor has it (fields = variables, tag = card name). */
export function currentBuilder(): RegexBuilder | null {
  const st = useCard.getState();
  if (!st.builder) return null;
  const p = st.project;
  return { v: 1, tag: p.card.name, fields: p.vars, bar: p.bar ?? { v: 1 }, key: st.builder.key };
}

function projectOf(b: RegexBuilder): CardProject {
  const p = newCardProject();
  if (b.key) p.id = b.key;
  p.card = { ...p.card, name: b.tag };
  p.vars = b.fields;
  p.bar = b.bar;
  return p;
}

/** Put the block filled with the sample values into the test message, when no block with this tag is there yet. */
export function addSample(b: RegexBuilder, always = false) {
  const st = useStore.getState();
  const t = st.project.testText;
  const sample = builderSample(b);
  if (t.includes(sample) || (!always && t.includes(`<${cleanTag(b.tag)}>`))) return false;
  st.setText(t.trim() ? t.replace(/\s*$/, '\n\n') + sample : sample);
  return true;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Write the regex from the canvas now (it is otherwise written a moment after each change). */
function flush() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const st = useCard.getState();
  const b = currentBuilder();
  if (!st.builder || !b) return;
  const id = st.builder.scriptId;
  const s = useStore.getState().project.scripts.find((x) => x.id === id);
  if (!s) return;
  const c = compileBuilder(b);
  if (s.findRegex !== c.findRegex || s.replaceString !== c.replaceString) useStore.getState().updateScript(id, { findRegex: c.findRegex, replaceString: c.replaceString });
}

useCard.subscribe((st, prev) => {
  if (!st.builder) return;
  // clicking a component on the canvas while the fields are showing: go to its settings
  if (st.barSel && st.barSel !== prev.barSel && st.tab !== 'bar') st.setTab('bar');
  // only changes made here; opening it changes nothing (a regex changed by hand stays as it is until then)
  if (st.builder !== prev.builder || st.project === prev.project) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 300);
});

/** Open a regex made on the canvas there again. False: it wasn't made there, or the user would rather not. */
export async function openBuilder(scriptId: string): Promise<boolean> {
  const s = useStore.getState().project.scripts.find((x) => x.id === scriptId);
  const r = s && readBuilder(s);
  if (!s || !r) return false;
  if (r.edited && !(await ask('这条正则的代码在生成之后手动改过。回画布上再改的话，会按画布重新生成，手改的地方会被覆盖。继续吗？', { ok: '去画布上改' }))) return false;
  flush();
  const b = r.b.key ? r.b : { ...r.b, key: newId() };
  useCard.getState().openBuilder({ scriptId, name: s.scriptName, key: b.key! }, projectOf(b));
  useMode.getState().setMode('mvu');
  return true;
}

/** A tag no other regex looks for yet, so the new one shows in the preview instead of being taken by another. */
function freeTag(): string {
  const used = (t: string) => useStore.getState().project.scripts.some((s) => s.findRegex.includes(`<${t}>`) || s.findRegex.includes(`<${t}\\>`));
  const tag = ['状态栏', '状态', '信息栏', '面板'].find((t) => !used(t));
  if (tag) return tag;
  let i = 2;
  while (used('状态栏' + i)) i++;
  return '状态栏' + i;
}

/** A new beautification, made on the canvas: a status block with a few fields, already working. */
export function newBuilderScript() {
  const b = { ...newBuilder(), tag: freeTag() };
  const c = compileBuilder(b);
  const s = { ...newScript('画布美化'), findRegex: c.findRegex, replaceString: c.replaceString };
  useStore.getState().appendScripts([s]);
  addSample(b);
  void openBuilder(s.id);
}

/** Back to the regex, with what was done on the canvas written into it. */
export function closeBuilder() {
  flush();
  const st = useCard.getState();
  const b = currentBuilder();
  if (!st.builder || !b) return;
  const id = st.builder.scriptId;
  st.closeBuilder();
  // the tag may have changed: give the preview something to show
  addSample(b);
  useStore.getState().select(id);
  useMode.getState().setMode('regex');
}
