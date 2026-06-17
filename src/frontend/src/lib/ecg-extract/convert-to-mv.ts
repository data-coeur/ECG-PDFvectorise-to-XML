// 12  convert-to-mv — transforme une polyligne en coordonnées PDF en tableau
// de samples mV, sachant le scale physique et le baseline 0 mV de la trace.
// Deux chemins selon l'espacement temporel des points : si uniforme (ex. MUSE,
// matplotlib), garde les samples tels quels (préserve les détails fins) ;
// sinon, ré-échantillonne à 500 Hz par interpolation linéaire.
// In  : Point[] + scale + layout + gridBaseline. Out : { samples: mV[], dur: s }.

import type { Point, Layout, ScaleInfo } from '../types';

const UNIFORMITY_THRESHOLD = 0.10;
const RESAMPLE_RATE_HZ = 500;

export function convertToMv(
  pts: Point[],
  scale: ScaleInfo,
  layout: Layout,
  gridBaseline: number,
): { samples: number[]; dur: number } {
  if (pts.length < 2) return { samples: [], dur: 0 };

  const timeAxis = layout.timeAxis;
  const valueAxis = timeAxis === 'x' ? 'y' : 'x';
  const ptsPerSecond = timeAxis === 'x' ? scale.pmmX * 25 : scale.pmmY * 25;
  const ptsPerMv = valueAxis === 'y' ? scale.pmmY * 10 : scale.pmmX * 10;

  // Sort points along the time axis. If the PDF drew the trace right-to-left
  // (so `pts[0]` is to the right of `pts[last]`), we end up with the same
  // sorted array — but we want the time origin on the visible left, so
  // reverse it back.
  const sorted = [...pts].sort((a, b) => a[timeAxis] - b[timeAxis]);
  if (pts.length > 10) {
    const firstTime = pts[0][timeAxis];
    const lastTime = pts[pts.length - 1][timeAxis];
    if (firstTime > lastTime + 1) sorted.reverse();
  }

  const tStart = sorted[0][timeAxis];
  const tEnd = sorted[sorted.length - 1][timeAxis];
  const duration = Math.abs(tEnd - tStart) / ptsPerSecond;

  // Convert one PDF coordinate value into mV. `verticalInverted` flips the
  // sign for PDF coordinate systems where Y grows downward.
  const verticalInverted = layout.verticalInverted;
  const toMv = (v: number) => {
    let mv = (v - gridBaseline) / ptsPerMv;
    if (verticalInverted) mv = -mv;
    return Math.round(mv * 10000) / 10000;
  };

  // Decide uniform vs non-uniform by checking inter-point gap variance.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i][timeAxis] - sorted[i - 1][timeAxis]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  let isUniform = medianGap > 0;
  if (isUniform) {
    for (const g of gaps) {
      if (Math.abs(g - medianGap) / medianGap > UNIFORMITY_THRESHOLD) { isUniform = false; break; }
    }
  }

  if (isUniform) {
    return { samples: sorted.map(p => toMv(p[valueAxis])), dur: duration };
  }

  // Non-uniform — linearly interpolate onto a uniform grid. Resample at 500 Hz,
  // but never below the source's own resolution: decimating a dense trace
  // (e.g. AMPS-LLC ~1000 Hz) onto a coarser grid would clip the sharp QRS tips.
  // Sparse traces keep the previous behaviour (their point count stays under
  // the 500 Hz target, so the max() picks the 500 Hz grid).
  const targetCount = Math.max(2, Math.round(duration * RESAMPLE_RATE_HZ), sorted.length);
  const tSpan = tEnd - tStart;
  const dt = tSpan / (targetCount - 1);
  const samples = new Array<number>(targetCount);

  let lo = 0;
  for (let i = 0; i < targetCount; i++) {
    const t = tStart + i * dt;
    while (lo < sorted.length - 2 && sorted[lo + 1][timeAxis] < t) lo++;
    const t0 = sorted[lo][timeAxis], t1 = sorted[lo + 1][timeAxis];
    const v0 = sorted[lo][valueAxis], v1 = sorted[lo + 1][valueAxis];
    const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    samples[i] = toMv(v0 + (v1 - v0) * frac);
  }

  return { samples, dur: duration };
}
