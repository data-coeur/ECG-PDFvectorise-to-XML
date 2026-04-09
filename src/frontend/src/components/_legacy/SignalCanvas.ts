// Draw an ECG signal on a canvas with clinical paper grid.
// Baseline (0mV) at vertical center. Signal at absolute mV positions.

const MM_PER_MV = 10;

export function drawSignalCanvas(cv: HTMLCanvasElement, samples: number[], pxPerMm: number) {
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  const pxPerMv = pxPerMm * MM_PER_MV;
  const baseY = h / 2;

  // Background
  ctx.fillStyle = '#fff5f5';
  ctx.fillRect(0, 0, w, h);

  // Minor grid: 1mm squares, anchored to baseline
  const minor = pxPerMm;
  ctx.strokeStyle = '#fce4ec';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += minor) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = baseY; y >= 0; y -= minor) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let y = baseY + minor; y < h; y += minor) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  // Major grid: 5mm squares (= 0.5mV)
  const major = pxPerMm * 5;
  ctx.strokeStyle = '#f8bbd0';
  ctx.lineWidth = 0.8;
  for (let x = 0; x < w; x += major) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = baseY; y >= 0; y -= major) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (let y = baseY + major; y < h; y += major) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  if (samples.length < 2) return;

  // Baseline indicator
  ctx.strokeStyle = 'rgba(8,145,178,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();

  // ECG trace
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
