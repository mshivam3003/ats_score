import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from workspace root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function cleanGeminiModel(model: string | undefined): string {
  if (!model) return 'gemini-3.8-flash';
  // Strip "google/" prefix if present
  let cleaned = model.replace(/^google\//i, '').trim();
  if (cleaned.includes('gemini-2.5') || cleaned.includes('gemini-2.0')) {
    cleaned = 'gemini-3.8-flash';
  }
  return cleaned || 'gemini-3.8-flash';
}

function cleanGeminiBaseUrl(url: string | undefined): string {
  if (!url || url.includes('/v1') && !url.includes('/v1beta')) {
    return 'https://generativelanguage.googleapis.com/v1beta/openai/';
  }
  let cleaned = url.trim();
  if (!cleaned.endsWith('/')) {
    cleaned += '/';
  }
  return cleaned;
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
  geminiModel: cleanGeminiModel(process.env.GEMINI_MODEL),
  geminiBaseUrl: cleanGeminiBaseUrl(process.env.GEMINI_BASE_URL),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    username: process.env.SMTP_USERNAME || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USERNAME || '',
  },
  jobDetailsMax: parseInt(process.env.JOB_DETAILS_MAX || '4', 10),
  jobDetailsTimeoutS: parseInt(process.env.JOB_DETAILS_TIMEOUT_S || '10', 10),
  jobSitesFile: path.resolve(__dirname, '../../job_sites.json'),
  dataDir: path.resolve(__dirname, '../../data'),
  jwtSecret: process.env.JWT_SECRET || 'resumerise-ai-secret-jwt-key-2026-secure',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
};
