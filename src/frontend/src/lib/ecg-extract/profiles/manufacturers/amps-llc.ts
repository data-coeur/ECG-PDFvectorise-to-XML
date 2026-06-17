// AMPS-LLC — PDFs produits par le convertisseur ECG d'AMPS-LLC (libharu /
// "Haru Free PDF Library"). Comme Vectracor, la GRILLE est dessinée en
// milliers de micro-segments 2-points ; mais le SIGNAL, lui, est déjà tracé
// en polylignes continues (une par lead) et la page est en paysage, temps sur
// l'axe X. On réutilise donc le welder de Vectracor (pour reconstituer la
// grille en lignes exploitables) MAIS sans forcer de rotation : l'orientation
// est correcte telle quelle, et le détecteur de contenu la confirme.
// Détecté par : fingerprint per-segment (>3000 polylignes, >80% à 2 points)
// + présence de longues traces sombres déjà continues (le signal).

import type { DeepPartial, ManufacturerProfile } from '../types';
import { weldPerSegmentSubpaths } from './vectracor';

export const AMPS_LLC: DeepPartial<ManufacturerProfile> = {
  // Fusionne les micro-segments de grille en lignes continues (le signal,
  // déjà continu, est laissé intact par le welder qui n'agit que sur les
  // subpaths à exactement 2 points).
  postProcessPolylines: weldPerSegmentSubpaths,
  // Pas de forceRotation : contrairement à Vectracor (portrait), les pages
  // AMPS sont en paysage avec le temps sur X. rectifyOrientation tranche
  // correctement (les 12 leads continus suffisent au scorer).
  trace: {
    // Mêmes proportions mixtes que Vectracor (rythme long + fragments courts).
    minSizeRatio: 0.05,
  },
};
