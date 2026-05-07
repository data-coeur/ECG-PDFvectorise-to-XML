// 09  detect-layout — identifie le layout de la page : quel axe porte le
// temps, si la tension est inversée, et comment les 12 leads sont disposés.
// Détection en 2 étapes : (1) axe temps via comptage de monotonicité X vs Y ;
// (2) parmi stacked_12x1 / sequential_6x2 / grid_4x3, prend celui dont le
// nombre de rangs/colonnes correspond aux bbox des traces.
// In  : traces + viewport + profile. Out : Layout { type, timeAxis, verticalInverted }.

import type { Polyline, Layout } from '../types';
import type { ManufacturerProfile } from './profiles';

export function detectLayout(
  traces: Polyline[],
  viewport: { width: number; height: number },
  profile: ManufacturerProfile,
): Layout {
  const { monotonicityThreshold, monotonicityTolerance, colClusterFraction, rowClusterFraction, wideTraceFraction, expectedLayout } = profile.layout;

  // Step 1: time axis + vertical inversion ────────────────────────────────
  let xMonoCount = 0, yMonoCount = 0;
  for (const trace of traces) {
    const pts = trace.pts;
    let xMono = true, yMonoInc = true, yMonoDec = true;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x < pts[i - 1].x - monotonicityTolerance) xMono = false;
      if (pts[i].y < pts[i - 1].y - monotonicityTolerance) yMonoInc = false;
      if (pts[i].y > pts[i - 1].y + monotonicityTolerance) yMonoDec = false;
    }
    if (xMono) xMonoCount++;
    if (yMonoInc || yMonoDec) yMonoCount++;
  }

  let timeAxis: 'x' | 'y';
  let verticalInverted: boolean;
  if (xMonoCount >= traces.length * monotonicityThreshold) {
    timeAxis = 'x'; verticalInverted = true;
  } else if (yMonoCount >= traces.length * monotonicityThreshold) {
    timeAxis = 'y'; verticalInverted = true;
  } else {
    const avgDx = traces.reduce((sum, t) => sum + t.bb!.dx, 0) / traces.length;
    const avgDy = traces.reduce((sum, t) => sum + t.bb!.dy, 0) / traces.length;
    timeAxis = avgDx >= avgDy ? 'x' : 'y';
    verticalInverted = timeAxis === 'x';
  }

  // Step 2: arrangement ───────────────────────────────────────────────────
  if (expectedLayout) return { type: expectedLayout, timeAxis, verticalInverted };

  const timeExtent = timeAxis === 'x' ? viewport.width : viewport.height;
  const allWide = traces.every(t => (timeAxis === 'x' ? t.bb!.dx : t.bb!.dy) > timeExtent * wideTraceFraction);

  if (timeAxis === 'x' && traces.length >= 12) {
    const cxVals = traces.map(t => t.bb!.cx).sort((a, b) => a - b);
    const cyVals = traces.map(t => t.bb!.cy).sort((a, b) => a - b);
    const cols = clusterValues(cxVals, viewport.width * colClusterFraction);
    const rows = clusterValues(cyVals, viewport.height * rowClusterFraction);
    if (cols.length >= 4 && rows.length >= 3) {
      return { type: 'grid_4x3', timeAxis, verticalInverted };
    }
    // 6x2 layout: 2 columns × at least 5 rows (12 leads = 6 left + 6 right)
    if (cols.length === 2 && rows.length >= 5) {
      return { type: 'sequential_6x2', timeAxis, verticalInverted };
    }
  }

  if (allWide) return { type: 'stacked_12x1', timeAxis, verticalInverted };

  // Fallback: split into upper/lower halves and check the population of each.
  const cyVals = traces.map(t => t.bb!.cy);
  const cyMid = (Math.min(...cyVals) + Math.max(...cyVals)) / 2;
  const upper = traces.filter(t => t.bb!.cy < cyMid);
  const lower = traces.filter(t => t.bb!.cy >= cyMid);
  if (upper.length >= 4 && lower.length >= 4 && upper.length <= 8 && lower.length <= 8) {
    return { type: 'sequential_6x2', timeAxis, verticalInverted };
  }
  return { type: 'stacked_12x1', timeAxis, verticalInverted };
}

// Group sorted values into clusters separated by gaps greater than `threshold`.
function clusterValues(sorted: number[], threshold: number): number[][] {
  if (!sorted.length) return [];
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > threshold) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }
  return clusters;
}
