// 02  detect-manufacturer — identifie quel fabricant a produit le PDF.
// Cascade des signaux les moins coûteux aux plus coûteux :
//   1. Metadata (Producer/Creator/Author) — fiable quand présent
//   2. Taille de page (>2000 pt → Mortara/Burdick)
//   3. Empreinte per-segment (>3000 polylignes 2-pts → Vectracor)
//   4. Couleur de grille (rouge pur → Schiller, rose → Schiller CS)
// In  : metadata + viewport + Polyline[]. Out : nom string (sinon "Unknown").

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
