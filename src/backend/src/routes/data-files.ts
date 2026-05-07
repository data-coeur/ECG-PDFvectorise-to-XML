// routes/data-files — middleware GET /data/:filename qui sert les fichiers
// générés par /convert (XML) et stockés dans DATA_DIR. Protège contre le
// path traversal (le chemin résolu doit rester dans DATA_DIR) et expose le
// header Content-Disposition pour que le navigateur conserve le nom.
// Monté par routes/index sur le préfixe /data.

import { Router } from 'express';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || '/app/data';

export const dataFilesRouter = Router();

dataFilesRouter.use(
  (req, res, next) => {
    const filePath = path.join(DATA_DIR, req.path);
    if (!filePath.startsWith(DATA_DIR)) return res.status(403).end();
    next();
  },
  (_req, res, next) => {
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
    next();
  },
  (req, res) => {
    const filePath = path.join(DATA_DIR, req.path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath);
  },
);
