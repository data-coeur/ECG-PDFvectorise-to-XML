// file-detect — classifie un fichier déposé en pdf-vector / pdf-raster /
// image / xml-ecg / dicom / unknown via magic bytes + DOMParser pour XML +
// inspection pdfjs pour PDF (compte les ops vectorielles).
// In  : un File. Out : { kind: DetectedKind, detail?: string }.
// Appelé par App.tsx::processQueue avant l'extraction pour router vers le
// bon flow ou afficher UnsupportedFileModal.

import { pdfjsLib } from './pdf-config';

export type DetectedKind =
  | 'pdf-vector'
  | 'pdf-raster'
  | 'pdf-multi'
  | 'image'
  | 'xml-ecg'
  | 'xml-other'
  | 'dicom'
  | 'unknown';

export interface Detected {
  kind: DetectedKind;
  /** Human-readable detail (image format, XML root element name…) */
  detail?: string;
}

const HEAD_SIZE = 4096;
const XML_HEAD_SIZE = 16384;

function bytesEqual(head: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (head[offset + i] !== sig[i]) return false;
  }
  return true;
}

// Magic byte signatures
const SIG = {
  PDF: [0x25, 0x50, 0x44, 0x46], // %PDF
  PNG: [0x89, 0x50, 0x4E, 0x47],
  JPEG: [0xFF, 0xD8, 0xFF],
  GIF: [0x47, 0x49, 0x46, 0x38],
  BMP: [0x42, 0x4D],
  TIFF_LE: [0x49, 0x49, 0x2A, 0x00],
  TIFF_BE: [0x4D, 0x4D, 0x00, 0x2A],
  RIFF: [0x52, 0x49, 0x46, 0x46],
  WEBP: [0x57, 0x45, 0x42, 0x50],
  DICM: [0x44, 0x49, 0x43, 0x4D], // DICM at offset 128
} as const;

// Root XML elements that map to known ECG formats
const ECG_XML_ROOTS = new Set([
  'restingecg',     // GE MUSE
  'annotatedecg',   // HL7 aECG
  'restingecgdata', // Philips
  'cardiologyxml',  // generic Cardiology XML
  'aecg',           // various v3 messages
  'sapphire',       // Mortara/Burdick
]);

// Tags whose mere presence strongly suggests ECG content even if the root
// element is unknown (vendor-specific wrappers, COR documents, etc.)
const ECG_HINT_TAGS = ['Waveform', 'WaveformData', 'ECGSignals', 'RhythmStrip', 'LeadData'];

function decodeText(head: Uint8Array, maxBytes: number): string {
  // strip UTF-8 BOM if present
  let start = 0;
  if (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF) start = 3;
  return new TextDecoder('utf-8', { fatal: false }).decode(head.slice(start, maxBytes));
}

function looksLikeXml(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && !trimmed.startsWith('<!DOCTYPE html'));
}

// Count vector path operations on a single pdfjs page. pdfjs batches path ops
// into constructPath operators — each one contains an array of sub-operations
// (moveTo, lineTo…). We count the sub-operations inside, not just the top-level op.
// Exported so the multi-page splitter ([pdf-split.ts]) can reuse the same
// threshold to decide which pages actually contain an ECG.
export function countVectorOps(ops: { fnArray: number[]; argsArray: unknown[][] }): number {
  const OPS = pdfjsLib.OPS;
  let n = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i];
    if (op === OPS.moveTo || op === OPS.lineTo) {
      n++;
    } else if (op === OPS.constructPath) {
      const subOps = (ops.argsArray[i] as [number[], number[]])[0];
      n += subOps.length;
    }
  }
  return n;
}

/** A page with fewer vector operations than this is considered a raster / cover page. */
export const MIN_VECTOR_OPS_ECG = 50;

// Distinguish a vectorial PDF (real ECG with vector paths) from a raster PDF
// (scanned page wrapped in a single image XObject). pdfjs is already loaded
// statically by the extractor, so this is essentially free.
//
// For multi-page PDFs the splitter ([pdf-split.ts]) takes over: it expands one
// source file into N per-page PDFs before they ever reach the queue, so here
// we only need to decide vector vs raster on the first page.
async function inspectPdf(file: File): Promise<Detected> {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);
    const ops = await page.getOperatorList();
    const vectorCount = countVectorOps(ops);
    console.warn(`[ECG detect] Page 1: ${ops.fnArray.length} ops, ${vectorCount} vector sub-ops, pages=${pdf.numPages}`);
    if (vectorCount < MIN_VECTOR_OPS_ECG) return { kind: 'pdf-raster' };
    return { kind: 'pdf-vector' };
  } catch (err) {
    console.warn('[ECG detect] inspectPdf crashed:', err);
    return { kind: 'pdf-raster' };
  }
}

async function classifyXml(file: File): Promise<Detected> {
  const buf = await file.slice(0, XML_HEAD_SIZE).arrayBuffer();
  const text = decodeText(new Uint8Array(buf), XML_HEAD_SIZE);

  // The head may be truncated mid-element. DOMParser tolerates this — root info
  // is in the first few hundred bytes, so it almost always parses cleanly enough
  // to expose the root element. parsererror only fires on grossly invalid XML.
  let root: Element | null = null;
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length === 0) {
      root = doc.documentElement;
    }
  } catch {
    /* fall through */
  }

  // If DOMParser couldn't give us a root, try to fish the first opening tag
  // out of the raw text — handles truncated heads where the closing tag is missing.
  if (!root) {
    const m = text.match(/<\s*([A-Za-z_][\w.-]*)/);
    if (m) {
      const name = m[1];
      if (ECG_XML_ROOTS.has(name.toLowerCase())) return { kind: 'xml-ecg', detail: name };
      return { kind: 'xml-other', detail: name };
    }
    return { kind: 'xml-other' };
  }

  const rootName = root.localName;
  if (ECG_XML_ROOTS.has(rootName.toLowerCase())) {
    return { kind: 'xml-ecg', detail: rootName };
  }
  for (const tag of ECG_HINT_TAGS) {
    if (root.getElementsByTagName(tag).length > 0) {
      return { kind: 'xml-ecg', detail: rootName };
    }
  }
  return { kind: 'xml-other', detail: rootName };
}

export async function detectFileType(file: File): Promise<Detected> {
  const head = new Uint8Array(await file.slice(0, HEAD_SIZE).arrayBuffer());

  // ── Binary magic bytes ────────────────────────────────────────────────────
  if (bytesEqual(head, SIG.PDF)) {
    return inspectPdf(file);
  }
  if (bytesEqual(head, SIG.PNG)) return { kind: 'image', detail: 'PNG' };
  if (bytesEqual(head, SIG.JPEG)) return { kind: 'image', detail: 'JPEG' };
  if (bytesEqual(head, SIG.GIF)) return { kind: 'image', detail: 'GIF' };
  if (bytesEqual(head, SIG.BMP)) return { kind: 'image', detail: 'BMP' };
  if (bytesEqual(head, SIG.TIFF_LE) || bytesEqual(head, SIG.TIFF_BE)) {
    return { kind: 'image', detail: 'TIFF' };
  }
  if (bytesEqual(head, SIG.RIFF) && bytesEqual(head, SIG.WEBP, 8)) {
    return { kind: 'image', detail: 'WebP' };
  }
  if (bytesEqual(head, SIG.DICM, 128)) {
    return { kind: 'dicom' };
  }

  // ── Text-based: XML ───────────────────────────────────────────────────────
  const headText = decodeText(head, 1024);
  if (looksLikeXml(headText)) {
    return classifyXml(file);
  }

  return { kind: 'unknown' };
}
