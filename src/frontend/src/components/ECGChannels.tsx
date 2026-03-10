import { useRef, useEffect } from 'react';
import type { ECGChannel } from '../lib/types';

function drawSignal(cv: HTMLCanvasElement, samples: number[]) {
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;

  // Clinical paper background
  ctx.fillStyle = '#fff5f5';
  ctx.fillRect(0, 0, w, h);

  // Minor grid (light pink)
  ctx.strokeStyle = '#fce4ec';
  ctx.lineWidth = 0.5;
  const gridStep = w / 70;
  for (let x = 0; x < w; x += gridStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += gridStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Major grid (darker pink)
  ctx.strokeStyle = '#f8bbd0';
  ctx.lineWidth = 0.8;
  const majorStep = gridStep * 5;
  for (let x = 0; x < w; x += majorStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += majorStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (samples.length < 2) return;

  // Center baseline
  ctx.strokeStyle = 'rgba(8,145,178,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  let mn = 1e9, mx = -1e9;
  for (const v of samples) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const r = Math.max(mx - mn, 0.05), m = (mx + mn) / 2, sc = h * 0.85 / r;

  // ECG trace (medical green)
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = i / (samples.length - 1) * w, y = h / 2 - (samples[i] - m) * sc;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function ChannelCard({ ch }: { ch: ECGChannel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawSignal(canvasRef.current, ch.samples);
  }, [ch.samples]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/40 bg-white/50 backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-white/60">
        <span className="font-mono text-sm font-semibold text-ecg-trace">{ch.name}</span>
        <span className="font-mono text-[11px] text-slate-400">
          {ch.samples.length} pts · {ch.duration_s.toFixed(2)}s · {ch.sample_rate_hz}Hz
        </span>
      </div>
      <canvas ref={canvasRef} width={1400} height={70} className="block w-full h-[70px]" />
    </div>
  );
}

interface Props { channels: ECGChannel[] }

export default function ECGChannels({ channels }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {channels.map(ch => <ChannelCard key={ch.name} ch={ch} />)}
    </div>
  );
}
