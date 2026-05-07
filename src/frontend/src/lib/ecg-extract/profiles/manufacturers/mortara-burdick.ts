// Mortara/Burdick — profil pour les ECGs Mortara, Burdick et compatibles.
// Force le layout grid_4x3 (12 leads en 4 colonnes × 3 rangées + rhythm strip),
// relâche la détection de grille (lignes moins droites) et baisse le seuil de
// détection du rhythm strip. Détecté via la grande taille de page (>2000 pt).

import type { DeepPartial, ManufacturerProfile } from '../types';

export const MORTARA_BURDICK: DeepPartial<ManufacturerProfile> = {
  layout: {
    expectedLayout: 'grid_4x3',
  },
  grid: {
    lineStraightness: 2.0,
    dedupDistance: 1.2,
  },
  leads: {
    rhythmStripWidthRatio: 1.6,
  },
};
