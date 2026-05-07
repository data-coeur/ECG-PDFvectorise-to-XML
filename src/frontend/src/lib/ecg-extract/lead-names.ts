// lead-names — noms canoniques des 12 leads ECG + alias allemands (D1/D2/D3)
// et latins (DI/DII/DIII). Utilisé par index.ts (étape extract-text-labels)
// pour filtrer les textes de pdfjs et normaliser au format canonique avant
// l'appariement avec les traces.
// Importé par : index.ts et pair-traces-with-labels.ts.

export const LEAD_NAMES = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];

export const LEAD_ALIASES: Record<string, string> = {
  'D1': 'I', 'D2': 'II', 'D3': 'III',
  'DI': 'I', 'DII': 'II', 'DIII': 'III',
};
