// routes/report — POST /report. Reçoit un PDF ECG anonymisé côté client,
// l'archive sous DATA_DIR/reports/ et poste un commentaire markdown sur
// l'issue de suivi GitHub (data-coeur/ecg-pipeline#3) avec les métadonnées
// (fabricant, layout, canaux, nom source, taille).
// Appelé par le frontend ReportModal après anonymisation locale.

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { postGithubComment } from '../lib/github-issue.js';

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const REPORT_DIR = path.join(DATA_DIR, 'reports');

const upload = multer({
  dest: REPORT_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf');
  },
});

export const reportRouter = Router();

reportRouter.post('/report', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });

    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').replace(/\.\d+Z/, '');
    const dest = path.join(REPORT_DIR, `report_${timestamp}.pdf`);
    fs.renameSync(req.file.path, dest);

    const manufacturer = (req.body?.manufacturer as string) || 'Inconnu';
    const layout = (req.body?.layout as string) || 'Inconnu';
    const channels = (req.body?.channels as string) || '?';
    const filename = (req.body?.filename as string) || 'unknown.pdf';
    const sizeKb = Math.round((req.file.size || 0) / 1024);

    console.log(`[Report] Received anonymized PDF: ${dest} (${sizeKb} KB)`);

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

    postGithubComment(comment).catch(() => { /* failure already logged */ });

    res.json({ success: true, filename: path.basename(dest) });
  } catch (error) {
    console.error('Report upload error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});
