import type { DeepPartial, ManufacturerProfile } from '../index';

export const GE_MUSE: DeepPartial<ManufacturerProfile> = {
  layout: {
    expectedLayout: 'sequential_6x2',
  },
  calibration: {
    minPoints: 10,
    maxPoints: 80,
  },
};
