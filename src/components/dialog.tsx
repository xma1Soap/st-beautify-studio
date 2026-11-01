// The tool's own yes/no box, used instead of the browser's confirm(). The desktop app's webview doesn't show
// confirm() (Tauri replaces it with a dialog plugin call the app has no permission for), so it would just say no.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface Ask {
  message: string;
  ok: string;
  cancel: string;
  danger: boolean;
  done: (yes: boolean) => void;
}

const useDialog = create<{ queue: Ask[] }>(() => ({ queue: [] }));

export interface AskOpts {
  /** text of the yes button (default 继续) */
  ok?: string;
  cancel?: string;
  /** yes would throw something away: the button is red */
  danger?: boolean;
}

/** Asks a yes/no question in the tool's own box; resolves true for yes. */
export function ask(message: string, o: AskOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const item: Ask = {
      message,
      ok: o.ok ?? '继续',
      cancel: o.cancel ?? '取消',
      danger: !!o.danger,
      done: (yes) => {
        useDialog.setState((s) => ({ queue: s.queue.filter((x) => x !== item) }));
        resolve(yes);
      },
    };
    useDialog.setState((s) => ({ queue: [...s.queue, item] }));
  });
}

/** Mounted once in App: shows the first waiting question. */
export function DialogHost() {
  const cur = useDialog((s) => s.queue[0]);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!cur) return;
    okRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cur.done(false);
      }
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [cur]);
  if (!cur) return null;
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && cur.done(false)}>
      <div className="dlg" role="alertdialog" aria-modal="true" aria-label="确认">
        <div className="dlg-msg">{cur.message}</div>
        <div className="dlg-btns">
          <button onClick={() => cur.done(false)}>{cur.cancel}</button>
          <button ref={okRef} className={cur.danger ? 'danger' : 'primary'} onClick={() => cur.done(true)}>
            {cur.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
