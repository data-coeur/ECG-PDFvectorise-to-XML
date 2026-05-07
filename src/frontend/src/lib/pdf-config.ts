// pdf-config — configure pdfjs (worker source) une fois pour toute l'app et
// ré-exporte pdfjsLib + les codes d'opérateurs OPS (moveTo, lineTo, etc.).
// Importé par : parse-paths, file-detect, pdf-split — toute interaction pdfjs
// passe par ce module pour garantir que le worker est configuré.
// Raison : éviter d'avoir à initialiser pdfjs ailleurs et oublier le worker.

import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export const OPS = pdfjsLib.OPS;
export { pdfjsLib };
