// Manufacturer profile system — barrel re-export.
//
//   types.ts                ManufacturerProfile, DeepPartial, DEFAULT_PROFILE
//   detect-manufacturer.ts  detectManufacturer(info, pageSize, polylines)
//   registry.ts             resolveProfile(name) — applies vendor overrides
//   manufacturers/*.ts      one DeepPartial<ManufacturerProfile> per vendor

export type { ManufacturerProfile, DeepPartial } from './types';
export { DEFAULT_PROFILE } from './types';
export { detectManufacturer } from './detect-manufacturer';
export { resolveProfile } from './registry';
