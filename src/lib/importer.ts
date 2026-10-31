// Reads regex scripts out of whatever the user drops in: ST exports, presets, character cards, our project files.
import { PROJECT_TYPE, type Project, type RegexScript } from './types';
import { defaultSettings } from './defaults';
import { newId } from './id';

export { newId };

export interface PickedFile { name: string; path?: string; bytes: Uint8Array }

export type Imported =
  | { kind: 'project'; name: string; path?: string; project: Project }
  | { kind: 'scripts'; name: string; scripts: RegexScript[] }
  | { kind: 'error'; name: string; msg: string };

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

export function normalizeScript(o: any): RegexScript {
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newId(),
    scriptName: String(o.scriptName || '(未命名)'),
    findRegex: String(o.findRegex ?? ''),
    replaceString: String(o.replaceString ?? ''),
    trimStrings: Array.isArray(o.trimStrings) ? o.trimStrings.map(String) : [],
    placement: Array.isArray(o.placement) ? o.placement.map(Number).filter((n: number) => !isNaN(n)) : [2],
    disabled: !!o.disabled,
    markdownOnly: !!o.markdownOnly,
    promptOnly: !!o.promptOnly,
    runOnEdit: o.runOnEdit === undefined ? true : !!o.runOnEdit,
    substituteRegex: Number(o.substituteRegex) || 0,
    minDepth: numOrNull(o.minDepth),
    maxDepth: numOrNull(o.maxDepth),
  };
}

/** The exact shape SillyTavern writes when it exports a regex. */
export function toStExport(s: RegexScript) {
  return {
    id: s.id,
    scriptName: s.scriptName,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    trimStrings: s.trimStrings,
    placement: s.placement,
    disabled: s.disabled,
    markdownOnly: s.markdownOnly,
    promptOnly: s.promptOnly,
    runOnEdit: s.runOnEdit,
    substituteRegex: s.substituteRegex,
    minDepth: s.minDepth,
    maxDepth: s.maxDepth,
  };
}

function collect(node: any, out: any[], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out, depth + 1)); return; }
  if (typeof node.findRegex === 'string') { out.push(node); return; }
  for (const k in node) collect(node[k], out, depth + 1);
}

function readPngCard(u8: Uint8Array): any {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (v.getUint32(0) !== 0x89504e47) throw new Error('不是 PNG 文件');
  const found: Record<string, string> = {};
  const latin = new TextDecoder('latin1');
  let p = 8;
  while (p + 8 <= u8.length) {
    const len = v.getUint32(p);
    const type = latin.decode(u8.subarray(p + 4, p + 8));
    if (type === 'tEXt') {
      const data = u8.subarray(p + 8, p + 8 + len);
      const z = data.indexOf(0);
      found[latin.decode(data.subarray(0, z)).toLowerCase()] = latin.decode(data.subarray(z + 1));
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const b64 = found.ccv3 || found.chara;
  if (!b64) throw new Error('PNG 里没有角色卡数据');
  const bin = atob(b64);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export function parseFile(f: PickedFile): Imported {
  try {
    const isPng = /\.png$/i.test(f.name);
    const data = isPng ? readPngCard(f.bytes) : JSON.parse(new TextDecoder().decode(f.bytes).replace(/^﻿/, ''));
    if (data && data.$type === PROJECT_TYPE) {
      const p = data as Partial<Project>;
      return {
        kind: 'project', name: f.name, path: f.path,
        project: {
          name: String(p.name || f.name.replace(/(\.美化工程)?\.json$/i, '')),
          scripts: (p.scripts || []).map(normalizeScript),
          testText: String(p.testText ?? ''),
          settings: { ...defaultSettings(), ...(p.settings || {}) },
        },
      };
    }
    const found: any[] = [];
    collect(data, found);
    if (!found.length) return { kind: 'error', name: f.name, msg: '没找到正则' };
    return { kind: 'scripts', name: f.name, scripts: found.map(normalizeScript) };
  } catch (e) {
    return { kind: 'error', name: f.name, msg: (e as Error).message };
  }
}

export function projectToJson(p: Project): string {
  return JSON.stringify({ $type: PROJECT_TYPE, version: 1, ...p, scripts: p.scripts.map(toStExport) }, null, 2);
}
