import fs from 'fs';

interface Channel { name: string }

function writeTag(parts: Buffer[], group: number, elem: number, vr: string, value: Buffer) {
  const tag = Buffer.alloc(4);
  tag.writeUInt16LE(group, 0);
  tag.writeUInt16LE(elem, 2);
  parts.push(tag);
  parts.push(Buffer.from(vr, 'ascii'));

  const longVRs = ['OB', 'OW', 'SQ', 'UN', 'UC', 'UR', 'UT'];
  if (longVRs.includes(vr)) {
    const lenBuf = Buffer.alloc(6);
    lenBuf.writeUInt16LE(0, 0); // reserved
    lenBuf.writeUInt32LE(value.length, 2);
    parts.push(lenBuf);
  } else {
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(value.length, 0);
    parts.push(lenBuf);
  }
  parts.push(value);
}

function seqTag(parts: Buffer[], group: number, elem: number) {
  const b = Buffer.alloc(12);
  b.writeUInt16LE(group, 0); b.writeUInt16LE(elem, 2);
  b.write('SQ', 4, 'ascii');
  b.writeUInt16LE(0, 6); // reserved
  b.writeUInt32LE(0xFFFFFFFF, 8); // undefined length
  parts.push(b);
}

function itemStart(parts: Buffer[]) {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(0xFFFE, 0); b.writeUInt16LE(0xE000, 2);
  b.writeUInt32LE(0xFFFFFFFF, 4);
  parts.push(b);
}

function itemDelim(parts: Buffer[]) {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(0xFFFE, 0); b.writeUInt16LE(0xE00D, 2);
  b.writeUInt32LE(0, 4);
  parts.push(b);
}

function seqDelim(parts: Buffer[]) {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(0xFFFE, 0); b.writeUInt16LE(0xE0DD, 2);
  b.writeUInt32LE(0, 4);
  parts.push(b);
}

function padStr(s: string, minLen: number): Buffer {
  let str = s;
  if (str.length < minLen) str = str.padEnd(minLen);
  if (str.length % 2 !== 0) str += ' ';
  return Buffer.from(str, 'ascii');
}

export function writeDICOM(
  channels: Channel[], resampled: number[][], nSamples: number,
  sr: number, filename: string,
) {
  const ns = channels.length;
  const parts: Buffer[] = [];
  const ts = Date.now();

  // Preamble + magic
  parts.push(Buffer.alloc(128));
  parts.push(Buffer.from('DICM', 'ascii'));

  // Meta header placeholder — we'll compute length after
  const metaStartIdx = parts.length;
  const metaLenPlaceholder = Buffer.alloc(4);
  writeTag(parts, 0x0002, 0x0000, 'UL', metaLenPlaceholder);
  writeTag(parts, 0x0002, 0x0001, 'OB', Buffer.from([0x00, 0x01]));
  writeTag(parts, 0x0002, 0x0002, 'UI', Buffer.from('1.2.840.10008.5.1.4.1.1.9.1.1\0'));
  writeTag(parts, 0x0002, 0x0003, 'UI', Buffer.from(`1.2.826.0.1.3680043.8.498.${ts}.1\0`));
  writeTag(parts, 0x0002, 0x0010, 'UI', Buffer.from('1.2.840.10008.1.2.1\0'));
  const metaEndIdx = parts.length;

  // Compute meta length
  let metaLen = 0;
  for (let i = metaStartIdx + 1; i < metaEndIdx; i++) metaLen += parts[i].length;
  // Subtract the group length tag itself (tag 4 + VR 2 + len 2 + value 4 = 12)
  metaLen -= 12;
  metaLenPlaceholder.writeUInt32LE(metaLen, 0);

  // Patient/Study
  writeTag(parts, 0x0010, 0x0010, 'PN', padStr('Anonymous', 12));
  writeTag(parts, 0x0008, 0x0060, 'CS', padStr('ECG', 4));
  writeTag(parts, 0x0020, 0x000D, 'UI', Buffer.from(`1.2.826.0.1.3680043.8.498.${ts}.2\0`));
  writeTag(parts, 0x0020, 0x000E, 'UI', Buffer.from(`1.2.826.0.1.3680043.8.498.${ts}.3\0`));

  // Waveform Sequence
  seqTag(parts, 0x5400, 0x0100);
  itemStart(parts);

  // Number of channels
  const usBuf = Buffer.alloc(2); usBuf.writeUInt16LE(ns);
  writeTag(parts, 0x003A, 0x0005, 'US', usBuf);
  // Number of samples
  const ulBuf = Buffer.alloc(4); ulBuf.writeUInt32LE(nSamples);
  writeTag(parts, 0x003A, 0x0010, 'UL', ulBuf);
  // Sampling frequency
  writeTag(parts, 0x003A, 0x001A, 'DS', padStr(`${sr.toFixed(1)}`, 4));
  // Bits allocated
  const bits = Buffer.alloc(2); bits.writeUInt16LE(16);
  writeTag(parts, 0x5400, 0x1004, 'US', bits);

  // Channel Definition Sequence
  seqTag(parts, 0x5400, 0x0004);
  for (let i = 0; i < ns; i++) {
    itemStart(parts);
    writeTag(parts, 0x003A, 0x0203, 'SH', padStr(channels[i].name, 16));
    const sig = resampled[i];
    const maxAbs = Math.max(Math.abs(Math.min(...sig)), Math.abs(Math.max(...sig)), 0.001);
    writeTag(parts, 0x003A, 0x0210, 'DS', padStr((maxAbs / 32767).toFixed(6), 10));
    writeTag(parts, 0x003A, 0x0211, 'SQ', Buffer.alloc(0));
    itemDelim(parts);
  }
  seqDelim(parts);

  // Waveform Data
  const dataLen = nSamples * ns * 2;
  const dataHeader = Buffer.alloc(12);
  dataHeader.writeUInt16LE(0x5400, 0); dataHeader.writeUInt16LE(0x1010, 2);
  dataHeader.write('OW', 4, 'ascii');
  dataHeader.writeUInt16LE(0, 6);
  dataHeader.writeUInt32LE(dataLen, 8);
  parts.push(dataHeader);

  const dataBuf = Buffer.alloc(dataLen);
  let off = 0;
  for (let j = 0; j < nSamples; j++) {
    for (let i = 0; i < ns; i++) {
      const sig = resampled[i];
      const maxAbs = Math.max(Math.abs(Math.min(...sig)), Math.abs(Math.max(...sig)), 0.001);
      const dig = Math.max(-32768, Math.min(32767, Math.round(resampled[i][j] / maxAbs * 32767)));
      dataBuf.writeInt16LE(dig, off);
      off += 2;
    }
  }
  parts.push(dataBuf);

  itemDelim(parts);
  seqDelim(parts);

  fs.writeFileSync(filename, Buffer.concat(parts));
}
