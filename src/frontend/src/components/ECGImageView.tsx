import { useState, useEffect } from 'react';
import type { ECGData } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface Props {
  data: ECGData;
  /** Stable identifier for this ECG (e.g. BatchItem.id). Used as image cache key
   *  so switching between batch items doesn't re-render via the backend. */
  cacheKey?: string;
}

type LayoutCode = '3×4+1' | '6×2+1' | '12×1';
const ALL_LAYOUTS: readonly LayoutCode[] = ['3×4+1', '6×2+1', '12×1'] as const;

// Duration ranges (in seconds) consumed by each layout, mirroring
// src/backend/python/ecgmind_raw2paper/pipeline.py:140-146.
// Lower bound exclusive (matches Python's `elif`), upper bound inclusive.
const LAYOUT_RANGE: Record<LayoutCode, [number, number]> = {
  '3×4+1': [0, 4],
  '6×2+1': [4, 8],
  '12×1':  [8, Infinity],
};
// Canonical target duration when the source falls outside the layout's
// native range and must be truncated or extended.
const LAYOUT_CANONICAL: Record<LayoutCode, number> = {
  '3×4+1': 2.5,
  '6×2+1': 5,
  '12×1':  10,
};

// Mirror of pipeline.py — given a duration, which layout will Python pick?
function predictLayout(durationS: number): LayoutCode {
  if (durationS <= 4) return '3×4+1';
  if (durationS <= 8) return '6×2+1';
  return '12×1';
}

// What target duration should we send so the backend produces this layout?
// If the source already lands inside the layout's range, no transformation —
// we send the source duration as-is. Otherwise we use the canonical duration.
function targetForLayout(layout: LayoutCode, sourceDuration: number): number {
  const [lo, hi] = LAYOUT_RANGE[layout];
  if (sourceDuration > lo && sourceDuration <= hi) return sourceDuration;
  return LAYOUT_CANONICAL[layout];
}

// Render the ECG by calling the backend Python pipeline (matplotlib).
// Replaces the custom canvas grid that was prone to baseline / alignment bugs.
// Module-level image cache: cacheKey_target → blob URL.
// Survives component remounts (batch item switches). Entries are lightweight
// (blob URLs are just strings; the browser holds the actual blob data).
const imageCache = new Map<string, string>();

/** Revoke all cached blob URLs and clear the cache. Call on batch reset. */
export function clearImageCache() {
  for (const url of imageCache.values()) URL.revokeObjectURL(url);
  imageCache.clear();
}

/** Fire-and-forget: render a preview image and store it in cache so it's
 *  ready when the user navigates to this item. */
export function preloadImage(cacheKey: string, data: import('../lib/types').ECGData, dpi = 150) {
  const sourceDuration = data.channels[0]?.duration_s ?? 0;
  const layout = predictLayout(sourceDuration);
  const target = targetForLayout(layout, sourceDuration);
  const id = `${cacheKey}_${target}_${dpi}`;
  if (imageCache.has(id)) return;
  fetch(`/api/ecg/render-image?target=${target}&dpi=${dpi}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
    .then(r => r.ok ? r.blob() : null)
    .then(blob => {
      if (blob && !imageCache.has(id)) {
        imageCache.set(id, URL.createObjectURL(blob));
      }
    })
    .catch(() => { /* silent — preview is best-effort */ });
}

export default function ECGImageView({ data, cacheKey }: Props) {
  const { t, lang } = useLanguage();

  const sourceDuration = data.channels[0]?.duration_s ?? 0;
  const nativeLayout = predictLayout(sourceDuration);

  // Default: the layout the source already fits into — no transformation,
  // visually identical to the original PDF rendering.
  const [selectedLayout, setSelectedLayout] = useState<LayoutCode>(nativeLayout);

  const target = targetForLayout(selectedLayout, sourceDuration);
  // Three transformation modes drive the explanatory note under the selector.
  const transform: 'native' | 'extended' | 'truncated' =
    Math.abs(target - sourceDuration) < 1e-3 ? 'native'
    : target > sourceDuration ? 'extended'
    : 'truncated';

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const imgCacheId = `${cacheKey ?? data.filename}_${target}`;

  useEffect(() => {
    const cached = imageCache.get(imgCacheId);
    if (cached) {
      setImgUrl(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setImgUrl(null);

    fetch(`/api/ecg/render-image?target=${target}`, {
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
        const url = URL.createObjectURL(blob);
        imageCache.set(imgCacheId, url);
        setImgUrl(url);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [imgCacheId, data, target]);

  // Snap to the nearest 0.5 s — ECG segment durations are nominally 2.5 / 5 / 10 s,
  // but the computed value drifts slightly (e.g. 1280 samples / 500 Hz = 2.56 s).
  // Drop the trailing ".0" when the snapped value is integer.
  const fmtDuration = (s: number) => {
    const snapped = Math.round(s * 2) / 2;
    const str = Number.isInteger(snapped) ? String(snapped) : snapped.toFixed(1);
    return lang === 'fr' ? str.replace('.', ',') : str;
  };

  return (
    <div className="space-y-3">
      {/* Layout selector — all 3 standard ECG page formats are always reachable:
          shorter targets truncate the signal, longer targets repeat it. */}
      <div className="space-y-1.5">
        <div className="inline-flex rounded-xl border border-white/40 bg-white/60 p-1 backdrop-blur-sm">
          {ALL_LAYOUTS.map(l => {
            const active = selectedLayout === l;
            return (
              <button
                key={l}
                onClick={() => setSelectedLayout(l)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-500 hover:text-primary'
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
        {transform === 'extended' && (
          <p className="text-[11px] italic text-slate-400">
            {t('image.transform.extended' as TranslationKey, {
              src: fmtDuration(sourceDuration),
              tgt: fmtDuration(target),
              layout: selectedLayout,
            })}
          </p>
        )}
        {transform === 'truncated' && (
          <p className="text-[11px] italic text-slate-400">
            {t('image.transform.truncated' as TranslationKey, {
              src: fmtDuration(sourceDuration),
              tgt: fmtDuration(target),
              layout: selectedLayout,
            })}
          </p>
        )}
      </div>

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
