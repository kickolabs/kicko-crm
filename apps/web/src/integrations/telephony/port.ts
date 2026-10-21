// Telephony port: click-to-call bridges, inbound routing, recordings.
// Bridge model: the provider rings the counsellor's phone first, then the client,
// so it works with any mobile, and no browser softphone is needed.

export type CallStatusName = 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed' | 'canceled';

/** Which of our callbacks the provider is calling (the `event` query parameter). */
export type CallbackEvent = 'inbound' | 'status' | 'recording' | 'dialed';

export type CallEvent =
  | { type: 'call.incoming'; providerCallId: string; from: string; to: string }
  | {
      type: 'call.status';
      providerCallId: string;
      callId?: string;
      status: CallStatusName;
      durationSec?: number;
      recording?: { ref: string; channels?: 'dual' | 'mono' };
    }
  | { type: 'call.recording'; providerCallId: string; callId?: string; ref: string; channels?: 'dual' | 'mono'; durationSec?: number };

export type WebhookInput = {
  method: string;
  /** Public URL the provider called (for signature checks). */
  url: URL;
  raw: string;
  headers: Headers;
  /** Query + form/JSON body, flattened. */
  params: Record<string, string>;
};

export type Callbacks = (event: CallbackEvent) => string;

/** How to connect an inbound call. Empty forwardTo = nobody available. */
export type Routing = { callId: string; forwardTo: string[]; record: boolean; greeting?: string; callbacks: Callbacks };

export interface TelephonyAdapter {
  placeCall(input: {
    callId: string;
    agentPhone: string;
    contactPhone: string;
    record: boolean;
    greeting?: string;
    callbacks: Callbacks;
  }): Promise<{ providerCallId: string }>;
  /** Verify and translate a callback. Null = not from this provider/account. */
  parseWebhook(input: WebhookInput): CallEvent[] | null;
  /** Body for the callback response (TwiML, Exotel JSON…). `routing` is set for inbound calls. */
  respond(event: CallbackEvent, routing: Routing | null): { contentType: string; body: string };
  fetchRecording(ref: string): Promise<{ bytes: Buffer; mime: string }>;
  healthCheck(): Promise<void>;
}
