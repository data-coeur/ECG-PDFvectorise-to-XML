// PTB-XL — profil pour les PDFs générés par matplotlib à partir du dataset
// PTB-XL (PhysioNet, 21 837 ECG cliniques publics). Aucun override : ces PDFs
// arrivent sous différents layouts (3×4, 6×2, 12×1) et c'est l'auto-détection
// qui décide. Détecté via metadata Producer/Creator contenant "matplotlib".

import type { DeepPartial, ManufacturerProfile } from '../types';

export const PTBXL: DeepPartial<ManufacturerProfile> = {};
