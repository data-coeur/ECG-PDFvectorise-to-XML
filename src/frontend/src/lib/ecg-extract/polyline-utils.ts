// Tiny helpers used by several pipeline stages. None of them have any
// per-stage logic — they're just primitives that were duplicated across
// files until we collected them here.

import type { Point, Polyline, BoundingBox } from '../types';

/**
 * Pdfjs sometimes hands us colours in the [0, 255] range (e.g. on
 * matplotlib-generated PDFs) instead of the standard [0, 1]. If any
 * component looks > 1 we assume 0-255 and divide; otherwise pass through.
 */
export function normalizeColor(c: number[]): number[] {
  if (c[0] > 1 || c[1] > 1 || c[2] > 1) {
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }
  return c;
}

/**
 * True when every RGB component of the polyline's stroke colour is below
 * the "black" threshold. Used by find-signal-traces, extract-grid (to
 * exclude the signal), and find-baselines (to find calibration pulses).
 */
export function isBlackPolyline(p: Polyline, blackThreshold: number): boolean {
  return p.col[0] < blackThreshold && p.col[1] < blackThreshold && p.col[2] < blackThreshold;
}

/** Min/max bounding box plus centre and span — derived once and reused. */
export function computeBoundingBox(pts: Point[]): BoundingBox {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, dx: x1 - x0, dy: y1 - y0 };
}
