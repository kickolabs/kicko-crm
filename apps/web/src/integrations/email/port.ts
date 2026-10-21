// Email port: transactional email (portal links, notifications).

export type Email = { to: string; subject: string; text: string; html?: string; replyTo?: string };

export interface EmailAdapter {
  id: string;
  /** True when real emails are delivered (false for the log/sandbox adapter). */
  delivers: boolean;
  send(mail: Email & { html: string }): Promise<{ sent: boolean }>;
}
