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
import StatusBar from './components/StatusBar';
import ECGImageView, { clearImageCache, preloadImage } from './components/ECGImageView';
import FormatCards from './components/FormatCards';
import InfoCard from './components/InfoCard';
import ReportModal from './components/ReportModal';
import UnsupportedFileModal from './components/UnsupportedFileModal';
import { detectFileType, type Detected } from './lib/file-detect';

export default function App() {
  const { t } = useLanguage();

  // ── Batch state ──────────────────────────────────────────────────────────
  const MAX_BATCH = 100;
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const queueRunning = useRef(false);
  const abortRef = useRef(false);

  // Derived: the currently-viewed item
  const activeItem = useMemo(() => batch.find(i => i.id === activeId) ?? null, [batch, activeId]);
  const ecgData = activeItem?.ecgData ?? null;
  const pdfFile = activeItem?.file ?? null;

  // ── Per-item UI flags (converting / downloaded) ──────────────────────────
  const [convertingIds, setConvertingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const converting = activeId ? convertingIds.has(activeId) : false;
  const hasDownload = activeId ? downloadedIds.has(activeId) : false;

  // ── Status bar — shows info about the active item ────────────────────────
  const status = useMemo(() => {
    if (!activeItem) {
      const running = batch.find(i => i.status === 'extracting' || i.status === 'detecting');
      if (running) return { msg: t('status.extracting'), type: '' as const, loading: true };
      return { msg: '', type: '' as '' | 'ok' | 'err', loading: false };
    }
    if (activeItem.status === 'extracting' || activeItem.status === 'detecting')
      return { msg: t('status.extracting'), type: '' as const, loading: true };
    if (activeItem.status === 'error')
      return { msg: activeItem.error ?? t('status.error'), type: 'err' as const, loading: false };
    if (activeItem.ecgData) {
      const r = activeItem.ecgData;
      const layoutLabel = t(`layout.${r.layout}` as TranslationKey) || r.layout;
      const count = r.channels.filter(c => !/_rhythm$/i.test(c.name)).length;
      return { msg: `${count} ${t('status.channels')} · ${r.manufacturer} · ${layoutLabel}`, type: 'ok' as const, loading: false };
    }
    return { msg: '', type: '' as '' | 'ok' | 'err', loading: false };
  }, [activeItem, batch, t]);

  // ── Step indicator ───────────────────────────────────────────────────────
  const { currentStep, completedSteps } = useMemo<{ currentStep: Step; completedSteps: Step[] }>(() => {
    if (hasDownload) return { currentStep: 'download', completedSteps: ['upload', 'extract', 'send', 'download'] };
    if (converting) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (ecgData && !status.loading) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (status.loading) return { currentStep: 'extract', completedSteps: ['upload'] };
    if (batch.length > 0) return { currentStep: 'extract', completedSteps: ['upload'] };
    return { currentStep: 'upload', completedSteps: [] };
  }, [ecgData, status.loading, converting, hasDownload, batch.length]);

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
        // Mark remaining items as stopped so the user sees why they weren't processed
        updateItem(item.id, { status: 'error', error: t('batch.stopped' as TranslationKey) });
        continue;
      }
      // Detect
      updateItem(item.id, { status: 'detecting' });
      const detected = await detectFileType(item.file);
      if (abortRef.current) { updateItem(item.id, { status: 'error', error: t('batch.stopped' as TranslationKey) }); continue; }
      if (detected.kind === 'pdf-multi') {
        updateItem(item.id, { status: 'error', error: 'PDF multi-pages' });
        continue;
      }
      if (detected.kind !== 'pdf-vector') {
        updateItem(item.id, { status: 'error', error: detected.detail ?? detected.kind });
        continue;
      }
      // Extract
      updateItem(item.id, { status: 'extracting' });
      try {
        const result = await extractFromPdf(item.file);
        if (abortRef.current) { updateItem(item.id, { status: 'error', error: t('batch.stopped' as TranslationKey) }); continue; }
        if (!result || !result.channels.length) {
          updateItem(item.id, { status: 'error', error: t('status.noSignal') });
          continue;
        }
        updateItem(item.id, { status: 'done', ecgData: result });
        // Option C: pre-render preview image in background so it's cached
        // by the time the user navigates to this item. Fire-and-forget.
        preloadImage(item.id, result);
        if (!firstDoneId) {
          firstDoneId = item.id;
          setActiveId(item.id);
        }
      } catch (e) {
        const msg = (e as Error).message;
        updateItem(item.id, {
          status: 'error',
          error: msg === 'GRID_NOT_DETECTED' ? t('status.noGrid' as TranslationKey) : msg,
        });
      }
    }
    queueRunning.current = false;
  }, [t, updateItem]);

  // ── File drop handler ────────────────────────────────────────────────────
  const handleFiles = useCallback((files: File[]) => {
    // Hard limit: > MAX_BATCH → show the "full database" modal instead
    if (files.length > MAX_BATCH) {
      setShowBatch(true);
      return;
    }
    clearImageCache();
    const items: BatchItem[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'queued' as const,
      ecgData: null,
      error: null,
    }));
    setBatch(items);
    setActiveId(null);
    setConvertingIds(new Set());
    setDownloadedIds(new Set());
    processQueue(items);
  }, [processQueue]);

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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2,12 6,12 8,4 11,20 14,8 16,16 18,12 22,12" />
              </svg>
              {t('app.title')}
            </h1>
            <p className="text-xs text-slate-400">{t('app.subtitle')}</p>
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
      <main className="mx-auto max-w-5xl px-4 py-6">
        <StepIndicator current={currentStep} completed={completedSteps} />

        <div className="glass-card p-5 mt-2">
          <div className="mb-3">
            <BatchConversionButton />
          </div>
          <DropZone onFiles={handleFiles} disabled={isProcessing} />

          <div className="mt-3 flex items-center gap-3">
            <StatusBar message={status.msg} type={status.type} loading={status.loading} />
            {(ecgData || (status.type === 'err' && pdfFile)) && (
              <div className="ml-auto flex shrink-0 gap-2">
                {pdfFile && (
                  <button
                    className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-xs font-medium text-amber-600 transition-all hover:border-amber-400 hover:bg-amber-100"
                    onClick={() => setShowReport(true)}
                    title={t('report.title' as TranslationKey)}
                  >
                    {t('report.btn' as TranslationKey)}
                  </button>
                )}
              </div>
            )}
          </div>

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
                disabled={status.loading}
                onConvertStart={() => setConvertingIds(s => new Set(s).add(activeId))}
                onConvertDone={() => setDownloadedIds(s => new Set(s).add(activeId))}
              />
            </div>
            <div className="mt-5 glass-card p-5">
              <ECGImageView data={ecgData} cacheKey={activeId} />
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
