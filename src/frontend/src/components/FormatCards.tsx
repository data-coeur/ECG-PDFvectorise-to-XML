import { useState, useCallback } from 'react';
import type { ECGData, ServerResponse } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

type CardState = 'idle' | 'loading' | 'done' | 'error';

type FmtKind = 'json-format' | 'binary-image';

interface FmtDef {
  key: string;
  kind: FmtKind;
  apiPath: string;            // path under /api/ecg/
  label: string;
  badge: 'std' | 'med' | 'img' | 'wip';
  badgeKey: TranslationKey;
  descKey: TranslationKey;
  ext: string;                // download file extension
  wip?: boolean;
}

const FORMATS: FmtDef[] = [
  { key: 'hl7aecg', kind: 'json-format', apiPath: 'convert/hl7aecg', label: 'HL7 aECG XML', badge: 'med', badgeKey: 'dl.badge.fda', descKey: 'dl.hl7.desc', ext: 'xml' },
  { key: 'pdfvec', kind: 'json-format', apiPath: '', label: 'PDF Vectoriel', badge: 'wip', badgeKey: 'dl.badge.wip', descKey: 'dl.pdfvec.desc', ext: 'pdf', wip: true },
  { key: 'image', kind: 'binary-image', apiPath: 'render-image', label: 'Image', badge: 'img', badgeKey: 'dl.badge.image', descKey: 'dl.image.desc', ext: 'webp' },
];

const BADGE_STYLES: Record<string, string> = {
  std: 'bg-primary/10 text-primary',
  med: 'bg-amber-100 text-amber-700',
  img: 'bg-emerald-100 text-emerald-700',
  wip: 'bg-slate-200 text-slate-500',
};

const API_BASE = '/api/ecg/';
const DATA_URL = '/api/ecg/data/';

interface Props {
  ecgData: ECGData;
  disabled?: boolean;
  onConvertStart?: () => void;
  onConvertDone?: () => void;
}

interface DownloadLink { href: string; name: string }

export default function FormatCards({ ecgData, disabled, onConvertStart, onConvertDone }: Props) {
  const { t } = useLanguage();
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [downloads, setDownloads] = useState<Record<string, DownloadLink>>({});
  const [showWip, setShowWip] = useState(false);

  const handleConvert = useCallback(async (fmt: FmtDef) => {
    setStates(s => ({ ...s, [fmt.key]: 'loading' }));
    onConvertStart?.();
    try {
      const r = await fetch(API_BASE + fmt.apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecgData),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || `HTTP ${r.status}`);
      }

      let link: DownloadLink;
      if (fmt.kind === 'binary-image') {
        const blob = await r.blob();
        const href = URL.createObjectURL(blob);
        link = { href, name: `ecg_${Date.now()}.${fmt.ext}` };
      } else {
        const j: ServerResponse = await r.json();
        if (!j.success || !j.files) throw new Error(j.error || 'Server error');
        const firstKey = Object.keys(j.files)[0];
        const name = j.files[firstKey];
        link = { href: DATA_URL + name, name };
      }

      setDownloads(s => ({ ...s, [fmt.key]: link }));
      setStates(s => ({ ...s, [fmt.key]: 'done' }));
      onConvertDone?.();
    } catch (e) {
      console.error('[convert]', fmt.key, e);
      setStates(s => ({ ...s, [fmt.key]: 'error' }));
    }
  }, [ecgData, onConvertStart, onConvertDone]);

  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-600">{t('fmt.title')}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map(fmt => {
          const state = states[fmt.key] || 'idle';
          const link = downloads[fmt.key];
          const isWip = fmt.wip;

          return (
            <div
              key={fmt.key}
              className={`group relative rounded-xl border p-4 transition-all ${
                isWip
                  ? 'border-slate-200 bg-slate-50/40 opacity-70'
                  : state === 'done'
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : state === 'error'
                      ? 'border-red-200 bg-red-50/30'
                      : 'border-white/40 bg-white/50 backdrop-blur-sm'
              }`}
            >
              <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_STYLES[fmt.badge]}`}>
                {t(fmt.badgeKey)}
              </span>
              <div className={`font-mono text-base font-semibold ${isWip ? 'text-slate-500' : 'text-ecg-trace'}`}>{fmt.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 pr-12">{t(fmt.descKey)}</div>

              <div className="mt-3">
                {isWip && (
                  <button
                    onClick={() => setShowWip(true)}
                    className="rounded-lg bg-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-500 cursor-not-allowed"
                  >
                    {t('fmt.convert')}
                  </button>
                )}
                {!isWip && state === 'idle' && (
                  <button
                    onClick={() => handleConvert(fmt)}
                    disabled={disabled}
                    className="rounded-lg bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-all hover:bg-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↗ {t('fmt.convert')}
                  </button>
                )}
                {!isWip && state === 'loading' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                    {t('fmt.converting')}
                  </span>
                )}
                {!isWip && state === 'done' && link && (
                  <a
                    href={link.href}
                    download={link.name}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-700"
                  >
                    ↓ {t('fmt.download')}
                  </a>
                )}
                {!isWip && state === 'error' && (
                  <button
                    onClick={() => handleConvert(fmt)}
                    className="rounded-lg bg-red-100 px-3.5 py-1.5 text-xs font-semibold text-red-600 transition-all hover:bg-red-200"
                  >
                    ↻ {t('fmt.error')} — {t('fmt.convert')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showWip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setShowWip(false)}
        >
          <div
            className="glass-card max-w-sm p-6 mx-4"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-slate-700">{t('fmt.wip.title')}</h4>
            <p className="mt-2 text-sm text-slate-500">{t('fmt.wip.body')}</p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowWip(false)}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-primary-dark"
              >
                {t('fmt.wip.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
