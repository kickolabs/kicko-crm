import type { LeadSource, LeadStatus, VisaCategory } from '@kicko/db';

export { COUNTRIES, CATEGORY_LABEL } from '@kicko/db/visa-catalog';

export const LEAD_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONSULT_BOOKED', 'WON', 'LOST'];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONSULT_BOOKED: 'Consult booked',
  WON: 'Won',
  LOST: 'Lost',
};

export const LEAD_SOURCES: LeadSource[] = ['WEB_FORM', 'WHATSAPP', 'CALL', 'WALK_IN', 'REFERRAL', 'ADS', 'OTHER'];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  WEB_FORM: 'Web form',
  WHATSAPP: 'WhatsApp',
  CALL: 'Phone call',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  ADS: 'Ads',
  OTHER: 'Other',
};

export const CATEGORIES: VisaCategory[] = ['STUDY', 'PR', 'WORK', 'VISIT', 'FAMILY'];

export type Tone = 'neutral' | 'info' | 'teal' | 'warn' | 'ok' | 'danger' | 'lime' | 'ink';

export const LEAD_STATUS_TONE: Record<LeadStatus, Tone> = {
  NEW: 'lime',
  CONTACTED: 'neutral',
  QUALIFIED: 'info',
  CONSULT_BOOKED: 'teal',
  WON: 'ok',
  LOST: 'danger',
};

export const FAMILY_RELATIONS = ['SPOUSE', 'CHILD', 'PARENT', 'SIBLING'] as const;
export const ENGLISH_TESTS = ['IELTS', 'PTE', 'TOEFL', 'DUOLINGO', 'CELPIP', 'OET'] as const;
