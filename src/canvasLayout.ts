// Where everything is on the status bar canvas, as last reported by the frame. The canvas keeps it current; the
// settings panel reads it (e.g. to turn a box free without anything moving).

export interface CanvasRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** how many menus deep: open menus are drawn over everything else */
  z?: number;
  /** a tab label, standing for its page */
  tab?: 1;
  /** the stage of a free box (scaled to the width it has) */
  stage?: 1;
  /** a box's inside, and `u`: its width in the box's own px */
  cb?: { x: number; y: number; w: number; h: number; u: number };
}

export const canvasLayout: { rects: CanvasRect[] } = { rects: [] };

/** The part `id` drawn inside `outer` (one drawn copy of a container). */
export const rectInside = (rects: CanvasRect[], id: string, outer: { x: number; y: number; w: number; h: number }) =>
  rects.find(
    (r) => r.id === id && !r.tab && !r.stage && r.x >= outer.x - 1 && r.y >= outer.y - 1 && r.x + r.w <= outer.x + outer.w + 1 && r.y + r.h <= outer.y + outer.h + 1,
  );
