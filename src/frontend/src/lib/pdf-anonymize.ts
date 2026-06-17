// pdf-anonymize — anonymise un PDF ECG côté client (jamais envoyé tel quel).
// Deux modes : "full" supprime tout le texte sauf les labels de lead, "smart"
// garde les mesures et diagnostics et ne supprime que les données patient.
// In  : ArrayBuffer du PDF + AnonMode. Out : Uint8Array du PDF anonymisé.
// Appelé par : ReportModal (avant POST /api/ecg/report) et FormatCards (téléchargement
// "PDF anonymisé"). Raison : ne jamais transmettre de PHI hors du navigateur.

import {
  PDFDocument, PDFName, PDFNumber, PDFDict, PDFArray, PDFRawStream, PDFRef,
  StandardFonts, rgb, degrees,
} from 'pdf-lib';
import pako from 'pako';

export type AnonMode = 'full' | 'smart';

/* ------------------------------------------------------------------ */
/*  Low-level helpers                                                  */
/* ------------------------------------------------------------------ */

function isWS(c: string) { return c === ' ' || c === '\n' || c === '\r' || c === '\t'; }

function bytesToStr(raw: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < raw.length; i += 8192)
    chunks.push(String.fromCharCode(...raw.subarray(i, i + 8192)));
  return chunks.join('');
}

function strToBytes(text: string): Uint8Array {
  const buf = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) buf[i] = text.charCodeAt(i);
  return buf;
}

/* ------------------------------------------------------------------ */
/*  Stream filter helpers — robust to the /Filter array form           */
/* ------------------------------------------------------------------ */

/**
 * Whether a stream is FlateDecode-compressed. Accepts both the bare name
 * `/FlateDecode` and the single-filter array form `[ /FlateDecode ]` —
 * the latter is emitted by libharu (AMPS-LLC converter) and was previously
 * missed by a strict `=== '/FlateDecode'` check, leaving content streams
 * un-inflated (so text was neither detected nor stripped). Chained filters
 * (e.g. image codecs) are rejected: pako alone can't round-trip them.
 */
function streamIsFlate(stream: PDFRawStream): boolean {
  const f = stream.dict.get(PDFName.of('Filter'));
  if (!f) return false;
  const s = f.toString();
  return /FlateDecode/.test(s) &&
    !/(DCTDecode|LZWDecode|RunLengthDecode|ASCII85Decode|ASCIIHexDecode|JBIG2Decode|JPXDecode)/.test(s);
}

/** Decode a raw stream to a latin1 string, transparently inflating Flate. */
function decodeStream(stream: PDFRawStream): { text: string; isFlate: boolean } | null {
  const isFlate = streamIsFlate(stream);
  try {
    const data = isFlate ? pako.inflate(stream.contents) : stream.contents;
    return { text: bytesToStr(data), isFlate };
  } catch { return null; }
}

/** Write a (possibly Flate-recompressed) string back into a raw stream. */
function writeStream(stream: PDFRawStream, text: string, isFlate: boolean): void {
  const bytes = strToBytes(text);
  const output = isFlate ? pako.deflate(bytes) : bytes;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stream as any).contents = output;
}

/* ------------------------------------------------------------------ */
/*  BT / ET detection                                                  */
/* ------------------------------------------------------------------ */

function isBT(s: string, i: number, len: number): boolean {
  if (s[i] !== 'B' || s[i + 1] !== 'T') return false;
  if (i > 0 && !isWS(s[i - 1])) return false;
  if (i + 2 < len && !isWS(s[i + 2])) return false;
  return true;
}

function findET(s: string, start: number, len: number): number {
  let i = start;
  while (i < len) {
    if (s[i] === '(') {
      let d = 1; i++;
      while (i < len && d > 0) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '(') d++;
        if (s[i] === ')') d--;
        i++;
      }
      continue;
    }
    if (s[i] === 'E' && s[i + 1] === 'T') {
      const b = i > 0 ? s[i - 1] : ' ';
      const a = i + 2 < len ? s[i + 2] : ' ';
      if (isWS(b) && (i + 2 >= len || isWS(a))) {
        i += 2;
        while (i < len && isWS(s[i])) i++;
        return i;
      }
    }
    i++;
  }
  return len;
}

/* ------------------------------------------------------------------ */
/*  Find all BT…ET blocks in a stream                                  */
/* ------------------------------------------------------------------ */

interface BTBlock { start: number; end: number; body: string }

function findBTBlocks(stream: string): BTBlock[] {
  const blocks: BTBlock[] = [];
  let i = 0;
  const len = stream.length;
  while (i < len) {
    if (stream[i] === '(') {
      let d = 1; i++;
      while (i < len && d > 0) {
        if (stream[i] === '\\') { i += 2; continue; }
        if (stream[i] === '(') d++;
        if (stream[i] === ')') d--;
        i++;
      }
      continue;
    }
    if (isBT(stream, i, len)) {
      const start = i;
      const end = findET(stream, i + 2, len);
      const body = stream.slice(i + 3, end);
      blocks.push({ start, end, body });
      i = end;
      continue;
    }
    i++;
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/*  Extract text content from a BT…ET block (raw stream bytes)         */
/* ------------------------------------------------------------------ */

/** Decode PDF string escape sequences: \nnn (octal), \n, \r, \t, \\, \(, \) */
function decodePdfString(raw: string): string {
  return raw.replace(/\\([0-7]{1,3}|[nrtbf\\()\/])/g, (_, esc: string) => {
    if (esc === 'n') return '\n';
    if (esc === 'r') return '\r';
    if (esc === 't') return '\t';
    if (esc === 'b') return '\b';
    if (esc === 'f') return '\f';
    if (esc === '\\' || esc === '(' || esc === ')' || esc === '/') return esc;
    // Octal
    return String.fromCharCode(parseInt(esc, 8));
  });
}

function extractTjText(body: string): string {
  const parts: string[] = [];
  // Match (string) Tj — handles escaped parens like \( and \)
  const tjRe = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  let m;
  while ((m = tjRe.exec(body)) !== null) parts.push(decodePdfString(m[1]));
  // Match <hex> Tj — decode hex pairs to chars
  const hexRe = /<([0-9a-fA-F]+)>\s*Tj/g;
  while ((m = hexRe.exec(body)) !== null) {
    const hex = m[1];
    let decoded = '';
    for (let i = 0; i < hex.length; i += 2) {
      decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    parts.push(decoded);
  }
  // Match [...] TJ (array form)
  const tjArrRe = /\[([^\]]*)\]\s*TJ/gi;
  while ((m = tjArrRe.exec(body)) !== null) {
    const inner = m[1];
    const strRe = /\(((?:[^()\\]|\\.)*)\)/g;
    let sm;
    while ((sm = strRe.exec(inner)) !== null) parts.push(decodePdfString(sm[1]));
    const hRe = /<([0-9a-fA-F]+)>/g;
    while ((sm = hRe.exec(inner)) !== null) {
      const hex = sm[1];
      let decoded = '';
      for (let i = 0; i < hex.length; i += 2)
        decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      parts.push(decoded);
    }
  }
  return parts.join(' ').trim();
}

/* ------------------------------------------------------------------ */
/*  Lead label patterns — kept in both modes                           */
/* ------------------------------------------------------------------ */

const LEAD_LABELS = new Set([
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF',
  'AVR', 'AVL', 'AVF', 'avr', 'avl', 'avf',
  'D1', 'D2', 'D3', 'DI', 'DII', 'DIII',
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6',
]);

function isLeadLabel(text: string): boolean {
  return LEAD_LABELS.has(text.trim());
}

/* ------------------------------------------------------------------ */
/*  ECG info patterns (for smart mode — always kept)                   */
/* ------------------------------------------------------------------ */

const ECG_INFO_PATTERNS: RegExp[] = [
  // Lead labels (also caught by isLeadLabel, but kept here for completeness)
  /^(I{1,3}|aV[RLF]|AVR|AVL|AVF|D[123I]{1,3}|V[1-6])$/,
  // Units — no \b required (handles "25mm/s", "10mm/mV", "40Hz")
  /(mm\/s|mm\/mV)/i,
  /Hz/i,
  /bpm/i,
  /\bms\b/i,
  // Measurement labels (case-insensitive for "Axes P-R-T")
  /\b(FC|HR|PR|QRS|QRSD|QT|QTc[BF]?|RR|Axes?)\b/i,
  // Measurement sub-labels
  /(Fr[ée]q|Intervalle|Dur[ée]e|Vent)/i,
  // Gain/speed/filter labels (no trailing \b — handles "Périphérique" etc.)
  /(Vit\b|Speed|Gain|P[ée]r[ií]ph|Pr[ée]c|Filter|Filtre)/i,
  // Calibration
  /(calibr|1\s*mV)/i,
  // Diagnosis text — no trailing \b (handles "Bradycardie", "Rythme", etc.)
  /(sinusal|sinus|tachycard|bradycard|fibrillat|flutter|block|bloc|branche|infarct|isch[ée]mi|hypertro|rythm|rhythm|segment|onde|wave|normal|anormal|abnormal|interval|d[ée]riv|d[ée]viation|axial|gauche|droit|complet|incomplet|ant[ée]rieur|post[ée]rieur|lat[ée]ral|ind[ée]termin|BBG|BBD|BAV|ESV|WPW|LVH|RVH|STEMI|NSTEMI)/i,
  // More diagnosis phrases (no trailing \b)
  /(aucun\s+ECG|pr[ée]c[ée]dent|disponible|repolarisation|conduction|extrasystol|big[ée]min|trig[ée]min|sous[\s-]?d[ée]cal|sus[\s-]?d[ée]cal|allongement|raccourcissement|microvoltage|alternance)/i,
  // ECG label
  /\bECG\b/i,
  // Page info
  /(Page|page)\s+\d/,
  // Derivation info
  /d[ée]rivation/i,
  // Software/algorithm version (e.g. "10.1.3", "12SL", "241")
  /^\d+\.\d+\.\d+$/,
  /\d+SL/,
  /IDC:/,
  // Pure numbers (measurement values like "85", "156", "450/535", "-60")
  /^-?\d{1,4}$/,
  // Fraction values (like "450/535")
  /^\d{1,4}\/\d{1,4}$/,
  // Short uppercase codes (like "P?", "CL")
  /^[A-Z]{1,4}\s*\??$/,
  // Diagnosis status
  /(Unconfirmed|Confirmed|Diagnosis|Interpr[ée]tation|Rapport|Report)/i,
  // Degree symbol (axis values like "30 °")
  /°/,
  // Sequential/standard layout labels
  /(S[ée]quentiel|Sequential|Standard|Simultan[ée]|Simultaneous)/i,
  // Filter descriptions (e.g. "FPB 40 Hz,SBS,SSF, AC 50Hz")
  /\b(FPB|FPH|SBS|SSF)\b/,
  // Device model/version strings (e.g. "MS-2007::SCM 310::3.10")
  /^[A-Z]{2,}[\u2010\u2011\u2012\u2013-]\d/i,
  // Position standard
  /position\s+standard/i,
];

function isEcgInfo(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isLeadLabel(t)) return true;
  return ECG_INFO_PATTERNS.some(re => re.test(t));
}

/* ------------------------------------------------------------------ */
/*  Classify text: should it be kept?                                  */
/* ------------------------------------------------------------------ */

/**
 * Classify text for direct stream editing (readable fonts).
 * Whitelist approach: only keep what we recognize as ECG info.
 * Unknown text is REMOVED to ensure no patient data leaks through.
 */
function shouldKeepTextDirect(text: string, mode: AnonMode): boolean {
  const t = text.trim();
  if (!t) return true;
  if (mode === 'full') return isLeadLabel(t);
  // Smart mode: whitelist — only keep recognized ECG info
  if (isLeadLabel(t)) return true;
  if (isEcgInfo(t)) return true;
  return false; // safe default — remove anything not recognized as ECG info
}

/**
 * Classify text for pdfjs fallback (encoded fonts like MUSE).
 * Aggressive: unknown text is REMOVED (only keep what we recognize as ECG info).
 * This ensures patient values (names, room numbers, dates) don't slip through.
 */
function shouldKeepTextPdfjs(text: string, mode: AnonMode): boolean {
  const t = text.trim();
  if (!t) return true;
  if (mode === 'full') return isLeadLabel(t);
  if (isLeadLabel(t)) return true;
  if (isEcgInfo(t)) return true;
  return false; // aggressive — remove anything not recognized as ECG info
}

/* ------------------------------------------------------------------ */
/*  Detect if raw stream text is readable (plain fonts)                */
/* ------------------------------------------------------------------ */

function isRawTextReadable(doc: PDFDocument): boolean {
  // Extract raw text from all BT blocks on first page and check if
  // any recognized lead labels are found
  const page = doc.getPages()[0];
  if (!page) return false;
  const node = page.node;
  const contents = node.get(PDFName.of('Contents'));
  if (!contents) return false;

  const checkStream = (ref: PDFRef): boolean => {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) return false;
    const dec = decodeStream(stream);
    if (!dec) return false;
    const text = dec.text;
    const blocks = findBTBlocks(text);
    for (const block of blocks) {
      const t = extractTjText(block.body).trim();
      if (LEAD_LABELS.has(t)) return true;
    }
    return false;
  };

  if (contents instanceof PDFRef) {
    if (checkStream(contents)) return true;
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i);
      if (ref instanceof PDFRef && checkStream(ref)) return true;
    }
  }

  // Also check Form XObjects
  const resources = resolveDict(node.get(PDFName.of('Resources')), doc);
  if (resources) {
    const xObjRef = resources.get(PDFName.of('XObject'));
    const xObjDict = xObjRef instanceof PDFRef
      ? doc.context.lookup(xObjRef) as PDFDict
      : xObjRef instanceof PDFDict ? xObjRef : null;
    if (xObjDict) {
      for (const [, ref] of xObjDict.entries()) {
        if (ref instanceof PDFRef && checkStream(ref)) return true;
      }
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  PATH A: Direct stream editing (for readable fonts)                 */
/* ------------------------------------------------------------------ */

function processStreamDirect(stream: string, mode: AnonMode): string {
  const blocks = findBTBlocks(stream);
  let result = stream;
  for (let j = blocks.length - 1; j >= 0; j--) {
    const block = blocks[j];
    const text = extractTjText(block.body);
    if (!shouldKeepTextDirect(text, mode)) {
      result = result.slice(0, block.start) + result.slice(block.end);
    }
  }
  return result;
}

function replaceStreamDirect(oldStream: PDFRawStream, mode: AnonMode): void {
  const dec = decodeStream(oldStream);
  if (!dec) return;
  const cleaned = processStreamDirect(dec.text, mode);
  writeStream(oldStream, cleaned, dec.isFlate);
}

function processDocDirect(doc: PDFDocument, mode: AnonMode): void {
  for (const page of doc.getPages()) {
    const node = page.node;
    const contents = node.get(PDFName.of('Contents'));
    if (!contents) continue;

    if (contents instanceof PDFRef) {
      const stream = doc.context.lookup(contents);
      if (stream instanceof PDFRawStream) replaceStreamDirect(stream, mode);
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const ref = contents.get(i);
        if (!(ref instanceof PDFRef)) continue;
        const stream = doc.context.lookup(ref);
        if (stream instanceof PDFRawStream) replaceStreamDirect(stream, mode);
      }
    }

    const resources = resolveDict(node.get(PDFName.of('Resources')), doc);
    if (resources) cleanXObjects(resources, doc, new Set(), mode);
  }
}

function cleanXObjects(resources: PDFDict, doc: PDFDocument, visited: Set<string>, mode: AnonMode): void {
  const xObjRef = resources.get(PDFName.of('XObject'));
  if (!xObjRef) return;
  const xObjDict = xObjRef instanceof PDFRef
    ? doc.context.lookup(xObjRef) as PDFDict
    : xObjRef instanceof PDFDict ? xObjRef : null;
  if (!xObjDict) return;
  for (const [, ref] of xObjDict.entries()) {
    if (!(ref instanceof PDFRef)) continue;
    const key = ref.toString();
    if (visited.has(key)) continue;
    visited.add(key);
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Form') continue;
    replaceStreamDirect(obj, mode);
    const subRes = obj.dict.get(PDFName.of('Resources'));
    const resolved = subRes instanceof PDFRef ? doc.context.lookup(subRes) : subRes;
    if (resolved instanceof PDFDict) cleanXObjects(resolved, doc, visited, mode);
  }
}

/* ------------------------------------------------------------------ */
/*  PATH B: pdfjs fallback (for encoded fonts like MUSE)               */
/*  Strategy: strip ALL text, re-draw only kept items via pdf-lib      */
/* ------------------------------------------------------------------ */

interface TextItem {
  text: string;
  x: number;  // unrotated PDF (MediaBox) coordinate — baseline origin
  y: number;  // unrotated PDF (MediaBox) coordinate — baseline origin
  fontSize: number;
}

interface PageTextData {
  items: TextItem[];
  rotation: number; // page /Rotate angle (0/90/180/270)
}

/**
 * Extract text items from pdfjs in unrotated MediaBox coordinates.
 *
 * pdfjs `getTextContent` already returns the text-matrix translation in the
 * page's unrotated user space (MediaBox, origin bottom-left) — it does NOT
 * apply the page /Rotate. So we use transform[4]/[5] directly; no swap.
 *
 * The page /Rotate is applied by the viewer to the whole page, so when we
 * re-draw kept text we must rotate the glyphs by the same angle (see the
 * redraw loop's `rotate: degrees(rotation)`); otherwise text drawn flat would
 * appear sideways once the viewer rotates the page (and a coordinate swap, as
 * the old code did, mislocated every label into the middle of the trace).
 */
async function extractTextItems(
  fileBytes: ArrayBuffer,
  doc: PDFDocument,
): Promise<Map<number, PageTextData>> {
  const pdfjsLib = await import('pdfjs-dist');
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBytes) }).promise;
  const result = new Map<number, PageTextData>();

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const rotation = doc.getPage(p - 1).getRotation().angle; // 0, 90, 180, 270

    const items: TextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;

      const t = item.transform;
      // Font size from transform matrix magnitude (handles rotated text matrix)
      const fontSize = Math.sqrt(t[0] * t[0] + t[1] * t[1]) || 8;
      items.push({ text: item.str.trim(), x: t[4], y: t[5], fontSize });
    }
    result.set(p - 1, { items, rotation });
  }

  return result;
}

function stripAllText(stream: string): string {
  const blocks = findBTBlocks(stream);
  let result = stream;
  for (let j = blocks.length - 1; j >= 0; j--) {
    result = result.slice(0, blocks[j].start) + result.slice(blocks[j].end);
  }
  return result;
}

function stripStreamText(oldStream: PDFRawStream): void {
  const dec = decodeStream(oldStream);
  if (!dec) return;
  const cleaned = stripAllText(dec.text);
  writeStream(oldStream, cleaned, dec.isFlate);
}

function stripAllXObjectText(resources: PDFDict, doc: PDFDocument, visited: Set<string>): void {
  const xObjRef = resources.get(PDFName.of('XObject'));
  if (!xObjRef) return;
  const xObjDict = xObjRef instanceof PDFRef
    ? doc.context.lookup(xObjRef) as PDFDict
    : xObjRef instanceof PDFDict ? xObjRef : null;
  if (!xObjDict) return;
  for (const [, ref] of xObjDict.entries()) {
    if (!(ref instanceof PDFRef)) continue;
    const key = ref.toString();
    if (visited.has(key)) continue;
    visited.add(key);
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Form') continue;
    stripStreamText(obj);
    const subRes = obj.dict.get(PDFName.of('Resources'));
    const resolved = subRes instanceof PDFRef ? doc.context.lookup(subRes) : subRes;
    if (resolved instanceof PDFDict) stripAllXObjectText(resolved, doc, visited);
  }
}

async function processDocPdfjs(doc: PDFDocument, fileBytes: ArrayBuffer, mode: AnonMode): Promise<void> {
  // 1. Extract all text items with positions via pdfjs
  console.log('[pdfjs-path] Extracting text items via pdfjs...');
  const allItems = await extractTextItems(fileBytes, doc);
  for (const [pageIdx, data] of allItems.entries()) {
    const kept = data.items.filter(i => shouldKeepTextPdfjs(i.text, mode));
    const removed = data.items.filter(i => !shouldKeepTextPdfjs(i.text, mode));
    console.log(`[pdfjs-path] Page ${pageIdx}: ${data.items.length} items, keeping ${kept.length}, removing ${removed.length}`);
    removed.forEach(i => console.log(`  ✗ REMOVE: "${i.text}"`));
    kept.forEach(i => console.log(`  ✓ KEEP: "${i.text}" at (${i.x.toFixed(1)}, ${i.y.toFixed(1)}) size=${i.fontSize.toFixed(1)}`));
  }

  // 2. Strip ALL text from content streams and XObjects
  console.log('[pdfjs-path] Stripping all text from streams...');
  for (const page of doc.getPages()) {
    const node = page.node;
    const contents = node.get(PDFName.of('Contents'));
    if (!contents) continue;
    if (contents instanceof PDFRef) {
      const stream = doc.context.lookup(contents);
      if (stream instanceof PDFRawStream) stripStreamText(stream);
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const ref = contents.get(i);
        if (ref instanceof PDFRef) {
          const stream = doc.context.lookup(ref);
          if (stream instanceof PDFRawStream) stripStreamText(stream);
        }
      }
    }
    const resources = resolveDict(node.get(PDFName.of('Resources')), doc);
    if (resources) stripAllXObjectText(resources, doc, new Set());
  }

  // 3. Re-draw only kept text items using pdf-lib
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let pageIdx = 0; pageIdx < doc.getPageCount(); pageIdx++) {
    const page = doc.getPage(pageIdx);
    const pageData = allItems.get(pageIdx);
    const items = pageData ? pageData.items : [];
    // Pre-rotate glyphs by the page /Rotate so they read upright after the
    // viewer applies the rotation (matches the original rotated text matrix).
    const rot = pageData ? degrees(pageData.rotation) : degrees(0);
    for (const item of items) {
      if (!shouldKeepTextPdfjs(item.text, mode)) continue;
      const isLead = isLeadLabel(item.text);
      page.drawText(toWinAnsi(item.text), {
        x: item.x,
        y: item.y,
        size: item.fontSize,
        font: isLead ? fontBold : font,
        color: rgb(0, 0, 0),
        rotate: rot,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sanitize text for pdf-lib's standard (WinAnsi) fonts. ECG metadata often
 * carries typographic punctuation that WinAnsi cannot encode — notably the
 * non-breaking hyphen U+2011 (e.g. "MS‑2007"), which made drawText throw.
 * Map the common typographic chars to ASCII and drop anything still outside
 * Latin-1 so the redraw never fails. Accented French chars (≤ 0xFF) survive.
 */
function toWinAnsi(s: string): string {
  return s
    .replace(/[‐-―]/g, '-')        // hyphens / dashes → -
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')                 // non-breaking space → space
    .replace(/[^\x00-\xFF]/g, '');           // drop remaining non-Latin-1
}

function resolveDict(obj: unknown, doc: PDFDocument): PDFDict | null {
  if (obj instanceof PDFDict) return obj;
  if (obj instanceof PDFRef) {
    const r = doc.context.lookup(obj);
    return r instanceof PDFDict ? r : null;
  }
  return null;
}

function stripMetadata(doc: PDFDocument): void {
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
  doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef) {
    const info = doc.context.lookup(infoRef);
    if (info instanceof PDFDict) {
      try { info.delete(PDFName.of('CreationDate')); } catch { /* ok */ }
      try { info.delete(PDFName.of('ModDate')); } catch { /* ok */ }
    }
  }
  const rootRef = doc.context.trailerInfo.Root;
  if (rootRef) {
    const catalog = doc.context.lookup(rootRef);
    if (catalog instanceof PDFDict) {
      try { catalog.delete(PDFName.of('Metadata')); } catch { /* ok */ }
    }
  }
}

function stripAnnotations(doc: PDFDocument): void {
  for (const page of doc.getPages())
    try { page.node.delete(PDFName.of('Annots')); } catch { /* ok */ }
}

/* ------------------------------------------------------------------ */
/*  Image redaction — drop raster banners that may carry burned-in PHI */
/* ------------------------------------------------------------------ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Erase an image XObject's pixel bytes in place. Dropping the `Do` invocation
 * only stops it from being drawn — the (still-compressed) PHI pixels survive in
 * the file and are trivially recoverable. We must wipe the stream contents too.
 * The image becomes a 1×1 white pixel: the bytes carrying the demographics are
 * gone, yet the object stays a structurally valid image.
 */
function blankImageStream(stream: PDFRawStream): void {
  const dict = stream.dict;
  const csName = dict.get(PDFName.of('ColorSpace'))?.toString() ?? '';
  const comps = /Gray/.test(csName) ? 1 : /CMYK/.test(csName) ? 4 : 3; // default RGB
  const white = new Uint8Array(comps).fill(0xff);                       // one white pixel
  const deflated = pako.deflate(white);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stream as any).contents = deflated;
  dict.set(PDFName.of('Length'), PDFNumber.of(deflated.length));
  dict.set(PDFName.of('Width'), PDFNumber.of(1));
  dict.set(PDFName.of('Height'), PDFNumber.of(1));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  // Drop transforms that would no longer match a 1×1 image.
  for (const k of ['DecodeParms', 'SMask', 'Mask', 'Decode']) {
    try { dict.delete(PDFName.of(k)); } catch { /* ok */ }
  }
}

/**
 * Names (e.g. "/X1") in a Resources/XObject dict that point to image streams,
 * blanking each image's pixels as a side effect (see `blankImageStream`).
 */
function imageXObjectNames(resources: PDFDict, doc: PDFDocument): string[] {
  const xObjDict = resolveDict(resources.get(PDFName.of('XObject')), doc);
  if (!xObjDict) return [];
  const names: string[] = [];
  for (const [key, ref] of xObjDict.entries()) {
    const obj = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype && subtype.toString() === '/Image') {
      names.push(key.toString());
      blankImageStream(obj);
    }
  }
  return names;
}

/** Remove every `/Name Do` invocation for the given image XObject names. */
function removeImageDrawsFromStream(stream: PDFRawStream, names: string[]): number {
  if (!names.length) return 0;
  const dec = decodeStream(stream);
  if (!dec) return 0;
  let removed = 0;
  let text = dec.text;
  for (const n of names) {
    const re = new RegExp(escapeRe(n) + '\\s+Do\\b', 'g');
    text = text.replace(re, () => { removed++; return ''; });
  }
  if (removed) writeStream(stream, text, dec.isFlate);
  return removed;
}

/**
 * De-identify raster content: many converters (AMPS-LLC / libharu, scanned
 * exports…) render the demographics banner, hospital header and footer as
 * images rather than text, so text stripping alone leaves PHI fully visible.
 * The ECG signal and grid of supported vectorized PDFs are vector paths, never
 * images — so suppressing image draws removes the identifying banners without
 * touching the trace. We drop the `Do` invocations (leaving the XObjects
 * orphaned) rather than rewriting pixels, which is colorspace/codec-agnostic.
 */
function redactImages(doc: PDFDocument): number {
  let total = 0;
  const visited = new Set<string>();

  const walkForms = (resources: PDFDict): void => {
    const xObjDict = resolveDict(resources.get(PDFName.of('XObject')), doc);
    if (!xObjDict) return;
    for (const [, ref] of xObjDict.entries()) {
      if (!(ref instanceof PDFRef)) continue;
      const key = ref.toString();
      if (visited.has(key)) continue;
      visited.add(key);
      const obj = doc.context.lookup(ref);
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Form') continue;
      const subRes = resolveDict(obj.dict.get(PDFName.of('Resources')), doc);
      if (!subRes) continue;
      total += removeImageDrawsFromStream(obj, imageXObjectNames(subRes, doc));
      walkForms(subRes);
    }
  };

  for (const page of doc.getPages()) {
    const node = page.node;
    const resources = resolveDict(node.get(PDFName.of('Resources')), doc);
    if (!resources) continue;
    const names = imageXObjectNames(resources, doc);

    const contents = node.get(PDFName.of('Contents'));
    if (contents instanceof PDFRef) {
      const stream = doc.context.lookup(contents);
      if (stream instanceof PDFRawStream) total += removeImageDrawsFromStream(stream, names);
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const ref = contents.get(i);
        if (!(ref instanceof PDFRef)) continue;
        const stream = doc.context.lookup(ref);
        if (stream instanceof PDFRawStream) total += removeImageDrawsFromStream(stream, names);
      }
    }
    walkForms(resources);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

export async function anonymizePdf(
  fileBytes: ArrayBuffer,
  mode: AnonMode = 'full',
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });

  stripMetadata(doc);
  stripAnnotations(doc);

  // Suppress raster banners (demographics/header/footer images) that text
  // stripping can't reach. Harmless to vector ECG signal+grid.
  const imagesRemoved = redactImages(doc);
  console.log(`[anonymize] Image draws removed: ${imagesRemoved}`);

  const readable = isRawTextReadable(doc);
  console.log(`[anonymize] mode=${mode}, rawTextReadable=${readable}, pages=${doc.getPageCount()}`);

  if (readable) {
    // Path A: fonts are plain-text readable (Schiller, Mortara, etc.)
    console.log('[anonymize] Using direct stream editing (Path A)');
    processDocDirect(doc, mode);
  } else {
    // Path B: encoded fonts (GE MUSE, etc.) — use pdfjs to decode text
    console.log('[anonymize] Using pdfjs fallback (Path B)');
    await processDocPdfjs(doc, fileBytes.slice(0), mode);
  }

  const result = await doc.save();
  console.log(`[anonymize] Done, output size: ${result.length} bytes`);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Verification: extract remaining text via pdfjs-dist                */
/* ------------------------------------------------------------------ */

export async function extractTextFromPdf(fileBytes: ArrayBuffer): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBytes) }).promise;
  const texts: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item && item.str.trim()) {
        texts.push(item.str.trim());
      }
    }
  }

  return texts;
}
