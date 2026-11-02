import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from?: string;
  useSsl?: boolean;
}

export function createTransporter(customConfig?: Partial<SmtpConfig>) {
  const host = customConfig?.host || config.smtp.host;
  const port = Number(customConfig?.port || config.smtp.port || 587);
  const user = customConfig?.username || config.smtp.username;
  const pass = customConfig?.password || config.smtp.password;
  const isSsl = customConfig?.useSsl ?? (port === 465);

  if (!host || !user || !pass) {
    throw new Error('Incomplete SMTP configuration. Host, username, and password are required.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: isSsl,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export async function testSmtpConnection(customConfig?: Partial<SmtpConfig>): Promise<{ success: boolean; message: string }> {
  try {
    const transporter = createTransporter(customConfig);
    await transporter.verify();
    return {
      success: true,
      message: 'SMTP credentials verified successfully! Connected and authenticated.',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'SMTP connection failed. Check host, port, username, or app password.',
    };
  }
}

export async function sendEmailMessage(
  to: string,
  subject: string,
  text: string,
  html?: string,
  customConfig?: Partial<SmtpConfig>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const transporter = createTransporter(customConfig);
    const fromAddress = customConfig?.from || config.smtp.from || customConfig?.username || config.smtp.username;

    const info = await transporter.sendMail({
      from: `"${fromAddress.split('@')[0]}" <${fromAddress}>`,
      to,
      subject,
      text,
      html: html || `<pre style="font-family: sans-serif; white-space: pre-wrap;">${text}</pre>`,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to dispatch email.',
    };
  }
}
