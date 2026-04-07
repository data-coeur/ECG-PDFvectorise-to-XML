import type { DeepPartial, ManufacturerProfile } from '../index';

// Empty overrides — let auto-detection figure out layout/grid/etc.
// PTB-XL PDFs come in different shapes (3x4, 6x2...) so we don't force one.
export const PTBXL: DeepPartial<ManufacturerProfile> = {};
