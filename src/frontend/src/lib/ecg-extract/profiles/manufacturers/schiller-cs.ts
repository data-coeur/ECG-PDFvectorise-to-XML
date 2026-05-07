// Schiller CS — variante Schiller qui utilise les opérateurs CS/SC (au lieu de
// RG) et a une grille rose (RGB ~0.90, 0.70, 0.70) au lieu de rouge pur.
// Typiquement A4 paysage avec /Rotate=90. Layout pas forcé : la détection auto
// gère les divers formats Schiller que ce profil rencontre.
// Détecté via la signature couleur de la grille rose (cf. detect-manufacturer).

import type { DeepPartial, ManufacturerProfile } from '../types';
export const SCHILLER_CS: DeepPartial<ManufacturerProfile> = {
  trace: {
    minPoints: 20,
    minSizeRatio: 0.08,
  },
  grid: {
    // Pink grid has lower red purity than the standard Schiller red grid.
    // The blackThreshold on traces is inherited from defaults.
  },
};
