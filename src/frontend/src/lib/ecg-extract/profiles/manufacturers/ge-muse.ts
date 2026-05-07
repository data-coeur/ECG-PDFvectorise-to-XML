// GE MUSE — profil pour les exports PDF du système GE MUSE Cardiology.
// Force le layout 6×2 (toujours le même format chez ce constructeur) et
// élargit la fenêtre de détection de l'impulsion de calibration.
// Détecté via metadata Producer/Creator contenant "muse" (cf. detect-manufacturer).

import type { DeepPartial, ManufacturerProfile } from '../types';

export const GE_MUSE: DeepPartial<ManufacturerProfile> = {
  layout: {
    expectedLayout: 'sequential_6x2',
  },
  calibration: {
    minPoints: 10,
    maxPoints: 80,
  },
};
