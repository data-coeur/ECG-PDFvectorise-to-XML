import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { writeHL7aECG } from '../writers/hl7aecg.js';
import { writeMuseXml } from '../writers/musexml.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

type FormatKey = 'hl7aecg';

const VALID_FORMATS: FormatKey[] = ['hl7aecg'];

// Reshape one channel so it covers exactly `target` seconds.
//   - target < source: truncate to the first `target * sampleRate` samples
//   - target > source: concatenate the channel with itself enough times to
//                      cover the target, then truncate to the exact length
//   - target ≈ source: passthrough
// The Python renderer reads the XML duration and picks the page format from it
// (≤4s → 3x4+1, ≤8s → 6x2+1, else 12x1).
function fitChannelToDuration(c: Channel, target: number): Channel {
  const sourceLen = c.samples.length;
  if (sourceLen === 0 || c.duration_s <= 0) return c;
  if (Math.abs(target - c.duration_s) < 1e-3) return c;
  const sampleRate = sourceLen / c.duration_s;
  const targetLen = Math.max(1, Math.round(target * sampleRate));
  let samples: number[];
  if (targetLen <= sourceLen) {
    samples = c.samples.slice(0, targetLen);
  } else {
    samples = new Array(targetLen);
    for (let i = 0; i < targetLen; i++) samples[i] = c.samples[i % sourceLen];
  }
  return { ...c, samples, duration_s: target };
}

// Pass channels through unchanged. The frontend already produces samples at the
// optimal rate for each channel (uniform PDFs → preserved as-is, non-uniform →
// resampled to 500 Hz). Resampling here would only smooth/distort the data.
//
// We use the highest sample rate found across channels as the "global" sample rate
// in the XML SampleBase tag (used by the Python renderer to compute the time axis).
// Per-channel sample counts are preserved via samplesPerChArr.
function resample(channels: Channel[]) {
  let maxDur = 0;
  let srcRate = 0;
  for (const ch of channels) {
    if (ch.duration_s > maxDur) maxDur = ch.duration_s;
    if (ch.sample_rate_hz > srcRate) srcRate = ch.sample_rate_hz;
  }
  if (maxDur <= 0) maxDur = 10;
  const sampleRate = srcRate > 0 ? srcRate : 500;

  const resampled: number[][] = channels.map(c => [...c.samples]);
  const samplesPerChArr: number[] = channels.map(c => c.samples.length);
  const samplesPerCh = Math.max(...samplesPerChArr);
  return { resampled, sampleRate, samplesPerCh, samplesPerChArr, maxDur };
}

function makeBase(mfr: string) {
  const safe = (mfr || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[-:T]/g, '_').replace(/\.\d+Z/, '');
  return `ecg_${safe}_${ts}`;
}

// Convert ECG to HL7 aECG XML. Only the HL7 format is currently supported;
// EDF / WFDB / DICOM / HDF5 / WebP writers were retired.
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

    const xmlPath = path.join(DATA_DIR, `${base}.xml`);
    writeHL7aECG(channels, resampled, samplesPerCh, sampleRate, maxDur, xmlPath, data);
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
        duration: Math.round(maxDur * 100) / 100,
      },
    });
  } catch (e) {
    console.error('ECG convert error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Render ECG to a standardized image (matplotlib via Python sub-process).
// Pipeline: ECG JSON → HL7 aECG XML temp file → Python script → WebP image → response body.
//
// Query params:
//   ?target=<seconds>  — render every channel at this exact duration. Channels
//                        shorter than target are concatenated with themselves
//                        until they cover it; channels longer are truncated.
//                        The Python pipeline then picks the page format from the
//                        resulting duration (≤4s → 3x4+1, ≤8s → 6x2+1, else 12x1).
//                        If absent/invalid, the signal is rendered as-is.
ecgRouter.post('/render-image', async (req, res) => {
  const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const xmlPath = path.join(DATA_DIR, `_render_${uid}.xml`);
  const imgPath = path.join(DATA_DIR, `_render_${uid}.webp`);
  try {
    const data = req.body;
    if (!data?.channels?.length) return res.status(400).json({ error: 'No channels' });

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const targetRaw = parseFloat(req.query.target as string);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : null;
    const format = (req.query.format as string) || null;

    let channels: Channel[] = data.channels;
    if (target !== null) {
      // Only reshape standard leads — rhythm strip channels keep their full
      // duration so the renderer can display the complete long recording.
      channels = channels.map((c: Channel) =>
        /_rhythm$/i.test(c.name) ? c : fitChannelToDuration(c, target)
      );
    }
    const { resampled, sampleRate, samplesPerChArr } = resample(channels);
    writeMuseXml(channels, resampled, samplesPerChArr, sampleRate, xmlPath);

    const scriptPath = path.resolve(__dirname, '../../scripts/render_ecg_image.py');
    const args = [scriptPath, xmlPath, imgPath];
    if (format) args.push(format);
    const { stderr } = await execFileAsync('python3', args, {
      timeout: 30000,
      maxBuffer: 100 * 1024 * 1024,
    });

    if (stderr) console.warn('[render] Python stderr:', stderr);

    if (!fs.existsSync(imgPath)) {
      return res.status(500).json({ error: 'Render produced no output' });
    }

    const buf = fs.readFileSync(imgPath);
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    console.error('[render] error:', e);
    res.status(500).json({ error: (e as Error).message });
  } finally {
    if (fs.existsSync(xmlPath)) { try { fs.unlinkSync(xmlPath); } catch {} }
    if (fs.existsSync(imgPath)) { try { fs.unlinkSync(imgPath); } catch {} }
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
