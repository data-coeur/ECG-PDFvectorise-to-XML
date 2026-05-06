// 11  find-baselines — locate the 0 mV reference line for each lead.
//
// Two sources of information, in order of trust:
//   1. Calibration pulses printed on the PDF (small black square waves of
//      exactly 1 mV height): when present, give an exact baseline. Their
//      bottom edge IS the 0 mV line.
//   2. The trace itself, if no calibration is present: take the histogram
//      mode of the trace's value-axis coordinates as the estimated
//      isoelectric line, then snap onto the nearest major (5 mm) grid
//      line so the baseline lands on a real printed gridline.
//
// The bbox centre of the trace was used historically but is biased by R-wave
// amplitude (leads with tall R waves get a baseline that drifts upward,
// leads with deep S waves drift downward) — never use it.

import type { Point, Polyline, Layout, ScaleInfo, GridInfo } from '../types';
import type { ManufacturerProfile } from './profiles';

/**
 * Find every printed calibration pulse and return the Y of its 0 mV edge.
 * Calibration pulses are small black polylines whose height equals 1 mV.
 */
export function extractCalibrationBaselines(
  P: Polyline[],
  sc: ScaleInfo,
  lay: Layout,
  profile: ManufacturerProfile,
): number[] {
  const { blackThreshold } = profile.trace;
  const { minPoints, maxPoints, heightTolerance } = profile.calibration;
  const valueAxis = lay.tA === 'x' ? 'y' : 'x';
  const ppv = valueAxis === 'y' ? sc.pmmY * 10 : sc.pmmX * 10;
  const tolerance = ppv * heightTolerance;

  const calPulses = P.filter(p =>
    p.col[0] < blackThreshold && p.col[1] < blackThreshold && p.col[2] < blackThreshold &&
    p.pts.length >= minPoints && p.pts.length <= maxPoints
  );

  const baselines: number[] = [];
  for (const p of calPulses) {
    const vs = p.pts.map(pt => pt[valueAxis]);
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    const height = vMax - vMin;
    if (Math.abs(height - ppv) < tolerance) {
      const baseline = lay.vI ? vMax : vMin;
      baselines.push(baseline);
    }
  }

  baselines.sort((a, b) => a - b);
  console.log(`[ECG] Calibration pulses: ${baselines.length} found`);
  return baselines;
}

/**
 * Find the per-trace 0 mV baseline. Tries, in order:
 *   1. Closest detected calibration pulse (most accurate when present)
 *   2. Mode-of-trace estimate snapped to nearest major (5 mm) grid line
 *   3. Mode-of-trace estimate snapped to any grid line within 1 mm
 *   4. Unsnapped mode estimate
 */
export function findBaselineForTrace(
  pts: Point[],
  calBaselines: number[],
  lay: Layout,
  grid?: GridInfo,
): number {
  const valueAxis = lay.tA === 'x' ? 'y' : 'x';
  const vs = pts.map(p => p[valueAxis]);

  // Path 1: explicit calibration pulses
  if (calBaselines.length > 0) {
    const vCenter = (Math.min(...vs) + Math.max(...vs)) / 2;
    let nearest = calBaselines[0], minDist = Math.abs(vCenter - calBaselines[0]);
    for (let i = 1; i < calBaselines.length; i++) {
      const d = Math.abs(vCenter - calBaselines[i]);
      if (d < minDist) { minDist = d; nearest = calBaselines[i]; }
    }
    return nearest;
  }

  // Robust baseline estimate via 1-pt histogram mode
  const estimate = computeModeBaseline(vs);

  if (grid) {
    const majorLines = valueAxis === 'y' ? grid.hMajorLines : grid.vMajorLines;
    const allLines = valueAxis === 'y' ? grid.hLines : grid.vLines;
    const spacing = valueAxis === 'y' ? grid.spacingY : grid.spacingX;

    // Path 2: snap to nearest major grid line, but cap the displacement at
    // 5 mm. Beyond that we'd be jumping to a neighbouring lead's baseline
    // (cells are typically 30-40 mm tall), which is worse than the estimate.
    if (majorLines && majorLines.length > 0 && spacing > 0) {
      const maxDisplacement = spacing * 5;
      const snapped = snapToNearest(estimate, majorLines);
      if (Math.abs(snapped - estimate) <= maxDisplacement) return snapped;
    }

    // Path 3: no major lines distinguishable — try any grid line within 1 mm.
    if (allLines && allLines.length > 0 && spacing > 0) {
      const snapped = snapToNearest(estimate, allLines);
      if (Math.abs(snapped - estimate) <= spacing) return snapped;
    }
  }

  // Path 4: no usable grid context — return the unsnapped mode estimate.
  return estimate;
}

// Most populous 1-pt bin of a 1-D distribution. For an ECG trace this finds
// the isoelectric line because flat segments (PQ, ST, TP) dominate the histogram.
function computeModeBaseline(vs: number[]): number {
  if (vs.length === 0) return 0;
  if (vs.length === 1) return vs[0];
  const bins = new Map<number, number>();
  for (const v of vs) {
    const bin = Math.floor(v);
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }
  let bestBin = Math.floor(vs[0]), bestCount = -1;
  for (const [bin, count] of bins) {
    if (count > bestCount) { bestCount = count; bestBin = bin; }
  }
  return bestBin + 0.5;
}

function snapToNearest(target: number, candidates: number[]): number {
  let best = candidates[0], bestDist = Math.abs(target - candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(target - candidates[i]);
    if (d < bestDist) { bestDist = d; best = candidates[i]; }
  }
  return best;
}
