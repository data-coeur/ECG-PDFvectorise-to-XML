import { useState, useCallback, useMemo } from 'react';
import type { ECGData, ServerResponse } from './lib/types';
import { extractFromPdf } from './lib/ecg-extract';
import { useLanguage } from './i18n';
import LanguageToggle from './components/LanguageToggle';
import StepIndicator, { type Step } from './components/StepIndicator';
import DropZone from './components/DropZone';
import StatusBar from './components/StatusBar';
import MetadataGrid from './components/MetadataGrid';
import ECGChannels from './components/ECGChannels';
import DownloadArea from './components/DownloadArea';
import JsonViewer from './components/JsonViewer';

const API_URL = '/api/ecg/receive';
const DATA_URL = '/api/ecg/data/';

export default function App() {
  const { t } = useLanguage();
  const [ecgData, setEcgData] = useState<ECGData | null>(null);
  const [serverResp, setServerResp] = useState<ServerResponse | null>(null);
  const [status, setStatus] = useState({ msg: '', type: '' as '' | 'ok' | 'err', loading: false });

  const { currentStep, completedSteps } = useMemo<{ currentStep: Step; completedSteps: Step[] }>(() => {
    if (serverResp?.files) return { currentStep: 'download', completedSteps: ['upload', 'extract', 'send', 'download'] };
    if (status.loading && ecgData) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (ecgData) return { currentStep: 'send', completedSteps: ['upload', 'extract'] };
    if (status.loading) return { currentStep: 'extract', completedSteps: ['upload'] };
    return { currentStep: 'upload', completedSteps: [] };
  }, [ecgData, serverResp, status.loading]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setStatus({ msg: t('status.nonPdf'), type: 'err', loading: false });
      return;
    }
    setStatus({ msg: t('status.extracting'), type: '', loading: true });
    setEcgData(null);
    setServerResp(null);
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

  const handleSend = useCallback(async () => {
    if (!ecgData) return;
    setStatus({ msg: t('status.sending'), type: '', loading: true });
    setServerResp(null);
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecgData),
      });
      if (!r.ok) { setStatus({ msg: `${t('status.error')} ${r.status} ${r.statusText}`, type: 'err', loading: false }); return; }
      const j: ServerResponse = await r.json();
      if (!j.success) { setStatus({ msg: j.error || t('status.serverError'), type: 'err', loading: false }); return; }
      setServerResp(j);
      setStatus({
        msg: `${Object.keys(j.files!).length} ${t('status.formats')} · ${j.info!.channels} ${t('status.channels')} · ${j.info!.sample_rate} Hz · ${j.info!.duration}s`,
        type: 'ok', loading: false,
      });
    } catch (e) {
      setStatus({ msg: (e as Error).message, type: 'err', loading: false });
    }
  }, [ecgData, t]);

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

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-dark hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!ecgData || status.loading}
              onClick={handleSend}
            >
              ↗ {t('btn.send')}
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white/60 px-5 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!ecgData}
              onClick={handleDownloadJson}
            >
              ↓ {t('btn.json')}
            </button>
          </div>

          <div className="mt-3">
            <StatusBar message={status.msg} type={status.type} loading={status.loading} />
          </div>
        </div>

        {/* Downloads */}
        {serverResp?.files && (
          <div className="mt-5">
            <DownloadArea response={serverResp} dataUrl={DATA_URL} />
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
