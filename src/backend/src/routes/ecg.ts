import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { writeEDF } from '../writers/edf.js';
import { writeWFDB } from '../writers/wfdb.js';
import { writeDICOM } from '../writers/dicom.js';
import { writeHDF5 } from '../writers/hdf5.js';
import { writeWebP } from '../writers/webp.js';
import { writeHL7aECG } from '../writers/hl7aecg.js';

const DATA_DIR = process.env.DATA_DIR || '/app/data';

export const ecgRouter = Router();

// Serve generated files
ecgRouter.use('/data', (req, res, next) => {
  const filePath = path.join(DATA_DIR, req.path);
  if (!filePath.startsWith(DATA_DIR)) return res.status(403).end();
  next();
}, (_req, res, next) => {
  res.set('Access-Control-Expose-Headers', 'Content-Disposition');
  next();
}, (req, res) => {
  const filePath = path.join(DATA_DIR, req.path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

// Receive ECG data and convert to multiple formats
ecgRouter.post('/receive', async (req, res) => {
  try {
    const data = req.body;
    if (!data?.channels?.length) return res.status(400).json({ error: 'No channels' });

    const channels: Channel[] = data.channels;
    const numCh = channels.length;
    const mfr = (data.manufacturer || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = new Date().toISOString().replace(/[-:T]/g, '_').replace(/\.\d+Z/, '');
    const base = `ecg_${mfr}_${ts}`;

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Save raw JSON
    fs.writeFileSync(path.join(DATA_DIR, `${base}.json`), JSON.stringify(data, null, 2));

    // Compute max duration and sample rate
    let maxDur = 0;
    for (const ch of channels) maxDur = Math.max(maxDur, ch.duration_s || 0);
    if (maxDur <= 0) maxDur = 10;

    let srcRate = 0;
    for (const ch of channels) {
      const r = ch.sample_rate_hz || 0;
      if (r > srcRate) srcRate = r;
    }
    const sampleRate = srcRate > 0 ? srcRate : 500;
    const samplesPerCh = Math.round(sampleRate * maxDur);

    // Resample all channels to uniform rate
    const resampled: number[][] = [];
    for (const ch of channels) {
      const src = ch.samples;
      const n = src.length;
      const out: number[] = [];
      for (let i = 0; i < samplesPerCh; i++) {
        const srcIdx = n > 1 ? i / (samplesPerCh - 1) * (n - 1) : 0;
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, n - 1);
        const frac = srcIdx - lo;
        out.push(src[lo] * (1 - frac) + src[hi] * frac);
      }
      resampled.push(out);
    }

    const files: Record<string, string> = {};

    // 1. EDF+
    writeEDF(channels, resampled, samplesPerCh, sampleRate, maxDur, path.join(DATA_DIR, `${base}.edf`));
    files.edf = `${base}.edf`;

    // 2. WFDB
    writeWFDB(channels, resampled, samplesPerCh, sampleRate, path.join(DATA_DIR, base));
    files.wfdb_hea = `${base}.hea`;
    files.wfdb_dat = `${base}.dat`;

    // 3. DICOM
    writeDICOM(channels, resampled, samplesPerCh, sampleRate, path.join(DATA_DIR, `${base}.dcm`));
    files.dicom = `${base}.dcm`;

    // 4. HDF5
    writeHDF5(channels, resampled, samplesPerCh, sampleRate, maxDur, path.join(DATA_DIR, `${base}.h5`), data);
    files.hdf5 = `${base}.h5`;

    // 5. WebP
    await writeWebP(channels, data, path.join(DATA_DIR, `${base}.webp`));
    files.webp = `${base}.webp`;

    // 6. HL7 aECG XML
    writeHL7aECG(channels, resampled, samplesPerCh, sampleRate, maxDur, path.join(DATA_DIR, `${base}.xml`), data);
    files.hl7aecg = `${base}.xml`;

    res.json({
      success: true,
      base,
      files,
      info: {
        manufacturer: data.manufacturer || '?',
        layout: data.layout || 'stacked_12x1',
        channels: numCh,
        sample_rate: sampleRate,
        duration: Math.round(maxDur * 100) / 100,
      },
    });
  } catch (e) {
    console.error('ECG receive error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

interface Channel {
  name: string;
  samples: number[];
  duration_s: number;
  sample_rate_hz: number;
}
