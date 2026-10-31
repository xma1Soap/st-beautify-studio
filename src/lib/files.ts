// File open/save that works both in the desktop app (Tauri) and in a plain browser during development.
import type { PickedFile } from './importer';

export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Filter = { name: string; extensions: string[] };

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

export async function pickFiles(multiple: boolean, filters: Filter[]): Promise<PickedFile[]> {
  if (inTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ multiple, filters });
    if (!sel) return [];
    const paths = Array.isArray(sel) ? sel : [sel];
    return Promise.all(
      paths.map(async (path) => {
        const buf = await invoke<ArrayBuffer>('read_file', { path });
        return { name: baseName(path), path, bytes: new Uint8Array(buf) };
      }),
    );
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',');
    input.onchange = async () => resolve(await filesToPicked([...(input.files || [])]));
    input.click();
  });
}

export async function filesToPicked(files: File[]): Promise<PickedFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

/** Save text. With `path` it writes straight there (desktop only); otherwise asks where. Returns the path, or null if cancelled. */
export async function saveText(content: string, defaultName: string, filters: Filter[], path?: string | null): Promise<string | null> {
  if (inTauri()) {
    let target = path || null;
    if (!target) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      target = await save({ defaultPath: defaultName, filters });
      if (!target) return null;
    }
    await invoke('write_text_file', { path: target, content });
    return target;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return defaultName;
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || '未命名';
