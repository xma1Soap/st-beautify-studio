import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests don't need the real card libraries (vite.config.ts bundles them for the app)
  plugins: [
    {
      name: 'frame-libs-stub',
      resolveId: (id) => (id === 'virtual:frame-libs' ? '\0frame-libs-stub' : null),
      load: (id) => (id === '\0frame-libs-stub' ? 'export default "";' : null),
    },
  ],
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
