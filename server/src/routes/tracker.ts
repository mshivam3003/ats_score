import { Router, Request, Response } from 'express';
import {
  getApplications,
  saveApplications,
  getDrafts,
  saveDrafts,
  ApplicationRecord,
  MailDraft,
} from '../services/storageService.js';

export const trackerRouter = Router();

// Applications
trackerRouter.get('/applications', (req: Request, res: Response) => {
  return res.json({ applications: getApplications() });
});

trackerRouter.post('/applications', (req: Request, res: Response) => {
  const { company, role, status, link, notes } = req.body;
  if (!company || !role) {
    return res.status(400).json({ error: 'Company and role are required.' });
  }

  const apps = getApplications();
  const newApp: ApplicationRecord = {
    id: Date.now().toString(),
    company: company.trim(),
    role: role.trim(),
    status: status || 'Interested',
    link: link?.trim() || '',
    notes: notes?.trim() || '',
    createdAt: new Date().toISOString(),
  };

  apps.unshift(newApp);
  saveApplications(apps);
  return res.status(201).json({ application: newApp });
});

trackerRouter.put('/applications/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, notes, link, company, role } = req.body;

  const apps = getApplications();
  const index = apps.findIndex((a) => a.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  if (status) apps[index].status = status;
  if (notes !== undefined) apps[index].notes = notes;
  if (link !== undefined) apps[index].link = link;
  if (company) apps[index].company = company;
  if (role) apps[index].role = role;

  saveApplications(apps);
  return res.json({ application: apps[index] });
});

trackerRouter.delete('/applications/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  let apps = getApplications();
  apps = apps.filter((a) => a.id !== id);
  saveApplications(apps);
  return res.json({ success: true });
});

// Drafts
trackerRouter.get('/drafts', (req: Request, res: Response) => {
  return res.json({ drafts: getDrafts() });
});

trackerRouter.post('/drafts', (req: Request, res: Response) => {
  const { to, subject, body } = req.body;
  const drafts = getDrafts();
  const newDraft: MailDraft = {
    id: Date.now().toString(),
    to: to?.trim() || '',
    subject: subject?.trim() || '(No Subject)',
    body: body || '',
    createdAt: new Date().toISOString(),
  };
  drafts.unshift(newDraft);
  saveDrafts(drafts);
  return res.status(201).json({ draft: newDraft });
});

trackerRouter.delete('/drafts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  let drafts = getDrafts();
  drafts = drafts.filter((d) => d.id !== id);
  saveDrafts(drafts);
  return res.json({ success: true });
});
