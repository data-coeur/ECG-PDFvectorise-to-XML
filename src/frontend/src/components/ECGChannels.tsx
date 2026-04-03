import { useRef, useEffect } from 'react';
import type { ECGChannel } from '../lib/types';

// Standard ECG paper: 25mm/s, 10mm/mV
const MM_PER_S = 25;
const MM_PER_MV = 10;

// Each lead gets a fixed grid region matching standard ECG paper layout.
// The baseline (0mV) sits at a fixed position, and the signal is drawn
// at its ABSOLUTE mV position — no centering, no auto-scaling.
const GRID_HALF_MM = 15; // 15mm above and below baseline = ±1.5mV visible range

function drawSignal(cv: HTMLCanvasElement, samples: number[], pxPerMm: number) {
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  const pxPerMv = pxPerMm * MM_PER_MV;

  // Baseline always at center of canvas
  const baseY = h / 2;

  // Clinical paper background
  ctx.fillStyle = '#fff5f5';
  ctx.fillRect(0, 0, w, h);

  // Minor grid: 1mm squares, anchored to baseline
  const minor = pxPerMm;
  ctx.strokeStyle = '#fce4ec';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += minor) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  // Draw from baseline up and down so grid lines align perfectly with mV values
  for (let y = baseY; y >= 0; y -= minor) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let y = baseY + minor; y < h; y += minor) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Major grid: 5mm squares (= 0.5mV), also anchored to baseline
  const major = pxPerMm * 5;
  ctx.strokeStyle = '#f8bbd0';
  ctx.lineWidth = 0.8;
  for (let x = 0; x < w; x += major) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = baseY; y >= 0; y -= major) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let y = baseY + major; y < h; y += major) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (samples.length < 2) return;

  // Baseline indicator
  ctx.strokeStyle = 'rgba(8,145,178,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();

  // ECG trace at absolute mV positions
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = i / (samples.length - 1) * w;
    const y = baseY - samples[i] * pxPerMv;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();

  // 1mV calibration bar (bottom-right corner)
  const barX = w - 12;
  const barH = pxPerMv;
  const barTop = h - 10 - barH;
  if (barTop > 10) {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barX, barTop + barH); ctx.lineTo(barX, barTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(barX - 3, barTop); ctx.lineTo(barX + 3, barTop);
    ctx.moveTo(barX - 3, barTop + barH); ctx.lineTo(barX + 3, barTop + barH);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('1mV', barX - 5, barTop + barH / 2 + 3);
  }
}

function ChannelCard({ ch, pxPerMm, canvasH }: { ch: ECGChannel; pxPerMm: number; canvasH: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawSignal(canvasRef.current, ch.samples, pxPerMm);
  }, [ch.samples, pxPerMm]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/40 bg-white/50 backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-white/60">
        <span className="font-mono text-sm font-semibold text-ecg-trace">{ch.name}</span>
        <span className="font-mono text-[11px] text-slate-400">
          {ch.samples.length} pts · {ch.duration_s.toFixed(2)}s · {ch.sample_rate_hz}Hz
        </span>
      </div>
      <canvas ref={canvasRef} width={1400} height={canvasH} className="block w-full" style={{ aspectRatio: `${1400} / ${canvasH}` }} />
    </div>
  );
}

interface Props { channels: ECGChannel[] }

export default function ECGChannels({ channels }: Props) {
  const duration = channels[0]?.duration_s || 10;
  const pxPerMm = 1400 / (duration * MM_PER_S);
  // Fixed grid height: same for all leads, matching original PDF layout
  const canvasH = Math.round(GRID_HALF_MM * 2 * pxPerMm);

  return (
    <div className="flex flex-col gap-2">
      {channels.map(ch => (
        <ChannelCard key={ch.name} ch={ch} pxPerMm={pxPerMm} canvasH={canvasH} />
      ))}
    </div>
  );
}
