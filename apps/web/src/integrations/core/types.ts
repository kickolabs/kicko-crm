// Integration layer: every external service is a capability with swappable providers.
// Features depend on the capability's port (interface), never on a vendor SDK.

export type Capability = 'storage' | 'email' | 'payments' | 'messaging' | 'llm' | 'stt' | 'tts' | 'telephony' | 'voice_agent';

export const CAPABILITY_INFO: Record<Capability, { label: string; description: string; owner: 'platform' | 'tenant' }> = {
  messaging: { label: 'WhatsApp & messaging', description: 'Two-way client messaging', owner: 'tenant' },
  payments: { label: 'Payment links', description: 'Collect fees online', owner: 'tenant' },
  telephony: { label: 'Phone calls', description: 'Numbers, calling, recordings', owner: 'tenant' },
  voice_agent: { label: 'AI voice agent', description: 'AI that answers and makes calls', owner: 'tenant' },
  llm: { label: 'AI model', description: 'Summaries, assistant, checks', owner: 'platform' },
  stt: { label: 'Speech to text', description: 'Call transcription', owner: 'platform' },
  tts: { label: 'Text to speech', description: 'AI voices', owner: 'platform' },
  email: { label: 'Email', description: 'Portal links and notifications', owner: 'platform' },
  storage: { label: 'File storage', description: 'Documents and attachments', owner: 'platform' },
};

/** A config field shown in the generated "Connect" form. Secret fields are encrypted at rest and never sent back to the browser. */
export type ConfigField = {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  pattern?: string; // RegExp source
  /** Filled by the provider's setup(), not typed by the user (e.g. a webhook verify token). Shown read-only. */
  generated?: boolean;
};

export type AdapterContext = { tenantId: string; slug: string; appUrl: string };

export type ProviderDescriptor<A = unknown> = {
  id: string;
  capability: Capability;
  name: string;
  description: string;
  /** Works without any external account; for development, demos and tests. */
  sandbox?: boolean;
  fields: ConfigField[];
  /** Capability flags the UI and features read instead of assuming the lowest common denominator. */
  features: Record<string, boolean | string | string[]>;
  docsUrl?: string;
  /** Fill generated fields (secrets, tokens) when a connection is created. */
  setup?: (existing: Record<string, string> | null) => Record<string, string>;
  /** Build the adapter from decrypted config. */
  create: (config: Record<string, string>, ctx: AdapterContext) => A;
  /** The provider calls us back: show the agency its webhook URL to paste. */
  webhookPath?: boolean;
  /** Appended to the webhook URL shown to the agency; {field} is replaced with that config value. */
  webhookSuffix?: string;
  /** Setup steps shown above the connect form. */
  guide?: string[];
  /** Label for the connect button (default "Connect {name}"). */
  connectLabel?: string;
};

/** Raised for problems the user can fix (bad credentials, provider rejected the request). */
export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
  ) {
    super(message);
  }
}
