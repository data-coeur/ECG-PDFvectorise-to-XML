// 08  compute-scale — translate grid spacing (PDF points per millimetre)
// into the physical scale factors the rest of the pipeline needs:
//   - pmm   : average pts/mm
//   - pps   : pts per second  (paper at 25 mm/s)
//   - ppv   : pts per mV      (gain at 10 mm/mV)
//   - pmmX, pmmY : per-axis pts/mm (used when X and Y don't match exactly,
//                  e.g. on stretched scans)

import type { GridInfo, ScaleInfo } from '../types';

export function computeScaleFromGrid(grid: GridInfo): ScaleInfo {
  const pmmX = grid.spacingX;
  const pmmY = grid.spacingY;
  const pmm = (pmmX + pmmY) / 2;
  return { pmm, pps: pmm * 25, ppv: pmm * 10, pmmX, pmmY };
}
