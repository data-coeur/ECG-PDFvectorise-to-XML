// 08  compute-scale — convertit l'espacement grille (pts/mm) en facteurs
// physiques utilisés ensuite : pmm (pts/mm moyen), pps (pts/s à 25 mm/s),
// ppv (pts/mV à 10 mm/mV), plus pmmX/pmmY pour les scans étirés où X≠Y.
// In  : GridInfo (sortie de extract-grid). Out : ScaleInfo.
// Raison : isoler les hypothèses ECG standards (25 mm/s, 10 mm/mV) en un point.

import type { GridInfo, ScaleInfo } from '../types';

export function computeScaleFromGrid(grid: GridInfo): ScaleInfo {
  const pmmX = grid.spacingX;
  const pmmY = grid.spacingY;
  const pmm = (pmmX + pmmY) / 2;
  return { pmm, pps: pmm * 25, ppv: pmm * 10, pmmX, pmmY };
}
