// Vectracor / VectraPlex — et autres PDFs "per-segment subpath" (certains
// exports Philips et Cardioline). Branche un postProcessPolylines qui fusionne
// les milliers de subpaths 2-points en polylignes continues, puis remappe la
// couleur dominante en noir. Force aussi rotation=90° (PDFs portrait).
// Détecté via comptage : >3000 polylignes dont >80% à exactement 2 points.

import type { Polyline } from '../../../types';
import type { DeepPartial, ManufacturerProfile } from '../types';

// ── Détails du hook postProcessPolylines ──
// Vectracor dessine chaque échantillon ECG comme un subpath 2-points isolé
// (penDown → lineTo → penUp). Une page 12-leads dépasse facilement 5000 subpaths,
// que `findSignalTraces` rejette tous (minPoints > 50 jamais atteint).
// Fix en deux temps :
//  1. Welder consécutivement les segments 2-points dont les extrémités matchent
//     (même couleur, même épaisseur, next.start ≈ prev.end) → une longue polyligne
//     par stroke continu.
//  2. Vectracor dessine en rouge, pas en noir : on identifie le groupe (couleur,
//     épaisseur) majoritaire parmi les polylignes longues post-weld et on le remappe
//     en noir pur, ce qui le rend visible au filtre standard de findSignalTraces.

/** Max gap (in PDF points) between one segment's end and the next segment's
 *  start for them to be considered part of the same continuous stroke. */
const WELD_TOLERANCE = 0.5;

/** A welded polyline has to have at least this many points to be considered
 *  a real trace candidate (as opposed to an axis line, a decorative marker…). */
const LONG_POLYLINE_MIN = 50;

/** Minimum number of same-colour long polylines to trust the "dominant colour
 *  = signal" heuristic. Vectracor has pages with 12 leads, 6 leads, or even
 *  partial/single-lead fragments. We accept down to 1 because Vectracor is
 *  the only manufacturer that reaches this hook — the detection cascade
 *  already requires > 3000 two-point polylines to even pick this profile,
 *  so by the time we're here there's no ambiguity about what these long
 *  welded polylines represent. */
const MIN_SIGNAL_GROUP = 1;

/**
 * Fuse consecutive 2-point subpaths that chain end-to-start into longer
 * polylines, then remap the dominant long-polyline colour to pure black so
 * downstream stages can pick them up with the generic filter.
 */
export function weldPerSegmentSubpaths(P: Polyline[]): Polyline[] {
  if (P.length === 0) return [];
  const out: Polyline[] = [];
  let i = 0;
  while (i < P.length) {
    const first = P[i];
    // Leave longer polylines alone — they're either grid structures or
    // already-welded traces from another pass.
    if (first.pts.length !== 2) {
      out.push(first);
      i++;
      continue;
    }
    const pts = [...first.pts];
    const col = first.col;
    const w = first.w;
    let j = i + 1;
    while (j < P.length) {
      const next = P[j];
      if (next.pts.length !== 2) break;
      if (next.w !== w) break;
      if (next.col[0] !== col[0] || next.col[1] !== col[1] || next.col[2] !== col[2]) break;
      const last = pts[pts.length - 1];
      const start = next.pts[0];
      const dx = start.x - last.x;
      const dy = start.y - last.y;
      if (dx * dx + dy * dy > WELD_TOLERANCE * WELD_TOLERANCE) break;
      // Drop the duplicate point at the join — we only need the new endpoint.
      pts.push(next.pts[1]);
      j++;
    }
    out.push({ pts, col: [...col], w });
    i = j;
  }

  // Find the (color, width) group that contributes the most long polylines
  // after welding. On a valid Vectracor ECG, this is the 12 signal traces.
  const groupCounts = new Map<string, number>();
  for (const p of out) {
    if (p.pts.length < LONG_POLYLINE_MIN) continue;
    const key = `${p.col[0]},${p.col[1]},${p.col[2]},${p.w}`;
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [k, v] of groupCounts) {
    if (v > bestCount) { bestCount = v; bestKey = k; }
  }
  if (bestKey !== null && bestCount >= MIN_SIGNAL_GROUP) {
    const [r, g, b, w] = bestKey.split(',').map(Number);
    console.log(`[Vectracor] signal group = rgb(${r},${g},${b}) w=${w} → ${bestCount} polylines, remapping to black`);
    for (const p of out) {
      if (p.col[0] === r && p.col[1] === g && p.col[2] === b && p.w === w) {
        p.col = [0, 0, 0];
      }
    }
  }

  return out;
}

export const VECTRACOR: DeepPartial<ManufacturerProfile> = {
  postProcessPolylines: weldPerSegmentSubpaths,
  // Vectracor draws portrait with time running top-to-bottom. The generic
  // orientation detector can't score reliably on pages that have only 1-2
  // leads (single-lead fragments, rhythm strips), so we hardcode the
  // rotation that multi-lead pages would have picked anyway.
  forceRotation: 90,
  trace: {
    // Vectracor pages often mix a 10 s rhythm strip (~5000 pts) with shorter
    // 2-3 s lead fragments (~300-400 pts). The default `minSizeRatio: 0.15`
    // would reject anything under 750 pts vs the 5000 pt max, dropping all
    // the fragments. Use a much smaller ratio to keep them.
    minSizeRatio: 0.05,
  },
};
