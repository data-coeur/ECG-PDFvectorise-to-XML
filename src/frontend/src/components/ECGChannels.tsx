import { useRef, useEffect } from 'react';
import type { ECGChannel } from '../lib/types';

// Standard ECG paper: 25mm/s, 10mm/mV
const MM_PER_S = 25;
const MM_PER_MV = 10;

function drawSignal(cv: HTMLCanvasElement, samples: number[], pxPerMm: number, topMm: number, bottomMm: number) {
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  const pxPerMv = pxPerMm * MM_PER_MV;

  // Baseline position: topMm from top edge, bottomMm below
  const baseY = topMm * pxPerMm;

  // Clinical paper background
  ctx.fillStyle = '#fff5f5';
  ctx.fillRect(0, 0, w, h);

  // Minor grid: 1mm squares
  const minor = pxPerMm;
  ctx.strokeStyle = '#fce4ec';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += minor) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += minor) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Major grid: 5mm squares
  const major = pxPerMm * 5;
  ctx.strokeStyle = '#f8bbd0';
  ctx.lineWidth = 0.8;
  for (let x = 0; x < w; x += major) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += major) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (samples.length < 2) return;

  // Baseline
  ctx.strokeStyle = 'rgba(8,145,178,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();

  // ECG trace — samples are in mV relative to grid baseline (0mV)
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

function ChannelCard({ ch, pxPerMm, canvasH, topMm, bottomMm }: {
  ch: ECGChannel; pxPerMm: number; canvasH: number; topMm: number; bottomMm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawSignal(canvasRef.current, ch.samples, pxPerMm, topMm, bottomMm);
  }, [ch.samples, pxPerMm, topMm, bottomMm]);

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
  // Compute uniform px/mm scale from the first channel's duration
  const duration = channels[0]?.duration_s || 10;
  const pxPerMm = 1400 / (duration * MM_PER_S);
  const mmPerMv = MM_PER_MV;

  // Compute global max above / below 0mV baseline across all channels
  let globalMaxMv = 0, globalMinMv = 0;
  for (const ch of channels) {
    if (ch.samples.length < 2) continue;
    for (const v of ch.samples) {
      if (v > globalMaxMv) globalMaxMv = v;
      if (v < globalMinMv) globalMinMv = v;
    }
  }

  // Round up to next 5mm grid line (0.5mV) with a small margin
  const topMm = Math.max(5, Math.ceil((globalMaxMv * mmPerMv + 2) / 5) * 5);
  const bottomMm = Math.max(5, Math.ceil((Math.abs(globalMinMv) * mmPerMv + 2) / 5) * 5);
  const canvasH = Math.round((topMm + bottomMm) * pxPerMm);

  return (
    <div className="flex flex-col gap-2">
      {channels.map(ch => (
        <ChannelCard key={ch.name} ch={ch} pxPerMm={pxPerMm} canvasH={canvasH} topMm={topMm} bottomMm={bottomMm} />
      ))}
    </div>
  );
}
