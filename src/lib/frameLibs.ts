// The libraries put inside every front-end card in the preview (see vite.config.ts, `virtual:frame-libs`).
// They are loaded the first time a preview needs them, so the tool itself starts quickly.
let code: string | undefined;
let loading: Promise<string> | undefined;

/** The script text, once loaded. */
export const frameLibsNow = () => code;

export function loadFrameLibs(): Promise<string> {
  loading ??= import('virtual:frame-libs').then(
    (m) => (code = m.default),
    (e) => {
      loading = undefined;
      throw e;
    },
  );
  return loading;
}
