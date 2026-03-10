import { useState, useCallback, useMemo } from 'react';
import type { ECGData } from './lib/types';
import { extractFromPdf } from './lib/ecg-extract';
import { useLanguage } from './i18n';
import LanguageToggle from './components/LanguageToggle';
import StepIndicator, { type Step } from './components/StepIndicator';
import DropZone from './components/DropZone';
import StatusBar from './components/StatusBar';
import MetadataGrid from './components/MetadataGrid';
import ECGChannels from './components/ECGChannels';
import FormatCards from './components/FormatCards';
import JsonViewer from './components/JsonViewer';

export default function App() {
  const { t } = useLanguage();
  const [ecgData, setEcgData] = useState<ECGData | null>(null);
  const [status, setStatus] = useState({ msg: '', type: '' as '' | 'ok' | 'err', loading: false });

  const { currentStep, completedSteps } = useMemo<{ currentStep: Step; completedSteps: Step[] }>(() => {
    if (ecgData && !status.loading) return { currentStep: 'download', completedSteps: ['upload', 'extract'] };
    if (status.loading) return { currentStep: 'extract', completedSteps: ['upload'] };
    return { currentStep: 'upload', completedSteps: [] };
  }, [ecgData, status.loading]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setStatus({ msg: t('status.nonPdf'), type: 'err', loading: false });
      return;
    }
    setStatus({ msg: t('status.extracting'), type: '', loading: true });
    setEcgData(null);
    try {
      const result = await extractFromPdf(file);
      if (!result || !result.channels.length) {
        setStatus({ msg: t('status.noSignal'), type: 'err', loading: false });
        return;
      }
      setEcgData(result);
      setStatus({ msg: `${result.channels.length} ${t('status.channels')} · ${result.manufacturer} · ${result.layout}`, type: 'ok', loading: false });
    } catch (e) {
      setStatus({ msg: (e as Error).message, type: 'err', loading: false });
    }
  }, [t]);

  const handleDownloadJson = useCallback(() => {
    if (!ecgData) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(ecgData, null, 2)], { type: 'application/json' }));
    a.download = `ecg_${Date.now()}.json`;
    a.click();
  }, [ecgData]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/30 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              <span className="text-primary">⚡</span> {t('app.title')}
            </h1>
            <p className="text-xs text-slate-400">{t('app.subtitle')}</p>
          </div>
          <LanguageToggle />
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <StepIndicator current={currentStep} completed={completedSteps} />

        {/* Input section */}
        <div className="glass-card p-5 mt-2">
          <DropZone onFile={handleFile} disabled={status.loading} />

          <div className="mt-3 flex items-center gap-3">
            <StatusBar message={status.msg} type={status.type} loading={status.loading} />
            {ecgData && (
              <button
                className="shrink-0 rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-primary/40 hover:text-primary"
                onClick={handleDownloadJson}
              >
                ↓ {t('btn.json')}
              </button>
            )}
          </div>
        </div>

        {/* Format conversion cards */}
        {ecgData && (
          <div className="mt-5">
            <FormatCards ecgData={ecgData} disabled={status.loading} />
          </div>
        )}

        {/* Extracted signals */}
        {ecgData && (
          <div className="mt-5 glass-card p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-600">{t('results.title')}</h2>
            <MetadataGrid data={ecgData} />
            <div className="mt-4">
              <ECGChannels channels={ecgData.channels} />
            </div>
            <JsonViewer data={ecgData} />
          </div>
        )}
      </main>
    </div>
  );
}
