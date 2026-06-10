// App — chef d'orchestre de toute l'UI. Gère l'état du batch (queue de fichiers,
// item actif, statuts), enchaîne split multi-page → détection type → extraction,
// expose les modals (report, batch, unsupported) et compose les sous-composants
// (DropZone, BatchPanel, ECGImageView, FormatCards…).
// Monté par main.tsx, sous LanguageProvider. Pas de routage : tout se passe ici.

import { useState, useCallback, useMemo, useRef } from 'react';
import type { BatchItem } from './lib/types';
import { extractFromPdf } from './lib/ecg-extract';
import { useLanguage } from './i18n';
import type { TranslationKey } from './i18n';
import LanguageToggle from './components/LanguageToggle';
import StepIndicator, { type Step } from './components/StepIndicator';
import DropZone from './components/DropZone';
import BatchConversionButton from './components/BatchConversionButton';
import BatchConversionModal from './components/BatchConversionModal';
import BatchPanel from './components/BatchPanel';
import ECGImageView, { clearImageCache, preloadImage } from './components/ECGImageView';
import FormatCards from './components/FormatCards';
import InfoCard from './components/InfoCard';
import ReportModal from './components/ReportModal';
import UnsupportedFileModal from './components/UnsupportedFileModal';
import { detectFileType, type Detected } from './lib/file-detect';
import logoSrc from './assets/logo.png';
import { expandMultiPagePdf } from './lib/pdf-split';

const EXTRACT_TIMEOUT_MS = 30_000;

/** Run a promise with a timeout. Rejects with a clear message on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

export default function App() {
  const { t } = useLanguage();

  // ── Batch state ──────────────────────────────────────────────────────────
  const MAX_BATCH = 100;
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const queueRunning = useRef(false);
  const abortRef = useRef(false);

  // Non-null while handleFiles is running pdfjs+pdf-lib on the dropped files
  // (splitting multi-page PDFs). Large PDFs take several seconds, so the
  // DropZone flips to a "preparing" state to give immediate visual feedback.
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);

  // Derived: the currently-viewed item
  const activeItem = useMemo(() => batch.find(i => i.id === activeId) ?? null, [batch, activeId]);
  const ecgData = activeItem?.ecgData ?? null;
  const pdfFile = activeItem?.file ?? batch[0]?.file ?? null;

  // ── Per-item UI flags (converting / downloaded) ──────────────────────────
  const [convertingIds, setConvertingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const converting = activeId ? convertingIds.has(activeId) : false;
  const hasDownload = activeId ? downloadedIds.has(activeId) : false;

  // ── Derived flags ─────────────────────────────────────────────────────────
  const statusLoading = activeItem?.status === 'extracting' || activeItem?.status === 'detecting';

  // ── Step indicator ───────────────────────────────────────────────────────
  const { currentStep, completedSteps } = useMemo<{ currentStep: Step; completedSteps: Step[] }>(() => {
    if (hasDownload) return { currentStep: 'download', completedSteps: ['upload', 'extract', 'send', 'download'] };
    if (converting) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (ecgData && !statusLoading) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (statusLoading) return { currentStep: 'extract', completedSteps: ['upload'] };
    if (batch.length > 0) return { currentStep: 'extract', completedSteps: ['upload'] };
    return { currentStep: 'upload', completedSteps: [] };
  }, [ecgData, statusLoading, converting, hasDownload, batch.length]);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [showReport, setShowReport] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [unsupported, setUnsupported] = useState<Detected | null>(null);

  // ── Batch helpers ────────────────────────────────────────────────────────
  const updateItem = useCallback((id: string, patch: Partial<BatchItem>) => {
    setBatch(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }, []);

  // ── Queue processor ──────────────────────────────────────────────────────
  const processQueue = useCallback(async (items: BatchItem[]) => {
    if (queueRunning.current) return;
    queueRunning.current = true;
    abortRef.current = false;
    let firstDoneId: string | null = null;
    for (const item of items) {
      if (abortRef.current) {
        updateItem(item.id, { status: 'error', error: t('batch.stopped' as TranslationKey) });
        continue;
      }
      // Detect
      updateItem(item.id, { status: 'detecting' });
      const detected = await detectFileType(item.file);
      if (abortRef.current) { updateItem(item.id, { status: 'error', error: t('batch.stopped' as TranslationKey) }); continue; }
      if (detected.kind !== 'pdf-vector') {
        updateItem(item.id, { status: 'error', error: detected.detail ?? detected.kind });
        continue;
      }
      // Extract (with timeout to prevent infinite loops on malformed PDFs)
      updateItem(item.id, { status: 'extracting' });
      try {
        const result = await withTimeout(
          extractFromPdf(item.file),
          EXTRACT_TIMEOUT_MS,
          item.file.name,
        );
        if (abortRef.current) { updateItem(item.id, { status: 'error', error: t('batch.stopped' as TranslationKey) }); continue; }
        if (!result || !result.channels.length) {
          updateItem(item.id, { status: 'error', error: t('status.noSignal') });
          continue;
        }
        const warning = detected.detail ?? null;
        updateItem(item.id, { status: 'done', ecgData: result, warning });
        // Option C: pre-render preview image in background so it's cached
        // by the time the user navigates to this item. Fire-and-forget.
        preloadImage(item.id, result);
        if (!firstDoneId) {
          firstDoneId = item.id;
          setActiveId(item.id);
        }
      } catch (e) {
        const msg = (e as Error).message;
        let error: string;
        if (msg.startsWith('TIMEOUT:')) error = t('status.timeout' as TranslationKey);
        else if (msg === 'GRID_NOT_DETECTED') error = t('status.noGrid' as TranslationKey);
        else error = msg;
        updateItem(item.id, { status: 'error', error });
      }
    }
    queueRunning.current = false;
  }, [t, updateItem]);

  // ── File drop handler ────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    // Hard limit: > MAX_BATCH → show the "full database" modal instead
    if (files.length > MAX_BATCH) {
      setShowBatch(true);
      return;
    }

    // Flip the DropZone into a "preparing" state immediately so the user
    // sees the app is working. The split step below can take several
    // seconds on large multi-page PDFs.
    setPreparing({ done: 0, total: files.length });

    try {
      // Expand multi-page PDFs into one File per page. pdf-split runs
      // vector-density detection per page and tags each one as ECG or
      // not — non-ECG pages (cover, summary, index…) are kept in the
      // result so they can be surfaced in the batch with a specific
      // "no ECG on this page" error instead of being silently dropped.
      const expanded: { file: File; isEcg: boolean }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setPreparing({ done: i, total: files.length });
        const looksLikePdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (!looksLikePdf) { expanded.push({ file: f, isEcg: true }); continue; }
        try {
          const { pages } = await expandMultiPagePdf(f);
          expanded.push(...pages);
        } catch (err) {
          console.warn('[handleFiles] pdf-split failed for', f.name, err);
          expanded.push({ file: f, isEcg: true });
        }
      }

      if (expanded.length > MAX_BATCH) {
        setShowBatch(true);
        return;
      }

      clearImageCache();
      const items: BatchItem[] = expanded.map(({ file, isEcg }) => ({
        id: crypto.randomUUID(),
        file,
        status: isEcg ? ('queued' as const) : ('error' as const),
        ecgData: null,
        error: isEcg ? null : t('status.noEcgPage' as TranslationKey),
        warning: null,
      }));
      setBatch(items);
      setActiveId(null);
      setConvertingIds(new Set());
      setDownloadedIds(new Set());
      processQueue(items.filter(i => i.status === 'queued'));
    } finally {
      setPreparing(null);
    }
  }, [processQueue, t]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
  }, []);

  const handleReset = useCallback(() => {
    abortRef.current = true;
    clearImageCache();
    setBatch([]);
    setActiveId(null);
    setConvertingIds(new Set());
    setDownloadedIds(new Set());
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const isProcessing = batch.some(i => i.status === 'extracting' || i.status === 'detecting' || i.status === 'queued');

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/30 bg-white/70 backdrop-blur-md">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt="Cardio Capture" className="h-9 w-auto" />
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{t('app.title')}</h1>
              <p className="text-xs text-slate-400">{t('app.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {batch.length > 0 && (
              <button
                onClick={handleReset}
                className="rounded-full bg-white/50 p-2 text-slate-500 backdrop-blur-sm transition-all hover:bg-white/80 hover:text-primary"
                title={t('btn.home')}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </button>
            )}
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="px-6 py-6">
        <StepIndicator current={currentStep} completed={completedSteps} />

        <div className="glass-card p-5 mt-2">
          <div className="mb-3">
            <BatchConversionButton />
          </div>
          <DropZone onFiles={handleFiles} disabled={isProcessing} preparing={preparing} />

          {/* Report button — always visible when a file has been dropped */}
          {pdfFile && (
            <div className="mt-3 flex justify-end">
              <button
                className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs font-medium text-amber-600 transition-all hover:border-amber-400 hover:bg-amber-100"
                onClick={() => setShowReport(true)}
                title={t('report.title' as TranslationKey)}
              >
                {t('report.btn' as TranslationKey)}
              </button>
            </div>
          )}

          {/* Batch file list — visible when multiple files dropped */}
          <BatchPanel items={batch} activeId={activeId} onSelect={setActiveId} onStop={handleStop} />
        </div>

        {/* Info card — visible before any extraction */}
        {batch.length === 0 && (
          <div className="mt-5">
            <InfoCard />
          </div>
        )}

        {/* Format cards + signals — for the active item */}
        {ecgData && activeId && (
          <>
            <div className="mt-5">
              <FormatCards
                ecgData={ecgData}
                disabled={statusLoading}
                onConvertStart={() => setConvertingIds(s => new Set(s).add(activeId))}
                onConvertDone={() => setDownloadedIds(s => new Set(s).add(activeId))}
                allEcgData={batch.filter(i => i.status === 'done' && i.ecgData).map(i => i.ecgData!)}
                pdfFile={pdfFile}
                allPdfFiles={batch.filter(i => i.status === 'done').map(i => i.file)}
              />
            </div>
            <div className="mt-5 glass-card p-5">
              <ECGImageView data={ecgData} cacheKey={activeId} pdfFile={pdfFile} />
            </div>
          </>
        )}
      </main>

      {/* Report extraction issue modal */}
      {showReport && pdfFile && (
        <ReportModal pdfFile={pdfFile} ecgData={ecgData} onClose={() => setShowReport(false)} />
      )}

      {/* Batch conversion modal — "Process a full database" button (standard variant) */}
      <BatchConversionModal open={showBatch} onClose={() => setShowBatch(false)} />

      {/* Unsupported file type modal */}
      <UnsupportedFileModal
        open={!!unsupported}
        onClose={() => setUnsupported(null)}
        kind={unsupported?.kind ?? 'unknown'}
        detail={unsupported?.detail}
      />
    </div>
  );
}
