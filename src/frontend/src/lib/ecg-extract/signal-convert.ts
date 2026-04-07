import type { Point, Layout, ScaleInfo } from '../types';

// Convert PDF pixel coordinates to physical units (millivolts, seconds).
//
// Strategy:
//   1. If the PDF source has uniform temporal spacing (e.g. MUSE, this PDF),
//      use the original samples directly — no interpolation, preserves all
//      fine baseline details exactly as drawn in the PDF.
//   2. If the PDF source has non-uniform spacing (e.g. DICOM italian, where
//      flat regions have fewer points), resample to a uniform 500 Hz grid
//      via linear interpolation between PDF polyline points.
const UNIFORMITY_THRESHOLD = 0.10;  // accept ≤10% variation in inter-point gaps
const RESAMPLE_RATE_HZ = 500;

export function toPhysical(pts: Point[], sc: ScaleInfo, lay: Layout, gridBaseline: number): { samples: number[]; dur: number } {
  if (pts.length < 2) return { samples: [], dur: 0 };
  const tA = lay.tA, vK = tA === 'x' ? 'y' : 'x';
  const ppsAxis = tA === 'x' ? sc.pmmX * 25 : sc.pmmY * 25;
  const ppvAxis = vK === 'y' ? sc.pmmY * 10 : sc.pmmX * 10;

  // Sort by time axis
  const s = [...pts].sort((a, b) => a[tA] - b[tA]);
  if (pts.length > 10) {
    const firstT = pts[0][tA], lastT = pts[pts.length - 1][tA];
    if (firstT > lastT + 1) s.reverse();
  }

  const tStart = s[0][tA];
  const tEnd = s[s.length - 1][tA];
  const dur = Math.abs(tEnd - tStart) / ppsAxis;
  const ref = gridBaseline;

  const toMv = (v: number) => {
    let mv = (v - ref) / ppvAxis;
    if (lay.vI) mv = -mv;
    return Math.round(mv * 10000) / 10000;
  };

  // Check if the PDF source has uniform temporal spacing.
  // We sample a few inter-point gaps and check that they're close to the median.
  const gaps: number[] = [];
  for (let i = 1; i < s.length; i++) gaps.push(s[i][tA] - s[i - 1][tA]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  let isUniform = true;
  if (medianGap > 0) {
    for (const g of gaps) {
      if (Math.abs(g - medianGap) / medianGap > UNIFORMITY_THRESHOLD) {
        isUniform = false;
        break;
      }
    }
  } else {
    isUniform = false;
  }

  if (isUniform) {
    // Use original PDF samples directly — no interpolation, preserves all details
    return { samples: s.map(p => toMv(p[vK])), dur };
  }

  // Non-uniform PDF → resample to uniform 500 Hz grid
  const n_target = Math.max(2, Math.round(dur * RESAMPLE_RATE_HZ));
  const tSpan = tEnd - tStart;
  const dt = tSpan / (n_target - 1);
  const samples: number[] = new Array(n_target);

  let lo = 0;
  for (let i = 0; i < n_target; i++) {
    const t = tStart + i * dt;
    while (lo < s.length - 2 && s[lo + 1][tA] < t) lo++;
    const t0 = s[lo][tA], t1 = s[lo + 1][tA];
    const v0 = s[lo][vK], v1 = s[lo + 1][vK];
    const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    samples[i] = toMv(v0 + (v1 - v0) * frac);
  }

  return { samples, dur };
}
