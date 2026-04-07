import fs from 'fs';

interface Channel { name: string }

function pad(s: string, len: number): Buffer {
  const buf = Buffer.alloc(len, 0x20); // space-padded
  buf.write(s.substring(0, len), 'ascii');
  return buf;
}

export function writeEDF(
  channels: Channel[], resampled: number[][], nSamples: number,
  sr: number, dur: number, filename: string,
) {
  const ns = channels.length;
  const headerBytes = 256 + ns * 256;
  const digMin = -32768, digMax = 32767;

  const pMin: number[] = [], pMax: number[] = [];
  for (const sig of resampled) {
    let mn = Math.min(...sig), mx = Math.max(...sig);
    if (mn === mx) { mn -= 0.5; mx += 0.5; }
    pMin.push(mn); pMax.push(mx);
  }

  const fd = fs.openSync(filename, 'w');
  const write = (b: Buffer) => fs.writeSync(fd, b);

  // Global header (256 bytes)
  write(pad('0', 8));
  write(pad('X X X X', 80));
  const now = new Date();
  write(pad(`Startdate ${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')}`, 80));
  write(pad(now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.'), 8));
  write(pad(`${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')}`, 8));
  write(pad(String(headerBytes), 8));
  write(pad('EDF+C', 44));
  write(pad('1', 8));
  write(pad(dur.toFixed(4), 8));
  write(pad(String(ns), 4));

  // Signal headers
  for (const ch of channels) write(pad(ch.name.substring(0, 16), 16));
  for (let i = 0; i < ns; i++) write(pad('AgAgCl electrode', 80));
  for (let i = 0; i < ns; i++) write(pad('mV', 8));
  for (const v of pMin) write(pad(v.toFixed(4), 8));
  for (const v of pMax) write(pad(v.toFixed(4), 8));
  for (let i = 0; i < ns; i++) write(pad(String(digMin), 8));
  for (let i = 0; i < ns; i++) write(pad(String(digMax), 8));
  for (let i = 0; i < ns; i++) write(pad('', 80));
  for (let i = 0; i < ns; i++) write(pad(String(nSamples), 8));
  for (let i = 0; i < ns; i++) write(pad('', 32));

  // Data: one record, all signals sequential
  const sample = Buffer.alloc(2);
  for (let i = 0; i < ns; i++) {
    const range = pMax[i] - pMin[i];
    for (const v of resampled[i]) {
      const dig = Math.round((v - pMin[i]) / range * (digMax - digMin) + digMin);
      sample.writeInt16LE(Math.max(digMin, Math.min(digMax, dig)));
      write(sample);
    }
  }
  fs.closeSync(fd);
}
