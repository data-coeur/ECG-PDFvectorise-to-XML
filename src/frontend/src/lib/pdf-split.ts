// pdf-split — explose un PDF multi-pages en un File indépendant par page,
// chaque page taguée isEcg=true/false selon sa densité d'ops vectorielles.
// In  : un File (le PDF déposé). Out : SplitPage[] dans l'ordre source.
// Appelé par App.tsx::handleFiles avant la construction de la queue.
// Raison : faire couler les multi-pages dans la pipeline mono-fichier existante
// et permettre d'afficher les pages non-ECG comme erreurs explicites.

import { PDFDocument } from 'pdf-lib';
import { pdfjsLib } from './pdf-config';
import { countVectorOps, MIN_VECTOR_OPS_ECG } from './file-detect';

export interface SplitPage {
  file: File;
  /** False when the source page has fewer than MIN_VECTOR_OPS_ECG vector ops:
   *  the caller should surface a "no ECG" error instead of running the full
   *  extraction pipeline on it. */
  isEcg: boolean;
}

export interface SplitResult {
  /** All pages in source order, ECG or not. */
  pages: SplitPage[];
  totalPages: number;
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
    return { pages: [{ file, isEcg: true }], totalPages: 1 };
  }

  const ecgFlags: boolean[] = [];
  let ecgCount = 0;
  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const ops = await page.getOperatorList();
    const count = countVectorOps(ops);
    const isEcg = count >= MIN_VECTOR_OPS_ECG;
    ecgFlags.push(isEcg);
    if (isEcg) ecgCount++;
  }
  console.log(`[pdf-split] ${file.name}: ${totalPages} pages → ${ecgCount} ECG, ${totalPages - ecgCount} skipped`);

  // Pass 2: pdf-lib copies every page into its own document, including the
  // non-ECG ones. Read a fresh ArrayBuffer — `bufForPdfjs` may have been
  // transferred away by pdfjs.
  const bufForPdfLib = await file.arrayBuffer();
  const src = await PDFDocument.load(bufForPdfLib);
  const base = file.name.replace(/\.pdf$/i, '');
  const pages: SplitPage[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [p - 1]);
    out.addPage(copied);
    const bytes = await out.save();
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const pageFile = new File([blob], `${base}_p${p}.pdf`, { type: 'application/pdf' });
    pages.push({ file: pageFile, isEcg: ecgFlags[p - 1] });
  }

  return { pages, totalPages };
}
