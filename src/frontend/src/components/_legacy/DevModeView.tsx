import { useMemo, useRef, useEffect, useState } from 'react';
import type { ECGData, ECGChannel } from '../lib/types';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useLanguage } from '../i18n';
import { pdfjsLib } from '../lib/pdf-config';
import MetadataGrid from './MetadataGrid';
import JsonViewer from './JsonViewer';
import RoundTripCard from './RoundTripCard';
import PdfStrip from './PdfStrip';
import { drawSignalCanvas } from './SignalCanvas';

interface Props {
  ecgData: ECGData;
  file: File;
}

// Load PDF page 1 once, share the page proxy for vector rendering
function usePdfPage(file: File) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const pg = await pdf.getPage(1);
      if (!cancelled) setPage(pg);
    })();
    return () => { cancelled = true; };
  }, [file]);

  return page;
}

// One row: PDF crop on left, extracted signal on right
function LeadComparison({ ch, page, canvasW, canvasH, pxPerMm }: {
  ch: ECGChannel;
  page: PDFPageProxy | null;
  canvasW: number;
  canvasH: number;
  pxPerMm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalDivRef = useRef<HTMLDivElement>(null);
  const [stripH, setStripH] = useState(80);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    drawSignalCanvas(cv, ch.samples, pxPerMm);
  }, [ch.samples, pxPerMm]);

  // Measure actual CSS height of the signal canvas to sync PDF strip height
  useEffect(() => {
    const div = signalDivRef.current;
    if (!div) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setStripH(e.contentRect.height);
    });
    obs.observe(div);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="rounded-xl border border-white/40 bg-white/50 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-white/60">
        <span className="font-mono text-sm font-semibold text-ecg-trace">{ch.name}</span>
        <span className="font-mono text-[11px] text-slate-400">
          {ch.samples.length} pts · {ch.duration_s.toFixed(2)}s · {ch.sample_rate_hz}Hz
        </span>
      </div>
      <div className="grid grid-cols-2 gap-0">
        {/* Left: PDF source crop — rendered as vectors */}
        <div className="border-r border-white/30 bg-white">
          {page && ch.bbox ? (
            <PdfStrip page={page} bbox={ch.bbox} targetHeight={stripH} />
          ) : (
            <div className="flex items-center justify-center text-xs text-slate-400" style={{ height: `${stripH}px` }}>PDF</div>
          )}
        </div>
        {/* Right: Extracted signal — aspect-ratio preserves square grid cells */}
        <div ref={signalDivRef}>
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            className="block w-full"
            style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function DevModeView({ ecgData, file }: Props) {
  const { t } = useLanguage();
  const page = usePdfPage(file);

  const channelStats = useMemo(() =>
    ecgData.channels.map(ch => {
      let min = Infinity, max = -Infinity;
      for (const v of ch.samples) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { name: ch.name, count: ch.samples.length, rate: ch.sample_rate_hz, duration: ch.duration_s, min, max };
    }),
  [ecgData.channels]);

  // Compute uniform px/mm scale from first channel's duration
  const duration = ecgData.channels[0]?.duration_s || 10;
  const pxPerMm = 1400 / (duration * 25);
  const canvasW = 1400;
  const GRID_HALF_MM = 15;
  const canvasH = Math.round(GRID_HALF_MM * 2 * pxPerMm);

  return (
    <div className="mt-5 space-y-5">
      {/* Lead-by-lead comparison: PDF source vs extracted signal */}
      <div className="glass-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-600">{t('dev.pdfSource')} vs {t('dev.extractedSignals')}</h2>
        <div className="mb-3 flex gap-4 text-[10px] uppercase tracking-wider text-slate-400">
          <span className="flex-1 text-center">PDF source</span>
          <span className="flex-1 text-center">Signal extrait</span>
        </div>
        <div className="flex flex-col gap-2">
          {ecgData.channels.map(ch => (
            <LeadComparison
              key={ch.name}
              ch={ch}
              page={page}
              canvasW={canvasW}
              canvasH={canvasH}
              pxPerMm={pxPerMm}
            />
          ))}
        </div>
      </div>

      {/* Round-trip verification */}
      <RoundTripCard ecgData={ecgData} page={page} />

      {/* Extraction details */}
      <div className="glass-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-600">{t('dev.details')}</h2>
        <MetadataGrid data={ecgData} />

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{t('dev.pageDimensions')}</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.page_size.width.toFixed(0)} x {ecgData.page_size.height.toFixed(0)} pts</div>
          </div>
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">pts/mm</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.scale.pts_per_mm.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">mm/s</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.scale.mm_per_s}</div>
          </div>
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">mm/mV</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.scale.mm_per_mV}</div>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-500">{t('dev.channelDetails')}</h3>
          <div className="overflow-x-auto rounded-lg border border-white/40">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/60 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">{t('dev.samples')}</th>
                  <th className="px-3 py-2">Hz</th>
                  <th className="px-3 py-2">Duration (s)</th>
                  <th className="px-3 py-2">Min (mV)</th>
                  <th className="px-3 py-2">Max (mV)</th>
                </tr>
              </thead>
              <tbody>
                {channelStats.map(ch => (
                  <tr key={ch.name} className="border-t border-white/30 font-mono text-slate-600">
                    <td className="px-3 py-1.5 font-semibold text-ecg-trace">{ch.name}</td>
                    <td className="px-3 py-1.5">{ch.count}</td>
                    <td className="px-3 py-1.5">{ch.rate}</td>
                    <td className="px-3 py-1.5">{ch.duration.toFixed(2)}</td>
                    <td className="px-3 py-1.5">{ch.min.toFixed(3)}</td>
                    <td className="px-3 py-1.5">{ch.max.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <JsonViewer data={ecgData} />
      </div>
    </div>
  );
}
