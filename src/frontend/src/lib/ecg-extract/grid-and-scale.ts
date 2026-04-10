import type { Point, Polyline, Layout, ScaleInfo, GridInfo } from '../types';
import type { ManufacturerProfile } from './profiles';

// Detect grid lines from non-black polylines in the PDF.
export function extractGridLines(P: Polyline[], vp: { width: number; height: number }, profile: ManufacturerProfile): GridInfo | null {
  const { blackThreshold } = profile.trace;
  const { lineStraightness, minHLineFraction, minVLineFraction, dedupDistance, majorGridThreshold, minLineCount } = profile.grid;

  const minHLen = vp.width * minHLineFraction;
  const minVLen = vp.height * minVLineFraction;

  const hLineYs: number[] = [];
  const vLineXs: number[] = [];

  for (const p of P) {
    if (p.col[0] < blackThreshold && p.col[1] < blackThreshold && p.col[2] < blackThreshold) continue;
    if (p.pts.length < 2) continue;

    const ys = p.pts.map(pt => pt.y);
    const xs = p.pts.map(pt => pt.x);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const dy = yMax - yMin;
    const dx = xMax - xMin;

    if (dy < lineStraightness && dx > minHLen) {
      hLineYs.push((yMin + yMax) / 2);
    } else if (dx < lineStraightness && dy > minVLen) {
      vLineXs.push((xMin + xMax) / 2);
    }
  }

  // Deduplicate: cluster lines within dedupDistance of each other
  const dedup = (vals: number[]): number[] => {
    if (!vals.length) return [];
    const sorted = [...vals].sort((a, b) => a - b);
    const result: number[] = [sorted[0]];
    let sum = sorted[0], count = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < dedupDistance) {
        sum += sorted[i];
        count++;
      } else {
        result[result.length - 1] = sum / count;
        result.push(sorted[i]);
        sum = sorted[i];
        count = 1;
      }
    }
    result[result.length - 1] = sum / count;
    return result;
  };

  const hLines = dedup(hLineYs);
  const vLines = dedup(vLineXs);

  console.log(`[ECG] Grid: ${hLines.length}H x ${vLines.length}V lines`);

  if (hLines.length < minLineCount || vLines.length < minLineCount) {
    console.log(`[ECG] Grid detection failed: not enough lines`);
    return null;
  }

  const medianGap = (vals: number[]): number => {
    const gaps: number[] = [];
    for (let i = 1; i < vals.length; i++) gaps.push(vals[i] - vals[i - 1]);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  };

  let spacingX = medianGap(vLines);
  let spacingY = medianGap(hLines);

  if (spacingX > majorGridThreshold) spacingX /= 5;
  if (spacingY > majorGridThreshold) spacingY /= 5;

  console.log(`[ECG] Grid scale: ${spacingX.toFixed(2)} pts/mm (X), ${spacingY.toFixed(2)} pts/mm (Y)`);
  return { spacingX, spacingY, hLines, vLines };
}

// Convert grid spacing to physical scale info
export function computeScaleFromGrid(grid: GridInfo): ScaleInfo {
  const pmmX = grid.spacingX;
  const pmmY = grid.spacingY;
  const pmm = (pmmX + pmmY) / 2;
  return { pmm, pps: pmm * 25, ppv: pmm * 10, pmmX, pmmY };
}

// Find calibration pulses: small black polylines whose height = 1mV.
// The bottom of each pulse (max Y in viewport) is the exact 0mV baseline.
export function extractCalibrationBaselines(P: Polyline[], sc: ScaleInfo, lay: Layout, profile: ManufacturerProfile): number[] {
  const { blackThreshold } = profile.trace;
  const { minPoints, maxPoints, heightTolerance } = profile.calibration;
  const vK = lay.tA === 'x' ? 'y' : 'x';
  const ppv = vK === 'y' ? sc.pmmY * 10 : sc.pmmX * 10;
  const tolerance = ppv * heightTolerance;

  const calPulses = P.filter(p =>
    p.col[0] < blackThreshold && p.col[1] < blackThreshold && p.col[2] < blackThreshold &&
    p.pts.length >= minPoints && p.pts.length <= maxPoints
  );

  const baselines: number[] = [];
  for (const p of calPulses) {
    const vs = p.pts.map(pt => pt[vK]);
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

// Match a trace to its nearest calibration baseline.
// Fallback: if no calibration baselines were detected (some PDF formats don't have
// detectable calibration pulses), use the trace's vertical center as baseline.
export function findBaselineForTrace(pts: Point[], calBaselines: number[], lay: Layout): number {
  const vK = lay.tA === 'x' ? 'y' : 'x';
  const vs = pts.map(p => p[vK]);
  const vCenter = (Math.min(...vs) + Math.max(...vs)) / 2;

  if (calBaselines.length === 0) return vCenter;

  let nearest = calBaselines[0], minDist = Math.abs(vCenter - calBaselines[0]);
  for (let i = 1; i < calBaselines.length; i++) {
    const d = Math.abs(vCenter - calBaselines[i]);
    if (d < minDist) { minDist = d; nearest = calBaselines[i]; }
  }
  return nearest;
}
