import { Router } from 'express';
import multer from 'multer';
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

interface Channel {
  name: string;
  samples: number[];
  duration_s: number;
  sample_rate_hz: number;
}

type FormatKey = 'edf' | 'wfdb' | 'dicom' | 'hdf5' | 'webp' | 'hl7aecg';

const VALID_FORMATS: FormatKey[] = ['edf', 'wfdb', 'dicom', 'hdf5', 'webp', 'hl7aecg'];

function resample(channels: Channel[]) {
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

  return { resampled, sampleRate, samplesPerCh, maxDur };
}

function makeBase(mfr: string) {
  const safe = (mfr || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[-:T]/g, '_').replace(/\.\d+Z/, '');
  return `ecg_${safe}_${ts}`;
}

function convertFormat(
  format: FormatKey,
  channels: Channel[],
  resampled: number[][],
  samplesPerCh: number,
  sampleRate: number,
  maxDur: number,
  base: string,
  data: Record<string, unknown>,
): Record<string, string> {
  const files: Record<string, string> = {};
  const p = (ext: string) => path.join(DATA_DIR, `${base}.${ext}`);

  switch (format) {
    case 'edf':
      writeEDF(channels, resampled, samplesPerCh, sampleRate, maxDur, p('edf'));
      files.edf = `${base}.edf`;
      break;
    case 'wfdb':
      writeWFDB(channels, resampled, samplesPerCh, sampleRate, path.join(DATA_DIR, base));
      files.wfdb_hea = `${base}.hea`;
      files.wfdb_dat = `${base}.dat`;
      break;
    case 'dicom':
      writeDICOM(channels, resampled, samplesPerCh, sampleRate, p('dcm'));
      files.dicom = `${base}.dcm`;
      break;
    case 'hdf5':
      writeHDF5(channels, resampled, samplesPerCh, sampleRate, maxDur, p('h5'), data);
      files.hdf5 = `${base}.h5`;
      break;
    case 'webp':
      break; // handled async in caller
    case 'hl7aecg':
      writeHL7aECG(channels, resampled, samplesPerCh, sampleRate, maxDur, p('xml'), data);
      files.hl7aecg = `${base}.xml`;
      break;
  }
  return files;
}

// Convert single format
ecgRouter.post('/convert/:format', async (req, res) => {
  try {
    const format = req.params.format as FormatKey;
    if (!VALID_FORMATS.includes(format)) {
      return res.status(400).json({ error: `Invalid format: ${format}. Valid: ${VALID_FORMATS.join(', ')}` });
    }

    const data = req.body;
    if (!data?.channels?.length) return res.status(400).json({ error: 'No channels' });

    const channels: Channel[] = data.channels;
    const base = makeBase(data.manufacturer);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const { resampled, sampleRate, samplesPerCh, maxDur } = resample(channels);

    let files: Record<string, string>;

    if (format === 'webp') {
      await writeWebP(channels, data, path.join(DATA_DIR, `${base}.webp`));
      files = { webp: `${base}.webp` };
    } else {
      files = convertFormat(format, channels, resampled, samplesPerCh, sampleRate, maxDur, base, data);
    }

    res.json({
      success: true,
      base,
      files,
      info: {
        manufacturer: data.manufacturer || '?',
        layout: data.layout || 'stacked_12x1',
        channels: channels.length,
        sample_rate: sampleRate,
        duration: Math.round(maxDur * 100) / 100,
      },
    });
  } catch (e) {
    console.error('ECG convert error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Legacy: XML input parsing disabled (data privacy — XML files may contain patient data
// that would transit to the server). To be replaced by client-side parsing.
// See: src/backend/scripts/parse_xml_ecg.py, src/frontend/src/lib/xml-extract.ts

// Receive anonymized PDF reports for extraction debugging
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const GITHUB_ISSUE = 3;
const GITHUB_REPO = 'data-coeur/ecg-pipeline';

function getGithubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

async function postGithubComment(body: string) {
  const token = getGithubToken();
  if (!token) { console.warn('[Report] No GitHub token, skipping issue comment'); return; }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues/${GITHUB_ISSUE}/comments`, {
      method: 'POST',
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) console.warn(`[Report] GitHub comment failed: ${res.status}`);
    else console.log('[Report] GitHub issue comment posted');
  } catch (e) { console.warn('[Report] GitHub comment error:', e); }
}

const upload = multer({
  dest: REPORT_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf');
  },
});

ecgRouter.post('/report', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });

    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[-:T]/g, '_').replace(/\.\d+Z/, '');
    const dest = path.join(REPORT_DIR, `report_${ts}.pdf`);
    fs.renameSync(req.file.path, dest);

    const manufacturer = (req.body?.manufacturer as string) || 'Inconnu';
    const layout = (req.body?.layout as string) || 'Inconnu';
    const channels = (req.body?.channels as string) || '?';
    const filename = (req.body?.filename as string) || 'unknown.pdf';
    const sizeKb = Math.round((req.file.size || 0) / 1024);

    console.log(`[Report] Received anonymized PDF: ${dest} (${sizeKb} KB)`);

    // Post comment on GitHub issue
    const comment = [
      `## Nouveau signalement — ${new Date().toISOString().split('T')[0]}`,
      '',
      `| Info | Valeur |`,
      `|------|--------|`,
      `| **Fabricant** | ${manufacturer} |`,
      `| **Layout** | ${layout} |`,
      `| **Canaux** | ${channels} |`,
      `| **Fichier source** | \`${filename}\` |`,
      `| **PDF anonymisé** | \`${dest}\` (${sizeKb} KB) |`,
      `| **Statut** | En attente |`,
    ].join('\n');

    postGithubComment(comment).catch(() => {});

    res.json({ success: true, filename: path.basename(dest) });
  } catch (e) {
    console.error('Report upload error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});
