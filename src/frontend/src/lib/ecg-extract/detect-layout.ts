import type { Polyline, Layout } from '../types';
import type { ManufacturerProfile } from './profiles';

// Determine the ECG page layout from trace positions and page dimensions.
export function detectLayout(tr: Polyline[], vp: { width: number; height: number }, profile: ManufacturerProfile): Layout {
  const { monotonicityThreshold, monotonicityTolerance, colClusterFraction, rowClusterFraction, wideTraceFraction, expectedLayout } = profile.layout;

  // Detect time axis and voltage inversion from trace monotonicity
  let xMonoCount = 0, yMonoCount = 0;
  for (const t of tr) {
    const pts = t.pts;
    let xMono = true, yMonoInc = true, yMonoDec = true;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x < pts[i - 1].x - monotonicityTolerance) xMono = false;
      if (pts[i].y < pts[i - 1].y - monotonicityTolerance) yMonoInc = false;
      if (pts[i].y > pts[i - 1].y + monotonicityTolerance) yMonoDec = false;
    }
    if (xMono) xMonoCount++;
    if (yMonoInc || yMonoDec) yMonoCount++;
  }

  let tA: 'x' | 'y', vI: boolean;
  if (xMonoCount >= tr.length * monotonicityThreshold) {
    tA = 'x'; vI = true;
  } else if (yMonoCount >= tr.length * monotonicityThreshold) {
    tA = 'y'; vI = true;
  } else {
    const adx = tr.reduce((s, t) => s + t.bb!.dx, 0) / tr.length;
    const ady = tr.reduce((s, t) => s + t.bb!.dy, 0) / tr.length;
    tA = adx >= ady ? 'x' : 'y';
    vI = tA === 'x';
  }

  // If the profile specifies an expected layout, use it (skip auto-detection)
  if (expectedLayout) return { type: expectedLayout, tA, vI };

  const timeExtent = tA === 'x' ? vp.width : vp.height;
  const allWide = tr.every(t => (tA === 'x' ? t.bb!.dx : t.bb!.dy) > timeExtent * wideTraceFraction);

  if (tA === 'x' && tr.length >= 12) {
    const cxVals = tr.map(t => t.bb!.cx).sort((a, b) => a - b);
    const cols = clusterValues(cxVals, vp.width * colClusterFraction);
    const cyVals = tr.map(t => t.bb!.cy).sort((a, b) => a - b);
    const rows = clusterValues(cyVals, vp.height * rowClusterFraction);
    if (cols.length >= 4 && rows.length >= 3) {
      return { type: 'grid_4x3', tA, vI };
    }
  }

  const perpVals = tr.map(t => t.bb!.cy);
  const perpMin = Math.min(...perpVals), perpMax = Math.max(...perpVals);
  const perpMid = (perpMin + perpMax) / 2;
  const grp1 = tr.filter(t => t.bb!.cy < perpMid);
  const grp2 = tr.filter(t => t.bb!.cy >= perpMid);

  if (allWide) return { type: 'stacked_12x1', tA, vI };

  if (grp1.length >= 4 && grp2.length >= 4 && grp1.length <= 8 && grp2.length <= 8) {
    return { type: 'sequential_6x2', tA, vI };
  }
  return { type: 'stacked_12x1', tA, vI };
}

// Group sorted values into clusters separated by gaps > threshold
export function clusterValues(sorted: number[], threshold: number): number[][] {
  if (!sorted.length) return [];
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > threshold) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }
  return clusters;
}
