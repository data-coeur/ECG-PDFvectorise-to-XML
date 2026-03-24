import { useState, useCallback, useRef, useEffect } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { ECGData, ECGChannel } from '../lib/types';

type FmtDef = {
  key: string;
  apiFormat: string;
  label: string;
  enabled: boolean;
  mode: 'ecg' | 'image';
};

const FORMATS: FmtDef[] = [
  { key: 'hl7aecg', apiFormat: 'hl7aecg', label: 'HL7 aECG', enabled: true, mode: 'ecg' },
  { key: 'edf', apiFormat: 'edf', label: 'EDF+', enabled: false, mode: 'ecg' },
  { key: 'wfdb', apiFormat: 'wfdb', label: 'WFDB', enabled: false, mode: 'ecg' },
  { key: 'dicom', apiFormat: 'dicom', label: 'DICOM', enabled: false, mode: 'ecg' },
  { key: 'hdf5', apiFormat: 'hdf5', label: 'HDF5', enabled: false, mode: 'ecg' },
  { key: 'webp', apiFormat: 'webp', label: 'WebP 4K', enabled: true, mode: 'image' },
];

const MM_PER_MV = 10;

type State = 'idle' | 'converting' | 'reading' | 'done' | 'error';

interface Props {
  ecgData: ECGData;
  page: PDFPageProxy | null;
}

// Render a cropped region of the PDF page for a given lead
function PdfStrip({ page, bbox, targetHeight }: {
  page: PDFPageProxy;
  bbox: { x0: number; x1: number; y0: number; y1: number };
  targetHeight: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const container = containerRef.current;
    if (!cv || !container || !page) return;
    let cancelled = false;
    (async () => {
      const baseVp = page.getViewport({ scale: 1 });
      const traceH = bbox.y1 - bbox.y0;
      const traceW = bbox.x1 - bbox.x0;
      const marginY = traceH * 0.4;
      const marginX = traceW * 0.03;
      const cropY0 = Math.max(0, bbox.y0 - marginY);
      const cropY1 = Math.min(baseVp.height, bbox.y1 + marginY);
      const cropX0 = Math.max(0, bbox.x0 - marginX);
      const cropX1 = Math.min(baseVp.width, bbox.x1 + marginX);
      const cropH = cropY1 - cropY0;
      const cropW = cropX1 - cropX0;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = container.clientWidth;
      const renderScale = Math.max((cssWidth * dpr) / cropW, (targetHeight * dpr) / cropH);
      const vp = page.getViewport({ scale: renderScale, offsetX: -cropX0 * renderScale, offsetY: -cropY0 * renderScale });
      cv.width = Math.round(cropW * renderScale);
      cv.height = Math.round(cropH * renderScale);
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [page, bbox, targetHeight]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} className="w-full rounded-lg border border-white/40" style={{ height: `${targetHeight}px` }} />
    </div>
  );
}

// Draw ECG signal on canvas
function drawSignalCanvas(cv: HTMLCanvasElement, samples: number[], pxPerMm: number, topMm: number, bottomMm: number) {
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  const pxPerMv = pxPerMm * MM_PER_MV;
  const baseY = topMm * pxPerMm;

  ctx.fillStyle = '#fff5f5';
  ctx.fillRect(0, 0, w, h);

  const minor = pxPerMm;
  ctx.strokeStyle = '#fce4ec';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += minor) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += minor) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const major = pxPerMm * 5;
  ctx.strokeStyle = '#f8bbd0';
  ctx.lineWidth = 0.8;
  for (let x = 0; x < w; x += major) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += major) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  if (samples.length < 2) return;

  ctx.strokeStyle = 'rgba(8,145,178,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();

  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = i / (samples.length - 1) * w;
    const y = baseY - samples[i] * pxPerMv;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

// One lead row: PDF crop left | readback signal right
function LeadRow({ origCh, readCh, page, canvasW, canvasH, pxPerMm, topMm, bottomMm }: {
  origCh: ECGChannel;
  readCh: ECGChannel | undefined;
  page: PDFPageProxy | null;
  canvasW: number;
  canvasH: number;
  pxPerMm: number;
  topMm: number;
  bottomMm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalDivRef = useRef<HTMLDivElement>(null);
  const [stripH, setStripH] = useState(80);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !readCh) return;
    drawSignalCanvas(cv, readCh.samples, pxPerMm, topMm, bottomMm);
  }, [readCh, pxPerMm, topMm, bottomMm]);

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
        <span className="font-mono text-sm font-semibold text-ecg-trace">{origCh.name}</span>
        {readCh && (
          <span className="font-mono text-[11px] text-slate-400">
            {readCh.samples.length} pts · {readCh.duration_s.toFixed(2)}s · {readCh.sample_rate_hz}Hz
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-0">
        <div className="border-r border-white/30 bg-white">
          {page && origCh.bbox ? (
            <PdfStrip page={page} bbox={origCh.bbox} targetHeight={stripH} />
          ) : (
            <div className="flex items-center justify-center text-xs text-slate-400" style={{ height: `${stripH}px` }}>PDF</div>
          )}
        </div>
        <div ref={signalDivRef}>
          {readCh ? (
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              className="block w-full"
              style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
            />
          ) : (
            <div className="flex items-center justify-center text-xs text-slate-300" style={{ aspectRatio: `${canvasW} / ${canvasH}` }}>—</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RoundTripCard({ ecgData, page }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [readChannels, setReadChannels] = useState<ECGChannel[] | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleTest = useCallback(async (fmt: FmtDef) => {
    setSelected(fmt.key);
    setState('converting');
    setError('');
    setReadChannels(null);
    setImageUrl(null);

    try {
      const convRes = await fetch(`/api/ecg/convert/${fmt.apiFormat}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecgData),
      });
      if (!convRes.ok) throw new Error(`Conversion failed: ${convRes.status}`);
      const convData = await convRes.json();
      if (!convData.success) throw new Error(convData.error || 'Conversion error');

      const files = convData.files as Record<string, string>;
      const firstFile = Object.values(files)[0];
      if (!firstFile) throw new Error('No output file');
      const fileUrl = `/api/ecg/data/${firstFile}`;

      if (fmt.mode === 'image') {
        setImageUrl(fileUrl);
        setState('done');
        return;
      }

      setState('reading');

      if (fmt.key === 'hl7aecg') {
        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
        const xmlBytes = await fileRes.arrayBuffer();

        const parseRes = await fetch('/api/ecg/parse-xml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': firstFile },
          body: xmlBytes,
        });
        if (!parseRes.ok) throw new Error(`Parse failed: ${parseRes.status}`);
        const parsed = await parseRes.json();
        if (parsed.error) throw new Error(parsed.error);

        setReadChannels(parsed.channels || []);
      }

      setState('done');
    } catch (e) {
      setState('error');
      setError((e as Error).message);
    }
  }, [ecgData]);

  // Compute uniform scale for readback signals (same logic as ECGChannels)
  const duration = ecgData.channels[0]?.duration_s || 10;
  const pxPerMm = 1400 / (duration * 25);

  let globalMaxMv = 0, globalMinMv = 0;
  const allChannels = readChannels || ecgData.channels;
  for (const ch of allChannels) {
    if (ch.samples.length < 2) continue;
    for (const v of ch.samples) {
      if (v > globalMaxMv) globalMaxMv = v;
      if (v < globalMinMv) globalMinMv = v;
    }
  }

  const topMm = Math.max(5, Math.ceil((globalMaxMv * MM_PER_MV + 2) / 5) * 5);
  const bottomMm = Math.max(5, Math.ceil((Math.abs(globalMinMv) * MM_PER_MV + 2) / 5) * 5);
  const canvasH = Math.round((topMm + bottomMm) * pxPerMm);
  const canvasW = 1400;

  const activeFmt = FORMATS.find(f => f.key === selected);

  return (
    <div className="glass-card p-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-600">Round-trip verification</h3>
      <p className="mb-4 text-xs text-slate-400">
        Convertir le signal puis relire le fichier produit — comparaison avec le PDF source
      </p>

      {/* Format buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FORMATS.map(fmt => {
          const isActive = selected === fmt.key;
          const isRunning = isActive && (state === 'converting' || state === 'reading');
          return (
            <button
              key={fmt.key}
              onClick={() => fmt.enabled && handleTest(fmt)}
              disabled={!fmt.enabled || (state === 'converting' || state === 'reading')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                !fmt.enabled
                  ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                  : isActive && state === 'done'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : isActive && state === 'error'
                      ? 'border-red-300 bg-red-50 text-red-600'
                      : isRunning
                        ? 'border-primary/30 bg-primary/5 text-primary'
                        : 'border-slate-200 bg-white/60 text-slate-600 hover:border-primary/40 hover:text-primary'
              }`}
            >
              {isRunning && (
                <span className="inline-block h-3 w-3 mr-1.5 animate-spin rounded-full border-2 border-slate-300 border-t-primary align-middle" />
              )}
              {fmt.label}
              {!fmt.enabled && <span className="ml-1 text-[10px] text-slate-300">(bientôt)</span>}
            </button>
          );
        })}
      </div>

      {/* Status */}
      {state === 'converting' && <div className="text-xs text-slate-500 mb-3">Conversion en cours...</div>}
      {state === 'reading' && <div className="text-xs text-slate-500 mb-3">Relecture du fichier converti...</div>}
      {state === 'error' && <div className="text-xs text-red-500 mb-3">Erreur : {error}</div>}

      {/* Result: Lead-by-lead comparison PDF source vs readback signal */}
      {state === 'done' && readChannels && readChannels.length > 0 && (
        <div>
          <div className="mb-3 flex gap-4 text-[10px] uppercase tracking-wider text-slate-400">
            <span className="flex-1 text-center">PDF source</span>
            <span className="flex-1 text-center">Signal relu ({activeFmt?.label})</span>
          </div>
          <div className="flex flex-col gap-2">
            {ecgData.channels.map(origCh => {
              const readCh = readChannels.find(rc => rc.name === origCh.name);
              return (
                <LeadRow
                  key={origCh.name}
                  origCh={origCh}
                  readCh={readCh}
                  page={page}
                  canvasW={canvasW}
                  canvasH={canvasH}
                  pxPerMm={pxPerMm}
                  topMm={topMm}
                  bottomMm={bottomMm}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Result: WebP image */}
      {state === 'done' && imageUrl && (
        <div>
          <div className="mb-3 text-xs font-semibold text-emerald-600">Image générée ({activeFmt?.label})</div>
          <img src={imageUrl} alt="ECG WebP" className="w-full rounded-lg border border-white/40" />
        </div>
      )}

      {/* Empty state */}
      {state === 'idle' && (
        <div className="text-xs text-slate-400 italic">Sélectionnez un format pour lancer le test round-trip</div>
      )}
    </div>
  );
}
