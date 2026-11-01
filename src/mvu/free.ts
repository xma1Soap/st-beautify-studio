// Free layout: a box whose parts sit where the author put them (px from its top left, at the size it was laid
// out at). The runtime scales the whole box evenly to the width it gets, like a picture; below an optional width
// the parts go one under another instead.
import type { BarNode, FreeAt } from './bar';

export const FREE_W = 600;
export const FREE_H = 200;
/** a new part dropped in, when it has no size of its own yet */
export const FREE_NEW_W = 200;
/** parts that look right at their own width */
const OWN_WIDTH = new Set<BarNode['type']>(['button', 'menu', 'image']);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The size a free box was laid out at, and the width below which it stacks (0: never). */
export function freeSize(n: BarNode): { w: number; h: number; stack: number } {
  return {
    w: Math.round(clamp(n.freeW ?? FREE_W, 40, 2000)),
    h: Math.round(clamp(n.freeH ?? FREE_H, 20, 4000)),
    stack: n.stackBelow ? Math.round(clamp(n.stackBelow, 100, 2000)) : 0,
  };
}

export const isFree = (n: BarNode | null | undefined): boolean => n?.type === 'box' && n.dir === 'free';

/** A position as kept: whole px, a size only when it is one. */
export function cleanAt(a: FreeAt): FreeAt {
  const out: FreeAt = { x: Math.round(a.x), y: Math.round(a.y) };
  if (a.w != null && a.w > 0) out.w = Math.round(Math.max(8, a.w));
  if (a.h != null && a.h > 0) out.h = Math.round(Math.max(8, a.h));
  return out;
}

/** Where a part dropped at (x, y) of a free box goes (sizes: what it had before, or a default). */
export function dropAt(node: BarNode, x: number, y: number, box: BarNode, size?: { w: number; h: number }): FreeAt {
  const { w: W, h: H } = freeSize(box);
  const w = size ? size.w : OWN_WIDTH.has(node.type) ? undefined : Math.min(FREE_NEW_W, W);
  return cleanAt({ x: clamp(x, 0, Math.max(0, W - (w ?? 40))), y: clamp(y, 0, Math.max(0, H - 20)), ...(w ? { w } : {}) });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Turning a box into a free one without anything moving: its size and where its parts are now.
 * `inner`: the box's content area on the canvas; `unit`: its width in the box's own px (it may be drawn smaller);
 * `kids`: where each part is on the canvas (missing: not drawn, e.g. hidden).
 */
export function toFree(box: BarNode, inner: Box, unit: number, kids: (Box | undefined)[]): Partial<BarNode> & { children: BarNode[] } {
  const f = inner.w > 0 ? unit / inner.w : 1;
  const W = Math.max(40, Math.round(unit));
  let bottom = 0;
  let y = 0;
  const children = (box.children ?? []).map((k, i) => {
    const r = kids[i];
    let at: FreeAt;
    if (r) {
      at = cleanAt({ x: (r.x - inner.x) * f, y: (r.y - inner.y) * f, w: r.w * f });
      bottom = Math.max(bottom, at.y + r.h * f);
      y = Math.max(y, bottom + 8);
    } else {
      // not drawn: under everything else
      at = { x: 0, y: Math.round(y), w: Math.min(FREE_NEW_W, W) };
      y += 40;
      bottom = Math.max(bottom, y);
    }
    return { ...k, at };
  });
  return { dir: 'free', freeW: W, freeH: Math.max(40, Math.round(Math.max(bottom, inner.h * f))), children };
}

/** How far down the parts reach, in the box's own px: from where they are drawn, or (not drawn) from where they are put. */
export function partsBottom(box: BarNode, stage?: Box, kids: (Box | undefined)[] = []): number {
  let bottom = 0;
  if (stage) {
    const k = stage.w > 0 ? stage.w / freeSize(box).w : 1;
    for (const r of kids) if (r) bottom = Math.max(bottom, (r.y + r.h - stage.y) / k);
  } else for (const c of box.children ?? []) bottom = Math.max(bottom, (c.at?.y ?? 0) + (c.at?.h ?? 24));
  return bottom;
}

/** The height that just fits the parts (from where they are drawn, in the box's own px). */
export function fitHeight(box: BarNode, stage: Box, kids: (Box | undefined)[]): number {
  return Math.max(40, Math.round(partsBottom(box, stage, kids) + 4));
}

/**
 * Parts put in without a point (added with a click, moved in from somewhere else): one under another, below
 * what is there (`bottom`), the box growing to fit them.
 */
export function underAll(nodes: BarNode[], box: BarNode, bottom: number): { nodes: BarNode[]; freeH?: number } {
  let y = bottom > 0 ? Math.round(bottom + 8) : 0;
  const out = nodes.map((n) => {
    const at = { ...dropAt(n, 0, 0, box), y };
    y += 32;
    return { ...n, at };
  });
  return y > freeSize(box).h ? { nodes: out, freeH: y } : { nodes: out };
}

/**
 * Snapping one direction: the edges of what moves (`moving`, e.g. its left, middle and right) against `lines`.
 * Returns how far to shift it and the line it lands on, or null when nothing is within `t`.
 */
export function snap1(moving: number[], lines: number[], t: number): { d: number; at: number } | null {
  let best: { d: number; at: number } | null = null;
  for (const m of moving) {
    for (const l of lines) {
      const d = l - m;
      if (Math.abs(d) <= t && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l };
    }
  }
  return best;
}
