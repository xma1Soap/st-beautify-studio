// Pixel comparison of two screenshots: how much differs, and a picture with the differences in red.
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/** Pads a picture to w × h (what's added is transparent), so two of different sizes can still be compared. */
function pad(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, w), Math.min(img.height, h), 0, 0);
  return out;
}

/**
 * Compares a and b (PNG files). Gives the share of pixels that differ (0–1) and the sizes; writes the difference
 * picture to `out`. `ignoreRight` px on the right are left out (SillyTavern's swipe arrows sit there).
 */
export async function diffPng(a, b, out, { ignoreRight = 0, threshold = 0.12 } = {}) {
  const A = PNG.sync.read(await readFile(a));
  const B = PNG.sync.read(await readFile(b));
  const w = Math.max(A.width, B.width) - ignoreRight;
  const h = Math.max(A.height, B.height);
  const pa = pad(A, w, h);
  const pb = pad(B, w, h);
  const d = new PNG({ width: w, height: h });
  const n = pixelmatch(pa.data, pb.data, d.data, w, h, { threshold, includeAA: false });
  await writeFile(out, PNG.sync.write(d));
  return { ratio: n / (w * h), pixels: n, sizeA: [A.width, A.height], sizeB: [B.width, B.height] };
}
