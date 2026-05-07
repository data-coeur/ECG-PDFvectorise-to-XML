// profiles/registry — table { nom → DeepPartial } des 6 fabricants supportés
// + resolveProfile(name) qui applique deepMerge(DEFAULT_PROFILE, override).
// In  : nom de fabricant (string). Out : ManufacturerProfile complet.
// Appelé par index.ts juste après detect-manufacturer.
// Raison : centraliser la résolution defaults+override dans un seul endroit.

import { GE_MUSE } from './manufacturers/ge-muse';
import { SCHILLER } from './manufacturers/schiller';
import { SCHILLER_CS } from './manufacturers/schiller-cs';
import { MORTARA_BURDICK } from './manufacturers/mortara-burdick';
import { PTBXL } from './manufacturers/ptbxl';
import { VECTRACOR } from './manufacturers/vectracor';
import { DEFAULT_PROFILE } from './types';
import type { DeepPartial, ManufacturerProfile } from './types';

const REGISTRY: Record<string, DeepPartial<ManufacturerProfile>> = {
  'GE MUSE': GE_MUSE,
  'Schiller': SCHILLER,
  'Schiller CS': SCHILLER_CS,
  'Mortara/Burdick': MORTARA_BURDICK,
  'PTB-XL': PTBXL,
  'Vectracor': VECTRACOR,
};

// Resolve a manufacturer name into a complete profile (defaults + overrides).
// Unknown names fall back to the bare default with the unknown name attached.
export function resolveProfile(manufacturer: string): ManufacturerProfile {
  const overrides = REGISTRY[manufacturer];
  const profile: ManufacturerProfile = overrides
    ? deepMerge(DEFAULT_PROFILE, { ...overrides, name: manufacturer })
    : { ...DEFAULT_PROFILE, name: manufacturer };
  console.log(`[ECG] Using profile: ${profile.name}`);
  return profile;
}

// Recursively merge `overrides` into `base`. Function-typed values and
// arrays are treated as leaves (overrides wholesale rather than walked).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, overrides: any): any {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val !== undefined && typeof val === 'object' && !Array.isArray(val) && val !== null) {
      result[key] = deepMerge(base[key] ?? {}, val);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}
