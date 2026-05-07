// routes/render-image — POST /render-image. Pipeline ECG JSON → MUSE XML
// temp file → script Python (matplotlib via raw2paper) → image WebP renvoyée
// dans le body de la réponse. Le query param `?target=<seconds>` reshape la
// durée des leads ; `?format=<3x4|6x2|...>` force un layout côté Python.
// Appelé par le frontend ECGImageView pour afficher / mettre en cache la preview.

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { writeMuseXml } from '../writers/musexml.js';
import { fitChannelToDuration, resample, type Channel } from '../lib/signal-resample.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || '/app/data';

export const renderImageRouter = Router();

renderImageRouter.post('/render-image', async (req, res) => {
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
      // Reshape standard leads only — rhythm strip channels keep their full
      // duration so the renderer can display the complete long recording.
      channels = channels.map((channel: Channel) =>
        /_rhythm$/i.test(channel.name) ? channel : fitChannelToDuration(channel, target)
      );
    }
    const { resampled, sampleRate, samplesPerChannelArray } = resample(channels);
    writeMuseXml(channels, resampled, samplesPerChannelArray, sampleRate, xmlPath);

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
  } catch (error) {
    console.error('[render] error:', error);
    res.status(500).json({ error: (error as Error).message });
  } finally {
    if (fs.existsSync(xmlPath)) { try { fs.unlinkSync(xmlPath); } catch { /* ignore */ } }
    if (fs.existsSync(imgPath)) { try { fs.unlinkSync(imgPath); } catch { /* ignore */ } }
  }
});
