import { useState, useCallback } from 'react';
import type { ECGData, ServerResponse } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

type CardState = 'idle' | 'loading' | 'done' | 'error';

interface FmtDef {
  key: string;
  apiFormat: string;
  label: string;
  badge: 'std' | 'med' | 'img';
  badgeKey: TranslationKey;
  descKey: TranslationKey;
}

const FORMATS: FmtDef[] = [
  { key: 'edf', apiFormat: 'edf', label: 'EDF+', badge: 'std', badgeKey: 'dl.badge.std', descKey: 'dl.edf.desc' },
  { key: 'wfdb', apiFormat: 'wfdb', label: 'WFDB', badge: 'std', badgeKey: 'dl.badge.physionet', descKey: 'dl.wfdb.desc' },
  { key: 'dicom', apiFormat: 'dicom', label: 'DICOM', badge: 'med', badgeKey: 'dl.badge.medical', descKey: 'dl.dicom.desc' },
  { key: 'hl7aecg', apiFormat: 'hl7aecg', label: 'HL7 aECG', badge: 'med', badgeKey: 'dl.badge.fda', descKey: 'dl.hl7.desc' },
  { key: 'hdf5', apiFormat: 'hdf5', label: 'HDF5', badge: 'std', badgeKey: 'dl.badge.scientific', descKey: 'dl.hdf5.desc' },
  { key: 'webp', apiFormat: 'webp', label: 'WebP 4K', badge: 'img', badgeKey: 'dl.badge.image', descKey: 'dl.webp.desc' },
];

const BADGE_STYLES: Record<string, string> = {
  std: 'bg-primary/10 text-primary',
  med: 'bg-amber-100 text-amber-700',
  img: 'bg-emerald-100 text-emerald-700',
};

const API_URL = '/api/ecg/convert/';
const DATA_URL = '/api/ecg/data/';

interface Props {
  ecgData: ECGData;
  disabled?: boolean;
}

export default function FormatCards({ ecgData, disabled }: Props) {
  const { t } = useLanguage();
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [results, setResults] = useState<Record<string, ServerResponse>>({});

  const handleConvert = useCallback(async (fmt: FmtDef) => {
    setStates(s => ({ ...s, [fmt.key]: 'loading' }));
    try {
      const r = await fetch(API_URL + fmt.apiFormat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecgData),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const j: ServerResponse = await r.json();
      if (!j.success) throw new Error(j.error || 'Server error');
      setResults(s => ({ ...s, [fmt.key]: j }));
      setStates(s => ({ ...s, [fmt.key]: 'done' }));
    } catch {
      setStates(s => ({ ...s, [fmt.key]: 'error' }));
    }
  }, [ecgData]);

  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-600">{t('fmt.title')}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map(fmt => {
          const state = states[fmt.key] || 'idle';
          const resp = results[fmt.key];
          const files = resp?.files;

          // Find the main download file
          let downloadHref: string | null = null;
          let downloadName: string | null = null;
          if (files) {
            const firstKey = Object.keys(files)[0];
            if (firstKey) {
              downloadName = files[firstKey];
              downloadHref = DATA_URL + downloadName;
            }
          }

          return (
            <div
              key={fmt.key}
              className={`group relative rounded-xl border p-4 transition-all ${
                state === 'done'
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : state === 'error'
                    ? 'border-red-200 bg-red-50/30'
                    : 'border-white/40 bg-white/50 backdrop-blur-sm'
              }`}
            >
              <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_STYLES[fmt.badge]}`}>
                {t(fmt.badgeKey)}
              </span>
              <div className="font-mono text-base font-semibold text-ecg-trace">{fmt.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 pr-12">{t(fmt.descKey)}</div>

              <div className="mt-3">
                {state === 'idle' && (
                  <button
                    onClick={() => handleConvert(fmt)}
                    disabled={disabled}
                    className="rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↗ {t('fmt.convert')}
                  </button>
                )}
                {state === 'loading' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                    {t('fmt.converting')}
                  </span>
                )}
                {state === 'done' && downloadHref && (
                  <a
                    href={downloadHref}
                    download={downloadName}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-700"
                  >
                    ↓ {t('fmt.download')}
                  </a>
                )}
                {state === 'error' && (
                  <button
                    onClick={() => handleConvert(fmt)}
                    className="rounded-lg bg-red-100 px-3.5 py-1.5 text-xs font-semibold text-red-600 transition-all hover:bg-red-200"
                  >
                    ↻ {t('fmt.error')} — {t('fmt.convert')}
                  </button>
                )}

                {/* Extra WFDB .dat download */}
                {state === 'done' && files?.wfdb_dat && (
                  <a
                    href={DATA_URL + files.wfdb_dat}
                    download={files.wfdb_dat}
                    className="ml-2 text-[11px] font-mono text-primary underline hover:text-primary-dark"
                  >
                    + .dat
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
