// Shaped blocks: a polygon instead of a rectangle (cut corners, shield, gem, arrow…), drawn with CSS clip-path.
//
// Every corner is stored per axis as a share of the size plus pixels (`f` + `o`), so a point keeps a fixed
// depth in px (a shield's tip stays 14px deep on a phone and on a wide screen) unless it is set to scale.
// The outline is a ring (outer polygon with the inner one cut out) and the fill is the inner polygon,
// so both work with see-through colors.

/** One axis of a corner: `f` share of the width (or height), 0–1, plus `o` px. */
export interface ShapeAxis {
  f: number;
  o: number;
}

export interface ShapePt {
  x: ShapeAxis;
  y: ShapeAxis;
  /** scales with the size (share only) instead of keeping its depth in px */
  p?: 1;
}

const pt = (fx: number, ox: number, fy: number, oy: number, p?: 1): ShapePt => ({ x: { f: fx, o: ox }, y: { f: fy, o: oy }, ...(p ? { p } : {}) });

/** Ready shapes; `d` is the depth of the cuts and points in px. */
export const SHAPE_PRESETS: { key: string; label: string; make: (d: number) => ShapePt[] }[] = [
  { key: 'cut', label: '切角', make: (d) => [pt(0, d, 0, 0), pt(1, -d, 0, 0), pt(1, 0, 0, d), pt(1, 0, 1, -d), pt(1, -d, 1, 0), pt(0, d, 1, 0), pt(0, 0, 1, -d), pt(0, 0, 0, d)] },
  { key: 'hex', label: '六边形', make: (d) => [pt(0, d, 0, 0), pt(1, -d, 0, 0), pt(1, 0, 0.5, 0), pt(1, -d, 1, 0), pt(0, d, 1, 0), pt(0, 0, 0.5, 0)] },
  { key: 'shield', label: '盾牌', make: (d) => [pt(0, 0, 0, 0), pt(1, 0, 0, 0), pt(1, 0, 1, -d), pt(0.5, 0, 1, 0), pt(0, 0, 1, -d)] },
  { key: 'flag', label: '旗帜', make: (d) => [pt(0, 0, 0, 0), pt(1, 0, 0, 0), pt(1, 0, 1, 0), pt(0.5, 0, 1, -d), pt(0, 0, 1, 0)] },
  { key: 'gem', label: '宝石', make: (d) => [pt(0, d, 0, 0), pt(1, -d, 0, 0), pt(1, 0, 0, d), pt(0.5, 0, 1, 0), pt(0, 0, 0, d)] },
  { key: 'arrow', label: '箭头', make: (d) => [pt(0, 0, 0, 0), pt(1, -d, 0, 0), pt(1, 0, 0.5, 0), pt(1, -d, 1, 0), pt(0, 0, 1, 0)] },
  { key: 'ribbon', label: '飘带', make: (d) => [pt(0, 0, 0, 0), pt(1, 0, 0, 0), pt(1, -d, 0.5, 0), pt(1, 0, 1, 0), pt(0, 0, 1, 0), pt(0, d, 0.5, 0)] },
  { key: 'slant', label: '斜边', make: (d) => [pt(0, d, 0, 0), pt(1, 0, 0, 0), pt(1, -d, 1, 0), pt(0, 0, 1, 0)] },
  { key: 'diamond', label: '菱形', make: () => [pt(0.5, 0, 0, 0, 1), pt(1, 0, 0.5, 0, 1), pt(0.5, 0, 1, 0, 1), pt(0, 0, 0.5, 0, 1)] },
];

export const SHAPE_DEPTH = 14;

const r2 = (n: number) => Math.round(n * 100) / 100;
const clampF = (n: unknown) => (typeof n === 'number' && isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const clampO = (n: unknown) => (typeof n === 'number' && isFinite(n) ? Math.min(2000, Math.max(-2000, Math.round(n))) : 0);

/** The points, checked (anything odd is dropped); fewer than 3 = no shape. */
export function cleanShape(s: unknown): ShapePt[] | undefined {
  if (!Array.isArray(s)) return undefined;
  const out = s
    .filter((p) => p && typeof p === 'object' && p.x && p.y)
    .slice(0, 40)
    .map((p: any) => ({ x: { f: r2(clampF(p.x.f)), o: clampO(p.x.o) }, y: { f: r2(clampF(p.y.f)), o: clampO(p.y.o) }, ...(p.p ? { p: 1 as const } : {}) }));
  return out.length >= 3 ? out : undefined;
}

/** Where a point is on a box of this size, px. */
export const at = (p: ShapePt, w: number, h: number) => ({ x: p.x.f * w + p.x.o, y: p.y.f * h + p.y.o });

/** A point dragged to (x, y) px on a box of w × h: keeps a fixed depth from the nearest side or the middle, or a share. */
export function place(x: number, y: number, w: number, h: number, share: boolean): ShapePt {
  x = Math.min(w, Math.max(0, x));
  y = Math.min(h, Math.max(0, y));
  if (share) return { x: { f: r2(w ? x / w : 0), o: 0 }, y: { f: r2(h ? y / h : 0), o: 0 }, p: 1 };
  const axis = (v: number, size: number): ShapeAxis => {
    // anchored to whichever of start / middle / end is nearest, so the depth stays put when the size changes
    const f = [0, 0.5, 1].reduce((a, b) => (Math.abs(b * size - v) < Math.abs(a * size - v) ? b : a));
    return { f, o: Math.round(v - f * size) };
  };
  return { x: axis(x, w), y: axis(y, h) };
}

/** One coordinate as CSS. */
function cssAxis(a: ShapeAxis, extra = 0): string {
  const o = Math.round((a.o + extra) * 10) / 10;
  const pc = r2(a.f * 100);
  if (!o) return `${pc}%`;
  if (!pc) return `${o}px`;
  return `calc(${pc}% ${o < 0 ? '-' : '+'} ${Math.abs(o)}px)`;
}

const cssPts = (pts: ShapePt[], off?: { x: number; y: number }[]) => pts.map((p, i) => `${cssAxis(p.x, off?.[i].x)} ${cssAxis(p.y, off?.[i].y)}`);

/** Size used to work out the inner outline (the real size is only known in the card). */
const REF = { w: 240, h: 72 };

/**
 * How far each corner moves inwards for an outline `w` px wide (miter offsets on a typical block size).
 * Works for corners pointing in or out, either winding.
 */
export function insetOffsets(pts: ShapePt[], w: number): { x: number; y: number }[] {
  const P = pts.map((p) => at(p, REF.w, REF.h));
  const n = P.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  // inward normal of edge a→b: rotate the direction towards the inside
  const sign = area > 0 ? 1 : -1;
  const normal = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: (-dy / len) * sign, y: (dx / len) * sign };
  };
  return P.map((p, i) => {
    const prev = P[(i - 1 + n) % n];
    const next = P[(i + 1) % n];
    const n1 = normal(prev, p);
    const n2 = normal(p, next);
    const dot = n1.x * n2.x + n1.y * n2.y;
    const k = 1 + dot < 0.15 ? 0.15 : 1 + dot; // very sharp corners: cap the miter
    let x = (w * (n1.x + n2.x)) / k;
    let y = (w * (n1.y + n2.y)) / k;
    const len = Math.hypot(x, y);
    if (len > 3 * w) {
      x = (x / len) * 3 * w;
      y = (y / len) * 3 * w;
    }
    return { x, y };
  });
}

/** clip-path of the shape's fill (inside the outline when there is one). */
export function fillClip(pts: ShapePt[], lineW: number): string {
  return `polygon(${cssPts(pts, lineW > 0 ? insetOffsets(pts, lineW) : undefined).join(', ')})`;
}

/** clip-path of the outline: the shape with its inside cut out. */
export function ringClip(pts: ShapePt[], lineW: number): string {
  const outer = cssPts(pts);
  const inner = cssPts(pts, insetOffsets(pts, lineW));
  return `polygon(evenodd, ${[...outer, outer[0], ...inner, inner[0]].join(', ')})`;
}

/** Highest point of the fill on a typical block, px from the top (where the highlight line starts). */
export function topOf(pts: ShapePt[], lineW: number): number {
  const off = lineW > 0 ? insetOffsets(pts, lineW) : pts.map(() => ({ x: 0, y: 0 }));
  return Math.max(0, Math.round(Math.min(...pts.map((p, i) => at(p, REF.w, REF.h).y + off[i].y))));
}

/** The point on segment a–b nearest to (x, y), and how far it is. */
export function nearestOnSegment(a: { x: number; y: number }, b: { x: number; y: number }, x: number, y: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return { x: px, y: py, t, d: Math.hypot(px - x, py - y) };
}
