const DIAL: Record<string, string> = { IN: '91', AE: '971', GB: '44', US: '1', CA: '1', AU: '61', NZ: '64', NP: '977', LK: '94', BD: '880', PK: '92' };

/**
 * Normalise a phone number to +<country><number> for duplicate detection.
 * Local numbers get the agency's country code. Not a full validator.
 */
export function normalizePhone(raw: string | null | undefined, tenantCountry = 'IN'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  const cc = DIAL[tenantCountry] ?? '';
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (cc && digits.length > 10 && digits.startsWith(cc)) return `+${digits}`;
  return cc ? `+${cc}${digits}` : `+${digits}`;
}

export function normalizeEmail(raw: string | null | undefined) {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}
