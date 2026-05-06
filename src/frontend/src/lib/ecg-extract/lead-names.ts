// Standard 12-lead ECG names plus common aliases (German "D1/D2/D3", Latin
// "DI/DII/DIII"). Used to filter pdfjs text items down to lead labels and to
// rename them into the canonical form before pairing them with traces.

export const LEAD_NAMES = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];

export const LEAD_ALIASES: Record<string, string> = {
  'D1': 'I', 'D2': 'II', 'D3': 'III',
  'DI': 'I', 'DII': 'II', 'DIII': 'III',
};
