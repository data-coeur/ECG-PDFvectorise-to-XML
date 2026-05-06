// 07  extract-grid — locate the horizontal and vertical lines of the ECG
// paper grid from the non-black polylines.
//
// We collect every long, very-straight polyline of grid colour (anything
// outside the "black" range), deduplicate near-duplicates, then return
// the sorted Y positions of horizontal lines and X positions of vertical
// lines. When the PDF draws major (5 mm) and minor (1 mm) lines with
// different stroke widths, we also surface the major-line subset so
// downstream stages can snap baselines onto them.

import type { Polyline, GridInfo } from '../types';
import type { ManufacturerProfile } from './profiles';
import { isBlackPolyline } from './polyline-utils';

export function extractGridLines(
  P: Polyline[],
  vp: { width: number; height: number },
  profile: ManufacturerProfile,
): GridInfo | null {
  const { blackThreshold } = profile.trace;
  const { lineStraightness, minHLineFraction, minVLineFraction, dedupDistance, majorGridThreshold, minLineCount } = profile.grid;

  const minHLen = vp.width * minHLineFraction;
  const minVLen = vp.height * minVLineFraction;

  // Track each grid line's stroke width so we can distinguish major (5 mm)
  // from minor (1 mm) lines later when the PDF draws them with different widths.
  const hLineEntries: { pos: number; w: number }[] = [];
  const vLineEntries: { pos: number; w: number }[] = [];

  for (const p of P) {
    if (isBlackPolyline(p, blackThreshold)) continue;  // skip the signal traces
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

  const hEntries = dedupEntries(hLineEntries, dedupDistance);
  const vEntries = dedupEntries(vLineEntries, dedupDistance);
  const hLines = hEntries.map(e => e.pos);
  const vLines = vEntries.map(e => e.pos);

  console.log(`[ECG] Grid: ${hLines.length}H × ${vLines.length}V lines`);

  if (hLines.length < minLineCount || vLines.length < minLineCount) {
    console.log(`[ECG] Grid detection failed: not enough lines`);
    return null;
  }

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

// Cluster lines whose positions are within `dedupDistance` of each other.
// Keeps the cluster's max width so a major line clustered with a stray
// minor still flags as major.
function dedupEntries(
  entries: { pos: number; w: number }[],
  dedupDistance: number,
): { pos: number; w: number }[] {
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
}

function medianGap(vals: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < vals.length; i++) gaps.push(vals[i] - vals[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
