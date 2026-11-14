// Status bar palettes from a picture (the card's avatar): its main colors, then a dark and a light palette built on
// them — the most colorful one as the main color, another hue as the second, the rest from the main hue.
import type { ThemeColor } from '../mvu/bar';

export type Rgb = [number, number, number];
export interface Swatch {
  rgb: Rgb;
  /** how much of the picture it covers (0–1) */
  share: number;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  s = clamp(s);
  l = clamp(l);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * The main colors of a picture's pixels (RGBA bytes, like canvas ImageData): k-means on the opaque pixels, biggest
 * share first. Starts from the colors farthest apart, so small patches count and the same picture always gives the
 * same answer.
 */
export function mainColors(px: Uint8ClampedArray | number[], k = 6): Swatch[] {
  const pts: Rgb[] = [];
  for (let i = 0; i + 3 < px.length; i += 4) if (px[i + 3] > 200) pts.push([px[i], px[i + 1], px[i + 2]]);
  if (!pts.length) return [];
  const dist = (p: Rgb, c: Rgb) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  // starting points: the first pixel, then each time the pixel farthest from those picked (small patches count too)
  let centers: Rgb[] = [[...pts[0]] as Rgb];
  const near = pts.map((p) => dist(p, centers[0]));
  while (centers.length < k) {
    let far = 0;
    for (let i = 1; i < pts.length; i++) if (near[i] > near[far]) far = i;
    if (near[far] === 0) break;
    const c = [...pts[far]] as Rgb;
    centers.push(c);
    pts.forEach((p, i) => (near[i] = Math.min(near[i], dist(p, c))));
  }
  let owner = new Array<number>(pts.length).fill(0);
  for (let round = 0; round < 12; round++) {
    owner = pts.map((p) => {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = dist(p, c);
        if (d < bd) (bd = d), (best = j);
      });
      return best;
    });
    centers = centers.map((c, j) => {
      const mine = pts.filter((_, i) => owner[i] === j);
      if (!mine.length) return c;
      return [0, 1, 2].map((ch) => mine.reduce((sum, p) => sum + p[ch], 0) / mine.length) as Rgb;
    });
  }
  const count = centers.map((_, j) => owner.filter((o) => o === j).length);
  return centers
    .map((c, j) => ({ rgb: c.map(Math.round) as Rgb, share: count[j] / pts.length }))
    .filter((s) => s.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** Two palettes (dark, light) for the status bar from a picture's main colors. */
export function palettesFrom(swatches: Swatch[]): { name: string; colors: Record<ThemeColor, string> }[] {
  if (!swatches.length) return [];
  const hsl = swatches.map((s) => ({ ...s, h: rgbToHsl(s.rgb) }));
  // how much a color stands out: colorful, neither near black nor near white, and covering a good part of the picture
  const vivid = (x: (typeof hsl)[number]) => x.h[1] * (1 - Math.abs(x.h[2] - 0.5) * 1.6) * (0.3 + x.share);
  const byVivid = [...hsl].sort((a, b) => vivid(b) - vivid(a));
  const main = byVivid[0];
  // the second color: the most vivid one with another hue (or the main hue turned a third round)
  const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const second = byVivid.find((x) => hueGap(x.h[0], main.h[0]) > 35 && x.h[1] > 0.15);
  const [mh, ms] = main.h;
  const ms2 = Math.max(ms, 0.35);
  const [sh, ss] = second ? second.h : [(mh + 120) % 360, ms2];
  const ss2 = Math.max(ss, 0.35);
  // the ground takes the picture's biggest color's hue, softly
  const gh = hsl[0].h[0];
  const gs = Math.min(hsl[0].h[1], 0.35);
  return [
    {
      name: '头像·深色',
      colors: {
        bg: hslToHex(gh, gs * 0.6, 0.11),
        card: hslToHex(gh, gs * 0.6, 0.16),
        line: hslToHex(gh, gs * 0.5, 0.26),
        text: hslToHex(gh, 0.15, 0.92),
        dim: hslToHex(gh, 0.12, 0.7),
        accent: hslToHex(mh, ms2, 0.68),
        accent2: hslToHex(sh, ss2, 0.7),
      },
    },
    {
      name: '头像·浅色',
      colors: {
        bg: hslToHex(gh, gs * 0.8, 0.96),
        card: hslToHex(gh, gs * 0.8, 0.91),
        line: hslToHex(gh, gs * 0.6, 0.8),
        text: hslToHex(gh, 0.25, 0.2),
        dim: hslToHex(gh, 0.12, 0.45),
        accent: hslToHex(mh, ms2, 0.42),
        accent2: hslToHex(sh, ss2, 0.45),
      },
    },
  ];
}

/** The picture (any image URL) shrunk to its pixels, in the browser. */
export async function picturePixels(src: string, side = 48): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height).data;
}
