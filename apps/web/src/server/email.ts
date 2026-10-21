import 'server-only';
import { logEmail, resendEmail } from '@/integrations/email/adapters';
import type { Email } from '@/integrations/email/port';
import { meter } from '@/integrations/core/usage';

// Email facade. Resend when RESEND_API_KEY + EMAIL_FROM are set, otherwise the
// log adapter (callers fall back to copy-the-link flows). Usage is metered per agency.

export type { Email };

const adapter = () => (process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? resendEmail : logEmail);

export const emailEnabled = () => adapter().delivers;

export async function sendEmail(mail: Email, tenantId?: string | null): Promise<{ sent: boolean }> {
  const a = adapter();
  const res = await a.send({ ...mail, html: mail.html ?? textToHtml(mail.text) });
  if (res.sent) await meter(tenantId, 'email', a.id, 'email');
  return res;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain branded layout; URLs become buttons. */
export function textToHtml(text: string) {
  const body = esc(text)
    .split('\n')
    .map((line) =>
      /^https?:\/\/\S+$/.test(line.trim())
        ? `<p style="margin:20px 0"><a href="${line.trim()}" style="background:#121417;color:#F4F3EE;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">Open your portal</a></p>`
        : `<p style="margin:0 0 10px">${line || '&nbsp;'}</p>`,
    )
    .join('');
  return `<div style="background:#F4F3EE;padding:32px 16px;font-family:Arial,sans-serif;color:#121417"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;font-size:15px;line-height:1.5">${body}</div></div>`;
}
