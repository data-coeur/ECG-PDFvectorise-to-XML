// server — bootstrap Express : CORS, JSON 60 MB, monte le router /api/ecg,
// sert le frontend statique sur /ecg/, redirige / → /ecg/.
// Lancé par Docker via CMD ["node", "dist/server.js"], écoute sur PORT (3000).
// Raison : seul point d'entrée HTTP du backend.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ecgRouter } from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json({ limit: '60mb' }));

// API routes
app.use('/api/ecg', ecgRouter);

// Serve frontend static files (built by Vite). Content-hashed assets under
// /assets/ are immutable → cache for a year; other files (index.html) stay
// no-cache so deploys are picked up immediately.
const frontendDist = path.resolve(__dirname, '../frontend-dist');
app.use('/ecg', express.static(frontendDist, {
  setHeaders: (res, filePath) => {
    if (/[\\/]assets[\\/]/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.get('/ecg/*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Redirect root to /ecg/
app.get('/', (_req, res) => res.redirect('/ecg/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ECG server running on port ${PORT}`);
});
