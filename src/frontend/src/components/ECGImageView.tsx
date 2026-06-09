// ECGImageView — panneau côte-à-côte qui affiche l'image ECG rendue par
// raw2paper et, optionnellement, le PDF original. Héberge le sélecteur de
// layout (3×4, 6×2, 12×1) et déclenche /api/ecg/render-image quand on switche
// d'item dans le batch. Cache module-level pour éviter les re-fetches.
// Props : { data, cacheKey?, pdfFile? }. Monté par App.tsx après extraction réussie.

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ECGData } from '../lib/types';
import { pdfjsLib } from '../lib/pdf-config';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface Props {
  data: ECGData;
  cacheKey?: string;
  pdfFile?: File | null;
}

// Backend format codes — must match Python LAYOUT_TEMPLATES keys
type LayoutCode = '3×4' | '3×4+1' | '6×2' | '6×2+1' | '12×1';

// Map display codes (×) to backend codes (x)
const toBackend = (l: LayoutCode) => l.replace(/×/g, 'x');

const ALL_LAYOUTS: readonly LayoutCode[] = ['3×4', '3×4+1', '6×2', '6×2+1', '12×1'] as const;

// Minimum source duration (seconds) to reach this layout (truncation OK, repetition NOT OK)
const LAYOUT_MIN_DURATION: Record<LayoutCode, number> = {
  '3×4':   0,
  '3×4+1': 0,
  '6×2':   4,
  '6×2+1': 4,
  '12×1':  8,
};

// Canonical target duration sent to backend when truncating
const LAYOUT_CANONICAL: Record<LayoutCode, number> = {
  '3×4':   2.5,
  '3×4+1': 2.5,
  '6×2':   5,
  '6×2+1': 5,
  '12×1':  10,
};

// Duration ranges — what Python picks natively for a given duration
function predictNativeLayout(durationS: number): LayoutCode {
  if (durationS <= 4) return '3×4+1';
  if (durationS <= 8) return '6×2+1';
  return '12×1';
}

function targetForLayout(layout: LayoutCode, sourceDuration: number): number {
  // If source falls in this layout's canonical range, no transform needed
  const native = predictNativeLayout(sourceDuration);
  const nativeBase = native.replace('+1', '') as string;
  const layoutBase = (layout as string).replace('+1', '');
  if (nativeBase === layoutBase) return sourceDuration;
  return LAYOUT_CANONICAL[layout];
}

type UnavailableReason = 'duration' | 'rhythm';

function layoutAvailability(l: LayoutCode, sourceDuration: number, hasNativeRhythm: boolean): UnavailableReason | null {
  // Duration check: the base format (ignoring +1) must be reachable
  const baseLayout = l.replace('+1', '') as LayoutCode;
  const minDur = LAYOUT_MIN_DURATION[baseLayout] ?? LAYOUT_MIN_DURATION[l];
  if (sourceDuration <= minDur) return 'duration';
  // +1 formats need a rhythm strip (lead II). Available if:
  // (a) the PDF had a native rhythm strip, OR
  // (b) lead II is long enough — any source that passes the base duration
  //     check has lead II at sourceDuration, which is always usable as rhythm.
  //     For short sources (e.g. 2.5s 3×4), lead II is too short for a
  //     meaningful rhythm strip → block unless native rhythm exists.
  // +1 needs a rhythm strip. Without a native one, only 12×1 sources (>8s)
  // have lead II long enough to fill the rhythm row without repetition.
  if (l.includes('+1') && !hasNativeRhythm && sourceDuration <= 8) return 'rhythm';
  return null;
}

// ── Module-level image cache ────────────────────────────────────────────
const imageCache = new Map<string, string>();

export function clearImageCache() {
  for (const url of imageCache.values()) URL.revokeObjectURL(url);
  imageCache.clear();
}

// Render page 1 of a PDF onto a <canvas> via pdfjs. `scaleFor` receives the
// page's base (scale-1) viewport and returns the render scale, so callers
// control sizing (inline = container width, lightbox = viewport height). The
// backing store is sized to the rendered viewport; callers set canvas CSS size.
// Returns a cleanup that cancels the in-flight render and frees the document —
// avoids concurrent renders when the active ECG changes or the lightbox closes.
function renderPdfPage(
  pdfFile: File,
  canvas: HTMLCanvasElement,
  scaleFor: (base: { width: number; height: number }) => number,
  onSettled?: () => void,
  extraRotation: 0 | 90 | 180 | 270 = 0,
): () => void {
  let cancelled = false;
  let pdf: PDFDocumentProxy | null = null;
  let renderTask: RenderTask | null = null;
  (async () => {
    try {
      const data = await pdfFile.arrayBuffer();
      if (cancelled) return;
      pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      if (cancelled) return;
      // Match the extractor's rectification: add its clockwise rotation on top
      // of the page's own /Rotate so the displayed PDF shares the rendered
      // image's orientation.
      const rotation = (page.rotate + extraRotation) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: scaleFor(base), rotation });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderTask = page.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
    } catch {
      // RenderingCancelledException is expected on rapid switches — ignore.
    } finally {
      if (!cancelled) onSettled?.();
    }
  })();
  return () => {
    cancelled = true;
    try { renderTask?.cancel(); } catch { /* noop */ }
    try { pdf?.destroy(); } catch { /* noop */ }
  };
}

export function preloadImage(cacheKey: string, data: ECGData) {
  const sourceDuration = data.channels[0]?.duration_s ?? 0;
  const native = predictNativeLayout(sourceDuration);
  const layout = native.includes('+1') && layoutAvailability(native, sourceDuration, data.hasNativeRhythm) !== null
    ? native.replace('+1', '') as LayoutCode
    : native;
  const target = sourceDuration;
  const fmt = toBackend(layout);
  const id = `${cacheKey}_${fmt}_${target}`;
  if (imageCache.has(id)) return;
  fetch(`/api/ecg/render-image?target=${target}&format=${fmt}`, {
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
    .catch(() => {});
}

// ── Component ───────────────────────────────────────────────────────────
export default function ECGImageView({ data, cacheKey, pdfFile }: Props) {
  const { t, lang } = useLanguage();

  const sourceDuration = data.channels[0]?.duration_s ?? 0;
  const hasRhythm = data.hasNativeRhythm;

  // Pick the best default layout. For 12×1 sources (>8s), default to 12×1
  // (their native format). For shorter sources with native rhythm → +1.
  const native = predictNativeLayout(sourceDuration);
  const defaultLayout: LayoutCode =
    native.includes('+1') && layoutAvailability(native, sourceDuration, hasRhythm) !== null
      ? native.replace('+1', '') as LayoutCode
      : native;

  const [selectedLayout, setSelectedLayout] = useState<LayoutCode>(defaultLayout);
  const [showUnavailable, setShowUnavailable] = useState<UnavailableReason | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Lightbox shown fullscreen over a dimmed backdrop, null = closed. 'both'
  // displays the rendered image and the original PDF side-by-side for comparison.
  const [zoom, setZoom] = useState<null | 'image' | 'pdf' | 'both'>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // When the active ECG changes (batch switch), reset the layout selector to
  // the new ECG's native layout. Without this, a format that was valid for the
  // previous ECG (e.g. 3×4+1) stays selected even when the new ECG can't
  // support it — the button ends up greyed out but the render still uses it.
  useEffect(() => {
    setSelectedLayout(defaultLayout);
  }, [cacheKey, defaultLayout]);

  // Render page 1 of the original PDF straight onto a <canvas> via pdfjs, instead
  // of handing the file to the browser's built-in PDF viewer (iframe). This gives
  // a clean white render matching the extracted-image panel, with no toolbar/grey
  // chrome. Re-runs whenever `showPdf` toggles on or the active ECG changes.
  useEffect(() => {
    if (!showPdf || !pdfFile) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setPdfLoading(true);
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = canvas.parentElement?.clientWidth || 0;
    canvas.style.width = '100%';
    // Backing store at container width × dpr for a crisp render; CSS keeps it responsive.
    return renderPdfPage(
      pdfFile, canvas,
      base => ((containerWidth || base.width) * dpr) / base.width,
      () => setPdfLoading(false),
      data.rotation ?? 0,
    );
  }, [showPdf, pdfFile, cacheKey, data.rotation]);

  // Lightbox PDF: render page 1 large, fitted to ~90% of the viewport height.
  // In 'both' mode it shares the width with the image, so cap it to ~46vw.
  useEffect(() => {
    if ((zoom !== 'pdf' && zoom !== 'both') || !pdfFile) return;
    const canvas = zoomCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = '88vh';
    canvas.style.width = 'auto';
    canvas.style.maxWidth = zoom === 'both' ? '46vw' : '95vw';
    return renderPdfPage(
      pdfFile, canvas,
      base => (window.innerHeight * 0.88 * dpr) / base.height,
      undefined,
      data.rotation ?? 0,
    );
  }, [zoom, pdfFile, data.rotation]);

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const target = targetForLayout(selectedLayout, sourceDuration);
  const fmt = toBackend(selectedLayout);
  const isTruncated = target < sourceDuration - 1e-3;

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const imgCacheId = `${cacheKey ?? data.filename}_${fmt}_${target}`;

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

    // For +1 formats without a native rhythm strip: inject a synthetic
    // II_rhythm channel from the full-length lead II so the backend preserves
    // it at full duration while truncating the standard leads to `target`.
    let payload = data;
    if (selectedLayout.includes('+1') && !hasRhythm) {
      const leadII = data.channels.find(c => c.name === 'II');
      if (leadII && !data.channels.some(c => c.name === 'II_rhythm')) {
        payload = {
          ...data,
          channels: [...data.channels, { ...leadII, name: 'II_rhythm' }],
        };
      }
    }

    fetch(`/api/ecg/render-image?target=${target}&format=${fmt}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  }, [imgCacheId, data, target, fmt]);

  const fmtDuration = (s: number) => {
    const snapped = Math.round(s * 2) / 2;
    const str = Number.isInteger(snapped) ? String(snapped) : snapped.toFixed(1);
    return lang === 'fr' ? str.replace('.', ',') : str;
  };

  return (
    <div className="space-y-3">
      {/* Layout selector */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="inline-flex flex-wrap rounded-xl border border-white/40 bg-white/60 p-1 backdrop-blur-sm gap-0.5">
            {ALL_LAYOUTS.map(l => {
              const reason = layoutAvailability(l, sourceDuration, hasRhythm);
              const available = reason === null;
              const active = selectedLayout === l && !showPdf;
              return (
                <button
                  key={l}
                  onClick={() => { if (available) { setSelectedLayout(l); setShowPdf(false); } else setShowUnavailable(reason); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    !available
                      ? 'cursor-not-allowed text-slate-300'
                      : active
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-slate-500 hover:text-primary'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
          {pdfFile && (
            <button
              onClick={() => setShowPdf(p => !p)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                showPdf
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-white/40 bg-white/60 text-slate-500 hover:text-primary'
              }`}
            >
              PDF
            </button>
          )}
        </div>
        {isTruncated && (
          <p className="text-[11px] italic text-slate-400">
            {t('image.transform.truncated' as TranslationKey, {
              src: fmtDuration(sourceDuration),
              tgt: fmtDuration(target),
              layout: selectedLayout,
            })}
          </p>
        )}
      </div>

      {/* Image / loading / error + optional PDF side-by-side */}
      <div className={showPdf && pdfFile ? 'grid grid-cols-2 items-center gap-3' : ''}>
        {/* Rendered image */}
        <div>
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
            <button
              type="button"
              onClick={() => setZoom(showPdf && pdfFile ? 'both' : 'image')}
              title={t('image.zoom' as TranslationKey)}
              className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/40 bg-white transition-shadow hover:shadow-lg"
            >
              <img src={imgUrl} alt="ECG" className="block w-full" />
            </button>
          )}
        </div>

        {/* PDF original — rendered to canvas side-by-side when toggled */}
        {showPdf && pdfFile && (
          <button
            type="button"
            onClick={() => setZoom('both')}
            title={t('image.zoom' as TranslationKey)}
            className="relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/40 bg-white transition-shadow hover:shadow-lg"
          >
            {pdfLoading && (
              <div className="absolute inset-0 flex items-center justify-center gap-3 bg-white/50 backdrop-blur-sm">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                <span className="text-sm text-slate-500">{t('image.rendering' as TranslationKey)}</span>
              </div>
            )}
            <canvas ref={canvasRef} className="block w-full" />
          </button>
        )}
      </div>

      {/* Unavailable layout popup */}
      {showUnavailable && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-md"
          onClick={() => setShowUnavailable(null)}
        >
          <div className="glass-card w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {t('image.unavailable.title' as TranslationKey)}
            </h3>
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              {showUnavailable === 'duration'
                ? t('image.unavailable.duration' as TranslationKey, {
                    duration: fmtDuration(sourceDuration),
                    layout: defaultLayout,
                  })
                : t('image.unavailable.rhythm' as TranslationKey)
              }
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowUnavailable(null)}
                className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-300"
              >
                {t('unsupported.close' as TranslationKey)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Lightbox — enlarged image / PDF in the foreground over a dimmed,
          blurred backdrop. Click anywhere outside (or ✕ / Escape) to close. */}
      {zoom && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md"
          onClick={() => setZoom(null)}
        >
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-label={t('unsupported.close' as TranslationKey)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-xl text-slate-600 shadow-lg transition-all hover:bg-white"
          >
            ✕
          </button>
          <div className="relative flex items-center justify-center gap-4" onClick={e => e.stopPropagation()}>
            {(zoom === 'image' || zoom === 'both') && imgUrl && (
              <figure className="flex flex-col items-center gap-2">
                {zoom === 'both' && (
                  <figcaption className="text-xs font-semibold text-white/90">
                    {t('image.zoom.generated' as TranslationKey)}
                  </figcaption>
                )}
                <img
                  src={imgUrl}
                  alt="ECG"
                  className={`rounded-lg bg-white object-contain shadow-2xl ${
                    zoom === 'both' ? 'max-h-[88vh] max-w-[46vw]' : 'max-h-[92vh] max-w-[95vw]'
                  }`}
                />
              </figure>
            )}
            {(zoom === 'pdf' || zoom === 'both') && (
              <figure className="flex flex-col items-center gap-2">
                {zoom === 'both' && (
                  <figcaption className="text-xs font-semibold text-white/90">
                    {t('image.zoom.original' as TranslationKey)}
                  </figcaption>
                )}
                <canvas ref={zoomCanvasRef} className="rounded-lg bg-white shadow-2xl" />
              </figure>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
