// 11  find-baselines — localise la ligne 0 mV de référence pour chaque lead.
// Deux sources, par ordre de fiabilité :
//   1. Impulsions de calibration imprimées sur le PDF (carrés noirs 1 mV) ;
//   2. La trace elle-même : mode de l'histogramme de ses Y (la ligne
//      isoélectrique vu que P-Q-T-segment dominent), snappé sur la ligne
//      majeure (5 mm) la plus proche pour atterrir sur un trait réel.
// In  : polylines + scale + layout + grid?. Out : Y de baseline par trace.

import type { Point, Polyline, Layout, ScaleInfo, GridInfo } from '../types';
import type { ManufacturerProfile } from './profiles';
import { isBlackPolyline } from './polyline-utils';

/**
 * Find every printed calibration pulse and return the Y of its 0 mV edge.
 * Calibration pulses are small black polylines whose height equals 1 mV.
 */
export function extractCalibrationBaselines(
  polylines: Polyline[],
  scale: ScaleInfo,
  layout: Layout,
  profile: ManufacturerProfile,
): number[] {
  const { blackThreshold } = profile.trace;
  const { minPoints, maxPoints, heightTolerance } = profile.calibration;
  const valueAxis = layout.timeAxis === 'x' ? 'y' : 'x';
  const ptsPerMv = valueAxis === 'y' ? scale.pmmY * 10 : scale.pmmX * 10;
  const tolerance = ptsPerMv * heightTolerance;

  const calPulses = polylines.filter(p =>
    isBlackPolyline(p, blackThreshold) &&
    p.pts.length >= minPoints && p.pts.length <= maxPoints
  );

  const baselines: number[] = [];
  for (const pulse of calPulses) {
    const vs = pulse.pts.map(pt => pt[valueAxis]);
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    const height = vMax - vMin;
    if (Math.abs(height - ptsPerMv) < tolerance) {
      const baseline = layout.verticalInverted ? vMax : vMin;
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
  layout: Layout,
  grid?: GridInfo,
): number {
  const valueAxis = layout.timeAxis === 'x' ? 'y' : 'x';
  const vs = pts.map(p => p[valueAxis]);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);

  // Path 1: explicit calibration pulses — but only when one actually sits at
  // this trace's height. A stacked 12×1 layout sometimes prints a single 1 mV
  // reference pulse for the whole page; blindly snapping every lead to that one
  // pulse would offset 11 of them by their distance down the stack. A genuine
  // per-lead pulse always lies within (or very close to) the trace's own value
  // range, so reject any nearest pulse farther than `tol` from [vMin, vMax].
  if (calBaselines.length > 0) {
    const vCenter = (vMin + vMax) / 2;
    let nearest = calBaselines[0], minDist = Math.abs(vCenter - calBaselines[0]);
    for (let i = 1; i < calBaselines.length; i++) {
      const d = Math.abs(vCenter - calBaselines[i]);
      if (d < minDist) { minDist = d; nearest = calBaselines[i]; }
    }
    // A genuine per-lead pulse sits at the isoelectric line, i.e. inside the
    // trace's value excursion. Allow only a small margin (≈2 mm) for pulses
    // drawn just past the signal edge — anything more would let a lead snap to
    // its neighbour's pulse (cells are only ~10 mm tall in 12×1 layouts).
    const spacing = valueAxis === 'y' ? grid?.spacingY : grid?.spacingX;
    const tol = spacing && spacing > 0 ? spacing * 2 : (vMax - vMin) * 0.25;
    if (nearest >= vMin - tol && nearest <= vMax + tol) return nearest;
    // Otherwise fall through to the per-trace grid-snapped mode estimate.
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
