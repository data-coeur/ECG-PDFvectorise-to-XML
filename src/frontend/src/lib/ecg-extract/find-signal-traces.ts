// 06  find-signal-traces — among the (possibly thousands of) polylines
// parsed from the PDF, keep only the ECG signal traces.
//
// Three filters, applied in order:
//   1. Stroke colour is "black" (per the profile's blackThreshold)
//   2. Enough points to be a real signal (profile.trace.minPoints)
//   3. Size at least a fraction of the longest candidate (minSizeRatio)
//      — drops short fragments that survive 1+2 but aren't real leads.
//
// Each surviving trace gets a bounding box attached for downstream stages
// (layout detection, label pairing).

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
