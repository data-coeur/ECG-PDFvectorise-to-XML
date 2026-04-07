import { useState, useEffect } from 'react';
import type { ECGData } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface Props { data: ECGData }

type RenderMode = 'original' | 'doubled';

// Render the ECG by calling the backend Python pipeline (matplotlib).
// Replaces the custom canvas grid that was prone to baseline / alignment bugs.
export default function ECGImageView({ data }: Props) {
  const { t } = useLanguage();
  // Default to "doubled" for short signals (e.g. Mortara at 2.5s) where the cells
  // would otherwise be only half-filled. Long signals (MUSE, Schiller at 5s) keep "original".
  const initialMode: RenderMode = (data.channels[0]?.duration_s ?? 0) < 4 ? 'doubled' : 'original';
  const [mode, setMode] = useState<RenderMode>(initialMode);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    setLoading(true);
    setError(null);
    setImgUrl(null);

    fetch(`/api/ecg/render-image?mode=${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
          throw new Error(err.error || `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then(blob => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setImgUrl(createdUrl);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [data, mode]);

  // Only offer the "doubled" mode for short signals where cells would otherwise be
  // partially empty. A 6x2+1 layout cell expects ~5s of signal at 25mm/s — below 4s
  // the rendering looks tight, above that the page fills correctly.
  const sourceDuration = data.channels[0]?.duration_s ?? 0;
  const showModeSelector = sourceDuration > 0 && sourceDuration < 4;

  return (
    <div className="space-y-3">
      {/* Mode selector — only shown when doubling would help */}
      {showModeSelector && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">
            {t('image.mode.label' as TranslationKey)}:
          </label>
          <select
            value={mode}
            onChange={e => setMode(e.target.value as RenderMode)}
            className="rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-primary/40 focus:border-primary focus:outline-none"
          >
            <option value="original">{t('image.mode.original' as TranslationKey)}</option>
            <option value="doubled">{t('image.mode.doubled' as TranslationKey)}</option>
          </select>
        </div>
      )}

      {/* Image / loading / error */}
      {loading && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-white/40 bg-white/50 p-12 backdrop-blur-sm">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
          <span className="text-sm text-slate-500">{t('image.rendering' as TranslationKey)}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50/40 p-6 text-sm text-red-600">
          {t('image.error' as TranslationKey)}: {error}
        </div>
      )}

      {!loading && !error && imgUrl && (
        <div className="overflow-hidden rounded-xl border border-white/40 bg-white">
          <img src={imgUrl} alt="ECG" className="block w-full" />
        </div>
      )}
    </div>
  );
}
