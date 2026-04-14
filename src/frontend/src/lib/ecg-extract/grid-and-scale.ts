import type { Point, Polyline, Layout, ScaleInfo, GridInfo } from '../types';
import type { ManufacturerProfile } from './profiles';

// Detect grid lines from non-black polylines in the PDF.
export function extractGridLines(P: Polyline[], vp: { width: number; height: number }, profile: ManufacturerProfile): GridInfo | null {
  const { blackThreshold } = profile.trace;
  const { lineStraightness, minHLineFraction, minVLineFraction, dedupDistance, majorGridThreshold, minLineCount } = profile.grid;

  const minHLen = vp.width * minHLineFraction;
  const minVLen = vp.height * minVLineFraction;

  // Track each grid line's stroke width so we can distinguish major (5 mm)
  // from minor (1 mm) lines later when the PDF draws them with different widths.
  const hLineEntries: { pos: number; w: number }[] = [];
  const vLineEntries: { pos: number; w: number }[] = [];

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
      hLineEntries.push({ pos: (yMin + yMax) / 2, w: p.w });
    } else if (dx < lineStraightness && dy > minVLen) {
      vLineEntries.push({ pos: (xMin + xMax) / 2, w: p.w });
    }
  }

  // Deduplicate: cluster lines within dedupDistance, keep cluster's max width
  // (so a major line clustered with a stray minor still flags as major).
  const dedupEntries = (entries: { pos: number; w: number }[]): { pos: number; w: number }[] => {
    if (!entries.length) return [];
    const sorted = [...entries].sort((a, b) => a.pos - b.pos);
    const result: { pos: number; w: number }[] = [];
    let sum = sorted[0].pos, count = 1, maxW = sorted[0].w;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].pos - sorted[i - 1].pos < dedupDistance) {
        sum += sorted[i].pos;
        count++;
        if (sorted[i].w > maxW) maxW = sorted[i].w;
      } else {
        result.push({ pos: sum / count, w: maxW });
        sum = sorted[i].pos;
        count = 1;
        maxW = sorted[i].w;
      }
    }
    result.push({ pos: sum / count, w: maxW });
    return result;
  };

  const hEntries = dedupEntries(hLineEntries);
  const vEntries = dedupEntries(vLineEntries);
  const hLines = hEntries.map(e => e.pos);
  const vLines = vEntries.map(e => e.pos);

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

  // Identify major (5 mm) grid lines. When the PDF uses a different stroke
  // width for major vs minor lines, the larger width is the discriminator.
  // Threshold = midpoint between the smallest and largest distinct widths.
  // This is best-effort: many PDFs draw all grid lines with the same width
  // and we simply leave hMajorLines / vMajorLines undefined in that case.
  let hMajorLines: number[] | undefined;
  let vMajorLines: number[] | undefined;
  const allWidths = [...hEntries, ...vEntries].map(e => e.w);
  const distinctWidths = [...new Set(allWidths)].sort((a, b) => a - b);
  if (distinctWidths.length >= 2) {
    const widthThreshold = (distinctWidths[0] + distinctWidths[distinctWidths.length - 1]) / 2;
    hMajorLines = hEntries.filter(e => e.w > widthThreshold).map(e => e.pos);
    vMajorLines = vEntries.filter(e => e.w > widthThreshold).map(e => e.pos);
    console.log(`[ECG] Major grid lines (width>${widthThreshold.toFixed(2)}): ${hMajorLines.length}H, ${vMajorLines.length}V`);
  }

  console.log(`[ECG] Grid scale: ${spacingX.toFixed(2)} pts/mm (X), ${spacingY.toFixed(2)} pts/mm (Y)`);
  return { spacingX, spacingY, hLines, vLines, hMajorLines, vMajorLines };
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

// Find the per-trace 0 mV baseline. Preference order:
//   1. Closest detected calibration pulse (most accurate when present)
//   2. Snap a robust per-trace estimate to the nearest major (5 mm) grid line
//   3. Snap to any grid line within 1 mm of the estimate
//   4. Return the unsnapped estimate
//
// The "estimate" is the *mode* of the trace's value-axis coordinates, not the
// bbox center. An ECG spends most of its time on the isoelectric line, so the
// most populous Y bin is a near-unbiased baseline. The bbox center, by
// contrast, drifts with R-wave amplitude — leads with tall R waves end up with
// a baseline pulled upward, leads with deep S waves get pulled down.
export function findBaselineForTrace(pts: Point[], calBaselines: number[], lay: Layout, grid?: GridInfo): number {
  const vK = lay.tA === 'x' ? 'y' : 'x';
  const vs = pts.map(p => p[vK]);

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
    const majorLines = vK === 'y' ? grid.hMajorLines : grid.vMajorLines;
    const allLines = vK === 'y' ? grid.hLines : grid.vLines;
    const spacing = vK === 'y' ? grid.spacingY : grid.spacingX;

    // Path 2: snap to nearest major grid line, but cap the displacement at
    // 5 mm. Beyond that we'd be jumping to a neighboring lead's baseline
    // (cells are typically 30-40 mm tall), which is worse than the estimate.
    if (majorLines && majorLines.length > 0 && spacing > 0) {
      const maxDisplacement = spacing * 5; // 5 mm
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

// Most populous 1-pt bin of a 1-D distribution. For an ECG trace, this finds
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
