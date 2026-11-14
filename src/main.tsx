import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// for the end-to-end checks (e2e/): the stores and the pieces the checks build cards and previews with, only while developing
if (import.meta.env.DEV) {
  void Promise.all([
    import('./store'),
    import('./cardStore'),
    import('./mode'),
    import('./mvu/card'),
    import('./lib/importer'),
    import('./mvu/preview'),
    import('./components/mvu/sim'),
    import('./mvu/templates'),
    import('./lib/frameLibs'),
    import('./mvu/bar'),
    import('./mvu/barTemplates'),
    import('./mvu/shape'),
    import('./lib/previewAssets'),
    import('./myLibrary'),
  ]).then(([store, card, mode, mvuCard, importer, preview, sim, templates, frameLibs, bar, barTemplates, shape, previewAssets, library]) => {
    (window as any).__studio = { useStore: store.useStore, useCard: card.useCard, useMode: mode.useMode, mvuCard, importer, preview, sim, templates, frameLibs, bar, barTemplates, shape, previewAssets, useLibrary: library.useLibrary };
  });
}
