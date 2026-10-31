// Pictures put inside the card: read a file the author picked and make it small enough to travel in every message.

/** Longest side pictures are shrunk to (0 = keep as is), remembered between uses. */
const SIDE_KEY = 'stbs-img-side';
export const IMAGE_SIDES: [number, string][] = [
  [256, '小（最长边 256）'],
  [512, '中（最长边 512）'],
  [1024, '大（最长边 1024）'],
  [0, '原图不缩小'],
];
export function savedSide(): number {
  const raw = localStorage.getItem(SIDE_KEY);
  const n = Number(raw);
  return raw !== null && IMAGE_SIDES.some(([s]) => s === n) ? n : 512;
}
export const saveSide = (n: number) => localStorage.setItem(SIDE_KEY, String(n));

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error ?? new Error('读不了这个文件'));
    r.readAsDataURL(f);
  });

/** The picture as a data: link, shrunk so its longest side is at most `side` (GIF and SVG are kept as they are). */
export async function imageToDataUrl(file: File, side: number): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('这不是图片文件');
  if (!side || file.type === 'image/gif' || file.type === 'image/svg+xml') return readAsDataUrl(file);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return readAsDataUrl(file);
  }
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 200 * 1024) {
    bmp.close();
    return readAsDataUrl(file);
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const webp = c.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
}

/** Rough size of a data: link in KB. */
export const dataKb = (u: string) => Math.round((u.length * 0.75) / 1024);
