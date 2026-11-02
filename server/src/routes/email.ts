import { Router, Request, Response } from 'express';
import { testSmtpConnection, sendEmailMessage } from '../services/emailService.js';
import { generateGeminiCompletion } from '../services/gemini.js';
import { config } from '../config.js';

export const emailRouter = Router();

emailRouter.get('/status', (req: Request, res: Response) => {
  const isEnvConfigured = Boolean(
    config.smtp.host && config.smtp.username && config.smtp.password
  );
  return res.json({
    configured: isEnvConfigured,
    host: config.smtp.host,
    port: config.smtp.port,
    username: config.smtp.username ? `${config.smtp.username.slice(0, 3)}***` : '',
  });
});

emailRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const { host, port, username, password, useSsl } = req.body;
    const testConfig = host && username && password ? { host, port: Number(port), username, password, useSsl: Boolean(useSsl) } : undefined;

    const result = await testSmtpConnection(testConfig);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err?.message || 'SMTP connection failed.' });
  }
});

emailRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, subject, body, customSmtp } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Recipient (to), subject, and body are required.' });
    }

    const result = await sendEmailMessage(to, subject, body, undefined, customSmtp);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({ success: true, messageId: result.messageId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to dispatch email.' });
  }
});

emailRouter.post('/draft-outreach', async (req: Request, res: Response) => {
  try {
    const { resumeText, roleTitle, companyName } = req.body;
    if (!resumeText) {
      return res.status(400).json({ error: 'Resume text is required to draft outreach.' });
    }

    const prompt = `
You are an Executive Recruiter and Outreach Strategist.
Draft a concise, compelling cold outreach email to a hiring manager or recruiter for the following position:
Role: ${roleTitle || 'Target Opportunity'}
Company: ${companyName || 'Target Company'}

RESUME FACTS:
${resumeText.slice(0, 8000)}

RULES:
1. Ground the message purely on real achievements in the resume. No hallucinations.
2. Structure:
   - Line 1 must start with "Subject: " followed by a catchy, professional subject line.
   - 2-3 short, punchy paragraphs highlighting 2 relevant key achievements with quantifiable metrics.
   - Clear call to action (brief 15-min chat).
   - Professional sign-off.
`;

    const raw = await generateGeminiCompletion(prompt, {
      temperature: 0.35,
      maxTokens: 600,
    });

    const lines = raw.split('\n');
    let subject = 'Connecting regarding opportunities';
    let bodyLines = lines;

    if (lines.length > 0 && lines[0].toLowerCase().startsWith('subject:')) {
      subject = lines[0].slice(8).trim();
      bodyLines = lines.slice(1);
    }

    const body = bodyLines.join('\n').trim();

    return res.json({ subject, body });
  } catch (err: any) {
    console.error('Draft outreach error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to draft outreach email.' });
  }
});
