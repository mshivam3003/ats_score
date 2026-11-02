import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface ApplicationRecord {
  id: string;
  company: string;
  role: string;
  status: 'Interested' | 'Applied' | 'Interview' | 'Offer' | 'Closed';
  link?: string;
  notes?: string;
  createdAt: string;
}

export interface MailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
}

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

const appsFile = path.join(config.dataDir, 'applications.json');
const draftsFile = path.join(config.dataDir, 'drafts.json');

export function getApplications(): ApplicationRecord[] {
  ensureDataDir();
  if (!fs.existsSync(appsFile)) {
    return [
      {
        id: '1',
        company: 'Stripe',
        role: 'Full Stack Engineer',
        status: 'Interview',
        link: 'https://stripe.com/jobs',
        notes: 'Round 2 technical interview scheduled for Thursday.',
        createdAt: new Date().toISOString(),
      },
      {
        id: '2',
        company: 'Vercel',
        role: 'Senior Frontend Developer',
        status: 'Applied',
        link: 'https://vercel.com/careers',
        notes: 'Applied with tailored resume scored 92% on ATS.',
        createdAt: new Date().toISOString(),
      },
    ];
  }
  try {
    return JSON.parse(fs.readFileSync(appsFile, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveApplications(apps: ApplicationRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(appsFile, JSON.stringify(apps, null, 2), 'utf-8');
}

export function getDrafts(): MailDraft[] {
  ensureDataDir();
  if (!fs.existsSync(draftsFile)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(draftsFile, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveDrafts(drafts: MailDraft[]): void {
  ensureDataDir();
  fs.writeFileSync(draftsFile, JSON.stringify(drafts, null, 2), 'utf-8');
}
