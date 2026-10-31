// Menu actions of the MVU card editor: new / open / save, import a card, export the finished card.
import { useCard } from './cardStore';
import { useStore } from './store';
import { inTauri, pickFiles, safeFileName, saveFile } from './lib/files';
import type { PickedFile } from './lib/importer';
import { bytesToBase64, isPng, readChunks, stripCardData } from './lib/png';
import { barOf, compileBar } from './mvu/bar';
import { AUTO_TEXT, buildCard, buildCardPng, ENTRY_NAMES, greetingBlockProblems, greetingName, handStale, importCardFile, newCardProject, readCustom } from './mvu/card';
import { CARD_PROJECT_TYPE, type CardProject, type HandEntry } from './mvu/types';
import { overrideProblems, problems } from './mvu/vars';

const notify = (m: string) => useStore.getState().notify(m);
const fail = (e: unknown) => notify('出错了：' + ((e as Error)?.message || String(e)));

const PROJECT_EXT = '.MVU卡工程.json';

function readProject(json: any): CardProject | null {
  if (json?.type !== CARD_PROJECT_TYPE || !Array.isArray(json.vars)) return null;
  const fresh = newCardProject();
  return { ...fresh, ...json, card: { ...fresh.card, ...json.card }, settings: { ...fresh.settings, ...json.settings }, custom: readCustom(json.custom) };
}

/** A project file, a card PNG or a card JSON. */
export function openCardFiles(files: PickedFile[]) {
  const f = files[0];
  if (!f) return;
  if (files.length > 1) notify('一次只能打开一张卡，只打开了第一个文件');
  const st = useCard.getState();
  if (st.dirty && !confirm('当前的卡有没保存的修改，打开新的会替换掉它。继续吗？')) return;
  try {
    if (!isPng(f.bytes)) {
      const json = JSON.parse(new TextDecoder().decode(f.bytes).replace(/^﻿/, ''));
      const p = readProject(json);
      if (p) {
        st.load(p, f.path ?? null);
        notify(`已打开「${p.card.name || f.name}」`);
        return;
      }
      if (json?.$type === 'st-beautify-studio' || Array.isArray(json) || typeof json?.findRegex === 'string') {
        notify('这是正则美化的文件，请先在左上角切换到「正则美化」再打开');
        return;
      }
    }
    const { project, notes } = importCardFile(f.name, f.bytes);
    st.load(project, null, notes);
    st.setTab('card');
    notify(`已导入角色卡「${project.card.name || f.name}」，读出 ${project.vars.length} 个变量；导入说明在「角色卡」页`);
  } catch (e) {
    fail(e);
  }
}

const OPEN_FILTERS = [{ name: 'MVU 卡工程 / 角色卡', extensions: ['json', 'png'] }];

export async function openCard() {
  try {
    openCardFiles(await pickFiles(false, OPEN_FILTERS));
  } catch (e) {
    fail(e);
  }
}

export function newCard() {
  const st = useCard.getState();
  if (st.dirty && !confirm('当前的卡有没保存的修改，新建会丢掉它们。继续吗？')) return;
  st.reset();
}

const baseName = () => safeFileName(useCard.getState().project.card.name || '新角色');

export async function saveCardProject(saveAs = false) {
  const st = useCard.getState();
  try {
    const path = await saveFile(JSON.stringify(st.project, null, 1), baseName() + PROJECT_EXT, [{ name: 'MVU 卡工程', extensions: ['json'] }], saveAs ? null : st.filePath);
    if (!path) return;
    st.markSaved(inTauri() ? path : st.filePath);
    notify(inTauri() ? `已保存到 ${path}` : '已下载工程文件（下次用「打开」选它就能接着改）');
  } catch (e) {
    fail(e);
  }
}

function okToExport(): boolean {
  const p = useCard.getState().project;
  const list = problems(p.vars);
  if (!p.card.name.trim()) list.unshift('角色卡还没有名字');
  list.push(...greetingBlockProblems(p.card.greetings));
  p.card.greetings.forEach((_, i) => list.push(...overrideProblems(p.vars, p.card.greetingVars?.[i]).map((m) => `${greetingName(i)}的初始值 · ${m}`)));
  list.push(...compileBar(barOf(p), p.vars, { allowEdit: p.settings.allowPlayerEdit }).problems.map((m) => `状态栏 · ${m}`));
  for (const k of Object.keys(AUTO_TEXT) as HandEntry[])
    if (handStale(p, k)) list.push(`「${ENTRY_NAMES[k]}」是手改的，之后变量又改过，请到「进阶」页对一下`);
  if (!list.length) return true;
  return confirm(`还有 ${list.length} 个问题，导出的卡可能用不了：\n\n${list.slice(0, 8).join('\n')}${list.length > 8 ? '\n……' : ''}\n\n仍然导出吗？`);
}

const HOW_TO_USE = '在酒馆「角色管理 → 导入角色」里选这个文件；需要先装好酒馆助手';

export async function exportCardPng() {
  if (!okToExport()) return;
  try {
    const bytes = await buildCardPng(useCard.getState().project);
    const path = await saveFile(bytes, baseName() + '.png', [{ name: '角色卡图片', extensions: ['png'] }]);
    if (path) notify(`已导出角色卡。${HOW_TO_USE}`);
  } catch (e) {
    fail(e);
  }
}

export async function exportCardJson() {
  if (!okToExport()) return;
  try {
    const json = JSON.stringify(buildCard(useCard.getState().project), null, 2);
    const path = await saveFile(json, baseName() + '.json', [{ name: '角色卡 JSON', extensions: ['json'] }]);
    if (path) notify(`已导出角色卡 JSON。${HOW_TO_USE}`);
  } catch (e) {
    fail(e);
  }
}

/** Picture → PNG bytes (other formats are redrawn as PNG, which card files need). */
async function toPng(f: PickedFile): Promise<Uint8Array> {
  try {
    readChunks(f.bytes);
    return stripCardData(f.bytes);
  } catch {
    /* not a PNG */
  }
  const url = URL.createObjectURL(new Blob([f.bytes as BlobPart]));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('图片转换失败');
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    throw new Error('读不出这张图片，换一张 PNG 或 JPG 试试');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function pickAvatar() {
  try {
    const [f] = await pickFiles(false, [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
    if (!f) return;
    const png = await toPng(f);
    useCard.getState().edit((p) => ({ ...p, avatar: bytesToBase64(png) }));
  } catch (e) {
    fail(e);
  }
}
