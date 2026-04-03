import type { DeepPartial, ManufacturerProfile } from '../index';

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
