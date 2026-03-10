import { useRef, useState, useCallback } from 'react';
import { useLanguage } from '../i18n';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function DropZone({ onFile, disabled }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const handleFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) return;
    onFile(f);
  }, [onFile]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300 ${
        over
          ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
          : 'border-slate-200 bg-white/40 hover:border-primary/40 hover:bg-white/60'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false);
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      }}
    >
      {/* Animated ECG trace background */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]"
        preserveAspectRatio="none"
        viewBox="0 0 600 100"
      >
        <path
          d="M0,50 L80,50 L90,50 L100,50 L110,20 L115,80 L120,10 L125,60 L130,45 L140,50 L200,50 L280,50 L290,50 L300,50 L310,20 L315,80 L320,10 L325,60 L330,45 L340,50 L400,50 L480,50 L490,50 L500,50 L510,20 L515,80 L520,10 L525,60 L530,45 L540,50 L600,50"
          fill="none"
          stroke="#059669"
          strokeWidth="2.5"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            from="0 0"
            to="-200 0"
            dur="3s"
            repeatCount="indefinite"
          />
        </path>
      </svg>

      <div className="relative z-10">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <svg className="h-7 w-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p className="text-base font-medium text-slate-700">{t('drop.label')}</p>
        <p className="mt-1 text-sm text-slate-400">{t('drop.sub')}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.PDF"
        className="hidden"
        onChange={e => e.target.files?.length && handleFile(e.target.files[0])}
      />
    </div>
  );
}
