// Messaging port: two-way client messaging (WhatsApp today; SMS/BSPs later).

export type InboundMessage = {
  type: 'message.received';
  id: string; // provider message id (idempotency key)
  from: string; // E.164 without "+"
  profileName?: string;
  body: string;
  media?: { kind: string; ref: string; mime?: string; name?: string };
  at: Date;
};

export type StatusUpdate = {
  type: 'message.status';
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  error?: string;
};

export type MessagingEvent = InboundMessage | StatusUpdate;

export type RemoteTemplate = { name: string; language: string; status: string; category: string; body: string };

export interface MessagingAdapter {
  channel: 'WHATSAPP';
  sendText(to: string, body: string): Promise<{ id: string }>;
  sendTemplate(to: string, name: string, language: string, params: string[]): Promise<{ id: string }>;
  markRead(messageId: string): Promise<void>;
  fetchMedia(ref: string): Promise<{ bytes: Buffer; mime: string }>;
  /** Templates managed by the provider; null when this provider has none (sandbox seeds its own). */
  listTemplates(): Promise<RemoteTemplate[] | null>;
  /** Webhook subscription handshake (GET). Returns the challenge to echo, or null to refuse. */
  handshake(params: URLSearchParams): string | null;
  /** Verify the signature and translate the payload. Null = invalid signature. */
  parseWebhook(rawBody: string, headers: Headers): MessagingEvent[] | null;
  healthCheck(): Promise<void>;
}
