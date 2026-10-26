// Lead ads port: Facebook/Instagram lead forms (and later others) deliver enquiries to us.

export type AdLead = {
  /** The provider's id for this lead, so a resent webhook doesn't duplicate it. */
  externalId: string;
  fields: { fullName?: string; firstName?: string; lastName?: string; email?: string; phone?: string; country?: string; message?: string };
  /** Every answer as given, for the lead's notes. */
  answers: Record<string, string>;
  campaign?: string | null;
  form?: string | null;
  ad?: string | null;
};

export type LeadAdsWebhook =
  | { kind: 'challenge'; body: string } // subscription check: echo this back
  | { kind: 'leads'; leads: AdLead[] }
  | null; // not ours / bad signature

export interface LeadAdsAdapter {
  parseWebhook(input: { method: string; url: URL; raw: string; headers: Headers }): Promise<LeadAdsWebhook>;
  healthCheck(): Promise<void>;
}

/** Map a lead form's field names to ours (Meta's standard keys and common custom ones). */
export function mapAnswers(answers: Record<string, string>): AdLead['fields'] {
  const get = (...keys: string[]) => keys.map((k) => answers[k]).find((v) => v?.trim())?.trim();
  return {
    fullName: get('full_name', 'name'),
    firstName: get('first_name'),
    lastName: get('last_name'),
    email: get('email', 'work_email'),
    phone: get('phone_number', 'phone', 'mobile', 'whatsapp_number'),
    country: get('country', 'destination', 'destination_country', 'preferred_country'),
    message: get('message', 'comments', 'what_are_you_looking_for'),
  };
}
