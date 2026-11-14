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

/** Rows [from, to) of a picture. */
function cropRows(img, from, to) {
  const y0 = Math.max(0, Math.floor(from));
  const y1 = Math.min(img.height, Math.ceil(to));
  const out = new PNG({ width: img.width, height: Math.max(1, y1 - y0) });
  PNG.bitblt(img, out, 0, y0, img.width, Math.max(1, y1 - y0), 0, 0);
  return out;
}

/**
 * Compares a and b (PNG files). Gives the share of pixels that differ (0–1) and the sizes; writes the difference
 * picture to `out`. `ignoreRight` px on the right are left out (SillyTavern's swipe arrows sit there); `rows`: only
 * these rows [from, to) are compared.
 */
export async function diffPng(a, b, out, { ignoreRight = 0, threshold = 0.12, rows } = {}) {
  let A = PNG.sync.read(await readFile(a));
  let B = PNG.sync.read(await readFile(b));
  const sizeA = [A.width, A.height];
  const sizeB = [B.width, B.height];
  // only these rows (a message taller than the chat: what is past the chat's edge is something else on both sides)
  if (rows) {
    A = cropRows(A, rows[0], rows[1]);
    B = cropRows(B, rows[0], rows[1]);
  }
  const w = Math.max(A.width, B.width) - ignoreRight;
  const h = Math.max(A.height, B.height);
  const pa = pad(A, w, h);
  const pb = pad(B, w, h);
  const d = new PNG({ width: w, height: h });
  const n = pixelmatch(pa.data, pb.data, d.data, w, h, { threshold, includeAA: false });
  await writeFile(out, PNG.sync.write(d));
  return { ratio: n / (w * h), pixels: n, sizeA, sizeB };
}
