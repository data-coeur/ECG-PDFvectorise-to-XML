import { useState, useCallback } from 'react';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';
import { anonymizePdf, extractTextFromPdf, type AnonMode } from '../lib/pdf-anonymize';

type CardState = 'idle' | 'loading' | 'done' | 'error';

interface Props {
  pdfFile: File | null;
  disabled?: boolean;
}

const LockIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const UserMinusIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="18" y1="11" x2="23" y2="11" />
  </svg>
);

const CheckIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export default function AnonymizeCard({ pdfFile, disabled }: Props) {
  const { t } = useLanguage();
  const [state, setState] = useState<CardState>('idle');
  const [activeMode, setActiveMode] = useState<AnonMode | null>(null);
  const [error, setError] = useState('');
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultName, setResultName] = useState('');
  const [removedCount, setRemovedCount] = useState(0);
  const [verified, setVerified] = useState(false);

  const handleAnonymize = useCallback(async (mode: AnonMode) => {
    if (!pdfFile) return;
    setState('loading');
    setActiveMode(mode);
    setError('');
    setVerified(false);

    try {
      const originalBuf = await pdfFile.arrayBuffer() as ArrayBuffer;
      const bufForText = originalBuf.slice(0);
      const bufForAnon = originalBuf.slice(0);

      const textBefore = await extractTextFromPdf(bufForText);
      const beforeCount = textBefore.length;

      const anonBytes = await anonymizePdf(bufForAnon, mode);

      const anonBuf = new ArrayBuffer(anonBytes.byteLength);
      new Uint8Array(anonBuf).set(anonBytes);

      if (mode === 'full') {
        const textAfter = await extractTextFromPdf(anonBuf.slice(0));
        if (textAfter.length > 0) {
          setState('error');
          setError(`Verification failed: ${textAfter.length} text items remaining`);
          return;
        }
        setVerified(true);
      }

      setRemovedCount(beforeCount);
      const blob = new Blob([anonBuf], { type: 'application/pdf' });
      const baseName = pdfFile.name.replace(/\.pdf$/i, '');
      const suffix = mode === 'full' ? '_stripped' : '_anonymized';
      setResultBlob(blob);
      setResultName(`${baseName}${suffix}.pdf`);
      setState('done');
    } catch (e) {
      setState('error');
      setError((e as Error).message);
    }
  }, [pdfFile]);

  const handleDownload = useCallback(() => {
    if (!resultBlob || !resultName) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = resultName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [resultBlob, resultName]);

  const handleReset = useCallback(() => {
    setState('idle');
    setActiveMode(null);
    setError('');
    setResultBlob(null);
    setResultName('');
    setRemovedCount(0);
    setVerified(false);
  }, []);

  const renderCard = (mode: AnonMode) => {
    const isActive = activeMode === mode;
    const cardState = isActive ? state : 'idle';
    const isSmart = mode === 'smart';

    const labelKey: TranslationKey = isSmart ? 'anon.smart.label' : 'anon.full.label';
    const descKey: TranslationKey = isSmart ? 'anon.smart.desc' : 'anon.full.desc';
    const badgeKey: TranslationKey = isSmart ? 'anon.badge.smart' : 'anon.badge.full';
    const actionKey: TranslationKey = isSmart ? 'anon.smart.action' : 'anon.full.action';

    return (
      <div
        key={mode}
        className={`group relative rounded-xl border p-4 transition-all ${
          cardState === 'done'
            ? 'border-emerald-200 bg-emerald-50/50'
            : cardState === 'error'
              ? 'border-red-200 bg-red-50/30'
              : 'border-white/40 bg-white/50 backdrop-blur-sm'
        }`}
      >
        <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          isSmart ? 'bg-violet-100 text-violet-700' : 'bg-rose-100 text-rose-700'
        }`}>
          {t(badgeKey)}
        </span>

        <div className={`font-mono text-base font-semibold text-ecg-trace flex items-center gap-2`}>
          <span className={isSmart ? 'text-violet-600' : 'text-rose-600'}>
            {isSmart ? <UserMinusIcon /> : <LockIcon />}
          </span>
          {t(labelKey)}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500 pr-12">
          {t(descKey)}
        </div>

        {/* Status badges */}
        {cardState === 'done' && mode === 'full' && verified && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <CheckIcon />
            {t('anon.verified')} — {removedCount} {t('anon.removed')}
          </div>
        )}
        {cardState === 'done' && mode === 'smart' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
            <CheckIcon />
            {t('anon.smart.done')}
          </div>
        )}

        <div className="mt-3">
          {cardState === 'idle' && (
            <button
              onClick={() => handleAnonymize(mode)}
              disabled={disabled || !pdfFile || state === 'loading'}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isSmart
                  ? 'bg-violet-100 text-violet-700 hover:bg-violet-600 hover:text-white'
                  : 'bg-rose-100 text-rose-700 hover:bg-rose-600 hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                {isSmart ? <UserMinusIcon /> : <LockIcon />}
                {t(actionKey)}
              </span>
            </button>
          )}
          {cardState === 'loading' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 ${
                isSmart ? 'border-t-violet-600' : 'border-t-rose-600'
              }`} />
              {t('anon.processing')}
            </span>
          )}
          {cardState === 'done' && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-700"
              >
                ↓ {t('anon.download')}
              </button>
              <button
                onClick={handleReset}
                className="rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-500 transition-all hover:border-slate-300 hover:text-slate-700"
              >
                ↻
              </button>
            </div>
          )}
          {cardState === 'error' && (
            <button
              onClick={() => handleAnonymize(mode)}
              className="rounded-lg bg-red-100 px-3.5 py-1.5 text-xs font-semibold text-red-600 transition-all hover:bg-red-200"
            >
              ↻ {error || t('anon.error')} — {t(actionKey)}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-600">{t('anon.title')}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {renderCard('smart')}
        {renderCard('full')}
      </div>
    </div>
  );
}
