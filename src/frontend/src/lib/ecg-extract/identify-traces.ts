import type { Polyline } from '../types';
import type { ManufacturerProfile } from './profiles';

// Find ECG signal traces among all polylines:
// black color, enough points, significant size relative to the largest trace.
export function idTraces(P: Polyline[], profile: ManufacturerProfile): Polyline[] {
  const { blackThreshold, minPoints, minSizeRatio, maxTraces } = profile.trace;
  let candidates = P.filter(p => p.col[0] < blackThreshold && p.col[1] < blackThreshold && p.col[2] < blackThreshold && p.pts.length > minPoints);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.pts.length - a.pts.length);
  const mx = candidates[0].pts.length;
  candidates = candidates.filter(p => p.pts.length >= mx * minSizeRatio);

  for (const t of candidates) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of t.pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    t.bb = { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, dx: x1 - x0, dy: y1 - y0 };
  }
  return candidates.slice(0, maxTraces);
}
