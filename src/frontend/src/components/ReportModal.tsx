import { useState, useCallback } from 'react';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';
import { anonymizePdf } from '../lib/pdf-anonymize';
import type { ECGData } from '../lib/types';

interface Props {
  pdfFile: File;
  ecgData: ECGData | null;
  onClose: () => void;
}

export default function ReportModal({ pdfFile, ecgData, onClose }: Props) {
  const { t } = useLanguage();
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleSend = useCallback(async () => {
    setState('sending');
    try {
      // Anonymize PDF (full mode = strip all text except lead labels)
      const buf = await pdfFile.arrayBuffer();
      const anonBytes = await anonymizePdf(buf.slice(0), 'full');

      // Send anonymized PDF to server
      const formData = new FormData();
      const anonBuf = new ArrayBuffer(anonBytes.byteLength);
      new Uint8Array(anonBuf).set(anonBytes);
      const anonBlob = new Blob([anonBuf], { type: 'application/pdf' });
      const safeName = pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      formData.append('pdf', anonBlob, `report_${safeName}`);
      formData.append('manufacturer', ecgData?.manufacturer ?? 'unknown');
      formData.append('layout', ecgData?.layout ?? 'unknown');
      formData.append('channels', String(ecgData?.channels.length ?? 0));
      formData.append('filename', pdfFile.name);

      const res = await fetch('/api/ecg/report', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`${res.status}`);

      setState('done');
      setTimeout(onClose, 2000);
    } catch (e) {
      setState('error');
      setError((e as Error).message);
    }
  }, [pdfFile, onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-white/40 bg-white/90 p-6 shadow-xl backdrop-blur-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Icon + Title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-800">
            {t('report.title' as TranslationKey)}
          </h3>
        </div>

        {/* Body text */}
        <p className="text-sm leading-relaxed text-slate-600 mb-5">
          {t('report.body' as TranslationKey)}
        </p>

        {/* Actions */}
        {state === 'idle' && (
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
            >
              {t('report.cancel' as TranslationKey)}
            </button>
            <button
              onClick={handleSend}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-amber-600"
            >
              {t('report.confirm' as TranslationKey)}
            </button>
          </div>
        )}

        {state === 'sending' && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
            {t('report.sending' as TranslationKey)}
          </div>
        )}

        {state === 'done' && (
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {t('report.done' as TranslationKey)}
          </div>
        )}

        {state === 'error' && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-red-600">{t('report.error' as TranslationKey)}: {error}</span>
            <button
              onClick={handleSend}
              className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-200"
            >
              ↻
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
