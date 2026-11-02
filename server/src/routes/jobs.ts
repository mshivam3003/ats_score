import { Router, Request, Response } from 'express';
import multer from 'multer';
import { searchJobsForRole, buildJobEmailBody } from '../services/jobScout.js';
import { extractTextFromBuffer } from '../services/documentParser.js';
import { inferTargetRoles } from '../services/atsScoring.js';
import { sendEmailMessage } from '../services/emailService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const jobsRouter = Router();

// ─── Original endpoints ────────────────────────────────────────────────────────

jobsRouter.post('/search', async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ error: 'Target role is required.' });
    }
    const results = await searchJobsForRole(role);
    return res.json({ results });
  } catch (err: any) {
    console.error('Job search error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to search for job opportunities.' });
  }
});

jobsRouter.post('/send-alert', async (req: Request, res: Response) => {
  try {
    const { targetRole, emailTo, jobResults, customSmtp } = req.body;
    if (!targetRole || !emailTo || !jobResults) {
      return res.status(400).json({ error: 'targetRole, emailTo, and jobResults are required.' });
    }

    const emailBody = buildJobEmailBody(targetRole, jobResults);
    const subject = `Job Leads Alert: ${targetRole} (${new Date().toLocaleDateString()})`;

    const sendRes = await sendEmailMessage(emailTo, subject, emailBody, undefined, customSmtp);

    if (!sendRes.success) {
      return res.status(400).json({
        error: sendRes.error || 'Failed to dispatch email alert. Check SMTP settings.',
        previewText: emailBody,
        subject,
      });
    }

    return res.json({
      success: true,
      messageId: sendRes.messageId,
      previewText: emailBody,
      subject,
    });
  } catch (err: any) {
    console.error('Job alert send error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to send job alert.' });
  }
});

// ─── Compatibility shims for ats_ui frontend ───────────────────────────────────

/**
 * POST /api/jobs/search-compat
 * Accepts multipart/form-data:
 *   - resume (File, optional): If provided, parse and infer the target role from it.
 *   - role   (string, optional): Explicit role override.
 *
 * Returns: JobSearchResponse shape that ats_ui expects:
 *   { target_role, results: SiteResult[], subject, email_text }
 */
jobsRouter.post('/search-compat', upload.single('resume'), async (req: Request, res: Response) => {
  try {
    let targetRole = (req.body.role as string | undefined)?.trim() || '';

    // If a resume was uploaded and no explicit role given, infer the role from resume
    if (!targetRole && req.file) {
      try {
        const resumeText = await extractTextFromBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
        const roles = await inferTargetRoles(resumeText);
        targetRole = roles[0] || '';
      } catch (e) {
        console.warn('Role inference from resume failed, using fallback:', e);
      }
    }

    if (!targetRole) {
      return res.status(400).json({ error: 'Could not determine a target role. Upload your resume or enter a role.' });
    }

    const rawResults = await searchJobsForRole(targetRole);

    // Map backend JobSearchResult[] → SiteResult[] (ats_ui shape)
    const siteResults = rawResults.map((r) => ({
      site: r.site,
      role: targetRole,
      jobs: r.jobs.map((j) => ({
        title: j.title,
        role: targetRole,
        company: j.company,
        location: j.location,
        link: j.link,
      })),
    }));

    const emailText = buildJobEmailBody(targetRole, rawResults);
    const subject = `Job Leads Alert: ${targetRole} (${new Date().toLocaleDateString()})`;

    return res.json({
      target_role: targetRole,
      results: siteResults,
      subject,
      email_text: emailText,
    });
  } catch (err: any) {
    console.error('Job search-compat error:', err);
    return res.status(500).json({ error: err?.message || 'Job search failed.' });
  }
});

/**
 * POST /api/jobs/send
 * Accepts JSON: { to, subject, body }
 * Returns: { sent, method, detail } (SendResponse shape from ats_ui/src/types.ts)
 */
jobsRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required.' });
    }

    const sendRes = await sendEmailMessage(to, subject, body);

    if (!sendRes.success) {
      // Return a structured response (not an error status) so the frontend can
      // show "Email draft ready" instead of throwing.
      return res.json({
        sent: false,
        method: null,
        detail: sendRes.error || 'SMTP send failed. Use the mailto fallback below.',
      });
    }

    return res.json({
      sent: true,
      method: 'smtp' as const,
      detail: `Message ID: ${sendRes.messageId || 'sent'}`,
    });
  } catch (err: any) {
    console.error('Job send (compat) error:', err);
    return res.json({
      sent: false,
      method: null,
      detail: err?.message || 'Send failed.',
    });
  }
});
