import { useRef, useState, useCallback } from 'react';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Non-null while the parent is pre-processing dropped files (e.g. splitting
   *  multi-page PDFs). The drop zone flips to a busy state with a spinner. */
  preparing?: { done: number; total: number } | null;
}

export default function DropZone({ onFiles, disabled, preparing }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const handleDrop = useCallback((fileList: FileList) => {
    if (!fileList.length) return;
    onFiles(Array.from(fileList));
  }, [onFiles]);

  const busy = !!preparing;
  const inert = disabled || busy;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 ${
        busy
          ? 'border-primary/60 bg-primary/5 cursor-wait'
          : over
            ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10 cursor-pointer'
            : `border-slate-200 bg-white/40 ${inert ? 'cursor-not-allowed' : 'cursor-pointer hover:border-primary/40 hover:bg-white/60'}`
      } ${disabled && !busy ? 'opacity-50' : ''}`}
      onClick={() => !inert && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!inert) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false);
        if (!inert) handleDrop(e.dataTransfer.files);
      }}
    >
      {/* Animated ECG trace background — CSS GPU-accelerated */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.06]">
        <svg
          className="absolute top-0 left-0 h-full animate-ecg-scroll"
          style={{ width: '200%' }}
          preserveAspectRatio="none"
          viewBox="0 0 400 100"
        >
          <path
            d="M0,50 L55,50 C60,50 63,44 67,42 C71,40 75,48 78,50 L86,50 L89,53 L91,50 L93,15 L96,60 L99,48 L104,49 C110,49 118,36 126,35 C134,34 142,49 148,50 L200,50 L255,50 C260,50 263,44 267,42 C271,40 275,48 278,50 L286,50 L289,53 L291,50 L293,15 L296,60 L299,48 L304,49 C310,49 318,36 326,35 C334,34 342,49 348,50 L400,50"
            fill="none"
            stroke="#059669"
            strokeWidth="2.5"
          />
        </svg>
      </div>

      <div className="relative z-10">
        {busy ? (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <span className="inline-block h-7 w-7 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
            </div>
            <p className="text-base font-medium text-slate-700">{t('drop.preparing' as TranslationKey)}</p>
            <p className="mt-1 text-sm text-slate-400">
              {preparing!.total > 1
                ? t('drop.preparingProgress' as TranslationKey, { done: preparing!.done + 1, total: preparing!.total })
                : t('drop.preparingSingle' as TranslationKey)}
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <svg className="h-7 w-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-base font-medium text-slate-700">{t('drop.label')}</p>
            <p className="mt-1 text-sm text-slate-400">{t('drop.sub')}</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) handleDrop(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
