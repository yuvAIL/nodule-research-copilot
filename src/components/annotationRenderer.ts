import type { Finding } from '../findings/types';
import type { Labelmap } from '../measure/labelmap';
import type { Point2 } from '../measure/measure';

/** Converts between voxel positions on the displayed slice and canvas (CSS px) positions. */
export interface ViewMapper {
  sliceIndex: number;
  voxelToCanvas(i: number, j: number): [number, number];
  canvasToVoxel(x: number, y: number): { i: number; j: number; k: number };
  /** mm per CSS pixel along the image rows. */
  mmPerPx: number;
}

export interface AnnotationScene {
  labelmap: Labelmap;
  findings: Finding[];
  selectedId?: string;
  brush?: { x: number; y: number; radiusMm: number; erase: boolean };
}

type Rgb = [number, number, number];
const SELECTED: Rgb = [95, 200, 240];
const APPROVED: Rgb = [92, 214, 140];
const UNREVIEWED: Rgb = [240, 190, 80];

function colorFor(f: Finding, selectedId: string | undefined): Rgb | undefined {
  if (f.status === 'rejected') return undefined;
  if (f.id === selectedId) return SELECTED;
  return f.status === 'approved' ? APPROVED : UNREVIEWED;
}

let offscreen: HTMLCanvasElement | undefined;

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function drawAxis(ctx: CanvasRenderingContext2D, view: ViewMapper, axis: [Point2, Point2], color: Rgb, dashed: boolean): void {
  const a = view.voxelToCanvas(axis[0][0], axis[0][1]);
  const b = view.voxelToCanvas(axis[1][0], axis[1][1]);
  ctx.save();
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 2;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, 1);
    ctx.fill();
  }
  ctx.restore();
}

function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: Rgb): void {
  ctx.save();
  ctx.font = '600 12px ui-monospace, Menlo, monospace';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(8, 12, 16, 0.78)';
  ctx.fillRect(x, y - 16, w, 18);
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.strokeRect(x + 0.5, y - 15.5, w - 1, 17);
  ctx.fillStyle = rgba(color, 1);
  ctx.fillText(text, x + 5, y - 3);
  ctx.restore();
}

export function drawAnnotations(ctx: CanvasRenderingContext2D, view: ViewMapper, scene: AnnotationScene): void {
  const { labelmap, findings, selectedId } = scene;
  const k = view.sliceIndex;

  // ── outlines (filled mask + bright edge) ──────────────────────
  if (k >= 0 && k < labelmap.slices) {
    const lut: (Rgb | undefined)[] = new Array(256);
    for (const f of findings) lut[f.label] = colorFor(f, selectedId);
    const slice = labelmap.sliceView(k);
    const { cols, rows } = labelmap;
    const tagAt = new Map<number, [number, number]>(); // label -> top-most pixel

    let any = false;
    for (let p = 0; p < slice.length; p++) {
      if (slice[p] !== 0) {
        any = true;
        break;
      }
    }
    if (any) {
      offscreen ??= document.createElement('canvas');
      if (offscreen.width !== cols || offscreen.height !== rows) {
        offscreen.width = cols;
        offscreen.height = rows;
      }
      const octx = offscreen.getContext('2d');
      if (octx) {
        const img = octx.createImageData(cols, rows);
        const px = img.data;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const p = j * cols + i;
            const l = slice[p] as number;
            if (!l) continue;
            const c = lut[l];
            if (!c) continue;
            if (!tagAt.has(l)) tagAt.set(l, [i, j]);
            const edge =
              i === 0 || j === 0 || i === cols - 1 || j === rows - 1 ||
              slice[p - 1] !== l || slice[p + 1] !== l || slice[p - cols] !== l || slice[p + cols] !== l;
            const q = p * 4;
            px[q] = c[0];
            px[q + 1] = c[1];
            px[q + 2] = c[2];
            px[q + 3] = edge ? 235 : 60;
          }
        }
        octx.putImageData(img, 0, 0);

        // Map image pixel space onto the canvas with the viewport's current zoom/pan.
        const o = view.voxelToCanvas(0, 0);
        const ex = view.voxelToCanvas(1, 0);
        const ey = view.voxelToCanvas(0, 1);
        const a = ex[0] - o[0];
        const b = ex[1] - o[1];
        const c = ey[0] - o[0];
        const d = ey[1] - o[1];
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.transform(a, b, c, d, o[0] - 0.5 * (a + c), o[1] - 0.5 * (b + d));
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();
      }
    }

    // ── axes + tags ───────────────────────────────────────────────
    for (const f of findings) {
      const color = colorFor(f, selectedId);
      if (!color) continue;
      const m = f.measurement;
      if (m && m.sliceIndex === k) {
        drawAxis(ctx, view, m.longAxis, color, false);
        drawAxis(ctx, view, m.shortAxis, color, true);
        const end = view.voxelToCanvas(m.longAxis[1][0], m.longAxis[1][1]);
        const start = view.voxelToCanvas(m.longAxis[0][0], m.longAxis[0][1]);
        const anchor = end[0] >= start[0] ? end : start;
        drawTag(ctx, anchor[0] + 8, anchor[1], `${f.name}  ${m.longMm.toFixed(1)} × ${m.shortMm.toFixed(1)} mm`, color);
      } else {
        const top = tagAt.get(f.label);
        if (top) {
          const p = view.voxelToCanvas(top[0], top[1]);
          drawTag(ctx, p[0] + 6, p[1] - 6, f.name, color);
        }
      }
    }
  }

  // ── brush cursor ─────────────────────────────────────────────
  const brush = scene.brush;
  if (brush && view.mmPerPx > 0) {
    const r = brush.radiusMm / view.mmPerPx;
    ctx.save();
    ctx.strokeStyle = brush.erase ? 'rgba(255, 120, 110, 0.95)' : 'rgba(95, 200, 240, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash(brush.erase ? [4, 3] : []);
    ctx.beginPath();
    ctx.arc(brush.x, brush.y, Math.max(2, r), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
