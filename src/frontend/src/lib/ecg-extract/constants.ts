import { pdfjsLib } from '../pdf-config';

export const LEAD_NAMES = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];
export const LEAD_ALIASES: Record<string, string> = {
  'D1': 'I', 'D2': 'II', 'D3': 'III',
  'DI': 'I', 'DII': 'II', 'DIII': 'III',
};
export const OPS = pdfjsLib.OPS;
