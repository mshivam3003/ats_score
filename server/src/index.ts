import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { atsRouter } from './routes/ats.js';
import { jobsRouter } from './routes/jobs.js';
import { emailRouter } from './routes/email.js';
import { trackerRouter } from './routes/tracker.js';
import { authRouter } from './routes/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ─── Health Check ─────────────────────────────────────────────────────────────
// Returns both the original shape AND the ats_ui-compatible shape.
app.get('/api/health', (req, res) => {
  res.json({
    // ats_ui Layout.tsx shape
    ok: true,
    llm_key_configured: Boolean(config.geminiApiKey),
    // Additional diagnostic fields
    status: 'online',
    timestamp: new Date().toISOString(),
    geminiConfigured: Boolean(config.geminiApiKey),
    model: config.geminiModel,
  });
});

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/ats', atsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/email', emailRouter);
app.use('/api/tracker', trackerRouter);

// ─── Serve ats_ui in production ────────────────────────────────────────────────
// In dev, Vite (port 5173) proxies /api → this server (port 5000).
// In production, `npm run build` compiles ats_ui into ats_ui/frontend/dist.
const clientDistPath = path.resolve(
  __dirname,
  '../../ats_ui/ResumeRise-fullstack/ResumeRise/frontend/dist'
);
app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).send(`ResumeRise AI Backend is running on port ${config.port}. Start the Vite dev server or run npm run build.`);
    }
  });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 ResumeRise AI Server running on http://localhost:${config.port}`);
  console.log(`🤖 AI Engine: Google Gemini (${config.geminiModel})`);
  console.log(`🔑 Gemini Key Configured: ${Boolean(config.geminiApiKey)}`);
  console.log(`📧 SMTP Configured: ${Boolean(config.smtp.username)}`);
  console.log(`🌐 Frontend (dev): http://localhost:5173`);
  console.log(`======================================================\n`);
});
