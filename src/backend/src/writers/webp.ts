import sharp from 'sharp';

interface Channel { name: string; samples: number[]; duration_s: number }
interface ECGMeta {
  layout?: string;
  scale?: { mm_per_s?: number; mm_per_mV?: number };
  manufacturer?: string;
  channels: Channel[];
}

export async function writeWebP(channels: Channel[], data: ECGMeta, filename: string) {
  const W = 3840, H = 2160;
  const layout = data.layout || 'stacked_12x1';
  const numCh = channels.length;
  const mmS = data.scale?.mm_per_s || 25;
  const mmMv = data.scale?.mm_per_mV || 10;
  let maxDur = 0;
  for (const c of channels) maxDur = Math.max(maxDur, c.duration_s || 0);
  if (maxDur <= 0) maxDur = 10;

  const mL = 20, mR = 4, mT = 6, mB = 5;
  const pxMm = layout === 'stacked_12x1'
    ? W / (maxDur * mmS + mL + mR)
    : W / (maxDur * mmS * 2 + 8 + mL + mR);

  const gL = Math.floor(mL * pxMm), gR = W - Math.floor(mR * pxMm);
  const gT = Math.floor(mT * pxMm), gB = H - Math.floor(mB * pxMm);
  const gW = gR - gL, gH = gB - gT;
  const mvPx = pxMm * mmMv;

  // Build SVG with grid + traces
  const svgParts: string[] = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`);
  svgParts.push(`<rect width="${W}" height="${H}" fill="white"/>`);

  // Grid lines
  const s1 = pxMm, s5 = pxMm * 5;
  // 1mm grid
  for (let x = gL; x <= gR; x += s1)
    svgParts.push(`<line x1="${x}" y1="${gT}" x2="${x}" y2="${gB}" stroke="#fdd2d2" stroke-width="0.5"/>`);
  for (let y = gT; y <= gB; y += s1)
    svgParts.push(`<line x1="${gL}" y1="${y}" x2="${gR}" y2="${y}" stroke="#fdd2d2" stroke-width="0.5"/>`);
  // 5mm grid
  for (let x = gL; x <= gR; x += s5)
    svgParts.push(`<line x1="${x}" y1="${gT}" x2="${x}" y2="${gB}" stroke="#e8a0a0" stroke-width="1"/>`);
  for (let y = gT; y <= gB; y += s5)
    svgParts.push(`<line x1="${gL}" y1="${y}" x2="${gR}" y2="${y}" stroke="#e8a0a0" stroke-width="1"/>`);

  const fz = Math.max(12, Math.floor(pxMm * 3.2));

  if (layout === 'stacked_12x1') {
    const rowH = gH / numCh;
    for (let i = 0; i < numCh; i++) {
      const ch = channels[i], s = ch.samples, n = s.length;
      if (n < 2) continue;
      const by = gT + rowH * i + rowH / 2;

      svgParts.push(`<text x="8" y="${by + fz * 0.35}" font-size="${fz}" font-family="sans-serif" font-weight="bold" fill="#1e1e1e">${ch.name}</text>`);

      const dx = gW / (n - 1);
      const points: string[] = [];
      for (let j = 0; j < n; j++) {
        const x = gL + j * dx;
        const y = by - s[j] * mvPx;
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      svgParts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="black" stroke-width="2"/>`);
    }
  } else {
    const nCol = Math.ceil(numCh / 2);
    const gap = Math.floor(8 * pxMm);
    const colW = Math.floor((gW - gap) / 2);
    const rowH = gH / nCol;
    for (let i = 0; i < numCh; i++) {
      const ch = channels[i], s = ch.samples, n = s.length;
      if (n < 2) continue;
      const col = i < nCol ? 0 : 1;
      const row = col === 0 ? i : i - nCol;
      const cx0 = gL + col * (colW + gap);
      const by = gT + rowH * row + rowH / 2;

      svgParts.push(`<text x="${Math.max(4, cx0 - fz * 3.2)}" y="${by + fz * 0.35}" font-size="${fz}" font-family="sans-serif" font-weight="bold" fill="#1e1e1e">${ch.name}</text>`);

      const dx = colW / (n - 1);
      const points: string[] = [];
      for (let j = 0; j < n; j++) {
        const x = cx0 + j * dx;
        const y = by - s[j] * mvPx;
        points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      svgParts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="black" stroke-width="2"/>`);
    }
  }

  // Calibration pulse
  const calX = gL + Math.floor(pxMm * 2), calY = gT + Math.floor(pxMm * 4);
  const h1 = Math.floor(pxMm * mmMv), w2 = Math.floor(pxMm * mmS * 0.2);
  svgParts.push(`<polyline points="${calX},${calY} ${calX + w2},${calY} ${calX + w2},${calY - h1} ${calX + w2 * 2},${calY - h1} ${calX + w2 * 2},${calY} ${calX + w2 * 3},${calY}" fill="none" stroke="black" stroke-width="3"/>`);

  const fzS = Math.max(9, Math.floor(pxMm * 2));
  svgParts.push(`<text x="${calX}" y="${calY + fzS * 1.6}" font-size="${fzS}" font-family="sans-serif" fill="#828282">1 mV / 200 ms</text>`);

  const info = `${data.manufacturer || '?'} | ${layout} | ${numCh} leads | ${mmS}mm/s ${mmMv}mm/mV`;
  svgParts.push(`<text x="${gL}" y="${gB + mB * pxMm * 0.7}" font-size="${fzS}" font-family="sans-serif" fill="#828282">${info}</text>`);

  svgParts.push('</svg>');

  const svg = Buffer.from(svgParts.join('\n'));
  await sharp(svg).resize(W, H).webp({ quality: 85 }).toFile(filename);
}
