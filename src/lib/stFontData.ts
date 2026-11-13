// The font files of stFonts.ts as data: URLs, by file name (only loaded through loadStFonts).
const files = import.meta.glob('../assets/st-fonts/*.woff2', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;

export default Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));
