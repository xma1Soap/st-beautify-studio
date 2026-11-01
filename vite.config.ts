import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

/**
 * `virtual:frame-libs`: jQuery, lodash, zod and YAML bundled into one script (as text), which the preview puts
 * inside every front-end card, the way TavernHelper gives cards these globals. zod keeps only its English and
 * Chinese messages (all of its languages would triple the size).
 */
function frameLibs(): Plugin {
  const id = 'virtual:frame-libs';
  const locales = fileURLToPath(new URL('./node_modules/zod/v4/locales/', import.meta.url)).replace(/\\/g, '/');
  let code: Promise<string> | undefined;
  const bundle = async () => {
    const { rolldown } = await import('rolldown');
    const b = await rolldown({
      input: entry,
      platform: 'browser',
      logLevel: 'warn',
      plugins: [
        {
          name: 'zod-two-locales',
          resolveId: (src, from) => (src === '../locales/index.js' && /zod[\\/]v4[\\/](classic|core)[\\/]/.test(from ?? '') ? '\0zod-locales' : null),
          load: (m) => (m === '\0zod-locales' ? `export { default as en } from '${locales}en.js'; export { default as zhCN } from '${locales}zh-CN.js';` : null),
        },
      ],
    });
    const { output } = await b.generate({ format: 'iife', minify: true });
    await b.close();
    return output[0].code;
  };
  const entry = fileURLToPath(new URL('./src/lib/frame-libs/entry.js', import.meta.url));
  return {
    name: 'frame-libs',
    resolveId: (src) => (src === id ? '\0' + id : null),
    async load(m) {
      if (m !== '\0' + id) return null;
      this.addWatchFile(entry);
      code ??= bundle();
      return `export default ${JSON.stringify(await code)};`;
    },
    watchChange(file) {
      if (file.replace(/\\/g, '/') === entry.replace(/\\/g, '/')) code = undefined;
    },
  };
}

// `vite build`               → dist/：桌面版和网页版（GitHub Pages）共用，用相对路径，放在哪个子目录都能打开
// `vite build --mode single` → dist-single/index.html：所有代码塞进一个 HTML，双击就能用
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), frameLibs(), viteSingleFile()] : [react(), frameLibs()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    outDir: mode === 'single' ? 'dist-single' : 'dist',
  },
}));
