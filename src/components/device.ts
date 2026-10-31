// Size of the fake phone / desktop screen in the preview, scaled down to fit the panel.
export const PHONES = [
  { w: 360, h: 780, label: '360 宽' },
  { w: 390, h: 844, label: '390 宽' },
  { w: 430, h: 932, label: '430 宽' },
];
const DESKTOP_MAX = 1000;
const DESKTOP_MIN = 480;
export const PAD = 24;

export function fitDevice(stage: { w: number; h: number }, phone: boolean, phoneIdx: number) {
  const p = PHONES[phoneIdx] || PHONES[1];
  const availW = Math.max(stage.w - PAD * 2, 100);
  const availH = Math.max(stage.h - PAD * 2, 100);
  if (phone) {
    const bezel = 20;
    return { w: p.w, h: p.h, scale: Math.min(1, availW / (p.w + bezel), availH / (p.h + bezel)) };
  }
  const w = Math.max(DESKTOP_MIN, Math.min(DESKTOP_MAX, availW));
  const scale = Math.min(1, availW / w);
  return { w, h: availH / scale, scale };
}

export const savedPhone = () => Number(localStorage.getItem('stbs-phone') ?? 1) || 0;
export const savePhone = (i: number) => {
  try {
    localStorage.setItem('stbs-phone', String(i));
  } catch {
    /* ignore */
  }
};
