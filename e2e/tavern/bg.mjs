// A test picture for the chat background checks: drawn here (no file in the repo), different everywhere, so any
// difference in where it is placed, how it is scaled or blurred shows.
import { PNG } from 'pngjs';

export function testBackground(w = 1200, h = 800) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grid = x % 100 < 3 || y % 100 < 3;
      const ring = Math.abs(Math.hypot(x - w * 0.3, y - h * 0.4) - 160) < 12;
      png.data[i] = grid ? 255 : Math.round((x / w) * 220);
      png.data[i + 1] = grid ? 255 : ring ? 230 : Math.round((y / h) * 180);
      png.data[i + 2] = grid ? 255 : Math.round(((x + y) % 300) / 300 * 200 + 40);
      png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}

/** Uploads a background to SillyTavern and makes it the chat's background (`fitting`: classic, cover, contain, stretch, center). */
export async function setBackground(st, png, name = 'e2e-test-bg.png', fitting = 'classic') {
  const form = new FormData();
  form.append('avatar', new Blob([png], { type: 'image/png' }), name);
  const file = await st.post('/api/backgrounds/upload', form);
  const got = await st.post('/api/settings/get', {});
  const s = JSON.parse(got.settings);
  s.background = { ...(s.background ?? {}), name: file, url: `url("backgrounds/${encodeURIComponent(file)}")`, fitting };
  await st.post('/api/settings/save', s);
  return file;
}

/** Back to a new SillyTavern's background (none: the theme's color). */
export async function clearBackground(st) {
  const got = await st.post('/api/settings/get', {});
  const s = JSON.parse(got.settings);
  delete s.background;
  await st.post('/api/settings/save', s);
}
