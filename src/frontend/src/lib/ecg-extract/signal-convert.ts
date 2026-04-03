import type { Point, Layout, ScaleInfo } from '../types';

// Convert PDF pixel coordinates to physical units (millivolts, seconds).
export function toPhysical(pts: Point[], sc: ScaleInfo, lay: Layout, gridBaseline: number): { samples: number[]; dur: number } {
  if (pts.length < 2) return { samples: [], dur: 0 };
  const tA = lay.tA, vK = tA === 'x' ? 'y' : 'x';
  const ppsAxis = tA === 'x' ? sc.pmmX * 25 : sc.pmmY * 25;
  const ppvAxis = vK === 'y' ? sc.pmmY * 10 : sc.pmmX * 10;

  const s = [...pts].sort((a, b) => a[tA] - b[tA]);

  if (pts.length > 10) {
    const firstT = pts[0][tA], lastT = pts[pts.length - 1][tA];
    if (firstT > lastT + 1) s.reverse();
  }

  const dur = Math.abs(s[s.length - 1][tA] - s[0][tA]) / ppsAxis;

  const ref = gridBaseline;

  const samples = s.map(p => {
    let mv = (p[vK] - ref) / ppvAxis;
    if (lay.vI) mv = -mv;
    return Math.round(mv * 10000) / 10000;
  });
  return { samples, dur };
}
