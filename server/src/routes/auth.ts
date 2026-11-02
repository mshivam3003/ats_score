import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { createOtp, verifyOtp, upsertUser } from '../db/authDb.js';
import { signUserToken, requireAuth } from '../services/jwtService.js';
import { sendEmailMessage } from '../services/emailService.js';

export const authRouter = Router();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * POST /api/auth/send-otp
 * Body: { email: string }
 */
authRouter.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const rawEmail = req.body.email;
    if (!rawEmail || typeof rawEmail !== 'string' || !isValidEmail(rawEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const email = rawEmail.trim().toLowerCase();

    // Generate secure 6-digit numeric OTP
    const plainOtp = crypto.randomInt(100000, 1000000).toString();

    // Save hashed OTP in server DB (10 min validity)
    createOtp(email, plainOtp, 10);

    // Build email
    const subject = `Your ResumeRise AI verification code: ${plainOtp}`;
    const text = `Hello,\n\nYour one-time login verification code for ResumeRise AI is:\n\n    ${plainOtp}\n\nThis code expires in 10 minutes. If you did not request this, please disregard this email.\n\nBest regards,\nResumeRise AI`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E4E4E7; border-radius: 12px; color: #2B2D31;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
          <div style="width: 28px; height: 28px; border-radius: 6px; background: #2B2D31; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; text-align: center; line-height: 28px;">R</div>
          <span style="font-weight: 700; font-size: 16px; color: #2B2D31;">ResumeRise AI</span>
        </div>
        <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 8px 0; color: #2B2D31;">Your Verification Code</h2>
        <p style="font-size: 14px; color: #4A4D54; line-height: 1.5; margin: 0 0 20px 0;">Use the 6-digit code below to securely sign in to your ResumeRise account:</p>
        <div style="background: #F6F6F7; border: 1.5px dashed #C4C6CC; border-radius: 10px; padding: 18px; text-align: center; margin-bottom: 20px;">
          <span style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #2B2D31;">${plainOtp}</span>
        </div>
        <p style="font-size: 13px; color: #5F6368; line-height: 1.5; margin: 0 0 16px 0;">This code is valid for <strong>10 minutes</strong>. Never share this code with anyone.</p>
        <hr style="border: none; border-top: 1px solid #EEEEF0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #5F6368; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `;

    console.log(`\n======================================================`);
    console.log(`🔑 OTP GENERATED FOR: ${email}`);
    console.log(`👉 CODE: ${plainOtp}`);
    console.log(`⏰ EXPIRES: in 10 minutes`);
    console.log(`======================================================\n`);

    // Dispatch email via SMTP
    const sendResult = await sendEmailMessage(email, subject, text, html);

    if (!sendResult.success) {
      console.warn(`[Auth] SMTP delivery note for ${email}: ${sendResult.error}`);
      // In development or if SMTP is delayed, return info so testing is seamless
      return res.json({
        ok: true,
        message: 'OTP generated. Check your inbox (or server console in development).',
        devNotice: process.env.NODE_ENV !== 'production' ? `Development code logged to server console.` : undefined,
      });
    }

    return res.json({
      ok: true,
      message: 'Verification code sent to your email. Please check your inbox.',
    });
  } catch (err: any) {
    console.error('send-otp error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to dispatch verification code.' });
  }
});

/**
 * POST /api/auth/verify-otp
 * Body: { email: string, otp: string, name?: string }
 */
authRouter.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { email, otp, name } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    const verification = verifyOtp(email, otp);
    if (!verification.success) {
      return res.status(400).json({ error: verification.error || 'Verification failed.' });
    }

    // Upsert user in Server DB
    const user = upsertUser(email, name);

    // Sign JWT token
    const token = signUserToken(user);

    // Set HTTP cookie for seamless authentication
    res.cookie('rr_auth_token', token, {
      httpOnly: false, // accessible to client for storage / headers
      secure: false, // set true in https production
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    console.log(`[Auth] User authenticated successfully: ${user.email} (id: ${user.id})`);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (err: any) {
    console.error('verify-otp error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to verify OTP.' });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user
 */
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  return res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
  });
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('rr_auth_token');
  return res.json({ ok: true, message: 'Logged out successfully.' });
});

