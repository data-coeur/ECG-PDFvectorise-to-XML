import { useRef, useEffect } from 'react';
import type { ECGChannel } from '../lib/types';

function drawSignal(cv: HTMLCanvasElement, samples: number[]) {
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, w, h);
  if (samples.length < 2) return;

  ctx.strokeStyle = 'rgba(34,211,238,.1)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  let mn = 1e9, mx = -1e9;
  for (const v of samples) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const r = Math.max(mx - mn, 0.05), m = (mx + mn) / 2, sc = h * 0.85 / r;

  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 1.2;
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
    <div className="cc">
      <div className="ch">
        <span className="n">{ch.name}</span>
        <span className="i">{ch.samples.length} pts · {ch.duration_s.toFixed(2)}s · {ch.sample_rate_hz}Hz</span>
      </div>
      <div className="cb">
        <canvas ref={canvasRef} width={1400} height={70} />
      </div>
    </div>
  );
}

interface Props { channels: ECGChannel[] }

export default function ECGChannels({ channels }: Props) {
  return <>{channels.map(ch => <ChannelCard key={ch.name} ch={ch} />)}</>;
}
