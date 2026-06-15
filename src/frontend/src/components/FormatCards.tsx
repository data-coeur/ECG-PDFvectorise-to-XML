// FormatCards — grille de cartes "convertir vers HL7 aECG / Image / PDF" pour
// l'item actif et pour le batch entier. Gère le fetch vers /api/ecg/convert et
// /api/ecg/render-image, le téléchargement (fichiers individuels ou ZIP) et
// le choix fichiers vs ZIP pour le batch (le PDF est toujours anonymisé).
// Props : ECGData courant + tableau du batch. Monté par App.tsx après extraction.

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import JSZip from 'jszip';
import type { ECGData, ServerResponse } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';
import { anonymizePdf } from '../lib/pdf-anonymize';

type CardState = 'idle' | 'loading' | 'done' | 'error';

type FmtKind = 'json-format' | 'binary-image';

interface FmtDef {
  key: string;
  kind: FmtKind;
  apiPath: string;
  label: string;
  badge: 'std' | 'med' | 'img' | 'wip';
  badgeKey: TranslationKey;
  descKey: TranslationKey;
  ext: string;
  wip?: boolean;
}

const FORMATS: FmtDef[] = [
  { key: 'hl7aecg', kind: 'json-format', apiPath: 'convert/hl7aecg', label: 'HL7 aECG XML', badge: 'med', badgeKey: 'dl.badge.fda', descKey: 'dl.hl7.desc', ext: 'xml' },
  { key: 'pdfvec', kind: 'json-format', apiPath: '', label: 'PDF Vectoriel Anonymisé', badge: 'std', badgeKey: 'dl.badge.std', descKey: 'dl.pdfvec.desc', ext: 'pdf' },
  { key: 'image', kind: 'binary-image', apiPath: 'render-image', label: 'Image', badge: 'img', badgeKey: 'dl.badge.image', descKey: 'dl.image.desc', ext: 'webp' },
];

const BADGE_STYLES: Record<string, string> = {
  std: 'bg-primary/10 text-primary',
  med: 'bg-amber-100 text-amber-700',
  img: 'bg-emerald-100 text-emerald-700',
  wip: 'bg-slate-200 text-slate-500',
};

const API_BASE = '/api/ecg/';
const DATA_URL = '/api/ecg/data/';

interface Props {
  ecgData: ECGData;
  disabled?: boolean;
  onConvertStart?: () => void;
  onConvertDone?: () => void;
  /** All done batch items — enables "Convert all" when length > 1 */
  allEcgData?: ECGData[];
  /** Original PDF file — anonymized client-side for the "PDF Vectoriel Anonymisé" download */
  pdfFile?: File | null;
  /** All PDF files from batch — for batch PDF download */
  allPdfFiles?: File[];
  /** Current render selection (layout target + backend code) from ECGImageView,
   *  so the Image card renders WebP/PDF at the layout shown in the preview. */
  imageSel?: { target: number; fmt: string } | null;
}

interface DownloadLink { href: string; name: string }

/** Extra render parameters for the image endpoint (layout + output format). */
interface RenderOpts { target: number; fmt: string; outputFormat: 'webp' | 'pdf' }

async function convertOne(fmt: FmtDef, data: ECGData, idx: number, render?: RenderOpts): Promise<DownloadLink> {
  let url = API_BASE + fmt.apiPath;
  if (render) {
    const qs = new URLSearchParams({
      target: String(render.target),
      format: render.fmt,
      output_format: render.outputFormat,
    });
    url += `?${qs.toString()}`;
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  if (fmt.kind === 'binary-image') {
    const blob = await r.blob();
    const href = URL.createObjectURL(blob);
    const ext = render?.outputFormat ?? fmt.ext;
    return { href, name: `ecg_${idx + 1}.${ext}` };
  }
  const j: ServerResponse = await r.json();
  if (!j.success || !j.files) throw new Error(j.error || 'Server error');
  const firstKey = Object.keys(j.files)[0];
  return { href: DATA_URL + j.files[firstKey], name: j.files[firstKey] };
}

function triggerDownload(link: DownloadLink) {
  const a = document.createElement('a');
  a.href = link.href;
  a.download = link.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const srcBaseOf = (name: string) => (name || 'ecg').replace(/\.[^./\\]+$/, '') || 'ecg';

/** CSV mapping anonymized filename → original filename (UTF-8 BOM for Excel). */
function buildCorrespondenceCsv(rows: { anon: string; original: string }[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = ['nom_anonymise,nom_original', ...rows.map(r => `${esc(r.anon)},${esc(r.original)}`)];
  return '﻿' + lines.join('\r\n');
}

export default function FormatCards({ ecgData, disabled, onConvertStart, onConvertDone, allEcgData, pdfFile, allPdfFiles, imageSel }: Props) {
  const { t } = useLanguage();
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [downloads, setDownloads] = useState<Record<string, DownloadLink>>({});
  const [batchStates, setBatchStates] = useState<Record<string, { done: number; total: number; running: boolean }>>({});
  const [showWip, setShowWip] = useState(false);
  // Unified batch popup: which card triggered it (null = closed).
  const [batchCard, setBatchCard] = useState<FmtDef | null>(null);
  // Include a correspondence table (anonymized ↔ real filename) in the batch export.
  const [includeTable, setIncludeTable] = useState(false);
  const [showImageChoice, setShowImageChoice] = useState(false);
  const [showXmlChoice, setShowXmlChoice] = useState(false);
  // Whether the download filename is anonymized (content is already anonymous);
  // when false the name is derived from the source PDF for the user's own filing.
  const [anonName, setAnonName] = useState(true);
  // In-flight output format for the Image card (WebP / PDF), null when idle.
  const [imgFmt, setImgFmt] = useState<null | 'webp' | 'pdf'>(null);

  const hasBatch = (allEcgData?.length ?? 0) > 1;

  // Download base name: anonymized (ecg_anonymise) or derived from the source PDF.
  const srcBase = (ecgData.filename || 'ecg').replace(/\.[^./\\]+$/, '') || 'ecg';
  const dlName = (ext: string, anon: boolean) => `${anon ? 'ecg_anonymise' : srcBase}.${ext}`;

  // Image card: render WebP or vector PDF at the currently selected layout, then
  // download. Same raw2paper render — only the output format differs. The filename
  // is anonymized (the render is built from the signal, no patient identity).
  const handleImageDownload = useCallback(async (of: 'webp' | 'pdf', anon: boolean) => {
    const fmt = FORMATS.find(f => f.key === 'image')!;
    setShowImageChoice(false);
    setImgFmt(of);
    onConvertStart?.();
    try {
      const render: RenderOpts | undefined = imageSel
        ? { target: imageSel.target, fmt: imageSel.fmt, outputFormat: of }
        : undefined;
      const link = await convertOne(fmt, ecgData, 0, render);
      triggerDownload({ href: link.href, name: dlName(of, anon) });
      onConvertDone?.();
    } catch (e) {
      console.error('[image]', of, e);
    } finally {
      setImgFmt(null);
    }
  }, [ecgData, imageSel, onConvertStart, onConvertDone, dlName]);

  // Always anonymized — both the PDF content AND the filename (the original name
  // can carry patient identity, e.g. "LASTNAME_FIRSTNAME_…pdf").
  const handlePdfDownload = useCallback(async () => {
    if (!pdfFile) return;
    setStates(s => ({ ...s, pdfvec: 'loading' }));
    try {
      const buf = await pdfFile.arrayBuffer();
      const anonBytes = await anonymizePdf(buf.slice(0), 'smart');
      const anonBuf = new ArrayBuffer(anonBytes.byteLength);
      new Uint8Array(anonBuf).set(anonBytes);
      const blob = new Blob([anonBuf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const name = 'ecg_anonymise.pdf';
      triggerDownload({ href: url, name });
      setStates(s => ({ ...s, pdfvec: 'done' }));
      setDownloads(s => ({ ...s, pdfvec: { href: url, name } }));
    } catch (e) {
      console.error('[pdfvec anon]', e);
      setStates(s => ({ ...s, pdfvec: 'error' }));
    }
  }, [pdfFile]);

  const handleConvert = useCallback(async (fmt: FmtDef, anon = true) => {
    setShowXmlChoice(false);
    setStates(s => ({ ...s, [fmt.key]: 'loading' }));
    onConvertStart?.();
    try {
      const link = await convertOne(fmt, ecgData, 0);
      // Fetch the result into a blob URL so the download fires reliably right
      // after the (async) conversion — a programmatic click on a same-origin
      // server URL outside the user gesture is blocked by some browsers, whereas
      // blob downloads are allowed. Content is already anonymous; the choice only
      // sets the download filename.
      const blob = await (await fetch(link.href)).blob();
      const dl = { href: URL.createObjectURL(blob), name: dlName(fmt.ext, anon) };
      triggerDownload(dl);
      setDownloads(s => ({ ...s, [fmt.key]: dl }));
      setStates(s => ({ ...s, [fmt.key]: 'done' }));
      onConvertDone?.();
    } catch (e) {
      console.error('[convert]', fmt.key, e);
      setStates(s => ({ ...s, [fmt.key]: 'error' }));
    }
  }, [ecgData, onConvertStart, onConvertDone, dlName]);

  // Unified batch export for any card (PDF anonymized / HL7 XML / Image). Builds
  // each file (anonymized PDF client-side, or server-converted XML/image), names
  // it anonymized (ecg_anonymise_<n>) or after its source file, and optionally
  // adds a correspondence.csv mapping anonymized ↔ real names. ZIP bundles
  // everything; "files" triggers each download (+ the CSV) separately.
  const runBatch = useCallback(async (
    fmt: FmtDef, mode: 'files' | 'zip', anon: boolean, withTable: boolean,
  ) => {
    const isPdf = fmt.key === 'pdfvec';
    const sources = isPdf ? allPdfFiles : allEcgData;
    if (!sources || sources.length <= 1) return;
    const total = sources.length;
    setBatchStates(s => ({ ...s, [fmt.key]: { done: 0, total, running: true } }));

    const zip = mode === 'zip' ? new JSZip() : null;
    const rows: { anon: string; original: string }[] = [];

    for (let i = 0; i < total; i++) {
      try {
        let blob: Blob;
        let originalName: string;
        if (isPdf) {
          const f = allPdfFiles![i];
          originalName = f.name;
          const buf = await f.arrayBuffer();
          const anonBytes = await anonymizePdf(buf.slice(0), 'smart');
          const ab = new ArrayBuffer(anonBytes.byteLength);
          new Uint8Array(ab).set(anonBytes);
          blob = new Blob([ab], { type: 'application/pdf' });
        } else {
          const d = allEcgData![i];
          originalName = d.filename || `ecg_${i + 1}`;
          const link = await convertOne(fmt, d, i);
          blob = await (await fetch(link.href)).blob();
        }
        const name = anon ? `ecg_anonymise_${i + 1}.${fmt.ext}` : `${srcBaseOf(originalName)}.${fmt.ext}`;
        rows.push({ anon: name, original: originalName });
        if (zip) zip.file(name, blob);
        else triggerDownload({ href: URL.createObjectURL(blob), name });
        setBatchStates(s => ({ ...s, [fmt.key]: { ...s[fmt.key], done: i + 1 } }));
      } catch (e) {
        console.error(`[batch] ${fmt.key} item ${i}:`, e);
      }
    }

    if (withTable && rows.length) {
      const csv = buildCorrespondenceCsv(rows);
      if (zip) zip.file('correspondance.csv', csv);
      else triggerDownload({ href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), name: 'correspondance.csv' });
    }
    if (zip) {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerDownload({ href: URL.createObjectURL(zipBlob), name: `ecg_${fmt.key}_${total}.zip` });
    }

    setBatchStates(s => ({ ...s, [fmt.key]: { ...s[fmt.key], running: false } }));
  }, [allPdfFiles, allEcgData]);

  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-600">{t('fmt.title')}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map(fmt => {
          const state = states[fmt.key] || 'idle';
          const link = downloads[fmt.key];
          const isWip = fmt.wip;
          const batch = batchStates[fmt.key];

          return (
            <div
              key={fmt.key}
              className={`group relative rounded-xl border p-4 transition-all ${
                isWip
                  ? 'border-slate-200 bg-slate-50/40 opacity-70'
                  : state === 'done'
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : state === 'error'
                      ? 'border-red-200 bg-red-50/30'
                      : 'border-white/40 bg-white/50 backdrop-blur-sm'
              }`}
            >
              <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_STYLES[fmt.badge]}`}>
                {t(fmt.badgeKey)}
              </span>
              <div className={`font-mono text-base font-semibold ${isWip ? 'text-slate-500' : 'text-ecg-trace'}`}>{fmt.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 pr-12">{t(fmt.descKey)}</div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isWip && (
                  <button
                    onClick={() => setShowWip(true)}
                    className="rounded-lg bg-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-500 cursor-not-allowed"
                  >
                    {t('fmt.convert')}
                  </button>
                )}
                {!isWip && state === 'idle' && fmt.key === 'pdfvec' && pdfFile && (
                  <button
                    onClick={() => handlePdfDownload()}
                    disabled={disabled}
                    className="rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↓ {t('fmt.download')}
                  </button>
                )}
                {!isWip && state === 'idle' && fmt.key !== 'pdfvec' && fmt.key !== 'image' && (
                  <button
                    onClick={() => setShowXmlChoice(true)}
                    disabled={disabled}
                    className="rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↓ {t('fmt.download')}
                  </button>
                )}
                {/* Image card: one button → popup to pick WebP or vector PDF
                    (same render, selected layout). */}
                {!isWip && fmt.key === 'image' && (
                  imgFmt !== null ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                      {t('fmt.converting')}
                    </span>
                  ) : (
                    <button
                      onClick={() => setShowImageChoice(true)}
                      disabled={disabled}
                      className="rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ↓ {t('fmt.download')}
                    </button>
                  )
                )}
                {!isWip && state === 'loading' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                    {t('fmt.converting')}
                  </span>
                )}
                {!isWip && state === 'done' && link && (
                  <a
                    href={link.href}
                    download={link.name}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-700"
                  >
                    ↓ {t('fmt.download')}
                  </a>
                )}
                {!isWip && state === 'error' && (
                  <button
                    onClick={() => handleConvert(fmt)}
                    className="rounded-lg bg-red-100 px-3.5 py-1.5 text-xs font-semibold text-red-600 transition-all hover:bg-red-200"
                  >
                    ↻ {t('fmt.error')} — {t('fmt.convert')}
                  </button>
                )}

                {/* Convert all — opens the unified batch popup (anon name + table). */}
                {!isWip && hasBatch && !batch?.running && (
                  (fmt.key === 'pdfvec' ? (allPdfFiles?.length ?? 0) : (allEcgData?.length ?? 0)) > 1
                ) && (
                  <button
                    onClick={() => { setIncludeTable(false); setBatchCard(fmt); }}
                    disabled={disabled}
                    className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-[10px] font-medium text-primary transition-all hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↗ {t('fmt.convertAll' as TranslationKey)} ({fmt.key === 'pdfvec' ? allPdfFiles!.length : allEcgData!.length})
                  </button>
                )}
                {!isWip && batch?.running && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                    {batch.done}/{batch.total}
                  </span>
                )}
                {!isWip && batch && !batch.running && batch.done > 0 && (
                  <span className="text-[10px] text-emerald-600 font-medium">
                    ✓ {batch.done}/{batch.total}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showWip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setShowWip(false)}
        >
          <div
            className="glass-card max-w-sm p-6 mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-slate-700">{t('fmt.wip.title')}</h4>
            <p className="mt-2 text-sm text-slate-500">{t('fmt.wip.body')}</p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowWip(false)}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-primary-dark"
              >
                {t('fmt.wip.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified batch popup (PDF / XML / Image): anonymized-name + correspondence
          table options, then ZIP or separate files. */}
      {batchCard && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-md"
          onClick={() => setBatchCard(null)}
        >
          <div className="glass-card w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              {t('fmt.convertAll' as TranslationKey)} — {batchCard.label}
            </h3>
            <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={anonName} onChange={e => setAnonName(e.target.checked)} className="accent-primary" />
              {t('fmt.anonName' as TranslationKey)}
            </label>
            <label className={`mb-4 flex items-center gap-2 text-xs ${anonName ? 'cursor-pointer text-slate-600' : 'text-slate-300'}`}>
              <input type="checkbox" checked={includeTable && anonName} disabled={!anonName} onChange={e => setIncludeTable(e.target.checked)} className="accent-primary" />
              {t('fmt.corrTable' as TranslationKey)}
            </label>
            <div className="space-y-2">
              <button
                onClick={() => { const f = batchCard; setBatchCard(null); runBatch(f, 'zip', anonName, includeTable && anonName); }}
                className="flex w-full items-center gap-3 rounded-xl border border-white/40 bg-white/60 p-3 text-left transition-all hover:border-primary/40 hover:bg-white/80"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm">📦</span>
                <div>
                  <div className="text-xs font-semibold text-slate-700">{t('fmt.batch.zip' as TranslationKey)}</div>
                  <div className="text-[10px] text-slate-400">{t('fmt.batch.zipDesc' as TranslationKey)}</div>
                </div>
              </button>
              <button
                onClick={() => { const f = batchCard; setBatchCard(null); runBatch(f, 'files', anonName, includeTable && anonName); }}
                className="flex w-full items-center gap-3 rounded-xl border border-white/40 bg-white/60 p-3 text-left transition-all hover:border-primary/40 hover:bg-white/80"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 text-sm">📄</span>
                <div>
                  <div className="text-xs font-semibold text-slate-700">{t('fmt.batch.files' as TranslationKey)}</div>
                  <div className="text-[10px] text-slate-400">{t('fmt.batch.filesDesc' as TranslationKey)}</div>
                </div>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setBatchCard(null)}
                className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-300"
              >
                {t('unsupported.close' as TranslationKey)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Image download choice popup: WebP raster or vector PDF (same render) */}
      {showImageChoice && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-md"
          onClick={() => setShowImageChoice(false)}
        >
          <div className="glass-card w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('fmt.img.title' as TranslationKey)}</h3>
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={anonName} onChange={e => setAnonName(e.target.checked)} className="accent-primary" />
              {t('fmt.anonName' as TranslationKey)}
            </label>
            <div className="space-y-2">
              <button
                onClick={() => handleImageDownload('webp', anonName)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/40 bg-white/60 p-3 text-left transition-all hover:border-primary/40 hover:bg-white/80"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm">🖼️</span>
                <div>
                  <div className="text-xs font-semibold text-slate-700">{t('fmt.img.webp' as TranslationKey)}</div>
                  <div className="text-[10px] text-slate-400">{t('fmt.img.webpDesc' as TranslationKey)}</div>
                </div>
              </button>
              <button
                onClick={() => handleImageDownload('pdf', anonName)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/40 bg-white/60 p-3 text-left transition-all hover:border-primary/40 hover:bg-white/80"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm">📄</span>
                <div>
                  <div className="text-xs font-semibold text-slate-700">{t('fmt.img.pdf' as TranslationKey)}</div>
                  <div className="text-[10px] text-slate-400">{t('fmt.img.pdfDesc' as TranslationKey)}</div>
                </div>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowImageChoice(false)}
                className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-300"
              >
                {t('unsupported.close' as TranslationKey)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* HL7 aECG XML download popup: filename anonymized or source-derived. */}
      {showXmlChoice && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-md"
          onClick={() => setShowXmlChoice(false)}
        >
          <div className="glass-card w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">{t('fmt.xml.title' as TranslationKey)}</h3>
            <p className="mb-3 text-[10px] text-slate-400">{t('fmt.xml.note' as TranslationKey)}</p>
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={anonName} onChange={e => setAnonName(e.target.checked)} className="accent-primary" />
              {t('fmt.anonName' as TranslationKey)}
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowXmlChoice(false)}
                className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-300"
              >
                {t('unsupported.close' as TranslationKey)}
              </button>
              <button
                onClick={() => handleConvert(FORMATS.find(f => f.key === 'hl7aecg')!, anonName)}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-primary-dark"
              >
                ↓ {t('fmt.download')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
