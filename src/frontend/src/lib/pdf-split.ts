// Expand multi-page vectorized PDFs into one independent File per ECG page.
//
// Each page is inspected with pdfjs to decide whether it actually contains an
// ECG (vector op density above MIN_VECTOR_OPS_ECG). Pages that pass are copied
// into their own single-page PDFDocument via pdf-lib and wrapped as a new File
// named `<base>_p<N>.pdf`. Non-ECG pages (cover page, summary, etc.) are
// dropped and reported via `skippedPages`.
//
// Single-page files are returned unchanged so this helper can run
// unconditionally on every dropped PDF.

import { PDFDocument } from 'pdf-lib';
import { pdfjsLib } from './pdf-config';
import { countVectorOps, MIN_VECTOR_OPS_ECG } from './file-detect';

export interface SplitResult {
  /** One File per page that passed the ECG threshold, in source page order. */
  files: File[];
  totalPages: number;
  /** 1-indexed pages that were dropped (too few vector ops to be an ECG). */
  skippedPages: number[];
}

export async function expandMultiPagePdf(file: File): Promise<SplitResult> {
  // pdfjs "transfers" the buffer it receives (its underlying ArrayBuffer may
  // be neutered after parsing), so we read the File twice rather than sharing
  // one ArrayBuffer between pdfjs and pdf-lib.
  const bufForPdfjs = await file.arrayBuffer();

  // Pass 1: ask pdfjs which pages look like ECGs
  const pdf = await pdfjsLib.getDocument({ data: bufForPdfjs, isEvalSupported: false }).promise;
  const totalPages = pdf.numPages;

  // Mono-page: pass through unchanged so nothing downstream needs to care
  if (totalPages === 1) {
    return { files: [file], totalPages: 1, skippedPages: [] };
  }

  const ecgPages: number[] = [];
  const skippedPages: number[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const ops = await page.getOperatorList();
    const count = countVectorOps(ops);
    (count >= MIN_VECTOR_OPS_ECG ? ecgPages : skippedPages).push(p);
  }
  console.log(`[pdf-split] ${file.name}: ${totalPages} pages → ${ecgPages.length} ECG, ${skippedPages.length} skipped`);

  if (ecgPages.length === 0) {
    return { files: [], totalPages, skippedPages };
  }

  // Pass 2: pdf-lib copies each ECG page into its own document. Read a fresh
  // ArrayBuffer — `bufForPdfjs` may have been transferred away by pdfjs.
  const bufForPdfLib = await file.arrayBuffer();
  const src = await PDFDocument.load(bufForPdfLib);
  const base = file.name.replace(/\.pdf$/i, '');
  const files: File[] = [];
  for (const p of ecgPages) {
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [p - 1]);
    out.addPage(copied);
    const bytes = await out.save();
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    files.push(new File([blob], `${base}_p${p}.pdf`, { type: 'application/pdf' }));
  }

  return { files, totalPages, skippedPages };
}
