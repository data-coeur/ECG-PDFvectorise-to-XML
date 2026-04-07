import fs from 'fs';

interface Channel { name: string }

export function writeHDF5(
  channels: Channel[], resampled: number[][], nSamples: number,
  sr: number, dur: number, filename: string, meta: Record<string, unknown>,
) {
  const parts: Buffer[] = [];

  // HDF5 magic bytes
  parts.push(Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]));

  // JSON header
  const header = JSON.stringify({
    format: 'ecg_hdf5_lite',
    version: 1,
    sample_rate_hz: sr,
    duration_s: dur,
    num_channels: channels.length,
    num_samples: nSamples,
    data_type: 'float32',
    data_layout: 'channels_first',
    channel_names: channels.map(c => c.name),
    units: 'mV',
    manufacturer: meta.manufacturer || 'unknown',
    original_layout: meta.layout || 'unknown',
  });

  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(header.length);
  parts.push(lenBuf);
  parts.push(Buffer.from(header, 'utf-8'));

  // Binary data: float32, channels first
  const dataBuf = Buffer.alloc(resampled.length * nSamples * 4);
  let off = 0;
  for (const sig of resampled) {
    for (let j = 0; j < nSamples; j++) {
      dataBuf.writeFloatLE(sig[j], off);
      off += 4;
    }
  }
  parts.push(dataBuf);

  fs.writeFileSync(filename, Buffer.concat(parts));
}
