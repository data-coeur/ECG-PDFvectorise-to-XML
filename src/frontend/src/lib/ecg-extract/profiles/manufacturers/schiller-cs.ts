import type { DeepPartial, ManufacturerProfile } from '../types';

// Schiller variant that uses CS/SC color operators (instead of RG) and a
// pink grid (RGB ~0.90, 0.70, 0.70) instead of the pure red grid of the
// standard Schiller profile. Typically A4 landscape with /Rotate=90.
// Layout is NOT forced — auto-detection handles the various Schiller formats.
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
