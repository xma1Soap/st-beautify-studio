import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`               → dist/：桌面版和网页版（GitHub Pages）共用，用相对路径，放在哪个子目录都能打开
// `vite build --mode single` → dist-single/index.html：所有代码塞进一个 HTML，双击就能用
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    outDir: mode === 'single' ? 'dist-single' : 'dist',
  },
}));
