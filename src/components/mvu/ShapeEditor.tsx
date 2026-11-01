// Editing a block's shape on the canvas: drag its points, click an edge to add one, double-click a point to drop it.
// A dragged point snaps to the block's sides and middle lines, to its other points and to the edges of the
// components around it, and a dashed line shows what it snapped to (Alt: no snapping).
import { useRef, useState } from 'react';
import { at, nearestOnSegment, place, type ShapePt } from '../../mvu/shape';
import { useShapeUi } from './ShapeFields';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_POINTS = 40;

export function ShapeEditor({
  rect,
  pts,
  scale,
  others,
  stage,
  toLocal,
  onChange,
}: {
  /** where the block is on the canvas */
  rect: Box;
  pts: ShapePt[];
  /** canvas zoom: handles keep the same size on screen */
  scale: number;
  /** the other components, to snap to their edges */
  others: Box[];
  /** size of the whole canvas, for the guide lines */
  stage: { w: number; h: number };
  toLocal: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  onChange: (pts: ShapePt[]) => void;
}) {
  const point = useShapeUi((u) => u.point);
  const setUi = useShapeUi((u) => u.set);
  const [plus, setPlus] = useState<{ x: number; y: number } | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  // the block can change size while a point moves (its padding follows the points): keep the size from the start
  const [frozen, setFrozen] = useState<Box | null>(null);
  const drag = useRef<{ i: number; box: Box; pts: ShapePt[] } | null>(null);
  const b = frozen ?? rect;
  const P = pts.map((p) => at(p, b.w, b.h));
  const k = 1 / scale;

  /** (x, y) inside the block, pulled onto a line nearby */
  const snap = (x: number, y: number, i: number, free: boolean) => {
    if (free) return { x, y };
    const t = 6 * k;
    const xs = [0, b.w / 2, b.w];
    const ys = [0, b.h / 2, b.h];
    P.forEach((q, j) => {
      if (j === i) return;
      xs.push(q.x);
      ys.push(q.y);
    });
    for (const r of others) {
      xs.push(r.x - b.x, r.x + r.w / 2 - b.x, r.x + r.w - b.x);
      ys.push(r.y - b.y, r.y + r.h / 2 - b.y, r.y + r.h - b.y);
    }
    const near = (v: number, list: number[]) => {
      let best: number | undefined;
      for (const c of list) if (Math.abs(c - v) <= t && (best === undefined || Math.abs(c - v) < Math.abs(best - v))) best = c;
      return best;
    };
    const gx = near(x, xs);
    const gy = near(y, ys);
    return { x: gx ?? x, y: gy ?? y, gx, gy };
  };

  const startDrag = (e: React.PointerEvent, i: number, list: ShapePt[]) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { i, box: rect, pts: list };
    setFrozen(rect);
    setUi({ point: i });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const l = toLocal(e);
    const s = snap(l.x - d.box.x, l.y - d.box.y, d.i, e.altKey);
    setGuides({ x: s.gx, y: s.gy });
    const next = d.pts.map((p, j) => (j === d.i ? place(s.x, s.y, d.box.w, d.box.h, !!p.p) : p));
    d.pts = next;
    onChange(next);
  };
  const stop = () => {
    if (!drag.current) return;
    drag.current = null;
    setFrozen(null);
    setGuides({});
  };
  const insert = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || pts.length >= MAX_POINTS) return;
    const l = toLocal(e);
    const j = (i + 1) % P.length;
    const q = nearestOnSegment(P[i], P[j], l.x - rect.x, l.y - rect.y);
    const np = place(q.x, q.y, rect.w, rect.h, !!(pts[i].p && pts[j].p));
    const next = [...pts.slice(0, i + 1), np, ...pts.slice(i + 1)];
    onChange(next);
    startDrag(e, i + 1, next);
    setPlus(null);
  };
  const hoverEdge = (e: React.PointerEvent, i: number) => {
    if (drag.current || pts.length >= MAX_POINTS) return;
    const l = toLocal(e);
    const q = nearestOnSegment(P[i], P[(i + 1) % P.length], l.x - b.x, l.y - b.y);
    setPlus({ x: q.x, y: q.y });
  };
  const remove = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    if (pts.length <= 3) return;
    onChange(pts.filter((_, j) => j !== i));
    setUi({ point: null });
  };

  const dash = { strokeWidth: k, strokeDasharray: `${4 * k} ${3 * k}` };
  return (
    <svg
      className="cv-shape"
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      viewBox={`0 0 ${b.w} ${b.h}`}
      onPointerMove={onMove}
      onPointerUp={stop}
      onLostPointerCapture={stop}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <polygon className="cv-shape-line" points={P.map((q) => `${q.x},${q.y}`).join(' ')} style={{ strokeWidth: 1.5 * k }} />
      {guides.x !== undefined && <line className="cv-guide" x1={guides.x} x2={guides.x} y1={-b.y} y2={stage.h - b.y} style={dash} />}
      {guides.y !== undefined && <line className="cv-guide" x1={-b.x} x2={stage.w - b.x} y1={guides.y} y2={guides.y} style={dash} />}
      {P.map((q, i) => {
        const r = P[(i + 1) % P.length];
        return (
          <line
            key={'e' + i}
            className="cv-shape-edge"
            x1={q.x}
            y1={q.y}
            x2={r.x}
            y2={r.y}
            style={{ strokeWidth: 12 * k }}
            onPointerDown={(e) => insert(e, i)}
            onPointerMove={(e) => hoverEdge(e, i)}
            onPointerLeave={() => setPlus(null)}
          />
        );
      })}
      {plus && (
        <g className="cv-shape-plus" transform={`translate(${plus.x} ${plus.y}) scale(${k})`}>
          <circle r="7" />
          <path d="M-3.5 0H3.5M0 -3.5V3.5" />
        </g>
      )}
      {P.map((q, i) => (
        <circle
          key={'v' + i}
          className={'cv-shape-pt' + (i === point ? ' on' : '') + (pts[i].p ? ' share' : '')}
          cx={q.x}
          cy={q.y}
          r={5 * k}
          style={{ strokeWidth: 1.5 * k }}
          onPointerDown={(e) => e.button === 0 && startDrag(e, i, pts)}
          onDoubleClick={(e) => remove(e, i)}
        >
          <title>{pts[i].p ? '这个点跟着宽度按比例移动' : '拖动改形状，双击删掉'}</title>
        </circle>
      ))}
    </svg>
  );
}
