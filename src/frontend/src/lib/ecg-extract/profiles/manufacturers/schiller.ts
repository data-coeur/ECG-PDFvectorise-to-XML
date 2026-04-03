import type { DeepPartial, ManufacturerProfile } from '../index';

export const SCHILLER: DeepPartial<ManufacturerProfile> = {
  layout: {
    expectedLayout: 'stacked_12x1',
  },
  trace: {
    minPoints: 30,
    minSizeRatio: 0.10,
  },
};
