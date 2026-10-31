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
    // the dialog runs in Rust, which then only lets us read the files picked here
    const paths = await invoke<string[]>('pick_files', { multiple, filters });
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

/**
 * Save a file. With `path` it writes straight there (desktop only); otherwise asks where. Returns the path, or null if cancelled.
 * The desktop shell only writes to paths picked in a dialog during this run, so a path remembered from an
 * earlier run falls back to the save dialog, opened at that same file.
 */
export async function saveFile(content: string | Uint8Array, defaultName: string, filters: Filter[], path?: string | null): Promise<string | null> {
  const write = (target: string) =>
    typeof content === 'string' ? invoke('write_text_file', { path: target, content }) : invoke('write_file', { path: target, bytes: Array.from(content) });
  if (inTauri()) {
    if (path) {
      try {
        await write(path);
        return path;
      } catch (e) {
        if (String(e) !== 'NOT_ALLOWED') throw e;
      }
    }
    const target = await invoke<string | null>('pick_save_path', { defaultPath: path || defaultName, filters });
    if (!target) return null;
    await write(target);
    return target;
  }
  const a = document.createElement('a');
  const type = typeof content === 'string' ? 'application/json' : 'image/png';
  a.href = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  a.download = defaultName;
  // some browsers only use the file name when the link is on the page
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return defaultName;
}

/** Save text (see saveFile). */
export const saveText = (content: string, defaultName: string, filters: Filter[], path?: string | null) => saveFile(content, defaultName, filters, path);

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || '未命名';
