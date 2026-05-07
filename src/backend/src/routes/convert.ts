// routes/convert — POST /convert/:format. Convertit un ECGData JSON en
// fichier de sortie médical et stocke dans DATA_DIR (récupérable via /data).
// Seul le format hl7aecg est actif (autres writers retirés).
// In  : { channels, manufacturer, layout } JSON. Out : { success, base, files, info } JSON.
// Appelé par le frontend FormatCards quand on clique "HL7 aECG".

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { writeHL7aECG } from '../writers/hl7aecg.js';
import { resample, type Channel } from '../lib/signal-resample.js';

const DATA_DIR = process.env.DATA_DIR || '/app/data';

type FormatKey = 'hl7aecg';
const VALID_FORMATS: FormatKey[] = ['hl7aecg'];

export const convertRouter = Router();

convertRouter.post('/convert/:format', async (req, res) => {
  try {
    const format = req.params.format as FormatKey;
    if (!VALID_FORMATS.includes(format)) {
      return res.status(400).json({ error: `Invalid format: ${format}. Valid: ${VALID_FORMATS.join(', ')}` });
    }

    const data = req.body;
    if (!data?.channels?.length) return res.status(400).json({ error: 'No channels' });

    const channels: Channel[] = data.channels;
    const base = makeBaseFilename(data.manufacturer);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const { resampled, sampleRate, samplesPerChannel, maxDuration } = resample(channels);

    const xmlPath = path.join(DATA_DIR, `${base}.xml`);
    writeHL7aECG(channels, resampled, samplesPerChannel, sampleRate, maxDuration, xmlPath, data);
    const files = { hl7aecg: `${base}.xml` };

    res.json({
      success: true,
      base,
      files,
      info: {
        manufacturer: data.manufacturer || '?',
        layout: data.layout || 'stacked_12x1',
        channels: channels.length,
        sample_rate: sampleRate,
        duration: Math.round(maxDuration * 100) / 100,
      },
    });
  } catch (error) {
    console.error('ECG convert error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Fabrique un nom de base safe-filename style "ecg_<manufacturer>_<timestamp>".
function makeBaseFilename(manufacturer: string): string {
  const safe = (manufacturer || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').replace(/\.\d+Z/, '');
  return `ecg_${safe}_${timestamp}`;
}
