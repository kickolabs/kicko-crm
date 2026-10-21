import 'server-only';
import type { EmailAdapter } from './port';

// Resend (HTTP API) for production; a log adapter for development.

export const resendEmail: EmailAdapter = {
  id: 'resend',
  delivers: true,
  async send(mail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('email send failed', res.status, await res.text().catch(() => ''));
      return { sent: false };
    }
    return { sent: true };
  },
};

export const logEmail: EmailAdapter = {
  id: 'log',
  delivers: false,
  async send(mail) {
    if (process.env.NODE_ENV !== 'production') console.info(`[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return { sent: false };
  },
};
