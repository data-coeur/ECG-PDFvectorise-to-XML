// profiles — barrel re-export du système de profils fabricants. Les
// consommateurs externes font `import { detectManufacturer, resolveProfile }
// from './profiles'` ou `import type { ManufacturerProfile } from './profiles'`.
// Voir profiles/types.ts (shape), profiles/detect-manufacturer.ts (cascade),
// profiles/registry.ts (resolver), profiles/manufacturers/*.ts (un par vendor).

export type { ManufacturerProfile, DeepPartial } from './types';
export { DEFAULT_PROFILE } from './types';
export { detectManufacturer } from './detect-manufacturer';
export { resolveProfile } from './registry';
