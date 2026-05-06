import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// pdfjs operator codes (OPS.moveTo, OPS.lineTo, OPS.constructPath...) used by
// the path-parsing stage. Re-exported here so consumers don't have to dig
// into pdfjs internals every time.
export const OPS = pdfjsLib.OPS;

export { pdfjsLib };
