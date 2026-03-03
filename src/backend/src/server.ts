import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ecgRouter } from './routes/ecg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json({ limit: '60mb' }));

// API routes
app.use('/api/ecg', ecgRouter);

// Serve frontend static files (built by Vite)
const frontendDist = path.resolve(__dirname, '../frontend-dist');
app.use('/ecg', express.static(frontendDist));
app.get('/ecg/*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Redirect root to /ecg/
app.get('/', (_req, res) => res.redirect('/ecg/'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ECG server running on port ${PORT}`);
});
