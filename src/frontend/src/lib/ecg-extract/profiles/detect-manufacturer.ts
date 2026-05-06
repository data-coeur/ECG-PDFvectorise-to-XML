// 02  detect-manufacturer — figure out which vendor produced the PDF.
//
// The cascade tries the cheapest signals first:
//   1. Document metadata (Producer / Creator / Author) — most reliable when
//      it identifies the vendor by name.
//   2. Page size — Mortara/Burdick prints to oversized sheets (>2000 pt).
//   3. A "per-segment subpath" fingerprint — Vectracor and a few Philips/
//      Cardioline exports draw the signal as thousands of 2-point subpaths;
//      this is so atypical it's a unique signature.
//   4. Grid colour — Schiller variants colour their grid red or pink, and
//      different shades pick out their two stroke patterns.
//
// When nothing matches we fall back to "Unknown" and the default profile.

import type { Polyline } from '../../types';

export function detectManufacturer(
  info: Record<string, string> | null,
  pageSize: { width: number; height: number },
  polylines: Polyline[],
): string {
  // 1. Metadata
  const producer = (info?.Producer || '').toLowerCase();
  const creator = (info?.Creator || '').toLowerCase();
  const author = (info?.Author || '').toLowerCase();
  const meta = producer + ' ' + creator + ' ' + author;
  if (meta.includes('muse')) return 'GE MUSE';
  if (meta.includes('matplotlib')) return 'PTB-XL';

  // 2. Oversized pages → Mortara/Burdick
  const maxDim = Math.max(pageSize.width, pageSize.height);
  if (maxDim > 2000) return 'Mortara/Burdick';

  // 3. Per-segment subpath fingerprint (Vectracor, some Philips/Cardioline)
  // Normal clinical ECGs have at most a few hundred polylines; > 3000 of
  // them with > 80% being 2-point is a very specific signature.
  if (polylines.length > 3000) {
    let twoPt = 0;
    for (const p of polylines) if (p.pts.length === 2) twoPt++;
    if (twoPt / polylines.length > 0.8) return 'Vectracor';
  }

  // 4. Grid colour signatures
  // Standard Schiller: pure red grid (R>0.9, G<0.1, B<0.1)
  const hasRedGrid = polylines.some(p =>
    p.col[0] > 0.9 && p.col[1] < 0.1 && p.col[2] < 0.1 && p.pts.length >= 2
  );
  if (hasRedGrid) return 'Schiller';

  // Schiller CS variant: pink grid (R~0.9, G~0.7, B~0.7) — uses CS/SC color ops
  const hasPinkGrid = polylines.some(p =>
    p.col[0] > 0.8 && p.col[1] > 0.5 && p.col[1] < 0.8 && p.col[2] > 0.5 && p.col[2] < 0.8 && p.pts.length >= 2
  );
  if (hasPinkGrid) return 'Schiller CS';

  return 'Unknown';
}
