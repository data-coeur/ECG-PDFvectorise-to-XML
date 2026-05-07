// 06  find-signal-traces — parmi les (parfois des milliers de) polylignes
// parsées, ne garder que les traces du signal ECG via 3 filtres : couleur
// "noire" (selon profile.trace.blackThreshold), assez de points (minPoints),
// taille suffisante vs la plus longue (minSizeRatio).
// In  : Polyline[] + ManufacturerProfile. Out : Polyline[] avec bbox renseignée.

import type { Polyline } from '../types';
import type { ManufacturerProfile } from './profiles';
import { isBlackPolyline, computeBoundingBox } from './polyline-utils';

export function findSignalTraces(P: Polyline[], profile: ManufacturerProfile): Polyline[] {
  const { blackThreshold, minPoints, minSizeRatio, maxTraces } = profile.trace;
  let candidates = P.filter(p => isBlackPolyline(p, blackThreshold) && p.pts.length > minPoints);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.pts.length - a.pts.length);
  const longest = candidates[0].pts.length;
  candidates = candidates.filter(p => p.pts.length >= longest * minSizeRatio);
  for (const t of candidates) t.bb = computeBoundingBox(t.pts);
  return candidates.slice(0, maxTraces);
}
