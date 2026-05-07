// Schiller — profil pour les ECGs Schiller "standards" à grille rouge pur.
// Force le layout 12×1 et relâche les seuils de detection des traces (Schiller
// dessine moins de points par lead que MUSE, fragments plus courts).
// Détecté via la signature couleur de la grille (R>0.9, G/B<0.1).

import type { DeepPartial, ManufacturerProfile } from '../types';

export const SCHILLER: DeepPartial<ManufacturerProfile> = {
  layout: {
    expectedLayout: 'stacked_12x1',
  },
  trace: {
    minPoints: 30,
    minSizeRatio: 0.10,
  },
};
