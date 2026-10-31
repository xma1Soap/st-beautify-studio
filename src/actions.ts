// Menu actions shared by the top bar, keyboard shortcuts and drag-and-drop.
import { useStore } from './store';
import { parseFile, projectToJson, toStExport, type PickedFile } from './lib/importer';
import { inTauri, pickFiles, safeFileName, saveText } from './lib/files';
import { generateAll } from './lib/engine';

const notify = (m: string) => useStore.getState().notify(m);
const fail = (e: unknown) => notify('出错了：' + ((e as Error)?.message || String(e)));

export function importFiles(files: PickedFile[]) {
  let added = 0;
  const msgs: string[] = [];
  for (const f of files) {
    const r = parseFile(f);
    const st = useStore.getState();
    if (r.kind === 'project') {
      if (st.dirty && !confirm(`当前工程有未保存的修改，打开「${r.project.name}」会替换掉它。继续吗？`)) continue;
      st.loadProject(r.project, r.path ?? null);
      msgs.push(`已打开工程「${r.project.name}」`);
    } else if (r.kind === 'scripts') {
      st.appendScripts(r.scripts);
      added += r.scripts.length;
    } else msgs.push(`${r.name}：${r.msg}`);
  }
  if (added) {
    msgs.unshift(`导入了 ${added} 条正则`);
    const st = useStore.getState();
    if (!st.project.testText.trim()) {
      const t = generateAll(st.project.scripts, st.project.settings);
      if (t) st.setText(t);
    }
  }
  if (msgs.length) notify(msgs.join('；'));
}

const ANY = [{ name: '正则 / 工程 / 角色卡', extensions: ['json', 'png'] }];

export async function openProject() {
  try { importFiles(await pickFiles(false, ANY)); } catch (e) { fail(e); }
}
export async function importRegex() {
  try { importFiles(await pickFiles(true, ANY)); } catch (e) { fail(e); }
}
export function newProject() {
  const st = useStore.getState();
  if (st.dirty && !confirm('当前工程有未保存的修改，新建会丢掉它们。继续吗？')) return;
  st.newProject();
}

export async function saveProject(saveAs = false) {
  const st = useStore.getState();
  try {
    const path = await saveText(
      projectToJson(st.project),
      `${safeFileName(st.project.name)}.美化工程.json`,
      [{ name: '美化工程', extensions: ['json'] }],
      saveAs ? null : st.filePath,
    );
    if (!path) return;
    st.markSaved(inTauri() ? path : st.filePath);
    notify(inTauri() ? `已保存到 ${path}` : '已下载工程文件');
  } catch (e) { fail(e); }
}

export async function exportScripts(which: 'selected' | 'all') {
  const st = useStore.getState();
  const list = which === 'all' ? st.project.scripts : st.project.scripts.filter((s) => s.id === st.selectedId);
  if (!list.length) { notify(which === 'all' ? '还没有正则' : '先在左边选中一条正则'); return; }
  const single = which === 'selected';
  const content = JSON.stringify(single ? toStExport(list[0]) : list.map(toStExport), null, 2);
  const name = `regex-${safeFileName(single ? list[0].scriptName : st.project.name)}.json`;
  try {
    const path = await saveText(content, name, [{ name: '酒馆正则', extensions: ['json'] }]);
    if (path) notify(`已导出 ${list.length} 条正则，在酒馆「正则 → 导入」里选这个文件即可`);
  } catch (e) { fail(e); }
}
