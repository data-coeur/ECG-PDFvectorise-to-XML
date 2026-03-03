import fs from 'fs';
import path from 'path';

interface Channel { name: string }

export function writeWFDB(
  channels: Channel[], resampled: number[][], nSamples: number,
  sr: number, basePath: string,
) {
  const ns = channels.length;
  const datName = path.basename(basePath) + '.dat';

  // .hea file
  let hea = `${path.basename(basePath)} ${ns} ${sr} ${nSamples}\n`;
  for (let i = 0; i < ns; i++) {
    const sig = resampled[i];
    const maxAbs = Math.max(Math.abs(Math.min(...sig)), Math.abs(Math.max(...sig)), 0.001);
    const gain = 32767.0 / maxAbs;
    hea += `${datName} 16 ${gain.toFixed(2)}(mV)/0 16 0 0 0 0 ${channels[i].name}\n`;
  }
  fs.writeFileSync(`${basePath}.hea`, hea);

  // .dat file: 16-bit interleaved
  const buf = Buffer.alloc(nSamples * ns * 2);
  const gains: number[] = [];
  for (let i = 0; i < ns; i++) {
    const sig = resampled[i];
    const maxAbs = Math.max(Math.abs(Math.min(...sig)), Math.abs(Math.max(...sig)), 0.001);
    gains.push(32767.0 / maxAbs);
  }

  let offset = 0;
  for (let j = 0; j < nSamples; j++) {
    for (let i = 0; i < ns; i++) {
      const dig = Math.max(-32768, Math.min(32767, Math.round(resampled[i][j] * gains[i])));
      buf.writeInt16LE(dig, offset);
      offset += 2;
    }
  }
  fs.writeFileSync(`${basePath}.dat`, buf);
}
