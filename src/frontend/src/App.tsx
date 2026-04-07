import { useState, useCallback, useMemo } from 'react';
import type { ECGData } from './lib/types';
import { extractFromPdf } from './lib/ecg-extract';
// Legacy: XML input parsing disabled — see xml-extract.ts
// import { parseXmlViaBackend } from './lib/xml-extract';
import { useLanguage } from './i18n';
import type { TranslationKey } from './i18n';
import LanguageToggle from './components/LanguageToggle';
import StepIndicator, { type Step } from './components/StepIndicator';
import DropZone from './components/DropZone';
import StatusBar from './components/StatusBar';
import ECGImageView from './components/ECGImageView';
import FormatCards from './components/FormatCards';
import InfoCard from './components/InfoCard';
import DevModeView from './components/DevModeView';
import ReportModal from './components/ReportModal';

export default function App() {
  const { t } = useLanguage();
  const [ecgData, setEcgData] = useState<ECGData | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [status, setStatus] = useState({ msg: '', type: '' as '' | 'ok' | 'err', loading: false });
  const [converting, setConverting] = useState(false);
  const [hasDownload, setHasDownload] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const { currentStep, completedSteps } = useMemo<{ currentStep: Step; completedSteps: Step[] }>(() => {
    if (hasDownload) return { currentStep: 'download', completedSteps: ['upload', 'extract', 'send', 'download'] };
    if (converting) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (ecgData && !status.loading) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (status.loading) return { currentStep: 'extract', completedSteps: ['upload'] };
    return { currentStep: 'upload', completedSteps: [] };
  }, [ecgData, status.loading, converting, hasDownload]);

  const handleFile = useCallback(async (file: File) => {
    const isPdf = /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setStatus({ msg: t('status.unsupported'), type: 'err', loading: false });
      return;
    }
    setStatus({ msg: t('status.extracting'), type: '', loading: true });
    setEcgData(null);
    setPdfFile(file);
    setConverting(false);
    setHasDownload(false);
    setDevMode(false);
    try {
      let result: ECGData | null;
      result = await extractFromPdf(file);
      if (!result || !result.channels.length) {
        setStatus({ msg: t('status.noSignal'), type: 'err', loading: false });
        return;
      }
      setEcgData(result);
      const layoutLabel = t(`layout.${result.layout}` as TranslationKey) || result.layout;
      // Don't count synthetic rhythm strip channels (e.g. "II_rhythm") in the user-facing count
      const detectedCount = result.channels.filter(c => !/_rhythm$/i.test(c.name)).length;
      setStatus({ msg: `${detectedCount} ${t('status.channels')} · ${result.manufacturer} · ${layoutLabel}`, type: 'ok', loading: false });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'GRID_NOT_DETECTED') {
        setStatus({ msg: t('status.noGrid' as TranslationKey), type: 'err', loading: false });
      } else {
        setStatus({ msg, type: 'err', loading: false });
      }
    }
  }, [t]);

  const handleReset = useCallback(() => {
    setEcgData(null);
    setPdfFile(null);
    setStatus({ msg: '', type: '' as '' | 'ok' | 'err', loading: false });
    setConverting(false);
    setHasDownload(false);
    setDevMode(false);
  }, []);

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
            {ecgData && (
              <>
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
                <button
                  onClick={() => setDevMode(d => !d)}
                  className={`rounded-full p-2 backdrop-blur-sm transition-all ${
                    devMode ? 'bg-primary text-white' : 'bg-white/50 text-slate-500 hover:bg-white/80 hover:text-primary'
                  }`}
                  title={t('btn.devMode')}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </button>
              </>
            )}
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className={`mx-auto px-4 py-6 ${devMode ? 'max-w-7xl' : 'max-w-5xl'}`}>
        {!devMode && <StepIndicator current={currentStep} completed={completedSteps} />}

        {/* Input section — hidden in dev mode */}
        {!devMode && (
          <div className="glass-card p-5 mt-2">
            <DropZone onFile={handleFile} disabled={status.loading} />

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
          </div>
        )}

        {/* Info card — visible before extraction */}
        {!ecgData && !status.loading && !devMode && (
          <div className="mt-5">
            <InfoCard />
          </div>
        )}

        {/* Normal view: format cards + signals */}
        {ecgData && !devMode && (
          <>
            <div className="mt-5">
              <FormatCards ecgData={ecgData} disabled={status.loading} onConvertStart={() => setConverting(true)} onConvertDone={() => setHasDownload(true)} />
            </div>
            <div className="mt-5 glass-card p-5">
              <ECGImageView data={ecgData} />
            </div>
          </>
        )}

        {/* Dev mode view */}
        {ecgData && devMode && pdfFile && (
          <DevModeView ecgData={ecgData} file={pdfFile} />
        )}
      </main>

      {/* Report extraction issue modal */}
      {showReport && pdfFile && (
        <ReportModal pdfFile={pdfFile} ecgData={ecgData} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}
